"use client";

import { useEffect, useRef } from "react";

import { useCache } from "../context/cache-context";
import { useWorkspaces } from "../context/workspaces-context";
import { isTauriRuntime } from "../util/cache-directory";

/**
 * Loads the active workspace's cache automatically, so picking a workspace — or creating one with
 * a cache path already filled in — is enough on its own; no separate folder picker step needed.
 * Desktop-only: a saved path can only be read directly (no browser directory handle) inside Tauri.
 */
export function WorkspaceCacheSync(): null {
    const { active } = useWorkspaces();
    const { loadFromPath } = useCache();
    const loadedPath = useRef<string | null>(null);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        const path = active?.cachePath || null;
        if (!path || path === loadedPath.current) return;
        loadedPath.current = path;
        void loadFromPath(path);
    }, [active, loadFromPath]);

    return null;
}
