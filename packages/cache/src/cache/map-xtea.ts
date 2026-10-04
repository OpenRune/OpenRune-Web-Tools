import type { CacheInfo } from "./cache-info";

/**
 * OSRS map XTEA packing/decryption is obsolete at this revision and above
 * (see OpenRS2-FileStore `RemoveXteas.OBSOLETE_FROM_REVISION` / `PackMaps`).
 */
export const MAP_XTEA_OBSOLETE_FROM_REVISION = 237;

export type XteaMap = Map<number, number[]>;

export function cacheRequiresMapXteas(info: CacheInfo): boolean {
    return info.game === "oldschool" && info.revision < MAP_XTEA_OBSOLETE_FROM_REVISION;
}

type OpenRs2KeysJson = Record<string, number[]>;

type FileStoreXteaEntry = {
    mapsquare?: number;
    key?: number[];
};

/** Parses `keys.json` (OpenRS2 object form) or `xteas.json` (FileStore array form). */
export function parseXteaMapFromJsonText(text: string): XteaMap {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
        const map: XteaMap = new Map();
        for (const entry of parsed as FileStoreXteaEntry[]) {
            if (
                typeof entry?.mapsquare !== "number" ||
                !Array.isArray(entry.key) ||
                entry.key.length !== 4
            ) {
                continue;
            }
            map.set(entry.mapsquare, entry.key);
        }
        return map;
    }
    if (parsed && typeof parsed === "object") {
        const data = parsed as OpenRs2KeysJson;
        return new Map(Object.keys(data).map((key) => [parseInt(key, 10), data[key]!] as const));
    }
    return new Map();
}

export function parseXteaMapFromCacheFiles(files: Map<string, ArrayBuffer>): XteaMap {
    const buffer = files.get("keys.json") ?? files.get("xteas.json");
    if (!buffer) return new Map();
    try {
        return parseXteaMapFromJsonText(new TextDecoder().decode(buffer));
    } catch {
        return new Map();
    }
}
