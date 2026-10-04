import { type ArchiveFile, type CacheSystem, ConfigType, IndexType } from "@openrune/cache";
import {
    type RSModelDefinition,
    type SeqBase,
    type SeqFrame,
    type SeqType,
    type SkeletalBase,
    type SkeletalSeq,
    decodeRSModel,
    decodeSeqBase,
    decodeSeqFrame,
    decodeSeqType,
    decodeSkeletalSeq,
    peekSeqFrameBaseId,
    peekSkeletalSeqBaseId,
} from "@openrune/engine";

function bytesOf(file: ArchiveFile): Uint8Array {
    return new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength);
}

function arrayBufferOf(file: ArchiveFile): ArrayBuffer {
    const u8 = bytesOf(file);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Reads and decodes one model out of a cache. */
export function loadModel(cache: CacheSystem, id: number): RSModelDefinition {
    if (!cache.indexExists(IndexType.DAT2.models)) {
        throw new Error("This cache has no models index (main_file_cache.idx7)");
    }
    const file = cache.getIndex(IndexType.DAT2.models).getFile(id, 0);
    if (!file) throw new Error(`Model ${id} not found in cache`);
    return decodeRSModel(id, arrayBufferOf(file));
}

/**
 * A sequence ready to play. The two kinds are genuinely different animations: old-style ones are
 * a list of posed frames, skeletal ones a duration sampled off a bone hierarchy.
 */
export type LoadedSequence =
    | {
          kind: "old";
          id: number;
          seqType: SeqType;
          /** Every frame, decoded up front — they're small, and it makes seeking a map lookup. */
          frames: Map<number, SeqFrame>;
          /** How many frames there are to step through. */
          length: number;
      }
    | {
          kind: "skeletal";
          id: number;
          seqType: SeqType;
          base: SkeletalBase;
          seq: SkeletalSeq;
          /** How many 20ms ticks the animation runs for. */
          length: number;
      };

/**
 * Sequence bases are shared between many sequences and cost a decode each, so they're remembered
 * per cache. Weak, so closing a cache lets the whole lot go.
 */
const baseCaches = new WeakMap<CacheSystem, Map<number, SeqBase>>();

function resolveBase(cache: CacheSystem, baseId: number): SeqBase {
    let bases = baseCaches.get(cache);
    if (!bases) {
        bases = new Map();
        baseCaches.set(cache, bases);
    }
    const cached = bases.get(baseId);
    if (cached) return cached;

    const file = cache.getIndex(IndexType.DAT2.skeletons).getFile(baseId, 0);
    if (!file) throw new Error(`Sequence base ${baseId} not found (main_file_cache.idx1)`);
    const base = decodeSeqBase(baseId, bytesOf(file));
    bases.set(baseId, base);
    return base;
}

/** Reads and decodes one sequence out of a cache, whichever kind it turns out to be. */
export function loadSequence(cache: CacheSystem, id: number): LoadedSequence {
    const seqFile = cache.getIndex(IndexType.DAT2.configs).getFile(ConfigType.DAT2.seqs, id);
    if (!seqFile) throw new Error(`Sequence ${id} not found`);
    const seqType = decodeSeqType(id, bytesOf(seqFile));

    if (seqType.isSkeletalSeq()) {
        const mayaFile = cache
            .getIndex(IndexType.OSRS.animKeyFrames)
            .getArchive(seqType.skeletalId >>> 16)
            .getFile(seqType.skeletalId & 0xffff);
        if (!mayaFile) throw new Error("Skeletal animation data not found (main_file_cache.idx22)");

        const mayaBytes = bytesOf(mayaFile);
        const base = resolveBase(cache, peekSkeletalSeqBaseId(mayaBytes));
        if (!base.skeletalBase) throw new Error("Sequence base has no embedded skeletal rig");

        return {
            kind: "skeletal",
            id,
            seqType,
            base: base.skeletalBase,
            seq: decodeSkeletalSeq(seqType.skeletalId, base, mayaBytes),
            length: Math.max(1, seqType.getSkeletalDuration()),
        };
    }

    if (seqType.frameIds.length === 0) throw new Error("Sequence has no frames");

    const framesIndex = cache.getIndex(IndexType.DAT2.animations);
    const frames = new Map<number, SeqFrame>();
    for (let i = 0; i < seqType.frameIds.length; i++) {
        const packedId = seqType.frameIds[i];
        const file = framesIndex.getArchive(packedId >>> 16).getFile(packedId & 0xffff);
        if (!file) continue;
        const bytes = bytesOf(file);
        frames.set(i, decodeSeqFrame(resolveBase(cache, peekSeqFrameBaseId(bytes)), bytes));
    }

    return { kind: "old", id, seqType, frames, length: seqType.frameIds.length };
}
