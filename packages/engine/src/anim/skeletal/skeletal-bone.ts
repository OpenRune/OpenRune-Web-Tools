import { type ReadonlyMat4, mat4, vec3 } from "gl-matrix";

import type { ByteReader } from "../byte-reader";

const scratchInvertedLocal = mat4.create();

/** One bone in a skeletal rig: a bind-pose local matrix per pose, plus per-frame animated state. */
export class SkeletalBone {
    parentId: number;
    localMatrices: mat4[];
    modelMatrices: (mat4 | undefined)[];
    invertedModelMatrices: (mat4 | undefined)[];

    animMatrix: mat4 = mat4.create();
    updateAnimModelMatrix = false;
    updateFinalMatrix = false;

    animModelMatrix: mat4 = mat4.create();
    finalMatrix: mat4 = mat4.create();

    parent?: SkeletalBone;

    rotations!: vec3[];
    translations!: vec3[];
    scalings!: vec3[];

    static readMat4(buffer: ByteReader): mat4 {
        const m = new Float32Array(16);
        for (let i = 0; i < 16; i++) m[i] = buffer.readFloat();
        return m;
    }

    static getRotation(out: vec3, m: ReadonlyMat4): vec3 {
        out[0] = -Math.asin(m[6]);
        out[1] = 0;
        out[2] = 0;
        const cosRotationX = Math.cos(out[0]);
        if (Math.abs(cosRotationX) > 0.005) {
            out[1] = Math.atan2(m[2], m[10]);
            out[2] = Math.atan2(m[4], m[5]);
        } else {
            const sinRotationY = m[1];
            const cosRotationY = m[0];
            out[1] =
                m[6] < 0
                    ? Math.atan2(sinRotationY, cosRotationY)
                    : -Math.atan2(sinRotationY, cosRotationY);
            out[2] = 0;
        }
        return out;
    }

    constructor(poseCount: number, buffer: ByteReader) {
        this.parentId = buffer.readShort();
        this.localMatrices = new Array(poseCount);
        this.modelMatrices = new Array(poseCount);
        this.invertedModelMatrices = new Array(poseCount);

        for (let i = 0; i < poseCount; i++) {
            this.localMatrices[i] = SkeletalBone.readMat4(buffer);
            // Direction vector, unused for rendering — still consumed to keep the cursor aligned.
            buffer.readFloat();
            buffer.readFloat();
            buffer.readFloat();
        }

        this.extractTransformations();
    }

    private extractTransformations(): void {
        const poseCount = this.localMatrices.length;
        this.rotations = new Array(poseCount);
        this.translations = new Array(poseCount);
        this.scalings = new Array(poseCount);

        for (let i = 0; i < poseCount; i++) {
            const localMatrix = this.getLocalMatrix(i);
            mat4.invert(scratchInvertedLocal, localMatrix);

            this.rotations[i] = vec3.create();
            this.translations[i] = vec3.create();
            this.scalings[i] = vec3.create();

            SkeletalBone.getRotation(this.rotations[i], scratchInvertedLocal);
            mat4.getTranslation(this.translations[i], localMatrix);
            mat4.getScaling(this.scalings[i], localMatrix);
        }
    }

    getLocalMatrix(poseId: number): mat4 {
        return this.localMatrices[poseId];
    }

    getModelMatrix(poseId: number): mat4 {
        if (this.modelMatrices[poseId] === undefined) {
            const modelMatrix = mat4.create();
            if (this.parent) {
                mat4.mul(
                    modelMatrix,
                    this.parent.getModelMatrix(poseId),
                    this.getLocalMatrix(poseId),
                );
            } else {
                mat4.copy(modelMatrix, this.getLocalMatrix(poseId));
            }
            this.modelMatrices[poseId] = modelMatrix;
        }
        return this.modelMatrices[poseId]!;
    }

    getInvertedModelMatrix(poseId: number): mat4 {
        if (this.invertedModelMatrices[poseId] === undefined) {
            this.invertedModelMatrices[poseId] =
                mat4.invert(mat4.create(), this.getModelMatrix(poseId)) ?? mat4.create();
        }
        return this.invertedModelMatrices[poseId]!;
    }

    setAnimMatrix(animMatrix: mat4): void {
        mat4.copy(this.animMatrix, animMatrix);
        this.updateAnimModelMatrix = true;
        this.updateFinalMatrix = true;
    }

    getAnimMatrix(): mat4 {
        return this.animMatrix;
    }

    getAnimModelMatrix(): mat4 {
        if (this.updateAnimModelMatrix) {
            this.updateAnimModelMatrix = false;
            if (this.parent) {
                mat4.mul(
                    this.animModelMatrix,
                    this.parent.getAnimModelMatrix(),
                    this.getAnimMatrix(),
                );
            } else {
                mat4.copy(this.animModelMatrix, this.getAnimMatrix());
            }
        }
        return this.animModelMatrix;
    }

    getFinalMatrix(poseId: number): mat4 {
        if (this.updateFinalMatrix) {
            this.updateFinalMatrix = false;
            mat4.mul(
                this.finalMatrix,
                this.getAnimModelMatrix(),
                this.getInvertedModelMatrix(poseId),
            );
        }
        return this.finalMatrix;
    }

    getRotation(poseId: number): vec3 {
        return this.rotations[poseId];
    }

    getTranslation(poseId: number): vec3 {
        return this.translations[poseId];
    }

    getScaling(poseId: number): vec3 {
        return this.scalings[poseId];
    }
}
