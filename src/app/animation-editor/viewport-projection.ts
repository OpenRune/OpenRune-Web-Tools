import type { RSModelBounds, RSModelCamera } from "@openrune/engine";

/**
 * Mirrors `RSModelRenderer`'s internal camera math so this tool can project vertices to screen
 * space for marquee selection — duplicated here rather than exposed from `@openrune/engine`, to
 * keep the animation editor decoupled from the renderer's internals.
 */
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1 / Math.tan(fovY / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
}

function normalize(v: [number, number, number]): [number, number, number] {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lookAt(
    eye: [number, number, number],
    target: [number, number, number],
    up: [number, number, number],
): Float32Array {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = normalize(cross(up, z));
    const y = cross(z, x);

    const out = new Float32Array(16);
    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[12] = -dot(x, eye);
    out[13] = -dot(y, eye);
    out[14] = -dot(z, eye);
    out[15] = 1;
    return out;
}

/** Column-major `a * b`, matching the layout `uniformMatrix4fv` expects. */
function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
            out[column * 4 + row] = sum;
        }
    }
    return out;
}

export function computeViewProjection(
    camera: RSModelCamera,
    bounds: RSModelBounds,
    aspect: number,
): Float32Array {
    const { yaw, pitch, zoom } = camera;
    const radius = bounds.radius;
    const distance = radius * zoom;

    const eye: [number, number, number] = [
        bounds.center[0] + distance * Math.cos(pitch) * Math.sin(yaw),
        bounds.center[1] - distance * Math.sin(pitch),
        bounds.center[2] + distance * Math.cos(pitch) * Math.cos(yaw),
    ];

    const projection = perspective(
        Math.PI / 4,
        aspect,
        Math.max(radius * 0.01, 0.1),
        distance + radius * 4,
    );
    const view = lookAt(eye, bounds.center, [0, 1, 0]);
    return multiply(projection, view);
}

/**
 * Projects a model-space point to CSS pixel coordinates within a `width` x `height` viewport.
 *
 * `depth` is the clip-space w — distance from the camera in world units. Occlusion tests use
 * that rather than NDC z, which is so nonlinear that a whole model can occupy less than 0.01 of
 * its range, leaving front and back indistinguishable within any workable tolerance.
 */
export function projectToScreen(
    vp: Float32Array,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
): { x: number; y: number; depth: number } | null {
    const clipX = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const clipY = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const clipW = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (clipW <= 0) return null;

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    return {
        x: (ndcX * 0.5 + 0.5) * width,
        y: (1 - (ndcY * 0.5 + 0.5)) * height,
        depth: clipW,
    };
}
