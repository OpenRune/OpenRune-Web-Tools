export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;
    flattenLighting: boolean;

    minimizeDrawCalls: boolean;

    loadedTextureIds: Set<number>;
};
