// NoiseSolver: deterministic gradient noise, Musgrave ridged and hybrid-multifractal sums, billow and cellular (Worley) noise.
// Pure JavaScript with no DOM access, so the same code runs in the worker and under node:test.

const GradientX = [1, -1, 1, -1, 1, -1, 0, 0];
const GradientY = [1, 1, -1, -1, 0, 0, 1, -1];
const InvUint32 = 1 / 4294967296;

export function Mix32(a) {
    a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
    a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
    return (a ^ (a >>> 16)) >>> 0;
}

// Integer lattice hash; identical for identical (ix, iy, seed) on every platform.
export function HashCell(ix, iy, seed) {
    return Mix32((Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul((iy | 0) + 0x165667b1, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) >>> 0);
}

export function UnitHash(ix, iy, seed) {
    return HashCell(ix, iy, seed) * InvUint32;
}

// Seeded Mulberry32 generator for the particle solvers; returns floats in [0, 1).
export function CreateRandom(seed) {
    let state = seed >>> 0;
    return function Next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) * InvUint32;
    };
}

function Fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function Corner(ix, iy, seed, dx, dy) {
    const k = HashCell(ix, iy, seed) & 7;
    return GradientX[k] * dx + GradientY[k] * dy;
}

// Perlin-style gradient noise in approximately [-1, 1]. Lattice units: one unit equals one feature.
export function GradientNoise(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = Fade(fx);
    const v = Fade(fy);
    const n00 = Corner(x0, y0, seed, fx, fy);
    const n10 = Corner(x0 + 1, y0, seed, fx - 1, fy);
    const n01 = Corner(x0, y0 + 1, seed, fx, fy - 1);
    const n11 = Corner(x0 + 1, y0 + 1, seed, fx - 1, fy - 1);
    const top = n00 + u * (n10 - n00);
    const bottom = n01 + u * (n11 - n01);
    const value = (top + v * (bottom - top)) * 0.7071067811865476;
    return value < -1 ? -1 : value > 1 ? 1 : value;
}

// Fractional octave count: whole octaves at full weight, the last partial octave scaled by its fraction.
export function Fractal(x, y, seed, octaves, lacunarity, gain) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    const whole = Math.floor(octaves);
    const partial = octaves - whole;
    for (let o = 0; o < whole + (partial > 0 ? 1 : 0); o++) {
        const weight = o < whole ? 1 : partial;
        sum += amplitude * weight * GradientNoise(x * frequency, y * frequency, seed + o * 131);
        norm += amplitude * weight;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}

// Musgrave ridged multifractal in [0, 1]. Sharp crests come from squaring the folded signal.
export function Ridged(x, y, seed, octaves, lacunarity, gain, sharpness) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    let weight = 1;
    const whole = Math.floor(octaves);
    for (let o = 0; o < whole; o++) {
        let signal = 1 - Math.abs(GradientNoise(x * frequency, y * frequency, seed + o * 131));
        signal = Math.pow(signal, sharpness);
        signal *= signal * weight;
        weight = Math.min(1, Math.max(0, signal * 2));
        sum += signal * amplitude;
        norm += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return norm > 0 ? Math.min(1, Math.max(0, sum / norm)) : 0;
}

// Hybrid multifractal (Ebert et al.): heterogeneous terrain where high areas gain more detail than valleys.
export function Multifractal(x, y, seed, octaves, lacunarity, dimension, offset) {
    const whole = Math.max(1, Math.floor(octaves));
    let frequency = 1;
    let power = 1;
    let result = (GradientNoise(x, y, seed) + offset) * power;
    let weight = result;
    let norm = power;
    for (let o = 1; o < whole; o++) {
        frequency *= lacunarity;
        power = Math.pow(frequency, -dimension);
        if (weight > 1) {
            weight = 1;
        }
        const signal = (GradientNoise(x * frequency, y * frequency, seed + o * 131) + offset) * power;
        result += weight * signal;
        weight *= signal;
        norm += power;
    }
    const normalised = result / norm / (1 + Math.abs(offset));
    return Math.min(1, Math.max(0, 0.5 + 0.5 * normalised));
}

// Billow noise: absolute-value octaves give rounded, cloud-like lumps in [0, 1].
export function Billow(x, y, seed, octaves, lacunarity, gain) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    const whole = Math.floor(octaves);
    for (let o = 0; o < whole; o++) {
        sum += amplitude * Math.abs(GradientNoise(x * frequency, y * frequency, seed + o * 131));
        norm += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}

// Worley / cellular noise. Writes [F1, F2, cellRandom] into the caller's three-element array to avoid allocation.
export function Cellular(x, y, seed, out) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 1e9;
    let f2 = 1e9;
    let cellRandom = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const cx = ix + dx;
            const cy = iy + dy;
            const h = HashCell(cx, cy, seed);
            const px = cx + (h * InvUint32);
            const py = cy + (Mix32(h ^ 0x9e3779b9) * InvUint32);
            const ddx = px - x;
            const ddy = py - y;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                cellRandom = Mix32(h ^ 0x51ed270b) * InvUint32;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    out[0] = f1;
    out[1] = f2;
    out[2] = cellRandom;
    return out;
}

export function Smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) {
        return x < edge0 ? 0 : 1;
    }
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function Clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
}
