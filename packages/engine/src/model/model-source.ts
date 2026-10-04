/**
 * Common boundary between "however you store models" and the decode/light/mesh pipeline.
 *
 * A live game cache and a raw `.dat` file both ultimately just hand back bytes for a model
 * id — the only difference is how those bytes are looked up. So the adapter surface is a
 * single interface (`getModel`) plus small factories that wrap whatever byte- or
 * JSON-fetching function a caller already has; there's no separate class per source kind.
 */
import { type RSModelDefinition, decodeRSModel } from "./rs-model-format";

export interface ModelSource {
    getModel(id: number): Promise<RSModelDefinition>;
}

type BytesLike = ArrayBuffer | Uint8Array;

function toArrayBuffer(bytes: BytesLike): ArrayBuffer {
    if (bytes instanceof Uint8Array) {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
    }
    return bytes;
}

/**
 * Wraps any "give me the raw .dat bytes for model id N" function — a cache reader, a
 * `fetch()` of a file/URL, an in-memory `Map`, whatever the caller already has.
 */
export function createBytesModelSource(
    getBytes: (id: number) => Promise<BytesLike> | BytesLike,
): ModelSource {
    return {
        async getModel(id: number): Promise<RSModelDefinition> {
            const bytes = await getBytes(id);
            return decodeRSModel(id, toArrayBuffer(bytes));
        },
    };
}

/** Plain-array mirror of `RSModelDefinition` so a decoded model can round-trip through JSON. */
export type RSModelDefinitionJson = {
    id: number;
    vertexCount: number;
    vertexPositionsX: number[];
    vertexPositionsY: number[];
    vertexPositionsZ: number[];
    faceCount: number;
    faceVertexIndices1: number[];
    faceVertexIndices2: number[];
    faceVertexIndices3: number[];
    faceAlphas: number[] | null;
    faceColors: number[];
    faceRenderPriorities: number[] | null;
    faceRenderTypes: number[] | null;
    textureTriangleCount: number;
    textureTriangleVertexIndices1: number[];
    textureTriangleVertexIndices2: number[];
    textureTriangleVertexIndices3: number[];
    textureRenderTypes: number[];
    faceTextures: number[] | null;
    textureCoordinates: number[] | null;
    priority: number;
    vertexNormalX: number[];
    vertexNormalY: number[];
    vertexNormalZ: number[];
    vertexNormalMagnitude: number[];
    faceNormalX: number[];
    faceNormalY: number[];
    faceNormalZ: number[];
    faceTextureUVCoordinates: number[];
    vertexSkins: number[] | null;
    faceSkins: number[] | null;
    animMayaGroups: number[][] | null;
    animMayaScales: number[][] | null;
};

export function modelDefinitionToJson(def: RSModelDefinition): RSModelDefinitionJson {
    return {
        id: def.id,
        vertexCount: def.vertexCount,
        vertexPositionsX: Array.from(def.vertexPositionsX),
        vertexPositionsY: Array.from(def.vertexPositionsY),
        vertexPositionsZ: Array.from(def.vertexPositionsZ),
        faceCount: def.faceCount,
        faceVertexIndices1: Array.from(def.faceVertexIndices1),
        faceVertexIndices2: Array.from(def.faceVertexIndices2),
        faceVertexIndices3: Array.from(def.faceVertexIndices3),
        faceAlphas: def.faceAlphas && Array.from(def.faceAlphas),
        faceColors: Array.from(def.faceColors),
        faceRenderPriorities: def.faceRenderPriorities && Array.from(def.faceRenderPriorities),
        faceRenderTypes: def.faceRenderTypes && Array.from(def.faceRenderTypes),
        textureTriangleCount: def.textureTriangleCount,
        textureTriangleVertexIndices1: Array.from(def.textureTriangleVertexIndices1),
        textureTriangleVertexIndices2: Array.from(def.textureTriangleVertexIndices2),
        textureTriangleVertexIndices3: Array.from(def.textureTriangleVertexIndices3),
        textureRenderTypes: Array.from(def.textureRenderTypes),
        faceTextures: def.faceTextures && Array.from(def.faceTextures),
        textureCoordinates: def.textureCoordinates && Array.from(def.textureCoordinates),
        priority: def.priority,
        vertexNormalX: Array.from(def.vertexNormalX),
        vertexNormalY: Array.from(def.vertexNormalY),
        vertexNormalZ: Array.from(def.vertexNormalZ),
        vertexNormalMagnitude: Array.from(def.vertexNormalMagnitude),
        faceNormalX: Array.from(def.faceNormalX),
        faceNormalY: Array.from(def.faceNormalY),
        faceNormalZ: Array.from(def.faceNormalZ),
        faceTextureUVCoordinates: Array.from(def.faceTextureUVCoordinates),
        vertexSkins: def.vertexSkins && Array.from(def.vertexSkins),
        faceSkins: def.faceSkins && Array.from(def.faceSkins),
        animMayaGroups: def.animMayaGroups && def.animMayaGroups.map((g) => Array.from(g)),
        animMayaScales: def.animMayaScales && def.animMayaScales.map((s) => Array.from(s)),
    };
}

export function modelDefinitionFromJson(json: RSModelDefinitionJson): RSModelDefinition {
    return {
        id: json.id,
        vertexCount: json.vertexCount,
        vertexPositionsX: Int32Array.from(json.vertexPositionsX),
        vertexPositionsY: Int32Array.from(json.vertexPositionsY),
        vertexPositionsZ: Int32Array.from(json.vertexPositionsZ),
        faceCount: json.faceCount,
        faceVertexIndices1: Int32Array.from(json.faceVertexIndices1),
        faceVertexIndices2: Int32Array.from(json.faceVertexIndices2),
        faceVertexIndices3: Int32Array.from(json.faceVertexIndices3),
        faceAlphas: json.faceAlphas && Int8Array.from(json.faceAlphas),
        faceColors: Int16Array.from(json.faceColors),
        faceRenderPriorities:
            json.faceRenderPriorities && Int8Array.from(json.faceRenderPriorities),
        faceRenderTypes: json.faceRenderTypes && Int8Array.from(json.faceRenderTypes),
        textureTriangleCount: json.textureTriangleCount,
        textureTriangleVertexIndices1: Int16Array.from(json.textureTriangleVertexIndices1),
        textureTriangleVertexIndices2: Int16Array.from(json.textureTriangleVertexIndices2),
        textureTriangleVertexIndices3: Int16Array.from(json.textureTriangleVertexIndices3),
        textureRenderTypes: Int8Array.from(json.textureRenderTypes),
        faceTextures: json.faceTextures && Int16Array.from(json.faceTextures),
        textureCoordinates: json.textureCoordinates && Int8Array.from(json.textureCoordinates),
        priority: json.priority,
        vertexNormalX: Int32Array.from(json.vertexNormalX),
        vertexNormalY: Int32Array.from(json.vertexNormalY),
        vertexNormalZ: Int32Array.from(json.vertexNormalZ),
        vertexNormalMagnitude: Int32Array.from(json.vertexNormalMagnitude),
        faceNormalX: Int32Array.from(json.faceNormalX),
        faceNormalY: Int32Array.from(json.faceNormalY),
        faceNormalZ: Int32Array.from(json.faceNormalZ),
        faceTextureUVCoordinates: Float32Array.from(json.faceTextureUVCoordinates),
        vertexSkins: json.vertexSkins && Int32Array.from(json.vertexSkins),
        faceSkins: json.faceSkins && Int32Array.from(json.faceSkins),
        animMayaGroups: json.animMayaGroups && json.animMayaGroups.map((g) => Int32Array.from(g)),
        animMayaScales: json.animMayaScales && json.animMayaScales.map((s) => Int32Array.from(s)),
    };
}

/** Wraps any "give me the already-decoded model JSON for id N" function. */
export function createJsonModelSource(
    getJson: (id: number) => Promise<RSModelDefinitionJson> | RSModelDefinitionJson,
): ModelSource {
    return {
        async getModel(id: number): Promise<RSModelDefinition> {
            const json = await getJson(id);
            return modelDefinitionFromJson(json);
        },
    };
}
