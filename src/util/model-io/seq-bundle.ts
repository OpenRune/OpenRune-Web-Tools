import { ConfigType, IndexType } from "@openrune/cache";
import type { RSModelDefinition, SeqFrame, SeqType } from "@openrune/engine";

import { buildAnimPack, encodeAnimPack } from "./anim-pack";
import { encodeRSModel } from "./rs-dat";
import { encodeSeqType } from "./seq-dat";
import { type ZipEntry, createZip } from "./zip";

/** Where a file belongs in a cache, or null for anything that isn't a cache file. */
export type PackTarget = {
    index: number;
    indexName: string;
    archive: number;
    /** Null when the thing has no id yet — a sequence made here, say. */
    file: number | null;
};

export type BundleFile = {
    path: string;
    data: Uint8Array;
    target: PackTarget | null;
    note: string;
};

export type BundlePart = "model" | "frames" | "config" | "toml";

/** Where the animation's frames will be packed, and whether that spot is actually free. */
export type FrameTarget = {
    /** Archive id in index 0. Every frame becomes a file inside it, numbered from 0.  */
    archive: number;
    /** False when the cache already has something in that archive. */
    free: boolean;
    /** Set when it is not free, saying what is already there. */
    conflict?: string;
};

/** One tickable line in the export dialog: a thing you can choose to include, and why. */
export type BundleCandidate = {
    id: BundlePart;
    label: string;
    files: BundleFile[];
    bytes: number;
    /** True when it differs from what the cache already has. */
    changed: boolean;
    /** What it is, or why it's unticked. */
    note: string;
    /** Ticked to begin with — the things that have actually changed. */
    ticked: boolean;
};

export type BundlePlan = {
    candidates: BundleCandidate[];
    /** Name for the download, without an extension. */
    stem: string;
    /** The model's id, for the "pack to" column. */
    modelId: number | null;
    /** Where the frames will land, so the dialog can show it and let it be changed. */
    frameTarget: FrameTarget | null;
};

export type BundleResult = { blob: Blob; fileName: string; files: BundleFile[] };

export type BundleInput = {
    model: { def: RSModelDefinition; id: number; changed: boolean } | null;
    sequence: {
        seq: SeqType;
        /**
         * The frames as they actually are — the sequence's own ops with your keys written over
         * them and the in-betweens filled in. Not the raw decoded frames: an animation started
         * here has an empty raw frame for every index, so exporting those would ship nothing.
         */
        frames: { index: number; frame: SeqFrame }[];
        id: number | null;
        name: string | null;
        framesChanged: boolean;
        configChanged: boolean;
        /** Which archive the frames pack into, and whether it's free. */
        target: FrameTarget;
    } | null;
};

function toml(lines: (string | null)[]): string {
    return `${lines.filter((line) => line !== null).join("\n")}\n`;
}

function tomlString(value: string): string {
    return JSON.stringify(value);
}

function tomlArray(values: readonly number[]): string {
    return `[${values.join(", ")}]`;
}

/**
 * The sequence's settings as TOML, so the bundle carries something a human can read and a
 * packer can consume without decoding `config.dat`.
 *
 * Field names follow OpenRune's `SeqType` rather than this engine's, since that's what tooling
 * downstream expects — `frameDelays` here is `frameLengths` in the decoder.
 */
export function seqToToml(
    seq: SeqType,
    meta: { id: number | null; name: string | null; modelId: number | null },
): string {
    return toml([
        "# Sequence config, exported from the OpenRune editor.",
        "# Pack alongside config.dat, or use this instead of it.",
        "",
        "[sequence]",
        meta.id !== null ? `id = ${meta.id}` : "# id = <assign one when packing>",
        meta.name !== null ? `name = ${tomlString(meta.name)}` : null,
        meta.modelId !== null ? `model = ${meta.modelId}` : null,
        "",
        "[config]",
        `frameIds = ${tomlArray(seq.frameIds)}`,
        `frameDelays = ${tomlArray(seq.frameLengths)}`,
        seq.chatFrameIds ? `chatFrameIds = ${tomlArray(seq.chatFrameIds)}` : null,
        `frameStep = ${seq.frameStep}`,
        `stretches = ${seq.stretches}`,
        `looping = ${seq.looping}`,
        `maxLoops = ${seq.maxLoops}`,
        `priority = ${seq.priority}`,
        `forcedPriority = ${seq.forcedPriority}`,
        `precedenceAnimating = ${seq.precedenceAnimating}`,
        `replyMode = ${seq.replyMode}`,
        `leftHandItem = ${seq.leftHandItem}`,
        `rightHandItem = ${seq.rightHandItem}`,
        seq.masks ? `mask = ${tomlArray(seq.masks.slice(0, -1))}` : null,
        seq.skeletalId >= 0 ? `skeletalId = ${seq.skeletalId}` : null,
        seq.skeletalId >= 0 ? `skeletalRangeBegin = ${seq.skeletalStart}` : null,
        seq.skeletalId >= 0 ? `skeletalRangeEnd = ${seq.skeletalEnd}` : null,
    ]);
}

function sum(files: readonly BundleFile[]): number {
    return files.reduce((total, file) => total + file.data.length, 0);
}

/**
 * Works out everything that *could* go in an export, encodes it, and says which parts have
 * actually changed.
 *
 * Everything is offered rather than only the changed parts: re-packing an untouched model is
 * usually pointless, but "usually" isn't "never", and a dialog that hides the option is worse
 * than one that leaves it unticked. Encoding up front is what lets the dialog show real sizes.
 */
export function planBundle(input: BundleInput): BundlePlan {
    const candidates: BundleCandidate[] = [];
    const sequence = input.sequence;

    if (input.model) {
        const files: BundleFile[] = [
            {
                path: "model.dat",
                data: new Uint8Array(encodeRSModel(input.model.def)),
                target: {
                    index: IndexType.DAT2.models,
                    indexName: "models",
                    archive: input.model.id,
                    file: 0,
                },
                note: `${input.model.def.vertexCount} vertices, ${input.model.def.faceCount} faces`,
            },
        ];
        candidates.push({
            id: "model",
            label: "model.dat",
            files,
            bytes: sum(files),
            changed: input.model.changed,
            note: input.model.changed
                ? "the model, including any rig edits"
                : "unchanged — the same bytes the cache already has",
            ticked: input.model.changed,
        });
    }

    if (sequence) {
        // Every frame in one file rather than fifty loose ones, carrying the archive they
        // belong to so a packer needs nothing else. Empty frames are dropped on the way.
        const { pack, skipped, frameIds } = buildAnimPack(sequence.target.archive, sequence.frames);
        // The config has to point at where the frames actually ended up.
        sequence.seq.frameIds = frameIds;
        sequence.seq.frameLengths = sequence.seq.frameLengths.slice(0, frameIds.length);

        if (pack.frames.length > 0) {
            const frameFiles: BundleFile[] = [
                {
                    path: "frames.rsanim",
                    data: encodeAnimPack(pack),
                    target: {
                        index: IndexType.DAT2.animations,
                        indexName: "animations",
                        archive: sequence.target.archive,
                        file: null,
                    },
                    note:
                        `${pack.frames.length} frame${
                            pack.frames.length === 1 ? "" : "s"
                        }, files 0–${pack.frames.length - 1}` +
                        (skipped.length > 0 ? `, ${skipped.length} empty dropped` : ""),
                },
            ];
            candidates.push({
                id: "frames",
                label: `frames.rsanim — ${pack.frames.length} frame${
                    pack.frames.length === 1 ? "" : "s"
                }`,
                files: frameFiles,
                bytes: sum(frameFiles),
                changed: sequence.framesChanged,
                note: sequence.framesChanged
                    ? sequence.target.free
                        ? "the posed frames, with your keys in them"
                        : `the posed frames — but ${
                              sequence.target.conflict ?? "that archive is taken"
                          }`
                    : "unchanged — no keys have been edited",
                ticked: sequence.framesChanged,
            });
        }

        const configFiles: BundleFile[] = [
            {
                path: "config.dat",
                data: encodeSeqType(sequence.seq),
                target: {
                    index: IndexType.DAT2.configs,
                    indexName: "configs",
                    archive: ConfigType.DAT2.seqs,
                    file: sequence.id,
                },
                note: `${sequence.seq.frameIds.length} frames, priority ${sequence.seq.priority}`,
            },
        ];
        // Ticked whenever frames are going out too: frames without the config that points at
        // them are just loose files.
        const configWanted = sequence.configChanged || sequence.framesChanged;
        candidates.push({
            id: "config",
            label: "config.dat",
            files: configFiles,
            bytes: sum(configFiles),
            changed: sequence.configChanged,
            note: sequence.configChanged
                ? "the sequence's settings"
                : sequence.framesChanged
                ? "unchanged, but it's what points at the frames"
                : "unchanged — nothing on the Config tab has been edited",
            ticked: configWanted,
        });

        const tomlFiles: BundleFile[] = [
            {
                path: "anim.toml",
                data: new TextEncoder().encode(
                    seqToToml(sequence.seq, {
                        id: sequence.id,
                        name: sequence.name,
                        modelId: input.model?.id ?? null,
                    }),
                ),
                target: null,
                note: "the same settings as config.dat, readable",
            },
        ];
        candidates.push({
            id: "toml",
            label: "anim.toml",
            files: tomlFiles,
            bytes: sum(tomlFiles),
            changed: false,
            note: "for a packer that reads TOML, or for reading yourself",
            ticked: configWanted,
        });
    }

    const stem =
        sequence?.name ??
        (typeof sequence?.id === "number" ? `seq_${sequence.id}` : null) ??
        `model_${input.model?.id ?? 0}`;

    return {
        candidates,
        stem,
        modelId: input.model?.id ?? null,
        frameTarget: sequence?.target ?? null,
    };
}

/**
 * Packs the chosen parts. A lone `model.dat` comes back as itself — a single file doesn't need
 * a container around it — and anything else as a zip.
 */
export function buildBundle(plan: BundlePlan, chosen: readonly BundlePart[]): BundleResult {
    const picked = new Set(chosen);
    const files = plan.candidates
        .filter((candidate) => picked.has(candidate.id))
        .flatMap((candidate) => candidate.files);

    if (files.length === 1 && files[0].path === "model.dat") {
        return {
            blob: new Blob([files[0].data as BlobPart], { type: "application/octet-stream" }),
            fileName: `model_${plan.modelId ?? 0}.dat`,
            files,
        };
    }

    const entries: ZipEntry[] = files.map((file) => ({ name: file.path, data: file.data }));
    return { blob: createZip(entries), fileName: `${plan.stem}.zip`, files };
}
