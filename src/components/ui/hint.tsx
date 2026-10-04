"use client";

import * as React from "react";

import { cn } from "../../util/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/**
 * The one way this app explains a control.
 *
 * Wrap anything hoverable and it gets the same bubble everywhere: a short bold heading saying
 * what the control is, and an optional line underneath saying what it does or what state it's in.
 * Headings are written as a noun or an imperative — "Isolate", "Bake tweens" — and details as a
 * full sentence without a trailing full stop.
 *
 * This replaces the browser's native `title`, which arrives after a second of stillness, can't be
 * styled, and stacks badly next to other controls. `title` is still right for a plain bit of text
 * that isn't a control — a truncated name, say.
 */
export function Hint({
    heading,
    detail,
    side = "top",
    /** Set when the wrapped element has no visible text of its own. */
    label,
    children,
    className,
}: {
    heading: string;
    detail?: React.ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    label?: string;
    children: React.ReactElement;
    className?: string;
}): JSX.Element {
    const trigger =
        label === undefined ? children : React.cloneElement(children, { "aria-label": label });

    return (
        <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            {/* Never takes the pointer. A bubble opening sideways lands across the control's
                neighbour, and hovering it would otherwise hover the tooltip instead of the button
                underneath — which is how you end up unable to click the thing next door. */}
            <TooltipContent
                side={side}
                className={cn("tooltip-passthrough pointer-events-none max-w-52", className)}
            >
                <p className="font-medium">{heading}</p>
                {detail ? <p className="text-muted-foreground">{detail}</p> : null}
            </TooltipContent>
        </Tooltip>
    );
}
