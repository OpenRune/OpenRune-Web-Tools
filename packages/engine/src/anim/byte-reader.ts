/** Big-endian cursor for animation/sequence bytes — separate from the model reader's needs. */
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

    get remaining(): number {
        return this.bytes.length - this.offset;
    }

    readByte(): number {
        return this.view.getInt8(this.offset++);
    }

    readUnsignedByte(): number {
        return this.view.getUint8(this.offset++);
    }

    readShort(): number {
        const v = this.view.getInt16(this.offset);
        this.offset += 2;
        return v;
    }

    readUnsignedShort(): number {
        const v = this.view.getUint16(this.offset);
        this.offset += 2;
        return v;
    }

    readMedium(): number {
        const v =
            (this.readUnsignedByte() << 16) |
            (this.readUnsignedByte() << 8) |
            this.readUnsignedByte();
        return v;
    }

    readInt(): number {
        const v = this.view.getInt32(this.offset);
        this.offset += 4;
        return v;
    }

    readFloat(): number {
        const v = this.view.getFloat32(this.offset);
        this.offset += 4;
        return v;
    }

    /** `readSmart2`: one byte biased by 64, or two bytes biased by 49152, matching the model decoder's variant. */
    readSmart2(): number {
        return this.view.getUint8(this.offset) >= 128
            ? this.readUnsignedShort() - 49152
            : this.readUnsignedByte() - 64;
    }

    readString(endValue = 0): string {
        let str = "";
        while (this.view.getUint8(this.offset) !== endValue) {
            str += String.fromCharCode(this.readUnsignedByte());
        }
        this.readUnsignedByte();
        return str;
    }
}
