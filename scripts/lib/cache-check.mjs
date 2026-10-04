/**
 * Checks https://archive.openrs2.org/caches.json for the current live OSRS cache, and persists
 * the last one we've already dumped so `auto-dump-and-upload.mjs` only kicks off a (long, full
 * map) dump when something has actually changed.
 *
 * caches.json is a flat array of every archived cache across every game/environment/language
 * OpenRS2 tracks — filtering to game="oldschool", environment="live", language="en" (and
 * excluding hidden entries) and taking the max `timestamp` is what picks out "the current live
 * OSRS game cache" (verified against a live fetch — new entries land weekly, on Wednesdays,
 * matching the real OSRS update cadence).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHES_URL = "https://archive.openrs2.org/caches.json";

export async function getLatestLiveCacheId() {
    const res = await fetch(CACHES_URL);
    if (!res.ok) {
        throw new Error(`Fetching ${CACHES_URL} failed: ${res.status} ${res.statusText}`);
    }
    const caches = await res.json();

    const live = caches.filter(
        (c) => c.game === "oldschool" && c.environment === "live" && c.language === "en" && !c.hidden,
    );
    if (live.length === 0) {
        throw new Error("No oldschool/live/en caches found in caches.json — unexpected API shape?");
    }

    live.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const latest = live[0];
    return { id: latest.id, timestamp: latest.timestamp };
}

export function readLastKnownId(path) {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, "utf-8")).id ?? null;
    } catch {
        return null;
    }
}

export function writeLastKnownId(path, id) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ id, updatedAt: new Date().toISOString() }, null, 2));
}
