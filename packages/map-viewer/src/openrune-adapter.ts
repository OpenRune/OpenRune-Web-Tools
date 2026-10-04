/**
 * The one integration point between this vendored copy of rs-map-viewer and the rest of
 * OpenRune-Editor: turning the cache file bytes the app already has (from its own folder/file
 * picker, see `src/context/cache-context.tsx`) into the `LoadedCache` this package's `MapViewer`
 * expects, instead of rs-map-viewer's own `fetch()`-based `Caches.ts` loader.
 *
 * `CacheFiles`'s constructor takes the exact same `Map<string, ArrayBuffer>` shape
 * `@openrune/cache`'s own `CacheFiles` does (same origin, near-identical fork) — nothing here
 * re-reads or re-decodes bytes, it just repackages the same entries into this package's types.
 */
import { CacheFiles } from "./rs/cache/CacheFiles";
import type { CacheInfo } from "./rs/cache/CacheInfo";
import type { LoadedCache, XteaMap } from "./mapviewer/Caches";

/**
 * Modern-OSRS placeholder metadata — the app doesn't currently read a `cache.json`-style
 * description of the opened cache, so this stands in for one. `revision` is set comfortably
 * past `MAP_XTEA_OBSOLETE_FROM_REVISION` so loc decode doesn't expect an xtea key by default,
 * matching how the app's cache-opening flow doesn't collect one either.
 */
const DEFAULT_CACHE_INFO: CacheInfo = {
    name: "cache",
    game: "oldschool",
    environment: "live",
    revision: 240,
    timestamp: new Date(0).toISOString(),
    size: 0,
};

export function createLoadedCache(
    entries: ReadonlyArray<readonly [string, ArrayBuffer]>,
    xteas: XteaMap = new Map(),
    info: Partial<CacheInfo> = {},
): LoadedCache {
    return {
        info: { ...DEFAULT_CACHE_INFO, ...info },
        type: "dat2",
        files: new CacheFiles(new Map(entries)),
        xteas,
    };
}
