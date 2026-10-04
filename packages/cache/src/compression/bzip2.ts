import * as bzip2 from "bzip2";

/** The library expects a full bzip2 stream; the cache strips this 4-byte header to save space. */
const BZIP2_HEADER = new Uint8Array("BZh1".split("").map((char) => char.charCodeAt(0)));

export function bzip2Decompress(compressed: Uint8Array): Int8Array {
    const withHeader = new Uint8Array(compressed.length + 4);
    withHeader.set(BZIP2_HEADER, 0);
    withHeader.set(compressed, 4);

    return new Int8Array(bzip2.simple(bzip2.array(withHeader)).buffer);
}
