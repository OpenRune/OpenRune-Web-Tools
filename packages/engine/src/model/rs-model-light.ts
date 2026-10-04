/**
 * Per-face vertex shading, ported from `Model.light()` in OSRS-Environment-Exporter
 * (itself derived from RuneLite). Produces the same 16-bit HSL / 7-bit light values the
 * client feeds its renderer, so the fragment shader can stay a straight port too.
 */
import type { RSModelDefinition } from "./rs-model-format";

/** The client's fixed light direction. */
const LIGHT_X = -50;
const LIGHT_Y = -10;
const LIGHT_Z = -50;

/** `Model.lightFromDefinition` offsets whatever the definition asks for by these. */
export const DEFAULT_AMBIENT = 64;
export const DEFAULT_CONTRAST = 768;

export type RSLitModel = {
    /**
     * Per-face vertex values. For untextured faces these are packed HSL; for textured faces
     * they are a 7-bit light level (2..126).
     *
     * `faceColors3 === -1` means the face is flat shaded (use `faceColors1` for all three
     * vertices); `-2` means the face is hidden and must not be drawn.
     */
    faceColors1: Int32Array;
    faceColors2: Int32Array;
    faceColors3: Int32Array;
};

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/** Scales only the luminance bits of a packed HSL value. */
export function multiplyHslBrightness(hsl: number, brightness: number): number {
    const adjusted = Math.trunc(((hsl & 0x7f) * brightness) / 0x80);
    return (hsl & 0xff80) + clamp(adjusted, 2, 126);
}

export function lightRSModel(
    def: RSModelDefinition,
    options: { ambient?: number; contrast?: number } = {},
): RSLitModel {
    const ambient = (options.ambient ?? 0) + DEFAULT_AMBIENT;
    const contrast = (options.contrast ?? 0) + DEFAULT_CONTRAST;

    const faceColors1 = new Int32Array(def.faceCount);
    const faceColors2 = new Int32Array(def.faceCount);
    const faceColors3 = new Int32Array(def.faceCount);

    const lightMagnitude = Math.trunc(
        Math.sqrt(LIGHT_X * LIGHT_X + LIGHT_Y * LIGHT_Y + LIGHT_Z * LIGHT_Z),
    );
    const attenuation = (lightMagnitude * contrast) >> 8;

    /** Diffuse term for one vertex, in the client's integer light units. */
    const vertexLight = (vertex: number): number => {
        const magnitude = def.vertexNormalMagnitude[vertex];
        if (magnitude === 0) return ambient;
        const dot =
            LIGHT_Y * def.vertexNormalY[vertex] +
            LIGHT_Z * def.vertexNormalZ[vertex] +
            LIGHT_X * def.vertexNormalX[vertex];
        return Math.trunc(dot / (attenuation * magnitude)) + ambient;
    };

    const faceLight = (face: number): number => {
        const dot =
            LIGHT_Y * def.faceNormalY[face] +
            LIGHT_Z * def.faceNormalZ[face] +
            LIGHT_X * def.faceNormalX[face];
        return Math.trunc(dot / (Math.trunc(attenuation / 2) + attenuation)) + ambient;
    };

    for (let face = 0; face < def.faceCount; face++) {
        let faceType = def.faceRenderTypes ? def.faceRenderTypes[face] : 0;
        const faceTexture = def.faceTextures ? def.faceTextures[face] : -1;

        // Alpha sentinels double as render types: -1 hides the face, -2 makes it flat white.
        if (def.faceAlphas) {
            if (def.faceAlphas[face] === -1) faceType = 2;
            else if (def.faceAlphas[face] === -2) faceType = 3;
        }

        if (faceTexture === -1) {
            const hsl = def.faceColors[face] & 0xffff;
            switch (faceType) {
                case 0:
                    faceColors1[face] = multiplyHslBrightness(
                        hsl,
                        vertexLight(def.faceVertexIndices1[face]),
                    );
                    faceColors2[face] = multiplyHslBrightness(
                        hsl,
                        vertexLight(def.faceVertexIndices2[face]),
                    );
                    faceColors3[face] = multiplyHslBrightness(
                        hsl,
                        vertexLight(def.faceVertexIndices3[face]),
                    );
                    break;
                case 1:
                    faceColors1[face] = multiplyHslBrightness(hsl, faceLight(face));
                    faceColors3[face] = -1;
                    break;
                case 3:
                    faceColors1[face] = 128;
                    faceColors3[face] = -1;
                    break;
                default:
                    faceColors3[face] = -2;
                    break;
            }
        } else {
            switch (faceType) {
                case 0:
                    faceColors1[face] = clamp(vertexLight(def.faceVertexIndices1[face]), 2, 126);
                    faceColors2[face] = clamp(vertexLight(def.faceVertexIndices2[face]), 2, 126);
                    faceColors3[face] = clamp(vertexLight(def.faceVertexIndices3[face]), 2, 126);
                    break;
                case 1:
                    faceColors1[face] = clamp(faceLight(face), 2, 126);
                    faceColors3[face] = -1;
                    break;
                default:
                    faceColors3[face] = -2;
                    break;
            }
        }
    }

    return { faceColors1, faceColors2, faceColors3 };
}
