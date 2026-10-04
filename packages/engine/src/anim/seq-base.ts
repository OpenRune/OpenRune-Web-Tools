import { ByteReader } from "./byte-reader";
import { SeqTransformType } from "./seq-transform-type";
import { SkeletalBase } from "./skeletal/skeletal-base";

/**
 * A shared "rig" for one or more animations: `count` transform groups, each with a type
 * (translate/rotate/scale/...), a mask, and the model vertex/face labels it moves. Old-style
 * frames reference groups by index; skeletal animations reuse the same group/label metadata
 * but drive it via an embedded `SkeletalBase` bone hierarchy instead of literal deltas.
 */
export class SeqBase {
    constructor(
        readonly id: number,
        readonly count: number,
        readonly types: SeqTransformType[],
        readonly labels: number[][],
        readonly skeletalBase?: SkeletalBase,
    ) {}
}

/** dat2/OSRS sequence base format (`IndexType.DAT2.skeletons`, i.e. index 1). */
export function decodeSeqBase(id: number, data: ArrayBuffer | Uint8Array): SeqBase {
    const buffer = new ByteReader(data);
    const count = buffer.readUnsignedByte();
    const types: SeqTransformType[] = new Array(count);
    const labels: number[][] = new Array(count);

    for (let i = 0; i < count; i++) {
        const raw = buffer.readUnsignedByte();
        // Revision-6 rotate groups collapse onto the regular rotate type.
        types[i] = raw === 6 ? SeqTransformType.ROTATE : raw;
    }

    for (let i = 0; i < count; i++) {
        labels[i] = new Array(buffer.readUnsignedByte());
    }
    for (let i = 0; i < count; i++) {
        for (let l = 0; l < labels[i].length; l++) {
            labels[i][l] = buffer.readUnsignedByte();
        }
    }

    let skeletalBase: SkeletalBase | undefined;
    if (buffer.remaining > 0) {
        const boneCount = buffer.readUnsignedShort();
        if (boneCount > 0) skeletalBase = new SkeletalBase(buffer, boneCount);
    }

    return new SeqBase(id, count, types, labels, skeletalBase);
}
