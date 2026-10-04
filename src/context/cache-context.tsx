"use client";

import { CacheFiles, CacheSystem } from "@openrune/cache";
import { GameValStore } from "@openrune/gameval";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { type CacheFileEntry, useCacheDirectory } from "../hooks/useCacheDirectory";
import {
    type DevCache,
    fetchDevCacheEntries,
    isTauriRuntime,
    probeDevCache,
    readCacheEntriesFromPath,
} from "../util/cache-directory";

export type SharedCacheState =
    | { status: "none" }
    | { status: "loading" }
    | { status: "ready"; fileCount: number; source: string }
    | { status: "error"; message: string };

type CacheValue = {
    /** The decoded cache, or null until one is opened. */
    cache: CacheSystem | null;
    /**
     * The same raw file bytes `cache` was decoded from — for consumers (like the vendored
     * rs-map-viewer-based map viewer) that need to build their own cache reader from scratch
     * rather than go through `cache`'s decoded `CacheSystem`.
     */
    rawEntries: CacheFileEntry[] | null;
    /**
     * Names for this cache's ids — sequences, items, npcs and the rest. Null until a cache is
     * open; on a cache without a gameval index every lookup simply comes back empty.
     */
    gameVals: GameValStore | null;
    state: SharedCacheState;
    /** Bumped whenever a different cache is loaded, so views can reset what they derived. */
    generation: number;
    loadEntries: (entries: CacheFileEntry[], source: string) => void;
    /** For `<input type="file" multiple>` fallbacks where the picker isn't available. */
    loadFiles: (files: File[]) => Promise<void>;
    dirPickerSupported: boolean;
    needsPermission: boolean;
    openFolder: () => Promise<void>;
    reopenRemembered: () => Promise<void>;
    /** The folder the dev server is serving, if any (see `OPENRUNE_DEV_CACHE_DIR`). */
    devCache: DevCache | null;
    loadDevCache: (dev?: DevCache) => Promise<void>;
    /**
     * Loads a cache directly from an absolute path — only possible in the desktop app, where the
     * fs plugin can read a remembered path without a browser directory handle or re-grant prompt.
     */
    loadFromPath: (path: string) => Promise<void>;
};

const CacheContext = createContext<CacheValue | null>(null);

/**
 * Holds the one cache the whole app works on. Opening it in any viewer opens it everywhere —
 * they're all looking at the same server's files, and re-picking the folder in each tool was
 * busywork. The directory handle is also restored once here rather than in four places.
 */
export function CacheProvider({ children }: { children: React.ReactNode }): JSX.Element {
    const [cache, setCache] = useState<CacheSystem | null>(null);
    const [rawEntries, setRawEntries] = useState<CacheFileEntry[] | null>(null);
    const [state, setState] = useState<SharedCacheState>({ status: "none" });
    const [generation, setGeneration] = useState(0);
    const [devCache, setDevCache] = useState<DevCache | null>(null);

    const loadEntries = useCallback((entries: CacheFileEntry[], source: string) => {
        if (entries.length === 0) return;
        setState({ status: "loading" });
        try {
            const next = CacheSystem.fromFiles("dat2", new CacheFiles(new Map(entries)));
            setCache(next);
            setRawEntries(entries);
            setGeneration((n) => n + 1);
            setState({ status: "ready", fileCount: entries.length, source });
        } catch (err) {
            setCache(null);
            setRawEntries(null);
            setGeneration((n) => n + 1);
            setState({
                status: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }, []);

    const loadFiles = useCallback(
        async (files: File[]) => {
            if (files.length === 0) return;
            const entries = await Promise.all(
                files.map(async (file) => [file.name, await file.arrayBuffer()] as const),
            );
            loadEntries(entries, "Selected files");
        },
        [loadEntries],
    );

    const onDirectoryEntries = useCallback(
        (entries: CacheFileEntry[]) => loadEntries(entries, "Cache folder"),
        [loadEntries],
    );

    const {
        supported: dirPickerSupported,
        needsPermission,
        openFolder,
        reopenRemembered,
    } = useCacheDirectory(onDirectoryEntries);

    const loadFromPath = useCallback(
        async (path: string) => {
            if (!path || !isTauriRuntime()) return;
            setState({ status: "loading" });
            try {
                const entries = await readCacheEntriesFromPath(path);
                if (entries.length === 0) {
                    setState({ status: "error", message: `No main_file_cache.* files in ${path}` });
                    return;
                }
                loadEntries(entries, path);
            } catch (err) {
                setState({
                    status: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [loadEntries],
    );

    const loadDevCache = useCallback(
        async (dev?: DevCache) => {
            const target = dev ?? devCache;
            if (!target) return;
            setState({ status: "loading" });
            try {
                loadEntries(await fetchDevCacheEntries(target.files), target.dir);
            } catch (err) {
                setState({
                    status: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [devCache, loadEntries],
    );

    // Dev convenience: if the server is serving a cache folder, open it on first load so there's
    // something to look at without clicking through a picker. A folder the user picks by hand
    // still wins, because this only runs while nothing is loaded.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const found = await probeDevCache();
            if (cancelled || !found) return;
            setDevCache(found);
            setState((current) => {
                if (current.status !== "none") return current;
                void (async () => {
                    try {
                        const entries = await fetchDevCacheEntries(found.files);
                        if (!cancelled) loadEntries(entries, found.dir);
                    } catch {
                        // Leave the app in "no cache" rather than erroring on a convenience path.
                    }
                })();
                return { status: "loading" };
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [loadEntries]);

    // One store per cache, built the moment the cache is: the groups inside it are read on first
    // use, so this costs nothing until something actually asks for a name.
    const gameVals = useMemo(() => (cache ? new GameValStore(cache) : null), [cache]);

    const value = useMemo(
        () => ({
            cache,
            rawEntries,
            gameVals,
            state,
            generation,
            loadEntries,
            loadFiles,
            dirPickerSupported,
            needsPermission,
            openFolder,
            reopenRemembered,
            devCache,
            loadDevCache,
            loadFromPath,
        }),
        [
            cache,
            rawEntries,
            gameVals,
            state,
            generation,
            loadEntries,
            loadFiles,
            dirPickerSupported,
            needsPermission,
            openFolder,
            reopenRemembered,
            devCache,
            loadDevCache,
            loadFromPath,
        ],
    );

    return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>;
}

export function useCache(): CacheValue {
    const value = useContext(CacheContext);
    if (!value) throw new Error("useCache must be used inside a CacheProvider");
    return value;
}
