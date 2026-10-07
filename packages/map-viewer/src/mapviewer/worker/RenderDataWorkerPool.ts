import { ModuleThread, Pool, spawn } from "threads";
import { QueuedTask } from "threads/dist/master/pool";
import { WorkerDescriptor } from "threads/dist/master/pool-types";
import { ObservablePromise } from "threads/dist/observable-promise";

import type { LiveMinimapWorkerResult } from "../../mapeditor/liveMinimapWorkerPayload";
import { transferLiveMinimapWorkerRequest } from "../../mapeditor/liveMinimapWorkerPayload";
import { EditorMapData } from "../../mapeditor/webgl/loader/EditorMapData";
import type { SceneData } from "../../mapeditor/webgl/loader/EditorMapData";
import { EditorMapObjectChunkData } from "../../mapeditor/webgl/loader/EditorMapObjectChunkData";
import { EditorMapTerrainData } from "../../mapeditor/webgl/loader/EditorMapTerrainData";
import type { SceneLocData } from "../../mapeditor/webgl/sceneLocData";
import { LoadedCache } from "../Caches";
import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { MinimapData } from "./MinimapData";
import { RenderDataLoader } from "./RenderDataLoader";
import { RenderDataWorker } from "./RenderDataWorker";

type RenderDataWorkerThread = ModuleThread<RenderDataWorker>;

function spawnWorker(): Promise<RenderDataWorkerThread> {
    const worker = new Worker(new URL("./RenderDataWorker", import.meta.url));
    return spawn<RenderDataWorker>(worker);
}

export class RenderDataWorkerPool {
    static create(size: number): RenderDataWorkerPool {
        const pool = Pool(() => spawnWorker(), size);
        const workers = pool["workers"] as WorkerDescriptor<RenderDataWorkerThread>[];
        return new RenderDataWorkerPool(pool, workers, size);
    }

    constructor(
        readonly pool: Pool<RenderDataWorkerThread>,
        readonly workers: WorkerDescriptor<RenderDataWorkerThread>[],
        readonly size: number,
    ) {}

    initCache(cache: LoadedCache, objSpawns: ObjSpawn[], npcSpawns: NpcSpawn[]): void {
        for (const worker of this.workers) {
            worker.init.then((w) => w.initCache(cache, objSpawns, npcSpawns));
        }
    }

    async runAll(task: (w: RenderDataWorkerThread) => any): Promise<void> {
        await Promise.all(this.workers.map((desc) => desc.init.then(task)));
    }

    initLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.initDataLoader(loader));
    }

    resetLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.resetDataLoader(loader));
    }

    queueLoad<I, D, Loader extends RenderDataLoader<I, D>>(
        loader: Loader,
        input: I,
    ): QueuedTask<RenderDataWorkerThread, D> {
        return this.pool.queue((w) => w.load(loader, input) as ObservablePromise<D>);
    }

    queueLoadEditorMapData(
        mapX: number,
        mapY: number,
        smoothUnderlays: boolean,
    ): QueuedTask<RenderDataWorkerThread, EditorMapData | undefined> {
        return this.pool.queue(
            (w) =>
                w.loadEditorMapData(mapX, mapY, smoothUnderlays) as ObservablePromise<
                    EditorMapData | undefined
                >,
        );
    }

    queueLoadEditorMapTerrainData(
        mapX: number,
        mapY: number,
        heightMapTextureData: Float32Array,
        smoothUnderlays: boolean,
    ): QueuedTask<RenderDataWorkerThread, EditorMapTerrainData | undefined> {
        return this.pool.queue(
            (w) =>
                w.loadEditorMapTerrainData(
                    mapX,
                    mapY,
                    heightMapTextureData,
                    smoothUnderlays,
                ) as ObservablePromise<EditorMapTerrainData | undefined>,
        );
    }

    queueLoadEditorMapObjectData(
        mapX: number,
        mapY: number,
        borderSize: number,
        scene: SceneData,
        sceneLocData: SceneLocData,
        chunkIds: number[],
        smoothUnderlays: boolean,
    ): QueuedTask<RenderDataWorkerThread, EditorMapObjectChunkData[] | undefined> {
        return this.pool.queue(
            (w) =>
                w.loadEditorMapObjectData(
                    mapX,
                    mapY,
                    borderSize,
                    scene,
                    sceneLocData,
                    chunkIds,
                    smoothUnderlays,
                ) as ObservablePromise<EditorMapObjectChunkData[] | undefined>,
        );
    }

    queueEditorLiveMinimap(
        payload: ReturnType<typeof transferLiveMinimapWorkerRequest>,
    ): QueuedTask<RenderDataWorkerThread, LiveMinimapWorkerResult> {
        return this.pool.queue((w) => w.renderLiveEditorMinimap(payload));
    }

    queueLoadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): QueuedTask<RenderDataWorkerThread, Int32Array> {
        return this.pool.queue(
            (w) => w.loadTexture(id, size, flipH, brightness) as ObservablePromise<Int32Array>,
        );
    }

    queueMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
        shaded: boolean = true,
        renderLocs: boolean = true,
    ): QueuedTask<RenderDataWorkerThread, MinimapData | undefined> {
        return this.pool.queue((w) =>
            w.loadMapImage(mapX, mapY, level, drawMapFunctions, shaded, renderLocs),
        );
    }

    queueMapOverlayImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): QueuedTask<RenderDataWorkerThread, MinimapData | undefined> {
        return this.pool.queue((w) => w.loadMapOverlayImage(mapX, mapY, level, drawMapFunctions));
    }

    queueHasPlaneTiles(
        mapX: number,
        mapY: number,
        plane: number,
        worldXStart: number,
        worldXEnd: number,
        worldZStart: number,
        worldZEnd: number,
    ): QueuedTask<RenderDataWorkerThread, boolean> {
        return this.pool.queue((w) =>
            w.hasPlaneTiles(mapX, mapY, plane, worldXStart, worldXEnd, worldZStart, worldZEnd),
        );
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.runAll((w) => w.setVars(vars));
    }

    loadCachedMapImages(): QueuedTask<RenderDataWorkerThread, Map<number, string>> {
        return this.pool.queue((w) => w.loadCachedMapImages());
    }

    exportSprites(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportSpritesToZip());
    }

    exportTextures(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportTexturesToZip());
    }

    terminate(): Promise<void> {
        return this.pool.terminate();
    }
}
