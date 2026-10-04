/**
 * Filename conventions for a cache's raw files. Populate the `Map` however fits your
 * environment (browser `File.arrayBuffer()`, Node `fs.readFileSync`, a remote fetch, ...) —
 * this class has no I/O of its own.
 */
export class CacheFiles {
    static DAT_FILE_NAME = "main_file_cache.dat";
    static DAT2_FILE_NAME = "main_file_cache.dat2";
    static INDEX_FILE_PREFIX = "main_file_cache.idx";
    static META_FILE_NAME = "main_file_cache.idx255";
    static DAT_INDEX_COUNT = 5;

    constructor(readonly files: Map<string, ArrayBuffer>) {}
}
