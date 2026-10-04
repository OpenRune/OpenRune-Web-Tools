"use client";

import { IndexType } from "@openrune/cache";
import { type RSModelDefinition, decodeRSModel } from "@openrune/engine";
import { RSModel, type RSModelHandle } from "@openrune/react";
import React, { useCallback, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCache } from "../../context/cache-context";
import { cn } from "../../util/cn";

/** What's being shown: a model out of the cache, or one decoded from a file on disk. */
type Source =
    | { kind: "cache"; id: number; label: string }
    | { kind: "file"; def: RSModelDefinition; label: string };

/**
 * The plain model viewer: open a model, optionally play a sequence on it, orbit it.
 *
 * All the rendering lives in `@openrune/react` — this page is the controls around it. Anything
 * about how a model is drawn or animated belongs in that package, not here, so that the same
 * behaviour is available to anyone dropping `<RSModel>` on their own page.
 */
export default function ModelViewerApp(): JSX.Element {
    const {
        cache,
        state: cacheState,
        loadFiles,
        dirPickerSupported,
        needsPermission,
        openFolder,
        reopenRemembered,
    } = useCache();

    const [source, setSource] = useState<Source | null>(null);
    const [modelId, setModelId] = useState("65533");
    const [seqId, setSeqId] = useState("7570");
    /** The sequence actually playing — undefined until Play is pressed. */
    const [animation, setAnimation] = useState<number | undefined>(undefined);
    const [triangleCount, setTriangleCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [decoding, setDecoding] = useState(false);
    const [playing, setPlaying] = useState(false);

    const model = useRef<RSModelHandle>(null);

    const handleFile = useCallback(async (file: File) => {
        setDecoding(true);
        setError(null);
        setAnimation(undefined);
        try {
            setSource({
                kind: "file",
                def: decodeRSModel(0, await file.arrayBuffer()),
                label: file.name,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDecoding(false);
        }
    }, []);

    const onFileInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
        },
        [handleFile],
    );

    const onCacheFilesChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            await loadFiles(files);
        },
        [loadFiles],
    );

    const handleLoadFromCache = useCallback(() => {
        const id = Number.parseInt(modelId, 10);
        if (Number.isNaN(id)) return;
        setError(null);
        setAnimation(undefined);
        setSource({ kind: "cache", id, label: `Cache model #${id}` });
    }, [modelId]);

    const handlePlaySequence = useCallback(() => {
        const id = Number.parseInt(seqId, 10);
        if (Number.isNaN(id)) return;
        setError(null);
        setAnimation(id);
        setPlaying(true);
    }, [seqId]);

    const missingModelsIndex = cache !== null && !cache.indexExists(IndexType.DAT2.models);

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="sm">
                    <label>
                        Open .dat file
                        <input
                            type="file"
                            accept=".dat"
                            className="hidden"
                            onChange={onFileInputChange}
                        />
                    </label>
                </Button>
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
                            value={modelId}
                            onChange={(e) => setModelId(e.target.value)}
                            placeholder="Model id"
                            className="h-8 w-28"
                        />
                        <Button size="sm" variant="secondary" onClick={handleLoadFromCache}>
                            Load
                        </Button>
                    </>
                ) : null}
                {source ? (
                    <span className="text-sm text-muted-foreground">{source.label}</span>
                ) : null}
                {triangleCount !== null ? (
                    <span className="text-xs text-muted-foreground">{triangleCount} triangles</span>
                ) : null}
            </div>

            {cacheState.status === "ready" && source ? (
                <div className="flex flex-wrap items-center gap-3">
                    <Input
                        type="number"
                        value={seqId}
                        onChange={(e) => setSeqId(e.target.value)}
                        placeholder="Sequence id"
                        className="h-8 w-28"
                    />
                    <Button size="sm" variant="secondary" onClick={handlePlaySequence}>
                        Play sequence
                    </Button>
                    {animation !== undefined ? (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    model.current?.toggle();
                                    setPlaying((p) => !p);
                                }}
                            >
                                {playing ? "Pause" : "Resume"}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setAnimation(undefined);
                                    setPlaying(false);
                                }}
                            >
                                Stop
                            </Button>
                        </>
                    ) : null}
                </div>
            ) : null}

            {cacheState.status === "error" ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Cache: {cacheState.message}
                </div>
            ) : null}
            {cacheState.status === "ready" && missingModelsIndex ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
                    Loaded {cacheState.fileCount} files, but main_file_cache.idx7 (the models index)
                    wasn&apos;t among them — re-select all main_file_cache.* files, including idx7.
                </div>
            ) : null}
            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <div
                className={cn(
                    "min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card",
                    !source && "flex items-center justify-center",
                )}
            >
                {source ? (
                    <RSModel
                        ref={model}
                        cache={cache ?? undefined}
                        id={source.kind === "cache" ? source.id : undefined}
                        model={source.kind === "file" ? source.def : undefined}
                        animation={animation}
                        className="h-full w-full"
                        onReady={(info) => setTriangleCount(info.triangleCount)}
                        onError={(err) => setError(err.message)}
                    />
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {decoding ? "Decoding..." : "Open a raw model .dat file to view it."}
                    </p>
                )}
            </div>
        </div>
    );
}
