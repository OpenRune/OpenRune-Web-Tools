/**
 * Remembers the last cache folder the user picked (via the File System Access API) so it can be
 * silently re-read on the next visit instead of re-prompting a multi-file select every time.
 * Chromium-only (Tauri's WebView2 on Windows included); callers should feature-detect and fall
 * back to a plain `<input type="file" webkitdirectory>` where it's unavailable.
 */
import { isTauri } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir, readFile } from "@tauri-apps/plugin-fs";

export type CacheFileEntry = readonly [string, ArrayBuffer];

/** Whether we're running inside the desktop shell, where a saved path can be read directly. */
export function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && isTauri();
}

/**
 * Reads every `main_file_cache.*` file directly under an absolute directory path, via Tauri's fs
 * plugin. Unlike the File System Access API, this works from a plain remembered path string —
 * no directory handle or re-grant prompt needed.
 */
export async function readCacheEntriesFromPath(dirPath: string): Promise<CacheFileEntry[]> {
    const dirEntries = await readDir(dirPath);
    const files = dirEntries.filter(
        (entry) => entry.isFile && entry.name.startsWith("main_file_cache"),
    );
    return Promise.all(
        files.map(async (entry) => {
            const bytes = await readFile(await join(dirPath, entry.name));
            return [
                entry.name,
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ] as const;
        }),
    );
}

const DB_NAME = "openrune-cache-handles";
const STORE_NAME = "handles";
const HANDLE_KEY = "lastCacheDirectory";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveCacheDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function getSavedCacheDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return handle ?? null;
}

export type DevCache = { dir: string; files: string[] };

/**
 * Dev-only: checks whether the local server is serving a cache folder (see
 * `OPENRUNE_DEV_CACHE_DIR`). Returns null whenever it isn't available, including in production.
 */
export async function probeDevCache(): Promise<DevCache | null> {
    try {
        const response = await fetch("/api/dev-cache");
        if (!response.ok) return null;
        const body = (await response.json()) as Partial<DevCache>;
        return Array.isArray(body.files) && body.files.length > 0
            ? { dir: body.dir ?? "", files: body.files }
            : null;
    } catch {
        return null;
    }
}

export async function fetchDevCacheEntries(files: string[]): Promise<CacheFileEntry[]> {
    return Promise.all(
        files.map(async (name) => {
            const response = await fetch(`/api/dev-cache?file=${encodeURIComponent(name)}`);
            if (!response.ok) throw new Error(`Dev cache: couldn't read ${name}`);
            return [name, await response.arrayBuffer()] as const;
        }),
    );
}

/** Reads every `main_file_cache.*` file directly under a directory handle. */
export async function readCacheEntriesFromDirectory(
    dirHandle: FileSystemDirectoryHandle,
): Promise<CacheFileEntry[]> {
    const entries: CacheFileEntry[] = [];
    for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind !== "file" || !name.startsWith("main_file_cache")) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        entries.push([name, await file.arrayBuffer()]);
    }
    return entries;
}
