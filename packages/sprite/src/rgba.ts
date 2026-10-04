import { type IndexedSprite, normalizeIndexedSprite } from "./sprite-format";

export type SpriteRgba = {
    width: number;
    height: number;
    /** width*height*4 bytes, ready for `new ImageData(rgba, width, height)`. */
    rgba: Uint8ClampedArray;
};

/** Renders a frame's own pixel block as-is (not placed on the shared sheet). */
export function indexedSpriteFrameToRgba(sprite: IndexedSprite): SpriteRgba {
    const { subWidth: width, subHeight: height, pixels, palette } = sprite;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) {
        const value = pixels[i];
        if (value === 0) continue;
        const rgb = palette[value];
        rgba[i * 4] = (rgb >> 16) & 0xff;
        rgba[i * 4 + 1] = (rgb >> 8) & 0xff;
        rgba[i * 4 + 2] = rgb & 0xff;
        rgba[i * 4 + 3] = 255;
    }
    return { width, height, rgba };
}

/** Renders the frame normalized onto the full shared sheet canvas. */
export function indexedSpriteToRgba(sprite: IndexedSprite): SpriteRgba {
    return indexedSpriteFrameToRgba(normalizeIndexedSprite(sprite));
}
