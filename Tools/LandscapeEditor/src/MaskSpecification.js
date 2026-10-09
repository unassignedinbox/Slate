// MaskSpecification: weights in [0, 1] that gate any layer. Masks read the terrain as it stands at their position in the
// stack, so a coastal mask placed after a base shape follows the coastline that shape produced.

import { Clamp, Cellular, Fractal, Smoothstep } from "./NoiseSolver.js";
import { DistanceToWater, SlopeDegrees, Degrees } from "./ElevationSpace.js";
import { Parameter } from "./ParameterSpecification.js";

// Context memoises the derived fields (slope and distance to water) that several masks and solvers share.
export function CreateMaskContext({ n, extent, sea, seed, height }) {
    const cell = extent / n;
    let slope = null;
    let distance = null;
    return {
        n,
        extent,
        cell,
        sea,
        seed,
        height,
        Slope() {
            if (!slope) slope = SlopeDegrees(height, n, cell);
            return slope;
        },
        // Distance to water in metres.
        DistanceMeters() {
            if (!distance) {
                const cells = DistanceToWater(height, n, sea);
                distance = new Float32Array(cells.length);
                for (let i = 0; i < cells.length; i++) distance[i] = cells[i] * cell;
            }
            return distance;
        },
    };
}

const Signed01 = (value) => 0.5 + 0.5 * value;
const scratch = new Float64Array(3);

export const MaskVariants = {
    coastal: {
        label: "Coastal falloff",
        icon: "Waves",
        hint: "Fades a layer out toward the shoreline, with a breakup so the coast stays irregular.",
        parameters: [
            Parameter("falloff", "Falloff distance", 20, 800, 5, 180, "m", "Distance inland over which the layer ramps up from the shore.", "Sharp", "Long beach"),
            Parameter("breakup", "Coastline breakup", 0, 1, 0.01, 0.35, "", "Noise on the falloff, so the shore is not a clean contour.", "Clean", "Ragged"),
        ],
        Weight(p, ctx) {
            const distance = ctx.DistanceMeters();
            return PerCellIndex(ctx, (i, u, v) => {
                if (ctx.height[i] < ctx.sea) return 0;
                const jitter = (Signed01(Fractal(u * 6, v * 6, ctx.seed + 401, 4, 2, 0.5)) - 0.5) * 2 * p.breakup * p.falloff * 0.8;
                return Smoothstep(0, p.falloff, distance[i] + jitter);
            });
        },
    },
    mountain: {
        label: "Mountain falloff",
        icon: "Mountain",
        hint: "Smooth elevation falloff around high ground, with ragged edges so the mountain never reads as a contour line.",
        parameters: [
            Parameter("start", "Start elevation", -200, 2500, 5, 350, "m", "Elevation above sea level where the mask begins.", "Low", "High"),
            Parameter("softness", "Falloff height", 10, 1500, 5, 350, "m", "Height over which the mask rises from zero to full.", "Abrupt", "Gradual"),
            Parameter("ragged", "Edge raggedness", 0, 1, 0.01, 0.5, "", "Noise breakup of the elevation edge.", "Continuous", "Broken"),
            Parameter("raggedScale", "Edge detail", 1, 16, 0.1, 6, "×", "Feature count of the edge noise.", "Broad", "Fine"),
            Parameter("slopeWeight", "Steepness weight", 0, 1, 0.01, 0, "", "Also favours steeper ground when raised.", "Elevation only", "Slope-led"),
        ],
        Weight(p, ctx) {
            const { sea } = ctx;
            const slope = ctx.Slope();
            return PerCellIndex(ctx, (i, u, v) => {
                const elevation = ctx.height[i] - sea;
                let w = Smoothstep(p.start, p.start + p.softness, elevation);
                const edge = Signed01(Fractal(u * p.raggedScale, v * p.raggedScale, ctx.seed + 501, 4, 2.05, 0.5));
                w = Smoothstep(0, 1, w + (edge - 0.5) * p.ragged * 1.6);
                const gate = 1 - p.slopeWeight * (1 - Smoothstep(8, 32, slope[i]));
                return w * gate;
            });
        },
    },
    stratify: {
        label: "Stratified beds",
        icon: "Layers",
        hint: "Horizontal or dipping sedimentary beds. Hard beds resist erosion; soft beds recede.",
        parameters: [
            Parameter("thickness", "Bed thickness", 4, 200, 1, 45, "m", "Vertical thickness of one bed.", "Thin", "Thick"),
            Parameter("hardness", "Bed contrast", 0, 1, 0.01, 0.6, "", "Difference between hard and soft beds.", "Uniform", "Banded"),
            Parameter("dip", "Dip angle", 0, 25, 0.1, 4, "deg", "Tilt of the beds.", "Flat", "Dipping"),
            Parameter("dipDirection", "Dip direction", 0, 360, 1, 30, "deg", "Direction the beds fall toward.", "North", "South"),
            Parameter("noise", "Bed irregularity", 0, 1, 0.01, 0.25, "", "Wobble in the bed contacts.", "Planar", "Wavy"),
        ],
        Weight(p, ctx) {
            const angle = p.dipDirection * Math.PI / 180;
            const tan = Math.tan(p.dip / Degrees);
            const { extent } = ctx;
            return PerCellIndex(ctx, (i, u, v) => {
                const along = ((u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle)) * extent;
                const wobble = Fractal(u * 3, v * 3, ctx.seed + 601, 3, 2, 0.5) * p.noise * p.thickness * 0.8;
                const s = (ctx.height[i] + along * tan + wobble) / p.thickness;
                const f = s - Math.floor(s);
                const bed = Smoothstep(0, 0.08, f) * (1 - Smoothstep(0.5, 0.58, f));
                return 0.5 + (bed - 0.5) * p.hardness;
            });
        },
    },
    stacks: {
        label: "Sea stacks",
        icon: "Triangle",
        hint: "Isolated columns standing above the surrounding ground, from cellular placement.",
        parameters: [
            Parameter("density", "Density", 0, 1, 0.01, 0.3, "", "Fraction of cells that hold a stack.", "Sparse", "Crowded"),
            Parameter("radius", "Stack radius", 5, 200, 1, 45, "m", "Horizontal radius of each stack.", "Needles", "Pillars"),
            Parameter("softness", "Edge softness", 0, 1, 0.01, 0.4, "", "Feather width along the stack flanks.", "Hard", "Soft"),
            Parameter("minHeight", "Minimum height", 0, 500, 5, 20, "m", "Only ground this high above sea level can host a stack.", "Anywhere", "High ground"),
            Parameter("spacing", "Spacing", 2, 24, 0.5, 8, "×", "Cells per map width.", "Dense", "Wide"),
        ],
        Weight(p, ctx) {
            const { extent, sea } = ctx;
            const scale = p.spacing;
            const cellSize = extent / scale;
            return PerCellIndex(ctx, (i, u, v) => {
                Cellular(u * scale, v * scale, ctx.seed + 701, scratch);
                const present = scratch[2] < p.density ? 1 : 0;
                const distance = scratch[0] * cellSize;
                const core = 1 - Smoothstep(p.radius * (1 - p.softness), p.radius, distance);
                const high = Smoothstep(p.minHeight - 10, p.minHeight + 10, ctx.height[i] - sea);
                return present * core * high;
            });
        },
    },
    rifts: {
        label: "Rift lines",
        icon: "Zap",
        hint: "Narrow trough networks along cell boundaries, like faults and graben. Use with a subtract layer to carve them.",
        parameters: [
            Parameter("scale", "Network scale", 1, 12, 0.1, 4, "×", "Cells per map width.", "Few faults", "Many faults"),
            Parameter("width", "Rift width", 4, 300, 1, 35, "m", "Width of the trough at its centre.", "Crack", "Valley"),
            Parameter("softness", "Edge softness", 0, 1, 0.01, 0.5, "", "Feather of the rift edges.", "Sharp", "Feathered"),
            Parameter("warp", "Path wander", 0, 1, 0.01, 0.6, "", "Bends the fault lines.", "Straight", "Meandering"),
        ],
        Weight(p, ctx) {
            const { extent } = ctx;
            const cellSize = extent / p.scale;
            return PerCellIndex(ctx, (i, u, v) => {
                let px = u * p.scale;
                let py = v * p.scale;
                if (p.warp > 0) {
                    px += p.warp * 0.5 * Fractal(u * 2.5, v * 2.5, ctx.seed + 801, 3, 2, 0.5);
                    py += p.warp * 0.5 * Fractal(u * 2.5 + 9, v * 2.5 - 4, ctx.seed + 809, 3, 2, 0.5);
                }
                Cellular(px, py, ctx.seed + 811, scratch);
                const edge = (scratch[1] - scratch[0]) * cellSize;
                const half = p.width * 0.5;
                return 1 - Smoothstep(half, half + p.softness * p.width * 2, edge);
            });
        },
    },
    cliffs: {
        label: "Cliff faces",
        icon: "Mountain",
        hint: "Weights ground steeper than the threshold angle. Pair with erosion to keep the faces steep.",
        parameters: [
            Parameter("angle", "Threshold angle", 5, 70, 0.1, 32, "deg", "Slope where the mask reaches full strength.", "Gentle", "Steep"),
            Parameter("softness", "Transition", 0.5, 20, 0.1, 6, "deg", "Width of the slope transition.", "Sharp", "Soft"),
            Parameter("floor", "Elevation floor", 0, 1000, 5, 0, "m", "Only cliffs above this height above sea level.", "Anywhere", "High only"),
        ],
        Weight(p, ctx) {
            const slope = ctx.Slope();
            const { sea } = ctx;
            return PerCellIndex(ctx, (i) => {
                const steep = Smoothstep(p.angle - p.softness, p.angle + p.softness, slope[i]);
                return steep * Smoothstep(p.floor - 20, p.floor + 20, ctx.height[i] - sea);
            });
        },
    },
    slope: {
        label: "Slope band",
        icon: "TrendingUp",
        hint: "Weights ground between two slope angles.",
        parameters: [
            Parameter("from", "Start angle", 0, 80, 0.5, 10, "deg", "Slope where the mask begins.", "Flat", "Steep"),
            Parameter("to", "Full angle", 5, 90, 0.5, 35, "deg", "Slope where the mask is full.", "Flat", "Steep"),
        ],
        Weight(p, ctx) {
            const slope = ctx.Slope();
            return PerCellIndex(ctx, (i) => Smoothstep(p.from, Math.max(p.from + 0.5, p.to), slope[i]));
        },
    },
    height: {
        label: "Elevation band",
        icon: "Mountain",
        hint: "Weights ground between two elevations above sea level.",
        parameters: [
            Parameter("low", "Low elevation", -500, 4000, 5, 200, "m", "Elevation where the mask begins.", "Low", "High"),
            Parameter("high", "Full elevation", -500, 5000, 5, 900, "m", "Elevation where the mask is full.", "Low", "High"),
        ],
        Weight(p, ctx) {
            const { sea } = ctx;
            return PerCellIndex(ctx, (i) => Smoothstep(p.low, Math.max(p.low + 1, p.high), ctx.height[i] - sea));
        },
    },
    radial: {
        label: "Island radial",
        icon: "Circle",
        hint: "A radial falloff toward the map edges, with optional breakup.",
        parameters: [
            Parameter("radius", "Radius", 0.1, 1, 0.01, 0.45, "", "Radius of the full-strength area.", "Small", "Whole map"),
            Parameter("softness", "Softness", 0.02, 0.8, 0.01, 0.25, "", "Width of the falloff ring.", "Hard", "Soft"),
            Parameter("breakup", "Coastline breakup", 0, 1, 0.01, 0.3, "", "Noise on the falloff ring.", "Smooth", "Ragged"),
        ],
        Weight(p, ctx) {
            return PerCellIndex(ctx, (i, u, v) => {
                const r = Math.hypot(u - 0.5, v - 0.5) * 2;
                const jitter = Fractal(u * 4, v * 4, ctx.seed + 901, 4, 2, 0.5) * p.breakup * 0.15;
                return Smoothstep(p.radius + p.softness, p.radius - p.softness, r + jitter);
            });
        },
    },
    noise: {
        label: "Noise breakup",
        icon: "Sparkles",
        hint: "A patchy noise mask, for scattering layers across the map.",
        parameters: [
            Parameter("frequency", "Frequency", 0.5, 16, 0.1, 3, "×", "Noise features across the map width.", "Broad", "Fine"),
            Parameter("threshold", "Threshold", 0, 1, 0.01, 0.45, "", "Coverage: higher thresholds leave less area.", "Everywhere", "Patchy"),
            Parameter("softness", "Softness", 0, 0.5, 0.01, 0.15, "", "Width of the transition.", "Hard", "Soft"),
        ],
        Weight(p, ctx) {
            return PerCellIndex(ctx, (i, u, v) => {
                const value = Signed01(Fractal(u * p.frequency, v * p.frequency, ctx.seed + 1001, 4, 2, 0.5));
                return Smoothstep(p.threshold - p.softness, p.threshold + p.softness, value);
            });
        },
    },
};

function PerCellIndex(ctx, compute) {
    const { n } = ctx;
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        const v = (y + 0.5) / n;
        for (let x = 0; x < n; x++) {
            const u = (x + 0.5) / n;
            const i = y * n + x;
            out[i] = Clamp(compute(i, u, v), 0, 1);
        }
    }
    return out;
}

// Final weight of one mask: its kind's weight, inverted if requested, then combined toward 1 by strength.
export function MaskWeight(mask, ctx) {
    const spec = MaskVariants[mask.kind] || MaskVariants.coastal;
    const weights = spec.Weight(mask.params, ctx);
    const strength = Clamp(mask.strength ?? 1, 0, 1);
    const out = new Float32Array(weights.length);
    for (let i = 0; i < weights.length; i++) {
        let w = mask.invert ? 1 - weights[i] : weights[i];
        w = 1 + (w - 1) * strength;
        out[i] = Clamp(w, 0, 1);
    }
    return out;
}

export const MaskVariantNames = Object.keys(MaskVariants);
