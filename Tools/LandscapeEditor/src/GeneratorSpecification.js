// GeneratorSpecification: the shape generators used by base-shape and relief layers.
// Each kind maps normalised coordinates to a shape in [0, 1] and returns metres: amplitude * (shape - baseline).

import { Billow, Cellular, Clamp, Fractal, GradientNoise, Multifractal, Ridged, Smoothstep } from "./NoiseSolver.js";
import { Parameter } from "./ParameterSpecification.js";

const Shared = [
    Parameter("frequency", "Feature count", 0.5, 16, 0.1, 3, "×", "Noise features across the map width.", "Broad", "Fine"),
    Parameter("octaves", "Detail octaves", 1, 10, 0.1, 6, "", "More octaves add smaller bumps and rough texture.", "Smooth", "Detailed"),
    Parameter("lacunarity", "Lacunarity", 1.5, 3.5, 0.05, 2.1, "", "Frequency ratio between octaves.", "Regular", "Irregular"),
    Parameter("gain", "Roughness gain", 0.2, 0.9, 0.01, 0.5, "", "Amplitude ratio between octaves.", "Soft", "Rough"),
    Parameter("warp", "Domain warp", 0, 1.5, 0.01, 0.25, "", "Bends the noise domain for organic, non-repeating forms.", "Straight", "Swirled"),
    Parameter("amplitude", "Amplitude", 0, 3000, 1, 800, "m", "Vertical extent of this generator.", "Flat", "Tall"),
    Parameter("baseline", "Baseline", 0, 1, 0.01, 0.5, "", "Shape level that maps to zero metres.", "Lowest", "Highest"),
];

function Parameters(extra, defaults = {}) {
    return [...Shared.map((p) => (defaults[p.key] !== undefined ? { ...p, value: defaults[p.key] } : p)), ...extra];
}

// Geometric kinds have no noise octaves, warp or feature count: only the envelope sliders apply.
function Envelope(extra, defaults = {}) {
    const keep = Shared.filter((p) => p.key === "amplitude" || p.key === "baseline");
    return [...keep.map((p) => (defaults[p.key] !== undefined ? { ...p, value: defaults[p.key] } : p)), ...extra];
}

// Common warped coordinates in noise space. Warp is applied once here so every kind shares the same domain bending.
function WarpedCoordinates(u, v, frequency, warp, seed) {
    const px = u * frequency;
    const py = v * frequency;
    if (warp <= 0) {
        return [px, py];
    }
    const wx = Fractal(px * 0.7 + 3.1, py * 0.7 - 1.7, seed + 7001, 3, 2, 0.5);
    const wy = Fractal(px * 0.7 - 5.3, py * 0.7 + 2.9, seed + 7019, 3, 2, 0.5);
    return [px + warp * 0.6 * wx, py + warp * 0.6 * wy];
}

const Signed = (value) => 0.5 + 0.5 * value;

function MountainShape(px, py, p, seed) {
    const massif = Signed(Fractal(px * 0.45 + 13.7, py * 0.45 - 4.1, seed + 3001, 3, 2, 0.5));
    const ridge = Ridged(px * 1.6, py * 1.6, seed + 3011, Math.min(5, p.octaves), p.lacunarity, p.gain, p.sharpness);
    const plateau = Smoothstep(0.3, 0.8, massif);
    const combined = (1 - p.ridgeShare) * massif * massif + p.ridgeShare * ridge;
    const detail = Signed(GradientNoise(px * 7, py * 7, seed + 3023));
    const shape = plateau * (combined + p.detail * 0.12 * (detail - 0.5));
    return Math.pow(Clamp(shape, 0, 1), p.sharpness);
}

const scratch = new Float64Array(3);

export const GeneratorVariants = {
    perlin: {
        label: "Perlin fBm",
        family: "fractal",
        hint: "Classic gradient noise summed over octaves. Rolling hills and general base relief.",
        parameters: Parameters([]),
        shape(px, py, p, seed) {
            return Signed(Fractal(px, py, seed, p.octaves, p.lacunarity, p.gain));
        },
    },
    multifractal: {
        label: "Multifractal",
        family: "fractal",
        hint: "Hybrid multifractal: high ground accumulates more detail than valleys, giving uneven, eroded-looking uplands.",
        parameters: Parameters([
            Parameter("dimension", "Fractal dimension H", 0, 1.2, 0.01, 0.25, "", "Lower values keep detail everywhere; higher values concentrate it on peaks.", "Even", "Peaky"),
            Parameter("offset", "Offset", 0.2, 1.5, 0.01, 0.7, "", "Raises the noise floor so that every octave contributes.", "Low", "High"),
        ]),
        shape(px, py, p, seed) {
            return Multifractal(px, py, seed, p.octaves, p.lacunarity, p.dimension, p.offset);
        },
    },
    ridge: {
        label: "Ridge noise",
        family: "fractal",
        hint: "Ridged multifractal: folded noise produces sharp crests and valleys. Good for ranges and fault relief.",
        parameters: Parameters([
            Parameter("sharpness", "Crest sharpness", 1, 3, 0.01, 2, "", "Higher values make narrower, sharper crests.", "Rounded", "Knife-edge"),
        ], { baseline: 0 }),
        shape(px, py, p, seed) {
            return Ridged(px, py, seed, p.octaves, p.lacunarity, p.gain, p.sharpness);
        },
    },
    mountain: {
        label: "Mountain noise",
        family: "fractal",
        normalise: true,
        hint: "Massif plateaus with ridged peaks on top, sharpened toward summits. Built for high relief.",
        parameters: Parameters([
            Parameter("sharpness", "Peak sharpness", 1, 3.5, 0.01, 1.8, "", "Sharpens the summits against the massif shoulders.", "Massive", "Spiky"),
            Parameter("ridgeShare", "Ridge share", 0, 1, 0.01, 0.7, "", "How much of the peak field comes from ridges instead of the massif.", "Massif", "Ridged"),
            Parameter("detail", "Surface detail", 0, 1, 0.01, 0.25, "", "Fine roughness on the flanks.", "Smooth", "Rough"),
        ], { amplitude: 1800, baseline: 0.12 }),
        shape(px, py, p, seed) {
            return MountainShape(px, py, p, seed);
        },
    },
    billow: {
        label: "Billow noise",
        family: "fractal",
        hint: "Absolute-value octaves: rounded lumps, dunes and soft mounds.",
        parameters: Parameters([], { baseline: 0 }),
        shape(px, py, p, seed) {
            return Billow(px, py, seed, p.octaves, p.lacunarity, p.gain);
        },
    },
    cells: {
        label: "Cellular plateaus",
        family: "cellular",
        hint: "Voronoi cells with domed or flat-topped plateaus, like lava fields, outcrops and jointed blocks.",
        parameters: Parameters([
            Parameter("edge", "Edge sharpness", 0.5, 4, 0.01, 1.6, "", "Higher values make steeper cell walls.", "Soft domes", "Blocky"),
            Parameter("randomHeight", "Cell height variation", 0, 1, 0.01, 0.5, "", "Random height per cell.", "Uniform", "Varied"),
        ], { baseline: 0.1 }),
        shape(px, py, p, seed) {
            Cellular(px, py, seed, scratch);
            const plateau = Math.pow(Clamp(1 - scratch[0] / 0.75, 0, 1), p.edge);
            return plateau * (1 - p.randomHeight + p.randomHeight * scratch[2]);
        },
    },
    terraces: {
        label: "Stepped terraces",
        family: "cellular",
        hint: "Quantised noise: flat benches with cliff risers, as in sandstone and mesa country.",
        parameters: Parameters([
            Parameter("steps", "Terrace steps", 2, 16, 1, 6, "", "Number of benches in the height range.", "Few", "Many"),
            Parameter("riser", "Riser sharpness", 0, 1, 0.01, 0.6, "", "Sharp risers form cliffs; soft risers form slopes.", "Soft", "Cliffs"),
        ], { baseline: 0.1 }),
        shape(px, py, p, seed) {
            const t = Signed(Fractal(px, py, seed, p.octaves, p.lacunarity, p.gain)) * p.steps;
            const frac = t - Math.floor(t);
            const width = 0.5 * (1 - p.riser) + 0.02;
            return (Math.floor(t) + Smoothstep(0.5 - width, 0.5 + width, frac)) / p.steps;
        },
    },
    ramp: {
        label: "Tilted plane",
        family: "geometric",
        hint: "A planar tilt for regional dip or a coastal shelf. Combine with masks to bend it locally.",
        parameters: Envelope([
            Parameter("direction", "Direction", 0, 360, 1, 45, "deg", "Uphill direction, measured counter-clockwise from +X.", "Westward", "Eastward"),
        ], { amplitude: 600, baseline: 0.5 }),
        shape(u, v, p) {
            const angle = p.direction * Math.PI / 180;
            return Clamp(0.5 + ((u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle)) * 1.4142, 0, 1);
        },
    },
    dome: {
        label: "Dome",
        family: "geometric",
        hint: "A radial dome for island, volcano or basin shapes.",
        parameters: Envelope([
            Parameter("radius", "Radius", 0.2, 1, 0.01, 0.6, "", "Dome radius relative to the map diagonal.", "Small", "Whole map"),
            Parameter("falloff", "Falloff", 0.5, 4, 0.01, 1.6, "", "Higher values give a tighter, steeper summit.", "Gentle", "Steep"),
        ], { amplitude: 900, baseline: 0 }),
        shape(u, v, p) {
            const r = Math.hypot(u - 0.5, v - 0.5);
            return Math.pow(Clamp(1 - r / (p.radius * 1.4142), 0, 1), p.falloff);
        },
    },
};

export const GeneratorVariantNames = Object.keys(GeneratorVariants);

// Samples one generator over the whole grid. Returns metres (contribution) and the normalised shape (for previews).
export function SampleGenerator(kind, params, seed, n) {
    const spec = GeneratorVariants[kind] || GeneratorVariants.perlin;
    const meters = new Float32Array(n * n);
    const shape = new Float32Array(n * n);
    const geometric = spec.family === "geometric";
    for (let y = 0; y < n; y++) {
        const v = (y + 0.5) / n;
        for (let x = 0; x < n; x++) {
            const u = (x + 0.5) / n;
            let s;
            if (geometric) {
                s = spec.shape(u, v, params, seed);
            } else {
                const [px, py] = WarpedCoordinates(u, v, params.frequency, params.warp, seed);
                s = spec.shape(px, py, params, seed);
            }
            s = Clamp(s, 0, 1);
            const i = y * n + x;
            shape[i] = s;
        }
    }
    // Generators flagged as normalised spread their own range across the grid, so the tallest point reaches the full
    // amplitude whatever the frequency or sharpness settings.
    if (spec.normalise) {
        let low = Infinity;
        let high = -Infinity;
        for (let i = 0; i < shape.length; i++) {
            if (shape[i] < low) low = shape[i];
            if (shape[i] > high) high = shape[i];
        }
        const span = high - low || 1;
        for (let i = 0; i < shape.length; i++) shape[i] = (shape[i] - low) / span;
    }
    for (let i = 0; i < shape.length; i++) {
        meters[i] = params.amplitude * (shape[i] - params.baseline);
    }
    return { meters, shape };
}
