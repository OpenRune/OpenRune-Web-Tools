import type { SeqFrame } from "@openrune/engine";

import { ByteWriter } from "./byte-writer";
import { encodeSeqFrame } from "./seq-dat";

/**
 * Every frame of one animation in a single file.
 *
 * The cache keeps frames as loose files inside an archive, which means exporting an animation
 * means exporting fifty of them and hoping they stay together. This wraps the same bytes — each
 * frame is exactly what index 0 stores — in one container that carries the archive id they
 * belong to, so a packer has everything it needs from the one file.
 *
 * Layout, all big-endian to match the rest of the cache:
 *
 *     "RSAN"    4 bytes, magic
 *     version   u8, currently 1
 *     archive   u16, the frame archive (group) in index 0 these pack into
 *     count     u16, how many frames follow
 *     per frame:
 *       file    u16, the file id within that archive
 *       length  u16, bytes of frame data
 *       data    `length` bytes, byte-for-byte what the cache stores
 *
 * Unpacking is `cache.write(0, archive, file, data)` per entry — nothing to decode first.
 */

export const ANIM_PACK_MAGIC = "RSAN";
export const ANIM_PACK_VERSION = 1;

export type PackedFrame = { file: number; data: Uint8Array };

export type AnimPack = {
    /** Which archive in index 0 the frames belong to. */
    archive: number;
    frames: PackedFrame[];
};

export function encodeAnimPack(pack: AnimPack): Uint8Array {
    const out = new ByteWriter();
    for (const char of ANIM_PACK_MAGIC) out.u8(char.charCodeAt(0));
    out.u8(ANIM_PACK_VERSION);
    out.u16(pack.archive);
    out.u16(pack.frames.length);
    for (const frame of pack.frames) {
        out.u16(frame.file);
        out.u16(frame.data.length);
        out.raw(frame.data);
    }
    return out.toUint8Array();
}

export function decodeAnimPack(bytes: Uint8Array): AnimPack {
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== ANIM_PACK_MAGIC) {
        throw new Error("That isn't an animation pack — it doesn't start with RSAN.");
    }
    const version = bytes[4];
    if (version !== ANIM_PACK_VERSION) {
        throw new Error(
            `Animation pack version ${version} — this editor reads version ${ANIM_PACK_VERSION}.`,
        );
    }

    let at = 5;
    const u16 = (): number => {
        const value = (bytes[at] << 8) | bytes[at + 1];
        at += 2;
        return value;
    };

    const archive = u16();
    const count = u16();
    const frames: PackedFrame[] = [];
    for (let i = 0; i < count; i++) {
        const file = u16();
        const length = u16();
        if (at + length > bytes.length) throw new Error("Animation pack ends mid-frame.");
        frames.push({ file, data: bytes.slice(at, at + length) });
        at += length;
    }
    return { archive, frames };
}

/**
 * Turns the frames of an animation into a pack, numbering them from 0 within the archive.
 *
 * Frames with nothing in them are dropped: a frame whose every movement sits at rest encodes to
 * a couple of bytes that tell the client to do nothing, and shipping fifty of those alongside
 * the three that matter only makes the result harder to read.
 */
export function buildAnimPack(
    archive: number,
    frames: { index: number; frame: SeqFrame }[],
): { pack: AnimPack; skipped: number[]; frameIds: number[] } {
    const packed: PackedFrame[] = [];
    const skipped: number[] = [];
    const frameIds: number[] = [];

    for (const { index, frame } of frames) {
        if (frame.transformCount === 0) {
            skipped.push(index);
            continue;
        }
        const file = packed.length;
        packed.push({ file, data: encodeSeqFrame(frame) });
        frameIds.push((archive << 16) | file);
    }

    return { pack: { archive, frames: packed }, skipped, frameIds };
}
