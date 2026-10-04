"use client";

import {
    AlertTriangle,
    Check,
    ChevronDown,
    Key,
    Loader2,
    Send,
    Sparkles,
    Square,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Separator } from "../../components/ui/separator";
import { cn } from "../../util/cn";
import { AI_MODELS, type AiModelId, turnCost } from "./ai/client";
import type { AiAssistant, AiEntry } from "./useAiAssistant";

function tokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Under a cent reads as "<$0.01" rather than a row of zeroes. */
function dollars(amount: number): string {
    return amount < 0.01 ? "<$0.01" : `${amount.toFixed(2)}`;
}

/** The assistant's own accent — the app's default button is black/white, not this orange. */
const brandButtonClass = "bg-[#e87d0d] text-white shadow-none hover:bg-[#e87d0d]/90";

/**
 * Which model answers. Shown in the setup and again in the composer, since it's a per-task
 * choice.
 *
 * A real menu rather than a native `<select>` — the browser's own dropdown ignores the app's
 * styling entirely and looks out of place next to everything built from this design system.
 */
function ModelPicker({
    model,
    onChange,
    className,
    showNote = false,
}: {
    model: AiModelId;
    onChange: (next: AiModelId) => void;
    className?: string;
    showNote?: boolean;
}): JSX.Element {
    const chosen = AI_MODELS.find((m) => m.id === model) ?? AI_MODELS[0];
    // A bare `<DropdownMenu>` here (no wrapping element) so `className` lands on the trigger
    // button itself — a wrapper `<div>` would swallow a layout class like `flex-1`, since that
    // only does anything on a direct flex child.
    const trigger = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Assistant model"
                    className={cn(
                        "flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none transition-colors hover:border-[#e87d0d]/50 focus-visible:border-[#e87d0d]/70 focus-visible:ring-1 focus-visible:ring-[#e87d0d]/40 data-[state=open]:border-[#e87d0d]/70",
                        className,
                    )}
                >
                    <span className="min-w-0 flex-1 truncate text-left">{chosen.label}</span>
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
                {AI_MODELS.map((option) => (
                    <DropdownMenuItem
                        key={option.id}
                        onSelect={() => onChange(option.id)}
                        className="flex-col items-stretch gap-0"
                    >
                        <span className="flex w-full items-center gap-1.5">
                            <Check
                                className={cn(
                                    "size-3 shrink-0 text-[#e87d0d]",
                                    option.id !== model && "invisible",
                                )}
                            />
                            <span className="flex-1 truncate">{option.label}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                                ${option.inputPrice}/${option.outputPrice} per Mtok
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    if (!showNote) return trigger;

    return (
        <div className="min-w-0">
            {trigger}
            <p className="mt-1 text-[11px] text-muted-foreground/70">{chosen.note}</p>
        </div>
    );
}

/**
 * Ask for something in words; approve what it proposes.
 *
 * Purely a view over `assistant` (from `useAiAssistant`, held above this panel's tab so it
 * outlives it): nothing here is stateful beyond the key-entry draft, so switching away mid-request
 * and back just re-displays whatever `assistant` has by then, rather than losing it.
 *
 * Nothing runs until you press Apply. Everything it does goes through the same functions the UI
 * uses, so it lands as ordinary labels and keyframes — visible on the timeline, editable by
 * hand, and undoable in one step.
 */
export function AiPanel({ assistant }: { assistant: AiAssistant }): JSX.Element {
    const {
        apiKey,
        model,
        setModel,
        prompt,
        setPrompt,
        entries,
        sessionUsage,
        sessionCost,
        busy,
        send,
        stop,
        apply,
        saveKey,
        clearKey,
    } = assistant;

    const [keyDraft, setKeyDraft] = useState("");
    const [workspaceDraft, setWorkspaceDraft] = useState("");

    const transcriptRef = useRef<HTMLDivElement>(null);
    // Follows the conversation down as it grows — a new turn, or the "Thinking…" row that
    // appears the moment one is sent, rather than leaving you scrolled up on an old reply.
    useEffect(() => {
        const el = transcriptRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries, busy]);

    if (!apiKey) {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 text-xs">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#e87d0d]/15 text-[#e87d0d]">
                            <Key className="size-3.5" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                            Bring your own key
                        </span>
                    </div>
                    <p className="text-muted-foreground">
                        Paste an Anthropic API key, or a CometAPI key (starting <code>sk-</code>{" "}
                        without <code>-ant-</code>) if that&apos;s what you use instead. It&apos;s
                        kept in this browser and sent straight to whichever service issued it — this
                        editor has no server to hold it on your behalf.
                    </p>
                </div>

                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="space-y-1.5">
                        <Label
                            htmlFor="ai-key-field"
                            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                            API key
                        </Label>
                        <Input
                            id="ai-key-field"
                            type="password"
                            value={keyDraft}
                            placeholder="sk-ant-… or a CometAPI key"
                            aria-label="Anthropic or CometAPI key"
                            onChange={(e) => setKeyDraft(e.target.value)}
                            className="h-8 font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label
                            htmlFor="ai-workspace-field"
                            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                            Workspace id{" "}
                            <span className="normal-case text-muted-foreground/60">(optional)</span>
                        </Label>
                        <Input
                            id="ai-workspace-field"
                            type="text"
                            value={workspaceDraft}
                            placeholder="wrkspc_… — only if the key isn't scoped to one"
                            aria-label="Anthropic workspace id"
                            onChange={(e) => setWorkspaceDraft(e.target.value)}
                            className="h-8 font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Model
                        </Label>
                        <ModelPicker
                            model={model}
                            onChange={setModel}
                            className="w-full"
                            showNote
                        />
                    </div>
                </div>

                <Button
                    size="sm"
                    className={cn("h-8 w-full", brandButtonClass)}
                    disabled={keyDraft.trim() === ""}
                    onClick={() => {
                        saveKey(keyDraft.trim(), workspaceDraft.trim());
                    }}
                >
                    Save key
                </Button>
                <p className="text-[11px] text-muted-foreground/70">
                    Requests are billed to your own account&apos;s API credit — a Claude Pro or Max
                    subscription doesn&apos;t cover this. Anthropic keys and credit live at
                    console.anthropic.com; CometAPI keys and balance live at cometapi.com.
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col text-xs">
            <div className="flex shrink-0 items-center gap-2 pb-2">
                <Sparkles className="size-3.5 shrink-0 text-[#e87d0d]" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Assistant
                </span>
                {sessionUsage.output > 0 ? (
                    <Badge
                        variant="outline"
                        className="shrink-0 gap-1 border-border/60 px-1.5 py-0 font-mono text-[10px] font-normal text-muted-foreground/70"
                    >
                        {dollars(sessionCost)}
                    </Badge>
                ) : null}
                <button
                    type="button"
                    className="ml-auto shrink-0 text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => {
                        clearKey();
                        setKeyDraft("");
                        setWorkspaceDraft("");
                    }}
                >
                    Change key
                </button>
            </div>
            <Separator className="shrink-0 bg-border/60" />

            <div
                ref={transcriptRef}
                className="min-h-0 flex-1 space-y-2.5 overflow-y-auto py-2 pr-1"
            >
                {entries.length === 0 ? (
                    <p className="text-muted-foreground">
                        Ask for something — “which label is the tail?”, “name the parts of this
                        rig”, “make the tail sway”. It proposes; nothing changes until you apply it.
                    </p>
                ) : null}

                {entries.map((entry, index) => {
                    if (entry.kind === "you") {
                        return (
                            <p
                                key={index}
                                className="ml-4 rounded-lg rounded-tr-sm bg-[#e87d0d]/12 px-2.5 py-1.5 text-foreground"
                            >
                                {entry.text}
                            </p>
                        );
                    }
                    if (entry.kind === "stopped") {
                        return (
                            <p key={index} className="text-[11px] italic text-muted-foreground/60">
                                Stopped.
                            </p>
                        );
                    }
                    if (entry.kind === "problem") {
                        return (
                            <p
                                key={index}
                                className="flex gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive"
                            >
                                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                {entry.text}
                            </p>
                        );
                    }
                    return (
                        <div
                            key={index}
                            className="mr-4 space-y-1.5 rounded-lg rounded-tl-sm border border-border/60 bg-muted/30 px-2.5 py-1.5"
                        >
                            {entry.text ? (
                                <p className="whitespace-pre-wrap text-foreground">{entry.text}</p>
                            ) : null}
                            <Badge
                                variant="outline"
                                className="gap-1 border-border/60 px-1.5 py-0 font-mono text-[10px] font-normal text-muted-foreground/60"
                            >
                                {tokens(
                                    entry.usage.input +
                                        entry.usage.cacheRead +
                                        entry.usage.cacheWrite,
                                )}{" "}
                                in · {tokens(entry.usage.output)} out ·{" "}
                                {dollars(turnCost(entry.model, entry.usage))}
                                {entry.usage.cacheRead > 0
                                    ? ` · ${tokens(entry.usage.cacheRead)} cached`
                                    : ""}
                            </Badge>
                            {entry.plan.length > 0 ? (
                                <div className="rounded-md border border-border/60 bg-background p-2">
                                    <div className="mb-1.5 flex items-center justify-between">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                                            {entry.applied ? "Applied" : "Proposed"}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className="border-border/60 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                                        >
                                            {entry.plan.length}{" "}
                                            {entry.plan.length === 1 ? "change" : "changes"}
                                        </Badge>
                                    </div>
                                    <ul className="space-y-1">
                                        {entry.plan.map((action) => (
                                            <li
                                                key={action.id}
                                                className={cn(
                                                    "flex gap-1.5",
                                                    action.problem
                                                        ? "text-destructive"
                                                        : "text-foreground",
                                                )}
                                            >
                                                <span className="mt-0.5 shrink-0">
                                                    {entry.applied ? (
                                                        action.problem ? (
                                                            <AlertTriangle className="size-3" />
                                                        ) : (
                                                            <Check className="size-3 text-[#e87d0d]" />
                                                        )
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            ·
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    {action.summary}
                                                    {action.problem ? (
                                                        <span className="block text-[10px]">
                                                            {action.problem}
                                                        </span>
                                                    ) : action.note ? (
                                                        <span className="block text-[10px] text-muted-foreground">
                                                            {action.note}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    {!entry.applied ? (
                                        <Button
                                            size="sm"
                                            className={cn("mt-2 h-7 w-full", brandButtonClass)}
                                            onClick={() =>
                                                apply(
                                                    index,
                                                    entry as Extract<
                                                        AiEntry,
                                                        { kind: "assistant" }
                                                    >,
                                                )
                                            }
                                        >
                                            Apply {entry.plan.length}{" "}
                                            {entry.plan.length === 1 ? "change" : "changes"}
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}

                {busy ? (
                    <div className="mr-4 flex items-center gap-1.5 rounded-lg rounded-tl-sm border border-border/60 bg-muted/30 px-2.5 py-1.5 text-muted-foreground">
                        <Loader2 className="size-3 shrink-0 animate-spin text-[#e87d0d]" />
                        Thinking…
                    </div>
                ) : null}
            </div>

            <div className="mt-1.5 flex shrink-0 flex-col gap-1.5 rounded-xl border border-input bg-background p-2 transition-colors focus-within:border-[#e87d0d]/70 focus-within:ring-1 focus-within:ring-[#e87d0d]/40">
                <textarea
                    rows={2}
                    value={prompt}
                    placeholder="Make the tail sway…"
                    aria-label="Ask the assistant"
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter sends; Shift+Enter is a newline, as everywhere else.
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                    className="min-w-0 resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60"
                />
                <div className="flex items-center gap-1.5">
                    <ModelPicker
                        model={model}
                        onChange={setModel}
                        className="h-6 min-w-0 flex-1 rounded-full border-border/60 bg-transparent px-2.5 text-[10px]"
                    />
                    {busy ? (
                        <Button
                            size="icon"
                            className={cn("size-6 shrink-0 rounded-full", brandButtonClass)}
                            onClick={stop}
                            aria-label="Stop"
                        >
                            <Square className="size-2.5 fill-current" />
                        </Button>
                    ) : (
                        <Button
                            size="icon"
                            className={cn("size-6 shrink-0 rounded-full", brandButtonClass)}
                            disabled={prompt.trim() === ""}
                            onClick={() => void send()}
                            aria-label="Send"
                        >
                            <Send className="size-3" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
