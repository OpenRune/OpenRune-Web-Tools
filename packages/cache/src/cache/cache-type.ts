import type { CacheInfo } from "./cache-info";

/** "classic" is enumerated for completeness but has no reader implementation. */
export type CacheType = "classic" | "legacy" | "dat" | "dat2";

export function detectCacheType(cacheInfo: CacheInfo): CacheType {
    switch (cacheInfo.game) {
        case "classic":
            return "classic";
        case "runescape":
            if (cacheInfo.revision < 234) return "legacy";
            if (cacheInfo.revision < 410) return "dat";
            return "dat2";
        case "oldschool":
            return "dat2";
        default:
            throw new Error("Unknown game type: " + cacheInfo.game);
    }
}
