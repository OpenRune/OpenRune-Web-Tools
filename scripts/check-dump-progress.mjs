#!/usr/bin/env node
/**
 * Run this from a second terminal while `dump-map-tiles.mjs` (directly, or via
 * `auto-dump-and-upload.mjs`) is in progress elsewhere — a full-map dump can take a long time,
 * and its own progress bar only exists in the terminal that started it.
 *
 * Reads the same `progress.json` that script writes (see its `--progress` flag/doc comment) and
 * prints a snapshot: state, percent, current/total, last item, elapsed time, and a naive ETA.
 * Also checks whether the PID in the file is still alive — a `state: "running"` file whose
 * process is gone means it crashed without reaching its own error handler (e.g. killed, OOM).
 *
 * Usage: node scripts/check-dump-progress.mjs [--progress dumps/progress.json] [--watch]
 */
import { existsSync, readFileSync } from "node:fs";
import { makeProgressBar } from "./lib/progress-bar.mjs";

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

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function printSnapshot(progress, bar) {
    if (progress.state === "error") {
        console.log(`Dump FAILED: ${progress.error}`);
        console.log(`Last updated: ${progress.updatedAt}`);
        return;
    }

    const now = Date.now();
    const elapsedMs = now - new Date(progress.startedAt).getTime();
    const rate = progress.current / (elapsedMs / 1000 || 1);
    const remaining = progress.total - progress.current;
    const etaMs = rate > 0 ? (remaining / rate) * 1000 : 0;

    bar.set(progress.current, progress.lastItem || "");

    if (progress.state === "running" && !isPidAlive(progress.pid)) {
        console.log(
            `\nWARNING: process ${progress.pid} is no longer running, but progress.json still says "running" — it likely crashed without cleaning up.`,
        );
    } else if (progress.state === "running") {
        console.log(`\nElapsed: ${formatDuration(elapsedMs)} — ETA: ~${formatDuration(etaMs)}`);
    } else if (progress.state === "done") {
        console.log(`\nDone — wrote ${progress.written} tiles in ${formatDuration(elapsedMs)}.`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const progressPath = args.progress ?? "dumps/progress.json";
    const watch = args.watch === "true";

    if (!existsSync(progressPath)) {
        console.log(`No progress file at ${progressPath} — no dump has run yet (or --out/--progress differs from here).`);
        return;
    }

    if (!watch) {
        const progress = JSON.parse(readFileSync(progressPath, "utf-8"));
        const bar = makeProgressBar(progress.total ?? 0);
        printSnapshot(progress, bar);
        return;
    }

    const first = JSON.parse(readFileSync(progressPath, "utf-8"));
    const bar = makeProgressBar(first.total ?? 0);

    while (true) {
        const progress = JSON.parse(readFileSync(progressPath, "utf-8"));
        console.clear();
        printSnapshot(progress, bar);
        if (progress.state !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
