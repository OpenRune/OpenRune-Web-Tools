import type { RSModelDefinition } from "@openrune/engine";

function concatInt32(a: ArrayLike<number>, b: ArrayLike<number>, offset = 0): Int32Array {
    const out = new Int32Array(a.length + b.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i];
    for (let i = 0; i < b.length; i++) out[a.length + i] = b[i] + offset;
    return out;
}

function concatInt16(a: ArrayLike<number>, b: ArrayLike<number>, offset = 0): Int16Array {
    const out = new Int16Array(a.length + b.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i];
    for (let i = 0; i < b.length; i++) out[a.length + i] = b[i] + offset;
    return out;
}

/** Joins two optional per-face arrays, filling whichever side is missing with `fallback`. */
function concatOptional(
    a: ArrayLike<number> | null,
    aCount: number,
    b: ArrayLike<number> | null,
    bCount: number,
    fallback: number,
): Int8Array | null {
    if (!a && !b) return null;
    const out = new Int8Array(aCount + bCount);
    for (let i = 0; i < aCount; i++) out[i] = a ? a[i] : fallback;
    for (let i = 0; i < bCount; i++) out[aCount + i] = b ? b[i] : fallback;
    return out;
}

/** The lowest label id neither model is already using. */
function nextFreeLabel(a: RSModelDefinition, b: RSModelDefinition): number {
    const used = new Set<number>();
    for (const def of [a, b]) {
        if (!def.vertexSkins) continue;
        for (let v = 0; v < def.vertexCount; v++)
            if (def.vertexSkins[v] >= 0) used.add(def.vertexSkins[v]);
    }
    let candidate = 0;
    while (used.has(candidate) && candidate < 255) candidate++;
    return candidate;
}

/**
 * Combines two models into one, as "add to scene" does: `incoming`'s vertices are appended and
 * its faces re-pointed at their new indices.
 *
 * Where only one side carries something, the other gets a default rather than the merge being
 * refused. Labels are the case worth knowing about: if one model is rigged and the other isn't,
 * the unrigged half is given a single fresh label of its own, since the format has no way to say
 * "no label" — that keeps it selectable instead of silently joining someone else's group.
 */
export function mergeModels(
    base: RSModelDefinition,
    incoming: RSModelDefinition,
): RSModelDefinition {
    const vertexOffset = base.vertexCount;
    const vertexCount = base.vertexCount + incoming.vertexCount;
    const faceCount = base.faceCount + incoming.faceCount;

    let vertexSkins: Int32Array | null = null;
    if (base.vertexSkins || incoming.vertexSkins) {
        const spare = nextFreeLabel(base, incoming);
        vertexSkins = new Int32Array(vertexCount);
        for (let v = 0; v < base.vertexCount; v++) {
            vertexSkins[v] = base.vertexSkins ? base.vertexSkins[v] : spare;
        }
        for (let v = 0; v < incoming.vertexCount; v++) {
            vertexSkins[vertexOffset + v] = incoming.vertexSkins ? incoming.vertexSkins[v] : spare;
        }
    }

    const textureOffset = base.textureTriangleCount;

    return {
        id: base.id,
        vertexCount,
        vertexPositionsX: concatInt32(base.vertexPositionsX, incoming.vertexPositionsX),
        vertexPositionsY: concatInt32(base.vertexPositionsY, incoming.vertexPositionsY),
        vertexPositionsZ: concatInt32(base.vertexPositionsZ, incoming.vertexPositionsZ),
        faceCount,
        faceVertexIndices1: concatInt32(
            base.faceVertexIndices1,
            incoming.faceVertexIndices1,
            vertexOffset,
        ),
        faceVertexIndices2: concatInt32(
            base.faceVertexIndices2,
            incoming.faceVertexIndices2,
            vertexOffset,
        ),
        faceVertexIndices3: concatInt32(
            base.faceVertexIndices3,
            incoming.faceVertexIndices3,
            vertexOffset,
        ),
        // 0 is fully opaque, which is the right default for a model that didn't specify.
        faceAlphas: concatOptional(
            base.faceAlphas,
            base.faceCount,
            incoming.faceAlphas,
            incoming.faceCount,
            0,
        ),
        faceColors: concatInt16(base.faceColors, incoming.faceColors),
        faceRenderPriorities: concatOptional(
            base.faceRenderPriorities,
            base.faceCount,
            incoming.faceRenderPriorities,
            incoming.faceCount,
            base.priority,
        ),
        faceRenderTypes: concatOptional(
            base.faceRenderTypes,
            base.faceCount,
            incoming.faceRenderTypes,
            incoming.faceCount,
            0,
        ),
        textureTriangleCount: base.textureTriangleCount + incoming.textureTriangleCount,
        textureTriangleVertexIndices1: concatInt16(
            base.textureTriangleVertexIndices1,
            incoming.textureTriangleVertexIndices1,
            vertexOffset,
        ),
        textureTriangleVertexIndices2: concatInt16(
            base.textureTriangleVertexIndices2,
            incoming.textureTriangleVertexIndices2,
            vertexOffset,
        ),
        textureTriangleVertexIndices3: concatInt16(
            base.textureTriangleVertexIndices3,
            incoming.textureTriangleVertexIndices3,
            vertexOffset,
        ),
        textureRenderTypes:
            concatOptional(
                base.textureRenderTypes,
                base.textureTriangleCount,
                incoming.textureRenderTypes,
                incoming.textureTriangleCount,
                0,
            ) ?? new Int8Array(0),
        faceTextures:
            base.faceTextures || incoming.faceTextures
                ? concatInt16(
                      base.faceTextures ?? new Int16Array(base.faceCount).fill(-1),
                      incoming.faceTextures
                          ? incoming.faceTextures.map((t) => (t === -1 ? -1 : t + textureOffset))
                          : new Int16Array(incoming.faceCount).fill(-1),
                  )
                : null,
        textureCoordinates: concatOptional(
            base.textureCoordinates,
            base.faceCount,
            incoming.textureCoordinates,
            incoming.faceCount,
            -1,
        ),
        priority: base.priority,
        // Derived data is recomputed by the caller, so it starts empty.
        vertexNormalX: new Int32Array(vertexCount),
        vertexNormalY: new Int32Array(vertexCount),
        vertexNormalZ: new Int32Array(vertexCount),
        vertexNormalMagnitude: new Int32Array(vertexCount),
        faceNormalX: new Int32Array(faceCount),
        faceNormalY: new Int32Array(faceCount),
        faceNormalZ: new Int32Array(faceCount),
        faceTextureUVCoordinates: new Float32Array(6 * faceCount),
        vertexSkins,
        faceSkins: concatOptional(
            base.faceSkins,
            base.faceCount,
            incoming.faceSkins,
            incoming.faceCount,
            0,
        )
            ? concatInt32(
                  base.faceSkins ?? new Int32Array(base.faceCount),
                  incoming.faceSkins ?? new Int32Array(incoming.faceCount),
              )
            : null,
        // Bone weights index into a skeleton the other model knows nothing about, so a merged
        // model carries none rather than a mix that means nothing.
        animMayaGroups: null,
        animMayaScales: null,
    };
}
