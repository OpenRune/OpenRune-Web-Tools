"use client";

import { RotateCcw } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import { Hint } from "../../components/ui/hint";
import { cn } from "../../util/cn";
import {
    HOTKEY_ACTIONS,
    type HotkeyActionId,
    type HotkeyBindings,
    comboFromEvent,
    defaultBindings,
    formatCombo,
} from "./hotkeys";

/**
 * Lists every editor action with its current key and lets the user rebind by pressing a new
 * combo. Reports when it's capturing so the editor's own dispatcher stays quiet meanwhile.
 */
export function HotkeyEditor({
    bindings,
    onChange,
    onListeningChange,
}: {
    bindings: HotkeyBindings;
    onChange: (bindings: HotkeyBindings) => void;
    onListeningChange: (listening: boolean) => void;
}): JSX.Element {
    const [listeningId, setListeningId] = useState<HotkeyActionId | null>(null);

    useEffect(() => {
        onListeningChange(listeningId !== null);
        if (listeningId === null) return;

        const onKeyDown = (event: KeyboardEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
                setListeningId(null);
                return;
            }
            const combo = comboFromEvent(event);
            if (!combo) return;
            onChange({ ...bindings, [listeningId]: combo });
            setListeningId(null);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [listeningId, bindings, onChange, onListeningChange]);

    const conflicts = useMemo(() => {
        const byCombo = new Map<string, HotkeyActionId[]>();
        for (const action of HOTKEY_ACTIONS) {
            const combo = bindings[action.id];
            byCombo.set(combo, [...(byCombo.get(combo) ?? []), action.id]);
        }
        return byCombo;
    }, [bindings]);

    const categories = useMemo(() => {
        const order: string[] = [];
        for (const action of HOTKEY_ACTIONS)
            if (!order.includes(action.category)) order.push(action.category);
        return order;
    }, []);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Hotkeys
                </p>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => onChange(defaultBindings())}
                >
                    <RotateCcw className="size-3" /> Blender defaults
                </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
                {categories.map((category) => (
                    <div key={category}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                            {category}
                        </p>
                        <div className="space-y-0.5">
                            {HOTKEY_ACTIONS.filter((a) => a.category === category).map((action) => {
                                const combo = bindings[action.id];
                                const clash = (conflicts.get(combo) ?? []).filter(
                                    (id) => id !== action.id,
                                );
                                const listening = listeningId === action.id;
                                return (
                                    <div
                                        key={action.id}
                                        className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-card"
                                    >
                                        <span className="min-w-0 flex-1 truncate">
                                            {action.label}
                                        </span>
                                        {clash.length > 0 ? (
                                            <Hint
                                                heading="Conflict"
                                                detail={`This combo is also bound to ${clash
                                                    .map(
                                                        (id) =>
                                                            HOTKEY_ACTIONS.find((a) => a.id === id)
                                                                ?.label ?? id,
                                                    )
                                                    .join(", ")}`}
                                            >
                                                <span className="shrink-0 text-[10px] text-amber-500">
                                                    conflict
                                                </span>
                                            </Hint>
                                        ) : null}
                                        <Hint
                                            side="left"
                                            heading={listening ? "Listening" : "Rebind"}
                                            detail={
                                                listening
                                                    ? "Press the new combo, or Esc to cancel"
                                                    : `Click to change the shortcut for ${action.label}`
                                            }
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setListeningId(listening ? null : action.id)
                                                }
                                                className={cn(
                                                    "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                                                    listening
                                                        ? "border-[#e87d0d] bg-[#e87d0d]/15 text-foreground"
                                                        : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                                                )}
                                            >
                                                {listening ? "Press keys…" : formatCombo(combo)}
                                            </button>
                                        </Hint>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
