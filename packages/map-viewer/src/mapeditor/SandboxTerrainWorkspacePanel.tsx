import type { IEditorPluginHost } from "./plugins/editor-plugin-host";

export function SandboxTerrainWorkspacePanel({
    pluginHost: _pluginHost,
}: {
    pluginHost: IEditorPluginHost;
}): JSX.Element {
    return (
        <div className="p-3 text-xs text-muted-foreground">Sandbox terrain tools coming soon.</div>
    );
}
