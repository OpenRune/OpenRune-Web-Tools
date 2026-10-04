import { bzip2Decompress } from "../compression/bzip2";
import { gzipDecompress } from "../compression/gzip";
import { ByteBuffer } from "../io/byte-buffer";
import { hashDjb2, hashOld } from "../util/string-hash";
import { ArchiveFile } from "./archive-file";

type HashFunction = (str: string) => number;

export class Archive {
    /** Wraps a single already-decoded file as a one-file archive (used for legacy map archives). */
    static create(id: number, data: Int8Array): Archive {
        const fileCount = 1;
        const lastFileId = fileCount - 1;
        const fileIds = new Int32Array(fileCount);
        const fileNameHashes = new Int32Array(fileCount);
        const files = new Map<number, ArchiveFile>();
        files.set(lastFileId, new ArchiveFile(lastFileId, id, data));
        return new Archive(hashOld, id, lastFileId, fileCount, fileIds, fileNameHashes, files);
    }

    /** legacy/dat archive format: inline gzip (single file) or bzip2 + file table (multi-file). */
    static decodeOld(id: number, data: Int8Array, multipleFiles: boolean): Archive {
        const buffer = new ByteBuffer(data);
        const files = new Map<number, ArchiveFile>();

        let fileCount: number;
        let fileIds: Int32Array;
        let fileNameHashes: Int32Array;
        if (multipleFiles) {
            const actualSize = buffer.readMedium();
            const size = buffer.readMedium();
            const isCompressed = actualSize !== size;

            let dataBuffer: ByteBuffer;
            let metaBuffer: ByteBuffer;
            if (isCompressed) {
                const compressed = buffer.readUnsignedBytes(size);
                const decompressed = bzip2Decompress(compressed);
                dataBuffer = new ByteBuffer(decompressed);
                metaBuffer = new ByteBuffer(decompressed);
            } else {
                dataBuffer = new ByteBuffer(data);
                metaBuffer = buffer;
            }

            fileCount = metaBuffer.readUnsignedShort();
            dataBuffer.offset = metaBuffer.offset + fileCount * 10;

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            for (let i = 0; i < fileCount; i++) {
                const nameHash = metaBuffer.readInt();
                metaBuffer.readMedium(); // per-file actual (decompressed) size — unused, files are pre-split
                const fileSize = metaBuffer.readMedium();

                const decompressedFile = isCompressed
                    ? dataBuffer.readBytes(fileSize)
                    : bzip2Decompress(dataBuffer.readUnsignedBytes(fileSize));
                files.set(i, new ArchiveFile(i, id, decompressedFile));
                fileIds[i] = i;
                fileNameHashes[i] = nameHash;
            }
        } else {
            const decompressed = gzipDecompress(buffer.readUnsignedBytes(buffer.remaining));
            fileCount = 1;
            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            files.set(0, new ArchiveFile(0, id, decompressed));
        }

        const lastFileId = fileCount - 1;
        return new Archive(hashOld, id, lastFileId, fileCount, fileIds, fileNameHashes, files);
    }

    /** dat2 archive format: single file as-is, or a multi-file chunk-interleaved buffer. */
    static decode(
        id: number,
        lastFileId: number,
        fileCount: number,
        fileIds: Int32Array,
        fileNameHashes: Int32Array,
        buffer: ByteBuffer,
    ): Archive {
        const files = new Map<number, ArchiveFile>();
        if (fileCount === 1) {
            files.set(lastFileId, new ArchiveFile(lastFileId, id, buffer.data));
        } else {
            buffer.offset = buffer.length - 1;
            const chunks = buffer.readUnsignedByte();
            buffer.offset = buffer.length - 1 - chunks * (fileCount * 4);

            const chunkSizes = new Int32Array(chunks * fileCount);
            const fileSizes = new Int32Array(fileCount);
            for (let chunk = 0; chunk < chunks; chunk++) {
                let lastFileSize = 0;
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    lastFileSize += buffer.readInt();
                    chunkSizes[chunk * fileCount + fileIdx] = lastFileSize;
                    fileSizes[fileIdx] += lastFileSize;
                }
            }

            const fileData = new Array<ByteBuffer>(fileCount);
            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                fileData[fileIdx] = new ByteBuffer(fileSizes[fileIdx]);
            }

            buffer.offset = 0;
            for (let chunk = 0; chunk < chunks; chunk++) {
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    const chunkSize = chunkSizes[chunk * fileCount + fileIdx];
                    fileData[fileIdx].writeBytes(buffer.readBytes(chunkSize));
                }
            }

            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                const fileId = fileIds[fileIdx];
                files.set(fileId, new ArchiveFile(fileId, id, fileData[fileIdx].data));
            }
        }
        return new Archive(hashDjb2, id, lastFileId, fileCount, fileIds, fileNameHashes, files);
    }

    private readonly _fileNameHashIdMap = new Map<number, number>();

    constructor(
        private readonly _hashFunction: HashFunction,
        readonly id: number,
        readonly lastFileId: number,
        readonly fileCount: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
        private readonly _files: Map<number, ArchiveFile>,
    ) {
        if (fileNameHashes) {
            for (let i = 0; i < this.fileIds.length; i++) {
                this._fileNameHashIdMap.set(this.fileNameHashes[i], this.fileIds[i]);
            }
        }
    }

    getFile(id: number): ArchiveFile | undefined {
        return this._files.get(id);
    }

    getFileId(name: string): number {
        return this._fileNameHashIdMap.get(this._hashFunction(name)) ?? -1;
    }

    getFileNamed(name: string): ArchiveFile | undefined {
        const id = this.getFileId(name);
        return id === -1 ? undefined : this.getFile(id);
    }

    get files(): ArchiveFile[] {
        return Array.from(this._files.values());
    }
}
