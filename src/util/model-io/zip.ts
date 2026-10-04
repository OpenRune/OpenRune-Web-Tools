/**
 * A minimal zip writer — enough to hand back a bundle of cache files in one download.
 *
 * Everything is stored, not deflated. A handful of small `.dat` files wouldn't shrink much, and
 * "stored" is a short, fully-specified path with no compressor to get wrong.
 */

export type ZipEntry = {
    /** Path inside the archive. Forward slashes make folders. */
    name: string;
    data: Uint8Array;
};

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** Zip stores the time it was made as a packed DOS date and time. */
function dosDateTime(date: Date): { time: number; date: number } {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1),
        date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

/** Zip is little-endian throughout, unlike everything else in the cache. */
class LittleEndianWriter {
    private readonly parts: Uint8Array[] = [];
    private length = 0;

    get size(): number {
        return this.length;
    }

    u16(value: number): void {
        this.raw(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
    }

    u32(value: number): void {
        this.raw(
            new Uint8Array([
                value & 0xff,
                (value >>> 8) & 0xff,
                (value >>> 16) & 0xff,
                (value >>> 24) & 0xff,
            ]),
        );
    }

    raw(bytes: Uint8Array): void {
        this.parts.push(bytes);
        this.length += bytes.length;
    }

    toUint8Array(): Uint8Array {
        const out = new Uint8Array(this.length);
        let at = 0;
        for (const part of this.parts) {
            out.set(part, at);
            at += part.length;
        }
        return out;
    }
}

export function createZip(entries: readonly ZipEntry[], now = new Date()): Blob {
    const { time, date } = dosDateTime(now);
    const encoder = new TextEncoder();
    const out = new LittleEndianWriter();
    const directory = new LittleEndianWriter();

    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const crc = crc32(entry.data);
        const offset = out.size;

        // Local file header.
        out.u32(0x04034b50);
        out.u16(20); // version needed
        out.u16(0); // flags
        out.u16(0); // stored
        out.u16(time);
        out.u16(date);
        out.u32(crc);
        out.u32(entry.data.length);
        out.u32(entry.data.length);
        out.u16(name.length);
        out.u16(0); // extra field length
        out.raw(name);
        out.raw(entry.data);

        // The matching central-directory record, built as we go.
        directory.u32(0x02014b50);
        directory.u16(20); // version made by
        directory.u16(20); // version needed
        directory.u16(0);
        directory.u16(0);
        directory.u16(time);
        directory.u16(date);
        directory.u32(crc);
        directory.u32(entry.data.length);
        directory.u32(entry.data.length);
        directory.u16(name.length);
        directory.u16(0); // extra
        directory.u16(0); // comment
        directory.u16(0); // disk number
        directory.u16(0); // internal attributes
        directory.u32(0); // external attributes
        directory.u32(offset);
        directory.raw(name);
    }

    const directoryOffset = out.size;
    const directoryBytes = directory.toUint8Array();
    out.raw(directoryBytes);

    // End of central directory.
    out.u32(0x06054b50);
    out.u16(0); // this disk
    out.u16(0); // disk with the directory
    out.u16(entries.length);
    out.u16(entries.length);
    out.u32(directoryBytes.length);
    out.u32(directoryOffset);
    out.u16(0); // comment length

    return new Blob([out.toUint8Array() as BlobPart], { type: "application/zip" });
}
