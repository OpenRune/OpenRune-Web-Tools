#!/usr/bin/env node
/**
 * Scheduled entry point: checks whether OSRS has shipped a new live cache since the last dump,
 * and if so runs the full-map dump (`dump-map-tiles.mjs`) and uploads the result to Cloudflare
 * R2. Most invocations should find nothing changed and exit quietly.
 *
 * Prerequisite this script does NOT manage: the Next dev server (`npm run dev` — the
 * `/api/dev-cache` route `dump-map-tiles.mjs` relies on is disabled in production builds, so it
 * must be `dev`, not `start`/a production build) must already be running persistently on the VPS
 * at MAP_VIEWER_BASE_URL, with its own `.env.local`'s `OPENRUNE_DEV_CACHE_DIR` pointed at an
 * up-to-date cache folder — start/supervise that yourself (pm2, systemd, screen, whatever you
 * already use), this just assumes it's reachable.
 *
 * Two ways to schedule this:
 *   - Recommended: `.github/workflows/osrs-auto-dump.yml` — a GitHub Actions workflow on a
 *     *self-hosted* runner registered on the same VPS (GitHub-hosted runners can't reach the
 *     local cache folder above). Secrets come from the repo's GitHub Actions secrets, schedule
 *     and manual-trigger are both built in — see that file for one-time setup steps.
 *   - Or plain cron, if you'd rather not use GitHub Actions: secrets then come from `.env`
 *     (copy `.env.example`, fill in real values — never commit `.env` itself) via the
 *     zero-dependency loader in `lib/env.mjs`. Example crontab (every 30 min, 2pm-7:30pm, every
 *     Wednesday — adjust the hour range for your timezone; cron runs in the VPS's system local
 *     time, check with `timedatectl`, or prefix the crontab with a `TZ=...` line):
 *       0,30 14-19 * * 3 cd /path/to/OpenRune-Editor && /usr/bin/node scripts/auto-dump-and-upload.mjs >> /var/log/openrune-auto-dump.log 2>&1
 *
 * Either way, real environment variables (however they get set) always take priority over
 * `.env`.
 *
 * Usage:
 *   node scripts/auto-dump-and-upload.mjs            # only runs if the live cache id changed
 *   node scripts/auto-dump-and-upload.mjs --manual    # always runs, regardless of cache id
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadEnv } from "./lib/env.mjs";
import { getLatestLiveCacheId, readLastKnownId, writeLastKnownId } from "./lib/cache-check.mjs";
import { uploadFiles } from "./lib/r2-upload.mjs";

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

function runDump({ outDir, progressPath, baseUrl }) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "scripts/dump-map-tiles.mjs",
                "--modes", "all",
                "--planes", "0,1,2,3",
                // Full world bounds (MapManager.MAX_MAP_X=100, MAX_MAP_Y=200, each a 64-tile
                // square — see packages/map-viewer/src/mapviewer/MapManager.ts). Deliberately no
                // --force: dump-map-tiles.mjs's own CRC/manifest skip is what makes a weekly
                // re-run fast (most of the map didn't change) — forcing would defeat that.
                "--x1", "0", "--z1", "0", "--x2", "6400", "--z2", "12800",
                "--out", outDir,
                "--base-url", baseUrl,
                "--progress", progressPath,
            ],
            { stdio: "inherit" },
        );
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`dump-map-tiles.mjs exited with code ${code}`));
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const manual = args.manual === "true";

    loadEnv();

    const outDir = process.env.DUMPS_OUT_DIR ?? "dumps";
    const progressPath = `${outDir}/progress.json`;
    const baseUrl = process.env.MAP_VIEWER_BASE_URL ?? "http://localhost:3000";
    const statePath = process.env.CACHE_STATE_PATH ?? "state/last-cache-id.json";

    for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) {
        if (!process.env[key]) {
            throw new Error(`Missing ${key} — copy .env.example to .env and fill in your R2 credentials.`);
        }
    }

    const latest = await getLatestLiveCacheId();
    const lastKnown = readLastKnownId(statePath);

    if (!manual && latest.id === lastKnown) {
        console.log(`No update (cache id still ${latest.id}) — nothing to do.`);
        return;
    }

    console.log(
        manual
            ? `Manual run — dumping current live cache (id=${latest.id}).`
            : `New live cache detected: ${lastKnown ?? "(none)"} -> ${latest.id}. Starting full-map dump...`,
    );

    await runDump({ outDir, progressPath, baseUrl });

    const progress = JSON.parse(readFileSync(progressPath, "utf-8"));
    const toUpload = [...progress.writtenFiles, "manifest.json", "progress.json"];

    console.log(`Dump finished — uploading ${toUpload.length} file(s) to R2 bucket ${process.env.R2_BUCKET_NAME}...`);
    const uploaded = await uploadFiles(outDir, toUpload, process.env, {
        onProgress: (done, total) => {
            if (done % 50 === 0 || done === total) console.log(`  uploaded ${done}/${total}`);
        },
    });
    console.log(`Uploaded ${uploaded} file(s).`);

    // Only persist the new id once the dump AND the upload both succeeded — a failure anywhere
    // above leaves the stored id untouched, so the next poll retries this same update.
    writeLastKnownId(statePath, latest.id);
    console.log(`Done — last known cache id is now ${latest.id}.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
