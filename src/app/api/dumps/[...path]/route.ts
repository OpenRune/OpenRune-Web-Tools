import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only convenience: serves `scripts/dump-map-tiles.mjs`'s output (`<repo root>/dumps/`) over
 * plain HTTP, so `<ImageRSMapViewer urlBase="/api/dumps">` can load tiles straight from a local
 * dump without copying them into `public/` or standing up a separate static server. Point a real
 * CDN/bucket at the dumped files for production instead of relying on this route.
 *
 * Every path segment is restricted to a safe character set (no `..`, no separators) and the file
 * must end in `.webp` — what keeps a crafted path from escaping the dumps directory.
 */
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not available in production" }, { status: 404 });
    }

    const { path: segments } = await params;
    const last = segments[segments.length - 1] ?? "";
    if (!last.endsWith(".webp")) {
        return NextResponse.json({ error: "Only .webp files are served" }, { status: 400 });
    }
    const checkedSegments = [...segments.slice(0, -1), last.slice(0, -".webp".length)];
    if (checkedSegments.length === 0 || !checkedSegments.every((s) => SAFE_SEGMENT.test(s))) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "dumps", ...segments);

    try {
        const bytes = await fs.readFile(filePath);
        return new NextResponse(new Uint8Array(bytes), {
            headers: { "content-type": "image/webp", "cache-control": "no-store" },
        });
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
