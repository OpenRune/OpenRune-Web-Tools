import { useCallback, useEffect, useRef, useState } from "react";
import { Joystick } from "react-joystick-component";
import { useSearchParams } from "react-router-dom";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { OsrsMenu, OsrsMenuProps } from "../components/rs/menu/OsrsMenu";
import { MinimapContainer } from "../components/rs/minimap/MinimapContainer";
import { RS_TO_DEGREES } from "../rs/MathConstants";
import { DownloadProgress } from "../rs/cache/CacheFiles";
import { formatBytes } from "../util/BytesUtil";
import { isTouchDevice } from "../util/DeviceUtil";
import { MapViewer } from "./MapViewer";
import "./MapViewerContainer.css";
import { MapViewerControls } from "./MapViewerControls";
import { MapViewerRenderer } from "./MapViewerRenderer";

interface MapViewerContainerProps {
    mapViewer: MapViewer;
}

export function MapViewerContainer({ mapViewer }: MapViewerContainerProps): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();

    const [renderer, setRenderer] = useState<MapViewerRenderer>(mapViewer.renderer);

    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();

    const [hideUi, setHideUi] = useState(false);
    const [showFps, setShowFps] = useState(true);
    const [fps, setFps] = useState(0);
    const [cameraYaw, setCameraYaw] = useState(mapViewer.camera.getYaw());

    const [menuProps, setMenuProps] = useState<OsrsMenuProps | undefined>(undefined);

    const requestRef = useRef<number | undefined>();

    const animate = (time: DOMHighResTimeStamp) => {
        // Wait for 200ms before updating search params
        if (
            mapViewer.needsSearchParamUpdate &&
            performance.now() - mapViewer.lastTimeSearchParamsUpdated > 200
        ) {
            setSearchParams(mapViewer.getSearchParams(), { replace: true });
            mapViewer.needsSearchParamUpdate = false;
            console.log("Updated search params");
        }

        if (!hideUi) {
            setFps(Math.round(renderer.stats.frameTimeFps));
            setCameraYaw(mapViewer.camera.getYaw());
        }

        if (mapViewer.menuEntries.length > 0 && mapViewer.menuX !== -1 && mapViewer.menuY !== -1) {
            setMenuProps({
                x: mapViewer.menuX,
                y: mapViewer.menuY,
                tooltip: !mapViewer.menuOpen,
                entries: mapViewer.menuEntries,
                debugId: mapViewer.debugId,
            });
        } else {
            setMenuProps(undefined);
        }

        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current!);
    }, [searchParams, hideUi]);

    const getMapPosition = useCallback(() => {
        const x = mapViewer.camera.getPosX();
        const y = mapViewer.camera.getPosZ();

        return {
            x,
            y,
        };
    }, [mapViewer]);

    const loadMinimapImageUrl = useCallback(
        (mapX: number, mapY: number) => {
            return mapViewer.getMapImageUrl(mapX, mapY, true);
        },
        [mapViewer],
    );

    let loadingBarOverlay: JSX.Element | undefined = undefined;
    if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);
        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;
        loadingBarOverlay = (
            <div className="overlay-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    }

    return (
        <div className="max-height">
            {loadingBarOverlay}

            {menuProps && <OsrsMenu {...menuProps} />}

            <MapViewerControls
                renderer={renderer}
                hideUi={hideUi}
                showFps={showFps}
                setRenderer={setRenderer}
                setHideUi={setHideUi}
                setShowFps={setShowFps}
            />

            {!hideUi && (
                <div className="hud left-top">
                    <MinimapContainer
                        yawDegrees={(2047 - cameraYaw) * RS_TO_DEGREES}
                        getPosition={getMapPosition}
                        loadMapImageUrl={loadMinimapImageUrl}
                    />

                    {showFps && <div className="fps-counter content-text">{fps}</div>}
                    {showFps && <div className="fps-counter content-text">{mapViewer.debugText}</div>}
                </div>
            )}

            {!hideUi && isTouchDevice && (
                <div className="joystick-container left">
                    <Joystick
                        size={75}
                        baseColor="#181C20"
                        stickColor="#007BFF"
                        stickSize={40}
                        move={mapViewer.inputManager.onPositionJoystickMove}
                        stop={mapViewer.inputManager.onPositionJoystickStop}
                    ></Joystick>
                </div>
            )}
            {!hideUi && isTouchDevice && (
                <div className="joystick-container right">
                    <Joystick
                        size={75}
                        baseColor="#181C20"
                        stickColor="#007BFF"
                        stickSize={40}
                        move={mapViewer.inputManager.onCameraJoystickMove}
                        stop={mapViewer.inputManager.onCameraJoystickStop}
                    ></Joystick>
                </div>
            )}

            <RendererCanvas renderer={renderer} />
        </div>
    );
}
