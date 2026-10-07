"use client";

import { RsMapEditor } from "@openrune/map-viewer";
import React, { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { useCache } from "../../context/cache-context";
import { useShellPreferences } from "../../context/shell-preferences-context";
import { useWorkspaces } from "../../context/workspaces-context";

/**
 * The full map editor — plugin system, brush tools, terrain/object painting, dockable
 * workbench — vendored alongside the plain viewer under `@openrune/map-viewer`. See
 * `RsMapEditor`. This page is just the cache-open flow; everything else (region/sandbox
 * launch panel, title bar, tool dock, minimap) comes along with the component.
 */
export default function MapEditorApp(): JSX.Element {
    const {
        rawEntries,
        state: cacheState,
        loadFiles,
        dirPickerSupported,
        needsPermission,
        openFolder,
        reopenRemembered,
    } = useCache();
    const { active } = useWorkspaces();
    const { sidebarCollapsed, setSidebarCollapsed } = useShellPreferences();
    const [error, setError] = useState<string | null>(null);

    // The editor's own dock UI is dense and wants the width back — collapse the sidebar on
    // entry and restore whatever the user had on exit, rather than permanently overwriting
    // their preference.
    useEffect(() => {
        const wasCollapsed = sidebarCollapsed;
        setSidebarCollapsed(true);
        return () => setSidebarCollapsed(wasCollapsed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onCacheFilesChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            await loadFiles(files);
        },
        [loadFiles],
    );

    if (!rawEntries || cacheState.status !== "ready") {
        return (
            <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-center gap-3">
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
                <p className="text-sm text-muted-foreground">
                    Open a cache to start editing the map.
                </p>
            </div>
        );
    }

    return (
        <RsMapEditor
            entries={rawEntries}
            cacheId={active?.id ?? "current"}
            cacheName={active?.name ?? "Cache"}
            onError={(err) => setError(err.message)}
        />
    );
}
