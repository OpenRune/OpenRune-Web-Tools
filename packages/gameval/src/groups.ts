/**
 * The gameval groups, mirroring `GameValGroupTypes` in OpenRune-FileStore.
 *
 * A gameval is the name the game's own source knew an id by — `sequences` 7570 being
 * `human_walk`, say. They live in their own cache index, one archive per group, one file per id,
 * so a name is a cheap lookup rather than something to keep in a spreadsheet alongside the cache.
 *
 * https://github.com/OpenRune/OpenRune-FileStore/blob/main/filestore/src/main/kotlin/dev/openrune/cache/gameval/GameValHandler.kt
 */

/**
 * The cache index gamevals live in.
 *
 * Kept here rather than added to `@openrune/cache`'s `IndexType`: the app imports that package's
 * built output, so a constant added to its source is `undefined` at runtime until someone
 * rebuilds it — a silent failure that reads as "this cache has no gamevals".
 */
export const GAMEVAL_INDEX = 24;

/** How a group's files are laid out — most are just a name, a few carry structure. */
export type GameValShape = "name" | "sprite" | "table" | "interface";

export type GameValGroupName =
    | "items"
    | "npcs"
    | "inv"
    | "varp"
    | "varbits"
    | "objects"
    | "sequences"
    | "spotanims"
    | "dbrows"
    | "dbtables"
    | "jingles"
    | "sprites"
    | "components"
    | "varcs";

export type GameValGroup = {
    name: GameValGroupName;
    /** Archive id inside the gameval index. */
    archive: number;
    /**
     * A second archive holding the same group in a newer layout. Used when `archive` is missing
     * or empty, which is how the handler tells the two interface formats apart.
     */
    archiveV2?: number;
    /** Earliest cache revision that carries this group, or -1 when every revision does. */
    revision: number;
    shape: GameValShape;
};

export const GAMEVAL_GROUPS: Record<GameValGroupName, GameValGroup> = {
    items: { name: "items", archive: 0, revision: -1, shape: "name" },
    npcs: { name: "npcs", archive: 1, revision: -1, shape: "name" },
    inv: { name: "inv", archive: 2, revision: -1, shape: "name" },
    varp: { name: "varp", archive: 3, revision: -1, shape: "name" },
    varbits: { name: "varbits", archive: 4, revision: -1, shape: "name" },
    objects: { name: "objects", archive: 6, revision: -1, shape: "name" },
    sequences: { name: "sequences", archive: 7, revision: -1, shape: "name" },
    spotanims: { name: "spotanims", archive: 8, revision: -1, shape: "name" },
    dbrows: { name: "dbrows", archive: 9, revision: -1, shape: "name" },
    dbtables: { name: "dbtables", archive: 10, revision: -1, shape: "table" },
    jingles: { name: "jingles", archive: 11, revision: -1, shape: "name" },
    sprites: { name: "sprites", archive: 12, revision: -1, shape: "sprite" },
    // 13 is the byte-indexed layout, 14 the short-indexed one that replaced it in revision 232.
    components: {
        name: "components",
        archive: 13,
        archiveV2: 14,
        revision: -1,
        shape: "interface",
    },
    varcs: { name: "varcs", archive: 15, revision: 232, shape: "name" },
};

export const GAMEVAL_GROUP_NAMES = Object.keys(GAMEVAL_GROUPS) as GameValGroupName[];
