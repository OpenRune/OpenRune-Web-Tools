"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import {
    type DrawCallback,
    ImageMapScene,
    type MapLayerId,
    type WorldCoord,
} from "./ImageMapScene";

/** What a `ref` on `<ImageRSMapViewer>` gives you: navigation, settings, and a drawing API. */
export type ImageRSMapViewerHandle = {
    /** Pans to a world tile coordinate. */
    goToTile(x: number, z: number, opts?: { zoom?: number; animate?: boolean }): void;
    /** Pans to an OSRS map square/region, by its square coordinates (not the packed region id). */
    goToRegion(squareX: number, squareZ: number, opts?: { zoom?: number; animate?: boolean }): void;
    setZoom(zoom: number, opts?: { animate?: boolean }): void;
    setPlane(plane: number): void;
    setLayer(layer: MapLayerId): void;
    setShowOverlay(show: boolean): void;
    /** Registers a callback that draws on the canvas every frame, after the map/grid/labels. */
    addDrawCallback(id: string, fn: DrawCallback): void;
    removeDrawCallback(id: string): void;
    /** World tile coordinate under a canvas-relative pixel position (e.g. from a click handler). */
    screenToWorld(screenX: number, screenY: number): WorldCoord;
    /** Canvas-relative pixel position of a world tile coordinate (may land off-canvas). */
    worldToScreen(x: number, z: number): { x: number; y: number };
    /** Current view center, in world tile coordinates. */
    getCenter(): WorldCoord;
    getZoom(): number;
    /** The canvas itself, for your own event handlers or screenshots. */
    readonly canvas: HTMLCanvasElement | null;
    /** The scene underneath, for anything this handle doesn't cover. */
    readonly scene: ImageMapScene | null;
};

export type ImageRSMapViewerProps = {
    /** Base URL/path the dumped tiles are served from, e.g. "/dumps" or a CDN root. */
    urlBase: string;

    /** Initial center (world tile coords). Ignored if `region` is given. Not controlled after
     * mount — pan/zoom with the ref API once it's up. */
    x?: number;
    z?: number;
    /** Initial center as an OSRS region id (`(regionX << 8) | regionZ`), instead of x/z. */
    region?: number;
    /** `pxPerSquare = 2^zoom`. Default 3 ("base", one image per region). */
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;

    /** Dungeon/floor level, 0-3. Default 0. */
    plane?: number;
    /** Which baked base layer to render. Default "2d-shaded". */
    layer?: MapLayerId;
    /** Composites the transparent "overlay" layer (walls/map scenes/function icons) on top. */
    showOverlay?: boolean;
    /** Draws region (64-tile) boundary lines over the visible area. */
    showRegionGrid?: boolean;
    regionGridColor?: string;
    /** Draws each visible region's id as a label. */
    showRegionLabels?: boolean;

    /** Called with the world tile coordinate under the cursor, or null when it leaves. */
    onHoverCoords?: (coords: WorldCoord | null) => void;
    /** Called whenever the centered-on region changes, with its packed id. */
    onRegionChange?: (regionId: number) => void;
    /** Only for real failures — a missing tile (no data for that area) is normal and silent. */
    onTileError?: (url: string, error: unknown) => void;

    className?: string;
    style?: React.CSSProperties;
};

/**
 * A fast, pannable/zoomable canvas over the image tiles `scripts/dump-map-tiles.mjs` bakes —
 * drag to pan, wheel to zoom, smooth at any zoom level like a normal web map.
 *
 *     <ImageRSMapViewer urlBase="/dumps" region={12850} layer="2d-shaded" showOverlay />
 *
 * Fills whatever you put it in, so give the parent a size. `x`/`z`/`region`/`zoom` are only the
 * starting view — drive it afterward through a ref (`goToTile`, `goToRegion`, `setZoom`, ...).
 * `addDrawCallback` lets you draw your own markers/boxes in sync with the map: it hands you the
 * canvas context plus a `worldToScreen` projector, called every frame after the map itself.
 */
export const ImageRSMapViewer = forwardRef<ImageRSMapViewerHandle, ImageRSMapViewerProps>(
    function ImageRSMapViewer(
        {
            urlBase,
            x,
            z,
            region,
            zoom,
            minZoom,
            maxZoom,
            plane,
            layer,
            showOverlay,
            showRegionGrid,
            regionGridColor,
            showRegionLabels,
            onHoverCoords,
            onRegionChange,
            onTileError,
            className,
            style,
        },
        ref,
    ) {
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const sceneRef = useRef<ImageMapScene | null>(null);

        // Callbacks are read through a ref so a caller passing inline arrows doesn't tear the
        // scene down and rebuild it on every render.
        const handlers = useRef({ onHoverCoords, onRegionChange, onTileError });
        handlers.current = { onHoverCoords, onRegionChange, onTileError };

        useImperativeHandle(
            ref,
            (): ImageRSMapViewerHandle => ({
                goToTile: (tx, tz, opts) => sceneRef.current?.goToTile(tx, tz, opts),
                goToRegion: (sx, sz, opts) => sceneRef.current?.goToRegion(sx, sz, opts),
                setZoom: (z2, opts) => sceneRef.current?.setZoom(z2, opts),
                setPlane: (p) => sceneRef.current?.setPlane(p),
                setLayer: (l) => sceneRef.current?.setLayer(l),
                setShowOverlay: (show) => sceneRef.current?.setShowOverlay(show),
                addDrawCallback: (id, fn) => sceneRef.current?.addDrawCallback(id, fn),
                removeDrawCallback: (id) => sceneRef.current?.removeDrawCallback(id),
                screenToWorld: (sx, sy) => sceneRef.current?.screenToWorld(sx, sy) ?? { x: 0, z: 0 },
                worldToScreen: (wx, wz) => sceneRef.current?.worldToScreen(wx, wz) ?? { x: 0, y: 0 },
                getCenter: () => sceneRef.current?.getCenter() ?? { x: 0, z: 0 },
                getZoom: () => sceneRef.current?.getZoom() ?? 0,
                get canvas() {
                    return canvasRef.current;
                },
                get scene() {
                    return sceneRef.current;
                },
            }),
            [],
        );

        // The scene owns a 2d context and its own render loop, so it's built once and kept;
        // content/setting changes go through it rather than through a remount.
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const scene = new ImageMapScene(canvas, {
                urlBase,
                x,
                z,
                region,
                zoom,
                minZoom,
                maxZoom,
                plane,
                layer,
                showOverlay,
                showRegionGrid,
                regionGridColor,
                showRegionLabels,
                onHoverCoords: (coords) => handlers.current.onHoverCoords?.(coords),
                onRegionChange: (id) => handlers.current.onRegionChange?.(id),
                onTileError: (url, err) => handlers.current.onTileError?.(url, err),
            });
            sceneRef.current = scene;
            const unobserve = scene.observe(canvas.parentElement ?? canvas);

            return () => {
                unobserve();
                scene.dispose();
                sceneRef.current = null;
            };
            // Built once with whatever the initial props were: x/z/region/zoom are documented as
            // "initial view only" (see ImageRSMapViewerProps), and the settings below are synced
            // by their own effects instead of forcing a rebuild here.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [urlBase]);

        useEffect(() => {
            if (urlBase !== undefined) sceneRef.current?.setUrlBase(urlBase);
        }, [urlBase]);
        useEffect(() => {
            if (plane !== undefined) sceneRef.current?.setPlane(plane);
        }, [plane]);
        useEffect(() => {
            if (layer !== undefined) sceneRef.current?.setLayer(layer);
        }, [layer]);
        useEffect(() => {
            if (showOverlay !== undefined) sceneRef.current?.setShowOverlay(showOverlay);
        }, [showOverlay]);
        useEffect(() => {
            if (showRegionGrid !== undefined) sceneRef.current?.setShowRegionGrid(showRegionGrid);
        }, [showRegionGrid]);
        useEffect(() => {
            if (regionGridColor !== undefined) sceneRef.current?.setRegionGridColor(regionGridColor);
        }, [regionGridColor]);
        useEffect(() => {
            if (showRegionLabels !== undefined) sceneRef.current?.setShowRegionLabels(showRegionLabels);
        }, [showRegionLabels]);

        return (
            <div className={className} style={{ position: "relative", ...style }}>
                <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label="OSRS map"
                    style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }}
                />
            </div>
        );
    },
);
