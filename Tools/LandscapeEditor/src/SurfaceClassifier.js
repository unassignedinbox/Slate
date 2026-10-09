// SurfaceClassifier: colours the terrain for the satmap view. Colour is derived from the solved fields rather than from
// height alone: slope and protrusion pick rock versus soil, drainage picks river channels, sedimentation picks alluvium
// and dune sand, and altitude relative to sea level picks snow, grass and beaches. The palettes are stylised, not survey
// accurate. Output is RGBA bytes, ready for a canvas or a texture upload.

import { BoxSmooth, Gradient, SlopeDegrees } from "./ElevationSpace.js";

export const SurfaceModes = {
    natural: { label: "Natural" },
    strata: { label: "Strata" },
    sediment: { label: "Sedimentation" },
    drainage: { label: "Rivers" },
    protrusion: { label: "Protrusion" },
    slope: { label: "Slope" },
};

export const SurfaceModeNames = Object.keys(SurfaceModes);

const Palette = {
    deep: [14, 44, 74],
    shallow: [58, 138, 150],
    sand: [204, 184, 136],
    grass: [92, 110, 64],
    scrub: [128, 118, 74],
    rock: [118, 104, 94],
    cliff: [84, 74, 68],
    snow: [240, 244, 248],
    river: [70, 130, 160],
    alluvium: [166, 130, 86],
};

const StrataPalette = [
    [196, 132, 86],
    [226, 178, 124],
    [158, 96, 64],
    [212, 160, 110],
    [138, 88, 66],
    [236, 206, 158],
    [176, 118, 78],
];

function Smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function Mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function Hash(i, seed) {
    let h = (i * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Ramp through a list of colour stops, t in [0, 1].
function Ramp(stops, t) {
    const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(x));
    return Mix(stops[k], stops[k + 1], x - k);
}

// Derived per-cell fields shared by every mode.
export function DeriveSurface(field, n, cell, sea) {
    const size = n * n;
    const { height, sediment, erosion, drainedArea } = field;
    const slope = SlopeDegrees(height, n, cell);
    const { gx, gy } = Gradient(height, n, cell);
    const smooth = BoxSmooth(height, n, 4);
    const protrusion = new Float32Array(size);
    let protrusionSpread = 1e-6;
    for (let i = 0; i < size; i++) {
        protrusion[i] = height[i] - smooth[i];
        protrusionSpread = Math.max(protrusionSpread, Math.abs(protrusion[i]));
    }
    let maxSediment = 1e-6;
    let maxErosion = 1e-6;
    let maxLogFlow = 1e-6;
    let maxHeight = sea + 1;
    let minHeight = sea;
    for (let i = 0; i < size; i++) {
        if (sediment && sediment[i] > maxSediment) maxSediment = sediment[i];
        if (erosion && erosion[i] > maxErosion) maxErosion = erosion[i];
        const lf = Math.log1p(drainedArea ? drainedArea[i] : 0);
        if (lf > maxLogFlow) maxLogFlow = lf;
        if (height[i] > maxHeight) maxHeight = height[i];
        if (height[i] < minHeight) minHeight = height[i];
    }
    return {
        height,
        slope,
        gx,
        gy,
        protrusion,
        protrusionSpread,
        sediment: sediment || new Float32Array(size),
        erosion: erosion || new Float32Array(size),
        logFlow: drainedArea ? Float32Array.from(drainedArea, (v) => Math.log1p(v) / maxLogFlow) : new Float32Array(size),
        maxSediment,
        maxErosion,
        maxHeight,
        minHeight,
    };
}

function Shade(gx, gy, i) {
    // Sun from the north-west, 40 degrees above the horizon.
    const lx = -0.6;
    const ly = 0.6;
    const lz = 0.55;
    const nx = -gx[i];
    const ny = -gy[i];
    const nz = 1;
    const length = Math.hypot(nx, ny, nz);
    const dot = (nx * lx + ny * ly + nz * lz) / length;
    return Math.max(0, dot / Math.hypot(lx, ly, lz));
}

// Returns RGBA Uint8ClampedArray of length n * n * 4.
export function ClassifySurface(field, n, cell, sea, mode = "natural", seed = 1) {
    const d = DeriveSurface(field, n, cell, sea);
    const out = new Uint8ClampedArray(n * n * 4);
    const size = n * n;
    const relief = Math.max(1, d.maxHeight - sea);

    for (let i = 0; i < size; i++) {
        const h = d.height[i];
        const shade = Shade(d.gx, d.gy, i);
        const light = 0.42 + 0.7 * shade;
        let rgb;
        if (mode === "drainage") {
            rgb = Mix([24, 26, 28], [30, 30, 30], shade);
            const r = Smoothstep(0.35, 0.8, d.logFlow[i]);
            if (r > 0) rgb = Mix(rgb, Ramp([Palette.river, [190, 236, 250]], d.logFlow[i]), r);
            if (h < sea) rgb = Mix(rgb, Palette.deep, 0.7);
        } else if (mode === "sediment") {
            const s = Math.sqrt(d.sediment[i] / d.maxSediment);
            const e = Math.sqrt(d.erosion[i] / d.maxErosion);
            rgb = Ramp([[18, 16, 16], [96, 70, 48], [222, 186, 128], [244, 232, 200]], s);
            rgb = Mix(rgb, [150, 60, 42], Smoothstep(0.5, 1, e) * 0.35);
            if (h < sea) rgb = Mix(rgb, Palette.deep, 0.6);
        } else if (mode === "protrusion") {
            const p = Math.max(-1, Math.min(1, d.protrusion[i] / (d.protrusionSpread * 0.5)));
            rgb = p < 0 ? Mix([220, 220, 220], [40, 80, 150], -p) : Mix([220, 220, 220], [210, 90, 56], p);
            if (h < sea) rgb = Mix(rgb, Palette.deep, 0.5);
        } else if (mode === "slope") {
            rgb = Ramp([[34, 62, 36], [196, 178, 92], [198, 70, 44]], d.slope[i] / 45);
            if (h < sea) rgb = Mix(rgb, Palette.deep, 0.6);
        } else if (mode === "strata") {
            rgb = StrataColour(d, i, h, sea, cell, seed, relief);
        } else {
            rgb = NaturalColour(d, i, h, sea, relief, seed);
        }
        const o = i * 4;
        out[o] = rgb[0] * light;
        out[o + 1] = rgb[1] * light;
        out[o + 2] = rgb[2] * light;
        out[o + 3] = 255;
    }
    return out;
}

function NaturalColour(d, i, h, sea, relief, seed) {
    if (h < sea) {
        const depth = sea - h;
        const shallow = 1 - Smoothstep(0, 12, depth);
        return Mix(Palette.deep, Palette.shallow, shallow);
    }
    const above = h - sea;
    const altitude = above / relief;
    // Beaches: a low, gentle band just above the water.
    const beach = (1 - Smoothstep(2, 9, above)) * (1 - Smoothstep(4, 9, d.slope[i]));
    // Vegetation thins with altitude and steepness.
    let rgb = Mix(Palette.grass, Palette.scrub, Smoothstep(0.25, 0.6, altitude));
    // Rock takes over on steep ground; cliffs are darker.
    rgb = Mix(rgb, Palette.rock, Smoothstep(20, 34, d.slope[i]));
    rgb = Mix(rgb, Palette.cliff, Smoothstep(38, 55, d.slope[i]) * 0.8);
    // Ridges and crests read as bare rock.
    const ridge = Smoothstep(0.15, 0.5, d.protrusion[i] / (d.protrusionSpread * 0.5));
    rgb = Mix(rgb, Palette.rock, ridge * 0.6);
    // Sediment fans and dunes tint toward sand.
    const sand = Smoothstep(0.25, 0.9, Math.sqrt(d.sediment[i] / d.maxSediment));
    rgb = Mix(rgb, Palette.alluvium, sand * 0.6);
    // Snow sits high and on gentler ground.
    const snow = Smoothstep(0.78, 0.92, altitude) * (1 - Smoothstep(24, 36, d.slope[i]));
    rgb = Mix(rgb, Palette.snow, snow);
    // Rivers cut through the land.
    const river = Smoothstep(0.55, 0.8, d.logFlow[i]);
    rgb = Mix(rgb, Palette.river, river * 0.9);
    rgb = Mix(rgb, Palette.sand, beach);
    // A little per-cell variation so flat areas do not look like a plastic sheet.
    const grain = 0.94 + 0.12 * Hash(i, seed);
    return [rgb[0] * grain, rgb[1] * grain, rgb[2] * grain];
}

function StrataColour(d, i, h, sea, cell, seed, relief) {
    if (h < sea) return NaturalColour(d, i, h, sea, relief, seed);
    // Bands follow altitude, so layers continue across the surface; steep faces show the banding strongest.
    const thickness = Math.max(6, relief / 22);
    const band = Math.floor(h / thickness);
    const pick = StrataPalette[Math.floor(Hash(band, seed) * StrataPalette.length)];
    const next = StrataPalette[Math.floor(Hash(band + 1, seed) * StrataPalette.length)];
    const fraction = h / thickness - band;
    const seam = Smoothstep(0.82, 1, fraction) * 0.35;
    let rgb = Mix(pick, next, seam);
    const cliffy = Smoothstep(24, 40, d.slope[i]);
    rgb = Mix(rgb, [70, 56, 50], cliffy * 0.15);
    const grain = 0.9 + 0.2 * Hash(i, seed + 7);
    return [rgb[0] * grain, rgb[1] * grain, rgb[2] * grain];
}
