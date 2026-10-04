"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    type AiModelId,
    type AiTurn,
    NO_USAGE,
    type TokenUsage,
    addUsage,
    askAssistant,
    continueAfterTools,
    explainApiError,
    loadApiKey,
    loadModel,
    loadWorkspaceId,
    saveApiKey,
    saveModel,
    saveWorkspaceId,
    subscribeCredentials,
    toolResults,
    turnCost,
} from "./ai/client";
import type { SceneFacts } from "./ai/context";
import { type AiActions, type PlannedAction, runAction } from "./ai/tools";

export type AiEntry =
    | { kind: "you"; text: string }
    | {
          kind: "assistant";
          text: string;
          plan: PlannedAction[];
          applied: boolean;
          usage: TokenUsage;
          model: AiModelId;
      }
    | { kind: "problem"; text: string }
    | { kind: "stopped" };

/**
 * The assistant's conversation and in-flight request, kept outside the panel that displays it.
 *
 * Call this from a component that stays mounted for as long as the editor is open — not from the
 * panel itself. The panel is only shown while its sidebar tab is active and unmounts the moment
 * you switch away; a request `await`ing a response would still finish, but with nowhere to put
 * the answer. Lifting the state here means switching tabs mid-request just hides the panel — the
 * request keeps going, and the reply is sitting there when you switch back.
 */
export function useAiAssistant({
    scene,
    captureView,
    actions,
    onApplied,
}: {
    /** The scene as it stands, read fresh for each request. */
    scene: () => SceneFacts | null;
    /** A snapshot of the current 3D view, sent alongside the scene facts on every turn. */
    captureView: () => { mediaType: "image/png"; base64: string } | null;
    actions: AiActions;
    /** Called after a plan runs, so the editor can record one history entry for the lot. */
    onApplied: (prompt: string, count: number) => void;
}) {
    const [apiKey, setApiKey] = useState(loadApiKey);
    const [workspaceId, setWorkspaceId] = useState(loadWorkspaceId);
    const [model, setModelState] = useState<AiModelId>(loadModel);
    /** Remembered, so the choice survives a reload rather than resetting to the dearest one. */
    const setModel = useCallback((next: AiModelId) => {
        saveModel(next);
        setModelState(next);
    }, []);
    const [prompt, setPrompt] = useState("");
    const [entries, setEntries] = useState<AiEntry[]>([]);
    /** Everything this session has cost, so it doesn't creep up unnoticed. */
    const [sessionUsage, setSessionUsage] = useState<TokenUsage>(NO_USAGE);
    const [sessionCost, setSessionCost] = useState(0);
    const [busy, setBusy] = useState(false);
    /** The running conversation, so follow-ups have something to refer back to. */
    const conversation = useRef<Anthropic.MessageParam[]>([]);
    const lastPrompt = useRef("");
    /** Set while a request is in flight, so the Stop button has something to cut short. */
    const abortRef = useRef<AbortController | null>(null);

    // Kept in sync with the settings modal, which edits the same stored credentials.
    useEffect(
        () =>
            subscribeCredentials(() => {
                setApiKey(loadApiKey());
                setWorkspaceId(loadWorkspaceId());
                setModelState(loadModel());
            }),
        [],
    );

    const saveKey = useCallback((key: string, workspace: string) => {
        saveApiKey(key);
        saveWorkspaceId(workspace);
        setApiKey(key);
        setWorkspaceId(workspace);
    }, []);

    const clearKey = useCallback(() => {
        saveApiKey("");
        saveWorkspaceId("");
        setApiKey("");
        setWorkspaceId("");
    }, []);

    /**
     * Runs a request built against an abort signal, and records whatever comes back — a reply, a
     * stop, or an error. Shared by `send` (a human-typed prompt) and the follow-up `apply` fires
     * on its own after a plan whose results leave something worth finishing unprompted.
     */
    const runAndRecord = useCallback(
        async (
            build: (
                signal: AbortSignal,
            ) => Promise<{ turn: AiTurn; messages: Anthropic.MessageParam[] }>,
        ) => {
            setBusy(true);
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                const { turn, messages } = await build(controller.signal);
                conversation.current = messages;
                setEntries((current) => [
                    ...current,
                    {
                        kind: "assistant",
                        text: turn.text,
                        plan: turn.plan,
                        applied: false,
                        usage: turn.usage,
                        model: turn.model,
                    },
                ]);
                setSessionUsage((current) => addUsage(current, turn.usage));
                // Priced per turn rather than at the end: the model can change between turns, and
                // a running total added up at one rate would be wrong the moment it does.
                setSessionCost((current) => current + turnCost(turn.model, turn.usage));
            } catch (err) {
                if (err instanceof APIUserAbortError) {
                    setEntries((current) => [...current, { kind: "stopped" }]);
                } else {
                    setEntries((current) => [
                        ...current,
                        { kind: "problem", text: explainApiError(err) },
                    ]);
                }
            } finally {
                abortRef.current = null;
                setBusy(false);
            }
        },
        [],
    );

    const send = useCallback(() => {
        const facts = scene();
        const text = prompt.trim();
        if (!facts || text === "" || busy) return;

        setEntries((current) => [...current, { kind: "you", text }]);
        setPrompt("");
        lastPrompt.current = text;
        void runAndRecord((signal) =>
            askAssistant({
                apiKey,
                workspaceId,
                model,
                scene: facts,
                screenshot: captureView(),
                prompt: text,
                history: conversation.current,
                signal,
            }),
        );
    }, [apiKey, busy, captureView, model, prompt, runAndRecord, scene, workspaceId]);

    /** Cuts the in-flight request short. A no-op once it's already finished. */
    const stop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const apply = useCallback(
        (entryIndex: number, turn: Extract<AiEntry, { kind: "assistant" }>) => {
            const problems = new Map<string, string>();
            const notes = new Map<string, string>();
            for (const action of turn.plan) {
                const result = runAction(actions, action);
                if (typeof result === "string") problems.set(action.id, result);
                else if (result) notes.set(action.id, result.note);
            }

            setEntries((current) =>
                current.map((entry, i) =>
                    i === entryIndex && entry.kind === "assistant"
                        ? {
                              ...entry,
                              applied: true,
                              plan: entry.plan.map((action) => ({
                                  ...action,
                                  problem: problems.get(action.id),
                                  note: notes.get(action.id),
                              })),
                          }
                        : entry,
                ),
            );

            // Told what happened, so "that's too fast, halve it" has something to work from — and
            // so ids `split_label` invented (which it has no way to predict) reach the next turn.
            conversation.current = [
                ...conversation.current,
                toolResults(turn.plan, problems, notes),
            ];
            onApplied(lastPrompt.current, turn.plan.length - problems.size);

            // A note means something was left in a state worth following up on unprompted — new
            // label ids nobody has named, today. Rather than waiting for a human to notice and
            // ask, continue straight on from the tool results just sent.
            if (notes.size > 0) {
                const facts = scene();
                if (facts) {
                    void runAndRecord((signal) =>
                        continueAfterTools({
                            apiKey,
                            workspaceId,
                            model,
                            scene: facts,
                            screenshot: captureView(),
                            nudge: "Follow up on what the tool results above just told you — most importantly, name any newly created label ids right away rather than waiting to be asked.",
                            history: conversation.current,
                            signal,
                        }),
                    );
                }
            }
        },
        [actions, apiKey, captureView, model, onApplied, runAndRecord, scene, workspaceId],
    );

    return {
        apiKey,
        workspaceId,
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
    };
}

export type AiAssistant = ReturnType<typeof useAiAssistant>;
