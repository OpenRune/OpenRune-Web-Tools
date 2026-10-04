"use client";

import { IndexType } from "@openrune/cache";
import { RSSprite } from "@openrune/react";
import React, { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCache } from "../../context/cache-context";

/**
 * The sprite viewer: pick an archive id, see every frame in it.
 *
 * Decoding and drawing live in `@openrune/react`'s `<RSSprite>` — this page is the controls
 * around it, so anyone dropping a sprite on their own page gets the same rendering.
 */
export default function SpriteViewerApp(): JSX.Element {
    const [spriteId, setSpriteId] = useState("");
    /** The archive actually being shown — only set when Load is pressed. */
    const [shownId, setShownId] = useState<number | null>(null);
    const [frameCount, setFrameCount] = useState(0);
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

    const missingSpritesIndex = cache !== null && !cache.indexExists(IndexType.DAT2.sprites);

    // A different cache means whatever was on screen belongs to another server.
    useEffect(() => {
        setShownId(null);
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

    const handleLoadSprite = useCallback(() => {
        const id = Number.parseInt(spriteId, 10);
        if (Number.isNaN(id)) return;
        setError(null);
        setFrameCount(0);
        setShownId(id);
    }, [spriteId]);

    return (
        <div className="flex w-full flex-col gap-6">
            <section className="space-y-3">
                <h2 className="text-sm font-semibold">Packed sprites (dat2 cache)</h2>
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
                                value={spriteId}
                                onChange={(e) => setSpriteId(e.target.value)}
                                placeholder="Sprite archive id"
                                className="h-8 w-36"
                            />
                            <Button size="sm" variant="secondary" onClick={handleLoadSprite}>
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
                {cacheState.status === "ready" && missingSpritesIndex ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
                        Loaded {cacheState.fileCount} files, but main_file_cache.idx8 (the sprites
                        index) wasn't among them — re-select all main_file_cache.* files, including
                        idx8.
                    </div>
                ) : null}
                {error ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                    </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                    Known login-screen sprite ids: 498 logo, 499 titlebox, 500 titlebutton, 811
                    title_mute, 814 free world background, 818 world select button.
                </p>

                {shownId !== null ? (
                    <div className="space-y-1">
                        {frameCount > 0 ? (
                            <p className="text-xs text-muted-foreground">
                                all {frameCount} frame{frameCount === 1 ? "" : "s"}, packed size,
                                side by side
                            </p>
                        ) : null}
                        <RSSprite
                            id={shownId}
                            cache={cache ?? undefined}
                            frame="all"
                            scale={4}
                            background="checkerboard"
                            className="rounded border border-border"
                            onReady={(info) => setFrameCount(info.frameCount)}
                            onError={(err) => setError(err.message)}
                        />
                    </div>
                ) : null}
            </section>
        </div>
    );
}
