/** Pixel size of every dumped tile image (`scripts/dump-map-tiles.mjs`'s `TILE_IMG_SIZE`). */
export const TILE_IMG_SIZE = 512;
/** OSRS map squares/regions are always 64x64 tiles. */
export const MAP_SQUARE_SIZE = 64;

/** The five styles `scripts/dump-map-tiles.mjs` bakes — "overlay" is a separate additive layer. */
export type MapLayerId = "flat" | "3d" | "2d-shaded" | "2d-normal";

const LAYER_DIR: Record<MapLayerId, string> = {
    flat: "satellite/flat",
    "3d": "satellite/3d",
    "2d-shaded": "2d/shaded",
    "2d-normal": "2d/normal",
};
const OVERLAY_DIR = "overlay";

/** `(regionX << 8) | regionZ` — the same id `MapFileIndex`/the dumper's zoom-3 tile names use. */
export function getRegionId(squareX: number, squareZ: number): number {
    return (squareX << 8) | squareZ;
}

export function regionIdToSquare(regionId: number): { squareX: number; squareZ: number } {
    return { squareX: regionId >> 8, squareZ: regionId & 0xff };
}

/** World tiles spanned by one 512px image at a given zoom (`pxPerSquare = 2^zoom`). */
export function tilesPerImageAt(zoom: number): number {
    return TILE_IMG_SIZE / Math.pow(2, zoom);
}

/**
 * Matches `dump-map-tiles.mjs`'s file naming exactly: the real OSRS region id at zoom 3 ("base",
 * one image per region), the generic tile-pyramid grid position everywhere else.
 */
export function getTileId(col: number, row: number, zoom: number): string {
    return tilesPerImageAt(zoom) === MAP_SQUARE_SIZE ? String(getRegionId(col, row)) : `${col}-${row}`;
}

export function getTileUrl(
    urlBase: string,
    dir: string,
    plane: number,
    zoom: number,
    tileId: string,
): string {
    return `${urlBase.replace(/\/+$/, "")}/${dir}/${plane}/${zoom}/${tileId}.webp`;
}

export type WorldCoord = { x: number; z: number };
export type ScreenCoord = { x: number; y: number };

export type DrawCallbackApi = {
    /** World tile coordinate -> canvas CSS-pixel coordinate (may land off-canvas). */
    worldToScreen(x: number, z: number): ScreenCoord;
    /** Current on-screen pixels per world tile — multiply a tile-space length by this for px. */
    pxPerTile: number;
    canvasWidth: number;
    canvasHeight: number;
};
export type DrawCallback = (ctx: CanvasRenderingContext2D, api: DrawCallbackApi) => void;

export type ImageMapSceneOptions = {
    urlBase: string;
    /** Initial center. Ignored (both axes) if `region` is given. Default 3222. */
    x?: number;
    /** Default 3218. */
    z?: number;
    /** Initial center as an OSRS region id instead of x/z. */
    region?: number;
    /** `pxPerSquare = 2^zoom`. Default 3 ("base", one image per region). */
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    plane?: number;
    layer?: MapLayerId;
    showOverlay?: boolean;
    showRegionGrid?: boolean;
    regionGridColor?: string;
    showRegionLabels?: boolean;
    onHoverCoords?: (coords: WorldCoord | null) => void;
    onRegionChange?: (regionId: number) => void;
    /** Only for real failures — a 404 (region genuinely has no tile) is expected and silent. */
    onTileError?: (url: string, error: unknown) => void;
};

type TileCacheEntry =
    | { status: "loading" }
    | { status: "loaded"; bitmap: ImageBitmap }
    | { status: "error" }
    | { status: "missing" };

const MAX_CACHED_TILES = 400;
const ZOOM_LERP_PER_MS = 0.012;
const ZOOM_EPSILON = 0.002;

/**
 * A pannable/zoomable canvas over the baked map tiles from `scripts/dump-map-tiles.mjs` —
 * everything `<ImageRSMapViewer>` does, with no React in it. Owns its own render loop like
 * `RSModelScene` does, so panning/zooming stays smooth independent of React's render cycle.
 *
 * Draws the chosen base `layer`, the transparent `overlay` layer on top of it when enabled, then
 * an optional region grid/labels, then any callbacks registered via `addDrawCallback` — in that
 * order, every frame.
 */
export class ImageMapScene {
    private readonly ctx: CanvasRenderingContext2D;

    private urlBase: string;
    private plane: number;
    private layer: MapLayerId;
    private showOverlay: boolean;
    private showRegionGrid: boolean;
    private regionGridColor: string;
    private showRegionLabels: boolean;
    private minZoom: number;
    private maxZoom: number;

    private centerX: number;
    private centerZ: number;
    /** Display zoom — animates toward `targetZoom` for a smooth, Leaflet-style zoom transition. */
    private zoom: number;
    private targetZoom: number;
    private lastRegionId: number | null = null;

    private readonly tileCache = new Map<string, TileCacheEntry>();
    private readonly drawCallbacks = new Map<string, DrawCallback>();

    private cssWidth = 0;
    private cssHeight = 0;

    private rafId: number | null = null;
    private lastTime: number | null = null;
    private disposed = false;

    private controlled: HTMLElement | null = null;
    private drag: { startScreenX: number; startScreenY: number; startCenterX: number; startCenterZ: number } | null =
        null;

    private readonly onHoverCoords: ((coords: WorldCoord | null) => void) | undefined;
    private readonly onRegionChange: ((regionId: number) => void) | undefined;
    private readonly onTileError: ((url: string, error: unknown) => void) | undefined;

    constructor(
        readonly canvas: HTMLCanvasElement,
        options: ImageMapSceneOptions,
    ) {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get 2d canvas context");
        this.ctx = ctx;

        this.urlBase = options.urlBase;
        this.plane = options.plane ?? 0;
        this.layer = options.layer ?? "2d-shaded";
        this.showOverlay = options.showOverlay ?? true;
        this.showRegionGrid = options.showRegionGrid ?? false;
        this.regionGridColor = options.regionGridColor ?? "rgba(255, 255, 255, 0.35)";
        this.showRegionLabels = options.showRegionLabels ?? false;
        this.minZoom = options.minZoom ?? 0;
        this.maxZoom = options.maxZoom ?? 9;

        if (options.region !== undefined) {
            const { squareX, squareZ } = regionIdToSquare(options.region);
            this.centerX = squareX * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2;
            this.centerZ = squareZ * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2;
        } else {
            this.centerX = options.x ?? 3222;
            this.centerZ = options.z ?? 3218;
        }
        this.zoom = this.targetZoom = options.zoom ?? 3;

        this.onHoverCoords = options.onHoverCoords;
        this.onRegionChange = options.onRegionChange;
        this.onTileError = options.onTileError;

        this.attachControls(canvas);
        this.start();
    }

    // ---- Public API ---------------------------------------------------------------

    goToTile(x: number, z: number, opts: { zoom?: number; animate?: boolean } = {}): void {
        this.centerX = x;
        this.centerZ = z;
        if (opts.zoom !== undefined) this.setZoomInternal(opts.zoom, opts.animate ?? true);
    }

    goToRegion(squareX: number, squareZ: number, opts: { zoom?: number; animate?: boolean } = {}): void {
        this.goToTile(
            squareX * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2,
            squareZ * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2,
            opts,
        );
    }

    setZoom(zoom: number, opts: { animate?: boolean } = {}): void {
        this.setZoomInternal(zoom, opts.animate ?? true);
    }

    setPlane(plane: number): void {
        this.plane = plane;
    }

    setLayer(layer: MapLayerId): void {
        this.layer = layer;
    }

    setShowOverlay(show: boolean): void {
        this.showOverlay = show;
    }

    setShowRegionGrid(show: boolean): void {
        this.showRegionGrid = show;
    }

    setRegionGridColor(color: string): void {
        this.regionGridColor = color;
    }

    setShowRegionLabels(show: boolean): void {
        this.showRegionLabels = show;
    }

    setUrlBase(urlBase: string): void {
        this.urlBase = urlBase;
        this.tileCache.clear();
    }

    /** Registered callbacks run every frame, after the map/grid/labels, in insertion order. */
    addDrawCallback(id: string, fn: DrawCallback): void {
        this.drawCallbacks.set(id, fn);
    }

    removeDrawCallback(id: string): void {
        this.drawCallbacks.delete(id);
    }

    // Z increases northward on screen (decreasing Y is screen-down), matching the real, shipped
    // minimap (MinimapContainer.tsx's inter-square placement and MapImageRenderer.ts's own raster,
    // both consumed un-flipped by the in-game minimap) — increasing world Z renders toward the
    // top. An earlier pass had this inverted based on camera-matrix math alone, which turned out
    // to contradict the shipped minimap and was reverted.
    worldToScreen = (x: number, z: number): ScreenCoord => {
        const px = this.pxPerTile();
        return {
            x: this.cssWidth / 2 + (x - this.centerX) * px,
            y: this.cssHeight / 2 - (z - this.centerZ) * px,
        };
    };

    screenToWorld(screenX: number, screenY: number): WorldCoord {
        const px = this.pxPerTile();
        return {
            x: this.centerX + (screenX - this.cssWidth / 2) / px,
            z: this.centerZ - (screenY - this.cssHeight / 2) / px,
        };
    }

    getCenter(): WorldCoord {
        return { x: this.centerX, z: this.centerZ };
    }

    getZoom(): number {
        return this.targetZoom;
    }

    private pxPerTile(): number {
        return Math.pow(2, this.zoom);
    }

    // ---- Sizing ---------------------------------------------------------------

    resize(width: number, height: number, pixelRatio = 1): void {
        this.cssWidth = width;
        this.cssHeight = height;
        this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
        this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
        this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    /** Keeps the canvas sized to an element. Returns the stop function. */
    observe(element: HTMLElement): () => void {
        const doResize = (): void => {
            const rect = element.getBoundingClientRect();
            this.resize(rect.width, rect.height, window.devicePixelRatio || 1);
        };
        doResize();
        const observer = new ResizeObserver(doResize);
        observer.observe(element);
        return () => observer.disconnect();
    }

    // ---- Controls ---------------------------------------------------------------

    attachControls(element: HTMLElement): void {
        this.detachControls();
        this.controlled = element;
        element.addEventListener("pointerdown", this.onPointerDown);
        element.addEventListener("pointermove", this.onPointerMove);
        element.addEventListener("pointerup", this.onPointerUp);
        element.addEventListener("pointercancel", this.onPointerUp);
        element.addEventListener("pointerleave", this.onPointerLeave);
        element.addEventListener("wheel", this.onWheel, { passive: false });
    }

    detachControls(): void {
        if (!this.controlled) return;
        const element = this.controlled;
        element.removeEventListener("pointerdown", this.onPointerDown);
        element.removeEventListener("pointermove", this.onPointerMove);
        element.removeEventListener("pointerup", this.onPointerUp);
        element.removeEventListener("pointercancel", this.onPointerUp);
        element.removeEventListener("pointerleave", this.onPointerLeave);
        element.removeEventListener("wheel", this.onWheel);
        this.controlled = null;
    }

    private onPointerDown = (e: PointerEvent): void => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const { x, y } = this.eventPos(e);
        this.drag = { startScreenX: x, startScreenY: y, startCenterX: this.centerX, startCenterZ: this.centerZ };
    };

    private onPointerMove = (e: PointerEvent): void => {
        const { x, y } = this.eventPos(e);
        if (this.drag) {
            const px = this.pxPerTile();
            this.centerX = this.drag.startCenterX - (x - this.drag.startScreenX) / px;
            this.centerZ = this.drag.startCenterZ + (y - this.drag.startScreenY) / px;
        } else {
            this.onHoverCoords?.(this.screenToWorld(x, y));
        }
    };

    private onPointerUp = (e: PointerEvent): void => {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        this.drag = null;
    };

    private onPointerLeave = (): void => {
        this.drag = null;
        this.onHoverCoords?.(null);
    };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const { x: cursorX, y: cursorY } = this.eventPos(e);
        const worldAtCursor = this.screenToWorld(cursorX, cursorY);

        const nextZoom = clamp(this.targetZoom - e.deltaY * 0.0022, this.minZoom, this.maxZoom);
        this.targetZoom = nextZoom;
        const nextPx = Math.pow(2, nextZoom);
        // Keep the point under the cursor fixed, computed against the target zoom — the display
        // zoom then eases toward it over the next few frames (see `advanceZoom`).
        this.centerX = worldAtCursor.x - (cursorX - this.cssWidth / 2) / nextPx;
        this.centerZ = worldAtCursor.z + (cursorY - this.cssHeight / 2) / nextPx;
    };

    private eventPos(e: PointerEvent | WheelEvent): ScreenCoord {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private setZoomInternal(zoom: number, animate: boolean): void {
        this.targetZoom = clamp(zoom, this.minZoom, this.maxZoom);
        if (!animate) this.zoom = this.targetZoom;
    }

    // ---- Tiles ---------------------------------------------------------------

    private requestTile(url: string): TileCacheEntry {
        const cached = this.tileCache.get(url);
        if (cached) return cached;

        const entry: TileCacheEntry = { status: "loading" };
        this.tileCache.set(url, entry);
        this.evictIfNeeded();

        fetch(url)
            .then((res) => {
                if (res.status === 404) {
                    this.tileCache.set(url, { status: "missing" });
                    return null;
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.blob();
            })
            .then((blob) => (blob ? createImageBitmap(blob) : null))
            .then((bitmap) => {
                if (this.disposed) {
                    bitmap?.close();
                    return;
                }
                if (bitmap) this.tileCache.set(url, { status: "loaded", bitmap });
            })
            .catch((err) => {
                if (this.disposed) return;
                this.tileCache.set(url, { status: "error" });
                this.onTileError?.(url, err);
            });

        return entry;
    }

    private evictIfNeeded(): void {
        if (this.tileCache.size <= MAX_CACHED_TILES) return;
        // Map iteration is insertion order — drop the oldest entries first (simple FIFO, not a
        // true LRU, but cheap and good enough for a tile cache that mostly scrolls one direction
        // at a time).
        const toDrop = this.tileCache.size - MAX_CACHED_TILES;
        let dropped = 0;
        for (const [url, entry] of this.tileCache) {
            if (dropped >= toDrop) break;
            if (entry.status === "loaded") entry.bitmap.close();
            this.tileCache.delete(url);
            dropped++;
        }
    }

    // ---- Render loop ---------------------------------------------------------------

    dispose(): void {
        this.disposed = true;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.detachControls();
        for (const entry of this.tileCache.values()) {
            if (entry.status === "loaded") entry.bitmap.close();
        }
        this.tileCache.clear();
    }

    private start(): void {
        const tick = (now: number): void => {
            if (this.disposed) return;
            this.advanceZoom(now);
            this.render();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private advanceZoom(now: number): void {
        const dt = this.lastTime === null ? 16 : now - this.lastTime;
        this.lastTime = now;
        const diff = this.targetZoom - this.zoom;
        if (Math.abs(diff) < ZOOM_EPSILON) {
            this.zoom = this.targetZoom;
            return;
        }
        const t = Math.min(1, dt * ZOOM_LERP_PER_MS);
        this.zoom += diff * t;
    }

    private render(): void {
        const { ctx, cssWidth, cssHeight } = this;
        if (cssWidth === 0 || cssHeight === 0) return;

        // Filled black rather than cleared transparent — the background behind unloaded/missing
        // tiles should always read as black, regardless of whatever's behind the canvas in the
        // page (dark theme or not).
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        const tileZoom = clamp(Math.round(this.zoom), this.minZoom, this.maxZoom);
        const tilesPerImage = tilesPerImageAt(tileZoom);
        const effectivePx = this.pxPerTile();
        const drawSize = tilesPerImage * effectivePx;

        const halfTilesX = cssWidth / 2 / effectivePx;
        const halfTilesZ = cssHeight / 2 / effectivePx;
        const colMin = Math.floor((this.centerX - halfTilesX) / tilesPerImage);
        const colMax = Math.floor((this.centerX + halfTilesX) / tilesPerImage);
        const rowMin = Math.floor((this.centerZ - halfTilesZ) / tilesPerImage);
        const rowMax = Math.floor((this.centerZ + halfTilesZ) / tilesPerImage);

        ctx.imageSmoothingEnabled = effectivePx < Math.pow(2, tileZoom);

        for (let row = rowMin; row <= rowMax; row++) {
            for (let col = colMin; col <= colMax; col++) {
                const tileId = getTileId(col, row, tileZoom);
                // The tile's NW (top-left on screen) corner: west edge = col*tilesPerImage,
                // north edge = (row+1)*tilesPerImage (higher Z is north/up — see worldToScreen).
                const nw = this.worldToScreen(col * tilesPerImage, (row + 1) * tilesPerImage);

                const baseUrl = getTileUrl(this.urlBase, LAYER_DIR[this.layer], this.plane, tileZoom, tileId);
                this.drawTile(baseUrl, nw.x, nw.y, drawSize);

                if (this.showOverlay) {
                    const overlayUrl = getTileUrl(this.urlBase, OVERLAY_DIR, this.plane, tileZoom, tileId);
                    this.drawTile(overlayUrl, nw.x, nw.y, drawSize);
                }
            }
        }

        if (this.showRegionGrid) this.renderRegionGrid();
        if (this.showRegionLabels) this.renderRegionLabels();

        for (const draw of this.drawCallbacks.values()) {
            draw(ctx, {
                worldToScreen: this.worldToScreen,
                pxPerTile: effectivePx,
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
            });
        }

        this.reportRegionChange();
    }

    private drawTile(url: string, screenX: number, screenY: number, size: number): void {
        // Skip work for tiles fully outside the canvas (the grid loop already has a small margin
        // built in from the half-tile math, but a touch of slack avoids edge flicker while panning).
        if (screenX + size < -size || screenX > this.cssWidth + size) return;
        if (screenY + size < -size || screenY > this.cssHeight + size) return;

        const entry = this.requestTile(url);
        if (entry.status === "loaded") {
            this.ctx.drawImage(entry.bitmap, screenX, screenY, size, size);
        }
    }

    private renderRegionGrid(): void {
        const { ctx, cssWidth, cssHeight } = this;
        const px = this.pxPerTile();
        const halfTilesX = cssWidth / 2 / px;
        const halfTilesZ = cssHeight / 2 / px;
        const xStart = Math.floor((this.centerX - halfTilesX) / MAP_SQUARE_SIZE) * MAP_SQUARE_SIZE;
        const xEnd = this.centerX + halfTilesX;
        const zStart = Math.floor((this.centerZ - halfTilesZ) / MAP_SQUARE_SIZE) * MAP_SQUARE_SIZE;
        const zEnd = this.centerZ + halfTilesZ;

        ctx.save();
        ctx.strokeStyle = this.regionGridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = xStart; x <= xEnd; x += MAP_SQUARE_SIZE) {
            const sx = Math.round(this.worldToScreen(x, 0).x) + 0.5;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, cssHeight);
        }
        for (let z = zStart; z <= zEnd; z += MAP_SQUARE_SIZE) {
            const sy = Math.round(this.worldToScreen(0, z).y) + 0.5;
            ctx.moveTo(0, sy);
            ctx.lineTo(cssWidth, sy);
        }
        ctx.stroke();
        ctx.restore();
    }

    private renderRegionLabels(): void {
        const { ctx, cssWidth, cssHeight } = this;
        const px = this.pxPerTile();
        const halfTilesX = cssWidth / 2 / px;
        const halfTilesZ = cssHeight / 2 / px;
        const sqXMin = Math.floor((this.centerX - halfTilesX) / MAP_SQUARE_SIZE);
        const sqXMax = Math.floor((this.centerX + halfTilesX) / MAP_SQUARE_SIZE);
        const sqZMin = Math.floor((this.centerZ - halfTilesZ) / MAP_SQUARE_SIZE);
        const sqZMax = Math.floor((this.centerZ + halfTilesZ) / MAP_SQUARE_SIZE);

        ctx.save();
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.lineWidth = 3;
        for (let sx = sqXMin; sx <= sqXMax; sx++) {
            for (let sz = sqZMin; sz <= sqZMax; sz++) {
                const center = this.worldToScreen(
                    sx * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2,
                    sz * MAP_SQUARE_SIZE + MAP_SQUARE_SIZE / 2,
                );
                const label = String(getRegionId(sx, sz));
                ctx.strokeText(label, center.x, center.y);
                ctx.fillText(label, center.x, center.y);
            }
        }
        ctx.restore();
    }

    private reportRegionChange(): void {
        if (!this.onRegionChange) return;
        const squareX = Math.floor(this.centerX / MAP_SQUARE_SIZE);
        const squareZ = Math.floor(this.centerZ / MAP_SQUARE_SIZE);
        const regionId = getRegionId(squareX, squareZ);
        if (regionId !== this.lastRegionId) {
            this.lastRegionId = regionId;
            this.onRegionChange(regionId);
        }
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
