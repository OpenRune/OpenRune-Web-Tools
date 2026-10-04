import { CacheInfo } from "../../rs/cache/CacheInfo";
import { MapImageRenderer } from "../../rs/map/MapImageRenderer";
import { Scene } from "../../rs/scene/Scene";

export type MinimapData = {
    mapX: number;
    mapY: number;
    level: number;
    cacheInfo: CacheInfo;

    minimapBlob: Blob;
};

async function pixelsToBlob(
    pixels: Int32Array,
    scene: Scene,
    borderSize: number,
    transparent: boolean,
): Promise<Blob> {
    const view = new DataView(pixels.buffer);
    for (let i = 0; i < pixels.length; i++) {
        const rgb = pixels[i];
        // `MapImageRenderer.UNTOUCHED_PIXEL` (-1) marks "nothing drawn here" — distinct from a
        // legitimately black (0x000000) pixel, which a wall line or map scene sprite can produce
        // and which must stay opaque.
        const isUntouched = transparent && rgb === MapImageRenderer.UNTOUCHED_PIXEL;
        const alpha = isUntouched ? 0x00 : 0xff;
        const outRgb = isUntouched ? 0 : rgb;
        view.setUint32(i * 4, (outRgb << 8) | alpha);
    }

    const widthExclBorder = (scene.sizeX - borderSize * 2) * 4;
    const heightExclBorder = (scene.sizeY - borderSize * 2) * 4;
    const canvas = new OffscreenCanvas(widthExclBorder, heightExclBorder);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Could not get canvas context");
    }

    const pixelWidth = scene.sizeX * 4;
    const pixelHeight = scene.sizeY * 4;
    const imageData = new ImageData(pixelWidth, pixelHeight);
    imageData.data.set(new Uint8ClampedArray(pixels.buffer));

    ctx.putImageData(imageData, -borderSize * 4, -borderSize * 4);

    return canvas.convertToBlob();
}

/**
 * The flat per-square map image, same technique as RuneLite's `MapImageDumper.java` (see
 * `rs/map/MapImageRenderer.ts`'s doc comment). `shaded` picks between the gouraud/"HD" in-game
 * world-map style (`renderMinimapHd`, per-vertex directional shading) and the classic flat-color
 * style (`renderMinimap`, solid per-tile underlay/overlay colors, no shading) — the latter has no
 * map-function-icon support, so `drawMapFunctions` is only honored when `shaded` is true.
 * `renderLocs` defaults true (matching this engine's own in-game minimap, which always shows
 * walls/map scenes) — pass false to get a ground-only image, e.g. when scenes/functions/lines are
 * being composited separately via `loadMapOverlayBlob`'s own transparent layer.
 */
export async function loadMinimapBlob(
    mapImageRenderer: MapImageRenderer,
    scene: Scene,
    level: number,
    borderSize: number,
    drawMapFunctions: boolean,
    shaded: boolean = true,
    renderLocs: boolean = true,
): Promise<Blob> {
    const pixels = shaded
        ? mapImageRenderer.renderMinimapHd(scene, level, drawMapFunctions, true, renderLocs)
        : mapImageRenderer.renderMinimap(scene, level, renderLocs);

    return pixelsToBlob(pixels, scene, borderSize, false);
}

/**
 * Same per-square flat map image as `loadMinimapBlob`, but with the ground-color fill skipped
 * (`renderGround: false`) and a transparent background instead of the opaque one `loadMinimapBlob`
 * always forces — meant to be composited as its own layer over any of the other map render
 * styles. `renderMinimapHd` pre-fills with `MapImageRenderer.UNTOUCHED_PIXEL` whenever
 * `renderGround` is false specifically so this can tell "nothing drawn here" apart from a
 * legitimately black (0x000000) wall line or map scene sprite pixel — `pixelsToBlob` turns that
 * sentinel into alpha 0 and leaves every real pixel (black ones included) opaque.
 */
export async function loadMapOverlayBlob(
    mapImageRenderer: MapImageRenderer,
    scene: Scene,
    level: number,
    borderSize: number,
    drawMapFunctions: boolean,
): Promise<Blob> {
    const pixels = mapImageRenderer.renderMinimapHd(scene, level, drawMapFunctions, false);
    return pixelsToBlob(pixels, scene, borderSize, true);
}
