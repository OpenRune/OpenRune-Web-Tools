"use client";

import { Key } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import {
    AI_MODELS,
    type AiModelId,
    loadApiKey,
    loadModel,
    loadWorkspaceId,
    saveApiKey,
    saveModel,
    saveWorkspaceId,
    subscribeCredentials,
} from "./ai/client";

/**
 * The assistant's key, workspace and model, editable from the gear as well as the panel itself.
 *
 * Both surfaces read and write the same storage, so `subscribeCredentials` keeps this tab in sync
 * if the key is changed from the assistant panel while the modal is open, and vice versa.
 */
export function AssistantSettings(): JSX.Element {
    const [apiKey, setApiKey] = useState(loadApiKey);
    const [workspaceId, setWorkspaceId] = useState(loadWorkspaceId);
    const [model, setModel] = useState<AiModelId>(loadModel);
    const [keyDraft, setKeyDraft] = useState(loadApiKey);
    const [workspaceDraft, setWorkspaceDraft] = useState(loadWorkspaceId);

    useEffect(
        () =>
            subscribeCredentials(() => {
                setApiKey(loadApiKey());
                setWorkspaceId(loadWorkspaceId());
                setModel(loadModel());
                setKeyDraft(loadApiKey());
                setWorkspaceDraft(loadWorkspaceId());
            }),
        [],
    );

    const dirty = keyDraft.trim() !== apiKey || workspaceDraft.trim() !== workspaceId;

    return (
        <div className="space-y-3 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
                <Key className="size-3.5 shrink-0" />
                <span className="font-semibold uppercase tracking-wide">Bring your own key</span>
            </div>
            <p className="text-muted-foreground">
                Paste an Anthropic API key, or a CometAPI key (starting <code>sk-</code> without{" "}
                <code>-ant-</code>) if that&apos;s what you use instead. It&apos;s kept in this
                browser and sent straight to whichever service issued it — the editor has no server
                to hold it on your behalf.
            </p>
            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">API key</label>
                <input
                    type="password"
                    value={keyDraft}
                    placeholder="sk-ant-… or a CometAPI key"
                    aria-label="Anthropic or CometAPI key"
                    onChange={(e) => setKeyDraft(e.target.value)}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2 font-mono text-xs outline-none focus:border-[#e87d0d]/70"
                />
            </div>
            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                    Workspace id
                </label>
                <input
                    type="text"
                    value={workspaceDraft}
                    placeholder="wrkspc_… (only if the key isn't scoped to one)"
                    aria-label="Anthropic workspace id"
                    onChange={(e) => setWorkspaceDraft(e.target.value)}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2 font-mono text-xs outline-none focus:border-[#e87d0d]/70"
                />
            </div>
            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Model</label>
                <select
                    value={model}
                    aria-label="Assistant model"
                    onChange={(e) => {
                        const next = e.target.value as AiModelId;
                        setModel(next);
                        saveModel(next);
                    }}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus:border-[#e87d0d]/70"
                >
                    {AI_MODELS.map((option) => (
                        <option key={option.id} value={option.id}>
                            {option.label} · ${option.inputPrice} / ${option.outputPrice} per Mtok
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex gap-2">
                <Button
                    size="sm"
                    className="h-7 flex-1"
                    disabled={!dirty || keyDraft.trim() === ""}
                    onClick={() => {
                        saveApiKey(keyDraft.trim());
                        saveWorkspaceId(workspaceDraft.trim());
                    }}
                >
                    Save key
                </Button>
                {apiKey ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                            saveApiKey("");
                            saveWorkspaceId("");
                            setKeyDraft("");
                            setWorkspaceDraft("");
                        }}
                    >
                        Clear
                    </Button>
                ) : null}
            </div>
            <p className="text-muted-foreground/70">
                Requests are billed to your own account&apos;s API credit — a Claude Pro or Max
                subscription doesn&apos;t cover this. Anthropic keys and credit live at
                console.anthropic.com; CometAPI keys and balance live at cometapi.com.
            </p>
        </div>
    );
}
