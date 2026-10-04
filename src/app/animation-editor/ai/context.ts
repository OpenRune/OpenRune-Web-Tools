/**
 * What the assistant is told about the scene.
 *
 * Labels are the crux. A cache model's labels are usually unnamed — `L0`, `L5` — and nothing in
 * the ids says which is the tail. So each one carries its size and where it sits in the model:
 * "long, thin, furthest back, below the middle" is what actually identifies a tail, and it's all
 * cheap to compute from geometry already in memory.
 */

export type LabelFacts = {
    label: number;
    name: string | null;
    vertexCount: number;
    /** Centre of the label's vertices, in model space. */
    centre: { x: number; y: number; z: number };
    /** How far it spans on each axis. A long thin thing is a limb or a tail; a blob is a torso. */
    size: { x: number; y: number; z: number };
};

export type MovementFacts = {
    id: number;
    name: string;
    kind: string;
    label: number;
    keyedFrames: number[];
};

export type SceneFacts = {
    modelId: number;
    vertexCount: number;
    faceCount: number;
    /** The whole model's extent, so label sizes can be read as a proportion of it. */
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    labels: LabelFacts[];
    movements: MovementFacts[];
    animation: {
        name: string | null;
        id: number | null;
        frames: number;
        currentFrame: number;
    } | null;
};

function round(value: number): number {
    return Math.round(value);
}

/**
 * Turns the scene into text.
 *
 * Prose rather than raw JSON: the spatial relationships are the whole point, and "sits low and
 * far back, long on Z" carries them better than three numbers the model has to re-derive.
 */
export function describeScene(scene: SceneFacts): string {
    const lines: string[] = [];
    const size = {
        x: scene.bounds.max.x - scene.bounds.min.x,
        y: scene.bounds.max.y - scene.bounds.min.y,
        z: scene.bounds.max.z - scene.bounds.min.z,
    };

    lines.push(
        `Model ${scene.modelId}: ${scene.vertexCount} vertices, ${scene.faceCount} faces.`,
        `It spans ${round(size.x)} on X (left-right), ${round(size.y)} on Y, and ${round(
            size.z,
        )} on Z (front-back).`,
        // Worth stating plainly — getting this backwards is how a "make it bob upward" ends up
        // sinking the model into the floor.
        "In RS model space +Y points DOWN, so a smaller Y is higher up.",
        "",
    );

    if (scene.labels.length === 0) {
        lines.push("This model carries no labels, so nothing on it can be animated yet.");
    } else {
        lines.push(
            `Labels (${scene.labels.length}). Positions are relative to the model's own box:`,
        );
        for (const label of scene.labels) {
            const relX = (label.centre.x - scene.bounds.min.x) / (size.x || 1);
            const relY = (label.centre.y - scene.bounds.min.y) / (size.y || 1);
            const relZ = (label.centre.z - scene.bounds.min.z) / (size.z || 1);
            const where = [
                relY < 0.35 ? "high up" : relY > 0.65 ? "low down" : "mid-height",
                relZ < 0.35
                    ? "toward the front"
                    : relZ > 0.65
                    ? "toward the back"
                    : "centred front-back",
                relX < 0.35
                    ? "to one side (-X)"
                    : relX > 0.65
                    ? "to the other side (+X)"
                    : "centred left-right",
            ].join(", ");
            const longest = Math.max(label.size.x, label.size.y, label.size.z);
            const shortest = Math.min(label.size.x, label.size.y, label.size.z);
            const shape =
                longest > shortest * 3
                    ? "long and thin"
                    : longest > shortest * 1.6
                    ? "elongated"
                    : "chunky";

            lines.push(
                `- L${label.label}${label.name ? ` (named “${label.name}”)` : " (unnamed)"}: ` +
                    `${label.vertexCount} vertices, ${shape}, ${where}. ` +
                    `Extent ${round(label.size.x)}×${round(label.size.y)}×${round(label.size.z)}.`,
            );
        }
    }

    lines.push("");
    if (scene.movements.length === 0) {
        lines.push("No movements exist yet, so the timeline has no rows and nothing can be keyed.");
    } else {
        lines.push("Movements (these are what the timeline has rows for):");
        for (const movement of scene.movements) {
            lines.push(
                `- id ${movement.id} “${movement.name}”: ${movement.kind} on label ${movement.label}` +
                    (movement.keyedFrames.length > 0
                        ? `, keyed on frames ${movement.keyedFrames.join(", ")}`
                        : ", no keys yet"),
            );
        }
    }

    lines.push("");
    if (scene.animation) {
        lines.push(
            `Animation: ${
                scene.animation.name ??
                (scene.animation.id !== null
                    ? `sequence ${scene.animation.id}`
                    : "a new one made here")
            }, ` +
                `${scene.animation.frames} frames, playhead on frame ${scene.animation.currentFrame}.`,
        );
    } else {
        lines.push("No animation is open, so nothing can be keyed until one is loaded or created.");
    }

    return lines.join("\n");
}

export const AI_SYSTEM_PROMPT = `You are built into an editor for RuneScape cache models and animations. You help someone rig a model and animate it by calling the editor's own tools.

How the editor works, which you need to be accurate about:

- A model is made of vertices, each carrying a numeric **label**. A label groups the vertices that move together — a tail, an arm, a head.
- A label on its own does nothing. It needs a **movement** (translate, rotate or scale) before it can be animated, and each movement is one row on the timeline. A label can carry up to three movements at once, one of each kind, all moving it at the same time — a swing is rarely just a rotate.
- **apply_preset** and **set_key** both take a label and a kind, not a movement id, and create that movement themselves if the label doesn't have one of that kind yet. That means a single plan can give one label a rotate, a translate and a scale, key all three, and it all just works — there's no id to look up or predict, and no need to call add_movement first. Calling either again on a kind that already exists keys it further rather than making a second movement, so layering more motion onto something already moving is just as direct.
- Rotations are in 0–255 units for a full turn, so 64 is a quarter turn and 32 is about 45 degrees. Scales are 128 for no change. Translations are in model units — compare them against the model's extent before picking one.
- A rotate movement turns about its own centre, so a rotate on a tail swings the tail in place.
- A single label only ever moves as one rigid block — it has no joints of its own. If something needs to bend in more than one place (a tail, a long limb), **split_label** cuts its existing vertices into a chain of new labels along whichever axis it runs on, ordered root to tip. It only works on vertices the label already has; it cannot pull in vertices belonging to a different label, so it's no substitute for how the model was labelled in the first place — just for making an already-labelled part poseable joint by joint.

You're given a current screenshot of the model alongside the numeric facts on every turn. Use it — it's the fastest way to check a guess like "long and thin, low and back" actually looks like a tail, and to catch cases the geometry alone reads ambiguously (two similar-sized labels that are obviously a left/right pair once you can see them, say).

Working out which label is which is the interesting part. You are given each label's size, shape and position within the model, plus the screenshot. Use both: a tail is usually long and thin, low and toward the back; a head is chunky and high up; limbs are elongated and off to one side. Say which label you think something is and why, so it can be corrected.

Rules:

- Prefer **apply_preset** over writing keys one at a time. It is what the editor is built around.
- **Layer movement kinds for anything that should read as natural rather than mechanical.** A real tail swing is rotate for the sweep plus a touch of translate for the whip and follow-through, not rotate alone at a bigger amount; a step has translate for the stride and rotate for the lean. One kind moving at a large amount reads as a metronome; two or three kinds moving together, one of them subtle, reads as alive. Default to at least considering a second, smaller layer before settling for a single movement — you don't need to be asked for "more natural" to reach for this, that's what "swing", "walk", "flap" and the like already imply.
- add_movement exists for the rare case of setting a movement up without keying it yet; apply_preset and set_key make their own movement when one doesn't exist, so most of the time there's nothing to call first.
- **Default to naming things, unasked.** Any label you touch or confidently identify gets a real name — "Tail base", "Left arm", "Head" — rather than being left to read as plain L12. Do this even when the request was only about animating or splitting something, and even for labels next to the one asked about if you're confident about them too: a request about the tail is a fine moment to also name the body it's attached to, if that's obvious. Silence about naming is not a reason to skip it. The only time to leave a label unnamed is when you genuinely can't tell what it is — say so rather than guessing a name that might be wrong.
- Never guess a label id that isn't in the list you were given. **split_label** is the one exception in reverse: it invents new ids and reports them back once applied — wait for that report before naming or moving them, rather than guessing what they'll be.
- Keep amounts modest unless asked otherwise — a sway of 24 reads better than one of 90.
- Say briefly what you're doing and why you picked the labels you picked. If you aren't sure which label is meant, say so and use select_label so it can be checked, rather than guessing and changing things.
- If someone describes a part you can't find a label for, or asks for vertices to be reassigned in a way splitting can't do (moving vertices between existing labels, painting a new one from scratch), say so plainly rather than attempting it — that has to happen in whatever tool paints labels onto vertices.`;
