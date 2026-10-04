"use client";

import type { CacheSystem } from "@openrune/cache";
import React, { createContext, useContext } from "react";

const RSCacheContext = createContext<CacheSystem | null>(null);

/**
 * Makes one open cache available to every `<RSModel>` beneath it, so they only need an id.
 *
 * Optional — a component can always be handed a `cache` prop instead, which wins over this.
 */
export function RSCacheProvider({
    cache,
    children,
}: {
    cache: CacheSystem | null;
    children: React.ReactNode;
}): JSX.Element {
    return <RSCacheContext.Provider value={cache}>{children}</RSCacheContext.Provider>;
}

/** The cache from the nearest provider, or null when there isn't one. */
export function useRSCache(): CacheSystem | null {
    return useContext(RSCacheContext);
}
