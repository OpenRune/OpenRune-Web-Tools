import pako from "pako";

export function gzipDecompress(compressed: Uint8Array): Int8Array {
    return new Int8Array(pako.ungzip(compressed).buffer);
}
