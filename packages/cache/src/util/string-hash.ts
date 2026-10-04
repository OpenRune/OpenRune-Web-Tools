/** Dan Bernstein's djb2, modified to start from 0 instead of 5381 — used by dat2 archive/file names. */
export function hashDjb2(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash = hash & hash;
    }
    return hash;
}

/** Pre-dat2 name hash used by legacy/dat archives. */
export function hashOld(name: string): number {
    const upper = name.toUpperCase();
    let hash = 0;
    for (let i = 0; i < upper.length; i++) {
        hash = (hash * 61 + upper.charCodeAt(i) - 32) | 0;
    }
    return hash;
}
