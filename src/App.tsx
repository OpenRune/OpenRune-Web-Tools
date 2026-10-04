import {
    Binary,
    Box,
    Check,
    Clapperboard,
    Coffee,
    Home,
    Images,
    Layers,
    Map,
    Moon,
    PanelLeft,
    Settings,
    Sun,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";

import AnimationEditorApp from "./app/animation-editor/AnimationEditorApp";
import BinaryViewerApp from "./app/binary-viewer/BinaryViewerApp";
import MapViewer2DApp from "./app/map-viewer-2d/MapViewer2DApp";
import MapViewerApp from "./app/map-viewer/MapViewerApp";
import ModelViewerApp from "./app/model-viewer/ModelViewerApp";
import SpriteViewerApp from "./app/sprite-viewer/SpriteViewerApp";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { Logo } from "./components/ui/svg/Logo";
import { MapEditorLogoBig } from "./components/ui/svg/MapEditorLogoBig";
import { Sygnet } from "./components/ui/svg/Sygnet";
import { ThemePreset } from "./context/settings-context";
import { useSettings } from "./context/settings-context";
import { useShellPreferences } from "./context/shell-preferences-context";
import { useWorkspaces } from "./context/workspaces-context";
import { cn } from "./util/cn";

function HomePage(): JSX.Element {
    return (
        <div className="mx-auto w-full max-w-7xl space-y-4">
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    OpenRune
                </p>
                <h1 className="mt-2 text-4xl font-semibold tracking-tight">
                    A clean workspace, ready to build on
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    This is a bare app shell. Add new sections from the sidebar as they're built.
                </p>
            </section>
        </div>
    );
}

function SettingsModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
    const { settings, updateSettings } = useSettings();
    const defaultThemes = useMemo(
        () => [
            { name: "Default", value: "default" },
            { name: "Blue", value: "blue" },
            { name: "Green", value: "green" },
            { name: "Amber", value: "amber" },
            { name: "Default Scaled", value: "default-scaled" },
            { name: "Blue Scaled", value: "blue-scaled" },
            { name: "Mono", value: "mono-scaled" },
        ],
        [],
    );

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                        <Settings className="size-5" />
                        Settings
                    </h2>
                    <button
                        type="button"
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </button>
                </div>
                <div className="space-y-6">
                    <section>
                        <h3 className="mb-2 text-sm font-semibold">Appearance</h3>
                        <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-background p-3">
                            <div>
                                <p className="text-sm font-medium">Dark / light mode</p>
                                <p className="text-xs text-muted-foreground">Toggle color scheme</p>
                            </div>
                            <button
                                type="button"
                                className="rounded-md border border-border bg-card p-2"
                                onClick={() =>
                                    updateSettings({
                                        themeMode: settings.themeMode === "dark" ? "light" : "dark",
                                    })
                                }
                            >
                                {settings.themeMode === "dark" ? (
                                    <Sun className="size-4" />
                                ) : (
                                    <Moon className="size-4" />
                                )}
                            </button>
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border bg-background p-3">
                            <div>
                                <p className="text-sm font-medium">Full width content</p>
                                <p className="text-xs text-muted-foreground">
                                    Expand content area to full width
                                </p>
                            </div>
                            <button
                                type="button"
                                className={cn(
                                    "h-6 w-11 rounded-full border-2 border-transparent transition-colors",
                                    settings.fullWidthContent ? "bg-primary" : "bg-input",
                                )}
                                onClick={() =>
                                    updateSettings({
                                        fullWidthContent: !settings.fullWidthContent,
                                    })
                                }
                            >
                                <span
                                    className={cn(
                                        "block h-5 w-5 rounded-full bg-background shadow transition-transform",
                                        settings.fullWidthContent
                                            ? "translate-x-5"
                                            : "translate-x-0",
                                    )}
                                />
                            </button>
                        </div>
                    </section>
                    <section>
                        <h3 className="mb-2 text-sm font-semibold">Color themes</h3>
                        <div className="space-y-2">
                            {defaultThemes.map((theme) => (
                                <button
                                    type="button"
                                    key={theme.value}
                                    className={cn(
                                        "flex w-full items-center rounded-md border px-3 py-2 text-sm",
                                        settings.themePreset === theme.value
                                            ? "border-primary bg-primary/15"
                                            : "border-border bg-background",
                                    )}
                                    onClick={() =>
                                        updateSettings({
                                            themePreset: theme.value as ThemePreset,
                                        })
                                    }
                                >
                                    <span className="flex-1 text-left">{theme.name}</span>
                                    {settings.themePreset === theme.value ? (
                                        <Check className="size-4" />
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

function SidebarNav({
    collapsed,
    onToggleSidebar,
}: {
    collapsed: boolean;
    onToggleSidebar?: () => void;
}): JSX.Element {
    const location = useLocation();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [workspacesOpen, setWorkspacesOpen] = useState(false);
    const { active } = useWorkspaces();

    const navLinkClass = (href: string): string =>
        cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-200",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed && "justify-center gap-0 px-0",
            location.pathname === href || (href !== "/" && location.pathname.startsWith(href))
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/90",
        );

    const footerItemClass = cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-200",
        "border border-sidebar-border/70 bg-sidebar-accent/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center gap-0 px-0",
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
            <div className="min-h-0 flex-1 px-2">
                <nav className="flex flex-col gap-1 pt-2 pb-2" aria-label="Site sections">
                    <NavLink to="/" end className={navLinkClass("/")}>
                        <Home className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Home</span> : null}
                    </NavLink>
                    <NavLink to="/model-viewer" className={navLinkClass("/model-viewer")}>
                        <Box className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Model Viewer</span> : null}
                    </NavLink>
                    <NavLink to="/map-viewer" className={navLinkClass("/map-viewer")}>
                        <Map className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Map Viewer</span> : null}
                    </NavLink>
                    <NavLink to="/map-viewer-2d" className={navLinkClass("/map-viewer-2d")}>
                        <Map className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Map Viewer 2D</span> : null}
                    </NavLink>
                    <NavLink to="/sprite-viewer" className={navLinkClass("/sprite-viewer")}>
                        <Images className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Sprite Viewer</span> : null}
                    </NavLink>
                    <NavLink to="/binary-viewer" className={navLinkClass("/binary-viewer")}>
                        <Binary className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? <span className="ml-1 truncate">Binary Viewer</span> : null}
                    </NavLink>
                    <NavLink to="/animation-editor" className={navLinkClass("/animation-editor")}>
                        <Clapperboard className="size-4 shrink-0" aria-hidden />
                        {!collapsed ? (
                            <span className="ml-1 truncate">Animation Editor</span>
                        ) : null}
                    </NavLink>
                </nav>
                {collapsed && onToggleSidebar ? (
                    <button
                        type="button"
                        className="flex w-full items-center justify-center rounded-lg px-0 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        onClick={onToggleSidebar}
                        aria-label="Expand sidebar"
                        title="Expand sidebar"
                    >
                        <PanelLeft className="size-4 shrink-0" aria-hidden />
                    </button>
                ) : null}
            </div>
            <div className="flex flex-col gap-1 px-2 pt-1 pb-2">
                {/* The flyout anchors to this wrapper, not the footer, so it lines up with the
                    button's own edges rather than the bottom of the sidebar. */}
                <div className="relative">
                    {workspacesOpen ? (
                        <WorkspacePanel onClose={() => setWorkspacesOpen(false)} />
                    ) : null}
                    <button
                        type="button"
                        className={cn(
                            footerItemClass,
                            // While open the button reaches past the sidebar's padding to the
                            // panel's edge and takes the panel's own background, so the two
                            // meet as one surface instead of two separate boxes.
                            // The sidebar pads its footer by 8px; the button grows by exactly
                            // that so its right edge meets the panel's left edge.
                            workspacesOpen &&
                                "w-[calc(100%+0.5rem)] rounded-r-none border-r-0 bg-card text-sidebar-accent-foreground",
                        )}
                        aria-label="Workspaces"
                        title={active ? `Workspace: ${active.name}` : "Workspaces"}
                        onClick={() => setWorkspacesOpen((open) => !open)}
                    >
                        {/* The server's own icon stands in for the generic one, so which
                            workspace you're in is recognisable even collapsed. */}
                        {active?.icon ? (
                            // Plain <img>: the source is a data URL the user picked, not a routed asset.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={active.icon}
                                alt=""
                                className="size-4 shrink-0 rounded-sm object-cover"
                            />
                        ) : (
                            <Layers className="size-4 shrink-0" />
                        )}
                        {!collapsed ? (
                            <span className="ml-1 min-w-0 flex-1 truncate text-left">
                                {active ? `Workspace: ${active.name}` : "Workspace"}
                            </span>
                        ) : null}
                    </button>
                </div>
                <button
                    type="button"
                    className={footerItemClass}
                    aria-label="Settings"
                    title="Settings"
                    onClick={() => setSettingsOpen(true)}
                >
                    <Settings className="size-4 shrink-0" />
                    {!collapsed ? <span className="ml-1 truncate">Settings</span> : null}
                </button>
                <a
                    href="https://buymeacoffee.com/openrune"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={footerItemClass}
                    aria-label="Buy Me a Coffee"
                >
                    <Coffee className="size-4 shrink-0" />
                    {!collapsed ? <span className="ml-1 truncate">Buy Me a Coffee</span> : null}
                </a>
            </div>
        </div>
    );
}

export default function App(): JSX.Element {
    const location = useLocation();
    const isModelViewerRoute =
        location.pathname.startsWith("/model-viewer") ||
        location.pathname.startsWith("/animation-editor") ||
        location.pathname.startsWith("/map-viewer");
    // ("/map-viewer-2d" is matched too — it shares the "/map-viewer" prefix.)
    const { sidebarCollapsed, toggleSidebarCollapsed } = useShellPreferences();

    return (
        <div className="flex h-dvh w-full">
            <aside
                className={cn(
                    "relative z-20 h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-out",
                    "hidden md:flex",
                    sidebarCollapsed ? "w-16" : "w-60",
                )}
                aria-label="Primary navigation"
            >
                <div
                    className={cn(
                        "flex h-14 items-center border-b border-sidebar-border px-3",
                        sidebarCollapsed && "justify-center px-0",
                    )}
                >
                    {sidebarCollapsed ? (
                        <div className="flex w-full items-center justify-center">
                            <Sygnet
                                className="h-8 w-8"
                                aria-label="OpenRune map editor"
                                role="img"
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <MapEditorLogoBig className="h-8 w-8 shrink-0" aria-hidden />
                                <Logo className="h-8 min-w-0 flex-1" alt="OpenRune" />
                            </div>
                            <button
                                type="button"
                                className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                aria-label="Collapse sidebar"
                                onClick={toggleSidebarCollapsed}
                            >
                                <PanelLeft className="size-4" />
                            </button>
                        </>
                    )}
                </div>
                <SidebarNav collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebarCollapsed} />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
                <main
                    data-app-main
                    className={
                        isModelViewerRoute
                            ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-0"
                            : "flex-1 overflow-y-auto bg-background p-4 md:p-6"
                    }
                >
                    <div
                        className={
                            isModelViewerRoute
                                ? "flex h-full min-h-0 w-full flex-1 bg-background"
                                : "mx-auto w-full max-w-7xl"
                        }
                    >
                        <Routes>
                            <Route path="/" element={<HomePage />} />
                            <Route path="/model-viewer" element={<ModelViewerApp />} />
                            <Route path="/map-viewer" element={<MapViewerApp />} />
                            <Route path="/map-viewer-2d" element={<MapViewer2DApp />} />
                            <Route path="/sprite-viewer" element={<SpriteViewerApp />} />
                            <Route path="/binary-viewer" element={<BinaryViewerApp />} />
                            <Route path="/animation-editor" element={<AnimationEditorApp />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </div>
                </main>
            </div>
        </div>
    );
}
