"use client";

import { History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import React from "react";

import { Button } from "../../components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Hint } from "../../components/ui/hint";
import { cn } from "../../util/cn";
import { type History, canRedo, canUndo } from "./history";

/**
 * Undo, redo, and the list of everything you've done.
 *
 * The list is the point: undo is fine for the last thing, but "put it back to before I applied
 * that preset to eight movements" is a jump, not eight presses. Every entry is a whole state, so
 * clicking one goes straight there — forwards as well as back, until the next edit drops
 * whatever was ahead.
 */
export function HistoryMenu({
    history,
    onUndo,
    onRedo,
    onGoTo,
    undoCombo,
    redoCombo,
}: {
    history: History;
    onUndo: () => void;
    onRedo: () => void;
    onGoTo: (index: number) => void;
    undoCombo: string;
    redoCombo: string;
}): JSX.Element {
    const undoable = canUndo(history);
    const redoable = canRedo(history);
    const previous = history.entries[history.index - 1];
    const next = history.entries[history.index + 1];

    return (
        <div className="flex items-center">
            <Hint
                side="bottom"
                heading={`Undo (${undoCombo})`}
                detail={previous ? `Back to “${previous.label}”` : "Nothing to undo yet"}
                label="Undo"
            >
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={!undoable}
                    onClick={onUndo}
                >
                    <Undo2 className="size-4" />
                </Button>
            </Hint>

            <Hint
                side="bottom"
                heading={`Redo (${redoCombo})`}
                detail={next ? `Forward to “${next.label}”` : "Nothing to redo"}
                label="Redo"
            >
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={!redoable}
                    onClick={onRedo}
                >
                    <Redo2 className="size-4" />
                </Button>
            </Hint>

            <DropdownMenu>
                <Hint
                    side="bottom"
                    heading="History"
                    detail="Jump to any point in this session"
                    label="History"
                >
                    <DropdownMenuTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            disabled={history.entries.length === 0}
                        >
                            <HistoryIcon className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                    {/* Newest first: what you just did is what you're most likely reaching for. */}
                    {history.entries
                        .map((entry, index) => ({ entry, index }))
                        .reverse()
                        .map(({ entry, index }) => (
                            <DropdownMenuItem
                                key={index}
                                onSelect={() => onGoTo(index)}
                                className={cn(
                                    "text-xs",
                                    index === history.index && "bg-[#e87d0d]/15 text-foreground",
                                    index > history.index && "text-muted-foreground/50",
                                )}
                            >
                                <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {index === history.index ? "▸" : ""}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                            </DropdownMenuItem>
                        ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
