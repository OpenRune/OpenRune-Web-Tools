/** RS's 2048-entry fixed-point (16.16) sin/cos tables, used by old-style vertex rotation. */
const ANGULAR_RATIO_RADIANS = (360.0 / 2048) * (Math.PI / 180);

export const SINE = new Int32Array(2048);
export const COSINE = new Int32Array(2048);

for (let i = 0; i < 2048; i++) {
    SINE[i] = (65536.0 * Math.sin(i * ANGULAR_RATIO_RADIANS)) | 0;
    COSINE[i] = (65536.0 * Math.cos(i * ANGULAR_RATIO_RADIANS)) | 0;
}
