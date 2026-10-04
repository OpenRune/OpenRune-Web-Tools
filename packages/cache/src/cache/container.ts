import { bzip2Decompress } from "../compression/bzip2";
import { CompressionType } from "../compression/compression-type";
import { gzipDecompress } from "../compression/gzip";
import { isValidXteaKey, xteaDecrypt } from "../crypto/xtea";
import type { ByteBuffer } from "../io/byte-buffer";

export class Container {
    static decode(buffer: ByteBuffer, key?: number[]): Container {
        if (buffer.remaining === 0) throw new Error("Empty container");

        const compression: CompressionType = buffer.readUnsignedByte();
        const size = buffer.readInt();
        if (isValidXteaKey(key)) {
            xteaDecrypt(buffer, buffer.offset, buffer.offset + 4 + size, key);
        }

        switch (compression) {
            case CompressionType.None:
                return new Container(compression, buffer.readBytes(size));
            case CompressionType.Bzip2:
            case CompressionType.Gzip: {
                const actualSize = buffer.readInt() & 0xffffffff;
                const data = buffer.readUnsignedBytes(size);
                const decompressed =
                    compression === CompressionType.Bzip2
                        ? bzip2Decompress(data)
                        : gzipDecompress(data);

                if (decompressed.length !== actualSize) {
                    throw new Error(
                        `Container: Size mismatch. Compressed: ${actualSize}, Decompressed: ${decompressed.length}, Type: ${CompressionType[compression]}`,
                    );
                }
                return new Container(compression, decompressed);
            }
            default:
                throw new Error("Container: Unsupported compression: " + compression);
        }
    }

    constructor(
        readonly compression: CompressionType,
        readonly data: Int8Array,
    ) {}
}
