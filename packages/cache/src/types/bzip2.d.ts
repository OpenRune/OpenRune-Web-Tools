declare module "bzip2" {
    function array(bytes: Uint8Array): unknown;
    function simple(bitReader: unknown): { buffer: ArrayBufferLike };
    export { array, simple };
}
