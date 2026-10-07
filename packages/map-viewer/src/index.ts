export {
    RsMapViewer,
    RsMapViewer as RsMapView,
    type RsMapViewerProps,
    type RsMapViewerProps as RsMapViewProps,
} from "./RsMapViewer";
export { createLoadedCache } from "./openrune-adapter";

// The full map editor (plugin system, brush tools, dockable workbench) — see `RsMapEditor`'s
// own doc comment on `MapEditorApp` for the cache-loading contract it shares with `RsMapViewer`.
export {
    MapEditorApp as RsMapEditor,
    type MapEditorAppProps as RsMapEditorProps,
} from "./mapeditor/MapEditorApp";
export { MapEditorPopoutPage } from "./mapeditor/MapEditorPopoutPage";

// Lower-level pieces, for driving a `MapViewer` directly (see `scripts/dump-map-tiles` —
// a headless tile dumper that bypasses the React component/interactive cache picker).
export { Camera, ProjectionType } from "./mapviewer/Camera";
export { MapViewer } from "./mapviewer/MapViewer";
export { getAvailableRenderers, WEBGL } from "./mapviewer/MapViewerRenderers";
export { TextureFilterMode } from "./mapviewer/webgl/WebGLMapViewerRenderer";
export { RenderDataWorkerPool } from "./mapviewer/worker/RenderDataWorkerPool";
export { registerSerializer } from "threads";
export { renderDataLoaderSerializer } from "./mapviewer/worker/RenderDataLoader";
export type { CacheList, LoadedCache } from "./mapviewer/Caches";
