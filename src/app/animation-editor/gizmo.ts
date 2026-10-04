import { projectToScreen } from "./viewport-projection";

export type ScreenPoint = { x: number; y: number; depth: number };
export type Axis = "x" | "y" | "z";
export type WorldPoint = { x: number; y: number; z: number };

export const AXIS_COLORS: Record<Axis, string> = { x: "#ef4444", y: "#4ade80", z: "#60a5fa" };
export const AXIS_LABELS: Record<Axis, string> = { x: "X", y: "Y", z: "Z" };

/**
 * How close a click has to land, in screen pixels.
 *
 * Generous on purpose. A handle is a one-pixel line, and a miss falls through to orbiting the
 * camera — so aiming at a gizmo and spinning the view instead is the single most annoying thing
 * this can do. The hover highlight makes an impending miss visible before you commit.
 */
export const GIZMO_HIT_PX = 12;

/** What the gizmo is being drawn as, and what the pointer is doing to it. */
export type GizmoStyle = {
    /** The axis under the cursor, lit up so you can see what a click would grab. */
    hover: Axis | null;
    /** The axis being dragged. Everything else fades while one is held. */
    active: Axis | null;
};

/** Matches the Y-flip `buildRSModelMesh` applies when laying out GPU positions. */
function projectWorld(
    vp: Float32Array,
    p: WorldPoint,
    width: number,
    height: number,
): ScreenPoint | null {
    return projectToScreen(vp, p.x, -p.y, p.z, width, height);
}

function distanceToSegment(p: { x: number; y: number }, a: ScreenPoint, b: ScreenPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How solid an axis is drawn: full for the one in play, faded for the rest. */
function alphaFor(axis: Axis, style: GizmoStyle): number {
    if (style.active) return axis === style.active ? 1 : 0.15;
    if (style.hover) return axis === style.hover ? 1 : 0.55;
    return 0.9;
}

function widthFor(axis: Axis, style: GizmoStyle, base: number): number {
    if (axis === style.active) return base + 2;
    if (axis === style.hover) return base + 1.5;
    return base;
}

// ---- Translate and scale ------------------------------------------------------------------

export type TranslateHandle = { axis: Axis; start: ScreenPoint; end: ScreenPoint };

export function buildTranslateHandles(
    vp: Float32Array,
    pivot: WorldPoint,
    worldLength: number,
    width: number,
    height: number,
): { pivotScreen: ScreenPoint; handles: TranslateHandle[] } | null {
    const pivotScreen = projectWorld(vp, pivot, width, height);
    if (!pivotScreen) return null;

    const handles: TranslateHandle[] = [];
    for (const axis of ["x", "y", "z"] as const) {
        const target: WorldPoint = { ...pivot };
        target[axis] += worldLength;
        const end = projectWorld(vp, target, width, height);
        if (end) handles.push({ axis, start: pivotScreen, end });
    }
    return { pivotScreen, handles };
}

export function hitTestTranslateHandle(
    handles: TranslateHandle[],
    point: { x: number; y: number },
    threshold = GIZMO_HIT_PX,
): Axis | null {
    let best: { axis: Axis; dist: number } | null = null;
    for (const h of handles) {
        const dist = distanceToSegment(point, h.start, h.end);
        if (dist <= threshold && (!best || dist < best.dist)) best = { axis: h.axis, dist };
    }
    return best?.axis ?? null;
}

/**
 * Three arrows for translate, three boxed rods for scale — different shapes on purpose, so the
 * two aren't told apart only by what the sidebar happens to say.
 *
 * Axes are drawn far-to-near so the one pointing at you lands on top, and each is labelled at
 * its tip. An axis pointing away from the camera is dimmed, which is what tells you a gizmo is
 * facing away rather than just being short.
 */
export function drawTranslateHandles(
    ctx: CanvasRenderingContext2D,
    handles: TranslateHandle[],
    style: GizmoStyle,
    kind: "translate" | "scale" = "translate",
): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const h of [...handles].sort((a, b) => b.end.depth - a.end.depth)) {
        const dx = h.end.x - h.start.x;
        const dy = h.end.y - h.start.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // Pointing away from the camera reads as "behind", so it's drawn fainter.
        const facing = h.end.depth > h.start.depth ? 0.55 : 1;
        const capSize = 7;

        ctx.globalAlpha = alphaFor(h.axis, style) * facing;
        ctx.strokeStyle = AXIS_COLORS[h.axis];
        ctx.fillStyle = AXIS_COLORS[h.axis];
        ctx.lineWidth = widthFor(h.axis, style, 2.5);

        // The shaft stops short of the cap, so the two don't overlap into a blob.
        ctx.beginPath();
        ctx.moveTo(h.start.x, h.start.y);
        ctx.lineTo(h.end.x - ux * capSize * 0.8, h.end.y - uy * capSize * 0.8);
        ctx.stroke();

        if (kind === "translate") {
            ctx.beginPath();
            ctx.moveTo(h.end.x, h.end.y);
            ctx.lineTo(
                h.end.x - ux * capSize - uy * capSize * 0.5,
                h.end.y - uy * capSize + ux * capSize * 0.5,
            );
            ctx.lineTo(
                h.end.x - ux * capSize + uy * capSize * 0.5,
                h.end.y - uy * capSize - ux * capSize * 0.5,
            );
            ctx.closePath();
            ctx.fill();
        } else {
            const box = capSize * 0.8;
            ctx.beginPath();
            ctx.rect(h.end.x - box / 2, h.end.y - box / 2, box, box);
            ctx.fill();
        }

        // The letter sits past the cap, ringed in black so it reads over the model.
        const labelX = h.end.x + ux * 12;
        const labelY = h.end.y + uy * 12;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(AXIS_LABELS[h.axis], labelX, labelY);
        ctx.fillText(AXIS_LABELS[h.axis], labelX, labelY);
    }

    ctx.restore();
}

// ---- Rotate -------------------------------------------------------------------------------

export type RotateHandle = { axis: Axis; points: ScreenPoint[] };

export function buildRotateHandles(
    vp: Float32Array,
    pivot: WorldPoint,
    worldRadius: number,
    width: number,
    height: number,
    segments = 64,
): { pivotScreen: ScreenPoint; handles: RotateHandle[] } | null {
    const pivotScreen = projectWorld(vp, pivot, width, height);
    if (!pivotScreen) return null;

    const handles: RotateHandle[] = [];
    for (const axis of ["x", "y", "z"] as const) {
        const points: ScreenPoint[] = [];
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            const c = Math.cos(t) * worldRadius;
            const s = Math.sin(t) * worldRadius;
            const world: WorldPoint = { ...pivot };
            if (axis === "x") {
                world.y += c;
                world.z += s;
            } else if (axis === "y") {
                world.x += c;
                world.z += s;
            } else {
                world.x += c;
                world.y += s;
            }
            const screen = projectWorld(vp, world, width, height);
            if (screen) points.push(screen);
        }
        handles.push({ axis, points });
    }
    return { pivotScreen, handles };
}

export function hitTestRotateHandle(
    handles: RotateHandle[],
    point: { x: number; y: number },
    threshold = GIZMO_HIT_PX,
): Axis | null {
    let best: { axis: Axis; dist: number; depth: number } | null = null;
    for (const h of handles) {
        for (let i = 0; i < h.points.length - 1; i++) {
            const dist = distanceToSegment(point, h.points[i], h.points[i + 1]);
            if (dist > threshold) continue;
            const depth = (h.points[i].depth + h.points[i + 1].depth) / 2;
            // Ties go to the ring nearest the camera — the one you can actually see there.
            if (
                !best ||
                dist < best.dist - 2 ||
                (Math.abs(dist - best.dist) <= 2 && depth < best.depth)
            ) {
                best = { axis: h.axis, dist, depth };
            }
        }
    }
    return best?.axis ?? null;
}

/**
 * Three rings, with the half of each that curves behind the pivot drawn faintly.
 *
 * Without that, three overlapping circles are an unreadable tangle and there's no way to tell
 * which way round any of them goes — which is most of why rotate gizmos are confusing.
 */
export function drawRotateHandles(
    ctx: CanvasRenderingContext2D,
    handles: RotateHandle[],
    pivotScreen: ScreenPoint,
    style: GizmoStyle,
): void {
    ctx.save();
    ctx.lineCap = "round";

    for (const h of handles) {
        if (h.points.length < 2) continue;
        const alpha = alphaFor(h.axis, style);
        const lineWidth = widthFor(h.axis, style, 2);
        ctx.strokeStyle = AXIS_COLORS[h.axis];

        for (let i = 0; i < h.points.length - 1; i++) {
            const a = h.points[i];
            const b = h.points[i + 1];
            const behind = (a.depth + b.depth) / 2 > pivotScreen.depth;
            ctx.globalAlpha = alpha * (behind ? 0.22 : 1);
            ctx.lineWidth = behind ? lineWidth * 0.8 : lineWidth;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
    }

    ctx.restore();
}

// ---- Shared furniture ---------------------------------------------------------------------

/** The point everything turns and slides around. Easy to lose track of without a marker. */
export function drawGizmoPivot(ctx: CanvasRenderingContext2D, pivot: ScreenPoint): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
    ctx.restore();
}

/**
 * The value being dragged, pinned beside the pivot.
 *
 * Dragging a handle otherwise tells you nothing about how far you've gone until you stop and
 * read the sidebar.
 */
export function drawGizmoReadout(
    ctx: CanvasRenderingContext2D,
    pivot: ScreenPoint,
    axis: Axis,
    text: string,
): void {
    ctx.save();
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = 5;
    const width = ctx.measureText(text).width + padding * 2;
    const height = 18;
    const x = pivot.x + 14;
    const y = pivot.y - 14 - height / 2;

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
    ctx.strokeStyle = AXIS_COLORS[axis];
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + padding, y + height / 2);
    ctx.restore();
}
