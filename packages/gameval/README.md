# @openrune/gameval

Names for cache ids. A gameval is what the game's own source knew an id by — sequence `7570`
being `inferno_exit` — stored in its own cache index, one archive per group, one file per id.

Ported from [`GameValHandler.kt`](https://github.com/OpenRune/OpenRune-FileStore/blob/main/filestore/src/main/kotlin/dev/openrune/cache/gameval/GameValHandler.kt).

```ts
import { CacheSystem } from "@openrune/cache";
import { GameValStore } from "@openrune/gameval";

const names = new GameValStore(cache);

names.nameOf("sequences", 7570); // "inferno_exit"
names.get("items", 4151); // { id: 4151, name: "abyssal_whip" }
names.search("npcs", "goblin"); // every npc whose name contains "goblin"
names.all("objects"); // the whole group, in id order
names.available; // false on a cache with no gameval index
```

One store belongs to one open cache and lives as long as it does. A group is read the first time
something asks for it and kept from then on — a group is a single archive, so the read is cheap,
and doing it on demand means opening a cache costs nothing for the groups you never touch.

Nothing here throws. Plenty of caches have no gameval index at all, and a missing name is never a
reason for a viewer to fail to open: lookups just come back empty.

## Groups

`items`, `npcs`, `inv`, `varp`, `varbits`, `objects`, `sequences`, `spotanims`, `dbrows`,
`dbtables`, `jingles`, `sprites`, `components`, `varcs`.

Most decode to a plain name. `sprites` also carry the frame index within a sheet; `dbtables` carry
their columns; `components` carry their child components, in either the byte-indexed layout or the
short-indexed one that replaced it in revision 232 — whichever the cache has.

```ts
const table = names.get("dbtables", 2);
if (table && "columns" in table) console.log(table.columns);
```

## Decoding a file yourself

```ts
import { decodeGameValFile } from "@openrune/gameval";

decodeGameValFile("name", 7570, bytes); // { id: 7570, name: "inferno_exit" }
```
