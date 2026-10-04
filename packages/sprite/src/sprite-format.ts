import { ByteReader } from "./byte-reader";

/**
 * One frame of a decoded sprite. `subWidth/subHeight` is this frame's own pixel block;
 * `width/height` is the shared sheet size (frames in the same archive all share one);
 * `xOffset/yOffset` is this frame's placement within that shared sheet.
 */
export type IndexedSprite = {
    pixels: Uint8Array;
    /** Packed 0xRRGGBB per palette index; index 0 is unused (pixel value 0 always means "transparent"). */
    palette: Int32Array;
    subWidth: number;
    subHeight: number;
    xOffset: number;
    yOffset: number;
    width: number;
    height: number;
};

function readPixels(buffer: ByteReader, width: number, height: number): Uint8Array {
    const pixelCount = width * height;
    const pixels = new Uint8Array(pixelCount);
    const layout = buffer.readUnsignedByte(); // 0 = row-major, 1 = column-major
    if (layout === 0) {
        for (let i = 0; i < pixelCount; i++) pixels[i] = buffer.readByte();
    } else {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                pixels[x + y * width] = buffer.readByte();
            }
        }
    }
    return pixels;
}

/**
 * Decodes a dat2 packed-sprite-sheet archive (`IndexType.DAT2.sprites`): N frames sharing one
 * canvas size and palette, laid out footer-first so the pixel data can stream from offset 0.
 */
export function decodeSpriteSheet(id: number, data: ArrayBuffer | Uint8Array): IndexedSprite[] {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < 2) throw new Error(`Sprite ${id}: only ${bytes.length} bytes`);

    const buffer = new ByteReader(bytes);

    buffer.offset = bytes.length - 2;
    const spriteCount = buffer.readUnsignedShort();

    buffer.offset = bytes.length - 7 - spriteCount * 8;
    const width = buffer.readUnsignedShort();
    const height = buffer.readUnsignedShort();
    const paletteSize = buffer.readUnsignedByte() + 1;

    const xOffsets = new Int32Array(spriteCount);
    const yOffsets = new Int32Array(spriteCount);
    const widths = new Int32Array(spriteCount);
    const heights = new Int32Array(spriteCount);
    for (let i = 0; i < spriteCount; i++) xOffsets[i] = buffer.readUnsignedShort();
    for (let i = 0; i < spriteCount; i++) yOffsets[i] = buffer.readUnsignedShort();
    for (let i = 0; i < spriteCount; i++) widths[i] = buffer.readUnsignedShort();
    for (let i = 0; i < spriteCount; i++) heights[i] = buffer.readUnsignedShort();

    buffer.offset = bytes.length - 7 - spriteCount * 8 - (paletteSize - 1) * 3;
    const palette = new Int32Array(paletteSize);
    for (let i = 1; i < paletteSize; i++) {
        palette[i] = buffer.readMedium();
        // A palette entry that happens to decode to black (0x000000) is indistinguishable from
        // "unused" — bump it to the nearest non-zero so pixel value 0 unambiguously means transparent.
        if (palette[i] === 0) palette[i] = 1;
    }

    buffer.offset = 0;
    const sprites: IndexedSprite[] = [];
    for (let i = 0; i < spriteCount; i++) {
        sprites.push({
            pixels: readPixels(buffer, widths[i], heights[i]),
            palette,
            subWidth: widths[i],
            subHeight: heights[i],
            xOffset: xOffsets[i],
            yOffset: yOffsets[i],
            width,
            height,
        });
    }
    return sprites;
}

/**
 * Decodes one sprite from the legacy `index.dat`-table convention used inside jag archives
 * (pre-234 "legacy" caches and 234-409 "dat" caches share this inner sprite encoding).
 * `offset` selects which table-of-contents entry this data file corresponds to.
 */
export function decodeIndexDatSprite(
    dataBytes: ArrayBuffer | Uint8Array,
    indexBytes: ArrayBuffer | Uint8Array,
    offset: number,
): IndexedSprite {
    const dataBuffer = new ByteReader(dataBytes);
    const indexBuffer = new ByteReader(indexBytes);

    indexBuffer.offset = dataBuffer.readUnsignedShort();

    const width = indexBuffer.readUnsignedShort();
    const height = indexBuffer.readUnsignedShort();
    const paletteSize = indexBuffer.readUnsignedByte();
    const palette = new Int32Array(paletteSize);
    for (let i = 0; i < paletteSize - 1; i++) palette[i + 1] = indexBuffer.readMedium();

    for (let i = 0; i < offset; i++) {
        indexBuffer.offset += 2;
        dataBuffer.offset += indexBuffer.readUnsignedShort() * indexBuffer.readUnsignedShort();
        indexBuffer.offset += 1;
    }

    const xOffset = indexBuffer.readUnsignedByte();
    const yOffset = indexBuffer.readUnsignedByte();
    const subWidth = indexBuffer.readUnsignedShort();
    const subHeight = indexBuffer.readUnsignedShort();

    const layout = indexBuffer.readUnsignedByte();
    const pixelCount = subWidth * subHeight;
    const pixels = new Uint8Array(pixelCount);
    if (layout === 0) {
        for (let i = 0; i < pixelCount; i++) pixels[i] = dataBuffer.readByte();
    } else {
        for (let x = 0; x < subWidth; x++) {
            for (let y = 0; y < subHeight; y++) {
                pixels[x + y * subWidth] = dataBuffer.readByte();
            }
        }
    }

    return { pixels, palette, subWidth, subHeight, xOffset, yOffset, width, height };
}

/** Places a frame's own `subWidth x subHeight` pixels onto the full shared sheet canvas. */
export function normalizeIndexedSprite(sprite: IndexedSprite): IndexedSprite {
    if (sprite.subWidth === sprite.width && sprite.subHeight === sprite.height) return sprite;

    const pixels = new Uint8Array(sprite.width * sprite.height);
    let index = 0;
    for (let y = 0; y < sprite.subHeight; y++) {
        for (let x = 0; x < sprite.subWidth; x++) {
            pixels[x + (y + sprite.yOffset) * sprite.width + sprite.xOffset] =
                sprite.pixels[index++];
        }
    }

    return {
        ...sprite,
        pixels,
        subWidth: sprite.width,
        subHeight: sprite.height,
        xOffset: 0,
        yOffset: 0,
    };
}
