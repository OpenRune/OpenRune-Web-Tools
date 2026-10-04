#!/usr/bin/env node
/**
 * Headless OSRS map tile dumper — local-only for now (writes under ./dumps/), no upload yet.
 *
 * Drives the real vendored renderer (@openrune/map-viewer, dennisdev/rs-map-viewer) via the
 * dedicated /map-viewer/dump page (src/app/map-viewer/dump/) with Playwright, the same "take a
 * screenshot of the real 3D scene from a top-down/angled camera" technique skillbert/rsmv uses
 * for runeapps.org/osrs.world, headless-GPU-browser and all.
 *
 * Zoom scheme matches rsmv: tile images are a fixed TILE_IMG_SIZE square, and zoom level N means
 * `pxpersquare = 2^N` pixels per game tile — each step up in zoom halves the world area one
 * image covers (a standard power-of-2 quadtree, like Google Maps/Leaflet). Zoom 3 ("base") is
 * exactly one image per 64x64 map square; this script defaults to that.
 *
 * Cache bytes are never passed through Playwright itself — `main_file_cache.dat2` alone is
 * commonly 200MB+, which overwhelms `page.evaluate`'s argument-serialization (reliably crashed
 * the renderer process when tried). Instead the dump page fetches them over plain HTTP from the
 * existing `/api/dev-cache` route (see `OPENRUNE_DEV_CACHE_DIR` in `.env.local`), same as the
 * app's own dev-cache auto-load already does.
 *
 * Prerequisites: the Next dev server already running on localhost:3000 (`npm run dev`), with
 * `OPENRUNE_DEV_CACHE_DIR` pointed at a cache folder — this script does not start the server.
 * Needs `npx playwright install chromium` once.
 *
 * Usage (single point + radius, in map squares):
 *   node scripts/dump-map-tiles.mjs --x 3222 --z 3218 --radius 1
 *     [--zoom 3] [--planes 0,1,2,3] [--modes flat,3d] [--out dumps] [--base-url http://localhost:3000]
 *     [--manifest dumps/manifest.json] [--progress dumps/progress.json] [--force] [--verbose]
 *     [--item-timeout-ms 60000] [--recycle-after 300]
 *
 * --item-timeout-ms (default 60000): give up on a single item past this long and move on — a
 * page that hangs once isn't trusted to keep working, so it's closed and reopened immediately
 * (not just left running) rather than risk every item after it also hanging on the same page.
 * --recycle-after (default 300): also proactively close/reopen each page after this many items
 * even without a timeout, as cheap insurance against a long run slowly degrading.
 *
 * --progress <path> (default <out>/progress.json): a machine-readable snapshot of the current
 * run — state/current/total/lastItem/writtenFiles — written periodically (same cadence as the
 * manifest flush) plus once at start/end/on error. `check-dump-progress.mjs` polls this from a
 * second terminal; `auto-dump-and-upload.mjs` reads `writtenFiles` after a successful run to know
 * exactly what to upload.
 *
 * --modes all expands to every mode (flat, 3d, 2d-shaded, 2d-normal, overlay) — the same as
 * listing every key of MODES below. On PowerShell, always quote a comma-separated --modes value
 * (e.g. --modes "3d,overlay") — unquoted, PowerShell parses `3d` as a numeric literal and splits
 * the list into separate arguments before this script ever sees it.
 *
 * Usage (bounding box, in world tile coordinates — takes priority over --x/--z/--radius):
 *   node scripts/dump-map-tiles.mjs --x1 3094 --z1 3213 --x2 3356 --z2 3486 --modes 3d,overlay
 *
 * --concurrency N (default 1 — see warning below): runs N browser pages in parallel, each
 * independently loading the cache (its own worker pool — see MapDumpClient.tsx) and pulling from
 * one shared work queue. The queue/manifest/progress-bar sharing itself is fine (plain in-process
 * JS state mutated between awaits, not real parallel access) — the problem is underneath that:
 * with N>1, multiple pages hold concurrent WebGL contexts against the same software renderer
 * (--use-gl=angle --use-angle=swiftshader), and that's been caught silently producing
 * 180°-rotated flat/3d captures — confirmed by re-dumping the exact same region at concurrency 1
 * vs 2 and comparing. No fix found yet (looks like a SwiftShader/multi-context issue, not
 * anything in this renderer's own camera math — a region captured correctly in isolation came out
 * rotated only when captured alongside another page's concurrent render). CPU-rasterized 2d/
 * overlay captures don't touch WebGL at all, so they're presumably unaffected, but that's not
 * independently confirmed either — until this is root-caused, leave concurrency at 1 for anything
 * you need to trust, especially flat/3d. Each page loading its own full copy of the cache is also
 * expensive on its own terms — 4 concurrent pages reliably crashed the whole Node process with an
 * out-of-memory error in earlier testing.
 *
 * Output layout: <out>/<mode's dir, see MODES below>/<plane>/<zoom>/<tile id>.webp — at zoom 3
 * ("base", one image per region) <tile id> is the real OSRS region id (`(regionX << 8) |
 * regionY`); at every other zoom, where one image doesn't correspond to exactly one region,
 * it's the tile-pyramid grid position `<col>-<row>` instead.
 *
 * Re-running over the same area is cheap: every position that actually produced a real (non-
 * blank) file gets a manifest entry recording the terrain/loc archive CRCs (from the cache's own
 * reference table, not file contents — see `MapFileIndex.getTerrainArchiveCrc`/
 * `getLocArchiveCrc`) of every map square it depends on. If none of those CRCs have changed since
 * the last run (i.e. OSRS hasn't updated that area), the whole render is skipped entirely. Pass
 * --force to ignore the manifest and redo everything anyway. Blank/no-data results are never
 * written to disk or recorded in the manifest — they're cheap enough to just recheck every run.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProgressBar } from "./lib/progress-bar.mjs";

const TILE_IMG_SIZE = 512;

// Maps a `--modes` entry to its output directory segments (under `--out`) and how to render it.
// "flat"/"3d" are real camera screenshots (see setView/capture); "2d-shaded"/"2d-normal" and
// "overlay" are the CPU-rasterized flat-map pipeline (capture2d/captureOverlay) — no camera
// involved, see MapDumpClient.tsx's module doc comment for why that's a separate code path.
const MODES = {
    flat: { dir: ["satellite", "flat"], kind: "camera", cameraMode: "flat" },
    "3d": { dir: ["satellite", "3d"], kind: "camera", cameraMode: "3d" },
    "2d-shaded": { dir: ["2d", "shaded"], kind: "2d", shaded: true },
    "2d-normal": { dir: ["2d", "normal"], kind: "2d", shaded: false },
    overlay: { dir: ["overlay"], kind: "overlay" },
};

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        args[key] = next && !next.startsWith("--") ? next : "true";
        if (next && !next.startsWith("--")) i++;
    }
    return args;
}

function loadManifest(manifestPath) {
    if (!existsSync(manifestPath)) {
        return { version: 1, entries: {} };
    }
    try {
        return JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch (err) {
        console.warn(`Manifest at ${manifestPath} is unreadable/corrupt, starting fresh:`, err);
        return { version: 1, entries: {} };
    }
}

function saveManifest(manifestPath, manifest) {
    mkdirSync(join(manifestPath, ".."), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Machine-readable run state for `check-dump-progress.mjs` to poll from a second terminal —
 * separate from the manifest (that's this script's own bookkeeping for the *next* run; this is
 * for anyone watching the *current* one). Written on the same periodic cadence as the manifest
 * flush, not on every single item, to keep it cheap on a big run.
 */
function saveProgress(progressPath, progress) {
    mkdirSync(join(progressPath, ".."), { recursive: true });
    writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

/** Deterministic string form of a CRC signature, so two signatures can be compared with `===`. */
function signatureKey(squares) {
    return squares
        .slice()
        .sort((a, b) => a.sx - b.sx || a.sz - b.sz)
        .map((s) => `${s.sx},${s.sz}:${s.terrainCrc}:${s.locCrc}`)
        .join("|");
}

async function initPage(browser, baseUrl, verbose, label) {
    const context = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // The browser side logs a lot (every tile/scene load, draw ranges, etc.) — fine on its own,
    // but it would scroll the progress bar off screen immediately. Quiet by default; --verbose
    // brings it back if you need it for debugging.
    if (verbose) {
        page.on("console", (msg) => console.log(`[browser ${label}] ${msg.text()}`));
    }
    page.on("pageerror", (err) => console.error(`[browser ${label} error] ${err}`));
    page.on("crash", () => console.error(`[browser ${label}] page crashed`));

    await page.goto(`${baseUrl}/map-viewer/dump`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__mapDump !== "undefined");
    await page.evaluate(() => window.__mapDump.loadCache());
    await page.waitForFunction(() => window.__mapDump?.ready === true, { timeout: 120_000 });
    // The very first tile is slower than the rest even after `ready` — initial shader/texture
    // setup, not just the per-square load this same wait covers for every later tile.
    await page.waitForTimeout(4000);

    return page;
}

/** Renders/skips one (mode, plane, square) position. Returns true if a file was written. */
async function processItem(page, item, shared) {
    const { cfg, plane, squareX, squareZ } = item;
    const { outDir, zoom, tilesPerImage, manifest, crcSignatureCache, force, progress, state } = shared;

    const modeDir = join(outDir, ...cfg.dir, String(plane), String(zoom));
    mkdirSync(modeDir, { recursive: true });

    // At zoom 3 (base) this is exactly one map square; at other zooms it's the tile grid cell the
    // square's center falls into — multi-square-per-tile and multi-tile-per-square cases aren't
    // reconciled into a shared grid yet, so non-base zoom levels may re-render overlapping areas.
    // Fine for proving the pipeline; worth a proper tile-grid pass before this covers a full
    // pyramid.
    const worldX = squareX * 64 + 32;
    const worldZ = squareZ * 64 + 32;
    const tileCol = Math.floor(worldX / tilesPerImage);
    const tileRow = Math.floor(worldZ / tilesPerImage);
    const tileCenterX = (tileCol + 0.5) * tilesPerImage;
    const tileCenterZ = (tileRow + 0.5) * tilesPerImage;

    // At zoom 3 ("base") one image is exactly one OSRS map region, so name it by the real region
    // id (`(regionX << 8) | regionY`, same convention as `MapFileIndex`'s
    // `getMapSquareId`/`l{x}_{y}`/`m{x}_{y}` archive names) rather than the generic tile-pyramid
    // grid position — directly meaningful to anyone who knows OSRS regions, and matches how
    // region-based tools/maps address areas. Other zooms don't have a 1:1 region correspondence
    // (one image spans multiple regions below zoom 3, or a fraction of one above it), so those
    // keep the grid-position name.
    const tileId = tilesPerImage === 64 ? String((squareX << 8) | squareZ) : `${tileCol}-${tileRow}`;

    const manifestKey = [...cfg.dir, String(plane), String(zoom), tileId].join("/");

    // getCrcSignature is plane-independent, so this is shared across the plane loop (and across
    // modes, since it only depends on x/z/zoom) via the cache keyed below — one browser
    // round-trip per tile position, not per output file. Shared across every page too: the CRC
    // value is just a property of the cache bytes, identical no matter which page reads it.
    const crcCacheKey = `${tileCenterX},${tileCenterZ},${zoom}`;
    let crcSignature = crcSignatureCache.get(crcCacheKey);
    if (!crcSignature) {
        crcSignature = await page.evaluate(
            (view) => window.__mapDump.getCrcSignature(view),
            { x: tileCenterX, z: tileCenterZ, zoom },
        );
        crcSignatureCache.set(crcCacheKey, crcSignature);
    }
    const sigKey = signatureKey(crcSignature);

    if (!force && manifest.entries[manifestKey]?.sig === sigKey) {
        progress.update(`up to date: ${manifestKey}`);
        return false;
    }

    // Skip regions the cache has nothing for rather than writing a blank/black tile — "objects"
    // for the overlay layer (locs-only, nothing to show without loc data even if terrain exists),
    // "landscape" (terrain) for every other mode.
    const dataKind = cfg.kind === "overlay" ? "objects" : "landscape";
    const hasData = await page.evaluate(
        (view) => window.__mapDump.hasData(view),
        { x: tileCenterX, z: tileCenterZ, plane, zoom, kind: dataKind },
    );
    if (!hasData) {
        // Blank results aren't written to disk or recorded in the manifest at all — they don't
        // matter, and re-checking an empty region next run is cheap (this is the fast pre-render
        // check, not an actual render).
        progress.update(`no ${dataKind} data: ${manifestKey}`);
        return false;
    }

    let dataUrl;
    if (cfg.kind === "2d") {
        // CPU-rasterized flat map image — no camera/GPU scene involved, so no setView()/settle-
        // time wait needed, just render straight from cache data.
        dataUrl = await page.evaluate(
            (view) => window.__mapDump.capture2d(view),
            { x: tileCenterX, z: tileCenterZ, plane, zoom, shaded: cfg.shaded },
        );
    } else if (cfg.kind === "overlay") {
        dataUrl = await page.evaluate(
            (view) => window.__mapDump.captureOverlay(view),
            { x: tileCenterX, z: tileCenterZ, plane, zoom },
        );
    } else {
        await page.evaluate(
            (view) => window.__mapDump.setView(view),
            { x: tileCenterX, z: tileCenterZ, plane, zoom, mode: cfg.cameraMode },
        );
        // A fixed wait alone isn't reliable — how long streaming takes to catch up depends on
        // how much new ground the camera just covered, which varies a lot across a bulk run. Give
        // it a moment to start requesting the new position's squares, then actually poll until
        // nothing's still in flight (isSettled — see its doc comment), capped so one stubborn
        // square can't hang the whole run.
        await page.waitForTimeout(1500);
        const settleStart = Date.now();
        while (Date.now() - settleStart < 20_000) {
            const settled = await page.evaluate(() => window.__mapDump.isSettled());
            if (settled) break;
            await page.waitForTimeout(500);
        }
        // One more beat after settling for the newly-uploaded geometry to actually get drawn —
        // "nothing left to load" and "the last loaded square has been rendered" aren't quite the
        // same frame.
        await page.waitForTimeout(500);
        dataUrl = await page.evaluate(() => window.__mapDump.capture());
    }

    // Catches what the pre-render hasData check can miss — a plane can have a technically-real
    // tile (so hasData says yes) that's still effectively black (e.g. an unused roof-boundary
    // tile), which only the actual rendered pixels reveal.
    if (dataUrl === null) {
        // Same as the hasData case above — not written anywhere. This one did cost a real render
        // to discover, so it'll be redone next run too, but that's the tradeoff for not keeping
        // manifest entries around for files that will never exist.
        progress.update(`blank: ${manifestKey}`);
        return false;
    }

    const base64 = dataUrl.replace(/^data:image\/webp;base64,/, "");
    const relativePath = join(...cfg.dir, String(plane), String(zoom), `${tileId}.webp`);
    const filePath = join(outDir, relativePath);
    writeFileSync(filePath, Buffer.from(base64, "base64"));
    // Every manifest entry that exists at all is a real written file now — blank results are
    // never recorded (see the two `return false` cases above), so there's no `blank` field left
    // to need.
    manifest.entries[manifestKey] = { sig: sigKey };
    state.manifestDirty = true;
    state.written++;
    // Relative (not absolute) paths — this is what `auto-dump-and-upload.mjs` reads out of
    // progress.json to know exactly which files this run actually produced, so it can upload
    // just those instead of re-walking/diffing the whole `dumps/` tree.
    state.writtenFiles.push(relativePath);
    progress.update(`wrote: ${filePath}`);
    return true;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const zoom = Number.parseInt(args.zoom ?? "3", 10);
    const planes = (args.planes ?? args.plane ?? "0,1,2,3")
        .split(",")
        .map((p) => Number.parseInt(p, 10));
    const modes =
        args.modes === "all" ? Object.keys(MODES) : (args.modes ?? "flat,3d").split(",");
    const outDir = args.out ?? "dumps";
    const baseUrl = args["base-url"] ?? "http://localhost:3000";
    const manifestPath = args.manifest ?? join(outDir, "manifest.json");
    const progressPath = args.progress ?? join(outDir, "progress.json");
    const force = args.force === "true";
    const verbose = args.verbose === "true";
    // Default 1 — see the --concurrency doc comment above: >1 is confirmed to occasionally
    // produce silently-corrupted (180°-rotated) captures for flat/3d, not just slower/flakier.
    const concurrency = Number.parseInt(args.concurrency ?? "1", 10);
    // A single stuck page.evaluate() (SwiftShader wedged, a pathologically loc-heavy square, a
    // dev-server hiccup) used to block the whole queue forever. Past this many ms, give up on
    // that item (same as any other error — logged, unrecorded, retried next run) and force that
    // worker's page closed and reopened, since a page that just hung once isn't trusted to keep
    // working normally for the rest of the run.
    const itemTimeoutMs = Number.parseInt(args["item-timeout-ms"] ?? "60000", 10);
    // Also proactively recycle each page every this-many items even without a timeout — cheap
    // insurance against slow degradation over a multi-thousand-tile run (texture/GC buildup in a
    // page that's never reloaded) rather than only reacting after something's already stuck.
    const recycleAfter = Number.parseInt(args["recycle-after"] ?? "300", 10);

    for (const mode of modes) {
        if (!MODES[mode]) {
            throw new Error(`Unknown mode "${mode}" — expected one of: ${Object.keys(MODES).join(", ")}`);
        }
    }

    // Bounding box (--x1/--z1/--x2/--z2, world tile coords) takes priority over the older single
    // point + radius (--x/--z/--radius, radius in map squares) form.
    let squareXStart, squareXEnd, squareZStart, squareZEnd;
    if (args.x1 !== undefined || args.x2 !== undefined) {
        const x1 = Number.parseInt(args.x1, 10);
        const z1 = Number.parseInt(args.z1, 10);
        const x2 = Number.parseInt(args.x2, 10);
        const z2 = Number.parseInt(args.z2, 10);
        squareXStart = Math.floor(Math.min(x1, x2) / 64);
        squareXEnd = Math.floor(Math.max(x1, x2) / 64);
        squareZStart = Math.floor(Math.min(z1, z2) / 64);
        squareZEnd = Math.floor(Math.max(z1, z2) / 64);
    } else {
        const centerX = Number.parseInt(args.x ?? "3222", 10);
        const centerZ = Number.parseInt(args.z ?? "3218", 10);
        const radiusSquares = Number.parseInt(args.radius ?? "1", 10);
        const centerSquareX = Math.floor(centerX / 64);
        const centerSquareZ = Math.floor(centerZ / 64);
        squareXStart = centerSquareX - radiusSquares;
        squareXEnd = centerSquareX + radiusSquares;
        squareZStart = centerSquareZ - radiusSquares;
        squareZEnd = centerSquareZ + radiusSquares;
    }
    const regionCount = (squareXEnd - squareXStart + 1) * (squareZEnd - squareZStart + 1);

    const manifest = loadManifest(manifestPath);
    // getCrcSignature is plane-independent (one archive covers all 4 planes), so this caches it
    // per tile position across the plane/mode loop (and across pages — see initPage's doc
    // comment) instead of re-querying the browser for the same answer repeatedly.
    const crcSignatureCache = new Map();
    const tilesPerImage = TILE_IMG_SIZE / Math.pow(2, zoom);

    const workItems = [];
    for (const mode of modes) {
        for (const plane of planes) {
            for (let squareX = squareXStart; squareX <= squareXEnd; squareX++) {
                for (let squareZ = squareZStart; squareZ <= squareZEnd; squareZ++) {
                    workItems.push({ mode, cfg: MODES[mode], plane, squareX, squareZ });
                }
            }
        }
    }

    console.log(
        `Area: squares x[${squareXStart},${squareXEnd}] z[${squareZStart},${squareZEnd}] ` +
            `(${regionCount} region${regionCount === 1 ? "" : "s"}) x ${planes.length} plane(s) x ${modes.length} mode(s) ` +
            `= ${workItems.length} total positions to check, ${concurrency}-way parallel.`,
    );

    const browser = await chromium.launch({
        headless: true,
        args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--disable-gpu-sandbox",
            "--enable-webgl",
            "--enable-webgl2",
        ],
    });

    console.log(`Starting ${concurrency} browser page(s), each loading the cache independently...`);
    const pageCount = Math.max(1, Math.min(concurrency, workItems.length || 1));
    const pages = await Promise.all(
        Array.from({ length: pageCount }, (_, i) => initPage(browser, baseUrl, verbose, i)),
    );
    console.log("All pages ready.");

    const progress = makeProgressBar(workItems.length);
    const startedAt = new Date().toISOString();
    const state = { written: 0, processed: 0, manifestDirty: false, writtenFiles: [], lastItem: "" };
    const shared = { outDir, zoom, tilesPerImage, manifest, crcSignatureCache, force, progress, state };

    function progressSnapshot(runState) {
        return {
            pid: process.pid,
            state: runState,
            total: workItems.length,
            current: state.processed,
            written: state.written,
            lastItem: state.lastItem,
            startedAt,
            updatedAt: new Date().toISOString(),
            writtenFiles: state.writtenFiles,
        };
    }

    saveProgress(progressPath, progressSnapshot("running"));

    let nextIndex = 0;
    function takeNext() {
        return nextIndex < workItems.length ? workItems[nextIndex++] : null;
    }

    async function worker(pageIndex) {
        let page = pages[pageIndex];
        let itemsOnThisPage = 0;

        for (let item = takeNext(); item; item = takeNext()) {
            const label = `${item.cfg.dir.join("/")}/${item.plane}/${zoom} (${item.squareX},${item.squareZ})`;
            let timedOut = false;
            let timer;
            const itemPromise = processItem(page, item, shared);
            try {
                await Promise.race([
                    itemPromise,
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            timedOut = true;
                            reject(new Error(`Timed out after ${itemTimeoutMs}ms waiting on ${label}`));
                        }, itemTimeoutMs);
                    }),
                ]);
            } catch (err) {
                // One bad item (a page crash, a transient network hiccup, a renderer edge case,
                // or now a timeout) shouldn't take down a big run — log it and keep going. It
                // stays unrecorded in the manifest, so a re-run will retry it rather than
                // silently treating it as done. If the timer lost the race, `itemPromise` is
                // still out there and may reject later once the page's eventually closed below —
                // swallow that so it doesn't surface as an unhandled rejection.
                process.stdout.write("\n");
                console.error(`Error processing ${label}:`, err);
                progress.update(`error: ${label}`);
                itemPromise.catch(() => {});
            } finally {
                clearTimeout(timer);
            }

            itemsOnThisPage++;
            state.processed++;
            state.lastItem = label;

            if (timedOut || itemsOnThisPage >= recycleAfter) {
                process.stdout.write("\n");
                console.log(
                    `Recycling browser page ${pageIndex} (${timedOut ? "timed out — treating the page as stuck" : `processed ${itemsOnThisPage} items`})...`,
                );
                try {
                    await page.context().close();
                } catch (closeErr) {
                    console.error(`Page ${pageIndex} context didn't close cleanly (continuing anyway):`, closeErr);
                }
                page = await initPage(browser, baseUrl, verbose, pageIndex);
                pages[pageIndex] = page;
                itemsOnThisPage = 0;
            }

            // A big run can take a long time — flush periodically so an interruption doesn't
            // lose everything done so far, not just the final save. Same cadence for the
            // manifest and the progress file, piggybacking the existing checkpoint rather than
            // adding a second one.
            if (state.processed % 20 === 0) {
                if (state.manifestDirty) saveManifest(manifestPath, manifest);
                saveProgress(progressPath, progressSnapshot("running"));
            }
        }
    }

    await Promise.all(pages.map((_, pageIndex) => worker(pageIndex)));

    progress.done();

    if (state.manifestDirty) {
        saveManifest(manifestPath, manifest);
        console.log(`Updated manifest at ${manifestPath}`);
    }

    saveProgress(progressPath, progressSnapshot("done"));
    console.log(`Done — wrote ${state.written} tiles under ${outDir}/`);
    await browser.close();
}

main().catch((err) => {
    console.error(err);
    try {
        const args = parseArgs(process.argv.slice(2));
        const outDir = args.out ?? "dumps";
        const progressPath = args.progress ?? join(outDir, "progress.json");
        saveProgress(progressPath, {
            pid: process.pid,
            state: "error",
            error: String(err?.message ?? err),
            updatedAt: new Date().toISOString(),
        });
    } catch {
        // Best-effort only — don't let a broken progress-file write mask the real error below.
    }
    process.exit(1);
});
