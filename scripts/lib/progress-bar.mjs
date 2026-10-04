/**
 * A single updating terminal line (`\r`, no newline) — call `update()` on every processed
 * item, done or not. Shared between `dump-map-tiles.mjs` (the live run) and
 * `check-dump-progress.mjs --watch` (redrawing from a polled `progress.json` in a second
 * terminal), so both render identically.
 */
export function makeProgressBar(total) {
    const width = 30;
    const maxSuffixLength = 60;
    let current = 0;
    let lastLineLength = 0;

    function render(suffix) {
        const pct = total === 0 ? 1 : current / total;
        const filled = Math.min(width, Math.round(width * pct));
        const bar = "=".repeat(filled) + " ".repeat(width - filled);
        const trimmedSuffix =
            suffix && suffix.length > maxSuffixLength
                ? suffix.slice(0, maxSuffixLength - 1) + "…"
                : suffix;
        const line = `[${bar}] ${current}/${total} (${Math.round(pct * 100)}%)${trimmedSuffix ? " " + trimmedSuffix : ""}`;
        process.stdout.write("\r" + line.padEnd(lastLineLength));
        lastLineLength = line.length;
    }

    return {
        update(suffix) {
            current++;
            render(suffix);
        },
        /** Redraw at an explicit position without advancing `current` — used by `--watch`. */
        set(position, suffix) {
            current = position;
            render(suffix);
        },
        done() {
            render("done");
            process.stdout.write("\n");
        },
    };
}
