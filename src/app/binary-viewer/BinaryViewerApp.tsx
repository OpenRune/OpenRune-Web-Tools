"use client";

import { IndexType } from "@openrune/cache";
import { type BinaryKind, RSBinary } from "@openrune/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCache } from "../../context/cache-context";
import { cn } from "../../util/cn";

/**
 * The binary viewer: browse the grab-bag index and see what each archive holds.
 *
 * Sniffing and rendering live in `@openrune/react`'s `<RSBinary>` — this page is the archive
 * list around it.
 */
export default function BinaryViewerApp(): JSX.Element {
    const [archiveId, setArchiveId] = useState("");
    /** The archive actually being shown, once one is picked. */
    const [shownId, setShownId] = useState<number | null>(null);
    const [shownKind, setShownKind] = useState<{ kind: BinaryKind; length: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // One cache for the whole app, so opening it here opens it in the other viewers too.
    const {
        cache,
        state: cacheState,
        generation,
        loadFiles,
        dirPickerSupported,
        needsPermission,
        openFolder,
        reopenRemembered,
    } = useCache();

    /** What this viewer needs from whichever cache is open. */
    const binaryIndex = useMemo(() => {
        if (!cache) return { archiveIds: [] as number[], missing: false };
        const missing = !cache.indexExists(IndexType.DAT2.binary);
        return {
            archiveIds: missing
                ? []
                : Array.from(cache.getIndex(IndexType.DAT2.binary).getArchiveIds()),
            missing,
        };
    }, [cache]);

    // A different cache means whatever was on screen belongs to another server.
    useEffect(() => {
        setShownId(null);
        setShownKind(null);
        setError(null);
    }, [generation]);

    const onCacheFilesChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            await loadFiles(files);
        },
        [loadFiles],
    );

    const loadArchive = useCallback((id: number) => {
        if (Number.isNaN(id)) return;
        setError(null);
        setShownKind(null);
        setShownId(id);
    }, []);

    const handleLoadTyped = useCallback(() => {
        loadArchive(Number.parseInt(archiveId, 10));
    }, [archiveId, loadArchive]);

    return (
        <div className="flex w-full flex-col gap-4">
            <section className="space-y-3">
                <h2 className="text-sm font-semibold">Binary archives (dat2 "binary" index)</h2>
                <p className="text-xs text-muted-foreground">
                    Miscellaneous files that aren't sprites or models — e.g. the login screen
                    JPEG/PNG backgrounds and the huffman chat-compression table.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    {dirPickerSupported ? (
                        <Button size="sm" variant="outline" onClick={() => void openFolder()}>
                            Open cache folder
                        </Button>
                    ) : (
                        <Button asChild size="sm" variant="outline">
                            <label>
                                Open cache (idx + dat2)
                                <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={onCacheFilesChange}
                                />
                            </label>
                        </Button>
                    )}
                    {needsPermission ? (
                        <Button size="sm" variant="ghost" onClick={() => void reopenRemembered()}>
                            Reopen last cache folder
                        </Button>
                    ) : null}
                    {cacheState.status === "ready" ? (
                        <>
                            <Input
                                type="number"
                                value={archiveId}
                                onChange={(e) => setArchiveId(e.target.value)}
                                placeholder="Archive id"
                                className="h-8 w-28"
                            />
                            <Button size="sm" variant="secondary" onClick={handleLoadTyped}>
                                Load
                            </Button>
                        </>
                    ) : null}
                </div>

                {cacheState.status === "error" ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Cache: {cacheState.message}
                    </div>
                ) : null}
                {cacheState.status === "ready" && binaryIndex.missing ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
                        Loaded {cacheState.fileCount} files, but main_file_cache.idx10 (the binary
                        index) wasn't among them — re-select all main_file_cache.* files, including
                        idx10.
                    </div>
                ) : null}

                {cacheState.status === "ready" && binaryIndex.archiveIds.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {binaryIndex.archiveIds.map((id) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => loadArchive(id)}
                                className={cn(
                                    "rounded-md border border-border px-2 py-1 text-xs hover:bg-accent",
                                    shownId === id && "border-primary bg-primary/15",
                                )}
                            >
                                {id}
                            </button>
                        ))}
                    </div>
                ) : null}
            </section>

            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            {shownId !== null ? (
                <section className="space-y-2 rounded-lg border border-border p-3">
                    {shownKind ? (
                        <p className="text-xs text-muted-foreground">
                            archive {shownId} —{" "}
                            {shownKind.kind === "unknown"
                                ? `unrecognized binary (${shownKind.length} bytes)`
                                : shownKind.kind.toUpperCase()}
                        </p>
                    ) : null}
                    <RSBinary
                        id={shownId}
                        cache={cache ?? undefined}
                        className="max-w-full rounded border border-border"
                        onReady={(info) => setShownKind({ kind: info.kind, length: info.length })}
                        onError={(err) => setError(err.message)}
                        renderUnknown={({ hex, length }) => (
                            <p className="break-all font-mono text-xs text-muted-foreground">
                                {hex}
                                {length > 64 ? " …" : ""}
                            </p>
                        )}
                    />
                </section>
            ) : null}
        </div>
    );
}
