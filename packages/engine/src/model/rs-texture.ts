/** Side length of every texture layer uploaded to the renderer's texture array. */
export const RS_TEXTURE_SIZE = 128;

/** A rasterized, RS_TEXTURE_SIZE x RS_TEXTURE_SIZE RGBA texture; `null` renders as fully transparent. */
export type RSTextureLayer = {
    data: Uint8Array | Uint8ClampedArray;
} | null;
