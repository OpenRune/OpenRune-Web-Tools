import { type CacheSystem, IndexType } from "@openrune/cache";
import {
    type IndexedSprite,
    type SpriteRgba,
    decodeSpriteSheet,
    indexedSpriteFrameToRgba,
} from "@openrune/sprite";

/** Gap between frames when a whole sheet is laid out side by side, in pixels. */
const STRIP_GAP = 2;

/** Reads and decodes one sprite archive out of a cache. An archive holds one or more frames. */
export function loadSprite(cache: CacheSystem, id: number): IndexedSprite[] {
    if (!cache.indexExists(IndexType.DAT2.sprites)) {
        throw new Error("This cache has no sprites index (main_file_cache.idx8)");
    }
    const file = cache.getIndex(IndexType.DAT2.sprites).getFile(id, 0);
    if (!file) throw new Error(`Sprite archive ${id} not found in cache`);
    return decodeSpriteSheet(
        id,
        new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength),
    );
}

/** Lays every frame's own pixels out in one horizontal strip, like a film strip. */
export function spriteFramesToStrip(frames: IndexedSprite[]): SpriteRgba {
    const rendered = frames.map(indexedSpriteFrameToRgba);
    const width =
        rendered.reduce((sum, f) => sum + f.width, 0) +
        STRIP_GAP * Math.max(0, rendered.length - 1);
    const height = Math.max(1, ...rendered.map((f) => f.height));

    const rgba = new Uint8ClampedArray(width * height * 4);
    let x = 0;
    for (const frame of rendered) {
        for (let y = 0; y < frame.height; y++) {
            const from = y * frame.width * 4;
            rgba.set(frame.rgba.subarray(from, from + frame.width * 4), (y * width + x) * 4);
        }
        x += frame.width + STRIP_GAP;
    }
    return { width, height, rgba };
}

/** One frame's pixels, or all of them side by side. */
export function spriteToRgba(frames: IndexedSprite[], frame: number | "all"): SpriteRgba {
    if (frame === "all") return spriteFramesToStrip(frames);
    const one = frames[frame];
    if (!one) throw new Error(`This sprite has no frame ${frame} (it has ${frames.length})`);
    return indexedSpriteFrameToRgba(one);
}

/** What a binary archive turned out to hold, going by its first few bytes. */
export type BinaryKind = "jpeg" | "png" | "gif" | "webp" | "unknown";

/** Media types for the kinds that have one, so the bytes can go straight into a `Blob`. */
const MEDIA_TYPES: Record<Exclude<BinaryKind, "unknown">, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
};

export function binaryMediaType(kind: BinaryKind): string | null {
    return kind === "unknown" ? null : MEDIA_TYPES[kind];
}

/**
 * What a blob of bytes is, from its magic number.
 *
 * The binary index is a grab-bag — login backgrounds, the huffman chat table, whatever a server
 * has added — so there's nothing but the bytes to go on.
 */
export function sniffBinary(bytes: Uint8Array): BinaryKind {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return "png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return "gif";
    // "RIFF" .... "WEBP"
    if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return "webp";
    }
    return "unknown";
}

/** Reads one file out of the cache's binary index. Most archives there hold a single file. */
export function loadBinary(cache: CacheSystem, id: number, fileId = 0): Uint8Array {
    if (!cache.indexExists(IndexType.DAT2.binary)) {
        throw new Error("This cache has no binary index (main_file_cache.idx10)");
    }
    const file = cache.getIndex(IndexType.DAT2.binary).getFile(id, fileId);
    if (!file) throw new Error(`Archive ${id} not found in the binary index`);
    return new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength);
}

/** The first `length` bytes as hex, for showing something useful about an unrecognised file. */
export function toHexPreview(bytes: Uint8Array, length = 64): string {
    return Array.from(bytes.subarray(0, length))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
}
