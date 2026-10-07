import { type ReactNode, createContext, useCallback, useContext, useMemo } from "react";

import {
    type MapEditorExternalPanelId,
    closeMapEditorExternalPopout,
} from "./map-editor-popout-actions";

export type MapEditorPopoutContextValue = {
    panelId: MapEditorExternalPanelId;
    isPopout: true;
    /** Restore prior placement in the main editor and close this window. */
    close: () => void;
};

const MapEditorPopoutContext = createContext<MapEditorPopoutContextValue | null>(null);

export function MapEditorPopoutProvider({
    panelId,
    children,
}: {
    panelId: MapEditorExternalPanelId;
    children: ReactNode;
}): JSX.Element {
    const close = useCallback(() => closeMapEditorExternalPopout(panelId), [panelId]);
    const value = useMemo(
        (): MapEditorPopoutContextValue => ({
            panelId,
            isPopout: true,
            close,
        }),
        [close, panelId],
    );
    return (
        <MapEditorPopoutContext.Provider value={value}>{children}</MapEditorPopoutContext.Provider>
    );
}

export function useMapEditorPopout(): MapEditorPopoutContextValue | null {
    return useContext(MapEditorPopoutContext);
}
