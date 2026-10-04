import { Leva, folder, useControls } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import { memo, useEffect, useState } from "react";

import { isTouchDevice } from "../util/DeviceUtil";
import { ProjectionType } from "./Camera";
import { MapViewer } from "./MapViewer";
import { MapViewerRenderer } from "./MapViewerRenderer";
import { MapViewerRendererType, createRenderer, getAvailableRenderers, getRendererName } from "./MapViewerRenderers";

interface MapViewerControlsProps {
    renderer: MapViewerRenderer;
    hideUi: boolean;
    showFps: boolean;
    setRenderer: (renderer: MapViewerRenderer) => void;
    setHideUi: (hideUi: boolean | ((hideUi: boolean) => boolean)) => void;
    setShowFps: (showFps: boolean | ((showFps: boolean) => boolean)) => void;
}

/**
 * Trimmed down to just Camera + Render — the only two sections actually wired up to this app
 * (cache switching, var editing, camera-path recording and sprite/texture export were rs-map-
 * viewer features for its own standalone site, not needed here).
 */
export const MapViewerControls = memo(
    ({
        renderer,
        hideUi: hidden,
        showFps,
        setRenderer,
        setHideUi,
        setShowFps,
    }: MapViewerControlsProps): JSX.Element => {
        const mapViewer = renderer.mapViewer;

        const [projectionType, setProjectionType] = useState<ProjectionType>(
            mapViewer.camera.projectionType,
        );

        const positionControls = isTouchDevice
            ? "Left joystick, Drag up and down."
            : "WASD,\nR or E (up),\nF or C (down),\nUse SHIFT to go faster, or TAB to go slower.";
        const directionControls = isTouchDevice
            ? "Right joystick."
            : "Arrow Keys or Click and Drag. Double click for pointerlock.";

        const controlsSchema: Schema = {
            Position: { value: positionControls, editable: false },
            Direction: { value: directionControls, editable: false },
        };

        useEffect(() => {
            function handleKeyDown(e: KeyboardEvent) {
                if (e.repeat) {
                    return;
                }
                if (e.key === "F1") {
                    setHideUi((v) => !v);
                }
            }

            document.addEventListener("keydown", handleKeyDown);

            return () => {
                document.removeEventListener("keydown", handleKeyDown);
            };
        }, [mapViewer, setHideUi]);

        const rendererOptions: Record<string, MapViewerRendererType> = {};
        for (const v of getAvailableRenderers()) {
            rendererOptions[getRendererName(v)] = v;
        }

        useControls(
            {
                Camera: folder(
                    {
                        Projection: {
                            value: projectionType,
                            options: {
                                Perspective: ProjectionType.PERSPECTIVE,
                                Ortho: ProjectionType.ORTHO,
                            },
                            onChange: (v: ProjectionType) => {
                                mapViewer.camera.setProjectionType(v);
                                setProjectionType(v);
                            },
                            order: 0,
                        },
                        ...createCameraControls(mapViewer),
                        Speed: {
                            value: mapViewer.cameraSpeed,
                            min: 0.1,
                            max: 5,
                            step: 0.1,
                            onChange: (v: number) => {
                                mapViewer.cameraSpeed = v;
                            },
                            order: 10,
                        },
                        Controls: folder(controlsSchema, { collapsed: true, order: 999 }),
                    },
                    { collapsed: false },
                ),
                Render: folder(
                    {
                        Renderer: {
                            value: renderer.type,
                            options: rendererOptions,
                            onChange: (v: MapViewerRendererType) => {
                                if (renderer.type !== v) {
                                    const next = createRenderer(v, mapViewer);
                                    mapViewer.setRenderer(next);
                                    setRenderer(next);
                                }
                            },
                        },
                        "Fps Limit": {
                            value: renderer.fpsLimit,
                            min: 1,
                            max: 999,
                            onChange: (v: number) => {
                                renderer.fpsLimit = v;
                            },
                        },
                        "Show Fps": {
                            value: showFps,
                            onChange: (v: boolean) => {
                                setShowFps(v);
                            },
                        },
                        ...renderer.getControls(),
                    },
                    { collapsed: false },
                ),
            },
            [renderer, projectionType, showFps],
        );

        return (
            <Leva
                titleBar={{ filter: false }}
                collapsed={true}
                hideCopyButton={true}
                hidden={hidden}
            />
        );
    },
);

function createCameraControls(mapViewer: MapViewer): Schema {
    if (mapViewer.camera.projectionType === ProjectionType.PERSPECTIVE) {
        return {
            FOV: {
                value: mapViewer.camera.fov,
                min: 30,
                max: 140,
                step: 1,
                onChange: (v: number) => {
                    mapViewer.camera.fov = v;
                },
            },
        };
    } else {
        return {
            "Ortho Zoom": {
                value: mapViewer.camera.orthoZoom,
                min: 1,
                max: 60,
                step: 1,
                onChange: (v: number) => {
                    mapViewer.camera.orthoZoom = v;
                },
            },
        };
    }
}
