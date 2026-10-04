"use client";

import { RsMapView } from "@openrune/map-viewer";
import React, { useCallback, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCache } from "../../context/cache-context";
import { cn } from "../../util/cn";

/**
 * The 3D map viewer — a vendored copy of rs-map-viewer (dennisdev, BSD-2-Clause), unchanged
 * apart from reading cache bytes from this app's own cache picker instead of its own HTTP
 * fetching. See `@openrune/map-viewer`. Its own UI (camera/render controls, minimap, world map)
 * comes along with it — this page is just the cache-open flow and the coordinate to start at.
 */
export default function MapViewerApp(): JSX.Element {
    const {
        rawEntries,
        state: cacheState,
        loadFiles,
        dirPickerSupported,
        needsPermission,
        openFolder,
        reopenRemembered,
    } = useCache();

    const [xInput, setXInput] = useState("3222");
    const [zInput, setZInput] = useState("3218");
    const [coords, setCoords] = useState<{ x: number; z: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onCacheFilesChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            await loadFiles(files);
        },
        [loadFiles],
    );

    const handleLoad = useCallback(() => {
        const x = Number.parseInt(xInput, 10);
        const z = Number.parseInt(zInput, 10);
        if (Number.isNaN(x) || Number.isNaN(z)) return;
        setError(null);
        setCoords({ x, z });
    }, [xInput, zInput]);

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-4 p-4 md:p-6">
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
                            value={xInput}
                            onChange={(e) => setXInput(e.target.value)}
                            placeholder="X"
                            className="h-8 w-24"
                        />
                        <Input
                            type="number"
                            value={zInput}
                            onChange={(e) => setZInput(e.target.value)}
                            placeholder="Z"
                            className="h-8 w-24"
                        />
                        <Button size="sm" variant="secondary" onClick={handleLoad}>
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
            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <div
                className={cn(
                    "min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card",
                    !(coords && rawEntries) && "flex items-center justify-center",
                )}
            >
                {coords && rawEntries ? (
                    <RsMapView
                        entries={rawEntries}
                        x={coords.x}
                        z={coords.z}
                        className="h-full w-full"
                        onError={(err) => setError(err.message)}
                    />
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Open a cache and enter coordinates to fly around the map.
                    </p>
                )}
            </div>
        </div>
    );
}
