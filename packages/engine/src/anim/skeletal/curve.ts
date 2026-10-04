import type { ByteReader } from "../byte-reader";
import { CurveInterpType, getInterpTypeForId } from "./curve-interp-type";

/** Largest finite `float32`, used as a sentinel tangent value by the curve format. */
const FLOAT32_MAX = 3.4028234663852886e38;

const ULP = 1.1920929e-7;
const ULP2 = 2 * ULP;

export class CurvePoint {
    x!: number;
    y!: number;
    field2!: number;
    field3!: number;
    field4!: number;
    field5!: number;

    next?: CurvePoint;

    decode(buffer: ByteReader): void {
        this.x = buffer.readShort();
        this.y = buffer.readFloat();
        this.field2 = buffer.readFloat();
        this.field3 = buffer.readFloat();
        this.field4 = buffer.readFloat();
        this.field5 = buffer.readFloat();
    }
}

/**
 * A precomputed per-tick animation curve (bone rotation/translation/scale, or a face-alpha
 * fade). Bezier-ish segments between keyframe points, with configurable extrapolation past
 * the first/last point.
 */
export class Curve {
    type!: number;
    startInterpType!: CurveInterpType;
    endInterpType!: CurveInterpType;
    bool!: boolean;

    points?: CurvePoint[];

    startTick!: number;
    endTick!: number;

    values!: Float32Array;
    minValue!: number;
    maxValue!: number;

    noInterp = false;

    pointIndex = 0;
    pointIndexUpdated = true;

    interpBool = false;
    interpV0 = 0;
    interpV1 = 0;
    interpV2 = 0;
    interpV3 = 0;
    interpV4 = 0;
    interpV5 = 0;
    interpV6 = 0;
    interpV7 = 0;
    interpV8 = 0;
    interpV9 = 0;

    constructor(readonly id: number) {}

    decode(buffer: ByteReader): void {
        const count = buffer.readUnsignedShort();
        this.type = buffer.readUnsignedByte();

        this.startInterpType = getInterpTypeForId(buffer.readUnsignedByte());
        this.endInterpType = getInterpTypeForId(buffer.readUnsignedByte());
        this.bool = buffer.readUnsignedByte() !== 0;

        this.points = new Array(count);

        let lastPoint: CurvePoint | undefined;
        for (let i = 0; i < count; i++) {
            const point = new CurvePoint();
            point.decode(buffer);
            this.points[i] = point;
            if (lastPoint) lastPoint.next = point;
            lastPoint = point;
        }
    }

    /** Precomputes one value per tick across the curve's range, then discards the raw points. */
    load(): void {
        if (!this.points) return;

        this.startTick = this.points[0].x;
        this.endTick = this.points[this.points.length - 1].x;
        this.values = new Float32Array(this.getTickDuration() + 1);

        for (let t = this.startTick; t <= this.endTick; t++) {
            this.values[t - this.startTick] = interpolateCurve(this, t);
        }

        this.points = undefined;
        this.minValue = interpolateCurve(this, this.startTick - 1);
        this.maxValue = interpolateCurve(this, this.endTick + 1);
    }

    getValue(t: number): number {
        if (t < this.startTick) return this.minValue;
        if (t > this.endTick) return this.maxValue;
        return this.values[t - this.startTick];
    }

    getPointIndex(t: number): number {
        if (!this.points) return this.pointIndex;

        if (
            this.pointIndex < 0 ||
            this.points[this.pointIndex].x > t ||
            (this.points[this.pointIndex].next && this.points[this.pointIndex].next!.x <= t)
        ) {
            if (t >= this.startTick && t <= this.endTick) {
                const pointCount = this.points.length;
                let newPointIndex = this.pointIndex;
                if (pointCount > 0) {
                    let startPointIndex = 0;
                    let endPointIndex = pointCount - 1;

                    do {
                        const pointIndex = (startPointIndex + endPointIndex) >> 1;
                        if (t < this.points[pointIndex].x) {
                            if (t > this.points[pointIndex - 1].x) {
                                newPointIndex = pointIndex - 1;
                                break;
                            }
                            endPointIndex = pointIndex - 1;
                        } else {
                            if (t <= this.points[pointIndex].x) {
                                newPointIndex = pointIndex;
                                break;
                            }
                            if (t < this.points[pointIndex + 1].x) {
                                newPointIndex = pointIndex;
                                break;
                            }
                            startPointIndex = pointIndex + 1;
                        }
                    } while (startPointIndex <= endPointIndex);
                }

                if (this.pointIndex !== newPointIndex) {
                    this.pointIndex = newPointIndex;
                    this.pointIndexUpdated = true;
                }
                return this.pointIndex;
            }
            return -1;
        }
        return this.pointIndex;
    }

    getCurvePoint(t: number): CurvePoint | undefined {
        if (!this.points) return undefined;
        const index = this.getPointIndex(t);
        if (index < 0 || index >= this.points.length) return undefined;
        return this.points[index];
    }

    getPointCount(): number {
        return this.points ? this.points.length : 0;
    }

    getTickDuration(): number {
        return this.endTick - this.startTick;
    }
}

export function interpolateCurve(curve: Curve, t: number): number {
    if (!curve.points || curve.points.length === 0) return 0;
    if (t < curve.startTick) {
        if (curve.startInterpType === CurveInterpType.TYPE_0) return curve.points[0].y;
        return extrapolateCurve(curve, t, true);
    } else if (t > curve.endTick) {
        if (curve.endInterpType === CurveInterpType.TYPE_0)
            return curve.points[curve.points.length - 1].y;
        return extrapolateCurve(curve, t, false);
    } else if (curve.noInterp) {
        return curve.points[0].y;
    }

    const point = curve.getCurvePoint(t);
    if (!point) return 0;

    let bool0 = false;
    let bool1 = false;

    if (point.field4 === 0 && point.field5 === 0) {
        bool0 = true;
    } else if (point.field4 === FLOAT32_MAX && point.field5 === FLOAT32_MAX) {
        bool1 = true;
    } else if (!point.next) {
        bool0 = true;
    } else if (curve.pointIndexUpdated) {
        const var5 = point.x;
        const var9 = point.y;
        const var6 = point.field4 * 0.33333334 + var5;
        const var10 = point.field5 * 0.33333334 + var9;
        const var8 = point.next.x;
        const var12 = point.next.y;
        const var7 = var8 - point.next.field2 * 0.33333334;
        const var11 = var12 - point.next.field3 * 0.33333334;
        if (curve.bool) {
            let var15 = var10;
            let var16 = var11;
            const var17 = var8 - var5;
            if (var17 !== 0.0) {
                const var18 = var6 - var5;
                const var19 = var7 - var5;
                const point29: [number, number] = [var18 / var17, var19 / var17];
                curve.interpBool = point29[0] === 0.33333334 && point29[1] === 0.6666667;
                const var21 = point29[0];
                const var22 = point29[1];
                if (point29[0] < 0.0) point29[0] = 0.0;
                if (point29[1] > 1.0) point29[1] = 1.0;
                if (point29[0] > 1.0 || point29[1] < -1.0) clampCurveWeights(point29);

                if (point29[0] !== var21) {
                    if (0.0 !== var21) var15 = ((var10 - var9) * point29[0]) / var21 + var9;
                }
                if (var22 !== point29[1]) {
                    if (1.0 !== var22)
                        var16 = var12 - ((1.0 - point29[1]) * (var12 - var11)) / (1.0 - var22);
                }

                curve.interpV0 = var5;
                curve.interpV1 = var8;
                const var23 = point29[0];
                const var24 = point29[1];
                let var25 = var23 - 0.0;
                let var26 = var24 - var23;
                let var27 = 1.0 - var24;
                let var28 = var26 - var25;
                curve.interpV5 = var27 - var26 - var28;
                curve.interpV4 = var28 + var28 + var28;
                curve.interpV3 = var25 + var25 + var25;
                curve.interpV2 = 0.0;
                var25 = var15 - var9;
                var26 = var16 - var15;
                var27 = var12 - var16;
                var28 = var26 - var25;
                curve.interpV9 = var27 - var26 - var28;
                curve.interpV8 = var28 + var28 + var28;
                curve.interpV7 = var25 + var25 + var25;
                curve.interpV6 = var9;
            }
        } else {
            curve.interpV0 = var5;
            const var13 = var8 - var5;
            const var14 = var12 - var9;
            let var15 = var6 - var5;
            let var16 = 0.0;
            let var17 = 0.0;
            if (var15 !== 0.0) var16 = (var10 - var9) / var15;
            var15 = var8 - var7;
            if (var15 !== 0.0) var17 = (var12 - var11) / var15;

            const var18 = 1.0 / (var13 * var13);
            const var19 = var16 * var13;
            const var20 = var17 * var13;
            curve.interpV2 = (var18 * (var19 + var20 - var14 - var14)) / var13;
            curve.interpV3 = var18 * (var14 + var14 + var14 - var19 - var19 - var20);
            curve.interpV4 = var16;
            curve.interpV5 = var9;
        }
        curve.pointIndexUpdated = false;
    }

    if (bool0) return point.y;
    if (bool1) return point.x !== t && point.next ? point.next.y : point.y;
    if (curve.bool) return evalBoolCurve(curve, t);

    const var6 = t - curve.interpV0;
    return (
        curve.interpV5 + var6 * ((var6 * curve.interpV2 + curve.interpV3) * var6 + curve.interpV4)
    );
}

export function extrapolateCurve(curve: Curve, t: number, isStart: boolean): number {
    if (!curve.points || curve.points.length === 0) return 0;
    const var4 = curve.points[0].x;
    const var5 = curve.points[curve.points.length - 1].x;
    const var6 = var5 - var4;
    if (var6 === 0.0) return curve.points[0].y;

    let var7: number;
    if (t > var5) var7 = (t - var5) / var6;
    else var7 = (t - var4) / var6;

    let var8 = var7 | 0;
    let var10 = Math.abs(var7 - var8);
    let var11 = var10 * var6;
    var8 = Math.abs(1.0 + var8);
    const var12 = var8 / 2.0;
    const var14 = var12 | 0;
    var10 = var12 - var14;

    if (isStart) {
        if (curve.startInterpType === CurveInterpType.TYPE_4) {
            if (var10 !== 0.0) var11 += var4;
            else var11 = var5 - var11;
        } else if (
            curve.startInterpType === CurveInterpType.TYPE_2 ||
            curve.startInterpType === CurveInterpType.TYPE_3
        ) {
            var11 = var5 - var11;
        } else if (curve.startInterpType === CurveInterpType.TYPE_1) {
            var11 = var4 - t;
            const var16 = curve.points[0].field2;
            const var17 = curve.points[0].field3;
            let output = curve.points[0].y;
            if (var16 !== 0.0) output -= (var11 * var17) / var16;
            return output;
        }
    } else {
        if (curve.endInterpType === CurveInterpType.TYPE_4) {
            if (var10 !== 0.0) var11 = var5 - var11;
            else var11 += var4;
        } else if (
            curve.endInterpType === CurveInterpType.TYPE_2 ||
            curve.endInterpType === CurveInterpType.TYPE_3
        ) {
            var11 += var4;
        } else if (curve.endInterpType === CurveInterpType.TYPE_1) {
            var11 = t - var5;
            const var16 = curve.points[curve.getPointCount() - 1].field4;
            const var17 = curve.points[curve.getPointCount() - 1].field5;
            let output = curve.points[curve.getPointCount() - 1].y;
            if (var16 !== 0.0) output += (var17 * var11) / var16;
            return output;
        }
    }

    let output = interpolateCurve(curve, var11);
    if (isStart && curve.startInterpType === CurveInterpType.TYPE_3) {
        const delta = curve.points[curve.points.length - 1].y - curve.points[0].y;
        output = output - delta * var8;
    } else if (!isStart && curve.endInterpType === CurveInterpType.TYPE_3) {
        const delta = curve.points[curve.points.length - 1].y - curve.points[0].y;
        output = output + delta * var8;
    }
    return output;
}

function clampCurveWeights(v: [number, number]): void {
    v[1] = 1.0 - v[1];
    if (v[0] < 0.0) v[0] = 0.0;
    if (v[1] < 0.0) v[1] = 0.0;

    if (v[0] > 1.0 || v[1] > 1.0) {
        const check = 1.0 + v[0] * (v[0] - 2.0 + v[1]) + (v[1] - 2.0) * v[1];
        if (check + ULP > 0.0) {
            if (ULP + v[0] < 1.3333334) {
                const a = v[0] - 2.0;
                const b = v[0] - 1.0;
                const root = Math.sqrt(a * a - 4.0 * b * b);
                const hi = 0.5 * (root + -a);
                if (v[1] + ULP > hi) {
                    v[1] = hi - ULP;
                } else {
                    const lo = (-a - root) * 0.5;
                    if (v[1] < lo + ULP) v[1] = lo + ULP;
                }
            } else {
                v[0] = 1.3333334 - ULP;
                v[1] = 0.33333334 - ULP;
            }
        }
    }

    v[1] = 1.0 - v[1];
}

const cubicInput = new Float32Array(4);
const cubicOutput = new Float32Array(5);

function evalBoolCurve(curve: Curve, t: number): number {
    let v0: number;
    if (curve.interpV0 === t) v0 = 0.0;
    else if (t === curve.interpV1) v0 = 1.0;
    else v0 = (t - curve.interpV0) / (curve.interpV1 - curve.interpV0);

    let v1: number;
    if (curve.interpBool) {
        v1 = v0;
    } else {
        cubicInput[3] = curve.interpV5;
        cubicInput[2] = curve.interpV4;
        cubicInput[1] = curve.interpV3;
        cubicInput[0] = curve.interpV2 - v0;
        cubicOutput.fill(0);
        const rootCount = findRootsInRange(cubicInput, 3, 0.0, true, 1.0, true, cubicOutput);
        v1 = rootCount === 1 ? cubicOutput[0] : 0.0;
    }

    return v1 * (curve.interpV7 + v1 * (v1 * curve.interpV9 + curve.interpV8)) + curve.interpV6;
}

function evalPolynomial(values: Float32Array, lastIndex: number, x: number): number {
    let output = values[lastIndex];
    for (let i = lastIndex - 1; i >= 0; i--) output = output * x + values[i];
    return output;
}

/**
 * Finds roots of a polynomial (ascending coefficients) within `[lo, hi]` by recursing into
 * its derivative to isolate each root between consecutive critical points, then bisecting.
 */
function findRootsInRange(
    coeffs: Float32Array,
    degree: number,
    lo: number,
    includeLo: boolean,
    hi: number,
    includeHi: boolean,
    out: Float32Array,
): number {
    let sumAbs = 0.0;
    for (let i = 0; i < degree + 1; i++) sumAbs += Math.abs(coeffs[i]);

    const eps = (Math.abs(lo) + Math.abs(hi)) * (degree + 1) * ULP;
    if (sumAbs <= eps) return -1;

    const normalized = new Float32Array(degree + 1);
    for (let i = 0; i < degree + 1; i++) normalized[i] = (1.0 / sumAbs) * coeffs[i];

    while (Math.abs(normalized[degree]) < eps) degree--;

    let status = 0;
    if (degree === 0) {
        return status;
    } else if (degree === 1) {
        out[0] = -normalized[0] / normalized[1];
        const loOk = includeLo ? lo < out[0] + eps : lo < out[0] - eps;
        const hiOk = includeHi ? hi > out[0] - eps : hi > out[0] + eps;
        status = loOk && hiOk ? 1 : 0;
        if (status > 0) {
            if (includeLo && out[0] < lo) out[0] = lo;
            else if (includeHi && out[0] > hi) out[0] = hi;
        }
        return status;
    }

    const derivative = new Float32Array(degree + 1);
    for (let i = 1; i <= degree; i++) derivative[i - 1] = i * normalized[i];

    const critPoints = new Float32Array(degree + 1);
    const critCount = findRootsInRange(derivative, degree - 1, lo, false, hi, false, critPoints);
    if (critCount === -1) return 0;

    // Sliding window over [lo, critPoints..., hi]: `left`/`leftVal` is the previous boundary
    // (carried across iterations), `right`/`rightVal` is the current one.
    let skipSignCheck = false;
    let left = 0.0;
    let leftVal = 0.0;
    let right = 0.0;

    for (let s = 0; s <= critCount; s++) {
        if (status > degree) return status;

        if (s === 0) {
            left = lo;
            leftVal = evalPolynomial(normalized, degree, lo);
            if (Math.abs(leftVal) <= eps && includeLo) out[status++] = lo;
        } else {
            left = right;
            leftVal = evalPolynomial(normalized, degree, left);
        }

        right = critCount === s ? hi : critPoints[s];
        const rightVal = evalPolynomial(normalized, degree, right);

        if (skipSignCheck) {
            skipSignCheck = false;
        } else if (Math.abs(rightVal) < eps) {
            if (critCount !== s || includeHi) {
                out[status++] = right;
                skipSignCheck = true;
            }
        } else if ((leftVal < 0.0 && rightVal > 0.0) || (leftVal > 0.0 && rightVal < 0.0)) {
            const outIndex = status++;
            const fa = evalPolynomial(normalized, degree, left);
            let root: number;
            if (Math.abs(fa) < ULP) {
                root = left;
            } else {
                const fb = evalPolynomial(normalized, degree, right);
                if (Math.abs(fb) < ULP) {
                    root = right;
                } else {
                    root = bisectRoot(normalized, degree, left, fa, right, fb);
                }
            }
            out[outIndex] = root;
            if (status > 1 && out[status - 2] >= out[status - 1] - eps) {
                out[status - 2] = 0.5 * (out[status - 2] + out[status - 1]);
                status--;
            }
        }
    }

    return status;
}

/** Brent-style root refinement between two bracketing points known to have opposite signs. */
function bisectRoot(
    coeffs: Float32Array,
    degree: number,
    a0: number,
    fa0: number,
    b0: number,
    fb0: number,
): number {
    let a = a0;
    let b = b0;
    let fa = fa0;
    let fb = fb0;
    let c = 0.0;
    let fc = 0.0;
    let d = 0.0;
    let e = 0.0;
    let firstPass = true;
    let iterate = false;

    do {
        iterate = false;
        if (firstPass) {
            c = a;
            fc = fa;
            d = b - a;
            e = d;
            firstPass = false;
        }

        if (Math.abs(fc) < Math.abs(fb)) {
            a = b;
            b = c;
            c = a;
            fa = fb;
            fb = fc;
            fc = fa;
        }

        const tol = ULP2 * Math.abs(b) + 0.0;
        const mid = 0.5 * (c - b);
        const canIterate = Math.abs(mid) > tol && fb !== 0.0;
        if (canIterate) {
            if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
                d = mid;
                e = mid;
            } else {
                const ratio = fb / fa;
                let p: number;
                let q: number;
                if (a === c) {
                    p = mid * 2.0 * ratio;
                    q = 1.0 - ratio;
                } else {
                    q = fa / fc;
                    const r = fb / fc;
                    p = ratio * (mid * 2.0 * q * (q - r) - (r - 1.0) * (b - a));
                    q = (r - 1.0) * (q - 1.0) * (ratio - 1.0);
                }

                if (p > 0.0) q = -q;
                else p = -p;

                const prevE = d;
                d = e;
                if (2.0 * p < 3.0 * mid * q - Math.abs(q * tol) && p < Math.abs(q * prevE * 0.5)) {
                    e = p / q;
                } else {
                    e = mid;
                    d = mid;
                }
            }

            a = b;
            fa = fb;
            if (Math.abs(e) > tol) b += e;
            else if (mid > 0.0) b += tol;
            else b -= tol;

            fb = evalPolynomial(coeffs, degree, b);
            if (fb * (fc / Math.abs(fc)) > 0.0) {
                firstPass = true;
                iterate = true;
            } else {
                iterate = true;
            }
        }
    } while (iterate);

    return b;
}
