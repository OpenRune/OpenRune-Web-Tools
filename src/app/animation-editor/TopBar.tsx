"use client";

import { Bone, Box, Clapperboard } from "lucide-react";
import React from "react";

import { Hint } from "../../components/ui/hint";
import { Sygnet } from "../../components/ui/svg/Sygnet";
import { cn } from "../../util/cn";

export type Workspace = "rigging" | "animation" | "modeling";

const WORKSPACES: {
    id: Workspace;
    label: string;
    icon: typeof Bone;
    enabled: boolean;
    detail: string;
}[] = [
    {
        id: "rigging",
        label: "Rigging",
        icon: Bone,
        enabled: true,
        detail: "Label the model's geometry and build the movements an animation drives",
    },
    {
        id: "animation",
        label: "Animation",
        icon: Clapperboard,
        enabled: true,
        detail: "Pick an animation and key it against the rig on the model",
    },
    {
        id: "modeling",
        label: "Modeling",
        icon: Box,
        enabled: false,
        detail: "Editing the geometry itself — not here yet",
    },
];

/** Blender's workspace bar: each tab swaps the editor over to the tools for that job. */
export function TopBar({
    workspace,
    onChange,
    menus,
    actions,
}: {
    workspace: Workspace;
    onChange: (workspace: Workspace) => void;
    /** Application menus, sitting beside the logo the way a menu bar does. */
    menus?: React.ReactNode;
    /** Right-aligned controls — cache actions live here, like Blender's top bar. */
    actions?: React.ReactNode;
}): JSX.Element {
    return (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2">
            <Sygnet className="mr-1 size-5 shrink-0" aria-label="OpenRune" role="img" />
            {menus ? <div className="mr-1 flex items-center gap-0.5">{menus}</div> : null}
            {WORKSPACES.map((tab) => {
                const Icon = tab.icon;
                const active = workspace === tab.id;
                return (
                    <Hint
                        key={tab.id}
                        side="bottom"
                        heading={
                            tab.enabled ? `${tab.label} workspace` : `${tab.label} — coming soon`
                        }
                        detail={tab.detail}
                    >
                        <button
                            type="button"
                            disabled={!tab.enabled}
                            onClick={() => onChange(tab.id)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                                active
                                    ? "border-[#e87d0d] bg-background text-foreground"
                                    : "border-transparent text-muted-foreground",
                                tab.enabled
                                    ? "hover:text-foreground"
                                    : "cursor-not-allowed opacity-40",
                            )}
                        >
                            <Icon className="size-3.5" />
                            {tab.label}
                            {!tab.enabled ? (
                                <span className="text-[9px] uppercase">soon</span>
                            ) : null}
                        </button>
                    </Hint>
                );
            })}
            {actions ? <div className="ml-auto flex items-center gap-2 py-1">{actions}</div> : null}
        </div>
    );
}
