import type { RSModelDefinition } from "@openrune/engine";

import { type PlainMesh, faceColorsToRgb, fromPlainMesh } from "./mesh-build";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON = 0x4e4f534a; // "JSON"
const GLB_BIN = 0x004e4942; // "BIN"
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Where a rig is parked so it can survive a glTF round trip; glTF has no notion of RS labels. */
const LABEL_EXTRA = "OPENRUNE_vertex_labels";

type GltfJson = Record<string, unknown>;

function buildGltf(def: RSModelDefinition): { json: GltfJson; binary: ArrayBuffer } {
    // Colour is per face in RS and per vertex in glTF, so faces get their own corners — the same
    // split the renderer does. It also keeps flat shading flat.
    const rgb = faceColorsToRgb(def);
    const vertexCount = def.faceCount * 3;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(vertexCount);
    const labels: number[] = [];

    let cursor = 0;
    for (let f = 0; f < def.faceCount; f++) {
        // Reversed, because negating Y below mirrors the model and a mirror flips which side of
        // a triangle is the front. Without this the file opens inside-out in other tools.
        const corners = [
            def.faceVertexIndices1[f],
            def.faceVertexIndices3[f],
            def.faceVertexIndices2[f],
        ];
        const [r, g, b] = rgb[f];
        for (const v of corners) {
            positions[cursor * 3] = def.vertexPositionsX[v];
            // glTF is Y-up with +Y away from the ground; RS model space points +Y down.
            positions[cursor * 3 + 1] = -def.vertexPositionsY[v];
            positions[cursor * 3 + 2] = def.vertexPositionsZ[v];
            colors[cursor * 4] = r;
            colors[cursor * 4 + 1] = g;
            colors[cursor * 4 + 2] = b;
            colors[cursor * 4 + 3] = 1;
            labels.push(def.vertexSkins ? def.vertexSkins[v] : -1);
            indices[cursor] = cursor;
            cursor++;
        }
    }

    const positionBytes = positions.byteLength;
    const colorBytes = colors.byteLength;
    const indexBytes = indices.byteLength;
    const binary = new Uint8Array(positionBytes + colorBytes + indexBytes);
    binary.set(new Uint8Array(positions.buffer), 0);
    binary.set(new Uint8Array(colors.buffer), positionBytes);
    binary.set(new Uint8Array(indices.buffer), positionBytes + colorBytes);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
        minX = Math.min(minX, positions[i * 3]);
        minY = Math.min(minY, positions[i * 3 + 1]);
        minZ = Math.min(minZ, positions[i * 3 + 2]);
        maxX = Math.max(maxX, positions[i * 3]);
        maxY = Math.max(maxY, positions[i * 3 + 1]);
        maxZ = Math.max(maxZ, positions[i * 3 + 2]);
    }

    const json: GltfJson = {
        asset: { version: "2.0", generator: "OpenRune Editor" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: `model_${def.id}` }],
        meshes: [
            {
                name: `model_${def.id}`,
                primitives: [
                    {
                        attributes: { POSITION: 0, COLOR_0: 1 },
                        indices: 2,
                        material: 0,
                        // Only written when there's a rig to carry; an array of -1 would just
                        // be noise for anything else reading the file.
                        ...(def.vertexSkins ? { extras: { [LABEL_EXTRA]: labels } } : {}),
                    },
                ],
            },
        ],
        materials: [
            {
                name: "vertex colours",
                pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
            },
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: FLOAT,
                count: vertexCount,
                type: "VEC3",
                min: [minX, minY, minZ],
                max: [maxX, maxY, maxZ],
            },
            { bufferView: 1, componentType: FLOAT, count: vertexCount, type: "VEC4" },
            { bufferView: 2, componentType: UNSIGNED_INT, count: vertexCount, type: "SCALAR" },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: ARRAY_BUFFER },
            { buffer: 0, byteOffset: positionBytes, byteLength: colorBytes, target: ARRAY_BUFFER },
            {
                buffer: 0,
                byteOffset: positionBytes + colorBytes,
                byteLength: indexBytes,
                target: ELEMENT_ARRAY_BUFFER,
            },
        ],
        buffers: [{ byteLength: binary.byteLength }],
    };

    return { json, binary: binary.buffer as ArrayBuffer };
}

/** `.gltf`: JSON with the buffer inlined as a data URI, so it stays one file. */
export function exportGltf(def: RSModelDefinition): string {
    const { json, binary } = buildGltf(def);
    const base64 = bytesToBase64(new Uint8Array(binary));
    (
        json.buffers as Record<string, unknown>[]
    )[0].uri = `data:application/octet-stream;base64,${base64}`;
    return JSON.stringify(json, null, 2);
}

/** `.glb`: the same document as a binary container — smaller, and what most tools prefer. */
export function exportGlb(def: RSModelDefinition): ArrayBuffer {
    const { json, binary } = buildGltf(def);

    const jsonBytes = padTo4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
    const binBytes = padTo4(new Uint8Array(binary), 0);

    const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
    const out = new ArrayBuffer(total);
    const view = new DataView(out);
    const bytes = new Uint8Array(out);

    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonBytes.length, true);
    view.setUint32(16, GLB_JSON, true);
    bytes.set(jsonBytes, 20);
    const binHeader = 20 + jsonBytes.length;
    view.setUint32(binHeader, binBytes.length, true);
    view.setUint32(binHeader + 4, GLB_BIN, true);
    bytes.set(binBytes, binHeader + 8);

    return out;
}

/** Chunks are 4-byte aligned; JSON pads with spaces, binary with zeroes. */
function padTo4(bytes: Uint8Array, fill: number): Uint8Array {
    const padding = (4 - (bytes.length % 4)) % 4;
    if (padding === 0) return bytes;
    const out = new Uint8Array(bytes.length + padding);
    out.set(bytes);
    out.fill(fill, bytes.length);
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    // Chunked: one giant spread would blow the argument limit on a big model.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

/** Splits a GLB container into its JSON document and binary chunk. */
function parseGlb(buffer: ArrayBuffer): { json: GltfJson; binary: Uint8Array | null } {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a GLB file");

    let offset = 12;
    let json: GltfJson | null = null;
    let binary: Uint8Array | null = null;
    while (offset + 8 <= buffer.byteLength) {
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        const start = offset + 8;
        if (type === GLB_JSON) {
            json = JSON.parse(
                new TextDecoder().decode(new Uint8Array(buffer, start, length)),
            ) as GltfJson;
        } else if (type === GLB_BIN) {
            binary = new Uint8Array(buffer, start, length);
        }
        offset = start + length;
    }
    if (!json) throw new Error("That GLB has no JSON chunk");
    return { json, binary };
}

type Accessor = {
    bufferView?: number;
    componentType: number;
    count: number;
    type: string;
    byteOffset?: number;
    normalized?: boolean;
};
type BufferView = { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number };
type GltfNode = {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
};

const COMPONENT_SIZE: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * Reads an accessor into a flat array of numbers.
 *
 * Handles the two things real exporters do that a naive reader trips over: interleaved data,
 * where several attributes share a buffer view and are spaced by `byteStride`, and normalized
 * integers, where colours arrive as bytes or shorts meaning 0-1.
 */
function readAccessor(json: GltfJson, binary: Uint8Array | null, index: number): Float32Array {
    const accessor = (json.accessors as Accessor[])[index];
    const views = (json.bufferViews as BufferView[]) ?? [];
    const view = views[accessor.bufferView ?? 0];
    const components = TYPE_COMPONENTS[accessor.type] ?? 1;
    const out = new Float32Array(accessor.count * components);

    // A sparse or view-less accessor means "all zeroes", which is a valid document.
    if (!view) return out;

    const buffers = json.buffers as { uri?: string; byteLength: number }[];
    const source = buffers[view.buffer];

    let bytes: Uint8Array;
    if (source.uri) {
        if (!source.uri.startsWith("data:")) {
            throw new Error(
                "This glTF keeps its data in a separate file — export it as .glb instead",
            );
        }
        bytes = base64ToBytes(source.uri.slice(source.uri.indexOf(",") + 1));
    } else if (binary) {
        bytes = binary;
    } else {
        throw new Error("That glTF references a buffer it doesn't contain");
    }

    const size = COMPONENT_SIZE[accessor.componentType];
    if (!size) throw new Error(`Unsupported glTF component type ${accessor.componentType}`);
    const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : size * components;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let i = 0; i < accessor.count; i++) {
        for (let c = 0; c < components; c++) {
            const at = start + i * stride + c * size;
            let value: number;
            switch (accessor.componentType) {
                case 5120:
                    value = dv.getInt8(at);
                    if (accessor.normalized) value = Math.max(value / 127, -1);
                    break;
                case 5121:
                    value = dv.getUint8(at);
                    if (accessor.normalized) value /= 255;
                    break;
                case 5122:
                    value = dv.getInt16(at, true);
                    if (accessor.normalized) value = Math.max(value / 32767, -1);
                    break;
                case 5123:
                    value = dv.getUint16(at, true);
                    if (accessor.normalized) value /= 65535;
                    break;
                case UNSIGNED_INT:
                    value = dv.getUint32(at, true);
                    break;
                default:
                    value = dv.getFloat32(at, true);
                    break;
            }
            out[i * components + c] = value;
        }
    }
    return out;
}

/** Node transform as a 4x4 matrix, from either the `matrix` form or translation/rotation/scale. */
function nodeMatrix(node: GltfNode): number[] {
    if (node.matrix) return node.matrix;

    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale ?? [1, 1, 1];

    // Column-major, as glTF stores matrices.
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;

    return [
        (1 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0,
        (xy - wz) * sy,
        (1 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1 - (xx + yy)) * sz,
        0,
        tx,
        ty,
        tz,
        1,
    ];
}

function multiplyMatrix(a: number[], b: number[]): number[] {
    const out = new Array<number>(16).fill(0);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
            out[column * 4 + row] = sum;
        }
    }
    return out;
}

function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

/**
 * Collects every primitive in the document into one mesh, with each node's transform applied.
 * Real exports are rarely a single primitive at the origin — a vehicle arrives as body, glass
 * and wheels, each under its own node — and taking only the first gives you a fragment.
 */
function fromGltfDocument(json: GltfJson, binary: Uint8Array | null, id: number) {
    const meshes = (json.meshes as { primitives: Record<string, unknown>[] }[] | undefined) ?? [];
    if (meshes.length === 0) throw new Error("That glTF has no mesh to import");

    const nodes = (json.nodes as GltfNode[] | undefined) ?? [];
    const materials =
        (json.materials as
            | { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]
            | undefined) ?? [];

    const positions: number[] = [];
    const indices: number[] = [];
    const faceColors: [number, number, number][] = [];
    const labels: number[] = [];
    let anyLabels = false;

    const addPrimitive = (primitive: Record<string, unknown>, matrix: number[]): void => {
        const attributes = primitive.attributes as Record<string, number> | undefined;
        if (!attributes || attributes.POSITION === undefined) return;

        const raw = readAccessor(json, binary, attributes.POSITION);
        const base = positions.length / 3;
        for (let i = 0; i + 2 < raw.length; i += 3) {
            const [x, y, z] = transformPoint(matrix, raw[i], raw[i + 1], raw[i + 2]);
            // glTF is +Y up, RS model space is +Y down.
            positions.push(x, -y, z);
        }

        const localCount = raw.length / 3;
        const localIndices =
            primitive.indices === undefined
                ? Array.from({ length: localCount }, (_, i) => i)
                : Array.from(readAccessor(json, binary, primitive.indices as number));

        const vertexColors =
            attributes.COLOR_0 === undefined
                ? null
                : readAccessor(json, binary, attributes.COLOR_0);
        const colorStride = vertexColors ? Math.round(vertexColors.length / localCount) : 0;

        // Most exporters colour by material rather than per vertex, so that's the fallback
        // before grey — it's why an untouched import used to come out uniformly grey.
        const materialIndex = primitive.material as number | undefined;
        const factor =
            materialIndex !== undefined
                ? materials[materialIndex]?.pbrMetallicRoughness?.baseColorFactor
                : undefined;
        const materialColor: [number, number, number] = factor
            ? [factor[0], factor[1], factor[2]]
            : [0.5, 0.5, 0.5];

        const extras = primitive.extras as Record<string, unknown> | undefined;
        const primitiveLabels =
            extras && Array.isArray(extras[LABEL_EXTRA]) ? (extras[LABEL_EXTRA] as number[]) : null;
        if (primitiveLabels) anyLabels = true;
        for (let v = 0; v < localCount; v++) {
            labels.push(primitiveLabels ? primitiveLabels[v] ?? -1 : -1);
        }

        for (let i = 0; i + 2 < localIndices.length; i += 3) {
            // Reversed to match the Y negation above: mirroring the model would otherwise leave
            // every face pointing inwards, which reads as the model being lit from the inside.
            indices.push(
                base + localIndices[i],
                base + localIndices[i + 2],
                base + localIndices[i + 1],
            );
            const first = localIndices[i];
            faceColors.push(
                vertexColors && colorStride >= 3
                    ? [
                          vertexColors[first * colorStride],
                          vertexColors[first * colorStride + 1],
                          vertexColors[first * colorStride + 2],
                      ]
                    : materialColor,
            );
        }
    };

    const walk = (nodeIndex: number, parent: number[]): void => {
        const node = nodes[nodeIndex];
        if (!node) return;
        const matrix = multiplyMatrix(parent, nodeMatrix(node));
        if (node.mesh !== undefined) {
            for (const primitive of meshes[node.mesh]?.primitives ?? [])
                addPrimitive(primitive, matrix);
        }
        for (const child of node.children ?? []) walk(child, matrix);
    };

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const scenes = json.scenes as { nodes?: number[] }[] | undefined;
    const roots = scenes?.[(json.scene as number) ?? 0]?.nodes;
    if (roots && roots.length > 0) {
        for (const root of roots) walk(root, identity);
    } else if (nodes.length > 0) {
        for (let i = 0; i < nodes.length; i++) walk(i, identity);
    } else {
        // No node graph at all: take the meshes where they lie.
        for (const mesh of meshes)
            for (const primitive of mesh.primitives) addPrimitive(primitive, identity);
    }

    if (indices.length === 0) throw new Error("That glTF has no triangles to import");

    const mesh: PlainMesh = {
        positions,
        indices,
        faceColors,
        vertexSkins: anyLabels ? labels : null,
    };
    return fromPlainMesh(mesh, id);
}

export function importGlb(buffer: ArrayBuffer, id = 0) {
    const { json, binary } = parseGlb(buffer);
    return fromGltfDocument(json, binary, id);
}

export function importGltf(text: string, id = 0) {
    return fromGltfDocument(JSON.parse(text) as GltfJson, null, id);
}
