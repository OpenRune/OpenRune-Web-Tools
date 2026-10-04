"use client";

import type { CacheSystem } from "@openrune/cache";
import React, { useEffect, useMemo, useState } from "react";

import { useRSCache } from "./cache-context";
import {
    type BinaryKind,
    binaryMediaType,
    loadBinary,
    sniffBinary,
    toHexPreview,
} from "./sprite-loaders";

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

export type RSBinaryProps = {
    /** Archive id in the cache's binary index. Ignored when `bytes` is given. */
    id?: number;
    /** File within that archive. Nearly all of them hold exactly one, so this defaults to 0. */
    file?: number;
    /** Bytes you already have, instead of an id. */
    bytes?: Uint8Array;
    /** Overrides the cache from `RSCacheProvider`. */
    cache?: CacheSystem;

    className?: string;
    style?: React.CSSProperties;
    alt?: string;
    fallback?: React.ReactNode;
    errorFallback?: (error: Error) => React.ReactNode;
    /**
     * What to show for a file that isn't a picture. The default is the first 64 bytes as hex,
     * which at least says what you're looking at.
     */
    renderUnknown?: (info: { bytes: Uint8Array; length: number; hex: string }) => React.ReactNode;

    onReady?: (info: { kind: BinaryKind; length: number; bytes: Uint8Array }) => void;
    onError?: (error: Error) => void;
};

/**
 * A file out of the cache's binary index.
 *
 *     <RSBinary id={814} />
 *
 * That index is a grab-bag — login-screen backgrounds, the huffman chat table, whatever a server
 * has added — so there's nothing but the bytes to go on. Pictures are shown as pictures; anything
 * else falls to `renderUnknown`.
 */
export function RSBinary({
    id,
    file = 0,
    bytes: bytesProp,
    cache: cacheProp,
    className,
    style,
    alt,
    fallback,
    errorFallback,
    renderUnknown,
    onReady,
    onError,
}: RSBinaryProps): JSX.Element | null {
    const contextCache = useRSCache();
    const cache = cacheProp ?? contextCache;
    const [url, setUrl] = useState<string | null>(null);

    const handlers = React.useRef({ onReady, onError });
    handlers.current = { onReady, onError };

    const loaded = useMemo((): {
        bytes: Uint8Array | null;
        kind: BinaryKind;
        error: Error | null;
    } => {
        try {
            const bytes =
                bytesProp ?? (id !== undefined && cache ? loadBinary(cache, id, file) : null);
            return { bytes, kind: bytes ? sniffBinary(bytes) : "unknown", error: null };
        } catch (err) {
            return { bytes: null, kind: "unknown", error: asError(err) };
        }
    }, [bytesProp, cache, file, id]);

    // Object URLs are a resource: one per picture, revoked when it's replaced or unmounted.
    useEffect(() => {
        const mediaType = loaded.bytes ? binaryMediaType(loaded.kind) : null;
        if (!loaded.bytes || !mediaType) {
            setUrl(null);
            return;
        }
        const next = URL.createObjectURL(new Blob([loaded.bytes], { type: mediaType }));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [loaded]);

    useEffect(() => {
        if (loaded.error) handlers.current.onError?.(loaded.error);
        else if (loaded.bytes) {
            handlers.current.onReady?.({
                kind: loaded.kind,
                length: loaded.bytes.length,
                bytes: loaded.bytes,
            });
        }
    }, [loaded]);

    if (loaded.error && errorFallback) return <>{errorFallback(loaded.error)}</>;
    if (!loaded.bytes) return <>{fallback ?? null}</>;

    if (url) {
        return (
            <img
                src={url}
                alt={alt ?? (id !== undefined ? `Binary archive ${id}` : "Binary archive")}
                className={className}
                style={style}
            />
        );
    }

    const hex = toHexPreview(loaded.bytes);
    if (renderUnknown) {
        return <>{renderUnknown({ bytes: loaded.bytes, length: loaded.bytes.length, hex })}</>;
    }
    return (
        <p
            className={className}
            style={{ fontFamily: "monospace", wordBreak: "break-all", ...style }}
        >
            {hex}
            {loaded.bytes.length > 64 ? " …" : ""}
        </p>
    );
}
