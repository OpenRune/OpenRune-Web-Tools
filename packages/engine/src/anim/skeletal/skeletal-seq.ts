import { mat4, quat, vec3 } from "gl-matrix";

import { ByteReader } from "../byte-reader";
import type { SeqBase } from "../seq-base";
import { Curve } from "./curve";
import { getCurveIndex, getCurveTypeForId } from "./curve-type";
import type { SkeletalBase } from "./skeletal-base";
import type { SkeletalBone } from "./skeletal-bone";
import {
    SkeletalTransformType,
    getCurveCount,
    getTransformTypeForId,
} from "./skeletal-transform-type";

const rotateAxis = vec3.create();
const scaleVector = vec3.create();

/** A Maya/skeletal animation clip: per-bone rotation/translation/scale curves over a shared rig. */
export class SkeletalSeq {
    poseId: number;
    curveCount: number;

    boneCurves: Curve[][];
    curves: Curve[][];

    hasAlphaTransform = false;

    constructor(
        readonly id: number,
        readonly version: number,
        readonly base: SeqBase,
        readonly skeletalBase: SkeletalBase,
        buffer: ByteReader,
    ) {
        buffer.readUnsignedShort();
        buffer.readUnsignedShort();
        this.poseId = buffer.readUnsignedByte();
        this.curveCount = buffer.readUnsignedShort();
        this.boneCurves = new Array(skeletalBase.bones.length);
        this.curves = new Array(base.count);

        for (let i = 0; i < this.curveCount; i++) {
            const transformType = getTransformTypeForId(buffer.readUnsignedByte());
            const boneIndex = buffer.readSmart2();
            const curveType = getCurveTypeForId(buffer.readUnsignedByte());

            const curve = new Curve(i);
            curve.decode(buffer);

            const curves =
                transformType === SkeletalTransformType.BONE ? this.boneCurves : this.curves;
            if (curves[boneIndex] === undefined) {
                curves[boneIndex] = new Array(getCurveCount(transformType));
            }

            curve.load();
            curves[boneIndex][getCurveIndex(curveType)] = curve;

            if (transformType === SkeletalTransformType.ALPHA) this.hasAlphaTransform = true;
        }
    }

    updateAnimMatrix(frame: number, bone: SkeletalBone, boneIndex: number, poseId: number): void {
        const matrix = mat4.create();
        this.applyRotation(matrix, boneIndex, bone, frame);
        this.applyScaling(matrix, boneIndex, bone, frame);
        this.applyTranslation(matrix, boneIndex, bone, frame);
        bone.setAnimMatrix(matrix);
    }

    private applyRotation(
        matrix: mat4,
        boneIndex: number,
        bone: SkeletalBone,
        frame: number,
    ): void {
        const rotation = bone.getRotation(this.poseId);
        let rotateX = rotation[0];
        let rotateY = rotation[1];
        let rotateZ = rotation[2];

        const curves = this.boneCurves[boneIndex];
        if (curves) {
            if (curves[0]) rotateX = curves[0].getValue(frame);
            if (curves[1]) rotateY = curves[1].getValue(frame);
            if (curves[2]) rotateZ = curves[2].getValue(frame);
        }

        vec3.set(rotateAxis, 1, 0, 0);
        const quatX = quat.setAxisAngle(quat.create(), rotateAxis, rotateX);
        vec3.set(rotateAxis, 0, 1, 0);
        const quatY = quat.setAxisAngle(quat.create(), rotateAxis, rotateY);
        vec3.set(rotateAxis, 0, 0, 1);
        const quatZ = quat.setAxisAngle(quat.create(), rotateAxis, rotateZ);

        let quaternion = quat.create();
        quaternion = quat.mul(quaternion, quatZ, quaternion);
        quaternion = quat.mul(quaternion, quatX, quaternion);
        quaternion = quat.mul(quaternion, quatY, quaternion);

        const rotateMatrix = mat4.fromQuat(mat4.create(), quaternion);
        mat4.mul(matrix, rotateMatrix, matrix);
    }

    private applyScaling(matrix: mat4, boneIndex: number, bone: SkeletalBone, frame: number): void {
        const scaling = bone.getScaling(this.poseId);
        let scaleX = scaling[0];
        let scaleY = scaling[1];
        let scaleZ = scaling[2];

        const curves = this.boneCurves[boneIndex];
        if (curves) {
            if (curves[6]) scaleX = curves[6].getValue(frame);
            if (curves[7]) scaleY = curves[7].getValue(frame);
            if (curves[8]) scaleZ = curves[8].getValue(frame);
        }

        vec3.set(scaleVector, scaleX, scaleY, scaleZ);
        const scaleMatrix = mat4.fromScaling(mat4.create(), scaleVector);
        mat4.mul(matrix, scaleMatrix, matrix);
    }

    private applyTranslation(
        matrix: mat4,
        boneIndex: number,
        bone: SkeletalBone,
        frame: number,
    ): void {
        const translation = bone.getTranslation(this.poseId);
        let transX = translation[0];
        let transY = translation[1];
        let transZ = translation[2];

        const curves = this.boneCurves[boneIndex];
        if (curves) {
            if (curves[3]) transX = curves[3].getValue(frame);
            if (curves[4]) transY = curves[4].getValue(frame);
            if (curves[5]) transZ = curves[5].getValue(frame);
        }

        matrix[12] = transX;
        matrix[13] = transY;
        matrix[14] = transZ;
    }
}

/** Every skeletal seq starts with a version byte then the id of the `SeqBase` it targets. */
export function peekSkeletalSeqBaseId(data: ArrayBuffer | Uint8Array): number {
    const reader = new ByteReader(data);
    reader.readUnsignedByte();
    return reader.readUnsignedShort();
}

export function decodeSkeletalSeq(
    id: number,
    base: SeqBase,
    data: ArrayBuffer | Uint8Array,
): SkeletalSeq {
    const buffer = new ByteReader(data);
    const version = buffer.readUnsignedByte();
    buffer.readUnsignedShort(); // baseId — already resolved by the caller into `base`.
    const skeletalBase = base.skeletalBase;
    if (!skeletalBase) throw new Error("SeqBase has no embedded skeletal rig");
    return new SkeletalSeq(id, version, base, skeletalBase, buffer);
}
