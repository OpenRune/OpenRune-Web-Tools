import type { RSModelDefinition } from "@openrune/engine";

/**
 * Writes a model back out in the cache's own flat binary layout — the `.dat` you'd find in
 * index 7 — so an edited model can go back where it came from.
 *
 * Only the version -3 layout is written (new-style textures, Maya groups allowed). The format
 * has four header variants, but a decoder reads whichever it's given, so emitting the newest is
 * enough and keeps this to one code path. Face indices are written uncompressed (type 0), which
 * is always legal: compression is an optional size win, not part of the meaning.
 */
export function encodeRSModel(def: RSModelDefinition): ArrayBuffer {
    const vertexCount = def.vertexCount;
    const faceCount = def.faceCount;
    const textureCount = def.textureTriangleCount;

    const hasFaceRenderTypes = def.faceRenderTypes !== null ? 1 : 0;
    const perFacePriority = def.faceRenderPriorities !== null;
    const hasFaceTransparencies = def.faceAlphas !== null ? 1 : 0;
    const hasFaceSkins = def.faceSkins !== null ? 1 : 0;
    const hasVertexSkins = def.vertexSkins !== null ? 1 : 0;
    const hasFaceTextures = def.faceTextures !== null ? 1 : 0;
    const hasAnimayaGroups = def.animMayaGroups !== null && def.animMayaScales !== null ? 1 : 0;

    const out = new ByteWriter();

    // Section order mirrors the decoder exactly; it reads these back-to-back from offset 0.
    for (let t = 0; t < textureCount; t++) out.i8(def.textureRenderTypes[t]);

    // Vertex positions are stored as deltas against the previous vertex, with a per-vertex flag
    // saying which axes carry one. A zero delta is simply not written.
    const deltaX: number[] = [];
    const deltaY: number[] = [];
    const deltaZ: number[] = [];
    const vertexFlags: number[] = [];
    let previousX = 0;
    let previousY = 0;
    let previousZ = 0;
    for (let v = 0; v < vertexCount; v++) {
        const dx = def.vertexPositionsX[v] - previousX;
        const dy = def.vertexPositionsY[v] - previousY;
        const dz = def.vertexPositionsZ[v] - previousZ;
        let flag = 0;
        if (dx !== 0) {
            flag |= 1;
            deltaX.push(dx);
        }
        if (dy !== 0) {
            flag |= 2;
            deltaY.push(dy);
        }
        if (dz !== 0) {
            flag |= 4;
            deltaZ.push(dz);
        }
        vertexFlags.push(flag);
        previousX = def.vertexPositionsX[v];
        previousY = def.vertexPositionsY[v];
        previousZ = def.vertexPositionsZ[v];
    }
    for (const flag of vertexFlags) out.i8(flag);

    if (hasFaceRenderTypes === 1) {
        for (let f = 0; f < faceCount; f++) out.i8(def.faceRenderTypes![f]);
    }
    // Compression type 1: each face carries all three of its own indices. The other types reuse
    // indices from the previous face to save bytes; type 1 is always correct, just larger.
    for (let f = 0; f < faceCount; f++) out.i8(1);
    if (perFacePriority) {
        for (let f = 0; f < faceCount; f++) out.i8(def.faceRenderPriorities![f]);
    }
    if (hasFaceSkins === 1) {
        for (let f = 0; f < faceCount; f++) out.u8(def.faceSkins![f] & 0xff);
    }
    if (hasVertexSkins === 1) {
        // Labels are unsigned bytes here, so there's no way to say "unlabelled" — a negative
        // would come back as 255, a real label. Anything negative is written as label 0 instead.
        for (let v = 0; v < vertexCount; v++) out.u8(Math.max(0, def.vertexSkins![v]) & 0xff);
    }
    if (hasAnimayaGroups === 1) {
        for (let v = 0; v < vertexCount; v++) {
            const bones = def.animMayaGroups![v] ?? new Int32Array(0);
            const weights = def.animMayaScales![v] ?? new Int32Array(0);
            out.u8(bones.length);
            for (let i = 0; i < bones.length; i++) {
                out.u8(bones[i]);
                out.u8(weights[i]);
            }
        }
    }
    if (hasFaceTransparencies === 1) {
        for (let f = 0; f < faceCount; f++) out.i8(def.faceAlphas![f]);
    }

    // Face indices, as smart2 deltas against the previously written index.
    let previousIndex = 0;
    for (let f = 0; f < faceCount; f++) {
        const a = def.faceVertexIndices1[f];
        const b = def.faceVertexIndices2[f];
        const c = def.faceVertexIndices3[f];
        out.smart2(a - previousIndex);
        out.smart2(b - a);
        out.smart2(c - b);
        previousIndex = c;
    }

    if (hasFaceTextures === 1) {
        // One u16 per face: the texture id plus one, so 0 means "untextured".
        for (let f = 0; f < faceCount; f++) out.u16((def.faceTextures![f] + 1) & 0xffff);
        if (textureCount > 0) {
            for (let f = 0; f < faceCount; f++) {
                if (def.faceTextures![f] === -1) continue;
                out.u8((def.textureCoordinates ? def.textureCoordinates[f] : -1) + 1);
            }
        }
    }

    for (let f = 0; f < faceCount; f++) out.i16(def.faceColors[f]);

    // New-style layout puts vertex data before the texture triangles.
    for (const d of deltaX) out.smart2(d);
    for (const d of deltaY) out.smart2(d);
    for (const d of deltaZ) out.smart2(d);

    // Only simple (render type 0) texture triangles carry vertex indices; the others are
    // procedural and the decoder doesn't read any.
    for (let t = 0; t < textureCount; t++) {
        if ((def.textureRenderTypes[t] & 255) !== 0) continue;
        out.i16(def.textureTriangleVertexIndices1[t]);
        out.i16(def.textureTriangleVertexIndices2[t]);
        out.i16(def.textureTriangleVertexIndices3[t]);
    }

    // Trailer: the fixed-size header the decoder seeks back to, then the version marker.
    out.u16(vertexCount);
    out.u16(faceCount);
    out.u8(textureCount);
    out.u8(hasFaceRenderTypes);
    out.u8(perFacePriority ? 255 : def.priority);
    out.u8(hasFaceTransparencies);
    out.u8(hasFaceSkins);
    out.u8(hasFaceTextures);
    out.u8(hasVertexSkins);
    out.u8(hasAnimayaGroups);
    // The version -3 trailer is 26 bytes from the header's start; the 12 written above plus the
    // version marker leave room for six more fields this decoder doesn't read.
    for (let i = 0; i < 6; i++) out.u16(0);
    out.i16(-3);

    return out.toArrayBuffer();
}

/** Big-endian writer matching the reader's conventions, including `smart2`. */
class ByteWriter {
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
            throw new Error(`Value ${value} is too large for this model format`);
        }
        this.u16((value + 49152) & 0xffff);
    }

    toArrayBuffer(): ArrayBuffer {
        return this.bytes.buffer.slice(0, this.length) as ArrayBuffer;
    }
}
