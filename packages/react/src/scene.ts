import {
    type PosedModel,
    type RSModelCamera,
    type RSModelDefinition,
    type RSModelMesh,
    type RSModelRenderOptions,
    RSModelRenderer,
    animateOldStyleFrame,
    animateSkeletalFrame,
    applyPoseToDefinition,
    buildLabelGroups,
    buildRSModelMesh,
    createPosedModel,
    lightRSModel,
    resetPose,
} from "@openrune/engine";

import type { LoadedSequence } from "./loaders";

/** The client advances animation one unit per 20ms render cycle, not per 600ms game tick. */
const TICK_MS = 20;

export const DEFAULT_CAMERA: RSModelCamera = { yaw: Math.PI * 0.25, pitch: -0.35, zoom: 2.4 };

export const DEFAULT_RENDER_OPTIONS: RSModelRenderOptions = {
    renderMode: "solid",
    useColors: true,
    showGrid: false,
};

export type RSModelSceneOptions = {
    /** Drag to orbit, wheel to zoom. On by default. */
    controls?: boolean;
    camera?: Partial<RSModelCamera>;
    /** Solid/wireframe, colour, ground grid — see `RSModelRenderOptions`. */
    render?: Partial<RSModelRenderOptions>;
    /** Called after every frame change, for a progress bar or a frame counter. */
    onFrame?: (frame: number, length: number) => void;
    /**
     * Called once per rendered frame, before drawing. Somewhere to push a mesh you maintain
     * yourself — see `setMesh` — without running a second animation loop alongside this one.
     */
    onBeforeRender?: () => void;
};

/**
 * A model on a canvas, optionally animated — everything `<RSModel>` does, with no React in it.
 *
 * Owns its own render loop: the canvas keeps drawing so an orbit drag stays smooth whether or not
 * an animation is running. Animation advances on wall-clock time, so a dropped frame doesn't slow
 * the movement down.
 */
export class RSModelScene {
    private readonly renderer: RSModelRenderer;
    private camera: RSModelCamera;
    private renderOptions: RSModelRenderOptions;
    private readonly onFrameChange: ((frame: number, length: number) => void) | undefined;
    private readonly onBeforeRender: (() => void) | undefined;

    private def: RSModelDefinition | null = null;
    private pose: PosedModel | null = null;
    private vertexLabelGroups: number[][] = [];
    private faceLabelGroups: number[][] = [];

    private sequence: LoadedSequence | null = null;
    private currentFrame = 0;
    private isPlaying = false;
    private looping = true;
    private accumulatedMs = 0;
    private lastTime: number | null = null;

    private rafId: number | null = null;
    private controlled: HTMLElement | null = null;
    private drag: { x: number; y: number } | null = null;
    private disposed = false;

    constructor(
        readonly canvas: HTMLCanvasElement,
        options: RSModelSceneOptions = {},
    ) {
        this.renderer = new RSModelRenderer(canvas);
        this.camera = { ...DEFAULT_CAMERA, ...options.camera };
        this.renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options.render };
        this.renderer.setOptions(this.renderOptions);
        this.onFrameChange = options.onFrame;
        this.onBeforeRender = options.onBeforeRender;
        if (options.controls !== false) this.attachControls(canvas);
        this.start();
    }

    // ---- Content ----------------------------------------------------------------------

    /** Shows a model. Any sequence already set is re-applied to it. */
    setModel(def: RSModelDefinition | null): void {
        this.def = def;
        if (!def) {
            this.pose = null;
            return;
        }
        this.pose = createPosedModel(def);
        this.vertexLabelGroups = buildLabelGroups(def.vertexSkins, def.vertexCount);
        this.faceLabelGroups = buildLabelGroups(def.faceSkins, def.faceCount);
        this.applyFrame();
    }

    /** Plays a sequence on whatever model is loaded, or `null` to go back to the bind pose. */
    setSequence(sequence: LoadedSequence | null): void {
        this.sequence = sequence;
        this.currentFrame = 0;
        this.accumulatedMs = 0;
        this.lastTime = null;
        this.applyFrame();
    }

    /**
     * Draws a mesh you've built yourself instead of one derived from `setModel`.
     *
     * For callers that already have a mesh in hand — an editor rebuilding one per frame, say —
     * where going through a model would only repeat work that's already been done. Don't mix it
     * with `setModel` on the same scene: whichever runs last wins.
     */
    setMesh(mesh: RSModelMesh): void {
        this.renderer.setMesh(mesh);
    }

    /** How many triangles the model draws, or 0 when there's nothing loaded. */
    get triangleCount(): number {
        return this.def?.faceCount ?? 0;
    }

    // ---- Playback ---------------------------------------------------------------------

    get playing(): boolean {
        return this.isPlaying;
    }

    get frame(): number {
        return this.currentFrame;
    }

    /** How many frames the sequence has, or 0 when there isn't one. */
    get length(): number {
        return this.sequence?.length ?? 0;
    }

    play(): void {
        if (!this.sequence) return;
        this.isPlaying = true;
        this.lastTime = null;
    }

    pause(): void {
        this.isPlaying = false;
    }

    toggle(): void {
        if (this.isPlaying) this.pause();
        else this.play();
    }

    /** Jumps to a frame, wrapping round the ends. Doesn't change whether it's playing. */
    seek(frame: number): void {
        const length = this.length;
        if (length === 0) return;
        this.currentFrame = ((Math.round(frame) % length) + length) % length;
        this.accumulatedMs = 0;
        this.applyFrame();
    }

    /** Steps by whole frames — `step(1)` for the next one, `step(-1)` for the previous. */
    step(delta: number): void {
        this.seek(this.currentFrame + delta);
    }

    /** When off, playback stops on the last frame instead of starting over. */
    setLooping(looping: boolean): void {
        this.looping = looping;
    }

    // ---- Camera -----------------------------------------------------------------------

    getCamera(): RSModelCamera {
        return { ...this.camera };
    }

    setCamera(camera: Partial<RSModelCamera>): void {
        this.camera = { ...this.camera, ...camera };
    }

    resetCamera(): void {
        this.camera = { ...DEFAULT_CAMERA };
    }

    /** Solid/wireframe, colour and the ground grid. */
    setRenderOptions(options: Partial<RSModelRenderOptions>): void {
        this.renderOptions = { ...this.renderOptions, ...options };
        this.renderer.setOptions(this.renderOptions);
    }

    /** Sizes the drawing buffer. Call it whenever the canvas's box changes. */
    resize(width: number, height: number, pixelRatio = 1): void {
        this.renderer.resize(width, height, pixelRatio);
    }

    /**
     * Keeps the canvas sized to an element. Returns the stop function, so a caller that manages
     * its own layout can skip this entirely.
     */
    observe(element: HTMLElement): () => void {
        const resize = (): void => {
            const rect = element.getBoundingClientRect();
            this.resize(rect.width, rect.height, window.devicePixelRatio || 1);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        return () => observer.disconnect();
    }

    // ---- Orbit controls ---------------------------------------------------------------

    attachControls(element: HTMLElement): void {
        this.detachControls();
        this.controlled = element;
        element.addEventListener("pointerdown", this.onPointerDown);
        element.addEventListener("pointermove", this.onPointerMove);
        element.addEventListener("pointerup", this.onPointerUp);
        element.addEventListener("pointercancel", this.onPointerUp);
        element.addEventListener("wheel", this.onWheel, { passive: false });
    }

    detachControls(): void {
        const element = this.controlled;
        if (!element) return;
        element.removeEventListener("pointerdown", this.onPointerDown);
        element.removeEventListener("pointermove", this.onPointerMove);
        element.removeEventListener("pointerup", this.onPointerUp);
        element.removeEventListener("pointercancel", this.onPointerUp);
        element.removeEventListener("wheel", this.onWheel);
        this.controlled = null;
        this.drag = null;
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        this.drag = { x: event.clientX, y: event.clientY };
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.drag) return;
        const dx = event.clientX - this.drag.x;
        const dy = event.clientY - this.drag.y;
        this.drag = { x: event.clientX, y: event.clientY };
        this.camera.yaw += dx * 0.01;
        this.camera.pitch = Math.max(-1.5, Math.min(1.5, this.camera.pitch + dy * 0.01));
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        this.drag = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    };

    private readonly onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        this.camera.zoom = Math.max(
            0.3,
            Math.min(10, this.camera.zoom * (1 + event.deltaY * 0.001)),
        );
    };

    // ---- Loop -------------------------------------------------------------------------

    dispose(): void {
        this.disposed = true;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.detachControls();
        this.renderer.dispose();
    }

    private start(): void {
        const tick = (now: number): void => {
            if (this.disposed) return;
            this.onBeforeRender?.();
            this.advance(now);
            this.renderer.setCamera(this.camera);
            this.renderer.render();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    /** How long the current frame is held, in milliseconds. */
    private holdMs(): number {
        if (!this.sequence) return TICK_MS;
        if (this.sequence.kind === "skeletal") return TICK_MS;
        return Math.max(1, this.sequence.seqType.frameLengths[this.currentFrame] ?? 1) * TICK_MS;
    }

    private advance(now: number): void {
        if (!this.isPlaying || !this.sequence) return;
        if (this.lastTime === null) this.lastTime = now;
        this.accumulatedMs += now - this.lastTime;
        this.lastTime = now;

        const length = this.sequence.length;
        let changed = false;
        let hold = this.holdMs();
        while (this.accumulatedMs >= hold) {
            this.accumulatedMs -= hold;
            const next = this.currentFrame + 1;
            if (next >= length && !this.looping) {
                this.currentFrame = length - 1;
                this.isPlaying = false;
                changed = true;
                break;
            }
            this.currentFrame = next % length;
            changed = true;
            hold = this.holdMs();
        }
        if (changed) this.applyFrame();
    }

    /** Poses the model for the current frame and hands the renderer a fresh mesh. */
    private applyFrame(): void {
        const def = this.def;
        if (!def) return;

        let posed = def;
        if (this.sequence && this.pose) {
            resetPose(this.pose, def);
            if (this.sequence.kind === "skeletal") {
                animateSkeletalFrame(
                    def,
                    this.pose,
                    this.sequence.base,
                    this.sequence.seq,
                    this.faceLabelGroups,
                    this.currentFrame,
                );
            } else {
                const frame = this.sequence.frames.get(this.currentFrame);
                if (frame) {
                    animateOldStyleFrame(
                        this.pose,
                        this.vertexLabelGroups,
                        this.faceLabelGroups,
                        frame,
                    );
                }
            }
            posed = applyPoseToDefinition(def, this.pose);
        }

        this.renderer.setMesh(buildRSModelMesh(posed, lightRSModel(posed)));
        this.onFrameChange?.(this.currentFrame, this.length);
    }
}
