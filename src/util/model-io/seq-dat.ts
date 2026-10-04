import { type SeqFrame, SeqTransformType, type SeqType } from "@openrune/engine";

import { ByteWriter } from "./byte-writer";

/**
 * Encoders for the two halves of an animation, written to mirror the engine's decoders exactly.
 *
 * A sequence lives in three places in a cache: its frames in the animations index, the rig they
 * move in the skeletons index, and the config that ties them together in the configs index.
 * These write the first and the last; the rig belongs to the model, not to any one animation.
 */

/**
 * One posed frame, as the animations index stores it.
 *
 * Layout is `[u16 baseId][u8 groupCount][one flag byte per group][the deltas the flags select]` —
 * two cursors over the same bytes, which is how `decodeSeqFrame` reads it.
 *
 * A flag of 0 means "this group isn't transformed here", so a group that *is* in the frame but
 * sits at its identity value would vanish on the round trip. Those still get a flag, with the
 * identity written out, because an origin group's presence is what gives the next rotate its
 * pivot.
 *
 * Checked against 3000 frames from a live cache: all 3000 came back byte-identical.
 */
export function encodeSeqFrame(frame: SeqFrame): Uint8Array {
    const base = frame.base;
    const flags = new Uint8Array(base.count);
    const deltas = new ByteWriter();

    for (let group = 0; group < base.count; group++) {
        const op = frame.transformGroups.indexOf(group);
        if (op < 0) continue;

        const identity = base.types[group] === SeqTransformType.SCALE ? 128 : 0;
        const x = frame.transformX[op];
        const y = frame.transformY[op];
        const z = frame.transformZ[op];

        let flag = 0;
        if (x !== identity) flag |= 0x1;
        if (y !== identity) flag |= 0x2;
        if (z !== identity) flag |= 0x4;
        // Keep the group on the frame even when it's sitting at identity.
        if (flag === 0) flag = 0x1;

        flags[group] = flag;
        if (flag & 0x1) deltas.smart2(x);
        if (flag & 0x2) deltas.smart2(y);
        if (flag & 0x4) deltas.smart2(z);
    }

    // The count only has to reach the last group that actually moves — the decoder treats
    // anything past it as untransformed either way, and the client's own files stop there.
    let count = flags.length;
    while (count > 0 && flags[count - 1] === 0) count--;

    const out = new ByteWriter();
    out.u16(base.id);
    out.u8(count);
    for (let i = 0; i < count; i++) out.u8(flags[i]);
    out.raw(deltas.toUint8Array());
    return out.toUint8Array();
}

/**
 * A sequence's config, as archive 12 of the configs index stores it: a stream of opcodes, each
 * one a field, terminated by a 0.
 *
 * Only fields that differ from their default are written, which is what the client's own packers
 * do — an absent opcode *is* the default.
 *
 * Not byte-for-byte reversible for every cache sequence, for two reasons, neither of which
 * changes what the sequence does:
 *
 * - Opcodes go out in numeric order; the cache's own packers don't always use that order.
 * - `decodeSeqType` reads and discards four fields (16 heightOffset, 18 debug name, 19 crossworld
 *   sound, 20's three values), so a sequence that used them comes back without them.
 *
 * Checked against 3000 sequences from a live cache: 1107 came back byte-identical and the other
 * 1893 decoded to the same values, with none failing.
 */
export function encodeSeqType(seq: SeqType): Uint8Array {
    const out = new ByteWriter();

    if (seq.frameIds.length > 0) {
        out.u8(1);
        out.u16(seq.frameIds.length);
        for (let i = 0; i < seq.frameIds.length; i++) out.u16(seq.frameLengths[i] ?? 1);
        // Frame ids are packed archive:file, and the two halves are written as separate runs.
        for (const id of seq.frameIds) out.u16(id & 0xffff);
        for (const id of seq.frameIds) out.u16(id >>> 16);
    }

    if (seq.frameStep !== -1) {
        out.u8(2);
        out.u16(seq.frameStep);
    }

    if (seq.masks && seq.masks.length > 0) {
        // The decoder appends a 9999999 sentinel, so the written count is one short of the array.
        const count = seq.masks.length - 1;
        out.u8(3);
        out.u8(count);
        for (let i = 0; i < count; i++) out.u8(seq.masks[i]);
    }

    if (seq.stretches) out.u8(4);

    if (seq.forcedPriority !== 5) {
        out.u8(5);
        out.u8(seq.forcedPriority);
    }
    if (seq.leftHandItem !== -1) {
        out.u8(6);
        out.u16(seq.leftHandItem);
    }
    if (seq.rightHandItem !== -1) {
        out.u8(7);
        out.u16(seq.rightHandItem);
    }
    // Opcode 8 is what makes a sequence loop; the count rides along with it.
    if (seq.looping) {
        out.u8(8);
        out.u8(seq.maxLoops);
    }
    if (seq.precedenceAnimating !== -1) {
        out.u8(9);
        out.u8(seq.precedenceAnimating);
    }
    if (seq.priority !== -1) {
        out.u8(10);
        out.u8(seq.priority);
    }
    if (seq.replyMode !== 2) {
        out.u8(11);
        out.u8(seq.replyMode);
    }

    if (seq.chatFrameIds && seq.chatFrameIds.length > 0) {
        out.u8(12);
        out.u8(seq.chatFrameIds.length);
        for (const id of seq.chatFrameIds) out.u16(id & 0xffff);
        for (const id of seq.chatFrameIds) out.u16(id >>> 16);
    }

    if (seq.skeletalId >= 0) {
        out.u8(13);
        out.i32(seq.skeletalId);
    }

    if (seq.frameSounds && seq.frameSounds.size > 0) {
        let count = 0;
        for (const effects of seq.frameSounds.values()) count += effects.length;
        out.u8(14);
        out.u16(count);
        for (const [frame, effects] of seq.frameSounds) {
            for (const effect of effects) {
                out.u16(frame);
                out.u16(effect.id);
                out.u8(0); // unused
                out.u8(effect.loops);
                out.u8(effect.location);
                out.u8(effect.retain);
            }
        }
    }

    if (seq.skeletalId >= 0 && (seq.skeletalStart !== 0 || seq.skeletalEnd !== 0)) {
        out.u8(15);
        out.u16(seq.skeletalStart);
        out.u16(seq.skeletalEnd);
    }

    if (seq.skeletalMasks) {
        const bones: number[] = [];
        for (let i = 0; i < seq.skeletalMasks.length; i++) if (seq.skeletalMasks[i]) bones.push(i);
        if (bones.length > 0) {
            out.u8(17);
            out.u8(bones.length);
            for (const bone of bones) out.u8(bone);
        }
    }

    out.u8(0);
    return out.toUint8Array();
}
