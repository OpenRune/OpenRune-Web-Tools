"use client";

import { Check, FolderOpen, Image as ImageIcon, Pencil, Plus, Trash2, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import {
    type CacheWorkspace,
    type WorkspaceDraft,
    useWorkspaces,
} from "../context/workspaces-context";
import { isTauriRuntime } from "../util/cache-directory";
import { cn } from "../util/cn";
import { Hint } from "./ui/hint";

/** Largest file accepted for an icon; it's downscaled from there, so this is generous. */
const MAX_ICON_BYTES = 8 * 1024 * 1024;

/** Icons live inside the workspace record, so they're resized to something storable. */
const ICON_SIZE = 256;

/**
 * Reads an image file into a small square data URL. Downscaling on import is what lets you pick
 * a full-size logo: the original never reaches storage, only a 256px copy.
 */
async function readIcon(file: File): Promise<string> {
    const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read that file"));
        reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("That file isn't an image this browser can read"));
        img.src = source;
    });

    // Already small enough, and not worth re-encoding (it would lose an SVG's crispness).
    if (image.width <= ICON_SIZE && image.height <= ICON_SIZE && source.length < 64 * 1024)
        return source;

    const scale = Math.min(ICON_SIZE / image.width, ICON_SIZE / image.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency, which server logos usually have.
    return canvas.toDataURL("image/png");
}

/** The create/edit form. The same fields either way, so they only exist in one place. */
function WorkspaceForm({
    initial,
    submitLabel,
    onSubmit,
    onCancel,
}: {
    initial?: CacheWorkspace;
    submitLabel: string;
    onSubmit: (draft: WorkspaceDraft) => void;
    onCancel?: () => void;
}): JSX.Element {
    const [name, setName] = useState(initial?.name ?? "");
    const [revision, setRevision] = useState(initial?.revision ?? "");
    const [cachePath, setCachePath] = useState(initial?.cachePath ?? "");
    const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
    const [error, setError] = useState<string | null>(null);

    const onBrowseCachePath = async (): Promise<void> => {
        if (!isTauriRuntime()) return;
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, title: "Select cache folder" });
        if (typeof picked === "string") setCachePath(picked);
    };

    const onPickIcon = async (file: File | undefined): Promise<void> => {
        if (!file) return;
        if (file.size > MAX_ICON_BYTES) {
            setError("That image is over 8 MB — pick something smaller.");
            return;
        }
        try {
            setIcon(await readIcon(file));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't read that image");
        }
    };

    return (
        <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-2">
            <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Server name"
                aria-label="Server name"
                className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
            />
            <input
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="Revision (e.g. 742)"
                aria-label="Revision"
                className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
            />
            <div className="flex items-center gap-1.5">
                {isTauriRuntime() ? (
                    <button
                        type="button"
                        aria-label="Browse for cache folder"
                        onClick={() => void onBrowseCachePath()}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <FolderOpen className="size-4" />
                    </button>
                ) : (
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                )}
                <input
                    value={cachePath}
                    onChange={(e) => setCachePath(e.target.value)}
                    placeholder="Cache path"
                    aria-label="Cache path"
                    className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
                />
            </div>
            <div className="flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    {icon ? (
                        // Plain <img>: the source is a data URL the user picked, not a routed asset.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={icon} alt="" className="size-8 rounded object-cover" />
                    ) : (
                        <span className="flex size-8 items-center justify-center rounded bg-muted">
                            <ImageIcon className="size-4" />
                        </span>
                    )}
                    {icon ? "Change icon" : "Choose an icon"}
                    <input
                        type="file"
                        accept="image/*"
                        aria-label="Workspace icon"
                        className="hidden"
                        onChange={(e) => void onPickIcon(e.target.files?.[0])}
                    />
                </label>
                {icon ? (
                    <button
                        type="button"
                        aria-label="Remove icon"
                        onClick={() => setIcon(null)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        Remove
                    </button>
                ) : null}
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => {
                        if (!name.trim()) {
                            setError("Give the workspace a name.");
                            return;
                        }
                        onSubmit({ name, icon, revision, cachePath });
                    }}
                    className="h-8 flex-1 rounded-md bg-primary text-xs font-medium text-primary-foreground"
                >
                    {submitLabel}
                </button>
                {onCancel ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-8 rounded-md border border-border px-3 text-xs"
                    >
                        Cancel
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function WorkspaceRow({
    workspace,
    active,
    onSelect,
    onEdit,
    onRemove,
}: {
    workspace: CacheWorkspace;
    active: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onRemove: () => void;
}): JSX.Element {
    const models = Object.keys(workspace.labelNames).length;
    return (
        <div
            data-testid="workspace-row"
            className={cn(
                "group flex items-center gap-2 rounded-md border p-2",
                active ? "border-primary bg-primary/10" : "border-border bg-background",
            )}
        >
            <button
                type="button"
                onClick={onSelect}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-label={`Use workspace ${workspace.name}`}
            >
                {workspace.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={workspace.icon}
                        alt=""
                        className="size-8 shrink-0 rounded object-cover"
                    />
                ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                        <ImageIcon className="size-4 text-muted-foreground" />
                    </span>
                )}
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{workspace.name}</span>
                        {workspace.revision ? (
                            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                                rev {workspace.revision}
                            </span>
                        ) : null}
                        {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                    </span>
                    <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={workspace.cachePath}
                    >
                        {workspace.cachePath || "No cache path set"}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                        {models === 0
                            ? "No saved labels"
                            : `Saved labels for ${models} model${models === 1 ? "" : "s"}`}
                    </span>
                </span>
            </button>
            <div className="flex shrink-0 flex-col gap-1">
                <Hint
                    side="left"
                    heading="Edit"
                    detail="Change this workspace's name, cache path, icon or revision"
                    label={`Edit workspace ${workspace.name}`}
                >
                    <button
                        type="button"
                        onClick={onEdit}
                        className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                    >
                        <Pencil className="size-4" />
                    </button>
                </Hint>
                <Hint
                    side="left"
                    heading="Delete"
                    detail="Removes the workspace. The cache folder itself is left alone."
                    label={`Delete workspace ${workspace.name}`}
                >
                    <button
                        type="button"
                        onClick={onRemove}
                        className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Hint>
            </div>
        </div>
    );
}

/** The flyout listing every saved workspace, with forms for adding and editing them. */
export function WorkspacePanel({ onClose }: { onClose: () => void }): JSX.Element {
    const { workspaces, active, create, update, remove, setActive } = useWorkspaces();
    const [creating, setCreating] = useState(workspaces.length === 0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === "Escape") onClose();
        };
        const onPointerDown = (event: PointerEvent): void => {
            if (!panelRef.current?.contains(event.target as Node)) onClose();
        };
        window.addEventListener("keydown", onKey);
        // Deferred: the click that opened the panel is still travelling up when this mounts.
        const id = window.setTimeout(
            () => window.addEventListener("pointerdown", onPointerDown),
            0,
        );
        return () => {
            window.clearTimeout(id);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pointerdown", onPointerDown);
        };
    }, [onClose]);

    return (
        <div
            ref={panelRef}
            data-testid="workspace-panel"
            // Bottom-aligned to the button it belongs to and flush against the sidebar's edge,
            // with the corners on that side left square, so it reads as an extension of the
            // button rather than a card floating nearby.
            className="absolute bottom-0 left-full z-[300] ml-2 flex max-h-[80vh] w-80 flex-col overflow-hidden rounded-l-none rounded-r-lg border border-l-0 border-border bg-card shadow-xl"
        >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <h2 className="flex-1 text-sm font-semibold">Workspaces</h2>
                <button
                    type="button"
                    aria-label="Close workspaces"
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {workspaces.length === 0 && !creating ? (
                    <p className="text-xs text-muted-foreground">
                        No workspaces yet. One holds a server&apos;s cache path, revision and icon,
                        plus the label names you give its models.
                    </p>
                ) : null}
                {workspaces.map((workspace) =>
                    editingId === workspace.id ? (
                        <WorkspaceForm
                            key={workspace.id}
                            initial={workspace}
                            submitLabel="Save changes"
                            onSubmit={(draft) => {
                                update(workspace.id, draft);
                                setEditingId(null);
                            }}
                            onCancel={() => setEditingId(null)}
                        />
                    ) : (
                        <WorkspaceRow
                            key={workspace.id}
                            workspace={workspace}
                            active={active?.id === workspace.id}
                            onSelect={() => setActive(workspace.id)}
                            onEdit={() => {
                                setEditingId(workspace.id);
                                setCreating(false);
                            }}
                            onRemove={() => remove(workspace.id)}
                        />
                    ),
                )}

                {creating ? (
                    <WorkspaceForm
                        submitLabel="Create workspace"
                        onSubmit={(draft) => {
                            create(draft);
                            setCreating(false);
                        }}
                        onCancel={workspaces.length > 0 ? () => setCreating(false) : undefined}
                    />
                ) : null}
            </div>

            {!creating ? (
                <div className="border-t border-border p-2">
                    <button
                        type="button"
                        onClick={() => {
                            setCreating(true);
                            setEditingId(null);
                        }}
                        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent"
                    >
                        <Plus className="size-4" /> New workspace
                    </button>
                </div>
            ) : null}
        </div>
    );
}
