"use client";

import type { SeqType } from "@openrune/engine";
import React from "react";

import { Hint } from "../../components/ui/hint";

/** The client advances one animation unit per 20ms render cycle. */
const TICK_MS = 20;

type NumberField = {
    key:
        | "frameStep"
        | "forcedPriority"
        | "leftHandItem"
        | "rightHandItem"
        | "maxLoops"
        | "precedenceAnimating"
        | "priority"
        | "replyMode";
    label: string;
    detail: string;
};

/** Everything on a sequence that's a plain number, in the order the format writes them. */
const NUMBER_FIELDS: NumberField[] = [
    {
        key: "frameStep",
        label: "frameStep",
        detail: "How far the entity moves per frame, in units. -1 for an animation that doesn't move it",
    },
    {
        key: "priority",
        label: "priority",
        detail: "Which animation wins when two want to play at once. Higher takes precedence",
    },
    {
        key: "forcedPriority",
        label: "forcedPriority",
        detail: "Priority used when the animation is forced, overriding whatever is playing",
    },
    {
        key: "precedenceAnimating",
        label: "precedenceAnimating",
        detail: "Priority used while the entity is already animating",
    },
    {
        key: "maxLoops",
        label: "maxLoops",
        detail: "How many times it repeats before stopping. 99 is the default",
    },
    {
        key: "replyMode",
        label: "replyMode",
        detail: "What happens when the animation is interrupted",
    },
    {
        key: "leftHandItem",
        label: "leftHandItem",
        detail: "Item the entity holds in its left hand while this plays. -1 for none",
    },
    {
        key: "rightHandItem",
        label: "rightHandItem",
        detail: "Item in the right hand. -1 for none",
    },
];

function Row({
    label,
    detail,
    children,
}: {
    label: string;
    detail: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
            <Hint heading={label} detail={detail}>
                <span className="min-w-0 flex-1 cursor-help truncate font-mono text-muted-foreground">
                    {label}
                </span>
            </Hint>
            {children}
        </div>
    );
}

/** A value the format carries but that isn't editable here — a list, a map, or a derived count. */
function ReadOnlyRow({
    label,
    detail,
    value,
}: {
    label: string;
    detail: string;
    value: string;
}): JSX.Element {
    return (
        <Row label={label} detail={detail}>
            <span className="shrink-0 font-mono text-muted-foreground/70">{value}</span>
        </Row>
    );
}

/**
 * The loaded sequence's own settings — everything about it that isn't a keyframe.
 *
 * These are the fields the client reads, so most of them describe how the animation behaves
 * *in-game* rather than here: priorities, hand items, loop counts. Editing them changes the
 * sequence in memory; nothing is written back to the cache. The one that does change what you
 * see is the frame delay, which is what the timeline plays back at.
 */
export function SeqConfigEditor({
    seq,
    frame,
    onChange,
}: {
    seq: SeqType | null;
    /** The frame the playhead is on, whose delay is editable here. */
    frame: number;
    /** Called after a field is edited, so the editor can re-render and re-time playback. */
    onChange: () => void;
}): JSX.Element {
    if (!seq) {
        return (
            <p className="text-[11px] text-muted-foreground">
                No animation loaded. Pick one on the Animations tab to see its settings.
            </p>
        );
    }

    const setNumber = (key: NumberField["key"], raw: string): void => {
        const value = Number.parseInt(raw, 10);
        if (Number.isNaN(value)) return;
        seq[key] = value;
        onChange();
    };

    const delay = seq.frameLengths[frame] ?? 1;

    return (
        <div className="space-y-2 text-[11px]">
            <p className="text-muted-foreground">
                The loaded sequence&apos;s own settings. Most of these tell the client how to play
                it and do nothing in this editor; frame delay is the one that changes playback here.
            </p>

            <div className="space-y-0.5 rounded border border-border/60 bg-background p-1.5">
                <Row
                    label="frameDelay"
                    detail={`How long frame ${frame} is held, in client ticks of ${TICK_MS}ms`}
                >
                    <span className="shrink-0 text-muted-foreground/60">{delay * TICK_MS}ms</span>
                    <input
                        type="number"
                        min={1}
                        max={255}
                        value={delay}
                        aria-label={`Delay on frame ${frame}`}
                        onChange={(e) => {
                            const value = Number.parseInt(e.target.value, 10);
                            if (Number.isNaN(value)) return;
                            seq.frameLengths[frame] = Math.max(1, Math.min(255, value));
                            onChange();
                        }}
                        className="no-spinner h-5 w-14 shrink-0 rounded border border-border/60 bg-card px-1 text-center font-mono text-foreground"
                    />
                </Row>

                <Row label="stretches" detail="Stretches the animation to fill the time it's given">
                    <input
                        type="checkbox"
                        checked={seq.stretches}
                        aria-label="stretches"
                        onChange={(e) => {
                            seq.stretches = e.target.checked;
                            onChange();
                        }}
                        className="size-3.5 shrink-0 accent-[#e87d0d]"
                    />
                </Row>

                <Row
                    label="looping"
                    detail="Whether the animation starts over when it reaches the end"
                >
                    <input
                        type="checkbox"
                        checked={seq.looping}
                        aria-label="looping"
                        onChange={(e) => {
                            seq.looping = e.target.checked;
                            onChange();
                        }}
                        className="size-3.5 shrink-0 accent-[#e87d0d]"
                    />
                </Row>

                {NUMBER_FIELDS.map((field) => (
                    <Row key={field.key} label={field.label} detail={field.detail}>
                        <input
                            type="number"
                            value={seq[field.key]}
                            aria-label={field.label}
                            onChange={(e) => setNumber(field.key, e.target.value)}
                            className="no-spinner h-5 w-16 shrink-0 rounded border border-border/60 bg-card px-1 text-center font-mono text-foreground"
                        />
                    </Row>
                ))}
            </div>

            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                Carried, not editable
            </p>
            <div className="space-y-0.5 rounded border border-border/60 bg-background p-1.5">
                <ReadOnlyRow
                    label="frameIds"
                    detail="The posed frames this sequence plays, in order. Edit them on the timeline"
                    value={`${seq.frameIds.length} frames`}
                />
                <ReadOnlyRow
                    label="chatFrameIds"
                    detail="Head/chat frames played alongside the body ones"
                    value={seq.chatFrameIds ? `${seq.chatFrameIds.length} frames` : "none"}
                />
                <ReadOnlyRow
                    label="soundEffects"
                    detail="Sounds fired on particular frames"
                    value={seq.frameSounds ? `${seq.frameSounds.size} frames` : "none"}
                />
                <ReadOnlyRow
                    label="mask"
                    detail="Which body parts this animation overrides on the entity"
                    value={seq.masks ? `${seq.masks.length} entries` : "none"}
                />
                {seq.isSkeletalSeq() ? (
                    <>
                        <ReadOnlyRow
                            label="skeletalId"
                            detail="The Maya animation this sequence plays, as archive:file"
                            value={`${seq.skeletalId >>> 16}:${seq.skeletalId & 0xffff}`}
                        />
                        <ReadOnlyRow
                            label="skeletalRange"
                            detail="The slice of the Maya animation this sequence uses"
                            value={`${seq.skeletalStart} – ${seq.skeletalEnd}`}
                        />
                        <ReadOnlyRow
                            label="skeletalMasks"
                            detail="Per-bone flags for which bones this sequence drives"
                            value={seq.skeletalMasks ? `${seq.skeletalMasks.length} bones` : "none"}
                        />
                    </>
                ) : null}
            </div>

            <p className="text-muted-foreground/70">
                Not decoded by this engine, so they aren&apos;t shown: interleaveLeave, rangeBegin,
                rangeEnd, verticalOffset, skeletalSounds.
            </p>
        </div>
    );
}
