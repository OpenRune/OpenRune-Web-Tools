import { ByteBuffer } from "../io/byte-buffer";
import { hashOld } from "../util/string-hash";
import { Archive } from "./archive";
import { ArchiveFile } from "./archive-file";
import { Container } from "./container";
import { IndexType } from "./index-type";
import { ArchiveReference } from "./ref/archive-reference";
import { ReferenceTable } from "./ref/reference-table";
import type { CacheStore } from "./store/cache-store";
import { SectorCluster } from "./store/sector-cluster";

export abstract class CacheIndex {
    static META_INDEX_ID = 255;

    constructor(
        readonly id: number,
        readonly table: ReferenceTable,
    ) {}

    getArchiveIds(): Int32Array {
        return this.table.archiveIds;
    }

    getArchiveCount(): number {
        return this.table.archiveCount;
    }

    getLastArchiveId(): number {
        return this.table.lastArchiveId;
    }

    getArchiveReference(archiveId: number): ArchiveReference | undefined {
        return this.table.getArchiveReference(archiveId);
    }

    getArchiveId(name: string): number {
        return this.table.getArchiveId(name) ?? -1;
    }

    getFileIds(archiveId: number): Int32Array | undefined {
        return this.getArchiveReference(archiveId)?.fileIds;
    }

    archiveExists(archiveId: number): boolean {
        return this.table.archiveExists(archiveId);
    }

    getFileCount(archiveId: number): number {
        return this.table.getArchiveReference(archiveId)?.fileCount ?? 0;
    }

    abstract getArchive(archiveId: number, key?: number[]): Archive;

    abstract getFile(archiveId: number, fileId: number, key?: number[]): ArchiveFile | undefined;

    /** For indices where each archive holds exactly one file, in either direction. */
    getFileSmart(id: number, key?: number[]): ArchiveFile | undefined {
        if (this.getArchiveCount() === 1) return this.getFile(0, id, key);
        if (this.getFileCount(id) === 1) return this.getFile(id, 0, key);
        throw new Error("Invalid archive");
    }
}

abstract class CacheStoreIndex extends CacheIndex {
    constructor(
        id: number,
        table: ReferenceTable,
        readonly store: CacheStore,
    ) {
        super(id, table);
    }

    read(archiveId: number): Int8Array {
        return this.store.read(this.id, archiveId);
    }

    override getFile(archiveId: number, fileId: number, key?: number[]): ArchiveFile | undefined {
        return this.getArchive(archiveId, key).getFile(fileId);
    }
}

export class CacheIndexDat extends CacheStoreIndex {
    static fromStore(id: number, store: CacheStore, indexFile: ArrayBuffer): CacheIndexDat {
        const table = ReferenceTable.fromArchiveCount(indexFile.byteLength / SectorCluster.SIZE);
        return new CacheIndexDat(id, table, store);
    }

    override getArchive(id: number): Archive {
        const data = this.read(id);
        return Archive.decodeOld(id, data, this.id === IndexType.DAT.configs);
    }
}

function decodeTable(data: Int8Array): ReferenceTable {
    if (data.length === 0) return ReferenceTable.INVALID_TABLE;
    const container = Container.decode(new ByteBuffer(data));
    return ReferenceTable.decode(new ByteBuffer(container.data));
}

function decodeArchiveData(
    index: CacheIndex,
    id: number,
    data: Int8Array,
    key?: number[],
): Archive {
    const archiveRef = index.getArchiveReference(id);
    if (!archiveRef) throw new Error("Archive reference not found for: " + id);

    const container = Container.decode(new ByteBuffer(data), key);
    return Archive.decode(
        id,
        archiveRef.lastFileId,
        archiveRef.fileCount,
        archiveRef.fileIds,
        archiveRef.fileNameHashes,
        new ByteBuffer(container.data),
    );
}

export class CacheIndexDat2 extends CacheStoreIndex {
    static fromStore(id: number, store: CacheStore): CacheIndexDat2 {
        const data = store.read(CacheIndex.META_INDEX_ID, id);
        const table = decodeTable(data);
        return new CacheIndexDat2(id, table, store);
    }

    override getArchive(id: number, key?: number[]): Archive {
        const data = this.read(id);
        return decodeArchiveData(this, id, data, key);
    }
}

/** No sector store at all — every archive was pre-decoded once when the cache was loaded. */
export class LegacyCacheIndex extends CacheIndex {
    constructor(
        readonly id: number,
        readonly archives: Archive[],
        readonly archiveNameHashes: Map<number, number> = new Map(),
    ) {
        super(id, ReferenceTable.INVALID_TABLE);
    }

    override getArchive(archiveId: number): Archive {
        return this.archives[archiveId];
    }

    override getArchiveId(name: string): number {
        return this.archiveNameHashes.get(hashOld(name)) ?? -1;
    }

    override getFile(archiveId: number, fileId: number): ArchiveFile | undefined {
        return this.archives[archiveId]?.getFile(fileId);
    }
}
