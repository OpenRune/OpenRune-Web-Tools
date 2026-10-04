/**
 * The counterpart of the engine's `ByteReader`: a growing big-endian buffer.
 *
 * Shared by every encoder here, so a model, a frame and a sequence config are all written the
 * same way the client reads them.
 */
export class ByteWriter {
    private bytes: Uint8Array = new Uint8Array(1024);
    private length = 0;

    private ensure(extra: number): void {
        if (this.length + extra <= this.bytes.length) return;
        let size = this.bytes.length * 2;
        while (size < this.length + extra) size *= 2;
        const grown = new Uint8Array(size);
        grown.set(this.bytes.subarray(0, this.length));
        this.bytes = grown;
    }

    get size(): number {
        return this.length;
    }

    u8(value: number): void {
        this.ensure(1);
        this.bytes[this.length++] = value & 0xff;
    }

    i8(value: number): void {
        this.u8(value < 0 ? value + 256 : value);
    }

    u16(value: number): void {
        this.u8(value >>> 8);
        this.u8(value);
    }

    i16(value: number): void {
        this.u16(value < 0 ? value + 65536 : value);
    }

    i32(value: number): void {
        this.u8(value >>> 24);
        this.u8(value >>> 16);
        this.u8(value >>> 8);
        this.u8(value);
    }

    /** Latin-1 bytes then a NUL, which is how the client stores a string. */
    string(value: string): void {
        for (const char of value) this.u8(char.charCodeAt(0));
        this.u8(0);
    }

    raw(bytes: Uint8Array): void {
        this.ensure(bytes.length);
        this.bytes.set(bytes, this.length);
        this.length += bytes.length;
    }

    /**
     * The counterpart of `readSmart2`: one byte biased by 64 for small values, otherwise two
     * bytes biased by 49152 with the top bit set so the reader knows which it's looking at.
     */
    smart2(value: number): void {
        if (value >= -64 && value < 64) {
            this.u8(value + 64);
            return;
        }
        if (value < -16384 || value >= 16384) {
            throw new Error(`Value ${value} is too large for this format`);
        }
        this.u16((value + 49152) & 0xffff);
    }

    toUint8Array(): Uint8Array {
        return this.bytes.slice(0, this.length);
    }

    toArrayBuffer(): ArrayBuffer {
        return this.bytes.buffer.slice(0, this.length) as ArrayBuffer;
    }
}
