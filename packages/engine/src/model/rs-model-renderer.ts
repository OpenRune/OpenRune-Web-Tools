/**
 * Minimal WebGL2 renderer for a decoded RS model.
 *
 * The shading maths is a port of the OpenGL renderer in OSRS-Environment-Exporter: packed
 * HSL is interpolated across the triangle and converted in the fragment shader, and textured
 * faces multiply the texture by a 7-bit light level instead of carrying a colour.
 */
import type { RSModelMesh } from "./rs-model-mesh";
import { type RSTextureLayer, RS_TEXTURE_SIZE } from "./rs-texture";

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in float aHsl;
in vec2 aUv;
in float aTextureLayer;
in float aAlpha;

uniform mat4 uViewProjection;

out float vHsl;
out vec2 vUv;
flat out int vTextureLayer;
out float vAlpha;

void main() {
  vHsl = aHsl;
  vUv = aUv;
  vTextureLayer = int(aTextureLayer);
  vAlpha = aAlpha;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in float vHsl;
in vec2 vUv;
flat in int vTextureLayer;
in float vAlpha;

uniform sampler2DArray uTextures;
uniform float uBrightness;
/** 0 strips colour and texture, leaving only the shading as greyscale. */
uniform float uUseColors;

out vec4 fragColor;

vec3 hslToRgb(int hsl) {
  int packed = hsl / 128;
  float hue = float(packed >> 3) / 64.0 + 0.0078125;
  float saturation = float(packed & 7) / 8.0 + 0.0625;
  float luminance = float(hsl % 128) / 128.0;

  float r = luminance;
  float g = luminance;
  float b = luminance;

  if (saturation != 0.0) {
    float high = luminance < 0.5
      ? luminance * (1.0 + saturation)
      : luminance + saturation - luminance * saturation;
    float low = 2.0 * luminance - high;

    float hueR = hue + 0.3333333333333333;
    if (hueR > 1.0) hueR -= 1.0;
    float hueB = hue - 0.3333333333333333;
    if (hueB < 0.0) hueB += 1.0;

    if (6.0 * hueR < 1.0) r = low + (high - low) * 6.0 * hueR;
    else if (2.0 * hueR < 1.0) r = high;
    else if (3.0 * hueR < 2.0) r = low + (high - low) * (0.6666666666666666 - hueR) * 6.0;
    else r = low;

    if (6.0 * hue < 1.0) g = low + (high - low) * 6.0 * hue;
    else if (2.0 * hue < 1.0) g = high;
    else if (3.0 * hue < 2.0) g = low + (high - low) * (0.6666666666666666 - hue) * 6.0;
    else g = low;

    if (6.0 * hueB < 1.0) b = low + (high - low) * 6.0 * hueB;
    else if (2.0 * hueB < 1.0) b = high;
    else if (3.0 * hueB < 2.0) b = low + (high - low) * (0.6666666666666666 - hueB) * 6.0;
    else b = low;
  }

  return pow(vec3(r, g, b), vec3(uBrightness));
}

void main() {
  vec3 rgb;
  if (vTextureLayer >= 0) {
    vec4 texel = texture(uTextures, vec3(vUv, float(vTextureLayer)));
    if (texel.a < 0.5) discard;
    // Textured faces carry a 7-bit light level rather than a colour.
    float light = vHsl / 127.0;
    rgb = uUseColors < 0.5 ? vec3(light) : pow(texel.rgb, vec3(uBrightness)) * light;
  } else if (uUseColors < 0.5) {
    // Keep only the luminance bits so the shading survives without the hue.
    rgb = pow(vec3(float(int(vHsl) % 128) / 128.0), vec3(uBrightness));
  } else {
    rgb = hslToRgb(int(vHsl));
  }
  fragColor = vec4(rgb, vAlpha);
}
`;

const WIREFRAME_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

const WIREFRAME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}
`;

/** `both` overlays the wireframe on the shaded model; `wireframe` drops the fill entirely. */
export type RSModelRenderMode = "solid" | "wireframe" | "both";

export type RSModelRenderOptions = {
    renderMode: RSModelRenderMode;
    /** When false the model is drawn in greyscale, keeping only the shading. */
    useColors: boolean;
    /** Draws a one-tile ground grid under the model. */
    showGrid: boolean;
};

export type RSModelCamera = {
    /** Radians, rotation about the vertical axis. */
    yaw: number;
    /** Radians, clamped by the caller to avoid gimbal flips. */
    pitch: number;
    /** Multiplier on the model's bounding radius. */
    zoom: number;
};

type Attributes = {
    position: number;
    hsl: number;
    uv: number;
    textureLayer: number;
    alpha: number;
};

type Buffers = {
    position: WebGLBuffer;
    hsl: WebGLBuffer;
    uv: WebGLBuffer;
    textureLayer: WebGLBuffer;
    alpha: WebGLBuffer;
};

export class RSModelRenderer {
    private readonly gl: WebGL2RenderingContext;
    private readonly program: WebGLProgram;
    private readonly attributes: Attributes;
    private readonly uViewProjection: WebGLUniformLocation | null;
    private readonly uBrightness: WebGLUniformLocation | null;
    private readonly uUseColors: WebGLUniformLocation | null;
    private readonly vao: WebGLVertexArrayObject;
    private readonly buffers: Buffers;

    private readonly wireframeProgram: WebGLProgram;
    private readonly wireframePosition: number;
    private readonly uWireViewProjection: WebGLUniformLocation | null;
    private readonly uWireColor: WebGLUniformLocation | null;
    private readonly wireframeVao: WebGLVertexArrayObject;
    private readonly wireframeBuffer: WebGLBuffer;
    private wireframeVertexCount = 0;

    private readonly gridVao: WebGLVertexArrayObject;
    private readonly gridBuffer: WebGLBuffer;
    /** Grid lines come first in the buffer, the two centre axes last. */
    private gridVertexCount = 0;
    private gridAxisVertexCount = 0;

    private textureArray: WebGLTexture | null = null;
    private mesh: RSModelMesh | null = null;
    private brightness = 0.8;
    private options: RSModelRenderOptions = {
        renderMode: "solid",
        useColors: true,
        showGrid: false,
    };
    private camera: RSModelCamera = { yaw: Math.PI * 0.25, pitch: -0.35, zoom: 2.4 };
    private viewport = { width: 1, height: 1 };

    constructor(private readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", {
            alpha: true,
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) throw new Error("WebGL2 is not available");
        this.gl = gl;

        this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
        this.attributes = {
            position: gl.getAttribLocation(this.program, "aPosition"),
            hsl: gl.getAttribLocation(this.program, "aHsl"),
            uv: gl.getAttribLocation(this.program, "aUv"),
            textureLayer: gl.getAttribLocation(this.program, "aTextureLayer"),
            alpha: gl.getAttribLocation(this.program, "aAlpha"),
        };
        this.uViewProjection = gl.getUniformLocation(this.program, "uViewProjection");
        this.uBrightness = gl.getUniformLocation(this.program, "uBrightness");
        this.uUseColors = gl.getUniformLocation(this.program, "uUseColors");

        const vao = gl.createVertexArray();
        if (!vao) throw new Error("Failed to create vertex array");
        this.vao = vao;
        this.buffers = {
            position: createBuffer(gl),
            hsl: createBuffer(gl),
            uv: createBuffer(gl),
            textureLayer: createBuffer(gl),
            alpha: createBuffer(gl),
        };

        gl.bindVertexArray(vao);
        bindAttribute(gl, this.buffers.position, this.attributes.position, 3);
        bindAttribute(gl, this.buffers.hsl, this.attributes.hsl, 1);
        bindAttribute(gl, this.buffers.uv, this.attributes.uv, 2);
        bindAttribute(gl, this.buffers.textureLayer, this.attributes.textureLayer, 1);
        bindAttribute(gl, this.buffers.alpha, this.attributes.alpha, 1);
        gl.bindVertexArray(null);

        this.wireframeProgram = linkProgram(gl, WIREFRAME_VERTEX_SHADER, WIREFRAME_FRAGMENT_SHADER);
        this.wireframePosition = gl.getAttribLocation(this.wireframeProgram, "aPosition");
        this.uWireViewProjection = gl.getUniformLocation(this.wireframeProgram, "uViewProjection");
        this.uWireColor = gl.getUniformLocation(this.wireframeProgram, "uColor");

        const wireframeVao = gl.createVertexArray();
        if (!wireframeVao) throw new Error("Failed to create vertex array");
        this.wireframeVao = wireframeVao;
        this.wireframeBuffer = createBuffer(gl);
        gl.bindVertexArray(wireframeVao);
        bindAttribute(gl, this.wireframeBuffer, this.wireframePosition, 3);
        gl.bindVertexArray(null);

        const gridVao = gl.createVertexArray();
        if (!gridVao) throw new Error("Failed to create vertex array");
        this.gridVao = gridVao;
        this.gridBuffer = createBuffer(gl);
        gl.bindVertexArray(gridVao);
        bindAttribute(gl, this.gridBuffer, this.wireframePosition, 3);
        gl.bindVertexArray(null);

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
    }

    setBrightness(brightness: number): void {
        this.brightness = brightness;
    }

    setOptions(options: RSModelRenderOptions): void {
        this.options = options;
    }

    setCamera(camera: RSModelCamera): void {
        this.camera = camera;
    }

    setMesh(mesh: RSModelMesh, layers: readonly RSTextureLayer[] = []): void {
        const gl = this.gl;
        this.mesh = mesh;

        uploadBuffer(gl, this.buffers.position, mesh.positions);
        uploadBuffer(gl, this.buffers.hsl, mesh.hsl);
        uploadBuffer(gl, this.buffers.uv, mesh.uv);
        uploadBuffer(gl, this.buffers.textureLayer, mesh.textureLayer);
        uploadBuffer(gl, this.buffers.alpha, mesh.alpha);

        const edges = buildEdgePositions(mesh);
        uploadBuffer(gl, this.wireframeBuffer, edges);
        this.wireframeVertexCount = edges.length / 3;

        const grid = buildGridPositions(mesh);
        uploadBuffer(gl, this.gridBuffer, grid.positions);
        this.gridVertexCount = grid.gridVertexCount;
        this.gridAxisVertexCount = grid.axisVertexCount;

        this.uploadTextures(layers);
    }

    /** Rebuilds the array texture; a `null` layer becomes fully transparent (face falls away). */
    private uploadTextures(layers: readonly RSTextureLayer[]): void {
        const gl = this.gl;
        if (this.textureArray) gl.deleteTexture(this.textureArray);

        const texture = gl.createTexture();
        if (!texture) throw new Error("Failed to create texture array");
        this.textureArray = texture;

        // A sampler2DArray must always be backed by at least one layer, even for untextured models.
        const layerCount = Math.max(1, layers.length);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
        gl.texStorage3D(
            gl.TEXTURE_2D_ARRAY,
            1,
            gl.RGBA8,
            RS_TEXTURE_SIZE,
            RS_TEXTURE_SIZE,
            layerCount,
        );
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        // UVs routinely run outside 0..1 — the client tiles textures rather than clamping.
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

        layers.forEach((layer, index) => {
            if (!layer) return;
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                index,
                RS_TEXTURE_SIZE,
                RS_TEXTURE_SIZE,
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                layer.data,
            );
        });
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }

    /** Sizes the drawing buffer; `width` / `height` are CSS pixels. */
    resize(width: number, height: number, devicePixelRatio: number): void {
        const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio));
        const pixelHeight = Math.max(1, Math.round(height * devicePixelRatio));
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
        this.viewport = { width: pixelWidth, height: pixelHeight };
    }

    render(): void {
        const gl = this.gl;
        gl.viewport(0, 0, this.viewport.width, this.viewport.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const mesh = this.mesh;
        if (!mesh || mesh.vertexCount === 0) return;

        const viewProjection = this.viewProjection(mesh);
        const { renderMode, useColors, showGrid } = this.options;

        // Grid goes down first so the model can occlude it normally.
        if (showGrid && this.gridVertexCount > 0) {
            gl.useProgram(this.wireframeProgram);
            gl.bindVertexArray(this.gridVao);
            gl.uniformMatrix4fv(this.uWireViewProjection, false, viewProjection);
            gl.enable(gl.BLEND);
            // A blue-grey rather than white/black: the canvas is transparent, so the grid has to
            // read against both the light and dark page backgrounds.
            gl.uniform4f(this.uWireColor, 0.42, 0.56, 0.8, 0.65);
            gl.drawArrays(gl.LINES, 0, this.gridVertexCount);
            if (this.gridAxisVertexCount > 0) {
                gl.uniform4f(this.uWireColor, 0.36, 0.62, 0.95, 1);
                gl.drawArrays(gl.LINES, this.gridVertexCount, this.gridAxisVertexCount);
            }
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }

        if (renderMode !== "wireframe") {
            gl.useProgram(this.program);
            gl.bindVertexArray(this.vao);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
            gl.uniform1i(gl.getUniformLocation(this.program, "uTextures"), 0);
            gl.uniform1f(this.uBrightness, this.brightness);
            gl.uniform1f(this.uUseColors, useColors ? 1 : 0);
            gl.uniformMatrix4fv(this.uViewProjection, false, viewProjection);

            // Push the fill back a touch so an overlaid wireframe does not z-fight with it.
            if (renderMode === "both") {
                gl.enable(gl.POLYGON_OFFSET_FILL);
                gl.polygonOffset(1, 1);
            }

            gl.depthMask(true);
            gl.disable(gl.BLEND);
            if (mesh.opaqueVertexCount > 0) {
                gl.drawArrays(gl.TRIANGLES, 0, mesh.opaqueVertexCount);
            }

            const transparentCount = mesh.vertexCount - mesh.opaqueVertexCount;
            if (transparentCount > 0) {
                // Blend the transparent tail without occluding what is behind it.
                gl.depthMask(false);
                gl.enable(gl.BLEND);
                gl.drawArrays(gl.TRIANGLES, mesh.opaqueVertexCount, transparentCount);
                gl.depthMask(true);
                gl.disable(gl.BLEND);
            }

            gl.disable(gl.POLYGON_OFFSET_FILL);
            gl.bindVertexArray(null);
        }

        if (renderMode !== "solid" && this.wireframeVertexCount > 0) {
            gl.useProgram(this.wireframeProgram);
            gl.bindVertexArray(this.wireframeVao);
            gl.uniformMatrix4fv(this.uWireViewProjection, false, viewProjection);
            // Translucent white reads on both light and dark page backgrounds.
            gl.uniform4f(this.uWireColor, 1, 1, 1, renderMode === "both" ? 0.35 : 0.85);
            gl.enable(gl.BLEND);
            gl.depthMask(false);
            gl.drawArrays(gl.LINES, 0, this.wireframeVertexCount);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }
    }

    private viewProjection(mesh: RSModelMesh): Float32Array {
        const { yaw, pitch, zoom } = this.camera;
        const radius = mesh.bounds.radius;
        const distance = radius * zoom;

        const eye: [number, number, number] = [
            mesh.bounds.center[0] + distance * Math.cos(pitch) * Math.sin(yaw),
            mesh.bounds.center[1] - distance * Math.sin(pitch),
            mesh.bounds.center[2] + distance * Math.cos(pitch) * Math.cos(yaw),
        ];

        const aspect = this.viewport.width / this.viewport.height;
        const projection = perspective(
            Math.PI / 4,
            aspect,
            Math.max(radius * 0.01, 0.1),
            distance + radius * 4,
        );
        const view = lookAt(eye, mesh.bounds.center, [0, 1, 0]);
        return multiply(projection, view);
    }

    dispose(): void {
        const gl = this.gl;
        gl.deleteVertexArray(this.vao);
        gl.deleteVertexArray(this.wireframeVao);
        gl.deleteVertexArray(this.gridVao);
        for (const buffer of Object.values(this.buffers)) gl.deleteBuffer(buffer);
        gl.deleteBuffer(this.wireframeBuffer);
        gl.deleteBuffer(this.gridBuffer);
        if (this.textureArray) gl.deleteTexture(this.textureArray);
        gl.deleteProgram(this.program);
        gl.deleteProgram(this.wireframeProgram);
        this.mesh = null;
    }
}

/** One RS tile. The grid uses it as its cell size so model scale stays readable. */
const GRID_CELL = 128;

/**
 * Ground grid on the model's lowest Y plane, sized to cover its footprint with a tile of
 * margin. The two centre lines are returned last so they can be drawn brighter.
 */
function buildGridPositions(mesh: RSModelMesh): {
    positions: Float32Array;
    gridVertexCount: number;
    axisVertexCount: number;
} {
    const reach = Math.max(
        Math.abs(mesh.bounds.min[0]),
        Math.abs(mesh.bounds.max[0]),
        Math.abs(mesh.bounds.min[2]),
        Math.abs(mesh.bounds.max[2]),
    );
    const half = Math.min(16, Math.max(2, Math.ceil(reach / GRID_CELL) + 1));
    const extent = half * GRID_CELL;
    const y = mesh.bounds.min[1];

    const grid: number[] = [];
    const axes: number[] = [];
    for (let i = -half; i <= half; i++) {
        const offset = i * GRID_CELL;
        const target = i === 0 ? axes : grid;
        target.push(offset, y, -extent, offset, y, extent);
        target.push(-extent, y, offset, extent, y, offset);
    }

    return {
        positions: new Float32Array([...grid, ...axes]),
        gridVertexCount: grid.length / 3,
        axisVertexCount: axes.length / 3,
    };
}

/** Three line segments per triangle, as raw positions (no index buffer needed). */
function buildEdgePositions(mesh: RSModelMesh): Float32Array {
    const triangles = mesh.vertexCount / 3;
    const out = new Float32Array(triangles * 6 * 3);
    let write = 0;
    for (let t = 0; t < triangles; t++) {
        const base = t * 3;
        for (const [from, to] of [
            [0, 1],
            [1, 2],
            [2, 0],
        ]) {
            for (const corner of [from, to]) {
                const vertex = base + corner;
                out[write++] = mesh.positions[vertex * 3];
                out[write++] = mesh.positions[vertex * 3 + 1];
                out[write++] = mesh.positions[vertex * 3 + 2];
            }
        }
    }
    return out;
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");
    return buffer;
}

function bindAttribute(
    gl: WebGL2RenderingContext,
    buffer: WebGLBuffer,
    location: number,
    size: number,
): void {
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function uploadBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer, data: Float32Array): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile failed: ${log ?? "unknown error"}`);
    }
    return shader;
}

function linkProgram(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program link failed: ${log ?? "unknown error"}`);
    }
    return program;
}

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

function lookAt(
    eye: readonly [number, number, number],
    target: readonly [number, number, number],
    up: readonly [number, number, number],
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

function cross(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
): [number, number, number] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
}
