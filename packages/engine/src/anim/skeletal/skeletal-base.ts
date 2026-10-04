import type { ByteReader } from "../byte-reader";
import { SkeletalBone } from "./skeletal-bone";
import type { SkeletalSeq } from "./skeletal-seq";

/** A bone hierarchy (rig) shared by every `SkeletalSeq` animation that targets it. */
export class SkeletalBase {
    bones: SkeletalBone[];
    poseCount: number;

    constructor(buffer: ByteReader, count: number) {
        this.bones = new Array(count);
        this.poseCount = buffer.readUnsignedByte();

        for (let i = 0; i < this.bones.length; i++) {
            this.bones[i] = new SkeletalBone(this.poseCount, buffer);
        }

        this.linkBones();
    }

    private linkBones(): void {
        for (const bone of this.bones) {
            if (bone.parentId >= 0) bone.parent = this.bones[bone.parentId];
        }
    }

    updateAnimMatrices(skeletalSeq: SkeletalSeq, frame: number): void {
        const poseId = skeletalSeq.poseId;
        let boneIndex = 0;
        for (const bone of this.bones) {
            skeletalSeq.updateAnimMatrix(frame, bone, boneIndex, poseId);
            boneIndex++;
        }
    }

    getBoneCount(): number {
        return this.bones.length;
    }

    getBone(id: number): SkeletalBone | undefined {
        if (id >= this.getBoneCount()) return undefined;
        return this.bones[id];
    }
}
