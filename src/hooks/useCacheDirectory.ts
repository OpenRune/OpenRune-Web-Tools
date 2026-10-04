import { useCallback, useEffect, useRef, useState } from "react";

import {
    type CacheFileEntry,
    getSavedCacheDirectoryHandle,
    readCacheEntriesFromDirectory,
    saveCacheDirectoryHandle,
} from "../util/cache-directory";

export type { CacheFileEntry };

/**
 * Directory-picker based cache loading, so the user doesn't have to re-select every
 * `main_file_cache.*` file by hand each visit. Remembers the last picked folder (via the File
 * System Access API) and silently re-reads it on mount when the browser still has permission;
 * otherwise exposes `reopenRemembered` for a one-click re-grant, and `openFolder` to pick fresh.
 */
export function useCacheDirectory(onEntries: (entries: CacheFileEntry[]) => void | Promise<void>) {
    const [supported] = useState(
        () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function",
    );
    const [needsPermission, setNeedsPermission] = useState(false);
    const onEntriesRef = useRef(onEntries);
    onEntriesRef.current = onEntries;

    useEffect(() => {
        if (!supported) return;
        let cancelled = false;

        (async () => {
            const handle = await getSavedCacheDirectoryHandle().catch(() => null);
            if (!handle || cancelled) return;

            const permission = await handle.queryPermission({ mode: "read" });
            if (cancelled) return;
            if (permission !== "granted") {
                setNeedsPermission(true);
                return;
            }

            const entries = await readCacheEntriesFromDirectory(handle);
            if (!cancelled && entries.length > 0) await onEntriesRef.current(entries);
        })();

        return () => {
            cancelled = true;
        };
    }, [supported]);

    const openFolder = useCallback(async () => {
        if (!window.showDirectoryPicker) return;
        let handle: FileSystemDirectoryHandle;
        try {
            handle = await window.showDirectoryPicker({ mode: "read" });
        } catch {
            return; // User cancelled the picker.
        }
        // Persisting the handle is a nice-to-have for next time — never let a save failure
        // block actually loading the cache the user just picked.
        await saveCacheDirectoryHandle(handle).catch(() => {});
        setNeedsPermission(false);
        const entries = await readCacheEntriesFromDirectory(handle);
        await onEntriesRef.current(entries);
    }, []);

    const reopenRemembered = useCallback(async () => {
        const handle = await getSavedCacheDirectoryHandle();
        if (!handle) return;
        const permission = await handle.requestPermission({ mode: "read" });
        if (permission !== "granted") return;
        setNeedsPermission(false);
        const entries = await readCacheEntriesFromDirectory(handle);
        await onEntriesRef.current(entries);
    }, []);

    return { supported, needsPermission, openFolder, reopenRemembered };
}
