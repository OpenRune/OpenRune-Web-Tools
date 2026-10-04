"use client";

import React, { useCallback, useRef } from "react";

import { cn } from "../../util/cn";

/**
 * Frames sit between these, as a percentage of the track: inset from both ends so the playhead
 * handle and the edge ticks never poke past the rounded corners.
 *
 * Shared by the forward and inverse mappings, and matched by `DopeSheet` so the two reels put
 * the same frame in the same place.
 */
export const EDGE_INSET_PCT = 1.5;
export const TRACK_SPAN_PCT = 97;

/**
 * A scrubbable timeline track: tick marks per frame/tick (when there aren't too many to read),
 * taller+coloured marks for whichever ones have live edits, and a draggable playhead.
 */
export function Timeline({
    total,
    step,
    keyframedSteps,
    onScrub,
}: {
    total: number;
    step: number;
    keyframedSteps?: Set<number>;
    onScrub: (n: number) => void;
}): JSX.Element {
    const trackRef = useRef<HTMLDivElement>(null);
    /** The pointer doing the dragging, or null. An id rather than a flag, so a second finger
     *  or a stray move from another device can't drive the playhead. */
    const draggingRef = useRef<number | null>(null);

    /**
     * Which frame a screen x means — the exact inverse of `toPct` below.
     *
     * It has to be, or pressing on the playhead moves it: the mapping that draws frame 20 at
     * 41.1% and a mapping that reads 41.1% back as frame 20.3 disagree by a frame or two, so the
     * playhead hops the moment you touch it and sits slightly off the cursor while you drag.
     */
    const frameFromClientX = useCallback(
        (clientX: number): number | null => {
            const el = trackRef.current;
            if (!el || total <= 1) return null;
            const rect = el.getBoundingClientRect();
            const pct = ((clientX - rect.left) / rect.width) * 100;
            const frame = Math.round(((pct - EDGE_INSET_PCT) / TRACK_SPAN_PCT) * (total - 1));
            return Math.min(total - 1, Math.max(0, frame));
        },
        [total],
    );

    const scrubFromClientX = useCallback(
        (clientX: number) => {
            const frame = frameFromClientX(clientX);
            if (frame !== null) onScrub(frame);
        },
        [frameFromClientX, onScrub],
    );

    const endDrag = useCallback(() => {
        draggingRef.current = null;
    }, []);

    const onPointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            // Left button only: a right-click shouldn't leave the playhead following the cursor.
            if (event.button !== 0) return;
            draggingRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubFromClientX(event.clientX);
        },
        [scrubFromClientX],
    );

    const onPointerMove = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (draggingRef.current !== event.pointerId) return;
            scrubFromClientX(event.clientX);
        },
        [scrubFromClientX],
    );

    const onPointerUp = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (draggingRef.current !== event.pointerId) return;
            endDrag();
            // Releasing a capture that isn't held throws, and capture can be lost without the
            // release ever running — a re-render, the window losing focus, a cancelled gesture.
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        [endDrag],
    );

    const showTicks = total > 1 && total <= 120;
    const toPct = (n: number): number =>
        total > 1 ? EDGE_INSET_PCT + (n / (total - 1)) * TRACK_SPAN_PCT : 50;
    const playheadPct = toPct(step);

    return (
        <div
            ref={trackRef}
            className="relative h-8 flex-1 cursor-pointer touch-none rounded-md border border-border bg-background"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            // The reliable end of a drag. `pointerup` can go missing — the browser cancels the
            // gesture, the window loses focus, a re-render drops the capture — and without this
            // the playhead carries on following the cursor with no button held.
            onLostPointerCapture={endDrag}
            onPointerCancel={endDrag}
        >
            <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-md bg-[#5680c2]/10"
                style={{ width: `${playheadPct}%` }}
            />
            {showTicks
                ? Array.from({ length: total }).map((_, i) => {
                      const pct = toPct(i);
                      const keyframed = keyframedSteps?.has(i) ?? false;
                      return (
                          <div
                              key={i}
                              className={cn(
                                  "pointer-events-none absolute bottom-0 w-px",
                                  keyframed ? "h-3.5 bg-[#e87d0d]" : "h-1.5 bg-border",
                              )}
                              style={{ left: `${pct}%` }}
                          />
                      );
                  })
                : null}
            {/* Blender's current-frame blue. */}
            <div
                className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-[#5680c2]"
                style={{ left: `${playheadPct}%` }}
            />
            <div
                className="pointer-events-none absolute -top-1 size-3 -translate-x-1/2 rounded-full border-2 border-[#5680c2] bg-background shadow"
                style={{ left: `${playheadPct}%` }}
            />
        </div>
    );
}
