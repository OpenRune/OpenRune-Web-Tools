import type { DockviewApi } from "dockview";
import { type ReactNode, memo, useRef } from "react";

import { MapEditorWorkbenchFloatingLayerContext } from "./map-editor-workbench-floating-layer-context";
import type { IEditorPluginHost } from "./plugins/editor-plugin-host";

export interface MapEditorWorkbenchFloatingLayerProps {
    pluginHost: IEditorPluginHost;
    dockApi: DockviewApi | null;
    children: ReactNode;
}

export const MapEditorWorkbenchFloatingLayer = memo(function MapEditorWorkbenchFloatingLayer({
    children,
}: MapEditorWorkbenchFloatingLayerProps): JSX.Element {
    const layerRef = useRef<HTMLDivElement>(null);

    return (
        <MapEditorWorkbenchFloatingLayerContext.Provider value={{ layerRef }}>
            <div
                ref={layerRef}
                className="pointer-events-none absolute inset-0 z-[50] overflow-hidden"
                data-map-editor-workbench-floating-layer
            >
                {children}
            </div>
        </MapEditorWorkbenchFloatingLayerContext.Provider>
    );
});
