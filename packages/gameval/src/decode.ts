import type { GameValShape } from "./groups";

/** A named id. Every group produces one of these per file; some carry more besides. */
export type GameValEntry = {
    id: number;
    name: string;
};

/** Sprites name a sheet plus the frame within it; a lone sprite has index -1. */
export type GameValSprite = GameValEntry & { index: number };

export type GameValTable = GameValEntry & { columns: { id: number; name: string }[] };

export type GameValInterface = GameValEntry & { components: { id: number; name: string }[] };

/**
 * Whatever a group decodes to. Every shape is a named id first, so `id` and `name` are always
 * there; narrow with `"columns" in entry` or `"components" in entry` for the rest.
 */
export type GameValAny = GameValEntry | GameValSprite | GameValTable | GameValInterface;

/** Reads the little the gameval files need: bytes, shorts, and NUL-terminated strings. */
class Reader {
    offset = 0;

    constructor(private readonly bytes: Uint8Array) {}

    get remaining(): number {
        return this.bytes.length - this.offset;
    }

    u8(): number {
        return this.bytes[this.offset++] ?? 0;
    }

    u16(): number {
        return (this.u8() << 8) | this.u8();
    }

    /** The byte at the cursor without moving it, or -1 at the end. */
    peek(): number {
        return this.offset < this.bytes.length ? this.bytes[this.offset] : -1;
    }

    /**
     * Latin-1 up to the next NUL, which is what the client encodes. An unterminated string runs
     * to the end of the file rather than throwing — a truncated name is still worth having.
     */
    string(): string {
        let end = this.offset;
        while (end < this.bytes.length && this.bytes[end] !== 0) end++;
        let out = "";
        for (let i = this.offset; i < end; i++) out += String.fromCharCode(this.bytes[i]);
        this.offset = end < this.bytes.length ? end + 1 : end;
        return out;
    }
}

const utf8 = new TextDecoder("utf-8");

/**
 * Turns one gameval file into its entry. `id` is the file's own id, which is the id being named.
 *
 * Empty or missing data gives nothing back rather than an entry with a blank name — a group with
 * holes in it is normal, and a nameless id is the same as no name at all.
 */
export function decodeGameValFile(
    shape: GameValShape,
    id: number,
    bytes: Uint8Array | null,
    /** True for the short-indexed interface layout (archive 14). */
    interfaceV2 = false,
): GameValAny | null {
    if (!bytes || bytes.length === 0) return null;
    const reader = new Reader(bytes);

    if (shape === "table") {
        reader.u8(); // Format version; only 1 exists.
        const name = reader.string();
        const columns: { id: number; name: string }[] = [];
        while (reader.remaining > 0) {
            if (reader.u8() === 0) break;
            columns.push({ id: columns.length, name: reader.string() });
        }
        return { id, name, columns } satisfies GameValTable;
    }

    if (shape === "interface") {
        const name = reader.string();
        const components: { id: number; name: string }[] = [];
        if (interfaceV2) {
            while (reader.remaining > 0) {
                const child = reader.u16();
                if (child === 0xffff) break;
                components.push({ id: child, name: reader.string() });
            }
        } else {
            while (reader.remaining > 0) {
                const child = reader.u8();
                // The list ends on 0xFF followed by a NUL; 0xFF on its own is a real child id.
                if (child === 0xff && reader.peek() === 0) break;
                const componentName = reader.string();
                if (componentName === "") break;
                components.push({ id: child, name: componentName });
            }
        }
        return { id, name, components } satisfies GameValInterface;
    }

    // Everything else is the whole file as the name.
    const text = utf8.decode(bytes);
    if (shape === "sprite") {
        const comma = text.indexOf(",");
        if (comma < 0) return { id, name: text, index: -1 } satisfies GameValSprite;
        const index = Number.parseInt(text.slice(comma + 1), 10);
        return {
            id,
            name: text.slice(0, comma),
            index: Number.isNaN(index) ? -1 : index,
        } satisfies GameValSprite;
    }
    return { id, name: text };
}
