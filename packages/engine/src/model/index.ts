import type { ModelSource } from "./model-source";
import type { RSModelDefinition } from "./rs-model-format";
import { lightRSModel } from "./rs-model-light";
import { type RSModelMesh, buildRSModelMesh } from "./rs-model-mesh";

export { decodeRSModel, type RSModelDefinition } from "./rs-model-format";
export {
    lightRSModel,
    multiplyHslBrightness,
    DEFAULT_AMBIENT,
    DEFAULT_CONTRAST,
    type RSLitModel,
} from "./rs-model-light";
export { buildRSModelMesh, type RSModelMesh, type RSModelBounds } from "./rs-model-mesh";
export { packedHslToRgb, packedHslToGrey, DEFAULT_BRIGHTNESS } from "./rs-model-color";
export { RS_TEXTURE_SIZE, type RSTextureLayer } from "./rs-texture";
export {
    RSModelRenderer,
    type RSModelRenderMode,
    type RSModelRenderOptions,
    type RSModelCamera,
} from "./rs-model-renderer";
export {
    type ModelSource,
    createBytesModelSource,
    createJsonModelSource,
    modelDefinitionToJson,
    modelDefinitionFromJson,
    type RSModelDefinitionJson,
} from "./model-source";

/** Runs the full decode-agnostic pipeline: a `ModelSource` lookup straight to a renderable mesh. */
export async function loadRSModelMesh(
    source: ModelSource,
    id: number,
    options: { ambient?: number; contrast?: number } = {},
): Promise<RSModelMesh> {
    const def: RSModelDefinition = await source.getModel(id);
    const lit = lightRSModel(def, options);
    return buildRSModelMesh(def, lit);
}
