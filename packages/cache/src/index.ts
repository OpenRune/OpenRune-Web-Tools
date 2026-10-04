export { ByteBuffer } from "./io/byte-buffer";
export { isValidXteaKey, xteaDecrypt } from "./crypto/xtea";
export { CompressionType } from "./compression/compression-type";
export { gzipDecompress } from "./compression/gzip";
export { bzip2Decompress } from "./compression/bzip2";

export { Container } from "./cache/container";
export { Archive } from "./cache/archive";
export { ArchiveFile } from "./cache/archive-file";
export { ArchiveFileReference } from "./cache/ref/archive-file-reference";
export { ArchiveReference } from "./cache/ref/archive-reference";
export { ReferenceTable } from "./cache/ref/reference-table";
export { Sector } from "./cache/store/sector";
export { SectorCluster } from "./cache/store/sector-cluster";
export type { CacheStore } from "./cache/store/cache-store";
export { MemoryStore } from "./cache/store/memory-store";

export { IndexType } from "./cache/index-type";
export { ConfigType } from "./cache/config-type";
export type { CacheType } from "./cache/cache-type";
export { detectCacheType } from "./cache/cache-type";
export type { CacheInfo, GameType } from "./cache/cache-info";
export { CacheFiles } from "./cache/cache-files";
export { CacheIndex, CacheIndexDat, CacheIndexDat2, LegacyCacheIndex } from "./cache/cache-index";
export { CacheSystem } from "./cache/cache-system";
export {
    MAP_XTEA_OBSOLETE_FROM_REVISION,
    cacheRequiresMapXteas,
    parseXteaMapFromJsonText,
    parseXteaMapFromCacheFiles,
    type XteaMap,
} from "./cache/map-xtea";
