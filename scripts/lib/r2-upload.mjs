/**
 * Uploads a known list of files to a Cloudflare R2 bucket. R2 speaks the S3 API, so this is
 * plain `@aws-sdk/client-s3` pointed at R2's S3-compatible endpoint — no Cloudflare-specific
 * SDK needed.
 *
 * Takes an explicit file list (relative to `dumpsDir`) rather than walking/diffing the whole
 * `dumps/` tree itself — `dump-map-tiles.mjs` already knows exactly which files it wrote this
 * run (see its `state.writtenFiles`, surfaced via `progress.json`), which is cheaper and more
 * accurate than re-deriving the same answer here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const CONTENT_TYPES = {
    ".webp": "image/webp",
    ".json": "application/json",
};

function contentTypeFor(path) {
    const dot = path.lastIndexOf(".");
    return CONTENT_TYPES[path.slice(dot)] ?? "application/octet-stream";
}

export function makeR2Client(env) {
    return new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
    });
}

/**
 * Uploads every path in `relativePaths` (relative to `dumpsDir`) to `env.R2_BUCKET_NAME`, under
 * the same relative path as the object key. Returns the count actually uploaded.
 */
export async function uploadFiles(dumpsDir, relativePaths, env, { onProgress } = {}) {
    const client = makeR2Client(env);
    let uploaded = 0;

    for (const relativePath of relativePaths) {
        const key = relativePath.split("\\").join("/"); // R2 keys are always forward-slash, even from a Windows path.join
        const body = readFileSync(join(dumpsDir, relativePath));

        await client.send(
            new PutObjectCommand({
                Bucket: env.R2_BUCKET_NAME,
                Key: key,
                Body: body,
                ContentType: contentTypeFor(relativePath),
            }),
        );

        uploaded++;
        onProgress?.(uploaded, relativePaths.length, key);
    }

    return uploaded;
}
