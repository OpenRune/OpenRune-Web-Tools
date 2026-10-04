import { type RSModelDefinition, decodeRSModel } from "@openrune/engine";

import { exportGlb, exportGltf, importGlb, importGltf } from "./gltf";
import { mergeModels } from "./merge";
import { exportModelJson, importModelJson } from "./model-json";
import { exportObj, importObj } from "./obj";
import { encodeRSModel } from "./rs-dat";

export { encodeRSModel, mergeModels };

export type ModelFormat = "dat" | "json" | "obj" | "gltf" | "glb";

export const MODEL_FORMATS: { id: ModelFormat; label: string; extension: string; note: string }[] =
    [
        {
            id: "dat",
            label: "RS model (.dat)",
            extension: "dat",
            note: "The cache's own format — labels and all",
        },
        { id: "json", label: "JSON (.json)", extension: "json", note: "Every field, lossless" },
        {
            id: "obj",
            label: "Wavefront (.obj)",
            extension: "obj",
            note: "Geometry and colour; no labels",
        },
        {
            id: "gltf",
            label: "glTF (.gltf)",
            extension: "gltf",
            note: "Geometry and colour, labels in extras",
        },
        {
            id: "glb",
            label: "glTF binary (.glb)",
            extension: "glb",
            note: "Same as glTF, single binary file",
        },
    ];

/** Picks a format from a file name, so opening a file doesn't need a dropdown first. */
export function formatFromFileName(name: string): ModelFormat | null {
    const extension = name.toLowerCase().split(".").pop() ?? "";
    switch (extension) {
        case "dat":
            return "dat";
        case "json":
            return "json";
        case "obj":
            return "obj";
        case "gltf":
            return "gltf";
        case "glb":
            return "glb";
        default:
            return null;
    }
}

/**
 * Fills in the data the RS format derives rather than stores — vertex and face normals, and the
 * per-face UVs — by round-tripping the definition through the cache format. The engine computes
 * both while decoding and doesn't expose them separately, so this borrows that work instead of
 * duplicating the maths, and proves the encoder on every import as a side effect.
 */
export function finalizeImportedModel(def: RSModelDefinition): RSModelDefinition {
    return decodeRSModel(def.id, encodeRSModel(def));
}

export type ExportedModel = { data: string | ArrayBuffer; mime: string; extension: string };

/** An imported model, plus anything the user should know about how it was interpreted. */
export type ImportedModel = { def: RSModelDefinition; note: string | null };

function noteForScale(scale: number): string | null {
    if (scale === 1) return null;
    // Whole numbers where possible; a "×64.0000001" reads as a bug.
    const shown = scale >= 10 ? Math.round(scale) : Number(scale.toFixed(2));
    return `Scaled ×${shown} — the file was authored in much smaller units than RS uses, and whole-number positions would have collapsed it.`;
}

export function exportModel(def: RSModelDefinition, format: ModelFormat): ExportedModel {
    switch (format) {
        case "dat":
            return { data: encodeRSModel(def), mime: "application/octet-stream", extension: "dat" };
        case "json":
            return { data: exportModelJson(def), mime: "application/json", extension: "json" };
        case "obj":
            return { data: exportObj(def), mime: "text/plain", extension: "obj" };
        case "gltf":
            return { data: exportGltf(def), mime: "model/gltf+json", extension: "gltf" };
        case "glb":
            return { data: exportGlb(def), mime: "model/gltf-binary", extension: "glb" };
    }
}

export async function importModel(file: File, format: ModelFormat, id = 0): Promise<ImportedModel> {
    switch (format) {
        case "dat":
            // Already the cache's format: the engine's decoder does everything, derived data too.
            return { def: decodeRSModel(id, await file.arrayBuffer()), note: null };
        case "json":
            return { def: finalizeImportedModel(importModelJson(await file.text())), note: null };
        case "obj": {
            const built = importObj(await file.text(), id);
            return { def: finalizeImportedModel(built.def), note: noteForScale(built.scale) };
        }
        case "gltf": {
            const built = importGltf(await file.text(), id);
            return { def: finalizeImportedModel(built.def), note: noteForScale(built.scale) };
        }
        case "glb": {
            const built = importGlb(await file.arrayBuffer(), id);
            return { def: finalizeImportedModel(built.def), note: noteForScale(built.scale) };
        }
    }
}

/** Hands a blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: Safari needs the URL to outlive the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Hands a finished export to the browser as a download. */
export function downloadExport(exported: ExportedModel, baseName: string): void {
    const blob = new Blob([exported.data], { type: exported.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.${exported.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: Safari needs the URL to outlive the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
