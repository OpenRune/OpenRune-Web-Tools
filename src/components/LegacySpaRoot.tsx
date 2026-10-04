"use client";

import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";

import App from "../App";
import { CacheProvider } from "../context/cache-context";
import { SettingsProvider } from "../context/settings-context";
import { ShellPreferencesProvider } from "../context/shell-preferences-context";
import { WorkspacesProvider } from "../context/workspaces-context";
import { WorkspaceCacheSync } from "./WorkspaceCacheSync";
import { TooltipProvider } from "./ui/tooltip";

export function LegacySpaRoot(): JSX.Element {
    useEffect(() => {
        window.wallpaperPropertyListener = {
            applyGeneralProperties: (properties: any) => {
                if (properties.fps) {
                    window.wallpaperFpsLimit = properties.fps;
                }
            },
        };
    }, []);

    return (
        <BrowserRouter>
            <SettingsProvider>
                <ShellPreferencesProvider>
                    <WorkspacesProvider>
                        <CacheProvider>
                            <WorkspaceCacheSync />
                            {/* One provider for the whole app, so `<Hint>` works on any screen and every
                  tooltip shares the same delay. */}
                            <TooltipProvider delayDuration={250} disableHoverableContent>
                                <App />
                            </TooltipProvider>
                        </CacheProvider>
                    </WorkspacesProvider>
                </ShellPreferencesProvider>
            </SettingsProvider>
        </BrowserRouter>
    );
}
