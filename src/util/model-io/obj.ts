import type { RSModelDefinition } from "@openrune/engine";

import { type PlainMesh, faceColorsToRgb, fromPlainMesh } from "./mesh-build";

/**
 * Wavefront OBJ. Colour is written as the `v x y z r g b` extension rather than an MTL sidecar,
 * so a model stays a single file — Blender and MeshLab both read it.
 *
 * OBJ has no concept of vertex labels, so a rig doesn't survive this format. Use JSON or .dat
 * for that.
 */
export function exportObj(def: RSModelDefinition, name = `model_${def.id}`): string {
    const lines: string[] = [
        `# OpenRune export of model ${def.id}`,
        `# ${def.vertexCount} vertices, ${def.faceCount} faces`,
        `o ${name}`,
    ];

    // OBJ colour is per vertex, so each face's colour is pushed to its own three corners; that
    // means splitting shared vertices, exactly as the renderer does.
    //
    // Y is negated because OBJ is read as Y-up while RS model space points +Y down, and the
    // corners are reversed to go with it: negating an axis mirrors the model, which would
    // otherwise leave every face pointing the wrong way.
    const rgb = faceColorsToRgb(def);
    for (let f = 0; f < def.faceCount; f++) {
        const [r, g, b] = rgb[f];
        for (const v of [
            def.faceVertexIndices1[f],
            def.faceVertexIndices3[f],
            def.faceVertexIndices2[f],
        ]) {
            lines.push(
                `v ${def.vertexPositionsX[v]} ${-def.vertexPositionsY[v]} ${
                    def.vertexPositionsZ[v]
                } ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`,
            );
        }
    }
    for (let f = 0; f < def.faceCount; f++) {
        const base = f * 3 + 1; // OBJ indices start at 1.
        lines.push(`f ${base} ${base + 1} ${base + 2}`);
    }
    return `${lines.join("\n")}\n`;
}

export function importObj(text: string, id = 0) {
    const positions: number[] = [];
    const colors: [number, number, number][] = [];
    const indices: number[] = [];
    const faceColors: [number, number, number][] = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) continue;
        const parts = line.split(/\s+/);

        if (parts[0] === "v") {
            // Back from OBJ's Y-up into RS model space.
            positions.push(Number(parts[1]), -Number(parts[2]), Number(parts[3]));
            // The optional colour extension: three more floats after the position.
            colors.push(
                parts.length >= 7
                    ? [Number(parts[4]), Number(parts[5]), Number(parts[6])]
                    : [0.5, 0.5, 0.5],
            );
            continue;
        }

        if (parts[0] !== "f") continue;
        // Each vertex reference is `v`, `v/vt`, `v//vn` or `v/vt/vn`; only the first matters here.
        const corners = parts.slice(1).map((part) => {
            const index = Number(part.split("/")[0]);
            // Negative indices count back from the most recent vertex.
            return index < 0 ? positions.length / 3 + index : index - 1;
        });
        // Polygons are fanned into triangles, which is what the RS format stores. The last two
        // corners swap to match the Y negation above, which mirrors the model.
        for (let i = 1; i + 1 < corners.length; i++) {
            indices.push(corners[0], corners[i + 1], corners[i]);
            faceColors.push(colors[corners[0]] ?? [0.5, 0.5, 0.5]);
        }
    }

    if (indices.length === 0) throw new Error("No faces found in that OBJ file");

    const mesh: PlainMesh = { positions, indices, faceColors, vertexSkins: null };
    return fromPlainMesh(mesh, id);
}
