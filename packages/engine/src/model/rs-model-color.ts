/**
 * CPU twin of the renderer's `hslToRgb` (see `rs-model-renderer.ts`), used wherever colours
 * are needed outside the GPU — exports, swatches, thumbnails. Kept byte-for-byte equivalent
 * to the shader so an exported model matches what the viewer shows.
 */

/** Gamma the client ships as "high" brightness. */
export const DEFAULT_BRIGHTNESS = 0.8;

export function packedHslToRgb(
    hsl: number,
    brightness: number = DEFAULT_BRIGHTNESS,
): [number, number, number] {
    const packed = Math.trunc(hsl / 128);
    const hue = (packed >> 3) / 64 + 0.0078125;
    const saturation = (packed & 7) / 8 + 0.0625;
    const luminance = (hsl % 128) / 128;

    let r = luminance;
    let g = luminance;
    let b = luminance;

    if (saturation !== 0) {
        const high =
            luminance < 0.5
                ? luminance * (1 + saturation)
                : luminance + saturation - luminance * saturation;
        const low = 2 * luminance - high;

        let hueR = hue + 1 / 3;
        if (hueR > 1) hueR -= 1;
        let hueB = hue - 1 / 3;
        if (hueB < 0) hueB += 1;

        const channel = (h: number): number => {
            if (6 * h < 1) return low + (high - low) * 6 * h;
            if (2 * h < 1) return high;
            if (3 * h < 2) return low + (high - low) * (2 / 3 - h) * 6;
            return low;
        };

        r = channel(hueR);
        g = channel(hue);
        b = channel(hueB);
    }

    return [
        Math.pow(Math.max(r, 0), brightness),
        Math.pow(Math.max(g, 0), brightness),
        Math.pow(Math.max(b, 0), brightness),
    ];
}

/** Luminance-only version, matching the renderer's "colours off" path. */
export function packedHslToGrey(
    hsl: number,
    brightness: number = DEFAULT_BRIGHTNESS,
): [number, number, number] {
    const value = Math.pow((hsl % 128) / 128, brightness);
    return [value, value, value];
}
