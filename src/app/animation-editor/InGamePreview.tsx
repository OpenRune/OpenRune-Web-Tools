"use client";

import type { RSModelMesh } from "@openrune/engine";
import { RSModelScene } from "@openrune/react";
import { GripHorizontal, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { Hint } from "../../components/ui/hint";

/** What the parent keeps the latest clean mesh in; `version` changes when it's rebuilt. */
export type PreviewMeshRef = { mesh: RSModelMesh | null; version: number };

const MIN_SIZE = 180;
const HEADER_HEIGHT = 26;

/**
 * A floating in-game preview: the model exactly as the client would draw it — no grid, no
 * overlays, no editor shading — following the animation live.
 *
 * The drawing is `@openrune/react`'s `RSModelScene`, the same thing behind `<RSModel>`, so this
 * window is the chrome and nothing else. It can't be `<RSModel>` itself: that starts from a model
 * id or definition, whereas the editor has already built the mesh and rebuilds it every frame —
 * handing over a definition would make the scene redo lighting and meshing work per frame that
 * the editor just did. `setMesh` is the way in for a caller that has a mesh in hand.
 *
 * The mesh arrives through a ref carrying a version number, checked on the scene's own render
 * loop, so a rebuild costs no React renders.
 */
export function InGamePreview({
    meshRef,
    onClose,
}: {
    meshRef: React.MutableRefObject<PreviewMeshRef>;
    onClose: () => void;
}): JSX.Element {
    const [position, setPosition] = useState({ x: 16, y: 16 });
    const [size, setSize] = useState({ width: 280, height: 280 });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<RSModelScene | null>(null);
    /** Which of the window's own drags is in progress, if any. */
    const windowDragRef = useRef<{ kind: "move" | "resize"; x: number; y: number } | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let lastVersion = -1;
        const scene = new RSModelScene(canvas, {
            // The client draws the model and nothing else.
            render: { renderMode: "solid", useColors: true, showGrid: false },
            onBeforeRender: () => {
                const current = meshRef.current;
                if (current.version === lastVersion) return;
                lastVersion = current.version;
                if (current.mesh) scene.setMesh(current.mesh);
            },
        });
        sceneRef.current = scene;

        return () => {
            scene.dispose();
            sceneRef.current = null;
        };
    }, [meshRef]);

    // Keep the drawing buffer in step with the window's size.
    useEffect(() => {
        sceneRef.current?.resize(
            size.width,
            size.height - HEADER_HEIGHT,
            window.devicePixelRatio || 1,
        );
    }, [size]);

    useEffect(() => {
        const onMove = (event: PointerEvent): void => {
            const drag = windowDragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            windowDragRef.current = { ...drag, x: event.clientX, y: event.clientY };
            if (drag.kind === "move") {
                setPosition((p) => ({ x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) }));
            } else {
                setSize((s) => ({
                    width: Math.max(MIN_SIZE, s.width + dx),
                    height: Math.max(MIN_SIZE, s.height + dy),
                }));
            }
        };
        const onUp = (): void => {
            windowDragRef.current = null;
        };
        // On the window, not the handles: a fast drag can outrun the element under the pointer.
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, []);

    return (
        <div
            data-testid="ingame-preview"
            className="absolute z-20 flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
            style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
        >
            <div
                className="flex h-[26px] shrink-0 cursor-move items-center gap-1 border-b border-border bg-card px-1.5 text-[11px] text-muted-foreground"
                onPointerDown={(e) => {
                    windowDragRef.current = { kind: "move", x: e.clientX, y: e.clientY };
                }}
            >
                <GripHorizontal className="size-3.5" />
                <span className="font-medium text-foreground">In-game</span>
                <span className="ml-auto">drag to orbit</span>
                <Hint heading="Close" label="Close in-game preview">
                    <button
                        type="button"
                        onClick={onClose}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="ml-1 shrink-0 hover:text-foreground"
                    >
                        <X className="size-3.5" />
                    </button>
                </Hint>
            </div>

            {/* Orbit and zoom come from the scene, which binds its own handlers to this canvas. */}
            <canvas ref={canvasRef} className="min-h-0 flex-1 touch-none" />

            <Hint
                heading="Resize"
                detail="Drag to resize the window"
                label="Resize in-game preview"
            >
                <button
                    type="button"
                    onPointerDown={(e) => {
                        windowDragRef.current = { kind: "resize", x: e.clientX, y: e.clientY };
                    }}
                    className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
                >
                    {/* Two short strokes, the usual corner grip. */}
                    <svg viewBox="0 0 16 16" className="size-full text-muted-foreground">
                        <path
                            d="M15 9 L9 15 M15 13 L13 15"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                        />
                    </svg>
                </button>
            </Hint>
        </div>
    );
}
