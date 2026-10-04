"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * A saved project: which server's cache you're working on, plus everything the editors have
 * learned about it that the cache itself can't hold — label names, for instance, which live in
 * the editor rather than in the model files.
 */
export type CacheWorkspace = {
    id: string;
    /** The server this cache belongs to. */
    name: string;
    /** A data URL, downscaled on import so a full-size logo can be picked without bloating storage. */
    icon: string | null;
    /** Cache revision, free-form: people label these "742", "OSRS 221", "custom 1.4". */
    revision: string;
    /** Where the cache lives on disk. Opening it still goes through the folder picker. */
    cachePath: string;
    /** Per-model label names: `labelNames[modelId][labelId] = name`. */
    labelNames: Record<string, Record<string, string>>;
    createdAt: string;
    updatedAt: string;
};

export type WorkspaceDraft = Pick<CacheWorkspace, "name" | "icon" | "revision" | "cachePath">;

type WorkspacesValue = {
    workspaces: CacheWorkspace[];
    active: CacheWorkspace | null;
    create: (draft: WorkspaceDraft) => CacheWorkspace;
    update: (id: string, patch: Partial<WorkspaceDraft>) => void;
    remove: (id: string) => void;
    setActive: (id: string | null) => void;
    /** Names given to a model's labels in the active workspace, keyed by label id. */
    labelNamesFor: (modelId: number) => Map<number, string>;
    /** Stores a model's label names; an empty map clears them. */
    saveLabelNames: (modelId: number, names: Map<number, string>) => void;
};

const STORAGE_KEY = "openrune.workspaces";
const ACTIVE_KEY = "openrune.workspaces.active";

const WorkspacesContext = createContext<WorkspacesValue | null>(null);

function loadWorkspaces(): CacheWorkspace[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Anything that isn't shaped like a workspace is dropped rather than crashing the app.
        return parsed.filter(
            (w): w is CacheWorkspace =>
                typeof w === "object" && w !== null && typeof (w as CacheWorkspace).id === "string",
        );
    } catch {
        return [];
    }
}

function persist(workspaces: CacheWorkspace[]): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
    } catch {
        // Storage can be unavailable (private mode, quota); the session still works in memory.
    }
}

export function WorkspacesProvider({ children }: { children: React.ReactNode }): JSX.Element {
    // Empty on the server and on the first client render, so the two agree; the effect below
    // fills in what localStorage has.
    const [workspaces, setWorkspaces] = useState<CacheWorkspace[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        const loaded = loadWorkspaces();
        setWorkspaces(loaded);
        const saved = window.localStorage.getItem(ACTIVE_KEY);
        setActiveId(saved && loaded.some((w) => w.id === saved) ? saved : loaded[0]?.id ?? null);
    }, []);

    const write = useCallback((next: CacheWorkspace[]) => {
        setWorkspaces(next);
        persist(next);
    }, []);

    const setActive = useCallback((id: string | null) => {
        setActiveId(id);
        try {
            if (id) window.localStorage.setItem(ACTIVE_KEY, id);
            else window.localStorage.removeItem(ACTIVE_KEY);
        } catch {
            // Same as above: not being able to remember the choice isn't fatal.
        }
    }, []);

    const create = useCallback(
        (draft: WorkspaceDraft): CacheWorkspace => {
            const now = new Date().toISOString();
            const workspace: CacheWorkspace = {
                id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                name: draft.name.trim() || "Untitled",
                icon: draft.icon,
                revision: draft.revision.trim(),
                cachePath: draft.cachePath.trim(),
                labelNames: {},
                createdAt: now,
                updatedAt: now,
            };
            setWorkspaces((prev) => {
                const next = [...prev, workspace];
                persist(next);
                return next;
            });
            setActive(workspace.id);
            return workspace;
        },
        [setActive],
    );

    const update = useCallback((id: string, patch: Partial<WorkspaceDraft>) => {
        setWorkspaces((prev) => {
            const next = prev.map((w) =>
                w.id === id
                    ? {
                          ...w,
                          ...patch,
                          // Same trimming the create path applies, so an edit can't leave a
                          // workspace named " " or a path with a stray space on the end.
                          name: patch.name === undefined ? w.name : patch.name.trim() || w.name,
                          revision:
                              patch.revision === undefined ? w.revision : patch.revision.trim(),
                          cachePath:
                              patch.cachePath === undefined ? w.cachePath : patch.cachePath.trim(),
                          updatedAt: new Date().toISOString(),
                      }
                    : w,
            );
            persist(next);
            return next;
        });
    }, []);

    const remove = useCallback((id: string) => {
        setWorkspaces((prev) => {
            const next = prev.filter((w) => w.id !== id);
            persist(next);
            setActiveId((current) => {
                if (current !== id) return current;
                const fallback = next[0]?.id ?? null;
                try {
                    if (fallback) window.localStorage.setItem(ACTIVE_KEY, fallback);
                    else window.localStorage.removeItem(ACTIVE_KEY);
                } catch {
                    // Non-fatal.
                }
                return fallback;
            });
            return next;
        });
    }, []);

    const active = useMemo(
        () => workspaces.find((w) => w.id === activeId) ?? null,
        [workspaces, activeId],
    );

    const labelNamesFor = useCallback(
        (modelId: number): Map<number, string> => {
            const saved = active?.labelNames?.[String(modelId)];
            if (!saved) return new Map();
            return new Map(Object.entries(saved).map(([label, name]) => [Number(label), name]));
        },
        [active],
    );

    const saveLabelNames = useCallback(
        (modelId: number, names: Map<number, string>) => {
            if (!activeId) return;
            setWorkspaces((prev) => {
                const next = prev.map((w) => {
                    if (w.id !== activeId) return w;
                    const labelNames = { ...w.labelNames };
                    if (names.size === 0) delete labelNames[String(modelId)];
                    else labelNames[String(modelId)] = Object.fromEntries(names);
                    return { ...w, labelNames, updatedAt: new Date().toISOString() };
                });
                persist(next);
                return next;
            });
        },
        [activeId],
    );

    const value = useMemo(
        () => ({
            workspaces,
            active,
            create,
            update,
            remove,
            setActive,
            labelNamesFor,
            saveLabelNames,
        }),
        [workspaces, active, create, update, remove, setActive, labelNamesFor, saveLabelNames],
    );

    return <WorkspacesContext.Provider value={value}>{children}</WorkspacesContext.Provider>;
}

export function useWorkspaces(): WorkspacesValue {
    const value = useContext(WorkspacesContext);
    if (!value) throw new Error("useWorkspaces must be used inside a WorkspacesProvider");
    return value;
}
