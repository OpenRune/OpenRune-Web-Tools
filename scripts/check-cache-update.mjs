#!/usr/bin/env node
/**
 * Manual sanity check — prints the current live OSRS cache id (from archive.openrs2.org) next
 * to the last one this repo actually dumped, and whether they differ. Not part of the cron
 * path (`auto-dump-and-upload.mjs` does this same check itself); this is just for eyeballing
 * it. Needs no `.env`/secrets — it's a single public HTTP GET.
 *
 * Usage: node scripts/check-cache-update.mjs [--state state/last-cache-id.json]
 */
import { getLatestLiveCacheId, readLastKnownId } from "./lib/cache-check.mjs";

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        args[key] = next && !next.startsWith("--") ? next : "true";
        if (next && !next.startsWith("--")) i++;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const statePath = args.state ?? "state/last-cache-id.json";

    const [latest, lastKnown] = [await getLatestLiveCacheId(), readLastKnownId(statePath)];

    console.log(`Latest live oldschool/en cache: id=${latest.id} (${latest.timestamp})`);
    console.log(`Last known dumped cache id:     ${lastKnown ?? "(none yet)"}`);
    console.log(latest.id === lastKnown ? "Up to date — nothing to dump." : "Update available.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
