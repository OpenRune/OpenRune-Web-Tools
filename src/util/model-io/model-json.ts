import type { RSModelDefinition } from "@openrune/engine";

/**
 * The editor's own lossless format: every field of a decoded model, as plain JSON. The other
 * formats each drop something — OBJ has no labels, glTF has no RS render types — so this is the
 * one to use when the data has to survive a round trip untouched.
 */
const FORMAT = "openrune-model";
const VERSION = 1;

type NumberArrayJson = number[] | null;

type ModelJson = {
    format: typeof FORMAT;
    version: number;
    model: Record<string, unknown>;
};

function toArray(value: ArrayLike<number> | null): NumberArrayJson {
    return value === null ? null : Array.from(value);
}

export function exportModelJson(def: RSModelDefinition): string {
    const payload: ModelJson = {
        format: FORMAT,
        version: VERSION,
        model: {
            id: def.id,
            vertexCount: def.vertexCount,
            vertexPositionsX: toArray(def.vertexPositionsX),
            vertexPositionsY: toArray(def.vertexPositionsY),
            vertexPositionsZ: toArray(def.vertexPositionsZ),
            faceCount: def.faceCount,
            faceVertexIndices1: toArray(def.faceVertexIndices1),
            faceVertexIndices2: toArray(def.faceVertexIndices2),
            faceVertexIndices3: toArray(def.faceVertexIndices3),
            faceAlphas: toArray(def.faceAlphas),
            faceColors: toArray(def.faceColors),
            faceRenderPriorities: toArray(def.faceRenderPriorities),
            faceRenderTypes: toArray(def.faceRenderTypes),
            textureTriangleCount: def.textureTriangleCount,
            textureTriangleVertexIndices1: toArray(def.textureTriangleVertexIndices1),
            textureTriangleVertexIndices2: toArray(def.textureTriangleVertexIndices2),
            textureTriangleVertexIndices3: toArray(def.textureTriangleVertexIndices3),
            textureRenderTypes: toArray(def.textureRenderTypes),
            faceTextures: toArray(def.faceTextures),
            textureCoordinates: toArray(def.textureCoordinates),
            priority: def.priority,
            vertexSkins: toArray(def.vertexSkins),
            faceSkins: toArray(def.faceSkins),
            animMayaGroups: def.animMayaGroups?.map((g) => Array.from(g)) ?? null,
            animMayaScales: def.animMayaScales?.map((s) => Array.from(s)) ?? null,
        },
    };
    return JSON.stringify(payload, null, 2);
}

function int32(value: unknown, length: number): Int32Array {
    return Int32Array.from(Array.isArray(value) ? value : new Array(length).fill(0));
}

function maybe<T>(value: unknown, make: (source: number[]) => T): T | null {
    return Array.isArray(value) ? make(value as number[]) : null;
}

export function importModelJson(text: string): RSModelDefinition {
    const parsed: unknown = JSON.parse(text);
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as ModelJson).format !== FORMAT ||
        typeof (parsed as ModelJson).model !== "object"
    ) {
        throw new Error("Not an OpenRune model JSON file");
    }

    const m = (parsed as ModelJson).model as Record<string, unknown>;
    const vertexCount = Number(m.vertexCount ?? 0);
    const faceCount = Number(m.faceCount ?? 0);
    const textureCount = Number(m.textureTriangleCount ?? 0);

    // Normals and UVs are derived, not stored: the engine recomputes them from the geometry, so
    // they're left zeroed here and filled in by the caller's `recomputeDerived`.
    return {
        id: Number(m.id ?? 0),
        vertexCount,
        vertexPositionsX: int32(m.vertexPositionsX, vertexCount),
        vertexPositionsY: int32(m.vertexPositionsY, vertexCount),
        vertexPositionsZ: int32(m.vertexPositionsZ, vertexCount),
        faceCount,
        faceVertexIndices1: int32(m.faceVertexIndices1, faceCount),
        faceVertexIndices2: int32(m.faceVertexIndices2, faceCount),
        faceVertexIndices3: int32(m.faceVertexIndices3, faceCount),
        faceAlphas: maybe(m.faceAlphas, (v) => Int8Array.from(v)),
        faceColors: Int16Array.from(Array.isArray(m.faceColors) ? (m.faceColors as number[]) : []),
        faceRenderPriorities: maybe(m.faceRenderPriorities, (v) => Int8Array.from(v)),
        faceRenderTypes: maybe(m.faceRenderTypes, (v) => Int8Array.from(v)),
        textureTriangleCount: textureCount,
        textureTriangleVertexIndices1: Int16Array.from(
            Array.isArray(m.textureTriangleVertexIndices1)
                ? (m.textureTriangleVertexIndices1 as number[])
                : [],
        ),
        textureTriangleVertexIndices2: Int16Array.from(
            Array.isArray(m.textureTriangleVertexIndices2)
                ? (m.textureTriangleVertexIndices2 as number[])
                : [],
        ),
        textureTriangleVertexIndices3: Int16Array.from(
            Array.isArray(m.textureTriangleVertexIndices3)
                ? (m.textureTriangleVertexIndices3 as number[])
                : [],
        ),
        textureRenderTypes: Int8Array.from(
            Array.isArray(m.textureRenderTypes)
                ? (m.textureRenderTypes as number[])
                : new Array(textureCount).fill(0),
        ),
        faceTextures: maybe(m.faceTextures, (v) => Int16Array.from(v)),
        textureCoordinates: maybe(m.textureCoordinates, (v) => Int8Array.from(v)),
        priority: Number(m.priority ?? 0),
        vertexNormalX: new Int32Array(vertexCount),
        vertexNormalY: new Int32Array(vertexCount),
        vertexNormalZ: new Int32Array(vertexCount),
        vertexNormalMagnitude: new Int32Array(vertexCount),
        faceNormalX: new Int32Array(faceCount),
        faceNormalY: new Int32Array(faceCount),
        faceNormalZ: new Int32Array(faceCount),
        faceTextureUVCoordinates: new Float32Array(6 * faceCount),
        vertexSkins: maybe(m.vertexSkins, (v) => Int32Array.from(v)),
        faceSkins: maybe(m.faceSkins, (v) => Int32Array.from(v)),
        animMayaGroups: Array.isArray(m.animMayaGroups)
            ? (m.animMayaGroups as number[][]).map((g) => Int32Array.from(g))
            : null,
        animMayaScales: Array.isArray(m.animMayaScales)
            ? (m.animMayaScales as number[][]).map((s) => Int32Array.from(s))
            : null,
    };
}
