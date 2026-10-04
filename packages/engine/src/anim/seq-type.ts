import { ByteReader } from "./byte-reader";

type SeqSoundEffect = { id: number; loops: number; location: number; retain: number };

/** `IndexType.DAT2.configs` archive `12` ("seqs"), one file per sequence id. Modern-OSRS branches only. */
export class SeqType {
    frameIds: number[] = [];
    chatFrameIds?: number[];
    frameLengths: number[] = [];
    frameSounds?: Map<number, SeqSoundEffect[]>;

    frameStep = -1;
    masks?: number[];

    stretches = false;
    forcedPriority = 5;
    leftHandItem = -1;
    rightHandItem = -1;
    maxLoops = 99;
    looping = false;
    precedenceAnimating = -1;
    priority = -1;
    replyMode = 2;

    /** Non-negative when this sequence is skeletal (Maya) rather than old-style frame-based. */
    skeletalId = -1;
    skeletalStart = 0;
    skeletalEnd = 0;
    skeletalMasks?: boolean[];

    constructor(readonly id: number) {}

    isSkeletalSeq(): boolean {
        return this.skeletalId >= 0;
    }

    getSkeletalDuration(): number {
        return this.skeletalEnd - this.skeletalStart;
    }
}

function decodeSoundEffect(buffer: ByteReader): SeqSoundEffect {
    const id = buffer.readUnsignedShort();
    buffer.readUnsignedByte(); // unused
    const loops = buffer.readUnsignedByte();
    const location = buffer.readUnsignedByte();
    const retain = buffer.readUnsignedByte();
    return { id, loops, location, retain };
}

function decodeSparseFrameSounds(seq: SeqType, buffer: ByteReader): void {
    const count = buffer.readUnsignedShort();
    seq.frameSounds ??= new Map();
    for (let i = 0; i < count; i++) {
        const frame = buffer.readUnsignedShort();
        const effect = decodeSoundEffect(buffer);
        const list = seq.frameSounds.get(frame);
        if (list) list.push(effect);
        else seq.frameSounds.set(frame, [effect]);
    }
}

export function decodeSeqType(id: number, data: ArrayBuffer | Uint8Array): SeqType {
    const seq = new SeqType(id);
    const buffer = new ByteReader(data);

    while (true) {
        if (buffer.offset > buffer.length - 1) throw new Error("SeqType: buffer overflow");
        const opcode = buffer.readUnsignedByte();
        if (opcode === 0) break;
        decodeOpcode(seq, opcode, buffer);
    }

    return seq;
}

function decodeOpcode(seq: SeqType, opcode: number, buffer: ByteReader): void {
    switch (opcode) {
        case 1: {
            const count = buffer.readUnsignedShort();
            seq.frameIds = new Array(count);
            seq.frameLengths = new Array(count);
            for (let i = 0; i < count; i++) seq.frameLengths[i] = buffer.readUnsignedShort();
            for (let i = 0; i < count; i++) seq.frameIds[i] = buffer.readUnsignedShort();
            for (let i = 0; i < count; i++) seq.frameIds[i] += buffer.readUnsignedShort() << 16;
            break;
        }
        case 2:
            seq.frameStep = buffer.readUnsignedShort();
            break;
        case 3: {
            const count = buffer.readUnsignedByte();
            seq.masks = new Array(count + 1);
            for (let i = 0; i < count; i++) seq.masks[i] = buffer.readUnsignedByte();
            seq.masks[count] = 9999999;
            break;
        }
        case 4:
            seq.stretches = true;
            break;
        case 5:
            seq.forcedPriority = buffer.readUnsignedByte();
            break;
        case 6:
            seq.leftHandItem = buffer.readUnsignedShort();
            break;
        case 7:
            seq.rightHandItem = buffer.readUnsignedShort();
            break;
        case 8:
            seq.maxLoops = buffer.readUnsignedByte();
            seq.looping = true;
            break;
        case 9:
            seq.precedenceAnimating = buffer.readUnsignedByte();
            break;
        case 10:
            seq.priority = buffer.readUnsignedByte();
            break;
        case 11:
            seq.replyMode = buffer.readUnsignedByte();
            break;
        case 12: {
            const count = buffer.readUnsignedByte();
            seq.chatFrameIds = new Array(count);
            for (let i = 0; i < count; i++) seq.chatFrameIds[i] = buffer.readUnsignedShort();
            for (let i = 0; i < count; i++) seq.chatFrameIds[i] += buffer.readUnsignedShort() << 16;
            break;
        }
        case 13:
            seq.skeletalId = buffer.readInt();
            break;
        case 14:
            decodeSparseFrameSounds(seq, buffer);
            break;
        case 15:
            seq.skeletalStart = buffer.readUnsignedShort();
            seq.skeletalEnd = buffer.readUnsignedShort();
            break;
        case 16:
            buffer.readUnsignedByte(); // heightOffset — unused
            break;
        case 17: {
            const count = buffer.readUnsignedByte();
            seq.skeletalMasks = new Array(256).fill(false);
            for (let i = 0; i < count; i++) seq.skeletalMasks[buffer.readUnsignedByte()] = true;
            break;
        }
        case 18:
            buffer.readString(); // debug name — unused
            break;
        case 19:
            break; // crossworldsound flag, no payload for oldschool
        case 20:
            buffer.readUnsignedByte();
            buffer.readUnsignedShort();
            buffer.readUnsignedShort();
            break;
        default:
            throw new Error(`SeqType: opcode ${opcode} not implemented`);
    }
}
