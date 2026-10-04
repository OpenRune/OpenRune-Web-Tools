"use client";

import { type ArchiveFile, CacheFiles, CacheSystem, ConfigType, IndexType } from "@openrune/cache";
import {
    type PosedModel,
    type RSModelCamera,
    type RSModelDefinition,
    type RSModelMesh,
    type RSModelRenderMode,
    RSModelRenderer,
    SeqBase,
    SeqFrame,
    SeqTransformType,
    SeqType,
    type SkeletalBase,
    type SkeletalSeq,
    animateOldStyleFrame,
    animateSkeletalFrame,
    applyPoseToDefinition,
    buildLabelGroups,
    buildRSModelMesh,
    createPosedModel,
    decodeRSModel,
    decodeSeqBase,
    decodeSeqFrame,
    decodeSeqType,
    decodeSkeletalSeq,
    lightRSModel,
    peekSeqFrameBaseId,
    peekSkeletalSeqBaseId,
    resetPose,
} from "@openrune/engine";
import {
    Bone,
    BoxSelect,
    Check,
    Diamond,
    Download,
    Eye,
    EyeOff,
    FileDown,
    File as FileIcon,
    Focus,
    FolderOpen,
    Move,
    Pause,
    Pencil,
    PictureInPicture2,
    Play,
    Plus,
    RotateCcw,
    RotateCw,
    Scale3d,
    Search,
    Settings,
    SkipBack,
    SkipForward,
    Tag,
    Trash2,
    Upload,
    Wand2,
    X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { useCache } from "../../context/cache-context";
import { useWorkspaces } from "../../context/workspaces-context";
import { type CacheFileEntry, useCacheDirectory } from "../../hooks/useCacheDirectory";
import { cn } from "../../util/cn";
import {
    MODEL_FORMATS,
    type ModelFormat,
    downloadExport,
    exportModel,
    finalizeImportedModel,
    formatFromFileName,
    importModel,
    mergeModels,
} from "../../util/model-io";
import { decodeAnimPack } from "../../util/model-io/anim-pack";
import { type BundlePlan, type FrameTarget, planBundle } from "../../util/model-io/seq-bundle";
import { AiPanel } from "./AiPanel";
import { DopeSheet, type DopeSheetRow, TRACK_LABEL_PX, TRACK_TRAILING_PX } from "./DopeSheet";
import { ExportBundleDialog } from "./ExportBundleDialog";
import { HistoryMenu } from "./HistoryMenu";
import { InGamePreview, type PreviewMeshRef } from "./InGamePreview";
import { SeqConfigEditor } from "./SeqConfigEditor";
import { SettingsPanel } from "./SettingsPanel";
import { Timeline } from "./Timeline";
import { TopBar, type Workspace } from "./TopBar";
import type { LabelFacts, SceneFacts } from "./ai/context";
import type { ActionResult, AiActions } from "./ai/tools";
import {
    AXIS_LABELS,
    type Axis,
    type RotateHandle,
    type ScreenPoint,
    type TranslateHandle,
    buildRotateHandles,
    buildTranslateHandles,
    drawGizmoPivot,
    drawGizmoReadout,
    drawRotateHandles,
    drawTranslateHandles,
    hitTestRotateHandle,
    hitTestTranslateHandle,
} from "./gizmo";
import {
    type EditorSnapshot,
    type History,
    canRedo,
    canUndo,
    captureSeqConfig,
    cloneEdits,
    cloneMaya,
    emptyHistory,
    pushHistory,
    restoreSeqConfig,
} from "./history";
import {
    type HotkeyActionId,
    type HotkeyBindings,
    comboFromEvent,
    comboHasModifier,
    defaultBindings,
    formatCombo,
    loadBindings,
    saveBindings,
} from "./hotkeys";
import {
    type BoneGroup,
    type ColorGroup,
    type DepthBuffer,
    boundsOfVertices,
    buildDepthBuffer,
    buildEdgeList,
    buildVertexAdjacency,
    distanceToSegment,
    filterFacesByLabel,
    flattenLighting,
    groupVerticesByBone,
    groupVerticesByFaceColor,
    growSelection,
    isDepthVisible,
    makeTranslucent,
    nextFreeLabel,
    pointInTriangle,
    shrinkSelection,
} from "./mesh-tools";
import { MOTION_PRESETS, type PresetAxis, buildPresetKeys } from "./motion-presets";
import { useAiAssistant } from "./useAiAssistant";
import { computeViewProjection, projectToScreen } from "./viewport-projection";

/** Blender's signature accents: orange for selected/active, blue for the current frame. */
const BLENDER_ORANGE = "#e87d0d";
const BLENDER_BLUE = "#5680c2";

type TransformKind = "translate" | "rotate" | "scale";

/**
 * A Blender-style modal transform (G/R/S): mouse movement drives the armed group's value along
 * one axis until confirmed (click / Enter) or cancelled (right-click / Esc, which restores the
 * pre-modal edit exactly, including "no edit at all").
 */
type ModalTransform = {
    group: number;
    kind: TransformKind;
    axis: Axis;
    original: { x: number; y: number; z: number };
    previousEdit: { x: number; y: number; z: number } | undefined;
    anchorX: number;
};

type GizmoDrawState =
    | { kind: "translate"; group: number; pivotScreen: ScreenPoint; handles: TranslateHandle[] }
    | { kind: "scale"; group: number; pivotScreen: ScreenPoint; handles: TranslateHandle[] }
    | { kind: "rotate"; group: number; pivotScreen: ScreenPoint; handles: RotateHandle[] };

type LinearGizmoDrag = {
    group: number;
    axis: Axis;
    startValue: number;
    startX: number;
    startY: number;
    dirX: number;
    dirY: number;
    unitsPerPixel: number;
};

type GizmoDragState =
    | ({ kind: "translate" } & LinearGizmoDrag)
    | ({ kind: "scale" } & LinearGizmoDrag)
    | {
          kind: "rotate";
          group: number;
          axis: Axis;
          startValue: number;
          pivotScreen: ScreenPoint;
          startAngle: number;
      };

/** How many raw scale units (0-255, 128 = 1x) a full-length scale handle represents. */
const SCALE_RANGE_PER_HANDLE = 128;

/** Distinct, readable colours cycled across custom movements — used consistently in the
 * outliner, the dope sheet rows, and the vertex overlay highlight. */
const GROUP_COLORS = [
    "#f472b6",
    "#60a5fa",
    "#4ade80",
    "#facc15",
    "#a78bfa",
    "#2dd4bf",
    "#f87171",
    "#fb923c",
];

const MOVEMENT_TYPE_ICONS: Record<number, typeof Move> = {
    [SeqTransformType.TRANSLATE]: Move,
    [SeqTransformType.ROTATE]: RotateCw,
    [SeqTransformType.SCALE]: Scale3d,
};

/** Raw RS rotation units (0-255) map onto degrees via the engine's 2048-entry SINE table:
 * `angle = (raw & 0xff) * 8`, and 2048 of those fixed-point units is a full 360° turn. */
const DEGREES_PER_UNIT = 360 / 256;

function rawToDegrees(raw: number): number {
    return ((((raw & 0xff) * DEGREES_PER_UNIT) % 360) + 360) % 360;
}

function degreesToRaw(degrees: number): number {
    return Math.round(degrees / DEGREES_PER_UNIT) & 0xff;
}

const TRANSFORM_TYPE_NAMES: Record<number, string> = {
    [SeqTransformType.ORIGIN]: "ORIGIN",
    [SeqTransformType.TRANSLATE]: "TRANSLATE",
    [SeqTransformType.ROTATE]: "ROTATE",
    [SeqTransformType.SCALE]: "SCALE",
    [SeqTransformType.ALPHA]: "ALPHA",
    [SeqTransformType.LIGHT]: "LIGHT",
};

/** Gizmo handle length/radius, relative to the model's bounding radius. */
const GIZMO_SIZE_FACTOR = 0.4;

/**
 * Bone weighting is built and works, but it's off for now: the skeleton's own shape lives in
 * the sequence files this editor can't write yet, so a rig made here can't be animated here.
 * Flip this back to true to bring the tab back — nothing else needs changing.
 */
const BONES_TAB_ENABLED = false;

/** What a click picks. Vertices stay the selection itself — RS labels are per-vertex — so edge
 * and face modes are ways of grabbing whole groups of vertices at once. */
type SelectElement = "vertex" | "edge" | "face";

/** How close a click has to land, in screen pixels, to grab a vertex or an edge. */
const PICK_RADIUS = 10;

/** Every vertex in screen space, with a flag for the ones that can actually be seen. */
type Projection = { x: Float32Array; y: Float32Array; depth: Float32Array; ok: Uint8Array };

/** Pointer travel below this is a click, not an orbit. */
const CLICK_SLOP = 4;

/**
 * Depth tolerance for "is this vertex in front of the surface", as a fraction of the model's
 * radius. Wide enough that a vertex doesn't fail against its own face — the raster samples cell
 * centres, not exact points — and tight enough that the far side of a thin limb can't leak
 * through. Shared so the vertex overlay and the marquee always agree on what's visible.
 */
const DEPTH_BIAS_FACTOR = 0.01;

/**
 * Custom movements are numbered well above any sequence's own transform groups (a `SeqBase`
 * holds at most 255), so a rig stays valid whichever sequence you load next — and can be built
 * with no sequence loaded at all, since labels live on the model, not the animation.
 */
const CUSTOM_GROUP_ID_BASE = 1000;

/** Stands in when there is no frame to read a transform type from, purely for naming an undo entry. */
const EMPTY_BASE = new SeqBase(-1, 0, [], []);

const MOVEMENT_TYPES = [
    { value: SeqTransformType.TRANSLATE, label: "Translate" },
    { value: SeqTransformType.ROTATE, label: "Rotate" },
    { value: SeqTransformType.SCALE, label: "Scale" },
] as const;

type SidebarTab = "animations" | "keyframe" | "config" | "labels" | "ai";

/**
 * How long a brand-new animation is, and how long each of its frames holds, in client ticks.
 *
 * It starts at its full length rather than asking first: an empty frame costs nothing, and
 * trimming the end back on the timeline is easier than guessing a number up front.
 */
const NEW_ANIM_FRAMES = 50;
const NEW_ANIM_FRAME_LENGTH = 3;

/** The longest an animation can be made here. */
const MAX_ANIM_FRAMES = 512;

/** The id a sequence made here carries — no cache sequence can have it. */
const NEW_SEQ_ID = -1;

/** How many search results the animation list draws before it just says how many more there are. */
const ANIM_LIST_LIMIT = 200;

/** How many suggestions drop down under the animation search box. */
const ANIM_SUGGESTION_LIMIT = 8;

/** TEMPORARY: the scene the "Test scene" toolbar button jumps to while the editor is in progress. */
const TEST_MODEL_ID = 65533;
const TEST_SEQ_NAME = "inferno_exit";

/**
 * How well a sequence answers what's been typed, lowest first. A name you've started typing
 * beats one that merely contains the text somewhere, and an id typed in full beats both — that's
 * someone who already knows which sequence they want.
 */
/**
 * What to actually match a typed query against.
 *
 * Gameval names are all underscored — `inferno_exit`, `human_walk` — and nobody types them that
 * way. A space stands in for an underscore, so "inferno exit" finds it. Length is preserved, so
 * the highlight still lines up with the name's own characters.
 */
function searchQuery(raw: string): string {
    return raw.trim().toLowerCase().replace(/ /g, "_");
}

/** Picks the typed part of a suggestion out in the accent colour, so why it matched is obvious. */
function highlightMatch(text: string, query: string): React.ReactNode {
    if (query === "") return text;
    const at = text.toLowerCase().indexOf(query);
    if (at < 0) return text;
    return (
        <>
            {text.slice(0, at)}
            <span className="font-medium text-[#e87d0d]">{text.slice(at, at + query.length)}</span>
            {text.slice(at + query.length)}
        </>
    );
}

function rankSequenceMatch(row: { id: number; name: string | null }, query: string): number {
    const id = String(row.id);
    const name = row.name?.toLowerCase() ?? "";
    if (id === query) return 0;
    if (name.startsWith(query)) return 1;
    if (id.startsWith(query)) return 2;
    if (name.includes(query)) return 3;
    return 4;
}

type ModelState =
    | { status: "empty" }
    | { status: "loading" }
    | { status: "ready"; triangleCount: number }
    | { status: "error"; message: string };

type SeqState =
    | { status: "empty" }
    | { status: "loading" }
    | { status: "ready"; kind: "old"; frameCount: number }
    | { status: "ready"; kind: "skeletal"; duration: number; boneCount: number }
    | { status: "error"; message: string };

type CustomGroup = {
    id: number;
    type: SeqTransformType;
    label: number;
    name: string;
    color: string;
    vertexIndices: number[];
};

/** A vertex label the model actually carries, with how many vertices wear it. */
type ModelLabel = { label: number; vertexCount: number };

type LabelRow = {
    label: number;
    name: string;
    /** Whether the name is one someone chose, rather than the generated `L<id>`. */
    named: boolean;
    color: string | null;
    vertexCount: number;
    group: CustomGroup | null;
};

/**
 * One row per label on the model, whether it came from the cache or was created here. Labels
 * nobody has named get a generated `L<id>` so they can still be picked out, previewed and
 * renamed — a model's rig is usually all unnamed labels until you start working on it. Named
 * rows sort first: the ones you've deliberately set up are the ones you keep coming back to.
 */
function buildLabelRows(
    modelLabels: readonly ModelLabel[],
    customGroups: readonly CustomGroup[],
    labelNames: ReadonlyMap<number, string>,
): LabelRow[] {
    const groupByLabel = new Map<number, CustomGroup>();
    for (const g of customGroups) if (!groupByLabel.has(g.label)) groupByLabel.set(g.label, g);

    const counts = new Map<number, number>();
    for (const l of modelLabels) counts.set(l.label, l.vertexCount);
    // A movement whose vertices have since been re-labelled still deserves a row.
    for (const g of customGroups) if (!counts.has(g.label)) counts.set(g.label, 0);

    return Array.from(counts.entries())
        .map(([label, vertexCount]) => {
            const group = groupByLabel.get(label) ?? null;
            const given = labelNames.get(label) ?? group?.name;
            return {
                label,
                name: given ?? `L${label}`,
                named: given !== undefined,
                color: group?.color ?? null,
                vertexCount,
                group,
            };
        })
        .sort((a, b) => (a.named === b.named ? a.label - b.label : a.named ? -1 : 1));
}

function transformTypeForKind(kind: "translate" | "rotate" | "scale"): SeqTransformType {
    return kind === "translate"
        ? SeqTransformType.TRANSLATE
        : kind === "scale"
        ? SeqTransformType.SCALE
        : SeqTransformType.ROTATE;
}

function bytesOf(file: ArchiveFile): Uint8Array {
    return new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength);
}

function arrayBufferOf(file: ArchiveFile): ArrayBuffer {
    const u8 = bytesOf(file);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * How faces are coloured: `shaded` is the client's own lighting, which is what the model looks
 * like in-game; `flat` drops the light so material regions read clearly.
 */
type Shading = "shaded" | "flat";

function meshFromDefinition(def: RSModelDefinition, shading: Shading = "shaded") {
    const lit = lightRSModel(def);
    return buildRSModelMesh(def, shading === "flat" ? flattenLighting(def, lit) : lit);
}

type Vec3 = { x: number; y: number; z: number };
type Interpolation = "smooth" | "linear";

type OldFrameInspector = {
    frame: SeqFrame;
    base: SeqBase;
    holdMs: number;
    /** Groups whose op at this frame was generated by tweening/holding between the user's keys. */
    tweenedGroups: Set<number>;
};

function easeT(t: number, mode: Interpolation): number {
    return mode === "smooth" ? t * t * (3 - 2 * t) : t;
}

/** Lerp a raw value; rotations wrap on the 256-unit circle and take the shortest arc. */
function lerpRaw(a: number, b: number, t: number, wrap: boolean): number {
    if (!wrap) return Math.round(a + (b - a) * t);
    let diff = (b - a) & 0xff;
    if (diff > 127) diff -= 256;
    return (a + Math.round(diff * t)) & 0xff;
}

/**
 * Icon button in a label row. The eye and solo icons are small and easy to mix up, so they get
 * a real explanation of what they do and what state they're in.
 */
function RowAction({
    heading,
    detail,
    onClick,
    className,
    children,
}: {
    heading: string;
    detail: string;
    onClick: () => void;
    className?: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <Hint side="left" heading={heading} detail={detail} label={heading}>
            <button
                type="button"
                onClick={onClick}
                className={cn("shrink-0 hover:text-foreground", className)}
            >
                {children}
            </button>
        </Hint>
    );
}

/** ROTATE ops get a drag-dial per axis (raw byte → degrees); everything else stays a raw number. */
function TransformValueEditor({
    type,
    x,
    y,
    z,
    onChange,
}: {
    type: SeqTransformType;
    x: number;
    y: number;
    z: number;
    onChange: (axis: "x" | "y" | "z", value: number) => void;
}): JSX.Element {
    const isRotate = type === SeqTransformType.ROTATE;
    return (
        <div className="mt-1 flex gap-1">
            {(["x", "y", "z"] as const).map((axis) => {
                const raw = axis === "x" ? x : axis === "y" ? y : z;
                return (
                    <input
                        key={axis}
                        type="number"
                        className="no-spinner h-5 w-full rounded border border-border/60 bg-card px-1 font-mono text-[11px] leading-none"
                        value={isRotate ? Math.round(rawToDegrees(raw)) : raw}
                        onChange={(e) => {
                            const value = Number.parseInt(e.target.value, 10);
                            if (Number.isNaN(value)) return;
                            onChange(axis, isRotate ? degreesToRaw(value) : value);
                        }}
                    />
                );
            })}
        </div>
    );
}

export default function AnimationEditorApp(): JSX.Element {
    // One cache for the whole app, so opening it here opens it in the other viewers too.
    const {
        cache,
        gameVals,
        state: cacheState,
        generation: cacheGeneration,
        needsPermission,
        reopenRemembered,
    } = useCache();
    const [modelState, setModelState] = useState<ModelState>({ status: "empty" });
    const [seqState, setSeqState] = useState<SeqState>({ status: "empty" });
    const [modelId, setModelId] = useState("65533");
    /** What the timeline is showing: a cache sequence's id, "new" for one started here, or nothing. */
    const [loadedSeq, setLoadedSeq] = useState<number | "new" | null>(null);
    /**
     * True when the loaded sequence is only being watched from the list. A preview drives the
     * model and nothing else: no timeline, no keyframe editor — click the sequence itself to
     * open it for editing.
     */
    const [previewingSeq, setPreviewingSeq] = useState(false);
    // The animation browser: what's typed in its search box, and which suggestion under it is armed.
    const [animSearch, setAnimSearch] = useState("");
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [suggestionIndex, setSuggestionIndex] = useState(0);
    /** What's being typed into the timeline's frame-count box; null when it isn't being edited. */
    const [lengthDraft, setLengthDraft] = useState<string | null>(null);
    /**
     * Whether the keyframe panel's label list is open. Null means "decide for me": open while the
     * timeline has no rows, since there's nothing else to do, and out of the way once it has.
     */
    const [movementsOpen, setMovementsOpen] = useState<boolean | null>(null);
    /** Bumped when a sequence setting is edited — it lives on a ref, so nothing else re-renders. */
    const [seqConfigVersion, setSeqConfigVersion] = useState(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    /** How much width the dope sheet rows lose to their scrollbar gutter, mirrored onto the
     *  transport row so the Timeline stays exactly as wide as the tracks under it. */
    const [trackGutter, setTrackGutter] = useState(0);
    /** What could be exported, while the export dialog is open. */
    const [exportPlan, setExportPlan] = useState<BundlePlan | null>(null);
    useEffect(() => {
        settingsOpenRef.current = settingsOpen;
    }, [settingsOpen]);
    const [playing, setPlaying] = useState(false);
    const [step, setStep] = useState(0);
    const [inspector, setInspector] = useState<OldFrameInspector | null>(null);
    const [selectMode, setSelectMode] = useState(false);
    // Faces by default: picking a surface region is the usual way into labelling a model.
    const [selectElement, setSelectElement] = useState<SelectElement>("face");
    const [marquee, setMarquee] = useState<{
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    } | null>(null);
    const [selectedCount, setSelectedCount] = useState(0);
    /** How many elements of the current mode are selected — vertices, edges or faces. */
    const [selectedElements, setSelectedElements] = useState(0);
    const [newLabelId, setNewLabelId] = useState("5");
    const [newMovementType, setNewMovementType] = useState<SeqTransformType>(
        SeqTransformType.ROTATE,
    );
    const [newMovementName, setNewMovementName] = useState("Tail");
    const [customGroups, setCustomGroups] = useState<CustomGroup[]>([]);
    // Every label the model carries, plus any names given to the ones that arrived unnamed.
    const [modelLabels, setModelLabels] = useState<ModelLabel[]>([]);
    const [labelNames, setLabelNames] = useState<Map<number, string>>(new Map());
    /**
     * Mirrors `labelNames`, kept current at every write site rather than through state alone.
     *
     * `renameLabel` can run several times back to back in one synchronous batch — the assistant
     * applying five renames in a row is exactly this — and each call needs to build on the one
     * before it. `labelNames` itself only reflects that once React re-renders, so a run of calls
     * reading it from closure would each start from the same pre-batch map and clobber each
     * other's work, leaving only the last rename standing. The ref has no such lag.
     */
    const labelNamesRef = useRef<Map<number, string>>(new Map());
    /** Which model the label names belong to, so they're saved against the right one. */
    const loadedModelIdRef = useRef<number | null>(null);
    const { active: activeWorkspace, labelNamesFor, saveLabelNames } = useWorkspaces();
    const [renamingLabel, setRenamingLabel] = useState<number | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    // Opens in Rigging: labelling the model comes before animating it, and rigging is the one
    // workspace that works with nothing but a model loaded.
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>("labels");
    const [workspace, setWorkspace] = useState<Workspace>("rigging");
    // Rigging viewport/selection options, mirrored into refs for the render loop and the
    // marquee's pointerup (both run outside React's render).
    // Faces and edges toggle independently; the renderer's single mode is derived from them.
    // Opens on the plain shaded model — edges and points are overlays you turn on when you
    // need them, not things to look past from the start.
    const [showFaces, setShowFaces] = useState(true);
    const [showEdges, setShowEdges] = useState(false);
    const [shading, setShading] = useState<Shading>("shaded");
    const shadingRef = useRef<Shading>("shaded");
    // The floating in-game preview. Its mesh lives in a ref with a version counter so the
    // per-frame rebuild during playback costs no React renders.
    /** The single hidden file input the File > Import menu drives. */
    const importInputRef = useRef<HTMLInputElement>(null);
    const animPackInputRef = useRef<HTMLInputElement>(null);
    // Import/export feedback. A rescale note isn't a failure, so it doesn't get an error's colours.
    const [ioMessage, setIoMessage] = useState<{ text: string; tone: "error" | "info" } | null>(
        null,
    );
    // A file dragged over the viewport, and one dropped while a model is already open.
    const [draggingFile, setDraggingFile] = useState(false);
    const [pendingDrop, setPendingDrop] = useState<{ file: File; format: ModelFormat } | null>(
        null,
    );
    const [previewOpen, setPreviewOpen] = useState(false);
    const previewOpenRef = useRef(false);
    const previewMeshRef = useRef<PreviewMeshRef>({ mesh: null, version: 0 });
    // Points are a rigging overlay, like Blender showing them in edit mode but not object mode:
    const [showVertices, setShowVertices] = useState(false);
    // Off by default, like Blender: the model reads as solid until you ask to see through it.
    const [xray, setXray] = useState(false);
    // Two separate things, as in Blender's outliner: the eye hides a label, and solo shows only
    // the soloed ones. Solo wins while it's active, and the eyes are waiting underneath it.
    const [hiddenLabels, setHiddenLabels] = useState<Set<number>>(new Set());
    const [isolatedLabels, setIsolatedLabels] = useState<Set<number>>(new Set());
    /** Triangles left after isolation, or null when the whole model is showing. */
    const [visibleTriangles, setVisibleTriangles] = useState<number | null>(null);
    const [assignTarget, setAssignTarget] = useState<"new" | number>("new");
    // "Create label" panel: the model's colour regions and bone influences, so a label can be
    // targeted by material or by weight instead of only by dragging a box.
    const [creatingLabel, setCreatingLabel] = useState(false);
    const [colorGroups, setColorGroups] = useState<ColorGroup[]>([]);
    const [boneGroups, setBoneGroups] = useState<BoneGroup[]>([]);
    /** Which rigging system the Model rig panel is showing. */
    const [rigTab, setRigTab] = useState<"labels" | "bones">("labels");
    const [newBoneId, setNewBoneId] = useState("0");
    const [newBoneWeight, setNewBoneWeight] = useState("255");
    const [boneMessage, setBoneMessage] = useState<string | null>(null);
    const [minWeight, setMinWeight] = useState(1);
    const showVerticesRef = useRef(false);
    const xrayRef = useRef(false);
    /** Derived from the faces/edges toggles, so the renderer can be set up from it on creation. */
    const renderModeRef = useRef<RSModelRenderMode>("solid");
    const hiddenLabelsRef = useRef<Set<number>>(new Set());
    const isolatedLabelsRef = useRef<Set<number>>(new Set());
    const adjacencyRef = useRef<number[][]>([]);
    /** Bumped whenever the mesh is rebuilt, so the overlay knows its depth cache went stale. */
    const poseVersionRef = useRef(0);
    /** Depth buffer for occluding vertex points while x-ray is off, keyed on camera + pose. */
    const depthCacheRef = useRef<{ key: string; buffer: DepthBuffer } | null>(null);
    const [activeGizmoGroup, setActiveGizmoGroup] = useState<number | null>(null);
    const [sidebarVisible, setSidebarVisible] = useState(true);
    // Start from defaults and pick up any saved rebinds after mount, so server and first client
    // render agree (localStorage is client-only).
    const [bindings, setBindings] = useState<HotkeyBindings>(() => defaultBindings());
    const [modalInfo, setModalInfo] = useState<{ kind: TransformKind; axis: Axis } | null>(null);
    const [interpolation, setInterpolation] = useState<Interpolation>("smooth");
    const interpolationRef = useRef<Interpolation>("smooth");
    // Timeline layer presentation: user-given names for plain `gN` rows, hidden rows, and an
    // explicit order once the user has dragged something (null = default "named first" sort).
    const [rowNames, setRowNames] = useState<Map<number, string>>(new Map());
    const [hiddenRows, setHiddenRows] = useState<Set<number>>(new Set());
    const [rowOrder, setRowOrder] = useState<number[] | null>(null);
    /** The full ordered id list from the last render, so a drag can be applied to what you see. */
    const displayOrderRef = useRef<number[]>([]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const vertexOverlayRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<RSModelRenderer | null>(null);
    const meshRef = useRef<RSModelMesh | null>(null);
    const cameraRef = useRef<RSModelCamera>({ yaw: Math.PI * 0.25, pitch: -0.35, zoom: 2.4 });
    const dragRef = useRef<{ x: number; y: number } | null>(null);
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    // Mirrors of the `selectMode`/`marquee` state, read live from the render loop (a stable
    // closure) so the vertex overlay redraws every frame without needing to restart the loop.
    const selectModeRef = useRef(false);
    /** Read by the draw loop, which is a stable closure and can't see the workspace state. */
    const workspaceRef = useRef<Workspace>("rigging");
    const selectElementRef = useRef<SelectElement>("face");
    const marqueeLiveRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    /** Whether the in-progress box adds to the selection or takes away (Ctrl held). */
    const marqueeSubtractRef = useRef(false);
    /** Where the pointer went down, so a release can tell a click from an orbit. */
    const clickStartRef = useRef<{ x: number; y: number; subtract: boolean } | null>(null);
    /** Whether the pointer is over the viewport, so the hover highlight can stop at the edge. */
    const pointerInsideRef = useRef(false);
    const edgeListRef = useRef<Int32Array>(new Int32Array(0));
    // The group currently "armed" for the on-screen gizmo (set by clicking its label), the gizmo
    // geometry computed for the current frame/camera each draw (used for hit-testing on pointer
    // down), and the active drag session once a handle is grabbed.
    const activeGizmoGroupRef = useRef<number | null>(null);
    const gizmoStateRef = useRef<GizmoDrawState | null>(null);
    const gizmoDragRef = useRef<GizmoDragState | null>(null);
    // Blender-style modal transform (G/R/S) in progress, the last pointer position over the
    // viewport (the modal anchors to it), live hotkey bindings for the keydown dispatcher, and
    // whether the hotkey editor is currently capturing a new combo (dispatcher stays quiet).
    const modalRef = useRef<ModalTransform | null>(null);
    // The pointer handlers are declared before the modal callbacks; these refs let them call
    // the latest versions without a declaration-order tangle.
    const confirmModalRef = useRef<() => void>(() => {});
    const cancelModalRef = useRef<() => void>(() => {});
    /** Cursor position in the viewport. Not a projected point, so it has no depth. */
    const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const bindingsRef = useRef<HotkeyBindings>(defaultBindings());
    const hotkeyListeningRef = useRef(false);
    /** The settings modal takes the keyboard: G/R/S in there would arm a gizmo behind it. */
    const settingsOpenRef = useRef(false);
    /** True when the model came from a file rather than the cache, so there's nothing to diff it against. */
    const modelFromFileRef = useRef(false);
    /**
     * The gizmo axis under the cursor, mirrored into state only when it changes so the canvas can
     * show a grab cursor. The render loop runs every frame; re-rendering React with it would not.
     */
    const gizmoHoverRef = useRef<Axis | null>(null);
    const [gizmoHovering, setGizmoHovering] = useState(false);
    const setGizmoHover = useCallback((axis: Axis | null) => {
        if (gizmoHoverRef.current === axis) return;
        gizmoHoverRef.current = axis;
        setGizmoHovering(axis !== null);
    }, []);
    /** True once a sequence setting has been edited on the Config tab. */
    const seqConfigDirtyRef = useRef(false);
    /**
     * Separates one continuous edit from the next.
     *
     * Dragging a gizmo calls  on every pointer move; they all coalesce
     * into one history entry because they share this number. Letting go bumps it, so the next
     * drag on the same axis is a separate entry rather than swallowing the last one.
     */
    const editSessionRef = useRef(0);
    /** The current label rows, for callbacks that run outside render. */
    const labelRowsRef = useRef<LabelRow[]>([]);

    /** What the open sequence is called, for the viewport's corner text. */
    const loadedSeqName = useMemo(
        () =>
            typeof loadedSeq === "number" ? gameVals?.nameOf("sequences", loadedSeq) ?? null : null,
        [gameVals, loadedSeq],
    );
    /** Points at , which is defined below the selection helpers that need it. */
    const recordHistoryRef = useRef<(label: string, coalesce?: string) => void>(() => {});
    const runActionRef = useRef<(id: HotkeyActionId) => boolean>(() => false);
    const seqBaseCacheRef = useRef<Map<number, SeqBase>>(new Map());

    const defRef = useRef<RSModelDefinition | null>(null);
    const poseRef = useRef<PosedModel | null>(null);
    const vertexLabelGroupsRef = useRef<number[][]>([]);
    const faceLabelGroupsRef = useRef<number[][]>([]);
    // Locally-edited copy of the model's vertex labels (never written back to the model / cache).
    const vertexSkinsOverrideRef = useRef<Int32Array | null>(null);
    /** The same for bone weights, so a model with no skeleton can be given one here. */
    const mayaOverrideRef = useRef<{ groups: Int32Array[]; scales: Int32Array[] } | null>(null);
    const selectedVerticesRef = useRef<number[]>([]);
    /** Same selection as a set, for the overlay's per-vertex lookup while drawing. */
    const selectedSetRef = useRef<Set<number>>(new Set());
    /**
     * What's selected, in the terms of whichever element mode made the selection: vertex
     * indices, edge indices (into `edgeListRef`, pointing at the first of its two ends), or face
     * indices. Selecting elements as elements is what stops deselecting one face from pulling
     * its corners out from under the faces next to it.
     */
    const selectionRef = useRef<{ element: SelectElement; ids: Set<number> }>({
        element: "face",
        ids: new Set(),
    });

    /** Keeps the selection array, its lookup set and the displayed count in step. */
    const setSelection = useCallback((vertices: number[]): void => {
        selectedVerticesRef.current = vertices;
        selectedSetRef.current = new Set(vertices);
        setSelectedCount(vertices.length);
    }, []);

    /** The vertices an element selection covers — what labelling ultimately works on. */
    const verticesOf = useCallback((element: SelectElement, ids: Iterable<number>): number[] => {
        if (element === "vertex") return Array.from(ids).sort((a, b) => a - b);

        const out = new Set<number>();
        if (element === "edge") {
            const edges = edgeListRef.current;
            for (const e of ids) {
                out.add(edges[e]);
                out.add(edges[e + 1]);
            }
        } else {
            const def = defRef.current;
            if (def) {
                for (const f of ids) {
                    out.add(def.faceVertexIndices1[f]);
                    out.add(def.faceVertexIndices2[f]);
                    out.add(def.faceVertexIndices3[f]);
                }
            }
        }
        return Array.from(out).sort((a, b) => a - b);
    }, []);

    /** The elements of `element` wholly covered by a set of vertices — Blender's mode switch. */
    const elementsWithin = useCallback(
        (element: SelectElement, vertices: Set<number>): Set<number> => {
            if (element === "vertex") return new Set(vertices);

            const out = new Set<number>();
            if (element === "edge") {
                const edges = edgeListRef.current;
                for (let e = 0; e + 1 < edges.length; e += 2) {
                    if (vertices.has(edges[e]) && vertices.has(edges[e + 1])) out.add(e);
                }
            } else {
                const def = defRef.current;
                if (def) {
                    for (let f = 0; f < def.faceCount; f++) {
                        if (
                            vertices.has(def.faceVertexIndices1[f]) &&
                            vertices.has(def.faceVertexIndices2[f]) &&
                            vertices.has(def.faceVertexIndices3[f])
                        ) {
                            out.add(f);
                        }
                    }
                }
            }
            return out;
        },
        [],
    );

    /** Records an element selection and re-derives the vertex view of it. */
    const commitSelection = useCallback(
        (element: SelectElement, ids: Set<number>): void => {
            selectionRef.current = { element, ids };
            setSelectedElements(ids.size);
            setSelection(verticesOf(element, ids));
        },
        [setSelection, verticesOf],
    );

    /**
     * Every deliberate selection change, recorded.
     *
     * Separate from `commitSelection` because restoring a snapshot goes through that too, and a
     * restore that recorded itself would bury the history under its own undos.
     */
    const commitSelectionRecorded = useCallback(
        (element: SelectElement, ids: Set<number>, label?: string): void => {
            commitSelection(element, ids);
            recordHistoryRef.current(
                label ??
                    (ids.size === 0
                        ? "Deselect all"
                        : `Select ${ids.size} ${element}${ids.size === 1 ? "" : "s"}`),
                // A run of clicks building one selection collapses into a single entry; the
                // session breaks when you do anything else.
                `selection:${editSessionRef.current}`,
            );
        },
        [commitSelection],
    );

    /**
     * Re-reads the label list from the model's (locally edited) vertex labels. Called wherever
     * labels change, since they live in a ref that React can't see.
     */
    // ---- Undo / redo ----------------------------------------------------------------------

    const [history, setHistory] = useState<History>(emptyHistory);
    /** Mirrors `history` for the hotkey dispatcher, which runs outside React's render. */
    const historyRef = useRef<History>(history);
    historyRef.current = history;

    /** Everything an action can change, copied deeply enough that restoring can't alias it. */
    const captureSnapshot = useCallback(
        (): EditorSnapshot => ({
            edits: cloneEdits(editsRef.current),
            customGroups: customGroupsRef.current.map((g) => ({
                ...g,
                vertexIndices: [...g.vertexIndices],
            })),
            vertexSkins: vertexSkinsOverrideRef.current?.slice() ?? null,
            maya: cloneMaya(mayaOverrideRef.current),
            labelNames: new Map(labelNames),
            rowNames: new Map(rowNames),
            hiddenRows: new Set(hiddenRows),
            rowOrder: rowOrder ? [...rowOrder] : null,
            // Frames are never mutated in place, only added and removed, so the map can share
            // its values — copying 50 decoded frames per keystroke would be daft.
            frames: new Map(allFramesRef.current),
            seqConfig: captureSeqConfig(seqTypeRef.current),
            selection: {
                element: selectionRef.current.element,
                ids: Array.from(selectionRef.current.ids),
            },
        }),
        [hiddenRows, labelNames, rowNames, rowOrder],
    );

    const refreshModelLabels = useCallback((): void => {
        const groups = vertexLabelGroupsRef.current;
        const rows: ModelLabel[] = [];
        for (let label = 0; label < groups.length; label++) {
            const count = groups[label]?.length ?? 0;
            if (count > 0) rows.push({ label, vertexCount: count });
        }
        setModelLabels(rows);
    }, []);

    /**
     * Which labels currently render. Solo overrides the eyes: while anything is soloed you see
     * only that, and turning solo back off drops you to whatever the eyes had hidden. `filtering`
     * says whether anything is being held back at all, so the common case skips the work.
     */
    const labelVisibility = useCallback((): {
        filtering: boolean;
        isVisible: (label: number) => boolean;
    } => {
        const isolated = isolatedLabelsRef.current;
        if (isolated.size > 0)
            return { filtering: true, isVisible: (label) => isolated.has(label) };
        const hidden = hiddenLabelsRef.current;
        if (hidden.size > 0) return { filtering: true, isVisible: (label) => !hidden.has(label) };
        return { filtering: false, isVisible: () => true };
    }, []);

    const seqTypeRef = useRef<SeqType | null>(null);
    const skeletalBaseRef = useRef<SkeletalBase | null>(null);
    const skeletalSeqRef = useRef<SkeletalSeq | null>(null);
    const stepCountRef = useRef(0);

    // Raw decoded frame (unedited) for whichever old-style keyframe is currently displayed, plus
    // a live-edit overlay keyed by frame index → base transform-group id. Edits (and the custom
    // groups below) never touch the decoded bytes or the engine — they're layered on top when
    // building the "effective" frame/base for preview.
    const rawOldFrameRef = useRef<{ index: number; frame: SeqFrame } | null>(null);
    const editsRef = useRef<Map<number, Map<number, { x: number; y: number; z: number }>>>(
        new Map(),
    );
    const customGroupsRef = useRef<CustomGroup[]>([]);
    // Every old-style frame, decoded eagerly once a sequence loads (they're small, and there are
    // rarely more than a couple hundred) — makes scrubbing instant and gives the dope sheet full
    // per-frame keyframe visibility without needing to visit every frame first.
    const allFramesRef = useRef<Map<number, SeqFrame>>(new Map());

    const rafRef = useRef<number | null>(null);

    const resetCamera = (): void => {
        cameraRef.current = { yaw: Math.PI * 0.25, pitch: -0.35, zoom: 2.4 };
    };

    /** Centroid (in current pose space) of a base group's labelled vertices — used to place the
     * gizmo. A visual anchor only; the actual pivot the game uses for rotation can differ (it
     * chains through `resetOriginGroups`), but this is a sound approximation for "where to draw
     * the handles for whatever this group moves." */
    const computeGroupPivot = useCallback(
        (labels: number[]): { x: number; y: number; z: number } | null => {
            const pose = poseRef.current;
            if (!pose) return null;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let count = 0;
            for (const label of labels) {
                const verts = vertexLabelGroupsRef.current[label];
                if (!verts) continue;
                for (const v of verts) {
                    sx += pose.verticesX[v];
                    sy += pose.verticesY[v];
                    sz += pose.verticesZ[v];
                    count++;
                }
            }
            if (count === 0) return null;
            return { x: sx / count, y: sy / count, z: sz / count };
        },
        [],
    );

    /**
     * Which group's labels give another group its pivot.
     *
     * Rotate and scale work around an origin the sequence set earlier in the frame, not around
     * the model's own (0, 0, 0) — that's why a leg swings from the hip rather than from under
     * the floor. The frame says which origin when it has one, and a cache sequence's base puts
     * an ORIGIN group before the groups it serves.
     *
     * A movement built here has no origin group of its own, so it pivots on its own centre,
     * which is what "rotate in place" means. Left unset it would turn about the model origin and
     * swing the whole thing through an arc.
     */
    const pivotGroupFor = useCallback(
        (base: SeqBase, groupId: number, fromFrame?: number): number => {
            if (fromFrame !== undefined && fromFrame >= 0) return fromFrame;
            if (groupId >= CUSTOM_GROUP_ID_BASE) return groupId;
            for (let i = Math.min(groupId, base.count) - 1; i >= 0; i--) {
                if (base.types[i] === SeqTransformType.ORIGIN) return i;
            }
            return groupId;
        },
        [],
    );

    /**
     * Overlays any custom (editor-created) transform groups onto a decoded SeqBase. Custom
     * groups sit at their own high ids, so the arrays are padded out to reach them — a group's
     * id has to equal its index for `animateOldStyleFrame`'s lookups to resolve.
     */
    const getEffectiveBase = useCallback((rawBase: SeqBase): SeqBase => {
        const custom = customGroupsRef.current;
        if (custom.length === 0) return rawBase;

        const count = Math.max(rawBase.count, ...custom.map((g) => g.id + 1));
        const types: SeqTransformType[] = new Array(count).fill(SeqTransformType.ORIGIN);
        const labels: number[][] = new Array(count);
        for (let i = 0; i < count; i++) labels[i] = [];
        for (let i = 0; i < rawBase.count; i++) {
            types[i] = rawBase.types[i];
            labels[i] = rawBase.labels[i];
        }
        for (const g of custom) {
            types[g.id] = g.type;
            labels[g.id] = [g.label];
        }
        // Padding slots are unreachable: frames only reference ids the raw base defined, plus
        // the custom ids set above.
        return new SeqBase(rawBase.id, count, types, labels, rawBase.skeletalBase);
    }, []);

    /**
     * Blender-style tweening: for a frame with no explicit key, the value between the user's
     * nearest keys on either side (eased), or held from the single nearest key beyond the keyed
     * range. Only the user's edits act as anchors — the original animation's per-frame ops are
     * never extrapolated, so unedited sequences play back exactly as decoded.
     */
    const interpolatedValue = useCallback(
        (groupId: number, frameIndex: number, type: SeqTransformType): Vec3 | null => {
            let before: [number, Vec3] | undefined;
            let after: [number, Vec3] | undefined;
            for (const [frame, frameEdits] of editsRef.current) {
                const value = frameEdits.get(groupId);
                if (!value) continue;
                if (frame === frameIndex) return value;
                if (frame < frameIndex) {
                    if (!before || frame > before[0]) before = [frame, value];
                } else if (!after || frame < after[0]) {
                    after = [frame, value];
                }
            }
            if (before && after) {
                const t = easeT(
                    (frameIndex - before[0]) / (after[0] - before[0]),
                    interpolationRef.current,
                );
                const wrap = type === SeqTransformType.ROTATE;
                return {
                    x: lerpRaw(before[1].x, after[1].x, t, wrap),
                    y: lerpRaw(before[1].y, after[1].y, t, wrap),
                    z: lerpRaw(before[1].z, after[1].z, t, wrap),
                };
            }
            return before?.[1] ?? after?.[1] ?? null;
        },
        [],
    );

    /**
     * Builds what the viewport should actually show: the whole model, or — while labels are
     * isolated — only their geometry, framed on itself the way Blender's local view does.
     */
    const buildViewMesh = useCallback(
        (def: RSModelDefinition): RSModelMesh => {
            const { filtering, isVisible } = labelVisibility();
            const shown = filtering
                ? filterFacesByLabel(
                      def,
                      vertexSkinsOverrideRef.current ?? def.vertexSkins,
                      isVisible,
                  )
                : def;
            // X-ray last: hiding has already decided which faces exist, and this only changes
            // how solid the survivors are.
            const mesh = meshFromDefinition(
                xrayRef.current ? makeTranslucent(shown) : shown,
                shadingRef.current,
            );

            // Always frame on the whole model, never on what happens to be visible — otherwise
            // hiding a label would yank the camera, and showing it again would yank it back.
            const bounds = boundsOfVertices(def);
            return bounds ? { ...mesh, bounds } : mesh;
        },
        [labelVisibility],
    );

    /**
     * Projects every vertex to screen space once, flagging the ones that can actually be seen —
     * hidden labels and, with x-ray off, whatever the model's own surface covers. Shared by the
     * overlay and by click picking so the two can't disagree about what's there.
     */
    const projectVertices = useCallback(
        (
            vp: Float32Array,
            width: number,
            height: number,
            depth: DepthBuffer | null,
            depthBias: number,
        ): Projection | null => {
            const pose = poseRef.current;
            const def = defRef.current;
            if (!pose || !def) return null;

            const count = pose.verticesX.length;
            const xs = new Float32Array(count);
            const ys = new Float32Array(count);
            const ds = new Float32Array(count);
            const ok = new Uint8Array(count);

            const { filtering, isVisible } = labelVisibility();
            const skins = vertexSkinsOverrideRef.current ?? def.vertexSkins;

            for (let v = 0; v < count; v++) {
                if (filtering && !isVisible(skins ? skins[v] : -1)) continue;
                // Matches the Y-flip `buildRSModelMesh` applies when it lays out GPU positions.
                const screen = projectToScreen(
                    vp,
                    pose.verticesX[v],
                    -pose.verticesY[v],
                    pose.verticesZ[v],
                    width,
                    height,
                );
                if (!screen) continue;
                if (depth && !isDepthVisible(depth, screen.x, screen.y, screen.depth, depthBias))
                    continue;
                xs[v] = screen.x;
                ys[v] = screen.y;
                ds[v] = screen.depth;
                ok[v] = 1;
            }
            return { x: xs, y: ys, depth: ds, ok };
        },
        [labelVisibility],
    );

    /**
     * The vertices at (x, y) in an already-projected frame, or null for empty space. In vertex
     * mode that's the nearest point; in edge mode the nearest edge's two ends; in face mode the
     * three corners of the frontmost face under the cursor.
     *
     * Split out from `pickAt` so the hover highlight can reuse the projection the overlay just
     * built — what you see highlighted is then, by construction, what a click will take.
     */
    const pickFromProjection = useCallback((p: Projection, x: number, y: number): number | null => {
        const def = defRef.current;
        if (!def) return null;

        if (selectElementRef.current === "vertex") {
            let best = -1;
            let bestDistance = PICK_RADIUS;
            for (let v = 0; v < p.ok.length; v++) {
                if (!p.ok[v]) continue;
                const d = Math.hypot(p.x[v] - x, p.y[v] - y);
                // Ties go to whatever is nearer the camera.
                if (
                    d < bestDistance ||
                    (d === bestDistance && best >= 0 && p.depth[v] < p.depth[best])
                ) {
                    bestDistance = d;
                    best = v;
                }
            }
            return best >= 0 ? best : null;
        }

        if (selectElementRef.current === "edge") {
            const edges = edgeListRef.current;
            let best = -1;
            let bestDistance = PICK_RADIUS;
            for (let e = 0; e + 1 < edges.length; e += 2) {
                const a = edges[e];
                const b = edges[e + 1];
                if (!p.ok[a] || !p.ok[b]) continue;
                const d = distanceToSegment(x, y, p.x[a], p.y[a], p.x[b], p.y[b]);
                if (d < bestDistance) {
                    bestDistance = d;
                    best = e;
                }
            }
            return best >= 0 ? best : null;
        }

        let best: number | null = null;
        let bestDepth = Number.POSITIVE_INFINITY;
        for (let f = 0; f < def.faceCount; f++) {
            const a = def.faceVertexIndices1[f];
            const b = def.faceVertexIndices2[f];
            const c = def.faceVertexIndices3[f];
            if (!p.ok[a] || !p.ok[b] || !p.ok[c]) continue;
            if (!pointInTriangle(x, y, p.x[a], p.y[a], p.x[b], p.y[b], p.x[c], p.y[c])) continue;
            const mean = (p.depth[a] + p.depth[b] + p.depth[c]) / 3;
            if (mean < bestDepth) {
                bestDepth = mean;
                best = f;
            }
        }
        return best;
    }, []);

    /** What a click at (x, y) would grab, projecting the model fresh for the test. */
    const pickAt = useCallback(
        (x: number, y: number, width: number, height: number): number | null => {
            const mesh = meshRef.current;
            if (!mesh) return null;

            const vp = computeViewProjection(cameraRef.current, mesh.bounds, width / height);
            const depth = xrayRef.current
                ? null
                : buildDepthBuffer(vp, mesh.positions, mesh.vertexCount, width, height);
            const p = projectVertices(
                vp,
                width,
                height,
                depth,
                mesh.bounds.radius * DEPTH_BIAS_FACTOR,
            );
            return p ? pickFromProjection(p, x, y) : null;
        },
        [projectVertices, pickFromProjection],
    );

    /**
     * Folds picked elements into the selection; Ctrl takes away instead of adding. Working in
     * element ids is what keeps removing one face from disturbing the faces beside it, even
     * though they share corners.
     */
    const applyPick = useCallback(
        (ids: readonly number[], subtract: boolean): void => {
            const element = selectElementRef.current;
            const current = selectionRef.current;
            // A selection made in another mode is converted first, not thrown away.
            const next =
                current.element === element
                    ? new Set(current.ids)
                    : elementsWithin(element, new Set(selectedVerticesRef.current));
            for (const id of ids) {
                if (subtract) next.delete(id);
                else next.add(id);
            }
            commitSelectionRecorded(
                element,
                next,
                next.size === 0
                    ? "Deselect all"
                    : `Select ${next.size} ${element}${next.size === 1 ? "" : "s"}`,
            );
        },
        [commitSelectionRecorded, elementsWithin],
    );

    /**
     * Hands the in-game preview a mesh built the way the client would: full model, real lighting,
     * none of the editor's hiding, x-ray or flat shading.
     */
    const refreshPreviewMesh = useCallback((posedDef?: RSModelDefinition): void => {
        if (!previewOpenRef.current) return;
        const def = defRef.current;
        const pose = poseRef.current;
        if (!def || !pose) return;
        previewMeshRef.current = {
            mesh: meshFromDefinition(posedDef ?? applyPoseToDefinition(def, pose), "shaded"),
            version: previewMeshRef.current.version + 1,
        };
    }, []);

    const renderPose = useCallback((): void => {
        const def = defRef.current;
        const pose = poseRef.current;
        if (!def || !pose) return;
        const posedDef = applyPoseToDefinition(def, pose);
        const mesh = buildViewMesh(posedDef);
        meshRef.current = mesh;
        poseVersionRef.current++;
        rendererRef.current?.setMesh(mesh);
        refreshPreviewMesh(posedDef);
    }, [buildViewMesh, refreshPreviewMesh]);

    // Draws every vertex as a small dot while in select mode, so you can see what you're about
    // to grab: dim for ordinary vertices, orange for ones already in a custom movement group,
    // bright yellow for whatever currently falls inside the drag box.
    const drawVertexOverlay = useCallback((): void => {
        const canvas = vertexOverlayRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const mesh = meshRef.current;
        if (!mesh || canvas.width === 0 || canvas.height === 0) return;
        const vp = computeViewProjection(
            cameraRef.current,
            mesh.bounds,
            canvas.width / canvas.height,
        );

        // The Vertices toggle is authoritative — a full point cloud over the model is mostly
        // clutter, so select mode no longer forces it back on. What's selected (and what a live
        // marquee is about to catch) still draws either way: that's feedback, not overlay.
        const selection = selectedSetRef.current;
        const marquee = marqueeLiveRef.current;
        // Select mode always needs the projection, even with points off: the hover highlight
        // still has to know what's under the cursor.
        if (showVerticesRef.current || selection.size > 0 || marquee || selectModeRef.current) {
            const pose = poseRef.current;
            const def = defRef.current;
            if (pose && def) {
                const { filtering } = labelVisibility();
                const pointsHidden = !showVerticesRef.current;
                const minX = marquee ? Math.min(marquee.x0, marquee.x1) : 0;
                const maxX = marquee ? Math.max(marquee.x0, marquee.x1) : 0;
                const minY = marquee ? Math.min(marquee.y0, marquee.y1) : 0;
                const maxY = marquee ? Math.max(marquee.y0, marquee.y1) : 0;

                const colorByLabel = new Map(
                    customGroupsRef.current.map((g) => [g.label, g.color]),
                );
                const skins = vertexSkinsOverrideRef.current ?? def.vertexSkins;

                // With x-ray off you only see what faces you, so the points get the same
                // occlusion test the marquee uses — what you can see is exactly what you can
                // select. Rebuilt only when the camera or pose moves, and never while x-ray is
                // on, which is the default.
                let depth: DepthBuffer | null = null;
                if (!xrayRef.current) {
                    const camera = cameraRef.current;
                    const key = `${camera.yaw},${camera.pitch},${camera.zoom},${poseVersionRef.current},${canvas.width}x${canvas.height}`;
                    if (depthCacheRef.current?.key !== key) {
                        depthCacheRef.current = {
                            key,
                            buffer: buildDepthBuffer(
                                vp,
                                mesh.positions,
                                mesh.vertexCount,
                                canvas.width,
                                canvas.height,
                            ),
                        };
                    }
                    depth = depthCacheRef.current.buffer;
                }
                const depthBias = mesh.bounds.radius * DEPTH_BIAS_FACTOR;
                const p = projectVertices(vp, canvas.width, canvas.height, depth, depthBias);
                if (!p) return;

                const lit = (v: number): boolean =>
                    selection.has(v) ||
                    (!!marquee &&
                        p.x[v] >= minX &&
                        p.x[v] <= maxX &&
                        p.y[v] >= minY &&
                        p.y[v] <= maxY);

                // Edge and face modes select whole elements, so an element is highlighted when
                // it is itself selected — not merely when its corners happen to be. A live
                // marquee previews what it's about to catch on top of that.
                const element = selectElementRef.current;
                const chosen = selectionRef.current;
                const isChosen = (id: number): boolean =>
                    chosen.element === element && chosen.ids.has(id);

                if (selectModeRef.current && element === "face") {
                    ctx.fillStyle = "rgba(232, 125, 13, 0.45)";
                    for (let f = 0; f < def.faceCount; f++) {
                        const a = def.faceVertexIndices1[f];
                        const b = def.faceVertexIndices2[f];
                        const c = def.faceVertexIndices3[f];
                        if (!p.ok[a] || !p.ok[b] || !p.ok[c]) continue;
                        if (!isChosen(f) && !(marquee && lit(a) && lit(b) && lit(c))) continue;
                        ctx.beginPath();
                        ctx.moveTo(p.x[a], p.y[a]);
                        ctx.lineTo(p.x[b], p.y[b]);
                        ctx.lineTo(p.x[c], p.y[c]);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
                if (selectModeRef.current && element !== "vertex") {
                    const edges = edgeListRef.current;
                    ctx.strokeStyle = BLENDER_ORANGE;
                    ctx.lineWidth = element === "edge" ? 2 : 1.5;
                    ctx.beginPath();
                    for (let e = 0; e + 1 < edges.length; e += 2) {
                        const a = edges[e];
                        const b = edges[e + 1];
                        if (!p.ok[a] || !p.ok[b]) continue;
                        const shown =
                            element === "edge"
                                ? isChosen(e) || (marquee && lit(a) && lit(b))
                                : // Face mode outlines whatever its filled faces cover.
                                  lit(a) && lit(b);
                        if (!shown) continue;
                        ctx.moveTo(p.x[a], p.y[a]);
                        ctx.lineTo(p.x[b], p.y[b]);
                    }
                    ctx.stroke();
                }

                for (let v = 0; v < p.ok.length; v++) {
                    if (!p.ok[v]) continue;
                    // Selected vertices stay lit after the drag ends — that's the feedback for
                    // grow/shrink and for seeing what you're about to label.
                    const highlighted = lit(v);
                    if (pointsHidden && !highlighted) continue;
                    // In edge/face mode the element highlight carries the selection, so the
                    // points stay small and stop shouting over it.
                    if (
                        highlighted &&
                        selectModeRef.current &&
                        element !== "vertex" &&
                        pointsHidden
                    )
                        continue;

                    const label = skins ? skins[v] : -1;
                    const groupColor = skins ? colorByLabel.get(label) : undefined;

                    const radius = highlighted
                        ? element === "vertex" || !selectModeRef.current
                            ? 3
                            : 2
                        : filtering
                        ? 2.5
                        : 1.5;
                    ctx.beginPath();
                    ctx.arc(p.x[v], p.y[v], radius, 0, Math.PI * 2);
                    ctx.fillStyle = highlighted
                        ? BLENDER_ORANGE
                        : groupColor ?? "rgba(255,255,255,0.35)";
                    ctx.fill();
                    if (highlighted) {
                        // A dark rim so the orange reads against pale geometry too.
                        ctx.strokeStyle = "rgba(0,0,0,0.65)";
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }

                // Pre-select highlight: what a click would take right now, in white so it reads
                // as "about to happen" rather than "selected". Skipped mid-drag, where the
                // pointer is orbiting or drawing a box rather than aiming at anything.
                const hovering =
                    selectModeRef.current &&
                    pointerInsideRef.current &&
                    !marquee &&
                    !dragRef.current;
                if (hovering) {
                    const cursor = lastMouseRef.current;
                    const hoverId = pickFromProjection(p, cursor.x, cursor.y);
                    const hover = hoverId === null ? null : verticesOf(element, [hoverId]);
                    if (hover) {
                        ctx.strokeStyle = "rgba(255,255,255,0.95)";
                        ctx.lineWidth = 2;
                        if (hover.length === 1) {
                            ctx.beginPath();
                            ctx.arc(p.x[hover[0]], p.y[hover[0]], 5, 0, Math.PI * 2);
                            ctx.stroke();
                        } else if (hover.length === 2) {
                            ctx.beginPath();
                            ctx.moveTo(p.x[hover[0]], p.y[hover[0]]);
                            ctx.lineTo(p.x[hover[1]], p.y[hover[1]]);
                            ctx.stroke();
                        } else {
                            ctx.beginPath();
                            ctx.moveTo(p.x[hover[0]], p.y[hover[0]]);
                            ctx.lineTo(p.x[hover[1]], p.y[hover[1]]);
                            ctx.lineTo(p.x[hover[2]], p.y[hover[2]]);
                            ctx.closePath();
                            ctx.fillStyle = "rgba(255,255,255,0.3)";
                            ctx.fill();
                            ctx.stroke();
                        }
                    }
                }
            }
        }

        // Transform handles belong to the keyframe editor: never over a rig, whatever is armed.
        const gizmoGroup =
            workspaceRef.current === "animation" ? activeGizmoGroupRef.current : null;
        const raw = rawOldFrameRef.current;
        if (gizmoGroup !== null && raw) {
            const base = getEffectiveBase(raw.frame.base);
            const type = base.types[gizmoGroup];
            const labels = base.labels[gizmoGroup];
            // Rotate and scale turn about an origin group; translate moves the thing itself, so
            // its handles belong on the thing. Drawn where the transform will actually happen —
            // a gizmo that pivots somewhere other than where it's drawn is worse than none.
            const pivotLabels =
                type === SeqTransformType.ROTATE || type === SeqTransformType.SCALE
                    ? base.labels[
                          pivotGroupFor(
                              base,
                              gizmoGroup,
                              raw.frame.resetOriginGroups[
                                  raw.frame.transformGroups.indexOf(gizmoGroup)
                              ],
                          )
                      ] ?? labels
                    : labels;
            const pivot = pivotLabels ? computeGroupPivot(pivotLabels) : null;
            const worldSize = mesh.bounds.radius * GIZMO_SIZE_FACTOR;
            const dragAxis =
                gizmoDragRef.current?.group === gizmoGroup
                    ? gizmoDragRef.current.axis
                    : modalRef.current?.group === gizmoGroup
                    ? modalRef.current.axis
                    : null;

            // What a click would grab right now, so a miss is visible before you commit to it —
            // a missed handle falls through to orbiting, which is the worst thing this can do.
            const cursor = pointerInsideRef.current ? lastMouseRef.current : null;

            if (pivot && (type === SeqTransformType.TRANSLATE || type === SeqTransformType.SCALE)) {
                const built = buildTranslateHandles(
                    vp,
                    pivot,
                    worldSize,
                    canvas.width,
                    canvas.height,
                );
                if (built) {
                    const kind = type === SeqTransformType.SCALE ? "scale" : "translate";
                    gizmoStateRef.current = { kind, group: gizmoGroup, ...built };
                    const hover =
                        cursor && !dragAxis ? hitTestTranslateHandle(built.handles, cursor) : null;
                    setGizmoHover(hover);
                    drawTranslateHandles(ctx, built.handles, { hover, active: dragAxis }, kind);
                    drawGizmoPivot(ctx, built.pivotScreen);
                    if (dragAxis) {
                        // Dragging always writes an edit for this frame, so the live value is here.
                        const value = editsRef.current.get(stepCountRef.current)?.get(gizmoGroup);
                        if (value) {
                            drawGizmoReadout(
                                ctx,
                                built.pivotScreen,
                                dragAxis,
                                kind === "scale"
                                    ? `${AXIS_LABELS[dragAxis]} ${(
                                          (value[dragAxis] / 128) *
                                          100
                                      ).toFixed(0)}%`
                                    : `${AXIS_LABELS[dragAxis]} ${value[dragAxis]}`,
                            );
                        }
                    }
                }
            } else if (pivot && type === SeqTransformType.ROTATE) {
                const built = buildRotateHandles(vp, pivot, worldSize, canvas.width, canvas.height);
                if (built) {
                    gizmoStateRef.current = { kind: "rotate", group: gizmoGroup, ...built };
                    const hover =
                        cursor && !dragAxis ? hitTestRotateHandle(built.handles, cursor) : null;
                    setGizmoHover(hover);
                    drawRotateHandles(ctx, built.handles, built.pivotScreen, {
                        hover,
                        active: dragAxis,
                    });
                    drawGizmoPivot(ctx, built.pivotScreen);
                    if (dragAxis) {
                        const value = editsRef.current.get(stepCountRef.current)?.get(gizmoGroup);
                        if (value) {
                            drawGizmoReadout(
                                ctx,
                                built.pivotScreen,
                                dragAxis,
                                `${AXIS_LABELS[dragAxis]} ${Math.round(
                                    value[dragAxis] * DEGREES_PER_UNIT,
                                )}°`,
                            );
                        }
                    }
                }
            } else {
                gizmoStateRef.current = null;
                setGizmoHover(null);
            }
        } else {
            gizmoStateRef.current = null;
            setGizmoHover(null);
        }

        // Blender-style navigation gizmo (top-right): the model's X/Y/Z axes as they currently
        // face the camera. Directions come from projecting the bounds centre offset along each
        // axis, so it rotates with the orbit for free. Mesh space already has Y flipped, so RS +Y
        // is mesh -Y.
        const c = mesh.bounds.center;
        const r = Math.max(mesh.bounds.radius, 1);
        const centerScreen = projectToScreen(vp, c[0], c[1], c[2], canvas.width, canvas.height);
        if (centerScreen) {
            const anchor = { x: canvas.width - 46, y: 46 };
            const len = 26;
            const axes: { axis: Axis; world: [number, number, number] }[] = [
                { axis: "x", world: [c[0] + r, c[1], c[2]] },
                { axis: "y", world: [c[0], c[1] - r, c[2]] },
                { axis: "z", world: [c[0], c[1], c[2] + r] },
            ];
            const colors: Record<Axis, string> = { x: "#ef4444", y: "#4ade80", z: "#60a5fa" };
            ctx.save();
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            for (const { axis, world } of axes) {
                const tip = projectToScreen(
                    vp,
                    world[0],
                    world[1],
                    world[2],
                    canvas.width,
                    canvas.height,
                );
                if (!tip) continue;
                let dx = tip.x - centerScreen.x;
                let dy = tip.y - centerScreen.y;
                const mag = Math.hypot(dx, dy) || 1;
                dx /= mag;
                dy /= mag;
                const end = { x: anchor.x + dx * len, y: anchor.y + dy * len };
                const neg = { x: anchor.x - dx * len, y: anchor.y - dy * len };

                ctx.strokeStyle = colors[axis];
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(anchor.x, anchor.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();

                ctx.fillStyle = colors[axis];
                ctx.beginPath();
                ctx.arc(end.x, end.y, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#111";
                ctx.fillText(axis.toUpperCase(), end.x, end.y + 0.5);

                ctx.fillStyle = "rgba(255,255,255,0.12)";
                ctx.beginPath();
                ctx.arc(neg.x, neg.y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }, [
        getEffectiveBase,
        computeGroupPivot,
        labelVisibility,
        projectVertices,
        pickFromProjection,
        pivotGroupFor,
        setGizmoHover,
        verticesOf,
    ]);

    const resolveSeqBase = useCallback((cache: CacheSystem, baseId: number): SeqBase => {
        const cached = seqBaseCacheRef.current.get(baseId);
        if (cached) return cached;
        const file = cache.getIndex(IndexType.DAT2.skeletons).getFile(baseId, 0);
        if (!file) throw new Error(`Sequence base ${baseId} not found (main_file_cache.idx1)`);
        const base = decodeSeqBase(baseId, bytesOf(file));
        seqBaseCacheRef.current.set(baseId, base);
        return base;
    }, []);

    // Re-applies the currently decoded raw frame at `index` with any live edits (and custom
    // group keyframes) overlaid on top, by cloning its transform arrays and constructing a fresh
    // SeqFrame/SeqBase — plain use of the exported classes, no engine changes needed.
    /**
     * The frame as it actually is at `index`: the sequence's own ops with your keys written over
     * them, and the in-betweens filled in.
     *
     * The raw frames in `allFramesRef` are only half the story — an animation started here has an
     * empty frame for every index, and everything you've keyed lives in `editsRef` until the two
     * are merged. Anything that wants the real animation, whether it's drawing it or exporting
     * it, needs this rather than the raw frame.
     */
    const effectiveFrameAt = useCallback(
        (index: number): { frame: SeqFrame; base: SeqBase; tweened: Set<number> } | null => {
            const raw = allFramesRef.current.get(index);
            if (!raw) return null;

            const base = getEffectiveBase(raw.base);
            const transformGroups = raw.transformGroups.slice();
            const transformX = raw.transformX.slice();
            const transformY = raw.transformY.slice();
            const transformZ = raw.transformZ.slice();
            const resetOriginGroups = raw.resetOriginGroups.slice();

            const frameEdits = editsRef.current.get(index);
            if (frameEdits) {
                for (const [groupId, edit] of frameEdits) {
                    const opIndex = transformGroups.indexOf(groupId);
                    if (opIndex >= 0) {
                        transformX[opIndex] = edit.x;
                        transformY[opIndex] = edit.y;
                        transformZ[opIndex] = edit.z;
                    } else {
                        // A custom group keyframed at this frame for the first time.
                        transformGroups.push(groupId);
                        transformX.push(edit.x);
                        transformY.push(edit.y);
                        transformZ.push(edit.z);
                        resetOriginGroups.push(pivotGroupFor(base, groupId));
                    }
                }
            }

            // Tween/hold any group keyed elsewhere but with no explicit op here.
            const tweened = new Set<number>();
            const keyedGroups = new Set<number>();
            for (const edits of editsRef.current.values())
                for (const g of edits.keys()) keyedGroups.add(g);
            for (const groupId of keyedGroups) {
                if (transformGroups.includes(groupId)) continue;
                const value = interpolatedValue(groupId, index, base.types[groupId]);
                if (!value) continue;
                transformGroups.push(groupId);
                transformX.push(value.x);
                transformY.push(value.y);
                transformZ.push(value.z);
                resetOriginGroups.push(pivotGroupFor(base, groupId));
                tweened.add(groupId);
            }

            return {
                frame: new SeqFrame(
                    base,
                    transformGroups.length,
                    transformGroups,
                    transformX,
                    transformY,
                    transformZ,
                    resetOriginGroups,
                    raw.hasAlphaTransform,
                ),
                base,
                tweened,
            };
        },
        [getEffectiveBase, interpolatedValue, pivotGroupFor],
    );

    const applyEffectiveOldFrame = useCallback(
        (index: number): void => {
            const def = defRef.current;
            const pose = poseRef.current;
            const seqType = seqTypeRef.current;
            const raw = rawOldFrameRef.current;
            if (!def || !pose || !seqType || !raw || raw.index !== index) return;

            const effective = effectiveFrameAt(index);
            if (!effective) return;

            resetPose(pose, def);
            animateOldStyleFrame(
                pose,
                vertexLabelGroupsRef.current,
                faceLabelGroupsRef.current,
                effective.frame,
            );
            renderPose();

            const holdMs = Math.max(1, seqType.frameLengths[index] ?? 1) * 20;
            setInspector({
                frame: effective.frame,
                base: effective.base,
                holdMs,
                tweenedGroups: effective.tweened,
            });
        },
        [effectiveFrameAt, renderPose],
    );

    // Applies the old-style keyframe at `index` (a real random-access seek — each frame is a
    // complete description against bind pose, so no need to replay earlier frames). All frames
    // are decoded up front when the sequence loads, so this is just a map lookup.
    const applyOldFrame = useCallback(
        (index: number): void => {
            const frame = allFramesRef.current.get(index);
            if (!frame) return;
            rawOldFrameRef.current = { index, frame };
            applyEffectiveOldFrame(index);
        },
        [applyEffectiveOldFrame],
    );

    /**
     * Puts a snapshot back and rebuilds everything derived from it.
     *
     * Order matters: the labels have to be rebuilt before the frame is re-applied, because
     * posing the model reads the label groups the rig defines.
     */
    const restoreSnapshot = useCallback(
        (snapshot: EditorSnapshot): void => {
            const def = defRef.current;
            editsRef.current = cloneEdits(snapshot.edits);
            customGroupsRef.current = snapshot.customGroups.map((g) => ({
                ...g,
                type: g.type as SeqTransformType,
                vertexIndices: [...g.vertexIndices],
            }));
            setCustomGroups(customGroupsRef.current);

            vertexSkinsOverrideRef.current = snapshot.vertexSkins?.slice() ?? null;
            mayaOverrideRef.current = cloneMaya(snapshot.maya);
            if (def) {
                const skins = vertexSkinsOverrideRef.current ?? def.vertexSkins;
                vertexLabelGroupsRef.current = buildLabelGroups(skins, def.vertexCount);
                refreshModelLabels();
            }

            labelNamesRef.current = new Map(snapshot.labelNames);
            setLabelNames(labelNamesRef.current);
            setRowNames(new Map(snapshot.rowNames));
            setHiddenRows(new Set(snapshot.hiddenRows));
            setRowOrder(snapshot.rowOrder ? [...snapshot.rowOrder] : null);

            setSelectElement(snapshot.selection.element as SelectElement);
            selectElementRef.current = snapshot.selection.element as SelectElement;
            commitSelection(
                snapshot.selection.element as SelectElement,
                new Set(snapshot.selection.ids),
            );

            allFramesRef.current = new Map(snapshot.frames);
            restoreSeqConfig(seqTypeRef.current, snapshot.seqConfig);
            const frameCount = snapshot.seqConfig?.frameIds.length ?? 0;
            if (frameCount > 0) {
                setSeqState((current) =>
                    current.status === "ready" && current.kind === "old"
                        ? { ...current, frameCount }
                        : current,
                );
                // The playhead can be past the end of a shorter animation.
                const step = Math.min(stepCountRef.current, frameCount - 1);
                stepCountRef.current = step;
                setStep(step);
                applyOldFrame(step);
            } else {
                // No sequence to re-pose, but the rig may have changed under the mesh.
                renderPose();
            }
        },
        [applyOldFrame, commitSelection, refreshModelLabels, renderPose],
    );

    /**
     * Records the state as it now stands under a name.
     *
     * Called *after* the change, so each entry is a state you can jump straight to rather than a
     * step towards one. Continuous things — a gizmo drag, typing in a number field — pass a
     * `coalesce` key so they collapse into a single entry instead of one per pointer move.
     */
    const recordHistory = useCallback(
        (label: string, coalesce?: string): void => {
            setHistory((current) =>
                pushHistory(current, { label, snapshot: captureSnapshot(), coalesce }),
            );
        },
        [captureSnapshot],
    );
    recordHistoryRef.current = recordHistory;

    /** Jumps to a point in the history list. Undo and redo are this, one step either way. */
    const goToHistory = useCallback(
        (index: number): void => {
            const entry = historyRef.current.entries[index];
            if (!entry) return;
            restoreSnapshot(entry.snapshot);
            setHistory((current) => ({ ...current, index }));
        },
        [restoreSnapshot],
    );

    /**
     * The state everything else is measured against.
     *
     * Recorded once whenever the history is empty and there's something loaded, so undo has
     * somewhere to land rather than stopping at the first thing you did.
     */
    useEffect(() => {
        if (history.entries.length > 0 || modelState.status !== "ready") return;
        recordHistory(loadedSeq === null ? "Model loaded" : "Animation loaded");
    }, [history.entries.length, loadedSeq, modelState.status, recordHistory]);

    const undo = useCallback((): boolean => {
        if (!canUndo(historyRef.current)) return false;
        goToHistory(historyRef.current.index - 1);
        return true;
    }, [goToHistory]);

    const redo = useCallback((): boolean => {
        if (!canRedo(historyRef.current)) return false;
        goToHistory(historyRef.current.index + 1);
        return true;
    }, [goToHistory]);

    /** The effective x/y/z a group currently has at `frameIndex` — a live edit if one exists,
     * else the raw decoded op value, else the type's identity default for an unkeyframed custom
     * group. Shared by the number/dial inputs and the gizmo's drag-start. */
    const resolveCurrentValue = useCallback(
        (frameIndex: number, groupId: number): { x: number; y: number; z: number } | null => {
            const raw = rawOldFrameRef.current;
            if (!raw || raw.index !== frameIndex) return null;

            const frameEdits = editsRef.current.get(frameIndex);
            const existingEdit = frameEdits?.get(groupId);
            if (existingEdit) return existingEdit;

            const opIndex = raw.frame.transformGroups.indexOf(groupId);
            if (opIndex >= 0) {
                return {
                    x: raw.frame.transformX[opIndex],
                    y: raw.frame.transformY[opIndex],
                    z: raw.frame.transformZ[opIndex],
                };
            }

            const type = getEffectiveBase(raw.frame.base).types[groupId];
            const tweened = interpolatedValue(groupId, frameIndex, type);
            if (tweened) return tweened;

            const custom = customGroupsRef.current.find((g) => g.id === groupId);
            const defaultValue = custom?.type === SeqTransformType.SCALE ? 128 : 0;
            return { x: defaultValue, y: defaultValue, z: defaultValue };
        },
        [getEffectiveBase, interpolatedValue],
    );

    const updateTransformValue = useCallback(
        (frameIndex: number, groupId: number, axis: "x" | "y" | "z", value: number): void => {
            if (Number.isNaN(value)) return;
            const current = resolveCurrentValue(frameIndex, groupId);
            if (!current) return;

            let frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits) {
                frameEdits = new Map();
                editsRef.current.set(frameIndex, frameEdits);
            }
            frameEdits.set(groupId, { ...current, [axis]: value });
            applyEffectiveOldFrame(frameIndex);
            // A gizmo drag or a run of keystrokes fires this continuously, so every call in one
            // go collapses into a single entry. `editSessionRef` is what separates one go from
            // the next — see where it's bumped.
            recordHistory(
                `${
                    TRANSFORM_TYPE_NAMES[
                        getEffectiveBase(rawOldFrameRef.current?.frame.base ?? EMPTY_BASE).types[
                            groupId
                        ]
                    ] ?? "Set"
                } ${axis.toUpperCase()} · frame ${frameIndex}`,
                `value:${editSessionRef.current}:${frameIndex}:${groupId}:${axis}`,
            );
        },
        [applyEffectiveOldFrame, getEffectiveBase, recordHistory, resolveCurrentValue],
    );

    const resetFrameEdits = useCallback(
        (frameIndex: number): void => {
            editsRef.current.delete(frameIndex);
            applyEffectiveOldFrame(frameIndex);
            recordHistory(`Reset frame ${frameIndex}`);
        },
        [applyEffectiveOldFrame, recordHistory],
    );

    const applySkeletalFrame = useCallback(
        (tick: number): void => {
            const def = defRef.current;
            const pose = poseRef.current;
            const skeletalBase = skeletalBaseRef.current;
            const skeletalSeq = skeletalSeqRef.current;
            if (!def || !pose || !skeletalBase || !skeletalSeq) return;

            resetPose(pose, def);
            animateSkeletalFrame(
                def,
                pose,
                skeletalBase,
                skeletalSeq,
                faceLabelGroupsRef.current,
                tick,
            );
            renderPose();
        },
        [renderPose],
    );

    const applyStep = useCallback(
        (n: number): void => {
            if (seqState.status !== "ready") return;
            if (seqState.kind === "old") applyOldFrame(n);
            else applySkeletalFrame(n);
        },
        [seqState, applyOldFrame, applySkeletalFrame],
    );

    const stopPlayback = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        setPlaying(false);
    }, []);

    useEffect(() => stopPlayback, [stopPlayback]);

    // Real-time playback: advances by whole 20ms client ticks (matching the real OSRS render
    // cadence), honoring each old-style frame's authored hold duration.
    const startPlayback = useCallback(() => {
        if (seqState.status !== "ready") return;
        stopPlayback();
        setPlaying(true);

        const total = seqState.kind === "old" ? seqState.frameCount : seqState.duration;
        let current = stepCountRef.current % Math.max(1, total);
        let accumulatedMs = 0;
        let lastTime: number | null = null;
        const TICK_MS = 20;

        const tick = (now: number): void => {
            if (lastTime === null) lastTime = now;
            accumulatedMs += now - lastTime;
            lastTime = now;

            let changed = false;
            if (seqState.kind === "old") {
                const seqType = seqTypeRef.current!;
                let holdMs = Math.max(1, seqType.frameLengths[current] ?? 1) * TICK_MS;
                while (accumulatedMs >= holdMs) {
                    accumulatedMs -= holdMs;
                    current = (current + 1) % total;
                    holdMs = Math.max(1, seqType.frameLengths[current] ?? 1) * TICK_MS;
                    changed = true;
                }
            } else {
                while (accumulatedMs >= TICK_MS) {
                    accumulatedMs -= TICK_MS;
                    current = (current + 1) % total;
                    changed = true;
                }
            }

            if (changed) {
                stepCountRef.current = current;
                setStep(current);
                applyStep(current);
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [seqState, stopPlayback, applyStep]);

    const onScrub = useCallback(
        (n: number) => {
            stopPlayback();
            stepCountRef.current = n;
            setStep(n);
            applyStep(n);
        },
        [stopPlayback, applyStep],
    );

    const onFrameStep = useCallback(
        (delta: number) => {
            if (seqState.status !== "ready") return;
            const total = seqState.kind === "old" ? seqState.frameCount : seqState.duration;
            const next = (stepCountRef.current + delta + total) % total;
            onScrub(next);
        },
        [seqState, onScrub],
    );

    const missingModelsIndex = cache !== null && !cache.indexExists(IndexType.DAT2.models);

    // Sequence bases are decoded per cache, so a different cache invalidates them.
    useEffect(() => {
        seqBaseCacheRef.current.clear();
    }, [cacheGeneration]);

    /**
     * Clears everything tied to the loaded sequence. The model's rig — its labels and custom
     * movements — deliberately survives, so you can rig once and try it against any sequence.
     */
    const resetSequenceState = (): void => {
        // Loading something else is a fresh start, not a step you can undo back across — the
        // states behind it belong to a model or an animation that's no longer open.
        setHistory(emptyHistory());
        seqConfigDirtyRef.current = false;
        editsRef.current.clear();
        rawOldFrameRef.current = null;
        allFramesRef.current = new Map();
        setSelection([]);
        setSelectMode(false);
        marqueeLiveRef.current = null;
        setMarquee(null);
        setActiveGizmoGroup(null);
        gizmoDragRef.current = null;
        modalRef.current = null;
        setModalInfo(null);
        setRowNames(new Map());
        setHiddenRows(new Set());
        setRowOrder(null);
        displayOrderRef.current = [];
    };

    /** A different model means a different rig, so this also drops labels and movements. */
    const resetEditorState = (): void => {
        resetSequenceState();
        customGroupsRef.current = [];
        setCustomGroups([]);
        vertexSkinsOverrideRef.current = null;
        mayaOverrideRef.current = null;
        setModelLabels([]);
        labelNamesRef.current = new Map();
        setLabelNames(labelNamesRef.current);
        setRenamingLabel(null);
        // Another model's labels mean nothing here, and a stale hide would black out geometry
        // that has nothing to do with it. The refs go too: the mesh is rebuilt in this same
        // tick, before the state lands.
        hiddenLabelsRef.current = new Set();
        isolatedLabelsRef.current = new Set();
        setHiddenLabels(hiddenLabelsRef.current);
        setIsolatedLabels(isolatedLabelsRef.current);
        // A new model drops whatever sequence was loaded, so Animation goes back to its list.
        setSidebarTab(workspace === "rigging" ? "labels" : "animations");
    };

    /**
     * Takes a decoded model as the one being edited, wherever it came from — the cache or an
     * imported file. Everything derived from the geometry is rebuilt here.
     */
    const adoptModel = useCallback(
        (def: RSModelDefinition, id: number) => {
            defRef.current = def;
            poseRef.current = createPosedModel(def);
            vertexLabelGroupsRef.current = buildLabelGroups(def.vertexSkins, def.vertexCount);
            faceLabelGroupsRef.current = buildLabelGroups(def.faceSkins, def.faceCount);
            adjacencyRef.current = buildVertexAdjacency(def);
            edgeListRef.current = buildEdgeList(def);
            refreshModelLabels();
            // Names this model's labels were given before, from the active workspace.
            loadedModelIdRef.current = id;
            labelNamesRef.current = labelNamesFor(id);
            setLabelNames(labelNamesRef.current);
            setColorGroups(groupVerticesByFaceColor(def));
            setBoneGroups(groupVerticesByBone(def, 1));
            setCreatingLabel(false);

            resetCamera();
            const mesh = buildViewMesh(def);
            meshRef.current = mesh;
            rendererRef.current?.setMesh(mesh);
            refreshPreviewMesh(def);
            setModelState({ status: "ready", triangleCount: mesh.vertexCount / 3 });
        },
        [buildViewMesh, labelNamesFor, refreshModelLabels, refreshPreviewMesh],
    );

    /** The model as it stands, including label edits — what an export should contain. */
    const currentModelForExport = useCallback((): RSModelDefinition | null => {
        const def = defRef.current;
        if (!def) return null;
        const skins = vertexSkinsOverrideRef.current;
        const maya = mayaOverrideRef.current;
        return {
            ...def,
            ...(skins ? { vertexSkins: skins } : {}),
            // Bones built here are part of the model, so they go out with it.
            ...(maya ? { animMayaGroups: maya.groups, animMayaScales: maya.scales } : {}),
        };
    }, []);

    /**
     * Whether the model differs from whatever is in the cache under its id.
     *
     * The two overrides are exactly "the rig was edited here", and a model that came from a file
     * isn't in the cache at all, so there's nothing to compare it against — either way it's
     * something worth packing.
     */
    const modelIsChanged = useCallback((): boolean => {
        return (
            vertexSkinsOverrideRef.current !== null ||
            mayaOverrideRef.current !== null ||
            modelFromFileRef.current
        );
    }, []);

    /** The model's bone weights as they stand, including any built in this session. */
    const mayaForGrouping = useCallback((): RSModelDefinition | null => {
        const def = defRef.current;
        if (!def) return null;
        const maya = mayaOverrideRef.current;
        return maya ? { ...def, animMayaGroups: maya.groups, animMayaScales: maya.scales } : def;
    }, []);

    /**
     * Starts an editable copy of the model's bone weights, so a model with no skeleton can be
     * given one without touching the decoded definition.
     */
    const ensureMayaOverride = useCallback((def: RSModelDefinition) => {
        if (mayaOverrideRef.current) return mayaOverrideRef.current;
        const groups: Int32Array[] = new Array(def.vertexCount);
        const scales: Int32Array[] = new Array(def.vertexCount);
        for (let v = 0; v < def.vertexCount; v++) {
            groups[v] = Int32Array.from(def.animMayaGroups?.[v] ?? []);
            scales[v] = Int32Array.from(def.animMayaScales?.[v] ?? []);
        }
        mayaOverrideRef.current = { groups, scales };
        return mayaOverrideRef.current;
    }, []);

    /** Weights the current selection to a bone, replacing whatever it had for that bone. */
    const assignSelectionToBone = useCallback(
        (bone: number, weight: number): string | null => {
            const def = defRef.current;
            if (!def) return null;
            const selected = selectedVerticesRef.current;
            if (selected.length === 0)
                return "Select some vertices first — a bone needs something to move.";

            const maya = ensureMayaOverride(def);
            const clamped = Math.max(1, Math.min(255, Math.round(weight)));
            for (const v of selected) {
                const bones = Array.from(maya.groups[v]);
                const weights = Array.from(maya.scales[v]);
                const existing = bones.indexOf(bone);
                if (existing >= 0) {
                    weights[existing] = clamped;
                } else {
                    bones.push(bone);
                    weights.push(clamped);
                }
                maya.groups[v] = Int32Array.from(bones);
                maya.scales[v] = Int32Array.from(weights);
            }
            const source = mayaForGrouping();
            if (source) setBoneGroups(groupVerticesByBone(source, minWeight));
            recordHistory(`Weight to bone ${bone}`);
            return null;
        },
        [ensureMayaOverride, mayaForGrouping, minWeight, recordHistory],
    );

    /** Takes a bone off every vertex that carried it. */
    const removeBone = useCallback(
        (bone: number) => {
            const def = defRef.current;
            if (!def) return;
            const maya = ensureMayaOverride(def);
            for (let v = 0; v < def.vertexCount; v++) {
                const bones = Array.from(maya.groups[v]);
                const at = bones.indexOf(bone);
                if (at < 0) continue;
                const weights = Array.from(maya.scales[v]);
                bones.splice(at, 1);
                weights.splice(at, 1);
                maya.groups[v] = Int32Array.from(bones);
                maya.scales[v] = Int32Array.from(weights);
            }
            const source = mayaForGrouping();
            if (source) setBoneGroups(groupVerticesByBone(source, minWeight));
            recordHistory(`Remove bone ${bone}`);
        },
        [ensureMayaOverride, mayaForGrouping, minWeight, recordHistory],
    );

    /** Lowest bone id nothing is weighted to yet. */
    const nextFreeBone = useCallback((): number => {
        const used = new Set(boneGroups.map((group) => group.bone));
        let candidate = 0;
        while (used.has(candidate)) candidate++;
        return candidate;
    }, [boneGroups]);

    const handleExportModel = useCallback(
        (format: ModelFormat) => {
            const def = currentModelForExport();
            if (!def) return;
            try {
                downloadExport(exportModel(def, format), `model_${def.id}`);
                setIoMessage(null);
            } catch (err) {
                setIoMessage({
                    text: err instanceof Error ? err.message : String(err),
                    tone: "error",
                });
            }
        },
        [currentModelForExport],
    );

    /**
     * Opens the file picker, narrowed to one format when the menu asked for one. The `accept`
     * list is set just before opening so a single hidden input can serve every menu entry.
     */
    const openImportPicker = useCallback((format: ModelFormat | null) => {
        const input = importInputRef.current;
        if (!input) return;
        const extension = MODEL_FORMATS.find((f) => f.id === format)?.extension;
        input.accept = extension ? `.${extension}` : ".dat,.json,.obj,.gltf,.glb";
        input.click();
    }, []);

    /** Replaces whatever is loaded with the file's model. */
    const loadModelFile = useCallback(
        async (file: File, format: ModelFormat) => {
            stopPlayback();
            setSeqState({ status: "empty" });
            setLoadedSeq(null);
            setPreviewingSeq(false);
            setModelState({ status: "loading" });
            resetEditorState();
            try {
                const id = Number.parseInt(modelId, 10);
                const imported = await importModel(file, format, Number.isNaN(id) ? 0 : id);
                modelFromFileRef.current = true;
                adoptModel(imported.def, Number.isNaN(id) ? 0 : id);
                setIoMessage(imported.note ? { text: imported.note, tone: "info" } : null);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setModelState({ status: "error", message });
                setIoMessage({ text: `${file.name}: ${message}`, tone: "error" });
            }
        },
        [adoptModel, modelId, stopPlayback],
    );

    /** Merges the file's model into the one on screen, keeping both. */
    const addModelFileToScene = useCallback(
        async (file: File, format: ModelFormat) => {
            const current = currentModelForExport();
            if (!current) {
                await loadModelFile(file, format);
                return;
            }
            stopPlayback();
            try {
                const incoming = await importModel(file, format, current.id);
                // Merging renumbers vertices, so the rig built against the old numbering has to
                // go; the labels themselves survive inside the merged model.
                resetEditorState();
                modelFromFileRef.current = true;
                adoptModel(finalizeImportedModel(mergeModels(current, incoming.def)), current.id);
                setIoMessage(incoming.note ? { text: incoming.note, tone: "info" } : null);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setIoMessage({ text: `${file.name}: ${message}`, tone: "error" });
            }
        },
        [adoptModel, currentModelForExport, loadModelFile, stopPlayback],
    );

    const onImportModelFile = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;

            const format = formatFromFileName(file.name);
            if (!format) {
                setIoMessage({
                    text: `Don't know how to read "${file.name}" — expected .dat, .json, .obj, .gltf or .glb`,
                    tone: "error",
                });
                return;
            }
            await loadModelFile(file, format);
        },
        [loadModelFile],
    );

    /**
     * A file dropped on the viewport could mean either thing, so with a model already open it
     * asks rather than guessing. With an empty viewport there's nothing to add to, so it loads.
     */
    const onViewportDrop = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setDraggingFile(false);

            const file = event.dataTransfer.files?.[0];
            if (!file) return;
            const format = formatFromFileName(file.name);
            if (!format) {
                setIoMessage({
                    text: `Don't know how to read "${file.name}" — expected .dat, .json, .obj, .gltf or .glb`,
                    tone: "error",
                });
                return;
            }
            if (modelState.status !== "ready") {
                void loadModelFile(file, format);
                return;
            }
            setPendingDrop({ file, format });
        },
        [loadModelFile, modelState.status],
    );

    const loadModelById = useCallback(
        (id: number) => {
            if (!cache || Number.isNaN(id)) return;

            stopPlayback();
            setSeqState({ status: "empty" });
            setLoadedSeq(null);
            setPreviewingSeq(false);
            setModelState({ status: "loading" });
            resetEditorState();
            try {
                const file = cache.getIndex(IndexType.DAT2.models).getFile(id, 0);
                if (!file) throw new Error(`Model ${id} not found in cache`);
                modelFromFileRef.current = false;
                adoptModel(decodeRSModel(id, arrayBufferOf(file)), id);
            } catch (err) {
                setModelState({
                    status: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [adoptModel, cache, stopPlayback],
    );

    const handleLoadModel = useCallback(() => {
        loadModelById(Number.parseInt(modelId, 10));
    }, [loadModelById, modelId]);

    /**
     * Loads a cache sequence onto the model. `preview` means the list's play button asked for
     * it: the sequence runs, but the editor stays closed and the panel stays on the list.
     */
    const loadSequenceById = useCallback(
        (id: number, preview = false) => {
            const def = defRef.current;
            if (!cache || !def || Number.isNaN(id)) return;

            stopPlayback();
            setSeqState({ status: "loading" });
            setLoadedSeq(id);
            setPreviewingSeq(preview);
            setInspector(null);
            resetSequenceState();
            try {
                const seqFile = cache
                    .getIndex(IndexType.DAT2.configs)
                    .getFile(ConfigType.DAT2.seqs, id);
                if (!seqFile) throw new Error(`Sequence ${id} not found`);
                const seqType = decodeSeqType(id, bytesOf(seqFile));
                seqTypeRef.current = seqType;
                stepCountRef.current = 0;
                setStep(0);

                if (seqType.isSkeletalSeq()) {
                    const mayaFile = cache
                        .getIndex(IndexType.OSRS.animKeyFrames)
                        .getArchive(seqType.skeletalId >>> 16)
                        .getFile(seqType.skeletalId & 0xffff);
                    if (!mayaFile)
                        throw new Error(
                            "Skeletal animation data not found (main_file_cache.idx22)",
                        );
                    const mayaBytes = bytesOf(mayaFile);
                    const base = resolveSeqBase(cache, peekSkeletalSeqBaseId(mayaBytes));
                    if (!base.skeletalBase)
                        throw new Error("Sequence base has no embedded skeletal rig");
                    skeletalBaseRef.current = base.skeletalBase;
                    skeletalSeqRef.current = decodeSkeletalSeq(seqType.skeletalId, base, mayaBytes);

                    const duration = Math.max(1, seqType.getSkeletalDuration());
                    setSeqState({
                        status: "ready",
                        kind: "skeletal",
                        duration,
                        boneCount: base.skeletalBase.getBoneCount(),
                    });
                    if (!preview) setSidebarTab("keyframe");
                    applySkeletalFrame(0);
                } else {
                    if (seqType.frameIds.length === 0) throw new Error("Sequence has no frames");

                    const framesIndex = cache.getIndex(IndexType.DAT2.animations);
                    const decoded = new Map<number, SeqFrame>();
                    for (let i = 0; i < seqType.frameIds.length; i++) {
                        const packedId = seqType.frameIds[i];
                        const file = framesIndex
                            .getArchive(packedId >>> 16)
                            .getFile(packedId & 0xffff);
                        if (!file) continue;
                        const bytes = bytesOf(file);
                        const frameBase = resolveSeqBase(cache, peekSeqFrameBaseId(bytes));
                        decoded.set(i, decodeSeqFrame(frameBase, bytes));
                    }
                    allFramesRef.current = decoded;

                    setSeqState({
                        status: "ready",
                        kind: "old",
                        frameCount: seqType.frameIds.length,
                    });
                    if (!preview) setSidebarTab("keyframe");
                    applyOldFrame(0);
                }
            } catch (err) {
                setSeqState({
                    status: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [cache, stopPlayback, resolveSeqBase, applySkeletalFrame, applyOldFrame],
    );

    /**
     * Starts an empty animation of the given length on the model that's already loaded.
     *
     * It gets a `SeqBase` with no transform groups of its own: the movements you build in the
     * rigging workspace are overlaid onto whatever base is loaded, so a blank one means the
     * animation is made entirely of your own movements. Every frame starts with no ops, which is
     * an empty dope sheet ready to be keyed.
     */
    /**
     * Opens an animation pack — every frame of one animation in a single file.
     *
     * The frames come back as the cache stores them, so they're decoded against the bases they
     * name and dropped in as an ordinary old-style animation. It needs a model already open,
     * because a frame without the rig it moves is just numbers.
     */
    const loadAnimPack = useCallback(
        async (file: File) => {
            const def = defRef.current;
            if (!def) {
                setIoMessage({
                    text: "Load a model first — frames need a rig to move.",
                    tone: "error",
                });
                return;
            }
            if (!cache) {
                setIoMessage({
                    text: "Open a cache first: the frames name the rig bases they were built against.",
                    tone: "error",
                });
                return;
            }

            stopPlayback();
            setInspector(null);
            resetSequenceState();
            try {
                const pack = decodeAnimPack(new Uint8Array(await file.arrayBuffer()));

                const seq = new SeqType(NEW_SEQ_ID);
                const frames = new Map<number, SeqFrame>();
                pack.frames.forEach((packed, i) => {
                    const base = resolveSeqBase(cache, peekSeqFrameBaseId(packed.data));
                    frames.set(i, decodeSeqFrame(base, packed.data));
                    seq.frameIds.push((pack.archive << 16) | packed.file);
                    seq.frameLengths.push(NEW_ANIM_FRAME_LENGTH);
                });
                if (frames.size === 0) throw new Error("That pack has no frames in it.");

                seqTypeRef.current = seq;
                allFramesRef.current = frames;
                stepCountRef.current = 0;
                setStep(0);
                setLoadedSeq("new");
                setPreviewingSeq(false);
                setSeqState({ status: "ready", kind: "old", frameCount: frames.size });
                setSidebarTab("keyframe");
                applyOldFrame(0);
                setIoMessage({
                    text: `Loaded ${frames.size} frames from ${file.name} (archive ${pack.archive}).`,
                    tone: "info",
                });
            } catch (err) {
                setSeqState({
                    status: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [applyOldFrame, cache, resolveSeqBase, stopPlayback],
    );

    const createAnimation = useCallback(
        (frameCount: number) => {
            if (!defRef.current) return;

            stopPlayback();
            setInspector(null);
            resetSequenceState();

            const seq = new SeqType(NEW_SEQ_ID);
            seq.frameIds = new Array(frameCount).fill(0);
            seq.frameLengths = new Array(frameCount).fill(NEW_ANIM_FRAME_LENGTH);
            seqTypeRef.current = seq;

            const base = new SeqBase(NEW_SEQ_ID, 0, [], []);
            const frames = new Map<number, SeqFrame>();
            for (let i = 0; i < frameCount; i++) {
                frames.set(i, new SeqFrame(base, 0, [], [], [], [], [], false));
            }
            allFramesRef.current = frames;

            stepCountRef.current = 0;
            setStep(0);
            setLoadedSeq("new");
            setPreviewingSeq(false);
            setSeqState({ status: "ready", kind: "old", frameCount });
            setSidebarTab("keyframe");
            applyOldFrame(0);
        },
        [applyOldFrame, stopPlayback],
    );

    /**
     * Playback can't start in the same tick a sequence loads — `startPlayback` reads the state
     * that's still being set — so the play button on a list row arms this instead.
     */
    const playOnLoadRef = useRef(false);
    useEffect(() => {
        if (!playOnLoadRef.current || seqState.status !== "ready") return;
        playOnLoadRef.current = false;
        startPlayback();
    }, [seqState, startPlayback]);

    /**
     * TEMPORARY: drops straight into a known scene, so testing doesn't start with typing an id
     * and hunting for a sequence. Delete along with the toolbar button it's behind.
     */
    const loadTestScene = useCallback(() => {
        loadModelById(TEST_MODEL_ID);
        setModelId(String(TEST_MODEL_ID));

        const match = gameVals?.all("sequences").find((entry) => entry.name === TEST_SEQ_NAME);
        if (!match) {
            setIoMessage({
                text: `No sequence named "${TEST_SEQ_NAME}" in this cache`,
                tone: "error",
            });
            return;
        }
        loadSequenceById(match.id);
    }, [gameVals, loadModelById, loadSequenceById]);

    /**
     * Works out everything that could be packed and opens the export dialog on it. What actually
     * downloads is whatever is ticked there — this only decides what's offered and what starts
     * ticked, which is the parts that have changed.
     */
    /**
     * Whether a frame archive is free, and the first one that is.
     *
     * Frames pack into index 0 as an archive of consecutive files, so what has to be free is the
     * whole archive — writing into one that already holds an animation would overwrite it.
     */
    const frameArchiveState = useCallback(
        (archive: number): FrameTarget => {
            if (!cache || !cache.indexExists(IndexType.DAT2.animations)) {
                return { archive, free: true };
            }
            const index = cache.getIndex(IndexType.DAT2.animations);
            if (!index.archiveExists(archive)) return { archive, free: true };
            const count = index.getFileCount(archive);
            return {
                archive,
                free: count === 0,
                conflict:
                    count === 0
                        ? undefined
                        : `archive ${archive} already holds ${count} frame${
                              count === 1 ? "" : "s"
                          }`,
            };
        },
        [cache],
    );

    /** The lowest archive in index 0 that nothing occupies, so the default never clobbers. */
    const firstFreeFrameArchive = useCallback((): number => {
        if (!cache || !cache.indexExists(IndexType.DAT2.animations)) return 0;
        const index = cache.getIndex(IndexType.DAT2.animations);
        const taken = new Set(Array.from(index.getArchiveIds()));
        let archive = 0;
        while (taken.has(archive)) archive++;
        return archive;
    }, [cache]);

    const exportBundle = useCallback(
        (frameArchive?: number) => {
            const def = currentModelForExport();
            const seq = seqTypeRef.current;
            const archive = frameArchive ?? firstFreeFrameArchive();

            // The frames as they actually are, not the raw ones — everything keyed here lives in
            // the edits until the two are merged, so raw frames would export an empty animation.
            const frames: { index: number; frame: SeqFrame }[] = [];
            if (seq) {
                for (let i = 0; i < seq.frameIds.length; i++) {
                    const effective = effectiveFrameAt(i);
                    if (effective) frames.push({ index: i, frame: effective.frame });
                }
            }

            setExportPlan(
                planBundle({
                    model: def ? { def, id: def.id, changed: modelIsChanged() } : null,
                    sequence:
                        seq && seqState.status === "ready"
                            ? {
                                  seq,
                                  frames,
                                  id: typeof loadedSeq === "number" ? loadedSeq : null,
                                  name: typeof loadedSeq === "number" ? loadedSeqName : null,
                                  // One started here is new in its entirety, keys or not.
                                  framesChanged: editsRef.current.size > 0 || loadedSeq === "new",
                                  configChanged: seqConfigDirtyRef.current || loadedSeq === "new",
                                  target: frameArchiveState(archive),
                              }
                            : null,
                }),
            );
        },
        [
            currentModelForExport,
            effectiveFrameAt,
            firstFreeFrameArchive,
            frameArchiveState,
            loadedSeq,
            loadedSeqName,
            modelIsChanged,
            seqState.status,
        ],
    );

    /** Plays a sequence on the model without opening it for editing. */
    const previewSequence = useCallback(
        (id: number) => {
            playOnLoadRef.current = true;
            loadSequenceById(id, true);
        },
        [loadSequenceById],
    );

    /**
     * The same, held back a moment. Arrowing down the suggestions previews each one, and a held
     * key would otherwise decode a whole sequence per repeat.
     */
    const previewTimerRef = useRef<number | null>(null);
    const previewSequenceSoon = useCallback(
        (id: number) => {
            if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
            previewTimerRef.current = window.setTimeout(() => {
                previewTimerRef.current = null;
                previewSequence(id);
            }, 120);
        },
        [previewSequence],
    );
    useEffect(
        () => () => {
            if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
        },
        [],
    );

    /**
     * Every sequence id the cache holds, straight from the archive's file table — no sequence is
     * decoded to build this, so opening the list costs nothing even on a full cache.
     */
    const sequenceIds = useMemo((): number[] => {
        if (!cache) return [];
        try {
            const ids = cache.getIndex(IndexType.DAT2.configs).getFileIds(ConfigType.DAT2.seqs);
            return ids ? Array.from(ids) : [];
        } catch {
            return [];
        }
    }, [cache]);

    /**
     * The sequences the list shows, each with whatever the cache's gamevals call it. Caches
     * without gamevals just get ids, which is what this looked like before they existed.
     */
    const sequenceRows = useMemo((): { id: number; name: string | null }[] => {
        const names = gameVals?.map("sequences");
        return sequenceIds.map((id) => ({ id, name: names?.get(id)?.name ?? null }));
    }, [gameVals, sequenceIds]);

    /** Rows matching what's been typed — against the name as well as the id. */
    const matchingSequences = useMemo(() => {
        const query = searchQuery(animSearch);
        if (query === "") return sequenceRows;
        return sequenceRows.filter(
            (row) =>
                String(row.id).includes(query) ||
                (row.name?.toLowerCase().includes(query) ?? false),
        );
    }, [animSearch, sequenceRows]);

    /**
     * The best few matches, offered under the search box. Ranked rather than listed in id order,
     * so typing "walk" puts the walks first instead of whichever sequence happens to be lowest.
     */
    const animSuggestions = useMemo(() => {
        const query = searchQuery(animSearch);
        if (query === "") return [];
        return matchingSequences
            .map((row) => ({ row, rank: rankSequenceMatch(row, query) }))
            .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.row.id - b.row.id))
            .slice(0, ANIM_SUGGESTION_LIMIT)
            .map((scored) => scored.row);
    }, [animSearch, matchingSequences]);

    useEffect(() => {
        selectModeRef.current = selectMode;
    }, [selectMode]);

    useEffect(() => {
        selectElementRef.current = selectElement;
    }, [selectElement]);

    useEffect(() => {
        workspaceRef.current = workspace;
    }, [workspace]);

    // Switching workspace switches which set of label names applies to the loaded model.
    const activeWorkspaceId = activeWorkspace?.id ?? null;
    useEffect(() => {
        const id = loadedModelIdRef.current;
        if (id !== null) {
            labelNamesRef.current = labelNamesFor(id);
            setLabelNames(labelNamesRef.current);
        }
        // `labelNamesFor` changes identity on every save, which would re-read for no reason.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWorkspaceId]);

    useEffect(() => {
        previewOpenRef.current = previewOpen;
        // Opening it mid-session has to catch up with wherever the pose already is.
        if (previewOpen) refreshPreviewMesh();
    }, [previewOpen, refreshPreviewMesh]);

    useEffect(() => {
        activeGizmoGroupRef.current = activeGizmoGroup;
    }, [activeGizmoGroup]);

    useEffect(() => {
        showVerticesRef.current = showVertices;
    }, [showVertices]);

    useEffect(() => {
        xrayRef.current = xray;
        // X-ray is baked into the mesh's face alphas, so flipping it means rebuilding.
        renderPose();
    }, [xray, renderPose]);

    useEffect(() => {
        hiddenLabelsRef.current = hiddenLabels;
        isolatedLabelsRef.current = isolatedLabels;
        // Hiding changes which geometry exists in the mesh, so the viewport has to be rebuilt
        // rather than just redrawn. `renderPose` is synchronous, so the new mesh is ready to read.
        renderPose();
        setVisibleTriangles(
            hiddenLabels.size > 0 || isolatedLabels.size > 0
                ? Math.round((meshRef.current?.vertexCount ?? 0) / 3)
                : null,
        );
    }, [hiddenLabels, isolatedLabels, renderPose]);

    useEffect(() => {
        // "both" draws the wireframe over the shaded faces; "wireframe" is only reached by
        // turning faces off, which is the one case where the model itself should disappear.
        const renderMode: RSModelRenderMode = showFaces
            ? showEdges
                ? "both"
                : "solid"
            : "wireframe";
        renderModeRef.current = renderMode;
        rendererRef.current?.setOptions({ renderMode, useColors: true, showGrid: true });
        // Only shading changes the mesh itself; toggling edges is a renderer option.
        const shadingChanged = shadingRef.current !== shading;
        shadingRef.current = shading;
        if (shadingChanged) renderPose();
    }, [showFaces, showEdges, shading, renderPose]);

    useEffect(() => {
        if (modelState.status !== "ready") return;
        const canvas = canvasRef.current;
        const overlay = vertexOverlayRef.current;
        const container = containerRef.current;
        const def = defRef.current;
        if (!canvas || !overlay || !container || !def) return;

        const renderer = new RSModelRenderer(canvas);
        rendererRef.current = renderer;
        // Blender always shows a ground grid under the object. The render mode has to match the
        // toggles here too — this effect runs after the one that watches them, so it would
        // otherwise leave the first frame out of step with what the buttons say.
        renderer.setOptions({ renderMode: renderModeRef.current, useColors: true, showGrid: true });
        const mesh = buildViewMesh(def);
        meshRef.current = mesh;
        renderer.setMesh(mesh);

        const resize = (): void => {
            const rect = container.getBoundingClientRect();
            renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
            overlay.width = rect.width;
            overlay.height = rect.height;
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);

        let frame = requestAnimationFrame(function tick() {
            renderer.setCamera(cameraRef.current);
            renderer.render();
            drawVertexOverlay();
            frame = requestAnimationFrame(tick);
        });

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            renderer.dispose();
            rendererRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelState.status === "ready"]);

    const onPointerDown = useCallback(
        (event: React.PointerEvent<HTMLCanvasElement>) => {
            // Touching the viewport hands the keyboard back, so bare hotkeys work again after
            // you've typed in a field.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            lastMouseRef.current = { x, y };

            // A modal transform ends on any click: right-click cancels, anything else confirms.
            if (modalRef.current) {
                if (event.button === 2) cancelModalRef.current();
                else confirmModalRef.current();
                return;
            }
            // Blender orbits with the middle mouse in every mode.
            if (event.button === 1) {
                dragRef.current = { x: event.clientX, y: event.clientY };
                return;
            }
            if (event.button === 2) return;

            if (!selectMode) {
                const gizmo = gizmoStateRef.current;
                if (gizmo) {
                    const axis =
                        gizmo.kind === "rotate"
                            ? hitTestRotateHandle(gizmo.handles, { x, y })
                            : hitTestTranslateHandle(gizmo.handles, { x, y });
                    if (axis) {
                        const current = resolveCurrentValue(stepCountRef.current, gizmo.group);
                        if (current) {
                            const startValue = current[axis];
                            if (gizmo.kind === "translate" || gizmo.kind === "scale") {
                                const handle = gizmo.handles.find((h) => h.axis === axis)!;
                                const screenLen =
                                    Math.hypot(
                                        handle.end.x - handle.start.x,
                                        handle.end.y - handle.start.y,
                                    ) || 1;
                                const mesh = meshRef.current;
                                const worldSize = (mesh?.bounds.radius ?? 0) * GIZMO_SIZE_FACTOR;
                                const unitsPerPixel =
                                    gizmo.kind === "scale"
                                        ? SCALE_RANGE_PER_HANDLE / screenLen
                                        : worldSize / screenLen;
                                gizmoDragRef.current = {
                                    kind: gizmo.kind,
                                    group: gizmo.group,
                                    axis,
                                    startValue,
                                    startX: x,
                                    startY: y,
                                    dirX: (handle.end.x - handle.start.x) / screenLen,
                                    dirY: (handle.end.y - handle.start.y) / screenLen,
                                    unitsPerPixel,
                                };
                            } else {
                                gizmoDragRef.current = {
                                    kind: "rotate",
                                    group: gizmo.group,
                                    axis,
                                    startValue,
                                    pivotScreen: gizmo.pivotScreen,
                                    startAngle: Math.atan2(
                                        y - gizmo.pivotScreen.y,
                                        x - gizmo.pivotScreen.x,
                                    ),
                                };
                            }
                        }
                        return;
                    }
                }
            }

            if (selectMode && (event.ctrlKey || event.altKey)) {
                // Either modifier turns the select tool into a box: Ctrl adds what it covers,
                // Alt takes it away. A press that never travels is a click instead, so that's
                // armed too and pointerup decides which it was.
                marqueeStartRef.current = { x, y };
                marqueeSubtractRef.current = event.altKey;
                marqueeLiveRef.current = { x0: x, y0: y, x1: x, y1: y };
                setMarquee({ x0: x, y0: y, x1: x, y1: y });
                clickStartRef.current = { x, y, subtract: true };
            } else {
                // Otherwise the drag orbits, and a release that barely moved counts as a click
                // on whatever is under the pointer.
                if (selectMode) clickStartRef.current = { x, y, subtract: false };
                dragRef.current = { x: event.clientX, y: event.clientY };
            }
        },
        [selectMode, resolveCurrentValue],
    );

    const onPointerMove = useCallback(
        (event: React.PointerEvent<HTMLCanvasElement>) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            lastMouseRef.current = { x, y };

            const modal = modalRef.current;
            if (modal) {
                const mesh = meshRef.current;
                let deltaPx = x - modal.anchorX;
                if (event.shiftKey) deltaPx *= 0.1; // Blender: Shift = precision
                let value: number;
                if (modal.kind === "translate") {
                    const unitsPerPixel = ((mesh?.bounds.radius ?? 0) * GIZMO_SIZE_FACTOR) / 120;
                    value = modal.original[modal.axis] + Math.round(deltaPx * unitsPerPixel);
                } else if (modal.kind === "rotate") {
                    value =
                        (modal.original[modal.axis] +
                            Math.round((deltaPx * 0.5) / DEGREES_PER_UNIT)) &
                        0xff;
                } else {
                    value = Math.max(
                        0,
                        Math.min(
                            255,
                            modal.original[modal.axis] +
                                Math.round(deltaPx * (SCALE_RANGE_PER_HANDLE / 200)),
                        ),
                    );
                }
                updateTransformValue(stepCountRef.current, modal.group, modal.axis, value);
                return;
            }

            const gizmoDrag = gizmoDragRef.current;
            if (gizmoDrag) {
                if (gizmoDrag.kind === "translate" || gizmoDrag.kind === "scale") {
                    const dx = x - gizmoDrag.startX;
                    const dy = y - gizmoDrag.startY;
                    const alongPx = dx * gizmoDrag.dirX + dy * gizmoDrag.dirY;
                    const delta = Math.round(alongPx * gizmoDrag.unitsPerPixel);
                    const newValue =
                        gizmoDrag.kind === "scale"
                            ? Math.max(0, Math.min(255, gizmoDrag.startValue + delta))
                            : gizmoDrag.startValue + delta;
                    updateTransformValue(
                        stepCountRef.current,
                        gizmoDrag.group,
                        gizmoDrag.axis,
                        newValue,
                    );
                } else {
                    const angle = Math.atan2(
                        y - gizmoDrag.pivotScreen.y,
                        x - gizmoDrag.pivotScreen.x,
                    );
                    const deltaDeg = (angle - gizmoDrag.startAngle) * (180 / Math.PI);
                    const deltaRaw = Math.round(deltaDeg / (360 / 256));
                    updateTransformValue(
                        stepCountRef.current,
                        gizmoDrag.group,
                        gizmoDrag.axis,
                        (gizmoDrag.startValue + deltaRaw) & 0xff,
                    );
                }
                return;
            }

            // Orbit (left-drag outside select mode, or middle-drag anywhere) takes priority over
            // the marquee so middle-mouse orbiting works while box-selecting, like Blender.
            const drag = dragRef.current;
            if (drag) {
                const dx = event.clientX - drag.x;
                const dy = event.clientY - drag.y;
                dragRef.current = { x: event.clientX, y: event.clientY };
                const camera = cameraRef.current;
                camera.yaw += dx * 0.01;
                camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + dy * 0.01));
                return;
            }

            if (selectMode) {
                const start = marqueeStartRef.current;
                if (!start) return;
                marqueeLiveRef.current = { x0: start.x, y0: start.y, x1: x, y1: y };
                setMarquee({ x0: start.x, y0: start.y, x1: x, y1: y });
            }
        },
        [selectMode, updateTransformValue],
    );

    /** Everything a box covers, per element mode: whole edges and faces, not stray corners. */
    const pickInBox = useCallback(
        (
            minX: number,
            maxX: number,
            minY: number,
            maxY: number,
            width: number,
            height: number,
        ): number[] => {
            const def = defRef.current;
            const mesh = meshRef.current;
            if (!def || !mesh) return [];

            const vp = computeViewProjection(cameraRef.current, mesh.bounds, width / height);
            const depth = xrayRef.current
                ? null
                : buildDepthBuffer(vp, mesh.positions, mesh.vertexCount, width, height);
            const p = projectVertices(
                vp,
                width,
                height,
                depth,
                mesh.bounds.radius * DEPTH_BIAS_FACTOR,
            );
            if (!p) return [];

            const inside = (v: number): boolean =>
                p.ok[v] === 1 &&
                p.x[v] >= minX &&
                p.x[v] <= maxX &&
                p.y[v] >= minY &&
                p.y[v] <= maxY;

            const element = selectElementRef.current;
            const out: number[] = [];
            if (element === "vertex") {
                for (let v = 0; v < p.ok.length; v++) if (inside(v)) out.push(v);
            } else if (element === "edge") {
                const edges = edgeListRef.current;
                for (let e = 0; e + 1 < edges.length; e += 2) {
                    if (inside(edges[e]) && inside(edges[e + 1])) out.push(e);
                }
            } else {
                for (let f = 0; f < def.faceCount; f++) {
                    if (
                        inside(def.faceVertexIndices1[f]) &&
                        inside(def.faceVertexIndices2[f]) &&
                        inside(def.faceVertexIndices3[f])
                    ) {
                        out.push(f);
                    }
                }
            }
            return out;
        },
        [projectVertices],
    );

    const onPointerUp = useCallback(
        (event: React.PointerEvent<HTMLCanvasElement>) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            dragRef.current = null;

            if (gizmoDragRef.current) {
                gizmoDragRef.current = null;
                editSessionRef.current++;
                return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            if (selectMode && marqueeStartRef.current) {
                const start = marqueeStartRef.current;
                marqueeStartRef.current = null;
                marqueeLiveRef.current = null;
                setMarquee(null);

                const minX = Math.min(start.x, x);
                const maxX = Math.max(start.x, x);
                const minY = Math.min(start.y, y);
                const maxY = Math.max(start.y, y);
                if (maxX - minX > 2 || maxY - minY > 2) {
                    applyPick(
                        pickInBox(minX, maxX, minY, maxY, rect.width, rect.height),
                        marqueeSubtractRef.current,
                    );
                    clickStartRef.current = null;
                    return;
                }
                // Too small to have been a box, so it was a Ctrl+click after all. Falls through
                // to the click below, which takes whatever is under the pointer away.
            }

            const click = clickStartRef.current;
            clickStartRef.current = null;
            if (selectMode && click && Math.hypot(x - click.x, y - click.y) <= CLICK_SLOP) {
                const picked = pickAt(x, y, rect.width, rect.height);
                if (picked !== null) applyPick([picked], click.subtract);
            }
        },
        [selectMode, applyPick, pickAt, pickInBox],
    );

    const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
        const camera = cameraRef.current;
        camera.zoom = Math.max(0.3, Math.min(10, camera.zoom * (1 + event.deltaY * 0.001)));
    }, []);

    const handleCreateMovement = useCallback(() => {
        const def = defRef.current;
        const label = Number.parseInt(newLabelId, 10);
        const selected = selectedVerticesRef.current;
        const name = newMovementName.trim();
        if (
            !def ||
            selected.length === 0 ||
            Number.isNaN(label) ||
            label < 0 ||
            label > 255 ||
            !name
        )
            return;

        const skins =
            vertexSkinsOverrideRef.current ??
            (def.vertexSkins ? def.vertexSkins.slice() : new Int32Array(def.vertexCount).fill(-1));
        for (const v of selected) skins[v] = label;
        vertexSkinsOverrideRef.current = skins;
        vertexLabelGroupsRef.current = buildLabelGroups(skins, def.vertexCount);
        refreshModelLabels();

        // Monotonic, so deleting a movement can't hand its id to the next one while old
        // keyframes still reference it.
        const nextGroupId =
            customGroupsRef.current.reduce(
                (max, g) => Math.max(max, g.id),
                CUSTOM_GROUP_ID_BASE - 1,
            ) + 1;
        const color = GROUP_COLORS[customGroupsRef.current.length % GROUP_COLORS.length];
        const group: CustomGroup = {
            id: nextGroupId,
            type: newMovementType,
            label,
            name,
            color,
            vertexIndices: selected,
        };
        customGroupsRef.current = [...customGroupsRef.current, group];
        setCustomGroups(customGroupsRef.current);

        setSelection([]);
        setSelectMode(false);
        setNewMovementName("");

        applyEffectiveOldFrame(stepCountRef.current);
        recordHistory(`Create movement · ${name}`);
    }, [
        newLabelId,
        newMovementType,
        newMovementName,
        applyEffectiveOldFrame,
        recordHistory,
        refreshModelLabels,
    ]);

    /**
     * Gives labels a movement of one kind — one label, or all of them at once.
     *
     * An animation started here begins with no movements at all: the model's labels say which
     * vertices belong together, but nothing yet says what any of them *do*, and the timeline has
     * a row per movement rather than per label. Labels that already move that way are skipped,
     * so running it twice does nothing the second time.
     */
    const addMovements = useCallback(
        (labels: readonly number[], type: SeqTransformType) => {
            if (!defRef.current) return;

            const taken = new Set(customGroupsRef.current.map((g) => `${g.label}:${g.type}`));
            const byLabel = vertexLabelGroupsRef.current;
            let nextId =
                customGroupsRef.current.reduce(
                    (max, g) => Math.max(max, g.id),
                    CUSTOM_GROUP_ID_BASE - 1,
                ) + 1;

            const added: CustomGroup[] = [];
            for (const label of labels) {
                if (taken.has(`${label}:${type}`)) continue;
                added.push({
                    id: nextId++,
                    type,
                    label,
                    name: labelNames.get(label) ?? `L${label}`,
                    color: GROUP_COLORS[
                        (customGroupsRef.current.length + added.length) % GROUP_COLORS.length
                    ],
                    vertexIndices: Array.from(byLabel[label] ?? []),
                });
            }
            if (added.length === 0) return;

            customGroupsRef.current = [...customGroupsRef.current, ...added];
            setCustomGroups(customGroupsRef.current);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(
                added.length === 1
                    ? `Add movement · ${added[0].name}`
                    : `Add ${added.length} movements`,
            );
        },
        [applyEffectiveOldFrame, labelNames, recordHistory],
    );

    const clearSelection = useCallback(() => {
        // Nothing to record when there was nothing selected — it would be an entry that undoes
        // to the state it was already in.
        const had = selectionRef.current.ids.size > 0;
        selectionRef.current = { element: selectElementRef.current, ids: new Set() };
        setSelectedElements(0);
        setSelection([]);
        if (had) recordHistoryRef.current("Deselect all", `selection:${editSessionRef.current}`);
    }, [setSelection]);

    /**
     * Switches element mode, carrying the selection across the way Blender does: the vertices
     * you had stay selected, expressed as whole edges or faces of the new mode.
     */
    const changeSelectElement = useCallback(
        (next: SelectElement) => {
            if (selectElementRef.current !== next) {
                selectElementRef.current = next;
                // A mode change starts a fresh selection entry rather than folding into the
                // one before it — they mean different things.
                editSessionRef.current++;
                commitSelectionRecorded(
                    next,
                    elementsWithin(next, new Set(selectedVerticesRef.current)),
                    `Switch to ${next} select`,
                );
            }
            setSelectElement(next);
        },
        [commitSelectionRecorded, elementsWithin],
    );

    /** Adds the current selection to a label group that already exists. */
    const assignSelectionToGroup = useCallback(
        (groupId: number) => {
            const def = defRef.current;
            const group = customGroupsRef.current.find((g) => g.id === groupId);
            const selected = selectedVerticesRef.current;
            if (!def || !group || selected.length === 0) return;

            const skins =
                vertexSkinsOverrideRef.current ??
                (def.vertexSkins
                    ? def.vertexSkins.slice()
                    : new Int32Array(def.vertexCount).fill(-1));
            for (const v of selected) skins[v] = group.label;
            vertexSkinsOverrideRef.current = skins;
            vertexLabelGroupsRef.current = buildLabelGroups(skins, def.vertexCount);
            refreshModelLabels();

            const merged = Array.from(new Set([...group.vertexIndices, ...selected])).sort(
                (a, b) => a - b,
            );
            customGroupsRef.current = customGroupsRef.current.map((g) =>
                g.id === groupId ? { ...g, vertexIndices: merged } : g,
            );
            setCustomGroups(customGroupsRef.current);

            clearSelection();
            setSelectMode(false);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory("Add to movement");
        },
        [clearSelection, applyEffectiveOldFrame, recordHistory, refreshModelLabels],
    );

    const resizeSelection = useCallback(
        (direction: "grow" | "shrink"): boolean => {
            if (!selectModeRef.current || adjacencyRef.current.length === 0) return false;
            const current = selectedVerticesRef.current;
            if (current.length === 0) return false;
            const next =
                direction === "grow"
                    ? growSelection(current, adjacencyRef.current)
                    : shrinkSelection(current, adjacencyRef.current);
            // Grow/shrink is a vertex operation; the result comes back as whole elements of
            // whichever mode is active.
            const element = selectElementRef.current;
            commitSelectionRecorded(
                element,
                elementsWithin(element, new Set(next)),
                direction === "grow" ? "Grow selection" : "Shrink selection",
            );
            return true;
        },
        [commitSelectionRecorded, elementsWithin],
    );

    /** Opens the create-label form, pre-filled with the next unused label id. */
    const beginCreateLabel = useCallback(() => {
        const def = defRef.current;
        if (def) {
            const skins = vertexSkinsOverrideRef.current ?? def.vertexSkins;
            setNewLabelId(String(nextFreeLabel(skins, def.vertexCount)));
        }
        setCreatingLabel(true);
    }, []);

    /** Targets a colour region or bone influence by making it the live selection, so you can
     * see it highlighted and refine it with grow/shrink before committing to a label. */
    const selectVertices = useCallback(
        (vertices: number[]) => {
            // Colour and bone targeting is inherently per-vertex, so it switches modes to match.
            selectElementRef.current = "vertex";
            setSelectElement("vertex");
            commitSelectionRecorded(
                "vertex",
                new Set(vertices),
                `Select ${vertices.length} vertices`,
            );
            setSelectMode(true);
        },
        [commitSelection],
    );

    const rebuildBoneGroups = useCallback(
        (weight: number) => {
            setMinWeight(weight);
            const source = mayaForGrouping();
            if (source) setBoneGroups(groupVerticesByBone(source, weight));
        },
        [mayaForGrouping],
    );

    const toggleHiddenLabel = useCallback((label: number) => {
        setHiddenLabels((prev) => {
            const next = new Set(prev);
            if (!next.delete(label)) next.add(label);
            return next;
        });
    }, []);

    const toggleIsolatedLabel = useCallback((label: number) => {
        setIsolatedLabels((prev) => {
            const next = new Set(prev);
            if (!next.delete(label)) next.add(label);
            return next;
        });
    }, []);

    const showAllLabels = useCallback(() => {
        setHiddenLabels(new Set());
        setIsolatedLabels(new Set());
    }, []);

    const renameCustomGroup = useCallback((id: number, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        customGroupsRef.current = customGroupsRef.current.map((g) =>
            g.id === id ? { ...g, name: trimmed } : g,
        );
        setCustomGroups(customGroupsRef.current);
    }, []);

    /**
     * Renames a label row. A movement keeps its name on the movement itself (so the dope sheet
     * and keyframe list follow); a plain model label gets an editor-side name, since the label
     * ids on the model are just numbers and nothing is written back to the cache.
     */
    const renameLabel = useCallback(
        (row: LabelRow, name: string) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            if (row.group) {
                renameCustomGroup(row.group.id, trimmed);
                return;
            }
            // Built from the ref, not the `labelNames` state closure, and written to it
            // immediately: the assistant applies a batch of renames as several synchronous calls
            // in a row, with no re-render between them, so each one has to see what the last one
            // just did rather than starting over from the map this render began with — otherwise
            // only the final rename in the batch would survive.
            const next = new Map(labelNamesRef.current).set(row.label, trimmed);
            labelNamesRef.current = next;
            setLabelNames(next);
            // Label names are the editor's own knowledge, not the model's, so the workspace is
            // where they survive a reload.
            const id = loadedModelIdRef.current;
            if (id !== null) saveLabelNames(id, next);
            recordHistory(`Rename · ${name}`);
        },
        [recordHistory, renameCustomGroup, saveLabelNames],
    );

    /** Makes a label's vertices the live selection, so you can see exactly what it covers. */
    const selectLabel = useCallback(
        (label: number) => selectVertices(vertexLabelGroupsRef.current[label] ?? []),
        [selectVertices],
    );

    /**
     * Cuts one label's vertices into a chain of `count` labels along `axis`, ordered by position.
     * The first (lowest) segment keeps `label`'s own id — and with it, any name or movement it
     * already had; the rest get the lowest free ids not already in use on the model.
     *
     * This is what turns a tail rigged as one rigid blob into a chain that can bend joint by
     * joint. It's geometric, not semantic: it has no idea what a "joint" is, just where the
     * label's own vertices happen to sit along an axis.
     */
    const splitLabel = useCallback(
        (label: number, count: number, axis: "x" | "y" | "z"): ActionResult => {
            const def = defRef.current;
            if (!def) return "No model is loaded.";
            if (!Number.isFinite(count) || count < 2 || count > 8) {
                return "Split into between 2 and 8 segments.";
            }

            const verts = vertexLabelGroupsRef.current[label];
            if (!verts || verts.length === 0) return `There's no label ${label} on this model.`;
            if (verts.length < count) {
                return `Label ${label} only has ${verts.length} vertices, not enough to split into ${count}.`;
            }

            const skins =
                vertexSkinsOverrideRef.current ??
                (def.vertexSkins
                    ? def.vertexSkins.slice()
                    : new Int32Array(def.vertexCount).fill(-1));
            const positions =
                axis === "x"
                    ? def.vertexPositionsX
                    : axis === "y"
                    ? def.vertexPositionsY
                    : def.vertexPositionsZ;
            const ordered = [...verts].sort((a, b) => positions[a] - positions[b]);

            // Ids are a single byte on the model (see the 0-255 check in handleCreateMovement),
            // so the lowest free ones are picked rather than just counting up from `label`.
            const used = new Set<number>();
            for (let i = 0; i < skins.length; i++) if (skins[i] >= 0) used.add(skins[i]);
            const newIds: number[] = [];
            for (let id = 0; id <= 255 && newIds.length < count - 1; id++) {
                if (!used.has(id)) {
                    newIds.push(id);
                    used.add(id);
                }
            }
            if (newIds.length < count - 1)
                return "Ran out of free label ids (0-255) to split into.";

            const perSegment = Math.ceil(ordered.length / count);
            for (let seg = 1; seg < count; seg++) {
                const start = seg * perSegment;
                const end = Math.min(start + perSegment, ordered.length);
                const id = newIds[seg - 1];
                for (let i = start; i < end; i++) skins[ordered[i]] = id;
            }
            // Segment 0 keeps whatever `skins` already had for these vertices — `label` itself.

            vertexSkinsOverrideRef.current = skins;
            vertexLabelGroupsRef.current = buildLabelGroups(skins, def.vertexCount);
            refreshModelLabels();

            // A movement already on this label recorded its vertices at creation time; vertices
            // that just moved to a new label have to come out of that snapshot too, or deleting
            // the movement later would un-label them by mistake.
            const rootVerts = ordered.slice(0, perSegment);
            if (customGroupsRef.current.some((g) => g.label === label)) {
                customGroupsRef.current = customGroupsRef.current.map((g) =>
                    g.label === label ? { ...g, vertexIndices: rootVerts } : g,
                );
                setCustomGroups(customGroupsRef.current);
            }

            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Split label ${label} into ${count}`);

            return {
                note: `Split into ${count}: kept ${label} on the segment nearest the low end of ${axis.toUpperCase()}; new labels ${newIds.join(
                    ", ",
                )} continue toward the other end, in that order.`,
            };
        },
        [applyEffectiveOldFrame, recordHistory, refreshModelLabels],
    );

    const deleteCustomGroup = useCallback(
        (id: number) => {
            const def = defRef.current;
            const group = customGroupsRef.current.find((g) => g.id === id);
            if (!def || !group) return;

            customGroupsRef.current = customGroupsRef.current.filter((g) => g.id !== id);
            setCustomGroups(customGroupsRef.current);

            // Un-label its vertices too (unless another remaining group still claims one), so the
            // overlay/outliner don't keep showing them as tagged.
            const skins = vertexSkinsOverrideRef.current;
            if (skins) {
                const stillClaimed = new Set(
                    customGroupsRef.current.flatMap((g) => g.vertexIndices),
                );
                for (const v of group.vertexIndices) {
                    if (!stillClaimed.has(v)) skins[v] = def.vertexSkins ? def.vertexSkins[v] : -1;
                }
                vertexLabelGroupsRef.current = buildLabelGroups(skins, def.vertexCount);
                refreshModelLabels();
            }
            for (const frameEdits of editsRef.current.values()) frameEdits.delete(id);

            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Delete movement · ${group.name}`);
        },
        [applyEffectiveOldFrame, recordHistory, refreshModelLabels],
    );

    /** Adds a movement for that label if it has none of this kind, removes it if it does. */
    const toggleLabelMovement = useCallback(
        (label: number, type: SeqTransformType) => {
            const existing = customGroupsRef.current.find(
                (g) => g.label === label && g.type === type,
            );
            if (existing) deleteCustomGroup(existing.id);
            else addMovements([label], type);
        },
        [addMovements, deleteCustomGroup],
    );

    /**
     * Whether the bundle would hold nothing but the model, in which case it downloads as a plain
     * `.dat` and the menu says so rather than promising a zip.
     *
     * Read from refs, so it's only as fresh as the last render — which is fine, because the menu
     * that uses it renders when it opens.
     */
    const bundleIsModelOnly =
        modelIsChanged() &&
        editsRef.current.size === 0 &&
        loadedSeq !== "new" &&
        !seqConfigDirtyRef.current &&
        // Referenced so an edit on the Config tab re-renders this.
        seqConfigVersion >= 0;

    const labelRows = buildLabelRows(modelLabels, customGroups, labelNames);
    // Read by the assistant bindings, which are callbacks rather than render code.
    labelRowsRef.current = labelRows;

    /** `"<label>:<type>"` for every movement that exists, so a row can light up its own buttons. */
    const movementsByLabel = new Set(customGroups.map((g) => `${g.label}:${g.type}`));

    const total =
        seqState.status === "ready"
            ? seqState.kind === "old"
                ? seqState.frameCount
                : seqState.duration
            : 0;

    // ---- Blender-style modal transform (G / R / S) ----------------------------------------

    const startModal = useCallback(
        (kind: TransformKind): boolean => {
            const group = activeGizmoGroupRef.current;
            const raw = rawOldFrameRef.current;
            if (group === null || !raw) return false;
            const type = getEffectiveBase(raw.frame.base).types[group];
            const wanted =
                kind === "translate"
                    ? SeqTransformType.TRANSLATE
                    : kind === "rotate"
                    ? SeqTransformType.ROTATE
                    : SeqTransformType.SCALE;
            if (type !== wanted) return false;

            const frameIndex = stepCountRef.current;
            const original = resolveCurrentValue(frameIndex, group);
            if (!original) return false;
            const previousEdit = editsRef.current.get(frameIndex)?.get(group);

            stopPlayback();
            modalRef.current = {
                group,
                kind,
                axis: "x",
                original: { ...original },
                previousEdit: previousEdit ? { ...previousEdit } : undefined,
                anchorX: lastMouseRef.current.x,
            };
            setModalInfo({ kind, axis: "x" });
            return true;
        },
        [getEffectiveBase, resolveCurrentValue, stopPlayback],
    );

    const restoreModalOriginal = useCallback((modal: ModalTransform): void => {
        const frameIndex = stepCountRef.current;
        let frameEdits = editsRef.current.get(frameIndex);
        if (!frameEdits) {
            frameEdits = new Map();
            editsRef.current.set(frameIndex, frameEdits);
        }
        frameEdits.set(modal.group, { ...modal.original });
    }, []);

    const setModalAxis = useCallback(
        (axis: Axis): boolean => {
            const modal = modalRef.current;
            if (!modal) return false;
            // Switching axis undoes the movement on the old one, like Blender.
            restoreModalOriginal(modal);
            modal.axis = axis;
            modal.anchorX = lastMouseRef.current.x;
            applyEffectiveOldFrame(stepCountRef.current);
            setModalInfo({ kind: modal.kind, axis });
            return true;
        },
        [restoreModalOriginal, applyEffectiveOldFrame],
    );

    const confirmModal = useCallback((): boolean => {
        if (!modalRef.current) return false;
        modalRef.current = null;
        setModalInfo(null);
        // Ends the run of value changes the modal transform was making.
        editSessionRef.current++;
        return true;
    }, []);

    const cancelModal = useCallback((): boolean => {
        const modal = modalRef.current;
        if (!modal) return false;
        const frameIndex = stepCountRef.current;
        const frameEdits = editsRef.current.get(frameIndex);
        if (modal.previousEdit) frameEdits?.set(modal.group, modal.previousEdit);
        else frameEdits?.delete(modal.group);
        if (frameEdits && frameEdits.size === 0) editsRef.current.delete(frameIndex);
        modalRef.current = null;
        setModalInfo(null);
        applyEffectiveOldFrame(frameIndex);
        return true;
    }, [applyEffectiveOldFrame]);

    useEffect(() => {
        confirmModalRef.current = () => void confirmModal();
        cancelModalRef.current = () => void cancelModal();
    }, [confirmModal, cancelModal]);

    // ---- Keyframe / selection / view actions --------------------------------------------

    /** Pins the group's current (possibly tweened) value as an explicit key at this frame. */
    const insertKeyframeFor = useCallback(
        (group: number): boolean => {
            const frameIndex = stepCountRef.current;
            const current = resolveCurrentValue(frameIndex, group);
            if (!current) return false;
            let frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits) {
                frameEdits = new Map();
                editsRef.current.set(frameIndex, frameEdits);
            }
            frameEdits.set(group, { ...current });
            applyEffectiveOldFrame(frameIndex);
            return true;
        },
        [resolveCurrentValue, applyEffectiveOldFrame],
    );

    const deleteKeyframeFor = useCallback(
        (group: number): boolean => {
            const frameIndex = stepCountRef.current;
            const frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits?.has(group)) return false;
            frameEdits.delete(group);
            if (frameEdits.size === 0) editsRef.current.delete(frameIndex);
            applyEffectiveOldFrame(frameIndex);
            return true;
        },
        [applyEffectiveOldFrame],
    );

    const insertKeyframe = useCallback((): boolean => {
        const group = activeGizmoGroupRef.current;
        return group === null ? false : insertKeyframeFor(group);
    }, [insertKeyframeFor]);

    const deleteKeyframe = useCallback((): boolean => {
        const group = activeGizmoGroupRef.current;
        return group === null ? false : deleteKeyframeFor(group);
    }, [deleteKeyframeFor]);

    /** Blender's Alt+G/R/S: reset the armed group to identity at this frame (if its type matches). */
    const clearTransform = useCallback(
        (kind: TransformKind): boolean => {
            const group = activeGizmoGroupRef.current;
            const raw = rawOldFrameRef.current;
            if (group === null || !raw) return false;
            const type = getEffectiveBase(raw.frame.base).types[group];
            const wanted =
                kind === "translate"
                    ? SeqTransformType.TRANSLATE
                    : kind === "rotate"
                    ? SeqTransformType.ROTATE
                    : SeqTransformType.SCALE;
            if (type !== wanted) return false;
            const identity = kind === "scale" ? 128 : 0;
            const frameIndex = stepCountRef.current;
            let frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits) {
                frameEdits = new Map();
                editsRef.current.set(frameIndex, frameEdits);
            }
            frameEdits.set(group, { x: identity, y: identity, z: identity });
            applyEffectiveOldFrame(frameIndex);
            return true;
        },
        [getEffectiveBase, applyEffectiveOldFrame],
    );

    const jumpToKeyframe = useCallback(
        (direction: 1 | -1): boolean => {
            if (seqState.status !== "ready" || seqState.kind !== "old") return false;
            const group = activeGizmoGroupRef.current;
            const frames = new Set<number>();
            for (const [frameIndex, frame] of allFramesRef.current) {
                if (group === null || frame.transformGroups.includes(group)) frames.add(frameIndex);
            }
            for (const [frameIndex, frameEdits] of editsRef.current) {
                if (group === null || frameEdits.has(group)) frames.add(frameIndex);
            }
            const sorted = Array.from(frames).sort((a, b) => a - b);
            const current = stepCountRef.current;
            const target =
                direction === 1
                    ? sorted.find((f) => f > current)
                    : [...sorted].reverse().find((f) => f < current);
            if (target === undefined) return false;
            onScrub(target);
            return true;
        },
        [seqState, onScrub],
    );

    const selectAllVertices = useCallback((): boolean => {
        const def = defRef.current;
        if (!def || !selectModeRef.current) return false;
        const element = selectElementRef.current;
        const count =
            element === "vertex"
                ? def.vertexCount
                : element === "edge"
                ? edgeListRef.current.length / 2
                : def.faceCount;
        const ids = new Set<number>();
        // Edge ids index into the flat `[a, b, a, b, …]` list, so they step in twos.
        for (let i = 0; i < count; i++) ids.add(element === "edge" ? i * 2 : i);
        commitSelectionRecorded(element, ids, `Select all ${element}s`);
        return true;
    }, [commitSelectionRecorded]);

    useEffect(() => {
        interpolationRef.current = interpolation;
        applyEffectiveOldFrame(stepCountRef.current);
    }, [interpolation, applyEffectiveOldFrame]);

    /** Turns every tweened/held frame into an explicit key, so each frame owns its value. */
    const bakeTweens = useCallback((): void => {
        if (seqState.status !== "ready" || seqState.kind !== "old") return;
        const frame0 = allFramesRef.current.get(0);
        if (!frame0) return;
        const base = getEffectiveBase(frame0.base);
        const keyedGroups = new Set<number>();
        for (const frameEdits of editsRef.current.values())
            for (const g of frameEdits.keys()) keyedGroups.add(g);

        for (let frameIndex = 0; frameIndex < seqState.frameCount; frameIndex++) {
            const decoded = allFramesRef.current.get(frameIndex);
            for (const groupId of keyedGroups) {
                if (editsRef.current.get(frameIndex)?.has(groupId)) continue;
                if (decoded?.transformGroups.includes(groupId)) continue;
                const value = interpolatedValue(groupId, frameIndex, base.types[groupId]);
                if (!value) continue;
                let frameEdits = editsRef.current.get(frameIndex);
                if (!frameEdits) {
                    frameEdits = new Map();
                    editsRef.current.set(frameIndex, frameEdits);
                }
                frameEdits.set(groupId, { ...value });
            }
        }
        applyEffectiveOldFrame(stepCountRef.current);
        recordHistory("Bake tweens");
    }, [seqState, getEffectiveBase, interpolatedValue, applyEffectiveOldFrame, recordHistory]);

    // ---- Dope sheet keyframe editing (right-click a row / drag a key) ----------------------

    /** What a group's value is at an arbitrary frame: its key there, else the decoded op, else
     * the tween between the user's keys, else identity. */
    const valueAtFrame = useCallback(
        (groupId: number, frameIndex: number): Vec3 | null => {
            const existing = editsRef.current.get(frameIndex)?.get(groupId);
            if (existing) return existing;

            const frame0 = allFramesRef.current.get(0);
            if (!frame0) return null;
            const type = getEffectiveBase(frame0.base).types[groupId];

            const decoded = allFramesRef.current.get(frameIndex);
            if (decoded) {
                const opIndex = decoded.transformGroups.indexOf(groupId);
                if (opIndex >= 0) {
                    return {
                        x: decoded.transformX[opIndex],
                        y: decoded.transformY[opIndex],
                        z: decoded.transformZ[opIndex],
                    };
                }
            }

            const tweened = interpolatedValue(groupId, frameIndex, type);
            if (tweened) return tweened;

            const identity = type === SeqTransformType.SCALE ? 128 : 0;
            return { x: identity, y: identity, z: identity };
        },
        [getEffectiveBase, interpolatedValue],
    );

    const insertKeyframeAtFrame = useCallback(
        (groupId: number, frameIndex: number): void => {
            const value = valueAtFrame(groupId, frameIndex);
            if (!value) return;
            let frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits) {
                frameEdits = new Map();
                editsRef.current.set(frameIndex, frameEdits);
            }
            frameEdits.set(groupId, { ...value });
            setActiveGizmoGroup(groupId);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Insert key · frame ${frameIndex}`);
        },
        [valueAtFrame, applyEffectiveOldFrame, recordHistory],
    );

    const deleteKeyframeAtFrame = useCallback(
        (groupId: number, frameIndex: number): void => {
            const frameEdits = editsRef.current.get(frameIndex);
            if (!frameEdits?.delete(groupId)) return;
            if (frameEdits.size === 0) editsRef.current.delete(frameIndex);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Delete key · frame ${frameIndex}`);
        },
        [applyEffectiveOldFrame, recordHistory],
    );

    /** Retimes a key by dragging it along its row; dropping onto an existing key replaces it. */
    const moveKeyframe = useCallback(
        (groupId: number, from: number, to: number): void => {
            if (from === to) return;
            const fromEdits = editsRef.current.get(from);
            const value = fromEdits?.get(groupId);
            if (!fromEdits || !value) return;

            fromEdits.delete(groupId);
            if (fromEdits.size === 0) editsRef.current.delete(from);

            let toEdits = editsRef.current.get(to);
            if (!toEdits) {
                toEdits = new Map();
                editsRef.current.set(to, toEdits);
            }
            toEdits.set(groupId, value);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Move key ${from} → ${to}`);
        },
        [applyEffectiveOldFrame, recordHistory],
    );

    const clearKeyframeRow = useCallback(
        (groupId: number): void => {
            for (const [frameIndex, frameEdits] of editsRef.current) {
                if (frameEdits.delete(groupId) && frameEdits.size === 0)
                    editsRef.current.delete(frameIndex);
            }
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory("Clear row");
        },
        [applyEffectiveOldFrame, recordHistory],
    );

    /**
     * Drops a preset's keys onto one movement, starting from the key that was right-clicked and
     * running to `to`. Everything it writes is an ordinary keyframe, so the result can be dragged,
     * retimed or deleted afterwards like anything hand-placed.
     *
     * Returns a sentence explaining why nothing happened, or null when it worked — the menu shows
     * whichever it gets back.
     */
    const applyMotionPreset = useCallback(
        (
            groupId: number,
            presetId: string,
            axis: PresetAxis,
            amount: number,
            from: number,
            to: number,
        ): string | null => {
            const preset = MOTION_PRESETS.find((p) => p.id === presetId);
            if (!preset) return "That preset no longer exists.";

            const frame0 = allFramesRef.current.get(0);
            if (!frame0) return "Load a sequence first.";
            const type = getEffectiveBase(frame0.base).types[groupId];
            if (!preset.types.includes(type)) {
                return `${preset.label} doesn't apply to a ${
                    TRANSFORM_TYPE_NAMES[type] ?? type
                } movement.`;
            }

            // The preset moves away from whatever pose this movement already holds at the frame
            // you right-clicked, rather than replacing it.
            const base = valueAtFrame(groupId, from);
            if (!base) return "Couldn't read this movement's value at that frame.";

            const keys = buildPresetKeys(preset, type, axis, amount, from, to, base);
            if (keys.length === 0) return "That range is too short — give it at least two frames.";

            for (const { frame, value } of keys) {
                let frameEdits = editsRef.current.get(frame);
                if (!frameEdits) {
                    frameEdits = new Map();
                    editsRef.current.set(frame, frameEdits);
                }
                frameEdits.set(groupId, value);
            }
            setActiveGizmoGroup(groupId);
            applyEffectiveOldFrame(stepCountRef.current);
            recordHistory(`Apply ${preset.label}`);
            return null;
        },
        [applyEffectiveOldFrame, getEffectiveBase, recordHistory, valueAtFrame],
    );

    /**
     * Changes how long the animation is. Trimming drops the frames past the new end along with
     * anything keyed on them; extending adds empty frames, which key like any other.
     *
     * Only old-style sequences have frames to count — a skeletal one is a duration, not a list.
     */
    const setAnimationLength = useCallback(
        (frameCount: number): void => {
            const seqType = seqTypeRef.current;
            const base = allFramesRef.current.get(0)?.base;
            if (!seqType || !base) return;

            const next = Math.max(1, Math.min(MAX_ANIM_FRAMES, Math.round(frameCount)));
            const current = seqType.frameIds.length;
            if (next === current) return;

            stopPlayback();

            if (next < current) {
                for (let i = next; i < current; i++) {
                    allFramesRef.current.delete(i);
                    editsRef.current.delete(i);
                }
                seqType.frameIds = seqType.frameIds.slice(0, next);
                seqType.frameLengths = seqType.frameLengths.slice(0, next);
            } else {
                const hold = seqType.frameLengths[current - 1] ?? NEW_ANIM_FRAME_LENGTH;
                for (let i = current; i < next; i++) {
                    allFramesRef.current.set(i, new SeqFrame(base, 0, [], [], [], [], [], false));
                    seqType.frameIds.push(0);
                    seqType.frameLengths.push(hold);
                }
            }

            setSeqState({ status: "ready", kind: "old", frameCount: next });
            const step = Math.min(stepCountRef.current, next - 1);
            stepCountRef.current = step;
            setStep(step);
            applyOldFrame(step);
            recordHistory(`Length ${current} → ${next} frames`);
        },
        [applyOldFrame, recordHistory, stopPlayback],
    );

    // ---- What the assistant can see and do -------------------------------------------------

    /**
     * The scene as it stands, read fresh for each request.
     *
     * Per-label size and position are the whole point: the ids say nothing about anatomy, so
     * "long and thin, low and toward the back" is what lets a tail be found at all.
     */
    const readScene = useCallback((): SceneFacts | null => {
        const def = defRef.current;
        const mesh = meshRef.current;
        if (!def || !mesh) return null;

        const groups = vertexLabelGroupsRef.current;
        // Matches `buildLabelRows`: once a label has a movement, renaming it renames the
        // movement instead (so the dope sheet follows) rather than touching `labelNames`. Without
        // this fallback here too, a label named that way would report back to the assistant as
        // still unnamed even though the rename took — the exact mismatch it'd otherwise see.
        const groupByLabel = new Map<number, CustomGroup>();
        for (const g of customGroupsRef.current)
            if (!groupByLabel.has(g.label)) groupByLabel.set(g.label, g);
        const labels: LabelFacts[] = [];
        for (const { label } of modelLabels) {
            const verts = groups[label];
            if (!verts || verts.length === 0) continue;
            let minX = Infinity,
                minY = Infinity,
                minZ = Infinity;
            let maxX = -Infinity,
                maxY = -Infinity,
                maxZ = -Infinity;
            let sx = 0,
                sy = 0,
                sz = 0;
            for (const v of verts) {
                const x = def.vertexPositionsX[v];
                const y = def.vertexPositionsY[v];
                const z = def.vertexPositionsZ[v];
                sx += x;
                sy += y;
                sz += z;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (z < minZ) minZ = z;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (z > maxZ) maxZ = z;
            }
            labels.push({
                label,
                name: labelNames.get(label) ?? groupByLabel.get(label)?.name ?? null,
                vertexCount: verts.length,
                centre: { x: sx / verts.length, y: sy / verts.length, z: sz / verts.length },
                size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
            });
        }

        let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
        let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;
        for (let v = 0; v < def.vertexCount; v++) {
            const x = def.vertexPositionsX[v];
            const y = def.vertexPositionsY[v];
            const z = def.vertexPositionsZ[v];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        const keyedByGroup = new Map<number, number[]>();
        for (const [frame, groupEdits] of editsRef.current) {
            for (const groupId of groupEdits.keys()) {
                keyedByGroup.set(groupId, [...(keyedByGroup.get(groupId) ?? []), frame]);
            }
        }

        return {
            modelId: def.id,
            vertexCount: def.vertexCount,
            faceCount: def.faceCount,
            bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
            labels,
            movements: customGroupsRef.current.map((g) => ({
                id: g.id,
                name: g.name,
                kind: TRANSFORM_TYPE_NAMES[g.type] ?? String(g.type),
                label: g.label,
                keyedFrames: (keyedByGroup.get(g.id) ?? []).sort((a, b) => a - b),
            })),
            animation:
                seqState.status === "ready" && seqState.kind === "old"
                    ? {
                          name: loadedSeqName,
                          id: typeof loadedSeq === "number" ? loadedSeq : null,
                          frames: seqState.frameCount,
                          currentFrame: step,
                      }
                    : null,
        };
    }, [labelNames, loadedSeq, loadedSeqName, modelLabels, seqState, step]);

    /**
     * A snapshot of the current 3D view, so the assistant can look at the model instead of only
     * reading numbers about it — "long and thin, low and toward the back" is a fair guess at a
     * tail, but seeing it is better than guessing.
     *
     * Downscaled well below the canvas's own resolution: this rides along on every turn, and a
     * screenshot only needs to be big enough to tell a tail from a leg, not to look good.
     */
    const captureViewportImage = useCallback((): {
        mediaType: "image/png";
        base64: string;
    } | null => {
        const source = canvasRef.current;
        const renderer = rendererRef.current;
        if (!source || !renderer || source.width === 0 || source.height === 0) return null;

        // The context is created with `preserveDrawingBuffer: false`, so the frame only survives
        // until the browser composites it next — render synchronously and copy it out immediately,
        // before anything here yields back to the event loop.
        renderer.render();

        const maxEdge = 640;
        const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
        const width = Math.max(1, Math.round(source.width * scale));
        const height = Math.max(1, Math.round(source.height * scale));

        const out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(source, 0, 0, width, height);

        const dataUrl = out.toDataURL("image/png");
        return { mediaType: "image/png", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    }, []);

    /**
     * Everything the assistant is allowed to do, bound to the same functions the UI calls.
     *
     * Each returns a sentence explaining a refusal, or null when it worked — the panel shows
     * those next to the action rather than failing the whole plan.
     */
    /**
     * Finds a label's movement of this kind, creating it first if it doesn't have one yet.
     *
     * This is what lets apply_preset and set_key be identified by label + kind rather than a
     * movement id: an id handed out by add_movement doesn't exist until the plan is actually
     * applied, so a plan that both creates a movement and keys it in the same go would otherwise
     * need to predict an id ahead of time. Resolving it here, at the moment it's needed, removes
     * that guesswork entirely — and it's what makes "swing the tail" able to add a rotate, a
     * translate and a scale movement and key all three in one plan.
     */
    const ensureMovement = useCallback(
        (label: number, kind: "translate" | "rotate" | "scale"): number | string => {
            if (!modelLabels.some((l) => l.label === label)) {
                return `There's no label ${label} on this model.`;
            }
            const type = transformTypeForKind(kind);
            const existing = customGroupsRef.current.find(
                (g) => g.label === label && g.type === type,
            );
            if (existing) return existing.id;

            addMovements([label], type);
            // `addMovements` mutates the ref synchronously, so the new group is already there —
            // this only falls through if that stops being true.
            const created = customGroupsRef.current.find(
                (g) => g.label === label && g.type === type,
            );
            return created ? created.id : `Couldn't create a ${kind} movement for label ${label}.`;
        },
        [addMovements, modelLabels],
    );

    const aiActions = useMemo(
        (): AiActions => ({
            renameLabel: (label, name) => {
                const row = labelRowsRef.current.find((r) => r.label === label);
                if (!row) return `There's no label ${label} on this model.`;
                renameLabel(row, name);
                return null;
            },
            addMovement: (label, kind) => {
                if (!modelLabels.some((l) => l.label === label)) {
                    return `There's no label ${label} on this model.`;
                }
                addMovements([label], transformTypeForKind(kind));
                return null;
            },
            applyPreset: (label, kind, preset, axis, amount, from, to) => {
                const movement = ensureMovement(label, kind);
                if (typeof movement === "string") return movement;
                return applyMotionPreset(movement, preset, axis, amount, from, to);
            },
            setKey: (label, kind, frame, axis, value) => {
                if (seqState.status !== "ready") return "No animation is open to key.";
                const movement = ensureMovement(label, kind);
                if (typeof movement === "string") return movement;
                updateTransformValue(frame, movement, axis, value);
                return null;
            },
            setLength: (frames) => {
                if (seqState.status !== "ready" || seqState.kind !== "old") {
                    return "Only an old-style animation has a frame count to set.";
                }
                setAnimationLength(frames);
                return null;
            },
            selectLabel: (label) => {
                if (!modelLabels.some((l) => l.label === label)) {
                    return `There's no label ${label} on this model.`;
                }
                selectLabel(label);
                return null;
            },
            splitLabel: (label, count, axis) => {
                if (!modelLabels.some((l) => l.label === label)) {
                    return `There's no label ${label} on this model.`;
                }
                return splitLabel(label, count, axis);
            },
        }),
        [
            addMovements,
            applyMotionPreset,
            ensureMovement,
            modelLabels,
            renameLabel,
            selectLabel,
            seqState,
            setAnimationLength,
            splitLabel,
            updateTransformValue,
        ],
    );

    /**
     * Held here rather than in the panel that shows it, so switching sidebar tabs mid-request
     * hides the panel without cancelling the request — the reply is waiting when you switch back.
     */
    const aiAssistant = useAiAssistant({
        scene: readScene,
        captureView: captureViewportImage,
        actions: aiActions,
        // One entry for the whole plan: undoing an assistant change should put back everything
        // it did, not unpick it one call at a time.
        onApplied: (askedFor, count) => {
            const short = askedFor.length > 40 ? `${askedFor.slice(0, 40)}…` : askedFor;
            recordHistory(`Assistant · ${short} (${count})`);
        },
    });

    /** Drops one frame out of the middle, pulling everything after it back a place. */
    const removeFrame = useCallback(
        (frameIndex: number): void => {
            const seqType = seqTypeRef.current;
            if (!seqType) return;
            const count = seqType.frameIds.length;
            // An animation with no frames isn't an animation; the last one stays.
            if (count <= 1 || frameIndex < 0 || frameIndex >= count) return;

            stopPlayback();

            const frames = new Map<number, SeqFrame>();
            const edits = new Map<number, Map<number, Vec3>>();
            for (let i = 0; i < count; i++) {
                if (i === frameIndex) continue;
                const to = i < frameIndex ? i : i - 1;
                const frame = allFramesRef.current.get(i);
                if (frame) frames.set(to, frame);
                const frameEdits = editsRef.current.get(i);
                if (frameEdits) edits.set(to, frameEdits);
            }
            allFramesRef.current = frames;
            editsRef.current = edits;

            seqType.frameIds.splice(frameIndex, 1);
            seqType.frameLengths.splice(frameIndex, 1);

            setSeqState({ status: "ready", kind: "old", frameCount: count - 1 });
            const step = Math.min(stepCountRef.current, count - 2);
            stepCountRef.current = step;
            setStep(step);
            applyOldFrame(step);
            recordHistory(`Remove frame ${frameIndex}`);
        },
        [applyOldFrame, recordHistory, stopPlayback],
    );

    // ---- Timeline layer presentation (rename / hide / reorder) ----------------------------

    /** Renaming a custom movement renames it everywhere; other rows get a display-only name. */
    const renameRow = useCallback(
        (groupId: number, name: string): void => {
            const trimmed = name.trim();
            if (!trimmed) return;
            if (customGroupsRef.current.some((g) => g.id === groupId)) {
                renameCustomGroup(groupId, trimmed);
                return;
            }
            setRowNames((prev) => new Map(prev).set(groupId, trimmed));
        },
        [renameCustomGroup],
    );

    const toggleRowHidden = useCallback((groupId: number): void => {
        setHiddenRows((prev) => {
            const next = new Set(prev);
            if (!next.delete(groupId)) next.add(groupId);
            return next;
        });
    }, []);

    const showAllRows = useCallback((): void => setHiddenRows(new Set()), []);

    const reorderRows = useCallback((fromId: number, toId: number): void => {
        setRowOrder((prev) => {
            const base = prev ?? displayOrderRef.current;
            const fromIdx = base.indexOf(fromId);
            const toIdx = base.indexOf(toId);
            if (fromIdx < 0 || toIdx < 0) return prev;
            const next = base.filter((id) => id !== fromId);
            // Dropping downward lands after the target, upward lands before it.
            const insertAt = next.indexOf(toId) + (fromIdx < toIdx ? 1 : 0);
            next.splice(insertAt, 0, fromId);
            return next;
        });
    }, []);

    // ---- Hotkey dispatcher ----------------------------------------------------------------

    const runAction = useCallback(
        (id: HotkeyActionId): boolean => {
            // A preview is just something playing on the model — scrubbing and keying it would
            // mean editing an animation you haven't opened.
            const seqReady = seqState.status === "ready" && !previewingSeq;
            switch (id) {
                case "play_pause":
                    if (!seqReady) return false;
                    if (playing) stopPlayback();
                    else startPlayback();
                    return true;
                case "frame_prev":
                    if (!seqReady) return false;
                    onFrameStep(-1);
                    return true;
                case "frame_next":
                    if (!seqReady) return false;
                    onFrameStep(1);
                    return true;
                case "frame_start":
                    if (!seqReady) return false;
                    onScrub(0);
                    return true;
                case "frame_end":
                    if (!seqReady) return false;
                    onScrub(Math.max(0, total - 1));
                    return true;
                case "keyframe_next":
                    return jumpToKeyframe(1);
                case "keyframe_prev":
                    return jumpToKeyframe(-1);
                case "grab":
                    return startModal("translate");
                case "rotate":
                    return startModal("rotate");
                case "scale":
                    return startModal("scale");
                case "axis_x":
                    return setModalAxis("x");
                case "axis_y":
                    return setModalAxis("y");
                case "axis_z":
                    return setModalAxis("z");
                case "confirm":
                    return confirmModal();
                case "undo":
                    return undo();
                case "redo":
                    return redo();
                case "cancel":
                    if (cancelModal()) return true;
                    if (selectModeRef.current) {
                        setSelectMode(false);
                        clearSelection();
                        return true;
                    }
                    if (activeGizmoGroupRef.current !== null) {
                        setActiveGizmoGroup(null);
                        return true;
                    }
                    return false;
                case "insert_keyframe":
                    return insertKeyframe();
                case "delete_keyframe":
                    return deleteKeyframe();
                case "clear_location":
                    return clearTransform("translate");
                case "clear_rotation":
                    return clearTransform("rotate");
                case "clear_scale":
                    return clearTransform("scale");
                case "box_select":
                    // Labelling only needs the model — no sequence required — but it is a
                    // rigging tool, and its button isn't there in the other workspaces.
                    if (modelState.status !== "ready" || workspace !== "rigging") return false;
                    if (!selectModeRef.current) setShowVertices(true);
                    setSelectMode((v) => !v);
                    clearSelection();
                    return true;
                case "select_mode_vertex":
                case "select_mode_edge":
                case "select_mode_face":
                    if (modelState.status !== "ready" || workspace !== "rigging") return false;
                    if (!selectModeRef.current) setShowVertices(true);
                    changeSelectElement(
                        id === "select_mode_vertex"
                            ? "vertex"
                            : id === "select_mode_edge"
                            ? "edge"
                            : "face",
                    );
                    // Switching element is how you start selecting, as in Blender's edit mode.
                    setSelectMode(true);
                    return true;
                case "select_all":
                    return selectAllVertices();
                case "deselect_all":
                    clearSelection();
                    setActiveGizmoGroup(null);
                    return true;
                case "select_more":
                    return resizeSelection("grow");
                case "select_less":
                    return resizeSelection("shrink");
                case "toggle_xray":
                    if (workspace !== "rigging") return false;
                    setXray((v) => !v);
                    return true;
                case "toggle_vertices":
                    setShowVertices((v) => !v);
                    return true;
                case "toggle_sidebar":
                    setSidebarVisible((v) => !v);
                    return true;
                case "frame_all":
                    resetCamera();
                    return true;
            }
        },
        [
            undo,
            redo,
            seqState,
            previewingSeq,
            playing,
            total,
            stopPlayback,
            startPlayback,
            onFrameStep,
            onScrub,
            jumpToKeyframe,
            startModal,
            setModalAxis,
            confirmModal,
            cancelModal,
            clearSelection,
            insertKeyframe,
            deleteKeyframe,
            clearTransform,
            selectAllVertices,
            resizeSelection,
            // Several actions are rigging-only or need a model, so the dispatcher has to be
            // rebuilt when either changes.
            workspace,
            modelState.status,
            changeSelectElement,
        ],
    );

    useEffect(() => {
        runActionRef.current = runAction;
    }, [runAction]);

    useEffect(() => {
        bindingsRef.current = bindings;
    }, [bindings]);

    useEffect(() => {
        setBindings(loadBindings());
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (hotkeyListeningRef.current || settingsOpenRef.current) return;

            const combo = comboFromEvent(event);
            if (!combo) return;
            const withModifier = comboHasModifier(combo);

            // Bare keys belong to whatever field has focus; modifier combos can't be mistaken
            // for typing, so they keep working without having to click away first.
            const target = event.target as HTMLElement | null;
            const typing =
                target !== null &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" ||
                    target.isContentEditable);
            if (typing && !withModifier) return;

            const match = (Object.entries(bindingsRef.current) as [HotkeyActionId, string][]).find(
                ([, bound]) => bound === combo,
            );
            if (!match) return;

            // Suppress the browser's own shortcut (Ctrl +/- zoom, and friends) for anything we
            // claim — even when the action itself no-ops, or the page just zooms instead.
            const handled = runActionRef.current(match[0]);
            if (handled || withModifier) event.preventDefault();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const onBindingsChange = useCallback((next: HotkeyBindings) => {
        setBindings(next);
        bindingsRef.current = next;
        saveBindings(next);
    }, []);

    const onHotkeyListeningChange = useCallback((listening: boolean) => {
        hotkeyListeningRef.current = listening;
    }, []);

    const editedGroupsThisFrame = editsRef.current.get(step);

    /**
     * Whether there's an animation open for editing. A preview from the list doesn't count: it
     * plays on the model without bringing the timeline or the keyframe editor with it.
     */
    const seqEditable = seqState.status === "ready" && !previewingSeq;

    /**
     * Rigging is about labelling geometry: no keyframes, and no sequence config to edit.
     *
     * In Animation, Keyframe and Config are about an animation you've opened, so until you open
     * one the list is the only tab there is — an empty editor to click into is just a dead end.
     */
    const sidebarTabs: { id: SidebarTab; label: string }[] =
        workspace === "rigging"
            ? // "Rig", not "Labels": the panel now holds both rigging systems, and the tab inside
              // it is the one called Labels.
              [
                  { id: "labels", label: "Rig" },
                  { id: "ai", label: "Assistant" },
              ]
            : // Labels belong to rigging; animating works on the rig that's already there.
            seqEditable
            ? [
                  { id: "animations", label: "Animations" },
                  { id: "keyframe", label: "Keyframe" },
                  { id: "config", label: "Config" },
                  { id: "ai", label: "Assistant" },
              ]
            : [
                  { id: "animations", label: "Animations" },
                  { id: "ai", label: "Assistant" },
              ];

    /**
     * The tab actually being shown. Losing the sequence (a failed load, a new model) takes its
     * tabs with it, so the panel falls back to the list rather than rendering a tab that's no
     * longer on the bar.
     */
    const activeSidebarTab: SidebarTab = sidebarTabs.some((tab) => tab.id === sidebarTab)
        ? sidebarTab
        : sidebarTabs[0].id;

    const changeWorkspace = (next: Workspace): void => {
        setWorkspace(next);
        // Each workspace only has some of the tabs, so a tab that doesn't exist there has to
        // fall back rather than leaving an empty panel behind. Arriving in Animation with
        // nothing loaded lands on the list, which is the only thing there is to do next.
        if (next === "rigging") setSidebarTab("labels");
        else if (sidebarTab === "labels") {
            setSidebarTab(seqEditable ? "keyframe" : "animations");
        }

        if (next !== "rigging") {
            // Selecting and x-ray are rigging tools, and their buttons go with the workspace —
            // leaving either switched on would strand it with no way to turn it off.
            setSelectMode(false);
            clearSelection();
            setXray(false);
        } else {
            // The same in reverse: an armed transform gizmo or a half-finished G/R/S belongs to
            // the keyframe editor, and neither has any meaning over a rig.
            cancelModalRef.current();
            setActiveGizmoGroup(null);
            activeGizmoGroupRef.current = null;
        }
        // The display toggles are left alone: switching workspace shouldn't quietly turn the
        // vertex points back on after you've turned them off.
    };

    // Not built during a preview: the sheet behind the blur is empty anyway, and a preview
    // re-renders on every frame it plays.
    let dopeSheetRows: DopeSheetRow[] = [];
    if (seqEditable && seqState.status === "ready" && seqState.kind === "old") {
        const keyframesByGroup = new Map<number, Set<number>>();
        const addKeyframe = (groupId: number, frame: number): void => {
            let set = keyframesByGroup.get(groupId);
            if (!set) {
                set = new Set();
                keyframesByGroup.set(groupId, set);
            }
            set.add(frame);
        };
        for (const [frameIndex, frame] of allFramesRef.current) {
            for (const group of frame.transformGroups) addKeyframe(group, frameIndex);
        }
        for (const [frameIndex, frameEdits] of editsRef.current) {
            for (const groupId of frameEdits.keys()) addKeyframe(groupId, frameIndex);
        }

        // Frames strictly between two of the user's keys with no explicit op are generated by
        // tweening — shown as a faint line so real keys stand out (Blender draws these the same way).
        const editFramesByGroup = new Map<number, number[]>();
        for (const [frameIndex, frameEdits] of editsRef.current) {
            for (const groupId of frameEdits.keys()) {
                editFramesByGroup.set(groupId, [
                    ...(editFramesByGroup.get(groupId) ?? []),
                    frameIndex,
                ]);
            }
        }

        // A custom movement is a timeline layer the moment it exists, even before it has any
        // keys — that's the empty row you right-click to drop your first keyframe onto.
        for (const g of customGroups)
            if (!keyframesByGroup.has(g.id)) keyframesByGroup.set(g.id, new Set());

        const customById = new Map(customGroups.map((g) => [g.id, g]));
        const nameOf = (id: number): string | undefined =>
            customById.get(id)?.name ?? rowNames.get(id);

        // Which canned movements the right-click menu offers per row: a spin means nothing to a
        // translate group, so each row is only shown the presets its transform type can take.
        const frame0 = allFramesRef.current.get(0);
        const types = frame0 ? getEffectiveBase(frame0.base).types : null;
        const presetsFor = (id: number): DopeSheetRow["presets"] => {
            const type = types?.[id];
            if (type === undefined) return [];
            return MOTION_PRESETS.filter((p) => p.types.includes(type)).map((p) => ({
                id: p.id,
                label: p.label,
                note: p.note,
                defaultAmount: p.defaultAmount,
            }));
        };

        // Named layers (your movements and anything you've renamed) sort above the raw `gN`
        // rows, until you drag something — then your explicit order wins. Rows created after a
        // reorder aren't in it yet, so they surface at the top rather than silently at the end.
        const orderedIds = Array.from(keyframesByGroup.keys()).sort((a, b) => {
            if (rowOrder) {
                const ai = rowOrder.indexOf(a);
                const bi = rowOrder.indexOf(b);
                if (ai !== bi) return (ai < 0 ? -1 : ai) - (bi < 0 ? -1 : bi);
            }
            const named = (nameOf(a) ? 0 : 1) - (nameOf(b) ? 0 : 1);
            return named !== 0 ? named : a - b;
        });
        displayOrderRef.current = orderedIds;

        dopeSheetRows = orderedIds
            .filter((id) => !hiddenRows.has(id))
            .map((id) => {
                const custom = customById.get(id);
                const editFrames = (editFramesByGroup.get(id) ?? []).sort((a, b) => a - b);
                const userKeySet = new Set(editFrames);
                // Decoded ops belong to the sequence itself, so they stay fixed; only the user's
                // own keys are draggable/deletable.
                const decodedKeys = Array.from(keyframesByGroup.get(id) ?? [])
                    .filter((f) => !userKeySet.has(f))
                    .sort((a, b) => a - b);
                const decodedSet = new Set(decodedKeys);
                const tweened: number[] = [];
                for (let i = 0; i + 1 < editFrames.length; i++) {
                    for (let f = editFrames[i] + 1; f < editFrames[i + 1]; f++) {
                        if (!decodedSet.has(f)) tweened.push(f);
                    }
                }
                const name = nameOf(id);
                return {
                    id,
                    label: name ?? `g${id}`,
                    named: name !== undefined,
                    color: custom?.color ?? "#94a3b8",
                    keyframes: decodedKeys,
                    userKeys: editFrames,
                    tweened,
                    presets: presetsFor(id),
                    // Clicking a movement card in the panel lights up its reel here.
                    armed: id === activeGizmoGroup,
                };
            });
    }

    // Tooltips come from `<Hint>`, whose provider is at the app root.
    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col">
            {/* One file input, driven by File > Import: picking a format there points it at that
                extension, so the picker shows what you asked for. */}
            <input
                ref={importInputRef}
                type="file"
                accept=".dat,.json,.obj,.gltf,.glb"
                aria-label="Import model file"
                className="hidden"
                onChange={(e) => void onImportModelFile(e)}
            />
            <input
                ref={animPackInputRef}
                type="file"
                accept=".rsanim"
                aria-label="Open animation pack"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void loadAnimPack(file);
                }}
            />
            <ExportBundleDialog
                plan={exportPlan}
                onClose={() => setExportPlan(null)}
                onRetarget={exportBundle}
            />
            <SettingsPanel
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                bindings={bindings}
                onBindingsChange={onBindingsChange}
                onListeningChange={onHotkeyListeningChange}
            />
            <TopBar
                workspace={workspace}
                onChange={changeWorkspace}
                menus={
                    <>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                                >
                                    <FileIcon className="size-3.5" /> File
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Upload className="mr-2 size-4" /> Import
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="w-64">
                                        <DropdownMenuItem onSelect={() => openImportPicker(null)}>
                                            <span className="flex-1">Any model file…</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            disabled={modelState.status !== "ready"}
                                            onSelect={() => animPackInputRef.current?.click()}
                                            title="Every frame of one animation in a single file"
                                        >
                                            <span className="flex-1">
                                                Animation pack (.rsanim)…
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {MODEL_FORMATS.map((format) => (
                                            <DropdownMenuItem
                                                key={format.id}
                                                onSelect={() => openImportPicker(format.id)}
                                                title={format.note}
                                            >
                                                <span className="flex-1">{format.label}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger
                                        disabled={modelState.status !== "ready"}
                                    >
                                        <Download className="mr-2 size-4" /> Export
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="w-64">
                                        {/* Where a plain `.dat` used to be: the same bytes, plus the
                                        animation files if any of those changed too, and a note
                                        saying where each one packs. It calls itself a .dat when
                                        that's all it'll contain. */}
                                        <DropdownMenuItem
                                            // Not passed straight through: the menu hands its handler
                                            // an Event, which would be read as an archive id.
                                            onSelect={() => exportBundle()}
                                            title={
                                                bundleIsModelOnly
                                                    ? "The cache's own model format, with where to pack it"
                                                    : "A zip of the cache files you've changed, with where each one packs"
                                            }
                                        >
                                            <FileDown className="mr-2 size-4" />
                                            <span className="flex-1">
                                                {bundleIsModelOnly
                                                    ? "RS model (.dat)"
                                                    : "Cache bundle (.zip)"}
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {MODEL_FORMATS.filter((format) => format.id !== "dat").map(
                                            (format) => (
                                                <DropdownMenuItem
                                                    key={format.id}
                                                    onSelect={() => handleExportModel(format.id)}
                                                    title={format.note}
                                                >
                                                    <span className="flex-1">{format.label}</span>
                                                </DropdownMenuItem>
                                            ),
                                        )}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <span className="mx-1 h-5 w-px bg-border" />
                        <HistoryMenu
                            history={history}
                            onUndo={undo}
                            onRedo={redo}
                            onGoTo={goToHistory}
                            undoCombo={formatCombo(bindings.undo)}
                            redoCombo={formatCombo(bindings.redo)}
                        />
                    </>
                }
                actions={
                    <>
                        {/* Opening a cache belongs to the Workspace button in the sidebar now.
                            This one stays because it isn't a picker — it's re-granting access to
                            the folder that's already chosen, which only the page can ask for. */}
                        {needsPermission ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() => void reopenRemembered()}
                            >
                                Reopen last cache folder
                            </Button>
                        ) : null}
                        {/* TEMPORARY: a known model + sequence to land on while the editor is
                            being built. Delete this once there's no more need to keep getting
                            back to the same scene. */}
                        {cacheState.status === "ready" ? (
                            <Hint
                                heading="Test scene"
                                detail={`Loads model ${TEST_MODEL_ID} and the ${TEST_SEQ_NAME} sequence`}
                            >
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    onClick={() => {
                                        changeWorkspace("animation");
                                        loadTestScene();
                                    }}
                                >
                                    Test scene
                                </Button>
                            </Hint>
                        ) : null}
                        <Hint
                            side="bottom"
                            heading="Settings"
                            detail="Editor settings — keyboard shortcuts and the like"
                            label="Editor settings"
                        >
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-7"
                                onClick={() => setSettingsOpen(true)}
                            >
                                <Settings className="size-4" />
                            </Button>
                        </Hint>
                    </>
                }
            />
            <div className="flex min-h-0 flex-1 flex-col">
                {/* Viewport header — Blender keeps the editor's own tools in a strip like this. */}
                {cacheState.status === "ready" ? (
                    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1.5">
                        <Input
                            type="number"
                            value={modelId}
                            onChange={(e) => setModelId(e.target.value)}
                            placeholder="Model id"
                            className="h-7 w-24"
                        />
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7"
                            onClick={handleLoadModel}
                        >
                            Load model
                        </Button>
                        {modelState.status === "ready" ? (
                            <>
                                {/* Sequences are picked from the Animations panel in the animation
                                workspace, so there's nothing about them in this strip. */}
                                <span
                                    className={cn(
                                        "text-xs",
                                        visibleTriangles === null
                                            ? "text-muted-foreground"
                                            : "text-[#e87d0d]",
                                    )}
                                    title={
                                        visibleTriangles === null
                                            ? undefined
                                            : "Some labels are hidden — showing part of the model"
                                    }
                                >
                                    {visibleTriangles === null
                                        ? `${modelState.triangleCount} triangles`
                                        : `${visibleTriangles} / ${modelState.triangleCount} triangles`}
                                </span>
                            </>
                        ) : null}

                        {/* Selecting is for labelling geometry, so the tool lives in rigging. */}
                        {modelState.status === "ready" && workspace === "rigging" ? (
                            <>
                                <Hint
                                    heading={`Select tool (${formatCombo(bindings.box_select)})`}
                                    detail={
                                        selectMode
                                            ? "Click to add, Ctrl+click to remove, Ctrl+drag for a box, Alt+drag to box away"
                                            : "Pick the vertices, edges or faces a label applies to"
                                    }
                                >
                                    <Button
                                        size="sm"
                                        variant={selectMode ? "default" : "outline"}
                                        className="h-7"
                                        onClick={() => {
                                            // Arming the tool shows the points: you can't click what you
                                            // can't see. The toggle still wins afterwards.
                                            if (!selectMode) setShowVertices(true);
                                            setSelectMode((v) => !v);
                                            clearSelection();
                                        }}
                                    >
                                        <BoxSelect /> {selectMode ? "Selecting…" : "Select"}
                                    </Button>
                                </Hint>
                                {selectMode ? (
                                    /* Blender's 1 / 2 / 3 element modes. The selection itself stays a
                                   set of vertices — RS labels are per-vertex — so edge and face
                                   modes are about what a click grabs. */
                                    <div className="flex overflow-hidden rounded-md border border-border">
                                        {(
                                            [
                                                {
                                                    id: "vertex",
                                                    label: "Vertex",
                                                    key: bindings.select_mode_vertex,
                                                },
                                                {
                                                    id: "edge",
                                                    label: "Edge",
                                                    key: bindings.select_mode_edge,
                                                },
                                                {
                                                    id: "face",
                                                    label: "Face",
                                                    key: bindings.select_mode_face,
                                                },
                                            ] as const
                                        ).map((mode) => (
                                            <Hint
                                                key={mode.id}
                                                heading={`${mode.label} select (${formatCombo(
                                                    mode.key,
                                                )})`}
                                                detail={`A click grabs a whole ${mode.label.toLowerCase()}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => changeSelectElement(mode.id)}
                                                    className={cn(
                                                        "px-2 py-1 text-xs transition-colors",
                                                        selectElement === mode.id
                                                            ? "bg-[#e87d0d] text-black"
                                                            : "text-muted-foreground hover:text-foreground",
                                                    )}
                                                >
                                                    {mode.label}
                                                </button>
                                            </Hint>
                                        ))}
                                    </div>
                                ) : null}
                            </>
                        ) : null}

                        {modelState.status === "ready" ? (
                            <>
                                <span className="mx-1 h-5 w-px bg-border" />
                                {/* Independent toggles rather than exclusive modes: edges layer over
                                the model instead of replacing it, like Blender's wireframe
                                overlay. Turning faces off is how you get wireframe-only. */}
                                <div className="flex overflow-hidden rounded-md border border-border">
                                    {(
                                        [
                                            {
                                                id: "faces",
                                                label: "Faces",
                                                on: showFaces,
                                                toggle: () => setShowFaces((v) => !v),
                                                // Something has to be drawn, so the last of the two
                                                // render modes can't be turned off. Vertices are an
                                                // overlay, not geometry, so they're free either way.
                                                locked: showFaces && !showEdges,
                                                lockedHint:
                                                    "On, and something has to be drawn — turn Edges on first",
                                                hint: "The model's surfaces",
                                            },
                                            {
                                                id: "edges",
                                                label: "Edges",
                                                on: showEdges,
                                                toggle: () => setShowEdges((v) => !v),
                                                locked: showEdges && !showFaces,
                                                lockedHint:
                                                    "On, and something has to be drawn — turn Faces on first",
                                                hint: "Wireframe, layered over the model",
                                            },
                                            {
                                                id: "vertices",
                                                label: "Vertices",
                                                on: showVertices,
                                                toggle: () => setShowVertices((v) => !v),
                                                locked: false,
                                                lockedHint: "",
                                                hint: `Points at every vertex — a selection still shows either way (${formatCombo(
                                                    bindings.toggle_vertices,
                                                )})`,
                                            },
                                        ] as const
                                    ).map((toggle) => (
                                        <Hint
                                            key={toggle.id}
                                            heading={`${toggle.label} — ${
                                                toggle.on ? "on" : "off"
                                            }`}
                                            detail={toggle.locked ? toggle.lockedHint : toggle.hint}
                                        >
                                            <button
                                                type="button"
                                                disabled={toggle.locked}
                                                onClick={toggle.toggle}
                                                className={cn(
                                                    "px-2 py-1 text-xs transition-colors",
                                                    toggle.on
                                                        ? "bg-[#e87d0d] text-black"
                                                        : "text-muted-foreground hover:text-foreground",
                                                    toggle.locked && "cursor-default",
                                                )}
                                            >
                                                {toggle.label}
                                            </button>
                                        </Hint>
                                    ))}
                                </div>
                                <div className="flex overflow-hidden rounded-md border border-border">
                                    {(
                                        [
                                            {
                                                id: "shaded",
                                                label: "Shaded",
                                                hint: "The client's own lighting, so this is how the model looks in-game",
                                            },
                                            {
                                                id: "flat",
                                                label: "Flat",
                                                hint: "The colours the model was authored with and no lighting, so material regions read clearly",
                                            },
                                        ] as const
                                    ).map((mode) => (
                                        <Hint key={mode.id} heading={mode.label} detail={mode.hint}>
                                            <button
                                                type="button"
                                                onClick={() => setShading(mode.id)}
                                                className={cn(
                                                    "px-2 py-1 text-xs transition-colors",
                                                    shading === mode.id
                                                        ? "bg-[#e87d0d] text-black"
                                                        : "text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                {mode.label}
                                            </button>
                                        </Hint>
                                    ))}
                                </div>
                                <Hint
                                    heading="In-game preview"
                                    detail="A floating window showing the model as the client would draw it, following the animation live"
                                >
                                    <Button
                                        size="sm"
                                        variant={previewOpen ? "default" : "outline"}
                                        className="h-7"
                                        onClick={() => setPreviewOpen((v) => !v)}
                                    >
                                        <PictureInPicture2 /> In-game
                                    </Button>
                                </Hint>
                                {/* X-ray exists to select through the model, so it goes with rigging. */}
                                {workspace === "rigging" ? (
                                    <Hint
                                        heading={`X-ray — ${xray ? "on" : "off"} (${formatCombo(
                                            bindings.toggle_xray,
                                        )})`}
                                        detail={
                                            xray
                                                ? "The model is see-through, so you can select through faces"
                                                : "Solid model — only what you can see is selectable"
                                        }
                                    >
                                        <Button
                                            size="sm"
                                            variant={xray ? "default" : "outline"}
                                            className="h-7"
                                            onClick={() => setXray((v) => !v)}
                                        >
                                            X-ray
                                        </Button>
                                    </Hint>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                ) : null}

                {pendingDrop ? (
                    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
                        <div
                            data-testid="drop-choice"
                            // An explicit width: the `max-w-*` scale isn't in this build's CSS, so
                            // `w-full max-w-sm` would stretch the dialog across the whole viewport.
                            className="w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-4 shadow-xl"
                        >
                            <h2 className="text-sm font-semibold">{pendingDrop.file.name}</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                A model is already open. Replace it, or add this one alongside it?
                            </p>
                            <div className="mt-4 flex flex-col gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        const drop = pendingDrop;
                                        setPendingDrop(null);
                                        void loadModelFile(drop.file, drop.format);
                                    }}
                                >
                                    Load as new model
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        const drop = pendingDrop;
                                        setPendingDrop(null);
                                        void addModelFileToScene(drop.file, drop.format);
                                    }}
                                >
                                    Add to current scene
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setPendingDrop(null)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {ioMessage ? (
                    <div
                        data-testid="io-message"
                        data-tone={ioMessage.tone}
                        className={cn(
                            "mx-3 mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                            ioMessage.tone === "error"
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : "border-border bg-card text-muted-foreground",
                        )}
                    >
                        <span className="min-w-0 flex-1">{ioMessage.text}</span>
                        <button
                            type="button"
                            aria-label="Dismiss message"
                            onClick={() => setIoMessage(null)}
                            className="shrink-0 hover:text-foreground"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                ) : null}
                {cacheState.status === "error" ? (
                    <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Cache: {cacheState.message}
                    </div>
                ) : null}
                {cacheState.status === "ready" && missingModelsIndex ? (
                    <div className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
                        Loaded {cacheState.fileCount} files, but main_file_cache.idx7 (the models
                        index) wasn't among them — re-select all main_file_cache.* files, including
                        idx7.
                    </div>
                ) : null}
                {modelState.status === "error" ? (
                    <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Model: {modelState.message}
                    </div>
                ) : null}
                {seqState.status === "error" ? (
                    <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Sequence: {seqState.message}
                    </div>
                ) : null}

                <div className="flex min-h-0 flex-1">
                    <div
                        ref={containerRef}
                        className={cn(
                            "relative min-h-0 flex-1 overflow-hidden bg-background",
                            modelState.status !== "ready" && "flex items-center justify-center",
                        )}
                        onDragOver={(e) => {
                            // Without this the browser navigates to the file instead.
                            e.preventDefault();
                            if (!draggingFile) setDraggingFile(true);
                        }}
                        onDragLeave={(e) => {
                            // Ignore the leave events fired while crossing child elements.
                            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                            setDraggingFile(false);
                        }}
                        onDrop={onViewportDrop}
                    >
                        {modelState.status === "ready" ? (
                            <>
                                <canvas
                                    ref={canvasRef}
                                    className={cn(
                                        "h-full w-full touch-none",
                                        selectMode && "cursor-crosshair",
                                        // Says the handle is live before you press, so a near-miss
                                        // doesn't come as a surprise orbit.
                                        gizmoHovering && "cursor-grab active:cursor-grabbing",
                                    )}
                                    onPointerDown={onPointerDown}
                                    onPointerMove={onPointerMove}
                                    onPointerUp={onPointerUp}
                                    onPointerEnter={() => {
                                        pointerInsideRef.current = true;
                                    }}
                                    onPointerLeave={() => {
                                        pointerInsideRef.current = false;
                                    }}
                                    onWheel={onWheel}
                                    onContextMenu={(e) => e.preventDefault()}
                                    onMouseDown={(e) => {
                                        if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
                                    }}
                                />
                                <canvas
                                    ref={vertexOverlayRef}
                                    className="pointer-events-none absolute inset-0"
                                />
                                {previewOpen ? (
                                    <InGamePreview
                                        meshRef={previewMeshRef}
                                        onClose={() => setPreviewOpen(false)}
                                    />
                                ) : null}
                                {draggingFile ? (
                                    <div
                                        data-testid="drop-overlay"
                                        className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-[#e87d0d] bg-[#e87d0d]/10 text-sm font-medium text-[#e87d0d]"
                                    >
                                        Drop to open — .dat, .json, .obj, .gltf or .glb
                                    </div>
                                ) : null}
                                {/* Blender-style viewport text: mode + frame, top-left. */}
                                <div className="pointer-events-none absolute left-3 top-3 space-y-0.5 text-xs text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
                                    <div className="font-medium">
                                        {modalInfo
                                            ? `${
                                                  modalInfo.kind === "translate"
                                                      ? "Move"
                                                      : modalInfo.kind === "rotate"
                                                      ? "Rotate"
                                                      : "Scale"
                                              } — ${modalInfo.axis.toUpperCase()} axis`
                                            : selectMode
                                            ? `Edit Mode · ${selectElement[0].toUpperCase()}${selectElement.slice(
                                                  1,
                                              )} select`
                                            : "Object Mode"}
                                    </div>
                                    {seqState.status === "ready" ? (
                                        <div>
                                            {seqState.kind === "old" ? "Frame" : "Tick"} {step} /{" "}
                                            {Math.max(0, total - 1)}
                                        </div>
                                    ) : null}
                                    <div className="text-white/50">
                                        Model {modelId}
                                        {loadedSeq === null
                                            ? ""
                                            : loadedSeq === "new"
                                            ? " · New animation"
                                            : ` · Seq ${loadedSeq}${
                                                  loadedSeqName ? ` ${loadedSeqName}` : ""
                                              }`}
                                    </div>
                                </div>
                                {marquee ? (
                                    <div
                                        className="pointer-events-none absolute border border-[#e87d0d] bg-[#e87d0d]/15"
                                        style={{
                                            left: Math.min(marquee.x0, marquee.x1),
                                            top: Math.min(marquee.y0, marquee.y1),
                                            width: Math.abs(marquee.x1 - marquee.x0),
                                            height: Math.abs(marquee.y1 - marquee.y0),
                                        }}
                                    />
                                ) : null}
                                {selectMode && selectedCount > 0 ? (
                                    <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/95 p-2 text-xs shadow-lg">
                                        <span>
                                            {selectElement === "vertex"
                                                ? `${selectedCount} vertices selected`
                                                : `${selectedElements} ${selectElement}${
                                                      selectedElements === 1 ? "" : "s"
                                                  } selected · ${selectedCount} vertices`}
                                        </span>
                                        <span className="text-muted-foreground">
                                            ({formatCombo(bindings.select_more)} /{" "}
                                            {formatCombo(bindings.select_less)} to grow/shrink)
                                        </span>
                                        <span className="mx-0.5 h-5 w-px bg-border" />
                                        <select
                                            value={assignTarget}
                                            onChange={(e) =>
                                                setAssignTarget(
                                                    e.target.value === "new"
                                                        ? "new"
                                                        : Number(e.target.value),
                                                )
                                            }
                                            className="h-6 rounded border border-border/60 bg-background px-1"
                                        >
                                            <option value="new">New label…</option>
                                            {customGroups.map((g) => (
                                                <option key={g.id} value={g.id}>
                                                    Add to {g.name}
                                                </option>
                                            ))}
                                        </select>
                                        {assignTarget !== "new" ? (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => assignSelectionToGroup(assignTarget)}
                                            >
                                                <Wand2 /> Add to group
                                            </Button>
                                        ) : null}
                                        {assignTarget !== "new" ? null : (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Name (e.g. Tail)"
                                                    value={newMovementName}
                                                    onChange={(e) =>
                                                        setNewMovementName(e.target.value)
                                                    }
                                                    className="h-6 w-28 rounded border border-border/60 bg-background px-1.5"
                                                />
                                                <span className="text-muted-foreground">label</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={255}
                                                    value={newLabelId}
                                                    onChange={(e) => setNewLabelId(e.target.value)}
                                                    className="h-6 w-14 rounded border border-border/60 bg-background px-1 font-mono"
                                                />
                                                <select
                                                    value={newMovementType}
                                                    onChange={(e) =>
                                                        setNewMovementType(
                                                            Number(
                                                                e.target.value,
                                                            ) as SeqTransformType,
                                                        )
                                                    }
                                                    className="h-6 rounded border border-border/60 bg-background px-1"
                                                >
                                                    {MOVEMENT_TYPES.map((t) => (
                                                        <option key={t.value} value={t.value}>
                                                            {t.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={!newMovementName.trim()}
                                                    onClick={handleCreateMovement}
                                                >
                                                    <Wand2 /> Create movement
                                                </Button>
                                            </>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={clearSelection}
                                        >
                                            <X /> Clear
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {modelState.status === "loading"
                                    ? "Decoding..."
                                    : "Load a cache and a model to begin."}
                            </p>
                        )}
                    </div>

                    {/* A model is all either workspace needs to be useful: rigging works on its
                    labels, and animation opens on the list of sequences to try against it. */}
                    {sidebarVisible && modelState.status === "ready" ? (
                        <div className="flex w-80 shrink-0 flex-col border-l border-border bg-card p-3">
                            {/* Skeletal sequences have no keyframe editor here, so they get no tab bar
                            — which leaves this line as the only thing saying what's open, and the
                            only way back to the list. */}
                            {workspace !== "rigging" &&
                            seqState.status === "ready" &&
                            !previewingSeq &&
                            seqState.kind === "skeletal" ? (
                                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>Skeletal (Maya) · {seqState.boneCount} bones</span>
                                    <button
                                        type="button"
                                        className="ml-auto underline hover:text-foreground"
                                        onClick={() => {
                                            stopPlayback();
                                            setSeqState({ status: "empty" });
                                            setLoadedSeq(null);
                                            setSidebarTab("animations");
                                        }}
                                    >
                                        Back to animations
                                    </button>
                                </div>
                            ) : null}

                            {/* A skeletal sequence open for editing is the one case with no tabs —
                            it has no keyframe editor here. Previewing one still shows the list. */}
                            {seqState.status !== "ready" ||
                            previewingSeq ||
                            seqState.kind === "old" ? (
                                <>
                                    <div className="mb-3 flex gap-1 border-b border-border/60">
                                        {sidebarTabs.map((tab) => (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setSidebarTab(tab.id)}
                                                className={cn(
                                                    "-mb-px border-b-2 px-2 py-1.5 text-xs font-medium transition-colors",
                                                    activeSidebarTab === tab.id
                                                        ? "border-primary text-foreground"
                                                        : "border-transparent text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                {tab.label}
                                            </button>
                                        ))}
                                    </div>

                                    {activeSidebarTab === "animations" ? (
                                        <div className="flex min-h-0 flex-1 flex-col">
                                            {/* Typing offers the closest few straight away, so finding
                                            a sequence doesn't mean scrolling a list of thousands. */}
                                            <div className="relative mb-2 shrink-0">
                                                <Search className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                                <input
                                                    // Plain text, not `search`: the native clear button
                                                    // would sit on top of this one's own.
                                                    type="text"
                                                    value={animSearch}
                                                    onChange={(e) => {
                                                        setAnimSearch(e.target.value);
                                                        setSuggestionsOpen(true);
                                                        setSuggestionIndex(0);
                                                    }}
                                                    onFocus={() => setSuggestionsOpen(true)}
                                                    onBlur={() => setSuggestionsOpen(false)}
                                                    onKeyDown={(e) => {
                                                        if (animSuggestions.length === 0) return;
                                                        // Arrowing auditions each one on the model as
                                                        // it goes; Enter is what opens it.
                                                        if (
                                                            e.key === "ArrowDown" ||
                                                            e.key === "ArrowUp"
                                                        ) {
                                                            e.preventDefault();
                                                            setSuggestionsOpen(true);
                                                            const step =
                                                                e.key === "ArrowDown" ? 1 : -1;
                                                            const next =
                                                                (suggestionIndex +
                                                                    step +
                                                                    animSuggestions.length) %
                                                                animSuggestions.length;
                                                            setSuggestionIndex(next);
                                                            previewSequenceSoon(
                                                                animSuggestions[next].id,
                                                            );
                                                        } else if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            const pick =
                                                                animSuggestions[suggestionIndex] ??
                                                                animSuggestions[0];
                                                            setSuggestionsOpen(false);
                                                            loadSequenceById(pick.id);
                                                        } else if (e.key === "Escape") {
                                                            setSuggestionsOpen(false);
                                                        }
                                                    }}
                                                    placeholder={
                                                        gameVals?.available
                                                            ? "Search by name or id"
                                                            : "Search by sequence id"
                                                    }
                                                    aria-label="Search animations"
                                                    className="h-8 w-full rounded-md border border-border/60 bg-background pl-7 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-[#e87d0d]/70 focus:ring-1 focus:ring-[#e87d0d]/30"
                                                />
                                                {animSearch !== "" ? (
                                                    <Hint
                                                        heading="Clear search"
                                                        label="Clear search"
                                                    >
                                                        <button
                                                            type="button"
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => {
                                                                setAnimSearch("");
                                                                setSuggestionsOpen(false);
                                                            }}
                                                            className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                        >
                                                            <X className="size-3" />
                                                        </button>
                                                    </Hint>
                                                ) : null}

                                                {suggestionsOpen && animSuggestions.length > 0 ? (
                                                    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-2xl">
                                                        {animSuggestions.map((row, i) => (
                                                            <button
                                                                key={row.id}
                                                                type="button"
                                                                // The pointer has to act before the
                                                                // input's blur closes this.
                                                                onMouseDown={(e) =>
                                                                    e.preventDefault()
                                                                }
                                                                // Clicking commits to it, same as Enter.
                                                                // Arrowing through the list is how you
                                                                // audition one without opening it.
                                                                onClick={() => {
                                                                    setSuggestionsOpen(false);
                                                                    loadSequenceById(row.id);
                                                                }}
                                                                onMouseEnter={() =>
                                                                    setSuggestionIndex(i)
                                                                }
                                                                // No tooltip: a bubble per row would
                                                                // cover the list. The footer under it
                                                                // says what clicking does.
                                                                className={cn(
                                                                    "flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-xs transition-colors",
                                                                    i === suggestionIndex
                                                                        ? "border-[#e87d0d] bg-[#e87d0d]/15"
                                                                        : "border-transparent hover:bg-muted/50",
                                                                )}
                                                            >
                                                                <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                                                                    {highlightMatch(
                                                                        String(row.id),
                                                                        searchQuery(animSearch),
                                                                    )}
                                                                </span>
                                                                <span className="truncate">
                                                                    {row.name ? (
                                                                        highlightMatch(
                                                                            row.name,
                                                                            searchQuery(animSearch),
                                                                        )
                                                                    ) : (
                                                                        <span className="text-muted-foreground/50">
                                                                            unnamed
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </button>
                                                        ))}
                                                        <p className="border-t border-border/60 px-2 py-1 text-[10px] text-muted-foreground/70">
                                                            ↑↓ to preview · click or Enter to load ·
                                                            Esc to close
                                                        </p>
                                                    </div>
                                                ) : null}
                                            </div>

                                            {sequenceIds.length === 0 ? (
                                                <p className="text-[11px] text-muted-foreground">
                                                    No sequences in this cache to list.
                                                </p>
                                            ) : (
                                                <>
                                                    <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                                                        {matchingSequences
                                                            .slice(0, ANIM_LIST_LIMIT)
                                                            .map(({ id, name }) => {
                                                                // The timeline's transport is out of
                                                                // reach during a preview, so the row's
                                                                // own button is what stops it again.
                                                                const previewing =
                                                                    previewingSeq &&
                                                                    loadedSeq === id &&
                                                                    playing;
                                                                return (
                                                                    <div
                                                                        key={id}
                                                                        className={cn(
                                                                            "flex items-center gap-1 rounded pl-1.5 pr-0.5 text-xs",
                                                                            loadedSeq === id
                                                                                ? "bg-[#e87d0d]/20"
                                                                                : "hover:bg-muted/60",
                                                                        )}
                                                                    >
                                                                        <Hint
                                                                            side="left"
                                                                            heading={
                                                                                previewing
                                                                                    ? "Stop preview"
                                                                                    : "Preview"
                                                                            }
                                                                            detail={
                                                                                previewing
                                                                                    ? "Stops it playing on the model"
                                                                                    : "Plays it on the model without opening the editor"
                                                                            }
                                                                            label={
                                                                                previewing
                                                                                    ? `Stop previewing sequence ${id}`
                                                                                    : `Preview sequence ${id}`
                                                                            }
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                                                                                onClick={() =>
                                                                                    previewing
                                                                                        ? stopPlayback()
                                                                                        : previewSequence(
                                                                                              id,
                                                                                          )
                                                                                }
                                                                            >
                                                                                <span className="shrink-0 font-mono text-muted-foreground">
                                                                                    {id}
                                                                                </span>
                                                                                {name ? (
                                                                                    <span className="truncate">
                                                                                        {name}
                                                                                    </span>
                                                                                ) : null}
                                                                                {previewing ? (
                                                                                    <Pause className="ml-auto size-3 shrink-0 text-[#e87d0d]" />
                                                                                ) : null}
                                                                            </button>
                                                                        </Hint>
                                                                        <Hint
                                                                            side="left"
                                                                            heading="Load"
                                                                            detail="Opens it in the timeline and the keyframe editor"
                                                                            label={`Load sequence ${id}`}
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                                                                                onClick={() =>
                                                                                    loadSequenceById(
                                                                                        id,
                                                                                    )
                                                                                }
                                                                            >
                                                                                <FolderOpen className="size-3.5" />
                                                                            </button>
                                                                        </Hint>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                    <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">
                                                        {matchingSequences.length > ANIM_LIST_LIMIT
                                                            ? `First ${ANIM_LIST_LIMIT} of ${matchingSequences.length} matches — type more to narrow it down`
                                                            : `${matchingSequences.length} of ${sequenceIds.length} sequences`}
                                                    </p>
                                                </>
                                            )}

                                            {/* Below the list, where it doesn't compete with finding
                                            an existing animation. */}
                                            <div className="mt-2 shrink-0 border-t border-border/60 pt-2">
                                                {/* The editor's accent, same as the armed tab and the
                                                preset Apply — `bg-primary` reads as dead grey here. */}
                                                <Hint
                                                    heading="New animation"
                                                    detail={`Starts an empty ${NEW_ANIM_FRAMES}-frame animation — trim it on the timeline`}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            createAnimation(NEW_ANIM_FRAMES)
                                                        }
                                                        className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-[#e87d0d] text-xs font-medium text-black transition-colors hover:bg-[#f28f1f]"
                                                    >
                                                        <Plus className="size-3.5" /> New animation
                                                    </button>
                                                </Hint>
                                            </div>
                                        </div>
                                    ) : null}

                                    {activeSidebarTab === "keyframe" ? (
                                        <div className="flex min-h-0 flex-1 flex-col">
                                            <div className="mb-2 flex items-center justify-between">
                                                <p className="text-sm">
                                                    Frame {step} / {total - 1}
                                                    {inspector
                                                        ? ` · ${inspector.holdMs}ms hold`
                                                        : null}
                                                </p>
                                                {editedGroupsThisFrame ? (
                                                    <button
                                                        type="button"
                                                        className="flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
                                                        onClick={() => resetFrameEdits(step)}
                                                    >
                                                        <RotateCcw className="size-3" /> Reset frame
                                                    </button>
                                                ) : null}
                                            </div>
                                            <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                                                <span>Tween</span>
                                                <select
                                                    value={interpolation}
                                                    onChange={(e) =>
                                                        setInterpolation(
                                                            e.target.value as Interpolation,
                                                        )
                                                    }
                                                    className="h-5 rounded border border-border/60 bg-background px-1 text-[11px] text-foreground"
                                                >
                                                    <option value="smooth">
                                                        Smooth (ease in/out)
                                                    </option>
                                                    <option value="linear">Linear</option>
                                                </select>
                                                <Hint
                                                    heading="Bake tweens"
                                                    detail="Writes every generated in-between frame as a real key, so you can edit them one by one"
                                                >
                                                    <button
                                                        type="button"
                                                        className="ml-auto underline hover:text-foreground"
                                                        onClick={bakeTweens}
                                                    >
                                                        Bake tweens
                                                    </button>
                                                </Hint>
                                            </div>

                                            {/* Every label the model carries, with a button per kind of
                                            motion. A label with nothing switched on has no timeline
                                            row — which is why a new animation starts empty. Opens by
                                            itself when there's nothing else to look at. */}
                                            {movementsOpen ?? dopeSheetRows.length === 0 ? (
                                                <div className="mb-3 rounded border border-border/60 bg-background p-2 text-[11px]">
                                                    <div className="mb-1.5 flex items-center gap-2">
                                                        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                                                            Labels
                                                        </span>
                                                        <span className="text-muted-foreground/70">
                                                            click a kind of motion to give it a
                                                            timeline row
                                                        </span>
                                                        <Hint
                                                            heading="Hide labels"
                                                            label="Hide labels"
                                                        >
                                                            <button
                                                                type="button"
                                                                className="ml-auto text-muted-foreground hover:text-foreground"
                                                                onClick={() =>
                                                                    setMovementsOpen(false)
                                                                }
                                                            >
                                                                <X className="size-3" />
                                                            </button>
                                                        </Hint>
                                                    </div>

                                                    {labelRows.length === 0 ? (
                                                        <p className="text-muted-foreground">
                                                            This model carries no labels. Label some
                                                            geometry on the Rigging tab first —
                                                            nothing can move until the model says
                                                            which parts go together.
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <div className="max-h-48 space-y-0.5 overflow-y-auto">
                                                                {labelRows.map((row) => (
                                                                    <div
                                                                        key={row.label}
                                                                        className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted/50"
                                                                    >
                                                                        <span
                                                                            className="size-2 shrink-0 rounded-full"
                                                                            style={{
                                                                                backgroundColor:
                                                                                    row.color ??
                                                                                    "transparent",
                                                                                outline: row.color
                                                                                    ? undefined
                                                                                    : "1px solid rgb(255 255 255 / 0.15)",
                                                                            }}
                                                                        />
                                                                        <span
                                                                            className={cn(
                                                                                "min-w-0 flex-1 truncate",
                                                                                row.named
                                                                                    ? "text-foreground"
                                                                                    : "text-muted-foreground",
                                                                            )}
                                                                            title={`Label ${row.label}`}
                                                                        >
                                                                            {row.name}
                                                                        </span>
                                                                        <span className="shrink-0 text-muted-foreground/60">
                                                                            {row.vertexCount}
                                                                        </span>
                                                                        {MOVEMENT_TYPES.map((t) => {
                                                                            const on =
                                                                                movementsByLabel.has(
                                                                                    `${row.label}:${t.value}`,
                                                                                );
                                                                            return (
                                                                                <Hint
                                                                                    key={t.value}
                                                                                    side="left"
                                                                                    heading={`${t.label} ${row.name}`}
                                                                                    detail={
                                                                                        on
                                                                                            ? "Has a timeline row — click to remove it, and its keys with it"
                                                                                            : "Click to give it a timeline row"
                                                                                    }
                                                                                    label={`${t.label} ${row.name}`}
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        aria-pressed={
                                                                                            on
                                                                                        }
                                                                                        onClick={() =>
                                                                                            toggleLabelMovement(
                                                                                                row.label,
                                                                                                t.value,
                                                                                            )
                                                                                        }
                                                                                        className={cn(
                                                                                            "size-5 shrink-0 rounded border text-[10px] font-medium transition-colors",
                                                                                            on
                                                                                                ? "border-[#e87d0d] bg-[#e87d0d] text-black"
                                                                                                : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                                                                                        )}
                                                                                    >
                                                                                        {t.label[0]}
                                                                                    </button>
                                                                                </Hint>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            {/* The same three, applied to every label at
                                                            once — a model with twenty of them. */}
                                                            <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/60 pt-1.5">
                                                                <span className="text-muted-foreground">
                                                                    every label
                                                                </span>
                                                                {MOVEMENT_TYPES.map((t) => (
                                                                    <Hint
                                                                        key={t.value}
                                                                        heading={`${t.label} every label`}
                                                                        detail={`Gives all ${
                                                                            labelRows.length
                                                                        } of them a ${t.label.toLowerCase()} row, skipping any that already have one`}
                                                                        label={`${t.label} every label`}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                addMovements(
                                                                                    labelRows.map(
                                                                                        (r) =>
                                                                                            r.label,
                                                                                    ),
                                                                                    t.value,
                                                                                )
                                                                            }
                                                                            className="size-5 shrink-0 rounded border border-border/60 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                                        >
                                                                            {t.label[0]}
                                                                        </button>
                                                                    </Hint>
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ) : (
                                                <Hint
                                                    heading="Labels"
                                                    detail="Every label on the model, with a button per kind of motion"
                                                >
                                                    <button
                                                        type="button"
                                                        className="mb-3 self-start text-[11px] text-muted-foreground underline hover:text-foreground"
                                                        onClick={() => setMovementsOpen(true)}
                                                    >
                                                        Labels ({labelRows.length})
                                                    </button>
                                                </Hint>
                                            )}

                                            {inspector ? (
                                                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto text-xs">
                                                    {inspector.frame.transformGroups.map(
                                                        (group, i) => {
                                                            const type =
                                                                inspector.base.types[group];
                                                            const labels =
                                                                inspector.base.labels[group];
                                                            const reset =
                                                                inspector.frame.resetOriginGroups[
                                                                    i
                                                                ];
                                                            const edited =
                                                                editedGroupsThisFrame?.has(group) ??
                                                                false;
                                                            const customGroup =
                                                                customGroupsRef.current.find(
                                                                    (g) => g.id === group,
                                                                );
                                                            const tweened =
                                                                inspector.tweenedGroups.has(group);
                                                            const gizmoCapable =
                                                                type ===
                                                                    SeqTransformType.TRANSLATE ||
                                                                type === SeqTransformType.ROTATE ||
                                                                type === SeqTransformType.SCALE;
                                                            const isArmed =
                                                                activeGizmoGroup === group;
                                                            return (
                                                                <div
                                                                    key={group}
                                                                    className={cn(
                                                                        "rounded border",
                                                                        tweened && "border-dashed",
                                                                        isArmed
                                                                            ? "border-[#e87d0d] bg-[#e87d0d]/10"
                                                                            : edited
                                                                            ? "border-[#e87d0d]/50 bg-[#e87d0d]/5"
                                                                            : "border-border/60 bg-background",
                                                                    )}
                                                                >
                                                                    <div className="flex items-start">
                                                                        <Hint
                                                                            heading={
                                                                                customGroup
                                                                                    ? customGroup.name
                                                                                    : `g${group}`
                                                                            }
                                                                            detail={
                                                                                gizmoCapable
                                                                                    ? isArmed
                                                                                        ? "Armed — its gizmo is on the model; click to put it away"
                                                                                        : "Click to show its on-screen gizmo"
                                                                                    : "This kind of movement has no on-screen gizmo"
                                                                            }
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                disabled={
                                                                                    !gizmoCapable
                                                                                }
                                                                                onClick={() =>
                                                                                    setActiveGizmoGroup(
                                                                                        (g) =>
                                                                                            g ===
                                                                                            group
                                                                                                ? null
                                                                                                : group,
                                                                                    )
                                                                                }
                                                                                className={cn(
                                                                                    "min-w-0 flex-1 p-2 text-left",
                                                                                    gizmoCapable &&
                                                                                        "cursor-pointer hover:bg-primary/5",
                                                                                )}
                                                                            >
                                                                                <div className="flex items-center justify-between font-mono">
                                                                                    <span className="flex items-center gap-1.5">
                                                                                        {customGroup ? (
                                                                                            <span
                                                                                                className="size-2 shrink-0 rounded-full"
                                                                                                style={{
                                                                                                    backgroundColor:
                                                                                                        customGroup.color,
                                                                                                }}
                                                                                            />
                                                                                        ) : null}
                                                                                        {customGroup
                                                                                            ? customGroup.name
                                                                                            : `g${group}`}
                                                                                    </span>
                                                                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                                                                        {tweened ? (
                                                                                            <span
                                                                                                className="rounded bg-[#5680c2]/20 px-1 text-[10px] text-[#8fb0e6]"
                                                                                                title="Generated between your keys — edit it to make a real key here"
                                                                                            >
                                                                                                tween
                                                                                            </span>
                                                                                        ) : null}
                                                                                        {TRANSFORM_TYPE_NAMES[
                                                                                            type
                                                                                        ] ?? type}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="mt-1 flex items-baseline gap-1.5 text-left text-muted-foreground">
                                                                                    <span className="min-w-0 flex-1 truncate">
                                                                                        labels=[
                                                                                        {labels.join(
                                                                                            ",",
                                                                                        )}
                                                                                        ]
                                                                                        {reset >= 0
                                                                                            ? ` · pivot←g${reset}`
                                                                                            : ""}
                                                                                    </span>
                                                                                    {/* Which frame these numbers
                                                                        belong to. The card looks
                                                                        the same on every frame
                                                                        without it. */}
                                                                                    <span
                                                                                        className={cn(
                                                                                            "shrink-0 rounded px-1 text-[10px]",
                                                                                            edited
                                                                                                ? "bg-[#e87d0d]/20 text-[#e87d0d]"
                                                                                                : "text-muted-foreground/60",
                                                                                        )}
                                                                                    >
                                                                                        {edited
                                                                                            ? "keyed"
                                                                                            : "at"}{" "}
                                                                                        frame {step}
                                                                                    </span>
                                                                                </div>
                                                                            </button>
                                                                        </Hint>
                                                                        {/* Blender's per-property keyframe diamond: filled when keyed here. */}
                                                                        <Hint
                                                                            side="left"
                                                                            heading={
                                                                                edited
                                                                                    ? "Remove key"
                                                                                    : "Insert key"
                                                                            }
                                                                            detail={
                                                                                edited
                                                                                    ? "Keyed on this frame — removing it lets the tween take over again"
                                                                                    : "Keys this movement on this frame at its current value"
                                                                            }
                                                                            label={
                                                                                edited
                                                                                    ? "Remove key"
                                                                                    : "Insert key"
                                                                            }
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    edited
                                                                                        ? deleteKeyframeFor(
                                                                                              group,
                                                                                          )
                                                                                        : insertKeyframeFor(
                                                                                              group,
                                                                                          )
                                                                                }
                                                                                className="shrink-0 p-2 text-muted-foreground hover:text-foreground"
                                                                            >
                                                                                <Diamond
                                                                                    className={cn(
                                                                                        "size-3.5",
                                                                                        edited &&
                                                                                            "fill-[#e87d0d] text-[#e87d0d]",
                                                                                    )}
                                                                                />
                                                                            </button>
                                                                        </Hint>
                                                                    </div>
                                                                    <div className="px-2 pb-2">
                                                                        <TransformValueEditor
                                                                            type={type}
                                                                            x={
                                                                                inspector.frame
                                                                                    .transformX[i]
                                                                            }
                                                                            y={
                                                                                inspector.frame
                                                                                    .transformY[i]
                                                                            }
                                                                            z={
                                                                                inspector.frame
                                                                                    .transformZ[i]
                                                                            }
                                                                            onChange={(
                                                                                axis,
                                                                                value,
                                                                            ) =>
                                                                                updateTransformValue(
                                                                                    step,
                                                                                    group,
                                                                                    axis,
                                                                                    value,
                                                                                )
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        },
                                                    )}
                                                    {customGroups
                                                        .filter(
                                                            (g) =>
                                                                !inspector.frame.transformGroups.includes(
                                                                    g.id,
                                                                ),
                                                        )
                                                        .map((g) => {
                                                            const defaultValue =
                                                                g.type === SeqTransformType.SCALE
                                                                    ? 128
                                                                    : 0;
                                                            const gizmoCapable =
                                                                g.type ===
                                                                    SeqTransformType.TRANSLATE ||
                                                                g.type ===
                                                                    SeqTransformType.ROTATE ||
                                                                g.type === SeqTransformType.SCALE;
                                                            const isArmed =
                                                                activeGizmoGroup === g.id;
                                                            return (
                                                                <div
                                                                    key={g.id}
                                                                    className={cn(
                                                                        "rounded border border-dashed",
                                                                        isArmed
                                                                            ? "border-[#e87d0d] bg-[#e87d0d]/10"
                                                                            : "border-border/60 bg-background",
                                                                    )}
                                                                >
                                                                    <div className="flex items-start">
                                                                        <Hint
                                                                            heading={g.name}
                                                                            detail={
                                                                                gizmoCapable
                                                                                    ? isArmed
                                                                                        ? "Armed — its gizmo is on the model; click to put it away"
                                                                                        : "Click to show its on-screen gizmo"
                                                                                    : "This kind of movement has no on-screen gizmo"
                                                                            }
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                disabled={
                                                                                    !gizmoCapable
                                                                                }
                                                                                onClick={() =>
                                                                                    setActiveGizmoGroup(
                                                                                        (prev) =>
                                                                                            prev ===
                                                                                            g.id
                                                                                                ? null
                                                                                                : g.id,
                                                                                    )
                                                                                }
                                                                                className={cn(
                                                                                    "min-w-0 flex-1 p-2 text-left",
                                                                                    gizmoCapable &&
                                                                                        "cursor-pointer hover:bg-primary/5",
                                                                                )}
                                                                            >
                                                                                <div className="flex items-center justify-between font-mono">
                                                                                    <span className="flex items-center gap-1.5">
                                                                                        <span
                                                                                            className="size-2 shrink-0 rounded-full"
                                                                                            style={{
                                                                                                backgroundColor:
                                                                                                    g.color,
                                                                                            }}
                                                                                        />
                                                                                        {g.name}
                                                                                    </span>
                                                                                    <span className="text-muted-foreground">
                                                                                        {
                                                                                            TRANSFORM_TYPE_NAMES[
                                                                                                g
                                                                                                    .type
                                                                                            ]
                                                                                        }
                                                                                    </span>
                                                                                </div>
                                                                                <div className="mt-1 text-left text-muted-foreground">
                                                                                    labels=[
                                                                                    {g.label}] · not
                                                                                    keyframed here
                                                                                </div>
                                                                            </button>
                                                                        </Hint>
                                                                        <Hint
                                                                            side="left"
                                                                            heading="Insert key"
                                                                            detail="Keys this movement on this frame at its current value"
                                                                            label="Insert key"
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    insertKeyframeFor(
                                                                                        g.id,
                                                                                    )
                                                                                }
                                                                                className="shrink-0 p-2 text-muted-foreground hover:text-foreground"
                                                                            >
                                                                                <Diamond className="size-3.5" />
                                                                            </button>
                                                                        </Hint>
                                                                    </div>
                                                                    <div className="px-2 pb-2">
                                                                        <TransformValueEditor
                                                                            type={g.type}
                                                                            x={defaultValue}
                                                                            y={defaultValue}
                                                                            z={defaultValue}
                                                                            onChange={(
                                                                                axis,
                                                                                value,
                                                                            ) =>
                                                                                updateTransformValue(
                                                                                    step,
                                                                                    g.id,
                                                                                    axis,
                                                                                    value,
                                                                                )
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            ) : null}
                                            <p className="mt-2 text-[11px] text-muted-foreground">
                                                Live preview only — edits aren't saved back to the
                                                cache. Frames between two of your keys are tweened
                                                automatically; frames before/after your keys hold
                                                the nearest one. Frames with original animation data
                                                keep it.
                                            </p>
                                        </div>
                                    ) : null}

                                    {activeSidebarTab === "ai" ? (
                                        <AiPanel assistant={aiAssistant} />
                                    ) : null}

                                    {activeSidebarTab === "config" ? (
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            <SeqConfigEditor
                                                seq={seqTypeRef.current}
                                                frame={step}
                                                onChange={() => {
                                                    seqConfigDirtyRef.current = true;
                                                    setSeqConfigVersion((n) => n + 1);
                                                    // Re-applies the frame so the hold shown on the
                                                    // keyframe tab follows an edited delay.
                                                    applyEffectiveOldFrame(stepCountRef.current);
                                                }}
                                            />
                                        </div>
                                    ) : null}

                                    {activeSidebarTab === "labels" ? (
                                        <div className="flex min-h-0 flex-1 flex-col">
                                            {/* Two ways a model can be rigged: the classic per-vertex labels the
                                            old-style animations move, and the skeleton newer models are
                                            weighted to. A model carries one or the other, so they get a tab
                                            each rather than being stacked. */}
                                            <div className="mb-2 flex overflow-hidden rounded-md border border-border">
                                                {(
                                                    [
                                                        {
                                                            id: "labels",
                                                            label: "Labels",
                                                            count: labelRows.length,
                                                            enabled: true,
                                                        },
                                                        {
                                                            id: "bones",
                                                            label: "Bones",
                                                            count: boneGroups.length,
                                                            enabled: BONES_TAB_ENABLED,
                                                        },
                                                    ] as const
                                                ).map((tab) => (
                                                    <button
                                                        key={tab.id}
                                                        type="button"
                                                        disabled={!tab.enabled}
                                                        title={
                                                            tab.enabled
                                                                ? undefined
                                                                : `${tab.label} — coming soon`
                                                        }
                                                        onClick={() => setRigTab(tab.id)}
                                                        className={cn(
                                                            "flex-1 px-2 py-1 text-xs transition-colors",
                                                            rigTab === tab.id && tab.enabled
                                                                ? "bg-[#e87d0d] text-black"
                                                                : "text-muted-foreground",
                                                            tab.enabled
                                                                ? "hover:text-foreground"
                                                                : "cursor-not-allowed opacity-40",
                                                        )}
                                                    >
                                                        {tab.label}
                                                        {tab.enabled ? (
                                                            <span className="ml-1 opacity-70">
                                                                {tab.count}
                                                            </span>
                                                        ) : (
                                                            <span className="ml-1 text-[9px] uppercase">
                                                                soon
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>

                                            {rigTab === "bones" && BONES_TAB_ENABLED ? (
                                                <div className="flex min-h-0 flex-1 flex-col">
                                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                                        <p className="text-[11px] text-muted-foreground">
                                                            {boneGroups.length === 0
                                                                ? "No bones yet. Select vertices in the viewport and weight them to one."
                                                                : "Click a bone to select the vertices it moves."}
                                                        </p>
                                                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                                                            min weight
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={255}
                                                                value={minWeight}
                                                                aria-label="Minimum bone weight"
                                                                onChange={(e) =>
                                                                    rebuildBoneGroups(
                                                                        Math.max(
                                                                            1,
                                                                            Number(
                                                                                e.target.value,
                                                                            ) || 1,
                                                                        ),
                                                                    )
                                                                }
                                                                className="no-spinner h-5 w-10 rounded border border-border/60 bg-background px-1 font-mono"
                                                            />
                                                        </label>
                                                    </div>

                                                    {/* Weighting a selection is how a skeleton gets built here: the
                                                    model stores which bones move each vertex, and by how much. */}
                                                    <div className="mb-2 flex items-center gap-1.5 rounded border border-border/60 bg-background p-2 text-[11px]">
                                                        <span className="text-muted-foreground">
                                                            bone
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={255}
                                                            value={newBoneId}
                                                            aria-label="Bone id"
                                                            onChange={(e) =>
                                                                setNewBoneId(e.target.value)
                                                            }
                                                            className="no-spinner h-6 w-12 rounded border border-border/60 bg-card px-1 font-mono"
                                                        />
                                                        <span className="text-muted-foreground">
                                                            weight
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={255}
                                                            value={newBoneWeight}
                                                            aria-label="Bone weight"
                                                            onChange={(e) =>
                                                                setNewBoneWeight(e.target.value)
                                                            }
                                                            className="no-spinner h-6 w-12 rounded border border-border/60 bg-card px-1 font-mono"
                                                        />
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            className="ml-auto h-6 px-2 text-[11px]"
                                                            disabled={modelState.status !== "ready"}
                                                            onClick={() => {
                                                                const bone = Number.parseInt(
                                                                    newBoneId,
                                                                    10,
                                                                );
                                                                const weight = Number.parseInt(
                                                                    newBoneWeight,
                                                                    10,
                                                                );
                                                                const problem =
                                                                    assignSelectionToBone(
                                                                        Number.isNaN(bone)
                                                                            ? nextFreeBone()
                                                                            : bone,
                                                                        Number.isNaN(weight)
                                                                            ? 255
                                                                            : weight,
                                                                    );
                                                                setBoneMessage(problem);
                                                                if (!problem)
                                                                    setNewBoneId(
                                                                        String(nextFreeBone() + 1),
                                                                    );
                                                            }}
                                                        >
                                                            <Bone /> Weight selection
                                                        </Button>
                                                    </div>
                                                    <p className="mb-2 text-[11px] text-muted-foreground">
                                                        {boneMessage ??
                                                            `${selectedCount} vertices selected`}
                                                    </p>

                                                    {boneGroups.length > 0 ? (
                                                        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border/60 bg-background">
                                                            <div className="space-y-0.5 p-1">
                                                                {boneGroups.map((group) => (
                                                                    <div
                                                                        key={group.bone}
                                                                        className="group flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-card"
                                                                    >
                                                                        <Bone className="size-3.5 shrink-0 text-muted-foreground" />
                                                                        <Hint
                                                                            side="left"
                                                                            heading={`Bone ${group.bone}`}
                                                                            detail={`Selects the ${group.vertices.length} vertices weighted to it`}
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    selectVertices(
                                                                                        group.vertices,
                                                                                    )
                                                                                }
                                                                                className="min-w-0 flex-1 truncate text-left font-mono hover:text-[#e87d0d]"
                                                                            >
                                                                                bone {group.bone}
                                                                            </button>
                                                                        </Hint>
                                                                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                                                            {group.vertices.length}
                                                                        </span>
                                                                        <Hint
                                                                            side="left"
                                                                            heading="Delete bone"
                                                                            detail="Removes this bone's weight from every vertex"
                                                                            label={`Delete bone ${group.bone}`}
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    removeBone(
                                                                                        group.bone,
                                                                                    )
                                                                                }
                                                                                className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                                                                            >
                                                                                <Trash2 className="size-3.5" />
                                                                            </button>
                                                                        </Hint>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                                        Bones built here are stored on the model and
                                                        go out with an export. The skeleton&apos;s
                                                        own shape — how bones are parented and posed
                                                        — lives in the sequence files, which this
                                                        editor doesn&apos;t write yet.
                                                    </p>
                                                </div>
                                            ) : (
                                                <>
                                                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                                                        Every label on this model. Click one to
                                                        select its vertices; the eye hides it, and{" "}
                                                        <Focus className="inline size-3" /> shows
                                                        only it.
                                                    </p>
                                                    <div className="mb-2 flex items-center gap-2">
                                                        {hiddenLabels.size > 0 ||
                                                        isolatedLabels.size > 0 ? (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-6 px-2 text-[11px] text-[#e87d0d]"
                                                                onClick={showAllLabels}
                                                            >
                                                                <Eye /> Show all
                                                            </Button>
                                                        ) : null}
                                                        <Button
                                                            size="sm"
                                                            variant={
                                                                creatingLabel
                                                                    ? "default"
                                                                    : "outline"
                                                            }
                                                            className="ml-auto h-6 shrink-0 px-2 text-[11px]"
                                                            disabled={modelState.status !== "ready"}
                                                            onClick={() =>
                                                                creatingLabel
                                                                    ? setCreatingLabel(false)
                                                                    : beginCreateLabel()
                                                            }
                                                        >
                                                            <Wand2 /> Create label
                                                        </Button>
                                                    </div>

                                                    {creatingLabel ? (
                                                        <div className="mb-3 space-y-2 rounded border border-[#e87d0d]/50 bg-[#e87d0d]/5 p-2 text-[11px]">
                                                            <div className="flex items-center gap-1.5">
                                                                <input
                                                                    type="text"
                                                                    placeholder="Name"
                                                                    value={newMovementName}
                                                                    onChange={(e) =>
                                                                        setNewMovementName(
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5"
                                                                />
                                                                <span className="text-muted-foreground">
                                                                    label
                                                                </span>
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={255}
                                                                    value={newLabelId}
                                                                    onChange={(e) =>
                                                                        setNewLabelId(
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    className="no-spinner h-6 w-12 rounded border border-border/60 bg-background px-1 font-mono"
                                                                />
                                                                <select
                                                                    value={newMovementType}
                                                                    onChange={(e) =>
                                                                        setNewMovementType(
                                                                            Number(
                                                                                e.target.value,
                                                                            ) as SeqTransformType,
                                                                        )
                                                                    }
                                                                    className="h-6 rounded border border-border/60 bg-background px-1"
                                                                >
                                                                    {MOVEMENT_TYPES.map((t) => (
                                                                        <option
                                                                            key={t.value}
                                                                            value={t.value}
                                                                        >
                                                                            {t.label}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div>
                                                                <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    Target by colour
                                                                </p>
                                                                <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                                                                    {colorGroups.map((group) => (
                                                                        <button
                                                                            key={group.color}
                                                                            type="button"
                                                                            title={`${group.vertices.length} vertices across ${group.faceCount} faces`}
                                                                            onClick={() =>
                                                                                selectVertices(
                                                                                    group.vertices,
                                                                                )
                                                                            }
                                                                            className="size-5 rounded border border-border/60 transition-transform hover:scale-110"
                                                                            style={{
                                                                                backgroundColor:
                                                                                    group.css,
                                                                            }}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <div className="mb-1 flex items-center justify-between">
                                                                    <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                                                                        Target by weight
                                                                    </p>
                                                                    {boneGroups.length > 0 ? (
                                                                        <label className="flex items-center gap-1 text-muted-foreground">
                                                                            min
                                                                            <input
                                                                                type="number"
                                                                                min={1}
                                                                                max={255}
                                                                                value={minWeight}
                                                                                onChange={(e) =>
                                                                                    rebuildBoneGroups(
                                                                                        Math.max(
                                                                                            1,
                                                                                            Number(
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                            ) || 1,
                                                                                        ),
                                                                                    )
                                                                                }
                                                                                className="no-spinner h-5 w-10 rounded border border-border/60 bg-background px-1 font-mono"
                                                                            />
                                                                        </label>
                                                                    ) : null}
                                                                </div>
                                                                {boneGroups.length === 0 ? (
                                                                    <p className="text-muted-foreground">
                                                                        This model has no bone
                                                                        weights — it's animated by
                                                                        vertex labels, not skinning.
                                                                    </p>
                                                                ) : (
                                                                    <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                                                                        {boneGroups.map((group) => (
                                                                            <button
                                                                                key={group.bone}
                                                                                type="button"
                                                                                title={`${group.vertices.length} vertices weighted to bone ${group.bone}`}
                                                                                onClick={() =>
                                                                                    selectVertices(
                                                                                        group.vertices,
                                                                                    )
                                                                                }
                                                                                className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono hover:border-[#e87d0d]"
                                                                            >
                                                                                b{group.bone}
                                                                                <span className="ml-1 text-muted-foreground">
                                                                                    {
                                                                                        group
                                                                                            .vertices
                                                                                            .length
                                                                                    }
                                                                                </span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 border-t border-border/60 pt-2">
                                                                <span className="text-muted-foreground">
                                                                    {selectedCount} vertices
                                                                    targeted
                                                                </span>
                                                                <Button
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    className="ml-auto h-6 px-2 text-[11px]"
                                                                    disabled={
                                                                        selectedCount === 0 ||
                                                                        !newMovementName.trim()
                                                                    }
                                                                    onClick={() => {
                                                                        handleCreateMovement();
                                                                        setCreatingLabel(false);
                                                                    }}
                                                                >
                                                                    Create from selection
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    {labelRows.length === 0 ? (
                                                        <p className="text-xs text-muted-foreground">
                                                            This model carries no vertex labels —
                                                            select vertices in the viewport and
                                                            click "Create label" to add one.
                                                        </p>
                                                    ) : (
                                                        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border/60 bg-background">
                                                            <div className="space-y-0.5 p-1">
                                                                {labelRows.map((row) => {
                                                                    const group = row.group;
                                                                    const Icon = group
                                                                        ? MOVEMENT_TYPE_ICONS[
                                                                              group.type
                                                                          ] ?? Move
                                                                        : Tag;
                                                                    const isolated =
                                                                        isolatedLabels.has(
                                                                            row.label,
                                                                        );
                                                                    const hidden = hiddenLabels.has(
                                                                        row.label,
                                                                    );
                                                                    // Solo wins while it's on, so a row the
                                                                    // eye left visible can still be off-screen.
                                                                    const soloing =
                                                                        isolatedLabels.size > 0;
                                                                    const shown = soloing
                                                                        ? isolated
                                                                        : !hidden;
                                                                    return (
                                                                        <div
                                                                            key={row.label}
                                                                            className={cn(
                                                                                "group flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-card",
                                                                                !shown &&
                                                                                    "opacity-40",
                                                                            )}
                                                                        >
                                                                            <RowAction
                                                                                heading={
                                                                                    hidden
                                                                                        ? `Show ${row.name}`
                                                                                        : `Hide ${row.name}`
                                                                                }
                                                                                detail={
                                                                                    hidden
                                                                                        ? "Currently hidden. Its faces and vertex points aren't drawn, and a box select can't pick them up."
                                                                                        : "Hides this label's faces and vertex points, leaving the rest of the model. Other labels keep whatever you set."
                                                                                }
                                                                                onClick={() =>
                                                                                    toggleHiddenLabel(
                                                                                        row.label,
                                                                                    )
                                                                                }
                                                                                className="text-muted-foreground"
                                                                            >
                                                                                {hidden ? (
                                                                                    <EyeOff className="size-3.5" />
                                                                                ) : (
                                                                                    <Eye className="size-3.5" />
                                                                                )}
                                                                            </RowAction>
                                                                            <RowAction
                                                                                heading={
                                                                                    isolated
                                                                                        ? `Stop soloing ${row.name}`
                                                                                        : `Solo ${row.name}`
                                                                                }
                                                                                detail={
                                                                                    isolated
                                                                                        ? "Only soloed labels are drawn. Turn it off to go back to what the eyes say."
                                                                                        : "Shows only this label and hides everything else. Solo more than one to see them together; it overrides the eyes while it's on."
                                                                                }
                                                                                onClick={() =>
                                                                                    toggleIsolatedLabel(
                                                                                        row.label,
                                                                                    )
                                                                                }
                                                                                className={
                                                                                    isolated
                                                                                        ? "text-[#e87d0d]"
                                                                                        : "text-muted-foreground"
                                                                                }
                                                                            >
                                                                                <Focus className="size-3.5" />
                                                                            </RowAction>
                                                                            <span
                                                                                className="size-2 shrink-0 rounded-full"
                                                                                style={{
                                                                                    backgroundColor:
                                                                                        row.color ??
                                                                                        "rgba(255,255,255,0.35)",
                                                                                }}
                                                                            />
                                                                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                                                                            {renamingLabel ===
                                                                            row.label ? (
                                                                                <input
                                                                                    autoFocus
                                                                                    value={
                                                                                        renameDraft
                                                                                    }
                                                                                    onChange={(e) =>
                                                                                        setRenameDraft(
                                                                                            e.target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                    onKeyDown={(
                                                                                        e,
                                                                                    ) => {
                                                                                        if (
                                                                                            e.key ===
                                                                                            "Enter"
                                                                                        ) {
                                                                                            renameLabel(
                                                                                                row,
                                                                                                renameDraft,
                                                                                            );
                                                                                            setRenamingLabel(
                                                                                                null,
                                                                                            );
                                                                                        } else if (
                                                                                            e.key ===
                                                                                            "Escape"
                                                                                        ) {
                                                                                            setRenamingLabel(
                                                                                                null,
                                                                                            );
                                                                                        }
                                                                                    }}
                                                                                    className="h-5 min-w-0 flex-1 rounded border border-border/60 bg-card px-1"
                                                                                />
                                                                            ) : (
                                                                                <Hint
                                                                                    side="left"
                                                                                    heading={`${row.name} · label ${row.label}`}
                                                                                    detail={`Selects its ${row.vertexCount} vertices`}
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            selectLabel(
                                                                                                row.label,
                                                                                            )
                                                                                        }
                                                                                        className={cn(
                                                                                            "min-w-0 flex-1 truncate text-left hover:text-[#e87d0d]",
                                                                                            !row.named &&
                                                                                                "text-muted-foreground",
                                                                                        )}
                                                                                    >
                                                                                        {row.name}
                                                                                    </button>
                                                                                </Hint>
                                                                            )}
                                                                            <span
                                                                                title={`label ${row.label}`}
                                                                                className="shrink-0 font-mono text-[10px] text-muted-foreground"
                                                                            >
                                                                                {row.vertexCount}
                                                                            </span>
                                                                            {renamingLabel ===
                                                                            row.label ? (
                                                                                <Hint
                                                                                    heading="Save name"
                                                                                    label="Save name"
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                                                                        onClick={() => {
                                                                                            renameLabel(
                                                                                                row,
                                                                                                renameDraft,
                                                                                            );
                                                                                            setRenamingLabel(
                                                                                                null,
                                                                                            );
                                                                                        }}
                                                                                    >
                                                                                        <Check className="size-3.5" />
                                                                                    </button>
                                                                                </Hint>
                                                                            ) : (
                                                                                <Hint
                                                                                    side="left"
                                                                                    heading="Rename"
                                                                                    detail="Names this label, in this workspace, for this model"
                                                                                    label={`Rename ${row.name}`}
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                                                                                        onClick={() => {
                                                                                            setRenamingLabel(
                                                                                                row.label,
                                                                                            );
                                                                                            setRenameDraft(
                                                                                                row.name,
                                                                                            );
                                                                                        }}
                                                                                    >
                                                                                        <Pencil className="size-3.5" />
                                                                                    </button>
                                                                                </Hint>
                                                                            )}
                                                                            {group ? (
                                                                                <Hint
                                                                                    side="left"
                                                                                    heading="Delete movement"
                                                                                    detail="Removes its timeline row and any keys on it. The label itself stays."
                                                                                    label={`Delete movement ${row.name}`}
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                                                                                        onClick={() =>
                                                                                            deleteCustomGroup(
                                                                                                group.id,
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        <Trash2 className="size-3.5" />
                                                                                    </button>
                                                                                </Hint>
                                                                            ) : (
                                                                                // Labels that came with the model aren't ours to
                                                                                // remove; keeps the rows aligned.
                                                                                <span className="size-3.5 shrink-0" />
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ) : null}
                                </>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                {/* The timeline is always there in the animation workspace, so you can see what
                you're about to get — it just sits behind a blur, doing nothing, until there's an
                animation to drive it. */}
                {workspace === "animation" && modelState.status === "ready" ? (
                    <div className="relative border-t border-border bg-card">
                        <div
                            className={cn(
                                "flex flex-col gap-2 px-3 py-2",
                                !seqEditable &&
                                    "pointer-events-none select-none opacity-40 blur-[2px]",
                            )}
                        >
                            {/* Gives up exactly what the rows below lose to their scrollbar gutter, so
                        the Timeline and every track measure a frame against the same width. */}
                            <div
                                className="flex items-center gap-3"
                                style={{ paddingRight: trackGutter }}
                            >
                                {/* Fixed-width so the Timeline's 0% lines up with the DopeSheet rows'
                            track start, which reserve the same width for their label column. */}
                                <div
                                    className="flex shrink-0 items-center gap-3"
                                    style={{ width: TRACK_LABEL_PX }}
                                >
                                    <Button
                                        size="icon"
                                        variant="outline"
                                        aria-label="Previous frame"
                                        onClick={() => onFrameStep(-1)}
                                    >
                                        <SkipBack />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        aria-label={playing ? "Pause" : "Play"}
                                        onClick={playing ? stopPlayback : startPlayback}
                                    >
                                        {playing ? <Pause /> : <Play />}
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="outline"
                                        aria-label="Next frame"
                                        onClick={() => onFrameStep(1)}
                                    >
                                        <SkipForward />
                                    </Button>
                                </div>
                                <Timeline
                                    total={total}
                                    step={step}
                                    keyframedSteps={
                                        seqState.status === "ready" && seqState.kind === "old"
                                            ? new Set(editsRef.current.keys())
                                            : undefined
                                    }
                                    onScrub={onScrub}
                                />
                                {/* Always this wide, whatever is in it, because every dope sheet row
                            reserves the same to keep its track the same length as the Timeline. */}
                                <div
                                    className="flex shrink-0 items-center justify-end gap-1 text-[11px] text-muted-foreground"
                                    style={{ width: TRACK_TRAILING_PX }}
                                >
                                    <span className="text-xs">
                                        {step} / {Math.max(0, total - 1)}
                                    </span>
                                    {/* A new animation starts at its full length, so trimming it back is
                                part of authoring one rather than a rare repair. */}
                                    {seqState.status === "ready" && seqState.kind === "old" ? (
                                        <>
                                            <span className="ml-1">frames</span>
                                            <Hint
                                                heading="Length"
                                                detail="How many frames long this animation is. Trimming drops the frames past the new end, and their keys with them."
                                            >
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={MAX_ANIM_FRAMES}
                                                    // Held as a draft until you're done typing: applying each
                                                    // keystroke would trim to 5 on the way to typing 50, taking
                                                    // everything keyed past frame 5 with it.
                                                    value={lengthDraft ?? String(total)}
                                                    aria-label="Animation length in frames"
                                                    onChange={(e) => setLengthDraft(e.target.value)}
                                                    onBlur={() => {
                                                        const n = Number.parseInt(
                                                            lengthDraft ?? "",
                                                            10,
                                                        );
                                                        if (!Number.isNaN(n)) setAnimationLength(n);
                                                        setLengthDraft(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter")
                                                            e.currentTarget.blur();
                                                        else if (e.key === "Escape")
                                                            setLengthDraft(null);
                                                    }}
                                                    className="no-spinner h-6 w-12 rounded border border-border/60 bg-background px-1 text-center font-mono text-foreground"
                                                />
                                            </Hint>
                                            <Hint
                                                heading="Remove frame"
                                                detail="Drops the frame you're on, pulling the ones after it back a place"
                                                label="Remove this frame"
                                            >
                                                <button
                                                    type="button"
                                                    disabled={total <= 1}
                                                    className="rounded p-1 hover:text-destructive disabled:opacity-40"
                                                    onClick={() => removeFrame(step)}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </Hint>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                            {seqState.status !== "ready" || seqState.kind === "old" ? (
                                <div className="border-t border-border/60 pt-2">
                                    <DopeSheet
                                        total={total}
                                        step={step}
                                        rows={dopeSheetRows}
                                        onScrub={onScrub}
                                        hiddenCount={hiddenRows.size}
                                        onInsertKeyframe={insertKeyframeAtFrame}
                                        onDeleteKeyframe={deleteKeyframeAtFrame}
                                        onMoveKeyframe={moveKeyframe}
                                        onClearRow={clearKeyframeRow}
                                        onApplyPreset={applyMotionPreset}
                                        onRenameRow={renameRow}
                                        onToggleHidden={toggleRowHidden}
                                        onReorderRows={reorderRows}
                                        onShowAllRows={showAllRows}
                                        onGutterChange={setTrackGutter}
                                    />
                                </div>
                            ) : null}
                        </div>
                        {!seqEditable ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                {/* A preview deliberately leaves the timeline inert, which is easy to read
                            as it being broken. Opening it is a click on the thing you're looking
                            at, rather than a trip back to the panel. */}
                                {previewingSeq && typeof loadedSeq === "number" ? (
                                    <button
                                        type="button"
                                        onClick={() => loadSequenceById(loadedSeq)}
                                        className="rounded-md border border-[#e87d0d]/60 bg-card px-3 py-1.5 text-xs text-foreground shadow transition-colors hover:bg-[#e87d0d]/15"
                                    >
                                        Previewing — click to open it and use the timeline
                                    </button>
                                ) : (
                                    <p className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow">
                                        Pick an animation in the panel, or start a new one, to use
                                        the timeline
                                    </p>
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* Blender-style status bar: contextual key hints for whatever you're doing right now. */}
                <div className="flex items-center gap-4 border-t border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
                    {(() => {
                        const key = (id: HotkeyActionId): string => formatCombo(bindings[id]);
                        let hints: [string, string][];
                        if (workspace === "rigging" && !modalInfo && !selectMode) {
                            hints = [
                                ["LMB / MMB drag", "Orbit"],
                                [key("box_select"), "Select tool"],
                                ["Create movement", "New label"],
                                ["Double-click a name", "Rename"],
                                [key("toggle_sidebar"), "Sidebar"],
                            ];
                        } else if (modalInfo) {
                            hints = [
                                ["Move mouse", "Adjust"],
                                [`${key("axis_x")} / ${key("axis_y")} / ${key("axis_z")}`, "Axis"],
                                ["Shift", "Precision"],
                                [`LMB / ${key("confirm")}`, "Confirm"],
                                [`RMB / ${key("cancel")}`, "Cancel"],
                            ];
                        } else if (selectMode) {
                            hints = [
                                ["LMB click", `Add ${selectElement}`],
                                ["Ctrl click", "Remove"],
                                ["Ctrl drag", "Box add"],
                                ["Alt drag", "Box remove"],
                                [
                                    `${key("select_mode_vertex")} / ${key(
                                        "select_mode_edge",
                                    )} / ${key("select_mode_face")}`,
                                    "Vertex / edge / face",
                                ],
                                [`${key("select_more")} / ${key("select_less")}`, "Grow / shrink"],
                                [key("toggle_xray"), `X-ray ${xray ? "on" : "off"}`],
                                [key("select_all"), "Select all"],
                                [key("cancel"), "Exit"],
                            ];
                        } else if (activeGizmoGroup !== null) {
                            hints = [
                                ["Drag handle", "Transform"],
                                [
                                    `${key("grab")} / ${key("rotate")} / ${key("scale")}`,
                                    "Modal transform",
                                ],
                                [key("insert_keyframe"), "Insert key"],
                                [key("delete_keyframe"), "Delete key"],
                                [key("cancel"), "Disarm"],
                            ];
                        } else {
                            hints = [
                                ["LMB / MMB drag", "Orbit"],
                                ["Scroll", "Zoom"],
                                ["Click a group", "Gizmo"],
                                [key("play_pause"), "Play"],
                                [`${key("frame_prev")} / ${key("frame_next")}`, "Frame"],
                                [key("toggle_sidebar"), "Sidebar"],
                            ];
                        }
                        return hints.map(([k, label]) => (
                            <span
                                key={`${k}-${label}`}
                                className="flex items-center gap-1 whitespace-nowrap"
                            >
                                <kbd className="rounded border border-border/60 bg-background px-1 font-mono text-[10px] text-foreground/80">
                                    {k}
                                </kbd>
                                {label}
                            </span>
                        ));
                    })()}
                    <span className="ml-auto whitespace-nowrap">
                        {seqState.status === "ready"
                            ? `Frame ${step} / ${Math.max(0, total - 1)}`
                            : "No sequence"}
                        {sidebarVisible
                            ? ""
                            : ` · Sidebar hidden (${formatCombo(bindings.toggle_sidebar)})`}
                    </span>
                </div>
            </div>
        </div>
    );
}
