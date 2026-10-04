import {
    type RSLitModel,
    type RSModelBounds,
    type RSModelDefinition,
    packedHslToRgb,
} from "@openrune/engine";

import { projectToScreen } from "./viewport-projection";

/** Alpha byte the engine reads as "hide this face entirely" (0xFF as a signed byte). */
const HIDDEN_FACE_ALPHA = -1;

/** Alpha byte the engine reads as "flat white", not an opacity. */
const FLAT_WHITE_FACE_ALPHA = -2;

/**
 * Face alpha for x-ray: the mesh builder maps it to `(255 - raw) / 255` ≈ 50% opaque. Faint
 * enough to see what's behind, solid enough to still read the model's shape.
 */
const XRAY_FACE_ALPHA = 128;

/**
 * A copy of the definition with every face made translucent. The mesh builder sorts non-opaque
 * faces into its blended tail, which the renderer draws with depth writes off — so nothing
 * occludes anything and you can see (and select) the geometry behind. That's Blender's x-ray.
 *
 * Faces carrying the engine's sentinels keep them: -1 and -2 are "hidden" and "flat white",
 * not opacity levels, and overwriting them would change what the face is rather than how
 * solid it looks.
 */
export function makeTranslucent(def: RSModelDefinition): RSModelDefinition {
    const alphas = def.faceAlphas ? Int8Array.from(def.faceAlphas) : new Int8Array(def.faceCount);
    for (let f = 0; f < def.faceCount; f++) {
        if (alphas[f] === HIDDEN_FACE_ALPHA || alphas[f] === FLAT_WHITE_FACE_ALPHA) continue;
        // Wraps to a negative signed byte; the builder reads it back with `& 0xff`.
        alphas[f] = XRAY_FACE_ALPHA;
    }
    return { ...def, faceAlphas: alphas };
}

/**
 * A copy of the definition with every face whose labels aren't visible marked hidden. A face
 * survives only when all three of its vertices are visible — keeping partial faces would leave
 * torn triangles poking out of whatever is still shown.
 *
 * Takes a predicate rather than a set so it can serve both hiding (everything except these) and
 * isolating (only these) without either having to enumerate the labels a model carries.
 *
 * Filtering happens through the engine's own "hidden face" alpha sentinel rather than on the
 * built mesh, so the builder's opaque/transparent draw order and texture layers stay intact.
 */
export function filterFacesByLabel(
    def: RSModelDefinition,
    skins: Int32Array | null,
    isVisible: (label: number) => boolean,
): RSModelDefinition {
    if (!skins) return def;

    const alphas = def.faceAlphas ? Int8Array.from(def.faceAlphas) : new Int8Array(def.faceCount);
    for (let f = 0; f < def.faceCount; f++) {
        const shown =
            isVisible(skins[def.faceVertexIndices1[f]]) &&
            isVisible(skins[def.faceVertexIndices2[f]]) &&
            isVisible(skins[def.faceVertexIndices3[f]]);
        if (!shown) alphas[f] = HIDDEN_FACE_ALPHA;
    }
    return { ...def, faceAlphas: alphas };
}

/**
 * Bounds of every vertex in the definition, in the renderer's Y-flipped space.
 *
 * The camera frames whatever the mesh's bounds describe, so hiding geometry would otherwise
 * move it. Measuring the full vertex set instead — the same set whether or not labels are
 * isolated — keeps the view exactly where you left it while you show and hide parts.
 */
export function boundsOfVertices(def: RSModelDefinition): RSModelBounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let count = 0;

    for (let v = 0; v < def.vertexCount; v++) {
        const x = def.vertexPositionsX[v];
        // Matches the Y-flip `buildRSModelMesh` applies when it lays out GPU positions.
        const y = -def.vertexPositionsY[v];
        const z = def.vertexPositionsZ[v];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
        count++;
    }
    if (count === 0) return null;

    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
        // A floor keeps the camera usable for flat or degenerate models, where the spread
        // collapses and the near plane would otherwise swallow the whole view.
        radius: Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2, 1),
    };
}

/** Light level given to textured faces in flat shading — they carry a brightness, not a colour. */
const FLAT_TEXTURE_LIGHT = 96;

/**
 * Turns a lit model flat: every face keeps the colour it was authored with, with no light
 * direction applied. Useful for reading a model's material regions, which shading hides — two
 * faces of the same colour look different when one faces the light.
 *
 * Built by rewriting a real lit model rather than replacing the lighting pass, so the engine's
 * own decisions about which faces are hidden survive untouched.
 */
export function flattenLighting(def: RSModelDefinition, lit: RSLitModel): RSLitModel {
    const faceColors1 = new Int32Array(def.faceCount);
    const faceColors2 = new Int32Array(def.faceCount);
    const faceColors3 = new Int32Array(def.faceCount);

    for (let f = 0; f < def.faceCount; f++) {
        // -2 is "hidden"; leaving it alone keeps isolation and the alpha sentinels working.
        if (lit.faceColors3[f] === -2) {
            faceColors3[f] = -2;
            continue;
        }
        const textured = def.faceTextures ? def.faceTextures[f] !== -1 : false;
        faceColors1[f] = textured ? FLAT_TEXTURE_LIGHT : def.faceColors[f] & 0xffff;
        // -1 means flat: the builder uses `faceColors1` for all three corners.
        faceColors3[f] = -1;
    }

    return { faceColors1, faceColors2, faceColors3 };
}

export type ColorGroup = { color: number; css: string; vertices: number[]; faceCount: number };

/**
 * Groups vertices by the colour of the faces they belong to. RS stores colour per face, not per
 * vertex, so "select by colour" means every vertex touching a face of that colour — which lines
 * up with how models are authored in material regions.
 */
export function groupVerticesByFaceColor(def: RSModelDefinition): ColorGroup[] {
    const byColor = new Map<number, { vertices: Set<number>; faceCount: number }>();
    for (let f = 0; f < def.faceCount; f++) {
        const color = def.faceColors[f];
        let entry = byColor.get(color);
        if (!entry) {
            entry = { vertices: new Set<number>(), faceCount: 0 };
            byColor.set(color, entry);
        }
        entry.faceCount++;
        entry.vertices.add(def.faceVertexIndices1[f]);
        entry.vertices.add(def.faceVertexIndices2[f]);
        entry.vertices.add(def.faceVertexIndices3[f]);
    }

    return Array.from(byColor.entries())
        .map(([color, entry]) => {
            const [r, g, b] = packedHslToRgb(color);
            return {
                color,
                css: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
                vertices: Array.from(entry.vertices).sort((a, z) => a - z),
                faceCount: entry.faceCount,
            };
        })
        .sort((a, b) => b.faceCount - a.faceCount);
}

export type BoneGroup = { bone: number; vertices: number[] };

/**
 * Groups vertices by the skeletal bone that influences them, keeping only influences at or
 * above `minWeight` (0-255). Only meaningful for models carrying Maya bone data.
 */
export function groupVerticesByBone(def: RSModelDefinition, minWeight: number): BoneGroup[] {
    const groups = def.animMayaGroups;
    const scales = def.animMayaScales;
    if (!groups || !scales) return [];

    const byBone = new Map<number, number[]>();
    for (let v = 0; v < def.vertexCount; v++) {
        const bones = groups[v];
        const weights = scales[v];
        if (!bones || !weights) continue;
        for (let i = 0; i < bones.length; i++) {
            if (weights[i] < minWeight) continue;
            const list = byBone.get(bones[i]);
            if (list) list.push(v);
            else byBone.set(bones[i], [v]);
        }
    }

    return Array.from(byBone.entries())
        .map(([bone, vertices]) => ({ bone, vertices }))
        .sort((a, b) => a.bone - b.bone);
}

/** Lowest label id not already used by the model's vertex skins. */
export function nextFreeLabel(skins: Int32Array | null, vertexCount: number): number {
    if (!skins) return 0;
    const used = new Set<number>();
    for (let v = 0; v < vertexCount; v++) if (skins[v] >= 0) used.add(skins[v]);
    let candidate = 0;
    while (used.has(candidate) && candidate < 255) candidate++;
    return candidate;
}

/** Neighbour lists built from the model's triangles, for Blender-style select more/less. */
export function buildVertexAdjacency(def: RSModelDefinition): number[][] {
    const neighbours: Set<number>[] = Array.from(
        { length: def.vertexCount },
        () => new Set<number>(),
    );
    const link = (a: number, b: number): void => {
        if (a === b) return;
        neighbours[a]?.add(b);
        neighbours[b]?.add(a);
    };
    for (let f = 0; f < def.faceCount; f++) {
        const a = def.faceVertexIndices1[f];
        const b = def.faceVertexIndices2[f];
        const c = def.faceVertexIndices3[f];
        link(a, b);
        link(b, c);
        link(c, a);
    }
    return neighbours.map((set) => Array.from(set));
}

/**
 * Every unique edge in the mesh as a flat `[a, b, a, b, …]` list. Built from the triangles, so
 * an edge shared by two faces appears once — picking and highlighting both want each edge one
 * time, not once per face that uses it.
 */
export function buildEdgeList(def: RSModelDefinition): Int32Array {
    const seen = new Set<number>();
    const edges: number[] = [];
    const add = (a: number, b: number): void => {
        if (a === b) return;
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        // Vertex counts are well under 2^16 in RS models, so this packs without collisions.
        const key = lo * 65536 + hi;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push(lo, hi);
    };
    for (let f = 0; f < def.faceCount; f++) {
        const a = def.faceVertexIndices1[f];
        const b = def.faceVertexIndices2[f];
        const c = def.faceVertexIndices3[f];
        add(a, b);
        add(b, c);
        add(c, a);
    }
    return Int32Array.from(edges);
}

/** Distance from a point to a line segment, in screen pixels. */
export function distanceToSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a screen point falls inside a projected triangle. */
export function pointInTriangle(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    // Consistent winding either way: faces can be wound clockwise or not.
    return !(hasNegative && hasPositive);
}

/** Adds every vertex touching the selection (Blender's Select More). */
export function growSelection(selected: readonly number[], adjacency: number[][]): number[] {
    const out = new Set(selected);
    for (const v of selected) for (const n of adjacency[v] ?? []) out.add(n);
    return Array.from(out).sort((a, b) => a - b);
}

/** Drops selected vertices that sit on the selection's boundary (Blender's Select Less). */
export function shrinkSelection(selected: readonly number[], adjacency: number[][]): number[] {
    const set = new Set(selected);
    return selected.filter((v) => {
        const neighbours = adjacency[v];
        return (
            neighbours !== undefined && neighbours.length > 0 && neighbours.every((n) => set.has(n))
        );
    });
}

/** `data` holds the *largest* 1/depth seen per cell — i.e. the nearest surface, or 0 for none. */
export type DepthBuffer = { width: number; height: number; scale: number; data: Float32Array };

/**
 * Software-rasterises the mesh into a depth buffer so selection and the vertex overlay can tell
 * front-facing geometry from what's hidden behind it — the GPU's depth buffer isn't readable
 * here.
 *
 * Stores reciprocal depth rather than depth: only 1/w varies linearly across a triangle in
 * screen space, so interpolating w directly puts the surface in the wrong place on anything
 * that recedes from the camera, and the bias then has to be wide enough to hide the error.
 */
export function buildDepthBuffer(
    vp: Float32Array,
    positions: Float32Array,
    vertexCount: number,
    viewWidth: number,
    viewHeight: number,
    scale = 0.5,
): DepthBuffer {
    const width = Math.max(1, Math.floor(viewWidth * scale));
    const height = Math.max(1, Math.floor(viewHeight * scale));
    const data = new Float32Array(width * height);

    for (let t = 0; t + 2 < vertexCount; t += 3) {
        const i0 = t * 3;
        const i1 = (t + 1) * 3;
        const i2 = (t + 2) * 3;
        const p0 = projectToScreen(
            vp,
            positions[i0],
            positions[i0 + 1],
            positions[i0 + 2],
            viewWidth,
            viewHeight,
        );
        const p1 = projectToScreen(
            vp,
            positions[i1],
            positions[i1 + 1],
            positions[i1 + 2],
            viewWidth,
            viewHeight,
        );
        const p2 = projectToScreen(
            vp,
            positions[i2],
            positions[i2 + 1],
            positions[i2 + 2],
            viewWidth,
            viewHeight,
        );
        if (!p0 || !p1 || !p2) continue;

        const x0 = p0.x * scale;
        const y0 = p0.y * scale;
        const x1 = p1.x * scale;
        const y1 = p1.y * scale;
        const x2 = p2.x * scale;
        const y2 = p2.y * scale;

        const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(denom) < 1e-9) continue;

        const iw0 = 1 / p0.depth;
        const iw1 = 1 / p1.depth;
        const iw2 = 1 / p2.depth;

        const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));

        for (let py = minY; py <= maxY; py++) {
            const cy = py + 0.5;
            for (let px = minX; px <= maxX; px++) {
                const cx = px + 0.5;
                const w0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / denom;
                if (w0 < -0.001) continue;
                const w1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / denom;
                if (w1 < -0.001) continue;
                const w2 = 1 - w0 - w1;
                if (w2 < -0.001) continue;

                const inverseDepth = w0 * iw0 + w1 * iw1 + w2 * iw2;
                const index = py * width + px;
                if (inverseDepth > data[index]) data[index] = inverseDepth;
            }
        }
    }

    return { width, height, scale, data };
}

/**
 * Whether a projected point is the nearest surface at its pixel. `bias` is in world units and
 * absorbs the raster's finite resolution — too tight and front-facing vertices fail against
 * their own surface; too loose and the far side of thin geometry leaks through.
 */
export function isDepthVisible(
    buffer: DepthBuffer,
    screenX: number,
    screenY: number,
    depth: number,
    bias: number,
): boolean {
    // Cell `n` samples at its centre, `n + 0.5`, so the cell nearest a point is floor, not
    // round — rounding lands on the neighbouring cell for the whole lower half of every cell.
    const x = Math.floor(screenX * buffer.scale);
    const y = Math.floor(screenY * buffer.scale);
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return false;
    const nearestInverse = buffer.data[y * buffer.width + x];
    if (nearestInverse <= 0) return true; // no geometry covers this cell
    return depth <= 1 / nearestInverse + bias;
}
