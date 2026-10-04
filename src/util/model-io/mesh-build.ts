import { type RSModelDefinition, packedHslToRgb } from "@openrune/engine";

/** Geometry as the interchange formats carry it: positions, triangles and per-face colour. */
export type PlainMesh = {
    /** `[x, y, z, …]` in RS model space. */
    positions: number[];
    /** Three vertex indices per face. */
    indices: number[];
    /** Linear RGB per face, 0-1. */
    faceColors: [number, number, number][];
    /** Per-vertex label, or null when the source had none. */
    vertexSkins: number[] | null;
};

/** Packed HSL -> the 0-1 RGB the interchange formats expect. */
export function faceColorsToRgb(def: RSModelDefinition): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let f = 0; f < def.faceCount; f++) {
        const [r, g, b] = packedHslToRgb(def.faceColors[f]);
        out.push([r, g, b]);
    }
    return out;
}

export function toPlainMesh(def: RSModelDefinition): PlainMesh {
    const positions: number[] = [];
    for (let v = 0; v < def.vertexCount; v++) {
        positions.push(def.vertexPositionsX[v], def.vertexPositionsY[v], def.vertexPositionsZ[v]);
    }
    const indices: number[] = [];
    for (let f = 0; f < def.faceCount; f++) {
        indices.push(
            def.faceVertexIndices1[f],
            def.faceVertexIndices2[f],
            def.faceVertexIndices3[f],
        );
    }
    return {
        positions,
        indices,
        faceColors: faceColorsToRgb(def),
        vertexSkins: def.vertexSkins ? Array.from(def.vertexSkins) : null,
    };
}

/** Every colour the packed-HSL format can express, as RGB — built once, on first use. */
let palette: Float32Array | null = null;
/** Remembers the answer per distinct colour; models reuse a handful across thousands of faces. */
const paletteMatches = new Map<number, number>();

function buildPalette(): Float32Array {
    if (palette) return palette;
    const table = new Float32Array(65536 * 3);
    for (let packed = 0; packed < 65536; packed++) {
        const [r, g, b] = packedHslToRgb(packed);
        table[packed * 3] = r;
        table[packed * 3 + 1] = g;
        table[packed * 3 + 2] = b;
    }
    palette = table;
    return table;
}

/**
 * RGB (0-1) back into the 16-bit packed HSL the client stores per face.
 *
 * Done by searching the client's own palette for the nearest colour rather than by converting
 * to textbook HSL: the client's hue/saturation/lightness curves aren't the standard ones, so
 * packing "correct" HSL values lands somewhere else entirely. The search is memoised per
 * colour, and a model only has a few dozen distinct ones.
 */
export function rgbToPackedHsl(r: number, g: number, b: number): number {
    const key =
        (Math.min(255, Math.max(0, Math.round(r * 255))) << 16) |
        (Math.min(255, Math.max(0, Math.round(g * 255))) << 8) |
        Math.min(255, Math.max(0, Math.round(b * 255)));
    const remembered = paletteMatches.get(key);
    if (remembered !== undefined) return remembered;

    const table = buildPalette();
    let best = 0;
    let bestDistance = Infinity;
    for (let packed = 0; packed < 65536; packed++) {
        const dr = table[packed * 3] - r;
        const dg = table[packed * 3 + 1] - g;
        const db = table[packed * 3 + 2] - b;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = packed;
            if (distance === 0) break;
        }
    }
    paletteMatches.set(key, best);
    return best;
}

/**
 * Anything smaller than this in its longest dimension is treated as being in someone else's
 * units — glTF and OBJ are conventionally metres, where a car is about 4 units long.
 */
const SMALL_MODEL_LIMIT = 64;

/** What a rescaled model's longest dimension becomes, in RS units (a tile is 128). */
const RESCALE_TARGET = 256;

export type BuiltModel = { def: RSModelDefinition; scale: number };

/**
 * Merges vertices that sit in the same place and wear the same label.
 *
 * Interchange formats carry colour per vertex while RS carries it per face, so exporters — this
 * one included — split every triangle's corners apart. Left welded shut, a model imports with
 * one normal per face and shades flat, losing the smooth surface it had. Sharing the corners
 * again restores the shared normals the RS renderer expects, and matches how the client's own
 * models are built.
 */
function weldVertices(mesh: PlainMesh): PlainMesh {
    const count = Math.floor(mesh.positions.length / 3);
    const byPosition = new Map<string, number>();
    const remap = new Int32Array(count);
    const positions: number[] = [];
    const vertexSkins: number[] = [];

    for (let v = 0; v < count; v++) {
        const x = mesh.positions[v * 3];
        const y = mesh.positions[v * 3 + 1];
        const z = mesh.positions[v * 3 + 2];
        const label = mesh.vertexSkins ? mesh.vertexSkins[v] : -1;
        // Labels join the key: two corners in the same place but rigged to different parts have
        // to stay apart, or one of them would be dragged along by the wrong movement.
        const key = `${x},${y},${z},${label}`;
        const existing = byPosition.get(key);
        if (existing !== undefined) {
            remap[v] = existing;
            continue;
        }
        const index = positions.length / 3;
        byPosition.set(key, index);
        remap[v] = index;
        positions.push(x, y, z);
        vertexSkins.push(label);
    }

    if (positions.length === mesh.positions.length) return mesh;

    return {
        positions,
        indices: mesh.indices.map((index) => remap[index]),
        faceColors: mesh.faceColors,
        vertexSkins: mesh.vertexSkins ? vertexSkins : null,
    };
}

/**
 * Builds a model definition from imported geometry. Derived data (normals, UVs) is left for the
 * caller to recompute; everything the RS format needs but the source format lacks gets a
 * sensible default rather than being invented.
 *
 * RS stores vertex positions as whole numbers, so a model authored in metres would round to a
 * handful of coordinates and collapse into a box. Anything that arrives small is scaled up
 * first, and the factor is handed back so the caller can say so rather than silently resizing.
 */
export function fromPlainMesh(mesh: PlainMesh, id = 0): BuiltModel {
    mesh = weldVertices(mesh);
    const vertexCount = Math.floor(mesh.positions.length / 3);
    const faceCount = Math.floor(mesh.indices.length / 3);

    let spread = 0;
    for (let axis = 0; axis < 3; axis++) {
        let min = Infinity;
        let max = -Infinity;
        for (let v = 0; v < vertexCount; v++) {
            const value = mesh.positions[v * 3 + axis];
            if (value < min) min = value;
            if (value > max) max = value;
        }
        spread = Math.max(spread, max - min);
    }
    const scale = spread > 0 && spread < SMALL_MODEL_LIMIT ? RESCALE_TARGET / spread : 1;

    const x = new Int32Array(vertexCount);
    const y = new Int32Array(vertexCount);
    const z = new Int32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
        x[v] = Math.round(mesh.positions[v * 3] * scale);
        y[v] = Math.round(mesh.positions[v * 3 + 1] * scale);
        z[v] = Math.round(mesh.positions[v * 3 + 2] * scale);
    }

    const a = new Int32Array(faceCount);
    const b = new Int32Array(faceCount);
    const c = new Int32Array(faceCount);
    const colors = new Int16Array(faceCount);
    for (let f = 0; f < faceCount; f++) {
        a[f] = mesh.indices[f * 3];
        b[f] = mesh.indices[f * 3 + 1];
        c[f] = mesh.indices[f * 3 + 2];
        const rgb = mesh.faceColors[f];
        // Mid grey for anything that arrived without a colour.
        colors[f] = rgb ? rgbToPackedHsl(rgb[0], rgb[1], rgb[2]) : rgbToPackedHsl(0.5, 0.5, 0.5);
    }

    const def: RSModelDefinition = {
        id,
        vertexCount,
        vertexPositionsX: x,
        vertexPositionsY: y,
        vertexPositionsZ: z,
        faceCount,
        faceVertexIndices1: a,
        faceVertexIndices2: b,
        faceVertexIndices3: c,
        faceAlphas: null,
        faceColors: colors,
        faceRenderPriorities: null,
        faceRenderTypes: null,
        textureTriangleCount: 0,
        textureTriangleVertexIndices1: new Int16Array(0),
        textureTriangleVertexIndices2: new Int16Array(0),
        textureTriangleVertexIndices3: new Int16Array(0),
        textureRenderTypes: new Int8Array(0),
        faceTextures: null,
        textureCoordinates: null,
        priority: 0,
        vertexNormalX: new Int32Array(vertexCount),
        vertexNormalY: new Int32Array(vertexCount),
        vertexNormalZ: new Int32Array(vertexCount),
        vertexNormalMagnitude: new Int32Array(vertexCount),
        faceNormalX: new Int32Array(faceCount),
        faceNormalY: new Int32Array(faceCount),
        faceNormalZ: new Int32Array(faceCount),
        faceTextureUVCoordinates: new Float32Array(6 * faceCount),
        // A list of nothing but -1 means the source carried no rig at all; the RS format has no
        // "unlabelled" value, so it's stored as absent rather than as a label of its own.
        vertexSkins:
            mesh.vertexSkins && mesh.vertexSkins.some((label) => label >= 0)
                ? Int32Array.from(mesh.vertexSkins)
                : null,
        faceSkins: null,
        animMayaGroups: null,
        animMayaScales: null,
    };
    return { def, scale };
}
