import type { SeqFrame, SeqType } from "@openrune/engine";

/**
 * Undo, redo, and a list of everything you've done.
 *
 * Snapshots rather than inverse operations: the editor's state is small — a few hundred keys, a
 * handful of movements, one label per vertex — and a snapshot can't drift out of step with the
 * thing it's meant to undo the way a hand-written inverse can. It also makes the history list
 * clickable for free, since every entry already *is* a state rather than a step towards one.
 */

export type Vec3 = { x: number; y: number; z: number };

/** A movement built in the editor, copied out of the component's own type. */
export type HistoryCustomGroup = {
    id: number;
    type: number;
    label: number;
    name: string;
    color: string;
    vertexIndices: number[];
};

/** The mutable half of a `SeqType` — the parts the editor writes to. */
export type HistorySeqConfig = {
    frameIds: number[];
    frameLengths: number[];
    frameStep: number;
    stretches: boolean;
    looping: boolean;
    maxLoops: number;
    forcedPriority: number;
    leftHandItem: number;
    rightHandItem: number;
    precedenceAnimating: number;
    priority: number;
    replyMode: number;
};

/** Everything an action can change. Anything not in here survives undo untouched. */
export type EditorSnapshot = {
    /** Keyframes: frame → movement → value. */
    edits: Map<number, Map<number, Vec3>>;
    customGroups: HistoryCustomGroup[];
    /** Per-vertex labels, when the rig has been edited here. */
    vertexSkins: Int32Array | null;
    maya: { groups: Int32Array[]; scales: Int32Array[] } | null;
    labelNames: Map<number, string>;
    rowNames: Map<number, string>;
    hiddenRows: Set<number>;
    rowOrder: number[] | null;
    /** Shared structurally: frames are never mutated in place, only added and removed. */
    frames: Map<number, SeqFrame>;
    seqConfig: HistorySeqConfig | null;
    /**
     * What's selected, and in which element mode.
     *
     * Worth keeping: labelling geometry is half picking it, and getting a fiddly selection back
     * after one wrong click is exactly what undo is for.
     */
    selection: { element: string; ids: number[] };
};

export type HistoryEntry = {
    /** What the action was, for the list. */
    label: string;
    snapshot: EditorSnapshot;
    /**
     * Actions sharing a key replace each other instead of stacking, so a gizmo drag or a run of
     * keystrokes in a number field is one entry rather than sixty.
     */
    coalesce?: string;
};

/** How many states to keep. Each is small; this is about memory, not correctness. */
export const HISTORY_LIMIT = 60;

export function captureSeqConfig(seq: SeqType | null): HistorySeqConfig | null {
    if (!seq) return null;
    return {
        frameIds: [...seq.frameIds],
        frameLengths: [...seq.frameLengths],
        frameStep: seq.frameStep,
        stretches: seq.stretches,
        looping: seq.looping,
        maxLoops: seq.maxLoops,
        forcedPriority: seq.forcedPriority,
        leftHandItem: seq.leftHandItem,
        rightHandItem: seq.rightHandItem,
        precedenceAnimating: seq.precedenceAnimating,
        priority: seq.priority,
        replyMode: seq.replyMode,
    };
}

export function restoreSeqConfig(seq: SeqType | null, config: HistorySeqConfig | null): void {
    if (!seq || !config) return;
    seq.frameIds = [...config.frameIds];
    seq.frameLengths = [...config.frameLengths];
    seq.frameStep = config.frameStep;
    seq.stretches = config.stretches;
    seq.looping = config.looping;
    seq.maxLoops = config.maxLoops;
    seq.forcedPriority = config.forcedPriority;
    seq.leftHandItem = config.leftHandItem;
    seq.rightHandItem = config.rightHandItem;
    seq.precedenceAnimating = config.precedenceAnimating;
    seq.priority = config.priority;
    seq.replyMode = config.replyMode;
}

/** Deep enough that restoring can't hand back something the editor then mutates in place. */
export function cloneEdits(edits: Map<number, Map<number, Vec3>>): Map<number, Map<number, Vec3>> {
    const out = new Map<number, Map<number, Vec3>>();
    for (const [frame, groups] of edits) {
        const copy = new Map<number, Vec3>();
        for (const [group, value] of groups) copy.set(group, { ...value });
        out.set(frame, copy);
    }
    return out;
}

export function cloneMaya(
    maya: { groups: Int32Array[]; scales: Int32Array[] } | null,
): { groups: Int32Array[]; scales: Int32Array[] } | null {
    if (!maya) return null;
    return {
        groups: maya.groups.map((g) => g.slice()),
        scales: maya.scales.map((s) => s.slice()),
    };
}

/**
 * The list of states, and where in it we are.
 *
 * `index` points at the state currently showing. Undo walks back, redo walks forward, and a new
 * action drops whatever was ahead — the usual shape, with the addition that any entry can be
 * jumped to directly.
 */
export type History = {
    entries: HistoryEntry[];
    index: number;
};

export const emptyHistory = (): History => ({ entries: [], index: -1 });

export function pushHistory(history: History, entry: HistoryEntry): History {
    const last = history.entries[history.index];
    // A run of the same continuous action replaces its own last state rather than adding to it.
    if (
        entry.coalesce !== undefined &&
        last?.coalesce === entry.coalesce &&
        history.index === history.entries.length - 1
    ) {
        const entries = [...history.entries];
        entries[history.index] = entry;
        return { entries, index: history.index };
    }

    const kept = history.entries.slice(0, history.index + 1);
    kept.push(entry);
    // Oldest first out. The initial state goes with them, which is fine: undo stops at the
    // oldest state it still has rather than pretending to reach further back.
    const trimmed = kept.length > HISTORY_LIMIT ? kept.slice(kept.length - HISTORY_LIMIT) : kept;
    return { entries: trimmed, index: trimmed.length - 1 };
}

export const canUndo = (history: History): boolean => history.index > 0;
export const canRedo = (history: History): boolean => history.index < history.entries.length - 1;
