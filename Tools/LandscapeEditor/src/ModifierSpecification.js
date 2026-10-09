// ModifierSpecification: shaping operations that compute a target height from the terrain beneath them. The stack combines
// the target in through the layer's masks and opacity, so a terrace can be limited to one cliff band.

import { BoxSmooth } from "./ElevationSpace.js";
import { Smoothstep } from "./NoiseSolver.js";
import { Parameter } from "./ParameterSpecification.js";

export const ModifierVariants = {
    terrace: {
        label: "Terrace",
        icon: "Layers",
        hint: "Quantises height into benches with risers. Sharpness sets how cliff-like the steps are.",
        parameters: [
            Parameter("interval", "Bench interval", 5, 300, 1, 60, "m", "Vertical spacing of the benches.", "Fine", "Coarse"),
            Parameter("sharpness", "Riser sharpness", 0, 1, 0.01, 0.7, "", "Sharp risers form cliffs; soft risers form slopes.", "Soft", "Cliffs"),
        ],
        Apply(p, height) {
            const width = 0.5 * (1 - p.sharpness) + 0.02;
            const out = new Float32Array(height.length);
            for (let i = 0; i < height.length; i++) {
                const t = height[i] / p.interval;
                const frac = t - Math.floor(t);
                out[i] = (Math.floor(t) + Smoothstep(0.5 - width, 0.5 + width, frac)) * p.interval;
            }
            return out;
        },
    },
    smooth: {
        label: "Smooth",
        icon: "Minus",
        hint: "Averages the height over neighbours to soften sharp edges, for example after cutting a fault.",
        parameters: [
            Parameter("passes", "Passes", 1, 30, 1, 4, "", "Number of smoothing passes.", "Light", "Heavy"),
        ],
        Apply(p, height, n) {
            return BoxSmooth(height, n, Math.round(p.passes));
        },
    },
    uplift: {
        label: "Uplift",
        icon: "ArrowUp",
        hint: "Raises or lowers the masked ground by a fixed amount, for regional tectonic uplift or subsidence.",
        parameters: [
            Parameter("amount", "Amount", -500, 800, 5, 80, "m", "Vertical shift. Negative values subside.", "Subside", "Uplift"),
        ],
        Apply(p, height) {
            const out = new Float32Array(height.length);
            for (let i = 0; i < height.length; i++) {
                out[i] = height[i] + p.amount;
            }
            return out;
        },
    },
};

export const ModifierVariantNames = Object.keys(ModifierVariants);
