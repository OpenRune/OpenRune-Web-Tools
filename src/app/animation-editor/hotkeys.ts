export type HotkeyActionId =
    | "play_pause"
    | "frame_prev"
    | "frame_next"
    | "frame_start"
    | "frame_end"
    | "keyframe_next"
    | "keyframe_prev"
    | "grab"
    | "rotate"
    | "scale"
    | "axis_x"
    | "axis_y"
    | "axis_z"
    | "confirm"
    | "cancel"
    | "undo"
    | "redo"
    | "insert_keyframe"
    | "delete_keyframe"
    | "clear_location"
    | "clear_rotation"
    | "clear_scale"
    | "box_select"
    | "select_mode_vertex"
    | "select_mode_edge"
    | "select_mode_face"
    | "select_all"
    | "deselect_all"
    | "select_more"
    | "select_less"
    | "toggle_xray"
    | "toggle_vertices"
    | "toggle_sidebar"
    | "frame_all";

export type HotkeyAction = {
    id: HotkeyActionId;
    label: string;
    category: string;
    defaultCombo: string;
};

/** Defaults follow Blender's keymap so the editor feels familiar out of the box. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
    { id: "play_pause", label: "Play / pause", category: "Playback", defaultCombo: "Space" },
    { id: "frame_prev", label: "Previous frame", category: "Playback", defaultCombo: "ArrowLeft" },
    { id: "frame_next", label: "Next frame", category: "Playback", defaultCombo: "ArrowRight" },
    {
        id: "frame_start",
        label: "Jump to start",
        category: "Playback",
        defaultCombo: "Shift+ArrowLeft",
    },
    {
        id: "frame_end",
        label: "Jump to end",
        category: "Playback",
        defaultCombo: "Shift+ArrowRight",
    },
    {
        id: "keyframe_next",
        label: "Jump to next keyframe",
        category: "Playback",
        defaultCombo: "ArrowUp",
    },
    {
        id: "keyframe_prev",
        label: "Jump to previous keyframe",
        category: "Playback",
        defaultCombo: "ArrowDown",
    },
    { id: "grab", label: "Grab / move", category: "Transform", defaultCombo: "G" },
    { id: "rotate", label: "Rotate", category: "Transform", defaultCombo: "R" },
    { id: "scale", label: "Scale", category: "Transform", defaultCombo: "S" },
    { id: "axis_x", label: "Constrain to X", category: "Transform", defaultCombo: "X" },
    { id: "axis_y", label: "Constrain to Y", category: "Transform", defaultCombo: "Y" },
    { id: "axis_z", label: "Constrain to Z", category: "Transform", defaultCombo: "Z" },
    { id: "confirm", label: "Confirm transform", category: "Transform", defaultCombo: "Enter" },
    { id: "cancel", label: "Cancel / exit mode", category: "General", defaultCombo: "Escape" },
    { id: "undo", label: "Undo", category: "General", defaultCombo: "Ctrl+Z" },
    { id: "redo", label: "Redo", category: "General", defaultCombo: "Ctrl+Shift+Z" },
    { id: "insert_keyframe", label: "Insert keyframe", category: "Keyframes", defaultCombo: "I" },
    {
        id: "delete_keyframe",
        label: "Delete keyframe",
        category: "Keyframes",
        defaultCombo: "Alt+I",
    },
    { id: "clear_location", label: "Clear location", category: "Keyframes", defaultCombo: "Alt+G" },
    { id: "clear_rotation", label: "Clear rotation", category: "Keyframes", defaultCombo: "Alt+R" },
    { id: "clear_scale", label: "Clear scale", category: "Keyframes", defaultCombo: "Alt+S" },
    { id: "box_select", label: "Select tool", category: "Selection", defaultCombo: "B" },
    // Blender's 1 / 2 / 3 edit-mode element switches.
    {
        id: "select_mode_vertex",
        label: "Select vertices",
        category: "Selection",
        defaultCombo: "1",
    },
    { id: "select_mode_edge", label: "Select edges", category: "Selection", defaultCombo: "2" },
    { id: "select_mode_face", label: "Select faces", category: "Selection", defaultCombo: "3" },
    { id: "select_all", label: "Select all vertices", category: "Selection", defaultCombo: "A" },
    { id: "deselect_all", label: "Deselect all", category: "Selection", defaultCombo: "Alt+A" },
    { id: "select_more", label: "Grow selection", category: "Selection", defaultCombo: "Ctrl++" },
    { id: "select_less", label: "Shrink selection", category: "Selection", defaultCombo: "Ctrl+-" },
    { id: "toggle_xray", label: "Toggle x-ray", category: "Selection", defaultCombo: "Alt+Z" },
    // Blender's "show overlays" toggle, which is what hides its vertex points.
    {
        id: "toggle_vertices",
        label: "Toggle vertex points",
        category: "View",
        defaultCombo: "Alt+Shift+Z",
    },
    { id: "toggle_sidebar", label: "Toggle sidebar", category: "View", defaultCombo: "N" },
    { id: "frame_all", label: "Frame all (reset view)", category: "View", defaultCombo: "Home" },
];

export type HotkeyBindings = Record<HotkeyActionId, string>;

const STORAGE_KEY = "openrune.animation-editor.hotkeys";
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

export function defaultBindings(): HotkeyBindings {
    return Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.id, a.defaultCombo])) as HotkeyBindings;
}

export function loadBindings(): HotkeyBindings {
    const defaults = defaultBindings();
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
        for (const action of HOTKEY_ACTIONS) {
            const value = parsed[action.id];
            if (typeof value === "string" && value.length > 0) defaults[action.id] = value;
        }
    } catch {
        // Corrupt/unavailable storage just means defaults.
    }
    return defaults;
}

export function saveBindings(bindings: HotkeyBindings): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch {
        // Storage may be unavailable (private mode / quota); bindings still work for the session.
    }
}

/** Physical key for letters/digits so Shift/Alt don't change which key we think was pressed. */
function normalizeKey(event: KeyboardEvent): string {
    // Fold the number-row and numpad +/- together, so "Ctrl +" means the same either way —
    // and doesn't change identity depending on whether Shift was needed to type it.
    if (event.code === "Equal" || event.code === "NumpadAdd") return "+";
    if (event.code === "Minus" || event.code === "NumpadSubtract") return "-";
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
    if (event.key === " " || event.code === "Space") return "Space";
    return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

/** Canonical "Ctrl+Alt+Shift+Key" string for an event, or null for a bare modifier press. */
export function comboFromEvent(event: KeyboardEvent): string | null {
    if (MODIFIER_KEYS.has(event.key)) return null;
    const key = normalizeKey(event);
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    // Shift is how you type "+" on most layouts, so it can't also be part of that combo's
    // identity — otherwise Ctrl+Shift+= wouldn't match a "Ctrl +" binding.
    if (event.shiftKey && key !== "+" && key !== "-") parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(key);
    return parts.join("+");
}

/**
 * Whether a combo is held with Ctrl/Alt/Meta. Those can't be confused with typing, so they stay
 * live while a field has focus — and they're the ones that collide with browser shortcuts, so
 * they need their default suppressed whether or not the action did anything.
 */
export function comboHasModifier(combo: string): boolean {
    return combo.startsWith("Ctrl+") || combo.startsWith("Alt+") || combo.startsWith("Meta+");
}

const KEY_GLYPHS: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Escape: "Esc",
    Enter: "Enter",
    Space: "Space",
};

export function formatCombo(combo: string): string {
    return combo
        .split("+")
        .map((part) => KEY_GLYPHS[part] ?? part)
        .join(" ");
}
