"use client";

import type { CacheSystem } from "@openrune/cache";
import type { RSModelCamera, RSModelDefinition, RSModelRenderOptions } from "@openrune/engine";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useRSCache } from "./cache-context";
import { type LoadedSequence, loadModel, loadSequence } from "./loaders";
import { RSModelScene } from "./scene";

/** What a `ref` on `<RSModel>` gives you: play/pause, seeking, and the camera. */
export type RSModelHandle = {
    play(): void;
    pause(): void;
    toggle(): void;
    /** Jumps to a frame, wrapping round the ends. */
    seek(frame: number): void;
    /** `step(1)` for the next frame, `step(-1)` for the previous. */
    step(delta: number): void;
    readonly playing: boolean;
    readonly frame: number;
    /** How many frames the animation has, or 0 when there isn't one. */
    readonly length: number;
    getCamera(): RSModelCamera;
    setCamera(camera: Partial<RSModelCamera>): void;
    resetCamera(): void;
    setRenderOptions(options: Partial<RSModelRenderOptions>): void;
    /** The canvas itself, for screenshots or your own event handlers. */
    readonly canvas: HTMLCanvasElement | null;
    /** The scene underneath, for anything this handle doesn't cover. */
    readonly scene: RSModelScene | null;
};

export type RSModelProps = {
    /** Model id to read from the cache. Ignored when `model` is given. */
    id?: number;
    /** An already-decoded model, for anything that didn't come from a cache index. */
    model?: RSModelDefinition;
    /** Sequence id to play on it. Leave it off for a still model. */
    animation?: number;
    /** An already-loaded sequence, if you have one. Ignored when `animation` is given. */
    sequence?: LoadedSequence;
    /** Overrides the cache from `RSCacheProvider`. */
    cache?: CacheSystem;

    /** Plays as soon as an animation loads. Set false to hold still until you say otherwise. */
    autoPlay?: boolean;
    /** Starts over at the end. On by default. */
    loop?: boolean;
    /** Drag to orbit, wheel to zoom. On by default. */
    controls?: boolean;
    camera?: Partial<RSModelCamera>;
    render?: Partial<RSModelRenderOptions>;

    className?: string;
    style?: React.CSSProperties;
    /** Shown while decoding. */
    fallback?: React.ReactNode;
    /** Shown instead of the canvas when something fails to load. */
    errorFallback?: (error: Error) => React.ReactNode;

    onReady?: (info: { triangleCount: number; length: number }) => void;
    onError?: (error: Error) => void;
    onFrame?: (frame: number, length: number) => void;
};

/**
 * A RuneScape model on a canvas.
 *
 *     <RSModel id={65533} />
 *     <RSModel id={65533} animation={7570} />
 *
 * Fills whatever you put it in, so give the parent a size. Orbit and zoom are on by default;
 * turn them off with `controls={false}` and drive the camera yourself through a ref.
 */
export const RSModel = forwardRef<RSModelHandle, RSModelProps>(function RSModel(
    {
        id,
        model,
        animation,
        sequence,
        cache: cacheProp,
        autoPlay = true,
        loop = true,
        controls = true,
        camera,
        render,
        className,
        style,
        fallback,
        errorFallback,
        onReady,
        onError,
        onFrame,
    },
    ref,
) {
    const contextCache = useRSCache();
    const cache = cacheProp ?? contextCache;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sceneRef = useRef<RSModelScene | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [loading, setLoading] = useState(true);

    // Callbacks are read through a ref so a caller passing inline arrows doesn't tear the scene
    // down and rebuild it on every render.
    const handlers = useRef({ onReady, onError, onFrame });
    handlers.current = { onReady, onError, onFrame };

    useImperativeHandle(
        ref,
        (): RSModelHandle => ({
            play: () => sceneRef.current?.play(),
            pause: () => sceneRef.current?.pause(),
            toggle: () => sceneRef.current?.toggle(),
            seek: (frame) => sceneRef.current?.seek(frame),
            step: (delta) => sceneRef.current?.step(delta),
            get playing() {
                return sceneRef.current?.playing ?? false;
            },
            get frame() {
                return sceneRef.current?.frame ?? 0;
            },
            get length() {
                return sceneRef.current?.length ?? 0;
            },
            getCamera: () => sceneRef.current?.getCamera() ?? { yaw: 0, pitch: 0, zoom: 1 },
            setCamera: (next) => sceneRef.current?.setCamera(next),
            resetCamera: () => sceneRef.current?.resetCamera(),
            setRenderOptions: (options) => sceneRef.current?.setRenderOptions(options),
            get canvas() {
                return canvasRef.current;
            },
            get scene() {
                return sceneRef.current;
            },
        }),
        [],
    );

    // The scene owns a WebGL context, so it's built once and kept; content changes go through it
    // rather than through a remount.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const scene = new RSModelScene(canvas, {
            controls,
            camera,
            render,
            onFrame: (frame, length) => handlers.current.onFrame?.(frame, length),
        });
        sceneRef.current = scene;
        const unobserve = scene.observe(canvas.parentElement ?? canvas);

        return () => {
            unobserve();
            scene.dispose();
            sceneRef.current = null;
        };
        // Built once: the live props below are pushed in by the effects that follow.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        sceneRef.current?.setLooping(loop);
    }, [loop]);

    useEffect(() => {
        if (!render) return;
        sceneRef.current?.setRenderOptions(render);
        // A fresh object literal every render would loop; the values are what matter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [render?.renderMode, render?.useColors, render?.showGrid]);

    useEffect(() => {
        if (!camera) return;
        sceneRef.current?.setCamera(camera);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [camera?.yaw, camera?.pitch, camera?.zoom]);

    // ---- Model ----
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        if (model) {
            setError(null);
            setLoading(false);
            scene.setModel(model);
            handlers.current.onReady?.({
                triangleCount: scene.triangleCount,
                length: scene.length,
            });
            return;
        }
        if (id === undefined) return;
        if (!cache) {
            // Not an error: a provider higher up may still be opening one.
            setLoading(true);
            return;
        }

        setLoading(true);
        try {
            scene.setModel(loadModel(cache, id));
            setError(null);
            handlers.current.onReady?.({
                triangleCount: scene.triangleCount,
                length: scene.length,
            });
        } catch (err) {
            const failure = err instanceof Error ? err : new Error(String(err));
            setError(failure);
            handlers.current.onError?.(failure);
        } finally {
            setLoading(false);
        }
    }, [cache, id, model]);

    // ---- Animation ----
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        if (sequence) {
            scene.setSequence(sequence);
            if (autoPlay) scene.play();
            return;
        }
        if (animation === undefined) {
            scene.setSequence(null);
            return;
        }
        if (!cache) return;

        try {
            scene.setSequence(loadSequence(cache, animation));
            setError(null);
            if (autoPlay) scene.play();
        } catch (err) {
            const failure = err instanceof Error ? err : new Error(String(err));
            setError(failure);
            handlers.current.onError?.(failure);
        }
        // `id` is in here so reloading the model re-applies the animation to it.
    }, [cache, animation, sequence, autoPlay, id, model]);

    if (error && errorFallback) return <>{errorFallback(error)}</>;

    return (
        <div className={className} style={{ position: "relative", ...style }}>
            <canvas
                ref={canvasRef}
                style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }}
            />
            {loading && fallback ? fallback : null}
        </div>
    );
});
