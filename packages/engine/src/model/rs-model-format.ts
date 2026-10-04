/**
 * Decoder for raw OSRS / RS3 model `.dat` bytes.
 *
 * Ported from the Kotlin `ModelLoader` / `ModelDefinition` in OSRS-Environment-Exporter,
 * which in turn derives from RuneLite (BSD-2-Clause). Field names are kept close to the
 * originals so the two can be diffed by eye.
 */

/** Vertex flag bits: which axes carry a delta for this vertex. */
const HAS_DELTA_X = 1;
const HAS_DELTA_Y = 2;
const HAS_DELTA_Z = 4;

export type RSModelDefinition = {
    id: number;

    vertexCount: number;
    vertexPositionsX: Int32Array;
    vertexPositionsY: Int32Array;
    vertexPositionsZ: Int32Array;

    faceCount: number;
    faceVertexIndices1: Int32Array;
    faceVertexIndices2: Int32Array;
    faceVertexIndices3: Int32Array;

    faceAlphas: Int8Array | null;
    faceColors: Int16Array;
    faceRenderPriorities: Int8Array | null;
    faceRenderTypes: Int8Array | null;

    textureTriangleCount: number;
    textureTriangleVertexIndices1: Int16Array;
    textureTriangleVertexIndices2: Int16Array;
    textureTriangleVertexIndices3: Int16Array;
    textureRenderTypes: Int8Array;

    faceTextures: Int16Array | null;
    textureCoordinates: Int8Array | null;

    priority: number;

    /** Summed face normals per vertex, plus the number of faces that contributed. */
    vertexNormalX: Int32Array;
    vertexNormalY: Int32Array;
    vertexNormalZ: Int32Array;
    vertexNormalMagnitude: Int32Array;

    /** Only populated for faces with render type 1 (flat shaded). */
    faceNormalX: Int32Array;
    faceNormalY: Int32Array;
    faceNormalZ: Int32Array;

    /** 6 floats per face: `u1, v1, u2, v2, u3, v3`. */
    faceTextureUVCoordinates: Float32Array;

    /** Animation label (0-255) per vertex/face, used to group vertices for old-style frame transforms. */
    vertexSkins: Int32Array | null;
    faceSkins: Int32Array | null;

    /** Per-vertex skeletal (Maya) bone weighting: parallel (boneId, weight 0-255) lists per vertex. */
    animMayaGroups: Int32Array[] | null;
    animMayaScales: Int32Array[] | null;
};

/** Big-endian cursor over the `.dat` bytes, mirroring Java's `ByteBuffer` helpers. */
class ModelReader {
    private readonly bytes: Uint8Array;
    private readonly view: DataView;
    position = 0;

    constructor(buffer: ArrayBuffer) {
        this.bytes = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    get limit(): number {
        return this.bytes.length;
    }

    u8(): number {
        return this.bytes[this.position++];
    }

    u16(): number {
        const v = this.view.getUint16(this.position);
        this.position += 2;
        return v;
    }

    i16(): number {
        const v = this.view.getInt16(this.position);
        this.position += 2;
        return v;
    }

    /** `readShortSmart`: one byte biased by 64, or two bytes biased by 0xc000. */
    shortSmart(): number {
        return this.bytes[this.position] < 128 ? this.u8() - 64 : this.u16() - 0xc000;
    }

    /** Signed bytes, copied so later reads cannot alias the result. */
    i8Array(length: number): Int8Array {
        const out = new Int8Array(length);
        for (let i = 0; i < length; i++) out[i] = this.view.getInt8(this.position + i);
        this.position += length;
        return out;
    }

    u8ArrayAsInt32(length: number): Int32Array {
        const out = new Int32Array(length);
        for (let i = 0; i < length; i++) out[i] = this.bytes[this.position + i];
        this.position += length;
        return out;
    }

    i16Array(length: number): Int16Array {
        const out = new Int16Array(length);
        for (let i = 0; i < length; i++) out[i] = this.view.getInt16(this.position + i * 2);
        this.position += length * 2;
        return out;
    }
}

/**
 * Decode one model. Throws on truncated / non-model input.
 */
export function decodeRSModel(id: number, buffer: ArrayBuffer): RSModelDefinition {
    if (buffer.byteLength < 20) throw new Error(`Model ${id}: only ${buffer.byteLength} bytes`);

    const stream = new ModelReader(buffer);
    stream.position = stream.limit - 2;
    const version = stream.i16();

    switch (version) {
        case -3:
            return readModelCommon(id, stream, 26, true, true);
        case -2:
            return readModelCommon(id, stream, 23, false, true);
        case -1:
            return readModelCommon(id, stream, 23, true, false);
        default:
            return readModelCommon(id, stream, 18, false, false);
    }
}

function readModelCommon(
    modelId: number,
    stream: ModelReader,
    headerOffset: number,
    isNewStyleTextures: boolean,
    canHaveAnimayaGroups: boolean,
): RSModelDefinition {
    stream.position = stream.limit - headerOffset;
    const vertexCount = stream.u16();
    const faceCount = stream.u16();
    const textureCount = stream.u8();
    const oldStyleIsTextured = isNewStyleTextures ? 0 : stream.u8();
    const hasFaceRenderTypes = isNewStyleTextures ? stream.u8() : 0;
    const faceRenderPriority = stream.u8();
    const hasFaceTransparencies = stream.u8();
    const hasPackedTransparencyVertexGroups = stream.u8();
    const hasFaceTextures = isNewStyleTextures ? stream.u8() : 0;
    const hasVertexSkins = stream.u8();
    const hasAnimayaGroups = canHaveAnimayaGroups ? stream.u8() : 0;

    // 255 means "priority is stored per face" — the model-wide value is then unused.
    const priority = faceRenderPriority === 255 ? 0 : faceRenderPriority;

    stream.position = 0;
    const textureRenderTypes = isNewStyleTextures
        ? stream.i8Array(textureCount)
        : new Int8Array(textureCount);

    const vertexFlags = stream.i8Array(vertexCount);
    let faceRenderTypes: Int8Array | null =
        hasFaceRenderTypes === 1 ? stream.i8Array(faceCount) : null;
    const faceIndexCompressionTypes = stream.i8Array(faceCount);
    const faceRenderPriorities = faceRenderPriority === 255 ? stream.i8Array(faceCount) : null;

    const faceSkins =
        hasPackedTransparencyVertexGroups === 1 ? stream.u8ArrayAsInt32(faceCount) : null;

    const faceTextureFlags = oldStyleIsTextured === 1 ? stream.i8Array(faceCount) : null;

    const vertexSkins = hasVertexSkins === 1 ? stream.u8ArrayAsInt32(vertexCount) : null;

    let animMayaGroups: Int32Array[] | null = null;
    let animMayaScales: Int32Array[] | null = null;
    if (hasAnimayaGroups === 1 && isNewStyleTextures) {
        ({ groups: animMayaGroups, scales: animMayaScales } = readAnimayaGroups(
            stream,
            vertexCount,
        ));
    }

    const faceAlphas = hasFaceTransparencies === 1 ? stream.i8Array(faceCount) : null;

    const faceVertexIndices = readFaceIndexData(stream, faceIndexCompressionTypes);

    let faceTextures: Int16Array | null = null;
    let textureCoordinates: Int8Array | null = null;
    if (hasFaceTextures === 1) {
        faceTextures = readFaceTextures(stream, faceCount);
        if (textureCount > 0) {
            textureCoordinates = readTextureCoordinates(stream, faceCount, faceTextures);
        }
    }

    const faceColors = stream.i16Array(faceCount);

    if (faceTextureFlags) {
        const unpacked = processFaceTextureFlags(faceColors, faceTextureFlags, faceCount);
        faceTextures = unpacked.faceTextures;
        faceRenderTypes = unpacked.faceRenderTypes;
        textureCoordinates = unpacked.textureCoordinates;
    }

    // The two layouts differ only in whether vertex data precedes the texture triangles.
    let positions: { x: Int32Array; y: Int32Array; z: Int32Array };
    let textureTriangles: { a: Int16Array; b: Int16Array; c: Int16Array };
    if (isNewStyleTextures) {
        positions = readVertexData(stream, vertexFlags);
        textureTriangles = readTextureTriangleVertexIndices(
            textureRenderTypes,
            stream,
            textureCount,
            false,
        );
    } else {
        textureTriangles = readTextureTriangleVertexIndices(
            textureRenderTypes,
            stream,
            textureCount,
            true,
        );
        positions = readVertexData(stream, vertexFlags);
    }

    if (hasAnimayaGroups === 1 && !isNewStyleTextures) {
        ({ groups: animMayaGroups, scales: animMayaScales } = readAnimayaGroups(
            stream,
            vertexCount,
        ));
    }

    textureCoordinates = discardUnusedTextures(
        textureCoordinates,
        faceVertexIndices,
        textureTriangles,
        faceCount,
        oldStyleIsTextured,
    );

    const def: RSModelDefinition = {
        id: modelId,
        vertexCount,
        vertexPositionsX: positions.x,
        vertexPositionsY: positions.y,
        vertexPositionsZ: positions.z,
        faceCount,
        faceVertexIndices1: faceVertexIndices.a,
        faceVertexIndices2: faceVertexIndices.b,
        faceVertexIndices3: faceVertexIndices.c,
        faceAlphas,
        faceColors,
        faceRenderPriorities,
        faceRenderTypes,
        textureTriangleCount: textureCount,
        textureTriangleVertexIndices1: textureTriangles.a,
        textureTriangleVertexIndices2: textureTriangles.b,
        textureTriangleVertexIndices3: textureTriangles.c,
        textureRenderTypes,
        faceTextures,
        textureCoordinates,
        priority,
        vertexNormalX: new Int32Array(vertexCount),
        vertexNormalY: new Int32Array(vertexCount),
        vertexNormalZ: new Int32Array(vertexCount),
        vertexNormalMagnitude: new Int32Array(vertexCount),
        faceNormalX: new Int32Array(faceCount),
        faceNormalY: new Int32Array(faceCount),
        faceNormalZ: new Int32Array(faceCount),
        faceTextureUVCoordinates: new Float32Array(6 * faceCount),
        vertexSkins,
        faceSkins,
        animMayaGroups,
        animMayaScales,
    };

    computeNormals(def);
    computeTextureUVCoordinates(def);
    return def;
}

function processFaceTextureFlags(
    faceColors: Int16Array,
    faceTextureFlags: Int8Array,
    faceCount: number,
): {
    faceTextures: Int16Array | null;
    faceRenderTypes: Int8Array | null;
    textureCoordinates: Int8Array;
} {
    const faceTextures = new Int16Array(faceCount);
    const faceRenderTypes = new Int8Array(faceCount);
    const textureCoordinates = new Int8Array(faceCount);
    let usesFaceRenderTypes = false;
    let usesFaceTextures = false;

    for (let i = 0; i < faceCount; i++) {
        const flag = faceTextureFlags[i] & 0xff;
        if ((flag & 1) === 1) {
            faceRenderTypes[i] = 1;
            usesFaceRenderTypes = true;
        } else {
            faceRenderTypes[i] = 0;
        }
        if ((flag & 2) === 2) {
            // Old-style: the "colour" slot actually held the texture id.
            textureCoordinates[i] = flag >> 2;
            faceTextures[i] = faceColors[i];
            faceColors[i] = 127;
            if (faceTextures[i] !== -1) usesFaceTextures = true;
        } else {
            textureCoordinates[i] = -1;
            faceTextures[i] = -1;
        }
    }

    return {
        faceTextures: usesFaceTextures ? faceTextures : null,
        faceRenderTypes: usesFaceRenderTypes ? faceRenderTypes : null,
        textureCoordinates,
    };
}

/** Drops per-face UV indices that just repeat the texture triangle itself. */
function discardUnusedTextures(
    textureCoordinates: Int8Array | null,
    faceVertexIndices: { a: Int32Array; b: Int32Array; c: Int32Array },
    textureTriangles: { a: Int16Array; b: Int16Array; c: Int16Array },
    faceCount: number,
    oldStyleIsTextured: number,
): Int8Array | null {
    if (oldStyleIsTextured !== 1 || !textureCoordinates) return textureCoordinates;

    let usesTextureCoords = false;
    for (let i = 0; i < faceCount; i++) {
        const coord = textureCoordinates[i] & 255;
        if (coord === 255) continue;
        if (
            faceVertexIndices.a[i] === (textureTriangles.a[coord] & 0xffff) &&
            faceVertexIndices.b[i] === (textureTriangles.b[coord] & 0xffff) &&
            faceVertexIndices.c[i] === (textureTriangles.c[coord] & 0xffff)
        ) {
            textureCoordinates[i] = -1;
        } else {
            usesTextureCoords = true;
        }
    }
    return usesTextureCoords ? textureCoordinates : null;
}

function readFaceIndexData(
    stream: ModelReader,
    faceIndexCompressionTypes: Int8Array,
): { a: Int32Array; b: Int32Array; c: Int32Array } {
    const faceCount = faceIndexCompressionTypes.length;
    const a = new Int32Array(faceCount);
    const b = new Int32Array(faceCount);
    const c = new Int32Array(faceCount);
    let previous1 = 0;
    let previous2 = 0;
    let previous3 = 0;

    for (let i = 0; i < faceCount; i++) {
        switch (faceIndexCompressionTypes[i]) {
            case 1:
                previous1 = stream.shortSmart() + previous3;
                previous2 = stream.shortSmart() + previous1;
                previous3 = stream.shortSmart() + previous2;
                break;
            case 2:
                previous2 = previous3;
                previous3 = stream.shortSmart() + previous3;
                break;
            case 3:
                previous1 = previous3;
                previous3 = stream.shortSmart() + previous3;
                break;
            case 4: {
                const swap = previous1;
                previous1 = previous2;
                previous2 = swap;
                previous3 = stream.shortSmart() + previous3;
                break;
            }
            default:
                break;
        }
        a[i] = previous1;
        b[i] = previous2;
        c[i] = previous3;
    }
    return { a, b, c };
}

function readVertexData(
    stream: ModelReader,
    vertexFlags: Int8Array,
): { x: Int32Array; y: Int32Array; z: Int32Array } {
    return {
        x: readVertexGroup(stream, vertexFlags, HAS_DELTA_X),
        y: readVertexGroup(stream, vertexFlags, HAS_DELTA_Y),
        z: readVertexGroup(stream, vertexFlags, HAS_DELTA_Z),
    };
}

/** Positions are stored as running deltas; a cleared flag repeats the previous value. */
function readVertexGroup(
    stream: ModelReader,
    vertexFlags: Int8Array,
    deltaMask: number,
): Int32Array {
    const vertexCount = vertexFlags.length;
    const vertices = new Int32Array(vertexCount);
    let position = 0;
    for (let i = 0; i < vertexCount; i++) {
        if ((vertexFlags[i] & deltaMask) !== 0) position += stream.shortSmart();
        vertices[i] = position;
    }
    return vertices;
}

function readFaceTextures(stream: ModelReader, faceCount: number): Int16Array {
    const faceTextures = stream.i16Array(faceCount);
    // Stored +1 so that 0 can mean "untextured"; -1 is the sentinel after the shift.
    for (let i = 0; i < faceCount; i++) faceTextures[i] -= 1;
    return faceTextures;
}

function readTextureCoordinates(
    stream: ModelReader,
    faceCount: number,
    faceTextures: Int16Array,
): Int8Array {
    const textureCoordinates = new Int8Array(faceCount);
    for (let i = 0; i < faceCount; i++) {
        if (faceTextures[i] !== -1) textureCoordinates[i] = stream.u8() - 1;
    }
    return textureCoordinates;
}

function readTextureTriangleVertexIndices(
    textureRenderTypes: Int8Array,
    stream: ModelReader,
    textureCount: number,
    always: boolean,
): { a: Int16Array; b: Int16Array; c: Int16Array } {
    const a = new Int16Array(textureCount);
    const b = new Int16Array(textureCount);
    const c = new Int16Array(textureCount);
    for (let i = 0; i < textureCount; i++) {
        if (always || (textureRenderTypes[i] & 255) === 0) {
            a[i] = stream.i16();
            b[i] = stream.i16();
            c[i] = stream.i16();
        }
    }
    return { a, b, c };
}

/** Animaya (skeletal) data is not rendered here — advance past it. */
/** Per vertex: a variable-length list of (boneId, weight) pairs for skeletal (Maya) skinning. */
function readAnimayaGroups(
    stream: ModelReader,
    vertexCount: number,
): { groups: Int32Array[]; scales: Int32Array[] } {
    const groups = new Array<Int32Array>(vertexCount);
    const scales = new Array<Int32Array>(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        const length = stream.u8();
        const group = (groups[i] = new Int32Array(length));
        const scale = (scales[i] = new Int32Array(length));
        for (let j = 0; j < length; j++) {
            group[j] = stream.u8();
            scale[j] = stream.u8();
        }
    }
    return { groups, scales };
}

/**
 * Accumulates a face normal into each of its vertices (render type 0) or stores it
 * on the face itself (render type 1, flat shading).
 */
function computeNormals(def: RSModelDefinition): void {
    for (let face = 0; face < def.faceCount; face++) {
        const vertexA = def.faceVertexIndices1[face];
        const vertexB = def.faceVertexIndices2[face];
        const vertexC = def.faceVertexIndices3[face];

        const xA = def.vertexPositionsX[vertexB] - def.vertexPositionsX[vertexA];
        const yA = def.vertexPositionsY[vertexB] - def.vertexPositionsY[vertexA];
        const zA = def.vertexPositionsZ[vertexB] - def.vertexPositionsZ[vertexA];
        const xB = def.vertexPositionsX[vertexC] - def.vertexPositionsX[vertexA];
        const yB = def.vertexPositionsY[vertexC] - def.vertexPositionsY[vertexA];
        const zB = def.vertexPositionsZ[vertexC] - def.vertexPositionsZ[vertexA];

        let nx = yA * zB - yB * zA;
        let ny = zA * xB - zB * xA;
        let nz = xA * yB - xB * yA;
        // Keep the components inside the range the client's fixed-point maths assumes.
        while (nx > 8192 || ny > 8192 || nz > 8192 || nx < -8192 || ny < -8192 || nz < -8192) {
            nx >>= 1;
            ny >>= 1;
            nz >>= 1;
        }
        let length = Math.trunc(Math.sqrt(nx * nx + ny * ny + nz * nz));
        if (length <= 0) length = 1;
        nx = Math.trunc((nx * 256) / length);
        ny = Math.trunc((ny * 256) / length);
        nz = Math.trunc((nz * 256) / length);

        const renderType = def.faceRenderTypes ? def.faceRenderTypes[face] : 0;
        if (renderType === 0) {
            for (const vertex of [vertexA, vertexB, vertexC]) {
                def.vertexNormalX[vertex] += nx;
                def.vertexNormalY[vertex] += ny;
                def.vertexNormalZ[vertex] += nz;
                def.vertexNormalMagnitude[vertex] += 1;
            }
        } else if (renderType === 1) {
            def.faceNormalX[face] = nx;
            def.faceNormalY[face] = ny;
            def.faceNormalZ[face] = nz;
        }
    }
}

/**
 * Projects each textured face onto its texture triangle to get per-vertex UVs.
 * Faces with no explicit texture triangle fall back to the client's default corners.
 */
function computeTextureUVCoordinates(def: RSModelDefinition): void {
    const uv = def.faceTextureUVCoordinates;

    for (let face = 0; face < def.faceCount; face++) {
        let textureCoordinate = def.textureCoordinates ? def.textureCoordinates[face] : -1;
        const textureIdx = def.faceTextures ? def.faceTextures[face] : -1;
        if (textureIdx === -1) continue;

        const idx = face * 6;
        if (textureCoordinate === -1) {
            uv[idx] = 0;
            uv[idx + 1] = 1;
            uv[idx + 2] = 1;
            uv[idx + 3] = 1;
            uv[idx + 4] = 0;
            uv[idx + 5] = 0;
            continue;
        }

        textureCoordinate &= 0xff;
        if (def.textureRenderTypes[textureCoordinate] !== 0) continue;

        const t1 = def.textureTriangleVertexIndices1[textureCoordinate];
        const t2 = def.textureTriangleVertexIndices2[textureCoordinate];
        const t3 = def.textureTriangleVertexIndices3[textureCoordinate];

        const originX = def.vertexPositionsX[t1];
        const originY = def.vertexPositionsY[t1];
        const originZ = def.vertexPositionsZ[t1];

        const uAxisX = def.vertexPositionsX[t2] - originX;
        const uAxisY = def.vertexPositionsY[t2] - originY;
        const uAxisZ = def.vertexPositionsZ[t2] - originZ;
        const vAxisX = def.vertexPositionsX[t3] - originX;
        const vAxisY = def.vertexPositionsY[t3] - originY;
        const vAxisZ = def.vertexPositionsZ[t3] - originZ;

        const fa = def.faceVertexIndices1[face];
        const fb = def.faceVertexIndices2[face];
        const fc = def.faceVertexIndices3[face];

        const p1x = def.vertexPositionsX[fa] - originX;
        const p1y = def.vertexPositionsY[fa] - originY;
        const p1z = def.vertexPositionsZ[fa] - originZ;
        const p2x = def.vertexPositionsX[fb] - originX;
        const p2y = def.vertexPositionsY[fb] - originY;
        const p2z = def.vertexPositionsZ[fb] - originZ;
        const p3x = def.vertexPositionsX[fc] - originX;
        const p3y = def.vertexPositionsY[fc] - originY;
        const p3z = def.vertexPositionsZ[fc] - originZ;

        // Normal of the texture triangle, then a reciprocal basis for each axis.
        const nx = uAxisY * vAxisZ - uAxisZ * vAxisY;
        const ny = uAxisZ * vAxisX - uAxisX * vAxisZ;
        const nz = uAxisX * vAxisY - uAxisY * vAxisX;

        let bx = vAxisY * nz - vAxisZ * ny;
        let by = vAxisZ * nx - vAxisX * nz;
        let bz = vAxisX * ny - vAxisY * nx;
        let scale = 1 / (bx * uAxisX + by * uAxisY + bz * uAxisZ);
        if (!Number.isFinite(scale)) scale = 0;
        uv[idx] = (bx * p1x + by * p1y + bz * p1z) * scale;
        uv[idx + 2] = (bx * p2x + by * p2y + bz * p2z) * scale;
        uv[idx + 4] = (bx * p3x + by * p3y + bz * p3z) * scale;

        bx = uAxisY * nz - uAxisZ * ny;
        by = uAxisZ * nx - uAxisX * nz;
        bz = uAxisX * ny - uAxisY * nx;
        scale = 1 / (bx * vAxisX + by * vAxisY + bz * vAxisZ);
        if (!Number.isFinite(scale)) scale = 0;
        uv[idx + 1] = (bx * p1x + by * p1y + bz * p1z) * scale;
        uv[idx + 3] = (bx * p2x + by * p2y + bz * p2z) * scale;
        uv[idx + 5] = (bx * p3x + by * p3y + bz * p3z) * scale;
    }
}
