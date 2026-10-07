import type { MapEditorPanelContextMenuItem } from "./MapEditorPanelContextMenu";
import {
    MAP_EDITOR_FLOATABLE_DOCK_PANELS,
    getMapEditorPanelDisplay,
    isMapEditorFloatablePanel,
    setMapEditorPanelPlacement,
} from "./map-editor-panel-display";
import {
    buildMapEditorPanelPlacementMenuItems,
    buildPaintToolsContextMenuItems,
} from "./map-editor-panel-placement-menu";
import { getEditorBottomBarModel } from "./plugins/builtins/editor-bottom-bar-model";
import { getPaintToolsStripModel } from "./plugins/builtins/paint-tools-strip-model";
import type { IEditorPluginHost } from "./plugins/editor-plugin-host";

export function buildMapEditorDockTabMenuItems(
    host: IEditorPluginHost,
    panelId: string,
    fallbackTitle: string,
): MapEditorPanelContextMenuItem[] {
    if (panelId === "editor-paint-tools") {
        const model = getPaintToolsStripModel(host);
        return buildPaintToolsContextMenuItems(model);
    }

    if (panelId === "editor-brush-workspace") {
        const model = getEditorBottomBarModel(host);
        return buildMapEditorPanelPlacementMenuItems({
            title: "Brush workspace",
            current: model.placement,
            dockLabel: "Dock to bottom",
            onSelect: (placement) => model.setPlacement(placement),
        });
    }

    if (!isMapEditorFloatablePanel(panelId)) {
        return [];
    }

    const config = MAP_EDITOR_FLOATABLE_DOCK_PANELS.find((row) => row.panelId === panelId);
    const title = config?.title ?? fallbackTitle;
    return buildMapEditorPanelPlacementMenuItems({
        title,
        current: getMapEditorPanelDisplay(host, panelId).placement,
        canExternal: config?.canExternal,
        onSelect: (placement) => setMapEditorPanelPlacement(host, panelId, placement),
    });
}
