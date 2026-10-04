import type { CacheSystem } from "@openrune/cache";

import { type GameValAny, decodeGameValFile } from "./decode";
import { GAMEVAL_GROUPS, GAMEVAL_INDEX, type GameValGroupName } from "./groups";

/**
 * Names for cache ids, read out of the gameval index.
 *
 * One of these belongs to one open cache, and lives as long as it does. A group is read the
 * first time something asks for it and kept from then on: a group is a single archive, so the
 * read is cheap, and doing it on demand means opening a cache costs nothing for the groups a
 * given screen never touches.
 *
 * Everything here answers "don't know" rather than throwing. Plenty of caches have no gameval
 * index at all, and a missing name is never a reason for a viewer to fail to open.
 */
export class GameValStore {
    private readonly groups = new Map<GameValGroupName, Map<number, GameValAny>>();

    constructor(private readonly cache: CacheSystem) {}

    /** Whether this cache carries gamevals at all. */
    get available(): boolean {
        return this.cache.indexExists(GAMEVAL_INDEX);
    }

    /** Every named id in a group, in id order. */
    all(group: GameValGroupName): GameValAny[] {
        return Array.from(this.load(group).values()).sort((a, b) => a.id - b.id);
    }

    /** One group as a map, for joining against a list of ids without a lookup per row. */
    map(group: GameValGroupName): Map<number, GameValAny> {
        return this.load(group);
    }

    get(group: GameValGroupName, id: number): GameValAny | undefined {
        return this.load(group).get(id);
    }

    /** The name for an id, or null when this cache doesn't have one. */
    nameOf(group: GameValGroupName, id: number): string | null {
        return this.load(group).get(id)?.name ?? null;
    }

    /** Ids whose name contains `query`, case-insensitively. An empty query matches nothing. */
    search(group: GameValGroupName, query: string): GameValAny[] {
        const needle = query.trim().toLowerCase();
        if (needle === "") return [];
        return this.all(group).filter((entry) => entry.name.toLowerCase().includes(needle));
    }

    private load(group: GameValGroupName): Map<number, GameValAny> {
        const cached = this.groups.get(group);
        if (cached) return cached;

        const entries = new Map<number, GameValAny>();
        // Cached either way: a cache with no gamevals shouldn't be re-checked on every lookup.
        this.groups.set(group, entries);

        const spec = GAMEVAL_GROUPS[group];
        if (!this.cache.indexExists(GAMEVAL_INDEX)) return entries;

        try {
            const index = this.cache.getIndex(GAMEVAL_INDEX);

            // A group with two layouts uses the newer archive when the older one isn't there.
            let archiveId = spec.archive;
            let interfaceV2 = false;
            if (spec.archiveV2 !== undefined) {
                const fileCount = index.archiveExists(archiveId)
                    ? index.getFileCount(archiveId)
                    : 0;
                if (fileCount === 0) {
                    archiveId = spec.archiveV2;
                    interfaceV2 = true;
                }
            }
            if (!index.archiveExists(archiveId)) return entries;

            const fileIds = index.getFileIds(archiveId);
            if (!fileIds) return entries;

            const archive = index.getArchive(archiveId);
            for (const fileId of fileIds) {
                const file = archive.getFile(fileId);
                if (!file) continue;
                const bytes = new Uint8Array(
                    file.data.buffer,
                    file.data.byteOffset,
                    file.data.byteLength,
                );
                const entry = decodeGameValFile(spec.shape, fileId, bytes, interfaceV2);
                if (entry) entries.set(entry.id, entry);
            }
        } catch {
            // An index that won't decode is the same as not having one: no names, no failure.
        }

        return entries;
    }
}
