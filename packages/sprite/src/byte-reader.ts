/** Minimal big-endian cursor over sprite bytes — sprite formats don't need RS's "smart" int encodings. */
export class ByteReader {
    private readonly view: DataView;
    private readonly bytes: Uint8Array;
    offset = 0;

    constructor(data: ArrayBuffer | Uint8Array | Int8Array) {
        if (data instanceof Uint8Array || data instanceof Int8Array) {
            this.bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
            this.bytes = new Uint8Array(data);
        }
        this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    }

    get length(): number {
        return this.bytes.length;
    }

    readByte(): number {
        return this.view.getInt8(this.offset++);
    }

    readUnsignedByte(): number {
        return this.view.getUint8(this.offset++);
    }

    readUnsignedShort(): number {
        const v = this.view.getUint16(this.offset);
        this.offset += 2;
        return v;
    }

    readMedium(): number {
        const b0 = this.readUnsignedByte();
        const b1 = this.readUnsignedByte();
        const b2 = this.readUnsignedByte();
        return (b0 << 16) | (b1 << 8) | b2;
    }
}
