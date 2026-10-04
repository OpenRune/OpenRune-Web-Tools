/**
 * Dev-only: round-trips a cache model through the editor's exporters and importers on the
 * server, where a test can read the numbers directly instead of inferring them from the screen.
 * Returns 404 in production, like the dev cache route it sits beside.
 */
import { CacheFiles, CacheSystem, IndexType } from "@openrune/cache";
import { decodeRSModel, packedHslToRgb } from "@openrune/engine";
import { NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { importGlb, importGltf } from "../../../util/model-io/gltf";
import { exportGlb, exportGltf } from "../../../util/model-io/gltf";
import { exportModelJson, importModelJson } from "../../../util/model-io/model-json";
import { exportObj, importObj } from "../../../util/model-io/obj";
import { encodeRSModel } from "../../../util/model-io/rs-dat";

const CACHE_FILE_PATTERN = /^main_file_cache\.[a-z0-9]+$/i;

export async function GET(request: Request): Promise<NextResponse> {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not available" }, { status: 404 });
    }
    const dir = process.env.OPENRUNE_DEV_CACHE_DIR;
    if (!dir) return NextResponse.json({ error: "No OPENRUNE_DEV_CACHE_DIR" }, { status: 404 });

    const params = new URL(request.url).searchParams;
    const id = Number(params.get("model") ?? "65533");
    const scanLimit = Number(params.get("scan") ?? "0");

    const names = (await readdir(dir)).filter((name) => CACHE_FILE_PATTERN.test(name));
    const entries = await Promise.all(
        names.map(async (name) => {
            const bytes = await readFile(path.join(dir, name));
            return [
                name,
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ] as const;
        }),
    );
    const cache = CacheSystem.fromFiles("dat2", new CacheFiles(new Map(entries)));
    const models = cache.getIndex(IndexType.DAT2.models);

    // Scan mode: round-trip a spread of real models through the .dat encoder and report any
    // whose decoded fields don't come back identical. One model proves little; textured and
    // priority-sorted models exercise paths a single statue never touches.
    if (scanLimit > 0) {
        const ids = Array.from(models.getArchiveIds()).slice(0, scanLimit);
        const mismatches: { id: number; fields: string[] }[] = [];
        let textured = 0;
        let withRenderTypes = 0;
        let withPriorities = 0;
        let checked = 0;
        let failed = 0;

        for (const modelId of ids) {
            const entry = models.getFile(modelId, 0);
            if (!entry) continue;
            try {
                const before = decodeRSModel(
                    modelId,
                    entry.data.buffer.slice(
                        entry.data.byteOffset,
                        entry.data.byteOffset + entry.data.byteLength,
                    ) as ArrayBuffer,
                );
                const after = decodeRSModel(modelId, encodeRSModel(before));
                checked++;
                if (before.faceTextures) textured++;
                if (before.faceRenderTypes) withRenderTypes++;
                if (before.faceRenderPriorities) withPriorities++;

                const a = compareFields(before);
                const b = compareFields(after);
                const fields = Object.keys(a).filter((key) => {
                    // Untextured faces keep an unused UV index that differs between the format's
                    // old and new variants (-1 versus 0). The UVs themselves come out identical,
                    // so this isn't a difference in what the model means.
                    if (key === "textureCoords") return false;
                    return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
                });
                if (fields.length > 0) mismatches.push({ id: modelId, fields });
            } catch (err) {
                failed++;
                if (mismatches.length < 20) {
                    mismatches.push({
                        id: modelId,
                        fields: [`threw: ${err instanceof Error ? err.message : String(err)}`],
                    });
                }
            }
        }

        return NextResponse.json({
            checked,
            failed,
            textured,
            withRenderTypes,
            withPriorities,
            mismatchCount: mismatches.length,
            mismatches: mismatches.slice(0, 20),
        });
    }

    const file = models.getFile(id, 0);
    if (!file) return NextResponse.json({ error: `Model ${id} not found` }, { status: 404 });

    const original = decodeRSModel(
        id,
        file.data.buffer.slice(
            file.data.byteOffset,
            file.data.byteOffset + file.data.byteLength,
        ) as ArrayBuffer,
    );

    // .dat: encode, decode, compare field by field.
    const encoded = encodeRSModel(original);
    const viaDat = decodeRSModel(id, encoded);

    const compare = (def: typeof original) => ({
        vertexCount: def.vertexCount,
        faceCount: def.faceCount,
        positions: hash([def.vertexPositionsX, def.vertexPositionsY, def.vertexPositionsZ]),
        indices: hash([def.faceVertexIndices1, def.faceVertexIndices2, def.faceVertexIndices3]),
        colors: hash([def.faceColors]),
        alphas: def.faceAlphas ? hash([def.faceAlphas]) : null,
        vertexSkins: def.vertexSkins ? hash([def.vertexSkins]) : null,
        faceSkins: def.faceSkins ? hash([def.faceSkins]) : null,
        renderTypes: def.faceRenderTypes ? hash([def.faceRenderTypes]) : null,
        priorities: def.faceRenderPriorities ? hash([def.faceRenderPriorities]) : null,
        textures: def.faceTextures ? hash([def.faceTextures]) : null,
        textureCount: def.textureTriangleCount,
        normals: hash([def.vertexNormalX, def.vertexNormalY, def.vertexNormalZ]),
        uvs: hash([def.faceTextureUVCoordinates]),
    });

    const viaJson = importModelJson(exportModelJson(original));
    const viaObj = importObj(exportObj(original)).def;
    const viaGltf = importGltf(exportGltf(original), id).def;
    const viaGlb = importGlb(exportGlb(original), id).def;

    return NextResponse.json({
        model: id,
        originalBytes: file.data.byteLength,
        encodedBytes: encoded.byteLength,
        original: compare(original),
        dat: compare(viaDat),
        // JSON keeps everything but the derived fields, which are recomputed on import.
        json: compare(decodeRSModel(id, encodeRSModel(viaJson))),
        // OBJ and glTF split shared vertices, so counts grow; geometry should still match.
        obj: {
            vertexCount: viaObj.vertexCount,
            faceCount: viaObj.faceCount,
            bounds: bounds(viaObj),
        },
        gltf: {
            vertexCount: viaGltf.vertexCount,
            faceCount: viaGltf.faceCount,
            bounds: bounds(viaGltf),
        },
        glb: {
            vertexCount: viaGlb.vertexCount,
            faceCount: viaGlb.faceCount,
            bounds: bounds(viaGlb),
        },
        originalBounds: bounds(original),
        gltfLabels: viaGltf.vertexSkins !== null,
        // Which way the surface faces. A model that comes back inside-out looks lit from within.
        outward: {
            original: outwardFraction(original),
            dat: outwardFraction(viaDat),
            obj: outwardFraction(viaObj),
            gltf: outwardFraction(viaGltf),
            glb: outwardFraction(viaGlb),
            // A glTF written the way any other tool writes one: Y up, front faces wound
            // counter-clockwise. This is the case a foreign file exercises.
            foreignGltf: outwardFraction(importGltf(foreignStyleGltf(original), id).def),
            foreignObj: outwardFraction(importObj(foreignStyleObj(original), id).def),
        },
        // How close the colours land after a trip through an RGB-based format, as a mean
        // channel error in 0-255 terms. The packed-HSL palette is coarse, so exact is not
        // expected — but "a few levels off" and "wrong colour entirely" are worlds apart.
        colorError: { obj: colorError(original, viaObj), gltf: colorError(original, viaGltf) },
    });
}

/**
 * Dev-only: reports what the importer makes of an uploaded file, so a test can check the
 * numbers — vertex spread, distinct colours — rather than squinting at a screenshot.
 */
export async function POST(request: Request): Promise<NextResponse> {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not available" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });

    const built = file.name.toLowerCase().endsWith(".glb")
        ? importGlb(await file.arrayBuffer())
        : importGltf(await file.text());
    const def = decodeRSModel(0, encodeRSModel(built.def));

    const colors = new Set<number>();
    for (let f = 0; f < def.faceCount; f++) colors.add(def.faceColors[f]);

    return NextResponse.json({
        vertexCount: def.vertexCount,
        faceCount: def.faceCount,
        bounds: bounds(def),
        distinctColors: colors.size,
        scale: built.scale,
    });
}

/**
 * A glTF written the way another tool would: Y up, and because negating Y mirrors the model,
 * the triangle order reversed so front faces stay front. Used to check that importing a file
 * from elsewhere doesn't turn it inside out.
 */
function foreignStyleGltf(def: ReturnType<typeof decodeRSModel>): string {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let v = 0; v < def.vertexCount; v++) {
        positions.push(def.vertexPositionsX[v], -def.vertexPositionsY[v], def.vertexPositionsZ[v]);
    }
    for (let f = 0; f < def.faceCount; f++) {
        indices.push(
            def.faceVertexIndices1[f],
            def.faceVertexIndices3[f],
            def.faceVertexIndices2[f],
        );
    }

    const positionBytes = Buffer.alloc(positions.length * 4);
    positions.forEach((value, i) => positionBytes.writeFloatLE(value, i * 4));
    const indexBytes = Buffer.alloc(indices.length * 4);
    indices.forEach((value, i) => indexBytes.writeUInt32LE(value, i * 4));
    const binary = Buffer.concat([positionBytes, indexBytes]);

    return JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: def.vertexCount, type: "VEC3" },
            { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
            { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
        ],
        buffers: [
            {
                byteLength: binary.length,
                uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
            },
        ],
    });
}

/** The OBJ equivalent: Y up, with the triangle order reversed to suit. */
function foreignStyleObj(def: ReturnType<typeof decodeRSModel>): string {
    const lines: string[] = [];
    for (let v = 0; v < def.vertexCount; v++) {
        lines.push(
            `v ${def.vertexPositionsX[v]} ${-def.vertexPositionsY[v]} ${def.vertexPositionsZ[v]}`,
        );
    }
    for (let f = 0; f < def.faceCount; f++) {
        lines.push(
            `f ${def.faceVertexIndices1[f] + 1} ${def.faceVertexIndices3[f] + 1} ${
                def.faceVertexIndices2[f] + 1
            }`,
        );
    }
    return lines.join("\n");
}

/**
 * Share of faces whose winding makes them face away from the model's centre. Roughly 1 means
 * the surface is oriented outward as it should be; roughly 0 means it's inside-out, which is
 * what a mirrored import produces and what makes a model look lit from within.
 */
function outwardFraction(def: ReturnType<typeof decodeRSModel>): number {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < def.vertexCount; v++) {
        cx += def.vertexPositionsX[v];
        cy += def.vertexPositionsY[v];
        cz += def.vertexPositionsZ[v];
    }
    cx /= def.vertexCount;
    cy /= def.vertexCount;
    cz /= def.vertexCount;

    let outward = 0;
    let counted = 0;
    for (let f = 0; f < def.faceCount; f++) {
        const a = def.faceVertexIndices1[f];
        const b = def.faceVertexIndices2[f];
        const c = def.faceVertexIndices3[f];
        const ux = def.vertexPositionsX[b] - def.vertexPositionsX[a];
        const uy = def.vertexPositionsY[b] - def.vertexPositionsY[a];
        const uz = def.vertexPositionsZ[b] - def.vertexPositionsZ[a];
        const vx = def.vertexPositionsX[c] - def.vertexPositionsX[a];
        const vy = def.vertexPositionsY[c] - def.vertexPositionsY[a];
        const vz = def.vertexPositionsZ[c] - def.vertexPositionsZ[a];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        // From the centre out to the face.
        const dx =
            (def.vertexPositionsX[a] + def.vertexPositionsX[b] + def.vertexPositionsX[c]) / 3 - cx;
        const dy =
            (def.vertexPositionsY[a] + def.vertexPositionsY[b] + def.vertexPositionsY[c]) / 3 - cy;
        const dz =
            (def.vertexPositionsZ[a] + def.vertexPositionsZ[b] + def.vertexPositionsZ[c]) / 3 - cz;
        const dot = nx * dx + ny * dy + nz * dz;
        if (dot === 0) continue;
        counted++;
        if (dot > 0) outward++;
    }
    return counted === 0 ? 0 : Number((outward / counted).toFixed(3));
}

/** Every field worth comparing between two decodes of the same model. */
function compareFields(def: ReturnType<typeof decodeRSModel>): Record<string, unknown> {
    return {
        vertexCount: def.vertexCount,
        faceCount: def.faceCount,
        positions: hash([def.vertexPositionsX, def.vertexPositionsY, def.vertexPositionsZ]),
        indices: hash([def.faceVertexIndices1, def.faceVertexIndices2, def.faceVertexIndices3]),
        colors: hash([def.faceColors]),
        alphas: def.faceAlphas ? hash([def.faceAlphas]) : null,
        vertexSkins: def.vertexSkins ? hash([def.vertexSkins]) : null,
        faceSkins: def.faceSkins ? hash([def.faceSkins]) : null,
        renderTypes: def.faceRenderTypes ? hash([def.faceRenderTypes]) : null,
        priorities: def.faceRenderPriorities ? hash([def.faceRenderPriorities]) : null,
        priority: def.priority,
        textures: def.faceTextures ? hash([def.faceTextures]) : null,
        textureCoords: def.textureCoordinates ? hash([def.textureCoordinates]) : null,
        textureCount: def.textureTriangleCount,
        textureTriangles: hash([
            def.textureTriangleVertexIndices1,
            def.textureTriangleVertexIndices2,
            def.textureTriangleVertexIndices3,
        ]),
        textureRenderTypes: hash([def.textureRenderTypes]),
        normals: hash([
            def.vertexNormalX,
            def.vertexNormalY,
            def.vertexNormalZ,
            def.vertexNormalMagnitude,
        ]),
        faceNormals: hash([def.faceNormalX, def.faceNormalY, def.faceNormalZ]),
        uvs: hash([def.faceTextureUVCoordinates]),
        mayaGroups: def.animMayaGroups ? def.animMayaGroups.length : null,
    };
}

/** Mean per-channel difference (0-255) between two models' face colours. */
function colorError(
    a: { faceCount: number; faceColors: ArrayLike<number> },
    b: { faceColors: ArrayLike<number> },
): number {
    let total = 0;
    for (let f = 0; f < a.faceCount; f++) {
        const from = packedHslToRgb(a.faceColors[f]);
        const to = packedHslToRgb(b.faceColors[f]);
        total +=
            (Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) + Math.abs(from[2] - to[2])) / 3;
    }
    return Number(((total / a.faceCount) * 255).toFixed(2));
}

/** Order-sensitive digest of numeric arrays; enough to prove two decodes are identical. */
function hash(arrays: ArrayLike<number>[]): string {
    let h = 2166136261;
    for (const array of arrays) {
        for (let i = 0; i < array.length; i++) {
            h ^= array[i] | 0;
            h = Math.imul(h, 16777619);
        }
    }
    return (h >>> 0).toString(16);
}

function bounds(def: {
    vertexCount: number;
    vertexPositionsX: ArrayLike<number>;
    vertexPositionsY: ArrayLike<number>;
    vertexPositionsZ: ArrayLike<number>;
}) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v < def.vertexCount; v++) {
        minX = Math.min(minX, def.vertexPositionsX[v]);
        minY = Math.min(minY, def.vertexPositionsY[v]);
        minZ = Math.min(minZ, def.vertexPositionsZ[v]);
        maxX = Math.max(maxX, def.vertexPositionsX[v]);
        maxY = Math.max(maxY, def.vertexPositionsY[v]);
        maxZ = Math.max(maxZ, def.vertexPositionsZ[v]);
    }
    return [minX, minY, minZ, maxX, maxY, maxZ];
}
