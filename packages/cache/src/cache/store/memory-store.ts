import { ByteBuffer } from "../../io/byte-buffer";
import { CacheFiles } from "../cache-files";
import { CacheIndex } from "../cache-index";
import type { CacheStore } from "./cache-store";
import { Sector } from "./sector";
import { SectorCluster } from "./sector-cluster";

/** Pure in-memory cache store: everything is already-loaded `ArrayBuffer`s, no disk/network I/O. */
export class MemoryStore implements CacheStore {
    static fromFiles(cacheFiles: CacheFiles, indicesToLoad: number[] = []): MemoryStore {
        const files = cacheFiles.files;

        const indexFiles: ArrayBuffer[] = [];
        const indicesSet = new Set(indicesToLoad);
        for (const [name, data] of files.entries()) {
            if (
                name !== CacheFiles.META_FILE_NAME &&
                name.startsWith(CacheFiles.INDEX_FILE_PREFIX)
            ) {
                const indexId = parseInt(name.slice(CacheFiles.INDEX_FILE_PREFIX.length));
                if (indicesSet.size === 0 || indicesSet.has(indexId)) {
                    indexFiles[indexId] = data;
                }
            }
        }

        const dataFile =
            files.get(CacheFiles.DAT2_FILE_NAME) || files.get(CacheFiles.DAT_FILE_NAME);
        if (!dataFile) throw new Error("main_file_cache data file not found");

        const metaFile = files.get(CacheFiles.META_FILE_NAME);
        return new MemoryStore(dataFile, indexFiles, metaFile);
    }

    constructor(
        readonly dataFile: ArrayBuffer,
        readonly indexFiles: (ArrayBuffer | undefined)[],
        readonly metaFile?: ArrayBuffer,
    ) {}

    getIndexFile(indexId: number): ArrayBuffer | undefined {
        if (indexId === CacheIndex.META_INDEX_ID) return this.metaFile;
        return this.indexFiles[indexId];
    }

    /** dat has no idx255, so its on-disk sector index ids are offset by one from the logical index id. */
    getSectorIndexId(indexId: number): number {
        return this.metaFile ? indexId : indexId + 1;
    }

    read(indexId: number, archiveId: number): Int8Array {
        if (indexId < 0) throw new Error("Index id cannot be lower than 0");
        const indexFile = this.getIndexFile(indexId);
        if (!indexFile) throw new Error(`Index ${indexId} not found`);

        const sectorIndexId = this.getSectorIndexId(indexId);

        const clusterPtr = archiveId * SectorCluster.SIZE;
        if (clusterPtr < 0 || clusterPtr + SectorCluster.SIZE > indexFile.byteLength) {
            throw new Error(
                `Invalid ptr: ${clusterPtr}, fileSize: ${indexFile.byteLength}, indexId: ${indexId}, archiveId: ${archiveId}`,
            );
        }

        const extended = archiveId > 65535;

        const sectorClusterBuf = new ByteBuffer(
            new Int8Array(indexFile, clusterPtr, SectorCluster.SIZE),
        );
        const sectorCluster = SectorCluster.decode(sectorClusterBuf);

        const data = new Int8Array(sectorCluster.size);
        let chunk = 0;
        let remaining = sectorCluster.size;
        let sectorPtr = sectorCluster.sector * Sector.SIZE;

        const sectorBuffer = new ByteBuffer(0);
        const sector = new Sector();

        while (remaining > 0) {
            const headerSize = extended ? Sector.EXTENDED_HEADER_SIZE : Sector.HEADER_SIZE;
            const dataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;
            const actualDataSize = Math.min(dataSize, remaining);

            sectorBuffer._data = new Int8Array(
                this.dataFile,
                sectorPtr,
                headerSize + actualDataSize,
            );
            sectorBuffer.offset = 0;

            if (extended) {
                Sector.decodeExtended(sector, sectorBuffer, actualDataSize);
            } else {
                Sector.decode(sector, sectorBuffer, actualDataSize);
            }

            if (remaining > dataSize) {
                data.set(sector.data, sectorCluster.size - remaining);

                if (sector.indexId !== sectorIndexId) {
                    throw new Error(
                        `Sector index id mismatch. expected: ${sectorIndexId} got: ${sector.indexId}`,
                    );
                }
                if (sector.archiveId !== archiveId) {
                    throw new Error(
                        `Sector archive id mismatch. expected: ${archiveId} got: ${sector.archiveId}`,
                    );
                }
                if (sector.chunk !== chunk) {
                    throw new Error("Sector chunk mismatch");
                }

                chunk++;
                sectorPtr = sector.nextSector * Sector.SIZE;
            } else {
                data.set(sector.data.subarray(0, remaining), sectorCluster.size - remaining);
            }
            remaining -= dataSize;
        }

        return data;
    }
}
