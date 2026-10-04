import type { ByteBuffer } from "../io/byte-buffer";

const GOLDEN_RATIO = 0x9e3779b9;
const ROUNDS = 32;
const INITIAL_SUM = Math.imul(GOLDEN_RATIO, ROUNDS);

export function isValidXteaKey(key: number[] | undefined): key is number[] {
    return (
        key !== undefined &&
        key.length === 4 &&
        (key[0] !== 0 || key[1] !== 0 || key[2] !== 0 || key[3] !== 0)
    );
}

/** Decrypts `[start, end)` in place, 32-round XTEA over 8-byte blocks. */
export function xteaDecrypt(buf: ByteBuffer, start: number, end: number, key: number[]): void {
    if (key.length !== 4) throw new Error("Xtea: key is not 128 bits");

    const blocks = Math.floor((end - start) / 8);
    for (let i = 0; i < blocks; i++) {
        const offset = start + i * 8;
        let sum = INITIAL_SUM;
        let v0 = buf.getInt(offset);
        let v1 = buf.getInt(offset + 4);
        for (let j = 0; j < ROUNDS; j++) {
            v1 -= (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]);
            sum -= GOLDEN_RATIO;
            v0 -= (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]);
        }
        buf.setInt(offset, v0);
        buf.setInt(offset + 4, v1);
    }
}
