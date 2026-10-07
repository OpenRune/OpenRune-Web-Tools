import { Type } from "../Type";

export interface FloorType extends Type {
    hue: number;
    saturation: number;
    lightness: number;

    isOverlay: boolean;

    getRgb(): number;

    getHueBlend(): number;

    getHueMultiplier(): number;
}
