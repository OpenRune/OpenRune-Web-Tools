import { SeqTransformType } from "@openrune/engine";

export type PresetAxis = "x" | "y" | "z";

/** A key a preset wants written, positioned as a fraction of the frame range it's applied to. */
export type PresetKey = { at: number; delta: number };

export type MotionPreset = {
    id: string;
    label: string;
    note: string;
    /** Transform types this makes sense on; the rest are hidden when such a group is armed. */
    types: SeqTransformType[];
    /** Sensible starting amount, in the units of that transform type. */
    defaultAmount: number;
    /** Keys along the range, as offsets from the group's value at the start of the range. */
    keys: (amount: number) => PresetKey[];
};

/**
 * Canned movements to drop onto a range of frames, so a spin or a sway is a couple of clicks
 * rather than a dozen hand-placed keys.
 *
 * Each preset only writes keys — nothing about it is special afterwards. The in-betweens come
 * from the editor's normal tweening, and every key it writes can be dragged, retimed or deleted
 * like any other.
 *
 * Rotations step in pieces smaller than half a turn on purpose: tweening takes the shortest way
 * round, so a single key at +360° would read as "no change at all" and sit still.
 */
export const MOTION_PRESETS: MotionPreset[] = [
    {
        id: "spin",
        label: "Spin in place",
        note: "One full turn over the range",
        types: [SeqTransformType.ROTATE],
        defaultAmount: 256,
        keys: (amount) => [
            { at: 0, delta: 0 },
            { at: 0.25, delta: amount * 0.25 },
            { at: 0.5, delta: amount * 0.5 },
            { at: 0.75, delta: amount * 0.75 },
            { at: 1, delta: amount },
        ],
    },
    {
        id: "back-and-forth",
        label: "Back and forth",
        note: "Out to the amount and back where it started",
        types: [SeqTransformType.ROTATE, SeqTransformType.TRANSLATE, SeqTransformType.SCALE],
        defaultAmount: 32,
        keys: (amount) => [
            { at: 0, delta: 0 },
            { at: 0.5, delta: amount },
            { at: 1, delta: 0 },
        ],
    },
    {
        id: "sway",
        label: "Sway",
        note: "One way, through the middle, the other way, and back",
        types: [SeqTransformType.ROTATE, SeqTransformType.TRANSLATE],
        defaultAmount: 24,
        keys: (amount) => [
            { at: 0, delta: 0 },
            { at: 0.25, delta: amount },
            { at: 0.5, delta: 0 },
            { at: 0.75, delta: -amount },
            { at: 1, delta: 0 },
        ],
    },
    {
        id: "bob",
        label: "Bob twice",
        note: "Two bounces across the range",
        types: [SeqTransformType.ROTATE, SeqTransformType.TRANSLATE, SeqTransformType.SCALE],
        defaultAmount: 16,
        keys: (amount) => [
            { at: 0, delta: 0 },
            { at: 0.25, delta: amount },
            { at: 0.5, delta: 0 },
            { at: 0.75, delta: amount },
            { at: 1, delta: 0 },
        ],
    },
    {
        id: "drift",
        label: "Drift one way",
        note: "A straight move from here to the amount",
        types: [SeqTransformType.ROTATE, SeqTransformType.TRANSLATE, SeqTransformType.SCALE],
        defaultAmount: 32,
        keys: (amount) => [
            { at: 0, delta: 0 },
            { at: 1, delta: amount },
        ],
    },
];

/**
 * Turns a preset into actual frames and values for one group.
 *
 * `base` is the group's value where the range starts, so a preset adds to whatever pose is
 * already there rather than replacing it. Rotations wrap to their 256-unit circle; scales are
 * held inside the byte the format stores them in.
 */
export function buildPresetKeys(
    preset: MotionPreset,
    type: SeqTransformType,
    axis: PresetAxis,
    amount: number,
    from: number,
    to: number,
    base: { x: number; y: number; z: number },
): { frame: number; value: { x: number; y: number; z: number } }[] {
    const span = to - from;
    if (span <= 0) return [];

    const out = new Map<number, { x: number; y: number; z: number }>();
    for (const key of preset.keys(amount)) {
        const frame = from + Math.round(key.at * span);
        let value = base[axis] + key.delta;
        if (type === SeqTransformType.ROTATE) value = ((Math.round(value) % 256) + 256) % 256;
        else if (type === SeqTransformType.SCALE)
            value = Math.max(0, Math.min(255, Math.round(value)));
        else value = Math.round(value);
        // Later keys win when rounding lands two of them on the same frame — that only happens
        // on ranges too short to hold the whole shape.
        out.set(frame, { ...base, [axis]: value });
    }

    return Array.from(out.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([frame, value]) => ({ frame, value }));
}
