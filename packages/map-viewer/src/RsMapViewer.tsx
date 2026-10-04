"use client";

/**
 * Mounts rs-map-viewer's own `MapViewer`/`MapViewerContainer` (vendored under `src/`, unchanged)
 * against cache bytes the app already has, instead of rs-map-viewer's own `fetch()`-based
 * `Caches.ts` loader — see `openrune-adapter.ts`. Mirrors `MapViewerApp.tsx`'s own mounting
 * sequence as closely as possible.
 */
import React, { useEffect, useState } from "react";
import { registerSerializer } from "threads";

import { Camera } from "./mapviewer/Camera";
import type { CacheList } from "./mapviewer/Caches";
import { MapViewer } from "./mapviewer/MapViewer";
import { MapViewerContainer } from "./mapviewer/MapViewerContainer";
import { getAvailableRenderers } from "./mapviewer/MapViewerRenderers";
import { renderDataLoaderSerializer } from "./mapviewer/worker/RenderDataLoader";
import { RenderDataWorkerPool } from "./mapviewer/worker/RenderDataWorkerPool";
import { createLoadedCache } from "./openrune-adapter";

let registered = false;
let workerPool: RenderDataWorkerPool | null = null;

function getWorkerPool(): RenderDataWorkerPool {
    if (!registered) {
        registerSerializer(renderDataLoaderSerializer);
        registered = true;
    }
    if (!workerPool) {
        workerPool = RenderDataWorkerPool.create(4);
    }
    return workerPool;
}

export type RsMapViewerProps = {
    /** The same raw `main_file_cache.*` file bytes the app's own cache picker already read. */
    entries: ReadonlyArray<readonly [string, ArrayBuffer]>;
    /** World tile coordinates to start the camera at. */
    x: number;
    z: number;
    plane?: number;
    className?: string;
    style?: React.CSSProperties;
    onError?: (error: Error) => void;
};

export function RsMapViewer({
    entries,
    x,
    z,
    className,
    style,
    onError,
}: RsMapViewerProps): JSX.Element {
    const [mapViewer, setMapViewer] = useState<MapViewer | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const cache = createLoadedCache(entries);
                const cacheList: CacheList = { caches: [cache.info], latest: cache.info };
                const mapImageCache = await caches.open("openrune-map-images");

                const availableRenderers = getAvailableRenderers();
                if (availableRenderers.length === 0) {
                    throw new Error("No WebGL2 or WebGPU renderer available in this browser");
                }

                const viewer = new MapViewer(
                    getWorkerPool(),
                    cacheList,
                    [],
                    [],
                    mapImageCache,
                    availableRenderers[0],
                    cache,
                );
                // Matches `Camera`'s own default (Lumbridge-ish) constructor shape — x/z are
                // world tile coordinates, pitch/yaw in the client's angle units.
                viewer.camera = new Camera(x, -26, z, -245, 1862);
                viewer.init();

                if (cancelled) return;
                setError(null);
                setMapViewer(viewer);
            } catch (err) {
                if (cancelled) return;
                const failure = err instanceof Error ? err : new Error(String(err));
                setError(failure);
                onError?.(failure);
            }
        })();

        return () => {
            cancelled = true;
        };
        // Rebuilds only when the cache itself changes — x/z only seed the initial camera.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entries]);

    if (error) {
        return (
            <div className={className} style={style}>
                <p style={{ padding: 12, color: "#f88" }}>{error.message}</p>
            </div>
        );
    }
    if (!mapViewer) {
        return <div className={className} style={style} />;
    }
    return (
        <div className={className} style={{ position: "relative", ...style }}>
            <MapViewerContainer mapViewer={mapViewer} />
        </div>
    );
}
