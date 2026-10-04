/**
 * Zero-dependency `.env` loader — reads KEY=VALUE lines into `process.env`, skipping blank
 * lines and `#` comments. Never overwrites a variable already set in the real environment
 * (cron/systemd env takes priority over the file). No `dotenv` package needed for this.
 */
import { existsSync, readFileSync } from "node:fs";

export function loadEnv(path = ".env") {
    if (!existsSync(path)) return;

    for (const line of readFileSync(path, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;

        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        process.env[key] ??= value;
    }
}
