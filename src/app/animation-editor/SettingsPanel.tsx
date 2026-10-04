"use client";

import React, { useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../util/cn";
import { AssistantSettings } from "./AssistantSettings";
import { HotkeyEditor } from "./HotkeyEditor";
import type { HotkeyBindings } from "./hotkeys";

type SettingsTab = "keys" | "assistant";

const TABS: { id: SettingsTab; label: string }[] = [
    { id: "keys", label: "Keys" },
    { id: "assistant", label: "Assistant" },
];

/**
 * Editor settings, in a modal off the toolbar's gear.
 *
 * Settings belong to the editor, not to whatever animation happens to be open, so they live here
 * rather than in the sidebar — which is about the thing you're editing. Tabbed from the start:
 * keys are the only ones so far, but they won't be the last.
 */
export function SettingsPanel({
    open,
    onOpenChange,
    bindings,
    onBindingsChange,
    onListeningChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bindings: HotkeyBindings;
    onBindingsChange: (next: HotkeyBindings) => void;
    onListeningChange: (listening: boolean) => void;
}): JSX.Element {
    const [tab, setTab] = useState<SettingsTab>("keys");
    /** True while a shortcut is being rebound, so the modal can let Escape through to it. */
    const [listening, setListening] = useState(false);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Explicit width: `max-w-*` isn't in this build's generated CSS, so the dialog's
                default width class does nothing and it renders full-bleed. */}
            <DialogContent
                data-testid="settings-modal"
                className="w-[560px] max-w-[92vw] gap-0 p-0"
                // Escape cancels a rebind first; it shouldn't also shut the window you're
                // rebinding in. Clicking away during one is the same story.
                onEscapeKeyDown={(event) => {
                    if (listening) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                    if (listening) event.preventDefault();
                }}
            >
                <DialogHeader className="space-y-0.5 border-b border-border px-4 py-3 text-left">
                    <DialogTitle className="text-sm">Settings</DialogTitle>
                    <DialogDescription className="text-xs">
                        Editor settings. They follow you between animations and models.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex shrink-0 gap-1 border-b border-border px-4">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={cn(
                                "-mb-px border-b-2 px-2 py-2 text-xs font-medium transition-colors",
                                tab === t.id
                                    ? "border-[#e87d0d] text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="max-h-[60vh] min-h-0 overflow-y-auto p-4">
                    {tab === "keys" ? (
                        <HotkeyEditor
                            bindings={bindings}
                            onChange={onBindingsChange}
                            onListeningChange={(next) => {
                                setListening(next);
                                onListeningChange(next);
                            }}
                        />
                    ) : null}
                    {tab === "assistant" ? <AssistantSettings /> : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
