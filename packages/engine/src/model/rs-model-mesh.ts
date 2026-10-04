/**
 * Flattens a decoded + lit model into non-indexed GPU buffers.
 *
 * Faces cannot share vertices: colour, UV and texture layer are all per face, so every
 * triangle gets its own three vertices. Opaque faces are emitted first so the renderer can
 * draw them with depth writes on and blend the transparent tail afterwards.
 */
import type { RSModelDefinition } from "./rs-model-format";
import type { RSLitModel } from "./rs-model-light";

export type RSModelBounds = {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    /** Distance from `center` to the furthest corner. */
    radius: number;
};

export type RSModelMesh = {
    positions: Float32Array;
    /** Packed HSL for untextured faces, 7-bit light level for textured ones. */
    hsl: Float32Array;
    uv: Float32Array;
    /** Index into the texture array, or -1 when the face is untextured. */
    textureLayer: Float32Array;
    alpha: Float32Array;
    vertexCount: number;
    /** Vertices `[0, opaqueVertexCount)` are fully opaque. */
    opaqueVertexCount: number;
    /** Layer index -> cache texture id, in upload order. */
    textureIds: number[];
    bounds: RSModelBounds;
};

const EMPTY_BOUNDS: RSModelBounds = {
    min: [0, 0, 0],
    max: [0, 0, 0],
    center: [0, 0, 0],
    radius: 1,
};

type FaceDraw = {
    face: number;
    alpha: number;
    layer: number;
};

export function buildRSModelMesh(def: RSModelDefinition, lit: RSLitModel): RSModelMesh {
    const textureIds: number[] = [];
    const layerByTextureId = new Map<number, number>();

    const opaque: FaceDraw[] = [];
    const transparent: FaceDraw[] = [];

    for (let face = 0; face < def.faceCount; face++) {
        // -2 marks a face the client hides entirely (render type 2 / alpha 0xFF).
        if (lit.faceColors3[face] === -2) continue;

        const rawAlpha = def.faceAlphas ? def.faceAlphas[face] & 0xff : 0;
        // 254 is the "flat white" sentinel, not a transparency level.
        const alpha = rawAlpha === 254 ? 1 : (255 - rawAlpha) / 255;
        if (alpha <= 0) continue;

        let layer = -1;
        const textureId = def.faceTextures ? def.faceTextures[face] : -1;
        if (textureId !== -1) {
            const id = textureId & 0xffff;
            const existing = layerByTextureId.get(id);
            if (existing !== undefined) {
                layer = existing;
            } else {
                layer = textureIds.length;
                layerByTextureId.set(id, layer);
                textureIds.push(id);
            }
        }

        (alpha >= 1 ? opaque : transparent).push({ face, alpha, layer });
    }

    const draws = opaque.concat(transparent);
    const vertexCount = draws.length * 3;

    const positions = new Float32Array(vertexCount * 3);
    const hsl = new Float32Array(vertexCount);
    const uv = new Float32Array(vertexCount * 2);
    const textureLayer = new Float32Array(vertexCount);
    const alphas = new Float32Array(vertexCount);

    let v = 0;
    for (const draw of draws) {
        const { face } = draw;
        const indices = [
            def.faceVertexIndices1[face],
            def.faceVertexIndices2[face],
            def.faceVertexIndices3[face],
        ];
        const flat = lit.faceColors3[face] === -1;
        const shades = flat
            ? [lit.faceColors1[face], lit.faceColors1[face], lit.faceColors1[face]]
            : [lit.faceColors1[face], lit.faceColors2[face], lit.faceColors3[face]];

        for (let corner = 0; corner < 3; corner++) {
            const vertex = indices[corner];
            positions[v * 3] = def.vertexPositionsX[vertex];
            // Model space has +Y pointing down; flip so the model stands up in world space.
            positions[v * 3 + 1] = -def.vertexPositionsY[vertex];
            positions[v * 3 + 2] = def.vertexPositionsZ[vertex];
            hsl[v] = shades[corner];
            uv[v * 2] = def.faceTextureUVCoordinates[face * 6 + corner * 2];
            uv[v * 2 + 1] = def.faceTextureUVCoordinates[face * 6 + corner * 2 + 1];
            textureLayer[v] = draw.layer;
            alphas[v] = draw.alpha;
            v++;
        }
    }

    return {
        positions,
        hsl,
        uv,
        textureLayer,
        alpha: alphas,
        vertexCount,
        opaqueVertexCount: opaque.length * 3,
        textureIds,
        bounds: computeBounds(positions, vertexCount),
    };
}

function computeBounds(positions: Float32Array, vertexCount: number): RSModelBounds {
    if (vertexCount === 0) return EMPTY_BOUNDS;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    const center: [number, number, number] = [
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2,
    ];
    const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2 || 1;

    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, radius };
}
