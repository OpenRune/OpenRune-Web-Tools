import { mat4, vec3 } from "gl-matrix";

import type { RSModelDefinition } from "../model/rs-model-format";
import { COSINE, SINE } from "./rs-trig";
import type { SeqFrame } from "./seq-frame";
import { SeqTransformType } from "./seq-transform-type";
import type { SkeletalBase } from "./skeletal/skeletal-base";
import type { SkeletalSeq } from "./skeletal/skeletal-seq";

/** Groups vertex/face indices by their animation label (0-255), e.g. `groups[3]` = every vertex labelled 3. */
export function buildLabelGroups(skins: Int32Array | null, count: number): number[][] {
    if (!skins) return [];

    let highestLabel = -1;
    const labelCounts: number[] = [];
    for (let i = 0; i < count; i++) {
        const label = skins[i];
        if (label >= 0) {
            labelCounts[label] = (labelCounts[label] ?? 0) + 1;
            if (label > highestLabel) highestLabel = label;
        }
    }

    const groups: number[][] = new Array(highestLabel + 1);
    const cursors: number[] = new Array(highestLabel + 1).fill(0);
    for (let i = 0; i <= highestLabel; i++) groups[i] = new Array(labelCounts[i] ?? 0);

    for (let i = 0; i < count; i++) {
        const label = skins[i];
        if (label >= 0) groups[label][cursors[label]++] = i;
    }
    return groups;
}

/** A decoded model's mutable pose state — separate from the immutable decoded `RSModelDefinition`. */
export type PosedModel = {
    verticesX: Int32Array;
    verticesY: Int32Array;
    verticesZ: Int32Array;
    faceAlphas: Int8Array;
    faceColors: Int16Array;
};

export function createPosedModel(def: RSModelDefinition): PosedModel {
    return {
        verticesX: def.vertexPositionsX.slice(),
        verticesY: def.vertexPositionsY.slice(),
        verticesZ: def.vertexPositionsZ.slice(),
        faceAlphas: def.faceAlphas ? def.faceAlphas.slice() : new Int8Array(def.faceCount),
        faceColors: def.faceColors.slice(),
    };
}

export function resetPose(pose: PosedModel, def: RSModelDefinition): void {
    pose.verticesX.set(def.vertexPositionsX);
    pose.verticesY.set(def.vertexPositionsY);
    pose.verticesZ.set(def.vertexPositionsZ);
    if (def.faceAlphas) pose.faceAlphas.set(def.faceAlphas);
    else pose.faceAlphas.fill(0);
    pose.faceColors.set(def.faceColors);
}

/**
 * Recomputes the pivot as the centroid (in current pose space) of a base group's labelled
 * vertices, plus an optional authored offset. Used both for explicit ORIGIN ops and for the
 * implicit pivot-recompute that TRANSLATE/ROTATE/SCALE trigger via `resetOriginGroups`.
 */
function computeOrigin(
    pose: PosedModel,
    vertexLabelGroups: number[][],
    labels: number[],
    tx: number,
    ty: number,
    tz: number,
): { x: number; y: number; z: number } {
    const { verticesX, verticesY, verticesZ } = pose;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;
    for (const label of labels) {
        const group = vertexLabelGroups[label];
        if (!group) continue;
        for (const v of group) {
            sumX += verticesX[v];
            sumY += verticesY[v];
            sumZ += verticesZ[v];
            count++;
        }
    }
    if (count > 0) {
        return {
            x: tx + Math.trunc(sumX / count),
            y: ty + Math.trunc(sumY / count),
            z: tz + Math.trunc(sumZ / count),
        };
    }
    return { x: tx, y: ty, z: tz };
}

/** Old-style (pre-skeletal) frame animation: pivot-group translate/rotate/scale/alpha/light. */
export function animateOldStyleFrame(
    pose: PosedModel,
    vertexLabelGroups: number[][],
    faceLabelGroups: number[][],
    frame: SeqFrame,
): void {
    if (vertexLabelGroups.length === 0) return;

    let origin = { x: 0, y: 0, z: 0 };
    const base = frame.base;

    for (let i = 0; i < frame.transformCount; i++) {
        const group = frame.transformGroups[i];
        const resetGroup = frame.resetOriginGroups[i];
        if (resetGroup >= 0) {
            origin = computeOrigin(pose, vertexLabelGroups, base.labels[resetGroup], 0, 0, 0);
        }
        applyTransform(
            pose,
            vertexLabelGroups,
            faceLabelGroups,
            origin,
            base.types[group],
            base.labels[group],
            frame.transformX[i],
            frame.transformY[i],
            frame.transformZ[i],
        );
    }
}

function applyTransform(
    pose: PosedModel,
    vertexLabelGroups: number[][],
    faceLabelGroups: number[][],
    origin: { x: number; y: number; z: number },
    type: SeqTransformType,
    labels: number[],
    tx: number,
    ty: number,
    tz: number,
): void {
    const { verticesX, verticesY, verticesZ } = pose;

    switch (type) {
        case SeqTransformType.ORIGIN: {
            const next = computeOrigin(pose, vertexLabelGroups, labels, tx, ty, tz);
            origin.x = next.x;
            origin.y = next.y;
            origin.z = next.z;
            break;
        }
        case SeqTransformType.TRANSLATE:
            for (const label of labels) {
                const group = vertexLabelGroups[label];
                if (!group) continue;
                for (const v of group) {
                    verticesX[v] += tx;
                    verticesY[v] += ty;
                    verticesZ[v] += tz;
                }
            }
            break;
        case SeqTransformType.ROTATE:
            for (const label of labels) {
                const group = vertexLabelGroups[label];
                if (!group) continue;
                for (const v of group) {
                    verticesX[v] -= origin.x;
                    verticesY[v] -= origin.y;
                    verticesZ[v] -= origin.z;

                    const angleX = (tx & 0xff) * 8;
                    const angleY = (ty & 0xff) * 8;
                    const angleZ = (tz & 0xff) * 8;

                    if (angleZ !== 0) {
                        const sin = SINE[angleZ];
                        const cos = COSINE[angleZ];
                        const t = (sin * verticesY[v] + cos * verticesX[v]) >> 16;
                        verticesY[v] = (cos * verticesY[v] - sin * verticesX[v]) >> 16;
                        verticesX[v] = t;
                    }
                    if (angleX !== 0) {
                        const sin = SINE[angleX];
                        const cos = COSINE[angleX];
                        const t = (cos * verticesY[v] - sin * verticesZ[v]) >> 16;
                        verticesZ[v] = (sin * verticesY[v] + cos * verticesZ[v]) >> 16;
                        verticesY[v] = t;
                    }
                    if (angleY !== 0) {
                        const sin = SINE[angleY];
                        const cos = COSINE[angleY];
                        const t = (sin * verticesZ[v] + cos * verticesX[v]) >> 16;
                        verticesZ[v] = (cos * verticesZ[v] - sin * verticesX[v]) >> 16;
                        verticesX[v] = t;
                    }

                    verticesX[v] += origin.x;
                    verticesY[v] += origin.y;
                    verticesZ[v] += origin.z;
                }
            }
            break;
        case SeqTransformType.SCALE:
            for (const label of labels) {
                const group = vertexLabelGroups[label];
                if (!group) continue;
                for (const v of group) {
                    verticesX[v] -= origin.x;
                    verticesY[v] -= origin.y;
                    verticesZ[v] -= origin.z;

                    verticesX[v] = Math.trunc((tx * verticesX[v]) / 128);
                    verticesY[v] = Math.trunc((ty * verticesY[v]) / 128);
                    verticesZ[v] = Math.trunc((tz * verticesZ[v]) / 128);

                    verticesX[v] += origin.x;
                    verticesY[v] += origin.y;
                    verticesZ[v] += origin.z;
                }
            }
            break;
        case SeqTransformType.ALPHA:
            for (const label of labels) {
                const group = faceLabelGroups[label];
                if (!group) continue;
                for (const f of group) {
                    let newAlpha = (pose.faceAlphas[f] & 0xff) + tx * 8;
                    if (newAlpha < 0) newAlpha = 0;
                    else if (newAlpha > 255) newAlpha = 255;
                    pose.faceAlphas[f] = newAlpha;
                }
            }
            break;
        case SeqTransformType.LIGHT:
            for (const label of labels) {
                const group = faceLabelGroups[label];
                if (!group) continue;
                for (const f of group) {
                    const color = pose.faceColors[f];
                    let hue = (color >> 10) & 0x3f;
                    let saturation = (color >> 7) & 0x7;
                    let lightness = color & 0x7f;
                    hue = (hue + tx) & 0x3f;
                    saturation = Math.max(0, Math.min(7, saturation + ty));
                    lightness = Math.max(0, Math.min(127, lightness + tz));
                    pose.faceColors[f] = (hue << 10) + (saturation << 7) + lightness;
                }
            }
            break;
    }
}

/** Skeletal (Maya) animation: per-vertex linear-blend skinning driven by curve-evaluated bone matrices. */
export function animateSkeletalFrame(
    def: RSModelDefinition,
    pose: PosedModel,
    skeletalBase: SkeletalBase,
    skeletalSeq: SkeletalSeq,
    faceLabelGroups: number[][],
    frame: number,
): void {
    skeletalBase.updateAnimMatrices(skeletalSeq, frame);

    const groups = def.animMayaGroups;
    const scales = def.animMayaScales;
    if (!groups || !scales) return;

    const scratch = mat4.create();
    const boneMatrix = mat4.create();
    const scaleMatrix = mat4.create();
    const scaleVec = vec3.create();

    for (let v = 0; v < def.vertexCount; v++) {
        const group = groups[v];
        if (!group || group.length === 0) continue;
        const vertexScales = scales[v];

        mat4.set(scratch, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        for (let i = 0; i < group.length; i++) {
            const bone = skeletalBase.getBone(group[i]);
            if (!bone) continue;
            const scale = vertexScales[i] / 255;
            vec3.set(scaleVec, scale, scale, scale);
            mat4.fromScaling(scaleMatrix, scaleVec);
            mat4.mul(boneMatrix, scaleMatrix, bone.getFinalMatrix(skeletalSeq.poseId));
            mat4.add(scratch, scratch, boneMatrix);
        }

        transformVertex(pose, v, scratch);
    }

    if (skeletalSeq.hasAlphaTransform) {
        applySkeletalAlpha(pose, skeletalSeq, faceLabelGroups, frame);
    }
}

/** Swaps a posed model's mutated arrays into a copy of the original definition, ready to relight/mesh. */
export function applyPoseToDefinition(def: RSModelDefinition, pose: PosedModel): RSModelDefinition {
    return {
        ...def,
        vertexPositionsX: pose.verticesX,
        vertexPositionsY: pose.verticesY,
        vertexPositionsZ: pose.verticesZ,
        faceAlphas: pose.faceAlphas,
        faceColors: pose.faceColors,
    };
}

function transformVertex(pose: PosedModel, v: number, m: mat4): void {
    const vx = pose.verticesX[v];
    const vy = -pose.verticesY[v];
    const vz = -pose.verticesZ[v];
    pose.verticesX[v] = Math.round(m[0] * vx + m[4] * vy + m[8] * vz + m[12]);
    pose.verticesY[v] = -Math.round(m[1] * vx + m[5] * vy + m[9] * vz + m[13]);
    pose.verticesZ[v] = -Math.round(m[2] * vx + m[6] * vy + m[10] * vz + m[14]);
}

function applySkeletalAlpha(
    pose: PosedModel,
    skeletalSeq: SkeletalSeq,
    faceLabelGroups: number[][],
    frame: number,
): void {
    const base = skeletalSeq.base;
    for (let i = 0; i < base.count; i++) {
        if (base.types[i] !== SeqTransformType.ALPHA) continue;
        const curve = skeletalSeq.curves[i]?.[0];
        if (!curve) continue;

        for (const label of base.labels[i]) {
            const group = faceLabelGroups[label];
            if (!group) continue;
            for (const f of group) {
                let newAlpha = (pose.faceAlphas[f] & 0xff) + curve.getValue(frame) * 255;
                if (newAlpha < 0) newAlpha = 0;
                else if (newAlpha > 255) newAlpha = 255;
                pose.faceAlphas[f] = newAlpha;
            }
        }
    }
}
