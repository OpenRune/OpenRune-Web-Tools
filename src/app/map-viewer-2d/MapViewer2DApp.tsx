"use client";

import { type ImageRSMapViewerHandle, type MapLayerId, ImageRSMapViewer } from "@openrune/react";
import React, { useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

const LAYER_OPTIONS: { value: MapLayerId; label: string }[] = [
    { value: "2d-shaded", label: "2D (shaded)" },
    { value: "2d-normal", label: "2D (flat colour)" },
    { value: "flat", label: "Satellite (flat)" },
    { value: "3d", label: "Satellite (3D)" },
];

/**
 * Demo/test page for `<ImageRSMapViewer>` — a fast canvas tile viewer over the images
 * `scripts/dump-map-tiles.mjs` bakes, as opposed to `/map-viewer`'s live 3D WebGL scene. Reads
 * baked tiles over plain HTTP, so there's no cache to open here.
 */
export default function MapViewer2DApp(): JSX.Element {
    const viewerRef = useRef<ImageRSMapViewerHandle | null>(null);

    const [urlBase, setUrlBase] = useState("/api/dumps");
    const [layer, setLayer] = useState<MapLayerId>("2d-shaded");
    const [showOverlay, setShowOverlay] = useState(true);
    const [plane, setPlane] = useState(0);
    const [showGrid, setShowGrid] = useState(false);
    const [showLabels, setShowLabels] = useState(false);
    const [regionInput, setRegionInput] = useState("11828");
    const [hover, setHover] = useState<{ x: number; z: number } | null>(null);

    const goToRegion = () => {
        const regionId = Number.parseInt(regionInput, 10);
        if (Number.isNaN(regionId)) return;
        viewerRef.current?.goToRegion(regionId >> 8, regionId & 0xff, { zoom: 3 });
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    value={urlBase}
                    onChange={(e) => setUrlBase(e.target.value)}
                    placeholder="Tile URL base"
                    className="h-8 w-40"
                />

                <select
                    value={layer}
                    onChange={(e) => setLayer(e.target.value as MapLayerId)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                    {LAYER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>

                <select
                    value={plane}
                    onChange={(e) => setPlane(Number.parseInt(e.target.value, 10))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                    {[0, 1, 2, 3].map((p) => (
                        <option key={p} value={p}>
                            Plane {p}
                        </option>
                    ))}
                </select>

                <label className="flex items-center gap-1.5 text-sm">
                    <input
                        type="checkbox"
                        checked={showOverlay}
                        onChange={(e) => setShowOverlay(e.target.checked)}
                    />
                    Overlay
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                    <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={(e) => setShowGrid(e.target.checked)}
                    />
                    Region grid
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                    <input
                        type="checkbox"
                        checked={showLabels}
                        onChange={(e) => setShowLabels(e.target.checked)}
                    />
                    Region labels
                </label>

                <Input
                    value={regionInput}
                    onChange={(e) => setRegionInput(e.target.value)}
                    placeholder="Region id"
                    className="h-8 w-28"
                />
                <Button size="sm" variant="secondary" onClick={goToRegion}>
                    Go to region
                </Button>

                {hover ? (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {Math.round(hover.x)}, {Math.round(hover.z)}
                    </span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
                <ImageRSMapViewer
                    ref={viewerRef}
                    urlBase={urlBase}
                    region={11828}
                    zoom={3}
                    plane={plane}
                    layer={layer}
                    showOverlay={showOverlay}
                    showRegionGrid={showGrid}
                    showRegionLabels={showLabels}
                    onHoverCoords={setHover}
                    className="h-full w-full"
                />
            </div>
        </div>
    );
}
