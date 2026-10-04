"use client";

/**
 * Headless tile-dump target page — not part of the normal app UI/routing. A Playwright script
 * (`scripts/dump-map-tiles.mjs`) navigates here directly, injects cache bytes read from disk
 * (bypassing the interactive folder-picker flow, which needs a user gesture), then drives
 * `window.__mapDump` to position the camera and capture PNGs tile by tile.
 *
 * Camera/zoom math mirrors skillbert/rsmv's map-tile baking scheme (the one runeapps.org/
 * osrs.world-style sites use): a fixed `tileimgsize`-pixel square image per tile, zoom level N
 * meaning `pxpersquare = 2^N` pixels per game tile — so each step up in zoom halves the world
 * area one image covers and the next 4 child tiles exactly cover one parent tile's area (a
 * standard power-of-2 quadtree, like Google Maps/Leaflet, just applied to RS world tiles
 * instead of lat/lng). "Flat" vs "3d" is the same orthographic camera, just pitched straight
 * down vs tilted to a birds-eye angle, matching rsmv's "dxdy/dzdy" flat-vs-birds-eye layers.
 */
import {
    Camera,
    MapViewer,
    ProjectionType,
    RenderDataWorkerPool,
    TextureFilterMode,
    createLoadedCache,
    getAvailableRenderers,
    registerSerializer,
    renderDataLoaderSerializer,
} from "@openrune/map-viewer";
import { useEffect, useRef } from "react";

import { fetchDevCacheEntries, probeDevCache } from "../../../util/cache-directory";

/** Pixel size of every dumped tile image, matching rsmv's default `tileimgsize`. */
export const TILE_IMG_SIZE = 512;
/** RS angle units for "looking straight down" / "level, no tilt" (2048 units = 360°). */
const PITCH_FLAT = -512;
/**
 * Approximates rsmv's `dxdy:0.15, dzdy:0.25` birds-eye skew via camera tilt instead of shear.
 * Tilting an orthographic camera (rather than shearing its projection, which this renderer has
 * no hook for) shifts what's in frame away from directly below the camera by roughly
 * `height * tan(tiltAngle)` — kept small deliberately so that shift stays well inside one tile.
 */
const PITCH_3D = -470;
const YAW_NORTH_UP = 1024;
/** 2048 RS angle units = 360°, matching `rs/MathConstants.ts`'s `RS_TO_RADIANS`. */
const RS_TO_RADIANS = (Math.PI * 2) / 2048;

/**
 * "flat"/"3d" are screenshots of the real 3D engine from an orthographic camera (see `setView`/
 * `capture`). "2d" is a different pipeline entirely — a flat, CPU-rasterized, true top-down map
 * image with no camera or GPU scene at all, the same technique as RuneLite's
 * `MapImageDumper.java` (and this engine's own in-game minimap/world-map). It reuses the
 * vendored `MapImageRenderer.renderMinimapHd` (`rs/map/MapImageRenderer.ts`, already an existing
 * 1:1 port of that exact RuneLite class — same `MAP_SCALE = 4` px/tile and `BLEND = 5` ground-
 * blend radius constants) via `RenderDataWorkerPool.queueMapImage`, which already renders one
 * full map square at a time completely independently of the WebGL renderer/camera.
 */
export type MapDumpMode = "flat" | "3d" | "2d";

export type MapDumpView = {
    /** World tile coordinates of the tile image's center. */
    x: number;
    z: number;
    plane: number;
    /** `pxpersquare = 2^zoom`; see the module doc comment. */
    zoom: number;
    mode: MapDumpMode;
};

/**
 * A map square's terrain/loc archive CRCs — -1 when the square or that CRC isn't available (see
 * `MapFileIndex.getTerrainArchiveCrc`/`getLocArchiveCrc`). Both change together for the modern
 * cache format (terrain and locs share one archive per square); kept separate since older formats
 * split them.
 */
export type SquareCrc = { sx: number; sz: number; terrainCrc: number; locCrc: number };

/** World-tile square range a given tile's (x, z, zoom) touches — shared by every capture path. */
function getTouchedSquareRange(x: number, z: number, zoom: number) {
    const pxPerSquareWanted = Math.pow(2, zoom);
    const tilesPerImage = TILE_IMG_SIZE / pxPerSquareWanted;

    // North-up: HIGHER Z is north (image top), lower X is west (image left). Confirmed against
    // the real, shipped, already-correct minimap (MinimapContainer.tsx's inter-square placement
    // and MapImageRenderer.ts's own per-square raster, both consumed un-flipped by the in-game
    // minimap feature): increasing world Z renders toward the top. An earlier pass through this
    // file inverted this based on camera-matrix math alone, which turned out to contradict the
    // shipped minimap and was reverted — the real orientation bug was in the flat/3d camera setup,
    // not here.
    const worldXLeft = x - tilesPerImage / 2;
    const worldXRight = worldXLeft + tilesPerImage;
    const worldZTop = z + tilesPerImage / 2;
    const worldZBottom = worldZTop - tilesPerImage;

    return {
        tilesPerImage,
        worldXLeft,
        worldXRight,
        worldZTop,
        worldZBottom,
        sqXStart: Math.floor(worldXLeft / MAP_SQUARE_SIZE),
        sqXEnd: Math.floor((worldXRight - 1) / MAP_SQUARE_SIZE),
        sqZStart: Math.floor(worldZBottom / MAP_SQUARE_SIZE),
        sqZEnd: Math.floor((worldZTop - 1) / MAP_SQUARE_SIZE),
    };
}

declare global {
    interface Window {
        __mapDump?: {
            ready: boolean;
            loadCache(): Promise<void>;
            setView(view: MapDumpView): void;
            /** True once every map square the camera currently needs has finished loading. */
            isSettled(): boolean;
            capture(): string | null;
            capture2d(view: Omit<MapDumpView, "mode"> & { shaded: boolean }): Promise<string | null>;
            captureOverlay(view: Omit<MapDumpView, "mode">): Promise<string | null>;
            hasData(view: {
                x: number;
                z: number;
                plane: number;
                zoom: number;
                kind: "landscape" | "objects";
            }): Promise<boolean>;
            getCrcSignature(view: { x: number; z: number; zoom: number }): SquareCrc[];
        };
    }
}

/** `MapImageRenderer`'s fixed `MAP_SCALE` — pixels per tile at its native resolution. */
const NATIVE_PX_PER_SQUARE = 4;
/** OSRS map squares are always 64x64 tiles. */
const MAP_SQUARE_SIZE = 64;

/**
 * True when an image has nothing worth keeping. A transparent pixel never counts as content —
 * for an opaque image (`treatBlackAsBlank: true`: 2d ground layers, flat/3d camera captures),
 * effectively-black ALSO doesn't count, since that's how a region the cache has no real color
 * data for renders (a technically-real but nothing-actually-built-there tile — see `hasData`'s
 * doc comment). The overlay layer (`treatBlackAsBlank: false`) is the opposite: its background is
 * transparent and real content (a wall line, or a map scene sprite that happens to be drawn in
 * black) is always opaque, so alpha alone already says whether something's there — applying the
 * black heuristic on top would wrongly treat an all-black map scene as empty.
 */
function isImageDataBlank(data: Uint8ClampedArray, treatBlackAsBlank: boolean): boolean {
    const BLACK_THRESHOLD = 4;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        if (!treatBlackAsBlank) return false;
        if (
            data[i] > BLACK_THRESHOLD ||
            data[i + 1] > BLACK_THRESHOLD ||
            data[i + 2] > BLACK_THRESHOLD
        ) {
            return false;
        }
    }
    return true;
}

/**
 * Stitches together whatever map squares a requested tile spans (at `MapImageRenderer`'s native
 * 4px/tile resolution), then crops and scales that composite down to the tile's exact zoom-level
 * bounds. Shared between `capture2d` (opaque ground+overlay) and `captureOverlay` (transparent,
 * overlay-only) — both are the same compositing problem, just fed different per-square images.
 * Returns null instead of a data URL when the result is blank (see `isImageDataBlank`).
 */
async function compositeTileFromSquares(
    squareCache: Map<string, ImageBitmap>,
    fetchSquareBlob: (sx: number, sz: number, plane: number) => Promise<Blob | undefined>,
    x: number,
    z: number,
    plane: number,
    zoom: number,
    treatBlackAsBlank: boolean,
): Promise<string | null> {
    const {
        tilesPerImage,
        worldXLeft,
        worldXRight,
        worldZTop,
        worldZBottom,
        sqXStart,
        sqXEnd,
        sqZStart,
        sqZEnd,
    } = getTouchedSquareRange(x, z, zoom);
    const pxPerSquareWanted = Math.pow(2, zoom);

    // Native-resolution (4px/tile) canvas big enough to cover every square the tile touches,
    // which we then crop and scale below — tiles don't generally align to square boundaries, so
    // this is simpler than stitching partial squares.
    const compositeWorldXLeft = sqXStart * MAP_SQUARE_SIZE;
    // North edge (higher Z — see the sign note in getTouchedSquareRange) of the northmost touched
    // square; pixelY=0 here. Z decreases as pixelY increases (south = down).
    const compositeWorldZTop = (sqZEnd + 1) * MAP_SQUARE_SIZE;
    const compositeTilesX = (sqXEnd - sqXStart + 1) * MAP_SQUARE_SIZE;
    const compositeTilesZ = (sqZEnd - sqZStart + 1) * MAP_SQUARE_SIZE;

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = compositeTilesX * NATIVE_PX_PER_SQUARE;
    compositeCanvas.height = compositeTilesZ * NATIVE_PX_PER_SQUARE;
    const compositeCtx = compositeCanvas.getContext("2d");
    if (!compositeCtx) throw new Error("Could not get 2d canvas context");

    for (let sx = sqXStart; sx <= sqXEnd; sx++) {
        for (let sz = sqZStart; sz <= sqZEnd; sz++) {
            const cacheKey = `${sx},${sz},${plane}`;
            let bitmap = squareCache.get(cacheKey);
            if (!bitmap) {
                const blob = await fetchSquareBlob(sx, sz, plane);
                if (!blob) continue;
                bitmap = await createImageBitmap(blob);
                squareCache.set(cacheKey, bitmap);
            }
            const drawX = (sx * MAP_SQUARE_SIZE - compositeWorldXLeft) * NATIVE_PX_PER_SQUARE;
            // MapImageRenderer's own native per-square image is already north-up (row 0 = max
            // tileY = max Z — see its `offset = (scene.sizeY - 1 - tileY) * width * 4`), matching
            // this composite's convention directly, so it's drawn as-is with no flip.
            const drawY = (compositeWorldZTop - (sz + 1) * MAP_SQUARE_SIZE) * NATIVE_PX_PER_SQUARE;
            compositeCtx.drawImage(bitmap, drawX, drawY);
        }
    }

    const cropX = (worldXLeft - compositeWorldXLeft) * NATIVE_PX_PER_SQUARE;
    const cropY = (compositeWorldZTop - worldZTop) * NATIVE_PX_PER_SQUARE;
    const cropSize = tilesPerImage * NATIVE_PX_PER_SQUARE;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = TILE_IMG_SIZE;
    outCanvas.height = TILE_IMG_SIZE;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) throw new Error("Could not get 2d canvas context");
    // Below native resolution (zoom < 2, i.e. requesting fewer than 4px/tile): downsampling,
    // smooth it. At/above native (zoom >= 2): don't blur a pixel-art source that has no more real
    // detail to give — blocky/crisp reads as "this is as zoomed in as this map style goes", same
    // as RuneLite's own dumper output does.
    outCtx.imageSmoothingEnabled = pxPerSquareWanted < NATIVE_PX_PER_SQUARE;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(compositeCanvas, cropX, cropY, cropSize, cropSize, 0, 0, TILE_IMG_SIZE, TILE_IMG_SIZE);

    const { data } = outCtx.getImageData(0, 0, TILE_IMG_SIZE, TILE_IMG_SIZE);
    if (isImageDataBlank(data, treatBlackAsBlank)) return null;

    return outCanvas.toDataURL("image/webp", 1.0);
}

/**
 * The renderer's concrete class isn't exported from `@openrune/map-viewer` (only the enum/type
 * pieces needed here are) — this narrows `viewer.renderer` to just the handful of quality knobs
 * the dumper needs, mirroring the existing `setMaxLevel` cast below.
 */
type RendererQualityControls = {
    setMaxLevel?: (v: number) => void;
    setSmoothTerrain?: (v: boolean) => void;
    setFlattenLighting?: (v: boolean) => void;
    setMsaa?: (v: boolean) => void;
    setFxaa?: (v: boolean) => void;
    textureFilterMode?: TextureFilterMode;
    mapManager?: { loadingMapIds: Set<number> };
};

let registered = false;
let workerPool: RenderDataWorkerPool | null = null;

function getWorkerPool(): RenderDataWorkerPool {
    if (!registered) {
        registerSerializer(renderDataLoaderSerializer);
        registered = true;
    }
    if (!workerPool) workerPool = RenderDataWorkerPool.create(4);
    return workerPool;
}

export function MapDumpClient(): JSX.Element {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapViewerRef = useRef<MapViewer | null>(null);
    // Keyed by "sx,sz,plane" — a map square's native-resolution image never changes within one
    // cache load, and adjacent output tiles (especially at low zoom, where many tiles share a
    // square, or high zoom, where one square covers many tiles) commonly need the same square.
    // Separate caches per layer since the same square coordinates mean different pixels (shaded
    // vs. flat-color ground fill, or overlay-only) between them.
    const squareImageCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
    const squareImageNormalCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
    const overlayImageCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        window.__mapDump = {
            ready: false,

            async loadCache() {
                console.log("[dump] probing dev cache");
                const devCache = await probeDevCache();
                if (!devCache) {
                    throw new Error(
                        "No dev cache available — set OPENRUNE_DEV_CACHE_DIR in .env.local",
                    );
                }
                console.log("[dump] fetching", devCache.files.length, "cache files over HTTP");
                const entries = await fetchDevCacheEntries(devCache.files);
                console.log("[dump] creating loaded cache");
                const cache = createLoadedCache(entries);

                console.log("[dump] checking renderers");
                const availableRenderers = getAvailableRenderers();
                console.log("[dump] available renderers", availableRenderers);
                if (availableRenderers.length === 0) {
                    throw new Error("No WebGL2/WebGPU renderer available");
                }
                console.log("[dump] opening map image cache");
                const mapImageCache = await caches.open("openrune-map-dump");

                console.log("[dump] creating worker pool");
                const pool = getWorkerPool();
                console.log("[dump] constructing MapViewer");
                const viewer = new MapViewer(
                    pool,
                    { caches: [cache.info], latest: cache.info },
                    [],
                    [],
                    mapImageCache,
                    availableRenderers[0],
                    cache,
                );
                // Needs real margin over the 3d camera's Z-drift (~130 world units at the current
                // height/pitch — see setView), not just the one tile's own span: the renderer
                // fades/culls geometry near the edge of this radius (see main.vert.glsl's fog,
                // based on distance from the camera's literal position, which drift deliberately
                // moves well away from what's actually framed) — too small a radius here was
                // pushing the far edge of a 3d capture's tile past the boundary, heavily fogging
                // or culling that side even though the content itself had loaded fine.
                viewer.renderDistance = 600;
                viewer.unloadDistance = 2;
                // Effectively "never": LOD swaps a map square to a simplified draw call (drops
                // decorative locs, keeps terrain) once it's `lodDistance` *map squares* (not
                // tiles) from the camera's square. The 3d mode's drift-compensated camera sits
                // outside the target square even for small tilts, so a low value here silently
                // dropped scenery objects in 3d renders while flat (camera stays in the target
                // square) kept them — a dump should always be full detail regardless.
                viewer.lodDistance = 999;
                // y=-1000: negative is up (see the sign note in `setView`) — placeholder, every
                // real capture goes through `setView` before `capture()`.
                viewer.camera = new Camera(3222, -1000, 3218, PITCH_FLAT, YAW_NORTH_UP);
                viewer.camera.setProjectionType(ProjectionType.ORTHO);
                const renderer = viewer.renderer as unknown as RendererQualityControls;
                // See the comment in `setView` — ground floor, no roofs, until told otherwise.
                renderer.setMaxLevel?.(0);
                // Ground-color blending between adjacent tiles' underlays (off by default in the
                // interactive viewer) and the highest anisotropic filtering + mipmapping the GPU
                // supports — both make dumped tiles hold up at higher zoom levels, where a flat
                // per-tile color/aliased texture otherwise looks visibly blocky.
                renderer.setSmoothTerrain?.(true);
                renderer.textureFilterMode = TextureFilterMode.ANISOTROPIC_16X;
                renderer.setMsaa?.(true);
                renderer.setFxaa?.(true);
                // NOT a generic atmospheric fog despite the name — main.vert.glsl fades geometry
                // in as a thin band approaching the *edge* of `renderDistance`, min(fogDepth,
                // renderDistance) wide, to hide the draw-distance cutoff popping in/out. Leaving
                // it at its small default (16) keeps that band thin; what actually needed fixing
                // was `renderDistance` itself not giving the drifted 3d camera's tile enough
                // margin before hitting that band at all (see the comment above it).
                console.log("[dump] calling viewer.init()");
                viewer.init();
                console.log("[dump] viewer.init() done");

                mapViewerRef.current = viewer;
                container.innerHTML = "";
                container.appendChild(viewer.renderer.canvas);
                console.log("[dump] calling renderer.init()");
                await viewer.renderer.init();
                console.log("[dump] renderer.init() done, starting");
                viewer.renderer.start();
                console.log("[dump] started");

                window.__mapDump!.ready = true;
            },

            setView({ x, z, plane, zoom, mode }) {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");

                // Roofs belong to the plane above the one they cap — loading/showing only up
                // through the viewed plane is what hides them (same as rsmv's own "level: 0
                // means ground floor and all roofs are hidden" config option).
                const renderer = viewer.renderer as unknown as RendererQualityControls;
                renderer.setMaxLevel?.(plane);
                // Flat is a true top-down silhouette view — slope-based "sunlight" shading there
                // just reads as unwanted depth. 3d is meant to look dimensional, so it keeps the
                // normal directional shading/shadows.
                renderer.setFlattenLighting?.(mode === "flat");

                const pxPerSquare = Math.pow(2, zoom);
                viewer.camera.orthoZoom = 2 * pxPerSquare;

                // Negative Y is UP in this engine's convention (confirmed by the vendor's own
                // "move up"/"move down" key handlers in MapViewerRenderer.ts, which subtract from
                // pos[1] to go up) — so this needs to be a large *negative* value to sit high
                // above the terrain, not positive (which would place the camera underground).
                // Used to be a much smaller 300 for 3d specifically (less Z-drift to compensate
                // for, back when the compensation below didn't exist yet) — but real OSRS terrain
                // elevation varies enough that 300 units of clearance isn't always enough: an area
                // built on a hill/plateau could put the camera at or below the actual ground
                // surface, rendering mostly black with just a sliver of real content visible
                // (confirmed by capturing the raw, pre-blank-check frame for one such tile).
                // Matching flat's generous 1000 fixes that; the Z-drift compensation below already
                // scales correctly with whatever height this is, so there's no accuracy tradeoff.
                const heightAboveTerrain = 1000;
                const pitch = mode === "flat" ? PITCH_FLAT : PITCH_3D;

                // This renderer's ortho camera only tilts (no projection-matrix shear), so unless
                // it's looking exactly straight down, the point it's centered on isn't directly
                // below the camera — it's offset along Z by `height * cot(pitch)` (yaw is always
                // kept north-up here, so there's never any X component to this). Independent of
                // `orthoZoom`/zoom level, so this keeps every zoom's tile centered on the same
                // (x, z) in both modes, not just flat (where the drift happens to be ~0 since
                // pitch is exactly vertical).
                const pitchRad = pitch * RS_TO_RADIANS;
                const zDrift = heightAboveTerrain * (Math.cos(pitchRad) / Math.sin(pitchRad));

                viewer.camera.pos[0] = x;
                viewer.camera.pos[1] = -heightAboveTerrain - plane * 240;
                viewer.camera.pos[2] = z - zDrift;
                viewer.camera.pitch = pitch;
                viewer.camera.yaw = YAW_NORTH_UP;
                viewer.camera.updated = true;
                viewer.camera.updatedPosition = true;
            },

            isSettled() {
                const viewer = mapViewerRef.current;
                if (!viewer) return false;
                const renderer = viewer.renderer as unknown as RendererQualityControls;
                // `loadingMapIds` is every map square currently in flight (fetched/queued but not
                // yet uploaded) — empty means the renderer has nothing left to stream in for
                // wherever the camera is currently pointed. Doesn't by itself guarantee the
                // *correct* squares were ever requested (a camera that never moved would also
                // read as "settled") — the dump script still does its own settle-time wait after
                // `setView` before polling this, to give the new position a moment to start
                // loading in the first place.
                return (renderer.mapManager?.loadingMapIds.size ?? 0) === 0;
            },

            capture() {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");

                // The WebGL canvas has no 2d context of its own (can't call getImageData on it
                // directly) — copy it onto a plain 2d canvas just to read pixels back for the
                // blank check below. Also rotated 180° here: this camera (yaw=YAW_NORTH_UP, pitched
                // down at the ground) renders upside down (both axes) relative to the real, shipped
                // minimap's north-up convention (confirmed by comparing a capture against
                // MapDumpClient's own 2d-shaded render of the same region, which matches the
                // minimap) — corrected here rather than in the vendored, shared-with-the-live-viewer
                // Camera class.
                const source = viewer.renderer.canvas;
                const probe = document.createElement("canvas");
                probe.width = source.width;
                probe.height = source.height;
                const probeCtx = probe.getContext("2d");
                if (!probeCtx) throw new Error("Could not get 2d canvas context");
                probeCtx.save();
                probeCtx.translate(probe.width, probe.height);
                probeCtx.scale(-1, -1);
                probeCtx.drawImage(source, 0, 0);
                probeCtx.restore();
                const { data } = probeCtx.getImageData(0, 0, probe.width, probe.height);
                if (isImageDataBlank(data, true)) return null;

                // Lossless-equivalent quality (1.0) — these are map tiles, not photos, so banding/
                // blur from lossy compression would be far more noticeable than the smaller files.
                return probe.toDataURL("image/webp", 1.0);
            },

            async capture2d({ x, z, plane, zoom, shaded }) {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");
                return compositeTileFromSquares(
                    shaded ? squareImageCacheRef.current : squareImageNormalCacheRef.current,
                    async (sx, sz, p) => {
                        // Walls/map scenes (real objects, like the real in-game map) stay on —
                        // only the small map-function icon overlay (bank/altar-style symbols) is
                        // exclusively an "overlay" layer thing (see `captureOverlay`).
                        const data = await viewer.workerPool.queueMapImage(
                            sx,
                            sz,
                            p,
                            false,
                            shaded,
                            true,
                        );
                        return data?.minimapBlob;
                    },
                    x,
                    z,
                    plane,
                    zoom,
                    true,
                );
            },

            async captureOverlay({ x, z, plane, zoom }) {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");
                return compositeTileFromSquares(
                    overlayImageCacheRef.current,
                    async (sx, sz, p) => {
                        const data = await viewer.workerPool.queueMapOverlayImage(sx, sz, p, true);
                        return data?.minimapBlob;
                    },
                    x,
                    z,
                    plane,
                    zoom,
                    false,
                );
            },

            async hasData({ x, z, plane, zoom, kind }) {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");

                const { worldXLeft, worldXRight, worldZTop, worldZBottom, sqXStart, sqXEnd, sqZStart, sqZEnd } =
                    getTouchedSquareRange(x, z, zoom);

                if (kind === "landscape") {
                    // A square's terrain archive covers all 4 planes at once, so archive
                    // existence alone misses the common case of e.g. an outdoor area with nothing
                    // built on plane 1+ — the archive exists (plane 0 has real tiles), but that
                    // specific plane doesn't, which otherwise renders as a blank/black image. This
                    // actually checks the plane's tiles within this exact tile's bounds (see
                    // `hasPlaneTiles` in RenderDataWorker.ts) — not the whole square, since at
                    // higher zooms one output tile only covers part of a square.
                    for (let sx = sqXStart; sx <= sqXEnd; sx++) {
                        for (let sz = sqZStart; sz <= sqZEnd; sz++) {
                            const found = await viewer.workerPool.queueHasPlaneTiles(
                                sx,
                                sz,
                                plane,
                                worldXLeft,
                                worldXRight,
                                worldZBottom,
                                worldZTop,
                            );
                            if (found) {
                                return true;
                            }
                        }
                    }
                    return false;
                }

                // "objects": cheap archive-existence check — the overlay layer is transparent
                // where empty rather than black, so it doesn't have the same wasted-black-image
                // problem landscape does.
                for (let sx = sqXStart; sx <= sqXEnd; sx++) {
                    for (let sz = sqZStart; sz <= sqZEnd; sz++) {
                        if (viewer.mapFileIndex.getLocArchiveId(sx, sz) !== -1) return true;
                    }
                }
                return false;
            },

            getCrcSignature({ x, z, zoom }) {
                const viewer = mapViewerRef.current;
                if (!viewer) throw new Error("Cache not loaded yet");

                // Plane-independent (archives cover all 4 planes), so this is the same signature
                // for every mode/plane at a given (x, z, zoom) — the manifest cache key this feeds
                // only needs computing once per tile position, not per output file.
                const { sqXStart, sqXEnd, sqZStart, sqZEnd } = getTouchedSquareRange(x, z, zoom);

                const squares: SquareCrc[] = [];
                for (let sx = sqXStart; sx <= sqXEnd; sx++) {
                    for (let sz = sqZStart; sz <= sqZEnd; sz++) {
                        squares.push({
                            sx,
                            sz,
                            terrainCrc: viewer.mapFileIndex.getTerrainArchiveCrc(sx, sz),
                            locCrc: viewer.mapFileIndex.getLocArchiveCrc(sx, sz),
                        });
                    }
                }
                return squares;
            },
        };

        return () => {
            window.__mapDump = undefined;
            mapViewerRef.current?.renderer.stop();
            mapViewerRef.current = null;
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{ width: TILE_IMG_SIZE, height: TILE_IMG_SIZE, background: "#000" }}
        />
    );
}
