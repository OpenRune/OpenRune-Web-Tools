"use client";

import type { CacheSystem } from "@openrune/cache";
import type { IndexedSprite, SpriteRgba } from "@openrune/sprite";
import React, { useEffect, useMemo, useRef } from "react";

import { useRSCache } from "./cache-context";
import { loadSprite, spriteToRgba } from "./sprite-loaders";

/** The transparency checkerboard, so a sprite's own transparent pixels read as transparent. */
const CHECKERBOARD = "repeating-conic-gradient(#2a2e37 0% 25%, #1a1d23 0% 50%)";

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

export type RSSpriteProps = {
    /** Sprite archive id. Ignored when `frames` is given. */
    id?: number;
    /** Already-decoded frames, for sprites that didn't come from a cache index. */
    frames?: IndexedSprite[];
    /** Which frame to draw, or `"all"` for every frame side by side. Defaults to the first. */
    frame?: number | "all";
    /** Overrides the cache from `RSCacheProvider`. */
    cache?: CacheSystem;

    /** Multiple of the sprite's own size. Defaults to 1, i.e. actual pixels. */
    scale?: number;
    /** Keeps pixels crisp when scaled up. On by default — these are pixel art. */
    pixelated?: boolean;
    /** `"checkerboard"`, any CSS colour, or `"none"` (the default). */
    background?: "checkerboard" | "none" | (string & {});

    className?: string;
    style?: React.CSSProperties;
    /** The canvas's accessible name. */
    alt?: string;
    fallback?: React.ReactNode;
    errorFallback?: (error: Error) => React.ReactNode;

    onReady?: (info: { width: number; height: number; frameCount: number }) => void;
    onError?: (error: Error) => void;
};

/**
 * A sprite from the cache, drawn at its own size.
 *
 *     <RSSprite id={498} />
 *     <RSSprite id={498} frame={2} scale={4} />
 *     <RSSprite id={498} frame="all" />
 *
 * Sizes itself to the sprite rather than filling its parent: a sprite has a real pixel size, and
 * stretching it to fit a box would only blur it. Use `scale` to make it bigger.
 */
export function RSSprite({
    id,
    frames: framesProp,
    frame = 0,
    cache: cacheProp,
    scale = 1,
    pixelated = true,
    background = "none",
    className,
    style,
    alt,
    fallback,
    errorFallback,
    onReady,
    onError,
}: RSSpriteProps): JSX.Element | null {
    const contextCache = useRSCache();
    const cache = cacheProp ?? contextCache;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const handlers = useRef({ onReady, onError });
    handlers.current = { onReady, onError };

    // Decoding is pure and cheap enough to do in render; failures come back as values rather
    // than being thrown or stashed in state, so nothing updates state while rendering.
    const sheet = useMemo((): { frames: IndexedSprite[] | null; error: Error | null } => {
        if (framesProp) return { frames: framesProp, error: null };
        if (id === undefined || !cache) return { frames: null, error: null };
        try {
            return { frames: loadSprite(cache, id), error: null };
        } catch (err) {
            return { frames: null, error: asError(err) };
        }
    }, [cache, framesProp, id]);

    // Separate, so picking a different frame doesn't decode the whole sheet again.
    const picture = useMemo((): { image: SpriteRgba | null; error: Error | null } => {
        if (!sheet.frames) return { image: null, error: null };
        try {
            return { image: spriteToRgba(sheet.frames, frame), error: null };
        } catch (err) {
            return { image: null, error: asError(err) };
        }
    }, [sheet.frames, frame]);

    const error = sheet.error ?? picture.error;
    const image = picture.image;

    useEffect(() => {
        if (error) handlers.current.onError?.(error);
    }, [error]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || !image || image.width === 0 || image.height === 0) return;

        canvas.width = image.width;
        canvas.height = image.height;
        context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
        handlers.current.onReady?.({
            width: image.width,
            height: image.height,
            frameCount: sheet.frames?.length ?? 0,
        });
    }, [image, sheet.frames]);

    if (error && errorFallback) return <>{errorFallback(error)}</>;
    if (!image) return <>{fallback ?? null}</>;

    return (
        <canvas
            ref={canvasRef}
            role="img"
            aria-label={alt ?? (id !== undefined ? `Sprite ${id}` : "Sprite")}
            className={className}
            style={{
                width: image.width * scale,
                height: image.height * scale,
                imageRendering: pixelated ? "pixelated" : undefined,
                ...(background === "none"
                    ? null
                    : background === "checkerboard"
                    ? { backgroundImage: CHECKERBOARD, backgroundSize: "8px 8px" }
                    : { background }),
                ...style,
            }}
        />
    );
}
