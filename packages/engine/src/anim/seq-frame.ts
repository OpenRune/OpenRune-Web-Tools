import { ByteReader } from "./byte-reader";
import type { SeqBase } from "./seq-base";
import { SeqTransformType } from "./seq-transform-type";

/** One posed frame: a sparse list of (group, dx, dy, dz) deltas against a shared `SeqBase`. */
export class SeqFrame {
    constructor(
        readonly base: SeqBase,
        readonly transformCount: number,
        readonly transformGroups: number[],
        readonly transformX: number[],
        readonly transformY: number[],
        readonly transformZ: number[],
        readonly resetOriginGroups: number[],
        readonly hasAlphaTransform: boolean,
    ) {}
}

/** Every frame starts with the id of the `SeqBase` (index 1) it's built against — resolve that first. */
export function peekSeqFrameBaseId(data: ArrayBuffer | Uint8Array): number {
    return new ByteReader(data).readUnsignedShort();
}

/**
 * dat2/OSRS frame format — one frame per file within a "frame map" archive (index 0). The
 * first `count` bytes are per-group flags (read sequentially); the deltas they select follow
 * immediately after, read via a second cursor over the same bytes. `base` must already be
 * resolved from the id `peekSeqFrameBaseId` returns for this same data.
 */
export function decodeSeqFrame(base: SeqBase, data: ArrayBuffer | Uint8Array): SeqFrame {
    const flags = new ByteReader(data);
    flags.readUnsignedShort(); // baseId, already resolved into `base`.

    const count = flags.readUnsignedByte();
    const deltas = new ByteReader(data);
    deltas.offset = flags.offset + count;

    const transformGroups: number[] = [];
    const transformX: number[] = [];
    const transformY: number[] = [];
    const transformZ: number[] = [];
    const resetOriginGroups: number[] = [];

    let resetOriginGroup = -1;
    let lastResetOriginGroup = -1;
    let hasAlphaTransform = false;

    for (let i = 0; i < count; i++) {
        const type = base.types[i];
        if (type === SeqTransformType.ORIGIN) resetOriginGroup = i;

        const flag = flags.readUnsignedByte();
        if (flag === 0) continue;

        if (type === SeqTransformType.ORIGIN) lastResetOriginGroup = i;

        transformGroups.push(i);

        const defaultValue = type === SeqTransformType.SCALE ? 128 : 0;

        transformX.push((flag & 0x1) !== 0 ? deltas.readSmart2() : defaultValue);
        transformY.push((flag & 0x2) !== 0 ? deltas.readSmart2() : defaultValue);
        transformZ.push((flag & 0x4) !== 0 ? deltas.readSmart2() : defaultValue);

        let resetGroup = -1;
        if (
            type === SeqTransformType.TRANSLATE ||
            type === SeqTransformType.ROTATE ||
            type === SeqTransformType.SCALE
        ) {
            if (resetOriginGroup > lastResetOriginGroup) {
                resetGroup = resetOriginGroup;
                lastResetOriginGroup = resetOriginGroup;
            }
        } else if (type === SeqTransformType.ALPHA) {
            hasAlphaTransform = true;
        }
        resetOriginGroups.push(resetGroup);
    }

    return new SeqFrame(
        base,
        transformGroups.length,
        transformGroups,
        transformX,
        transformY,
        transformZ,
        resetOriginGroups,
        hasAlphaTransform,
    );
}
