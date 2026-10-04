import type Anthropic from "@anthropic-ai/sdk";

/**
 * What the assistant is allowed to do to the editor.
 *
 * Each one maps to a function the editor already has, taking the same plain ids and numbers the
 * UI passes. Nothing here reaches into the model's geometry directly — everything goes through
 * the same path a click would, which is what makes the results ordinary keys and labels you can
 * see, edit and undo.
 */
export const AI_TOOLS: Anthropic.Tool[] = [
    {
        name: "rename_label",
        description:
            "Give one of the model's labels a name. This is how a rig gets described: `L5` becomes `Tail`, and every later request can then just say 'the tail'. Names are remembered with the workspace.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "The label id, as listed in the rig." },
                name: { type: "string", description: "Short name, e.g. Tail, Head, Left arm." },
            },
            required: ["label", "name"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "add_movement",
        description:
            "Give a label a movement, which is what puts a row on the timeline, without keying it yet. Usually unnecessary — apply_preset and set_key create the movement themselves if it doesn't exist — this is only for setting one up ahead of a pose you'll key by hand later.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "The label id to give a movement." },
                kind: {
                    type: "string",
                    enum: ["translate", "rotate", "scale"],
                    description: "What kind of motion the movement carries.",
                },
            },
            required: ["label", "kind"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "apply_preset",
        description:
            "Write a canned movement's keyframes onto a label across a range of frames. This is the main way to make something move. Identified by label + kind rather than a movement id: if that label has no movement of this kind yet, one is created first — so a tail can get spin, sway on translate, and a scale pulse all keyed in the same plan, each call making its own movement, with nothing to look up or predict in between. A label can carry at most one movement per kind; calling this again on one that already exists keys it further rather than making a second.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "The label id to animate." },
                kind: {
                    type: "string",
                    enum: ["translate", "rotate", "scale"],
                    description:
                        "Which of the label's movements to key — created first if it doesn't exist.",
                },
                preset: {
                    type: "string",
                    enum: ["spin", "back-and-forth", "sway", "bob", "drift"],
                    description:
                        "spin: one full turn. back-and-forth: out and back. sway: one way, through the middle, the other way, back. bob: two bounces. drift: a straight move one way.",
                },
                axis: {
                    type: "string",
                    enum: ["x", "y", "z"],
                    description: "Which axis it acts on.",
                },
                amount: {
                    type: "number",
                    description:
                        "How far, in the movement's own units. Rotations are 0-255 for a full turn, so 32 is about 45 degrees. Leave near the preset's default unless asked for something bigger or subtler.",
                },
                from: { type: "number", description: "First frame of the range." },
                to: { type: "number", description: "Last frame of the range." },
            },
            required: ["label", "kind", "preset", "axis", "amount", "from", "to"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "set_key",
        description:
            "Set one axis of one of a label's movements on one frame, writing a keyframe there. Like apply_preset, identified by label + kind — the movement is created first if it doesn't exist yet. Use this for poses a preset can't express; prefer apply_preset for anything repetitive.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "The label id to key." },
                kind: {
                    type: "string",
                    enum: ["translate", "rotate", "scale"],
                    description:
                        "Which of the label's movements to key — created first if it doesn't exist.",
                },
                frame: { type: "number", description: "Which frame to key." },
                axis: { type: "string", enum: ["x", "y", "z"] },
                value: {
                    type: "number",
                    description:
                        "Rotations are 0-255 for a full turn. Translations are model units. Scales are 128 for no change.",
                },
            },
            required: ["label", "kind", "frame", "axis", "value"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "set_length",
        description:
            "Change how many frames the animation runs for. Trimming drops the frames past the new end and their keys with them.",
        input_schema: {
            type: "object",
            properties: { frames: { type: "number", description: "New length, 1 to 512." } },
            required: ["frames"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "select_label",
        description:
            "Make a label's geometry the live selection, so the person can see exactly which part of the model you mean. Use this when you're identifying something rather than changing it.",
        input_schema: {
            type: "object",
            properties: { label: { type: "number" } },
            required: ["label"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        name: "split_label",
        description:
            "Split one label into a chain of new labels along an axis, ordered root to tip. Use this when a single label covers something that should bend in more than one place — a tail or a long limb rigged as one rigid label only ever swings as a block. The first segment (nearest the low end of the axis) keeps the original label id and anything already named or keyed on it; the rest get freshly assigned ids, reported back so they can be named and given their own movements. Splitting is geometric, cutting the label's existing vertices into contiguous groups by position — it cannot pull in vertices from other labels.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "The label id to split." },
                count: {
                    type: "number",
                    description:
                        "How many segments, 2 to 8. Pick something the vertex count can actually support.",
                },
                axis: {
                    type: "string",
                    enum: ["x", "y", "z"],
                    description:
                        "Which axis to cut along — usually whichever the label's extent is longest on.",
                },
            },
            required: ["label", "count", "axis"],
            additionalProperties: false,
        },
        strict: true,
    },
];

/** A tool call as proposed, before anything has been done to the editor. */
export type PlannedAction = {
    id: string;
    name: string;
    input: Record<string, unknown>;
    /** One line describing what it will do, written for the person approving it. */
    summary: string;
    /** Set when the action can't be carried out, and why. */
    problem?: string;
    /** Set on success when there's something worth telling the assistant, e.g. ids it created. */
    note?: string;
};

/**
 * What running one action came back with.
 *
 * Most actions either just work or don't, which `string | null` says fine on its own — `null` for
 * success, the message otherwise. `split_label` is the odd one out: it succeeds but invents new
 * label ids the assistant has no way to predict, so those need reporting back too. `ActionResult`
 * covers both without forcing every other action to route through the richer shape.
 */
export type ActionResult = string | null | { note: string };

/**
 * What the editor has to provide for a plan to be applied.
 *
 * Deliberately the same operations the UI performs, so an assistant can't do anything you
 * couldn't do yourself — and so everything it does lands in the undo history.
 */
export type AiActions = {
    renameLabel: (label: number, name: string) => string | null;
    addMovement: (label: number, kind: "translate" | "rotate" | "scale") => string | null;
    applyPreset: (
        label: number,
        kind: "translate" | "rotate" | "scale",
        preset: string,
        axis: "x" | "y" | "z",
        amount: number,
        from: number,
        to: number,
    ) => string | null;
    setKey: (
        label: number,
        kind: "translate" | "rotate" | "scale",
        frame: number,
        axis: "x" | "y" | "z",
        value: number,
    ) => string | null;
    setLength: (frames: number) => string | null;
    selectLabel: (label: number) => string | null;
    splitLabel: (label: number, count: number, axis: "x" | "y" | "z") => ActionResult;
};

/** Reads a tool call into something the plan list can show without running anything. */
export function describeAction(name: string, input: Record<string, unknown>): string {
    switch (name) {
        case "rename_label":
            return `Name label ${input.label} “${String(input.name)}”`;
        case "add_movement":
            return `Give label ${input.label} a ${String(input.kind)} movement`;
        case "apply_preset":
            return `Apply ${String(input.preset)} to label ${input.label}'s ${String(
                input.kind,
            )} on ${String(input.axis).toUpperCase()}, amount ${input.amount}, frames ${
                input.from
            }–${input.to}`;
        case "set_key":
            return `Key label ${input.label}'s ${String(input.kind)} ${String(
                input.axis,
            ).toUpperCase()} = ${input.value} on frame ${input.frame}`;
        case "set_length":
            return `Set the animation to ${input.frames} frames`;
        case "select_label":
            return `Select label ${input.label} in the viewport`;
        case "split_label":
            return `Split label ${input.label} into ${input.count} along ${String(
                input.axis,
            ).toUpperCase()}`;
        default:
            return `${name} ${JSON.stringify(input)}`;
    }
}

/** Runs one planned action. Returns a problem, a note, or null when it worked with nothing to add. */
export function runAction(actions: AiActions, action: PlannedAction): ActionResult {
    const input = action.input;
    switch (action.name) {
        case "rename_label":
            return actions.renameLabel(Number(input.label), String(input.name));
        case "add_movement":
            return actions.addMovement(
                Number(input.label),
                input.kind as "translate" | "rotate" | "scale",
            );
        case "apply_preset":
            return actions.applyPreset(
                Number(input.label),
                input.kind as "translate" | "rotate" | "scale",
                String(input.preset),
                input.axis as "x" | "y" | "z",
                Number(input.amount),
                Number(input.from),
                Number(input.to),
            );
        case "set_key":
            return actions.setKey(
                Number(input.label),
                input.kind as "translate" | "rotate" | "scale",
                Number(input.frame),
                input.axis as "x" | "y" | "z",
                Number(input.value),
            );
        case "set_length":
            return actions.setLength(Number(input.frames));
        case "select_label":
            return actions.selectLabel(Number(input.label));
        case "split_label":
            return actions.splitLabel(
                Number(input.label),
                Number(input.count),
                input.axis as "x" | "y" | "z",
            );
        default:
            return `The assistant asked for “${action.name}”, which this editor doesn't do.`;
    }
}
