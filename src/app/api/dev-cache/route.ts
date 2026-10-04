import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only convenience: serves a cache folder from disk so the editor can load it without a
 * folder picker. Point `OPENRUNE_DEV_CACHE_DIR` at a cache directory in `.env.local`.
 *
 * Disabled in production builds, and only ever reads `main_file_cache.*` names directly inside
 * the configured folder — the name pattern is what keeps a crafted `?file=` from escaping it.
 */
const CACHE_FILE_PATTERN = /^main_file_cache\.[a-z0-9]+$/i;

function devCacheDir(): string | null {
    if (process.env.NODE_ENV === "production") return null;
    const dir = process.env.OPENRUNE_DEV_CACHE_DIR?.trim();
    return dir ? dir : null;
}

export async function GET(request: Request): Promise<Response> {
    const dir = devCacheDir();
    if (!dir) {
        return NextResponse.json({ error: "OPENRUNE_DEV_CACHE_DIR is not set" }, { status: 404 });
    }

    const file = new URL(request.url).searchParams.get("file");

    if (!file) {
        try {
            const names = (await fs.readdir(dir))
                .filter((name) => CACHE_FILE_PATTERN.test(name))
                .sort();
            if (names.length === 0) {
                return NextResponse.json(
                    { error: `No main_file_cache.* files in ${dir}` },
                    { status: 404 },
                );
            }
            return NextResponse.json({ dir, files: names });
        } catch {
            return NextResponse.json({ error: `Can't read ${dir}` }, { status: 404 });
        }
    }

    if (!CACHE_FILE_PATTERN.test(file)) {
        return NextResponse.json(
            { error: "Only main_file_cache.* files are served" },
            { status: 400 },
        );
    }

    try {
        const bytes = await fs.readFile(path.join(dir, file));
        return new NextResponse(new Uint8Array(bytes), {
            headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
        });
    } catch {
        return NextResponse.json({ error: `Can't read ${file}` }, { status: 404 });
    }
}
