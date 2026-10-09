// ErosionSpecification: the erosion types offered by the Erosion family, each with its own parameter sliders.
// An erosion layer runs its solver on the terrain beneath it; masks decide where the result is applied.

import { RunHydraulic } from "./HydraulicSolver.js";
import { RunThermal } from "./ThermalSolver.js";
import { RunFluvial } from "./FluvialSolver.js";
import { RunAeolian } from "./AeolianSolver.js";
import { RunCoastal } from "./CoastalSolver.js";
import { Parameter } from "./ParameterSpecification.js";
import { DefaultsOf } from "./ParameterSpecification.js";

export const ErosionVariants = {
    hydraulic: {
        label: "Hydraulic (droplet)",
        icon: "Droplets",
        hint: "Rain droplets carry sediment downhill: they carve gullies on slopes and drop silt in flats. Good fine detail.",
        parameters: [
            Parameter("droplets", "Rain droplets", 1000, 400000, 1000, 60000, "", "Number of simulated raindrops. More drops give deeper, more uniform erosion.", "Light rain", "Storm"),
            Parameter("lifetime", "Droplet lifetime", 10, 120, 1, 60, "steps", "How far a droplet travels before it evaporates.", "Short", "Long"),
            Parameter("radius", "Erosion radius", 1, 6, 1, 3, "cells", "Brush radius. Wider brushes give broad, smooth channels.", "Narrow", "Broad"),
            Parameter("inertia", "Inertia", 0, 0.5, 0.01, 0.05, "", "Resistance to changing direction. High inertia gives straighter channels.", "Twisty", "Straight"),
            Parameter("capacity", "Sediment capacity", 0.5, 10, 0.1, 4, "", "How much sediment a droplet can carry.", "Low", "High"),
            Parameter("erodeRate", "Erosion speed", 0, 1, 0.01, 0.3, "", "Fraction of spare capacity turned into erosion per step.", "Slow", "Fast"),
            Parameter("depositRate", "Deposition speed", 0, 1, 0.01, 0.3, "", "Fraction of excess sediment dropped per step.", "Slow", "Fast"),
            Parameter("evaporation", "Evaporation", 0, 0.1, 0.001, 0.01, "", "Water lost per step. Dries droplets out sooner.", "Wet", "Dry"),
            Parameter("gravity", "Gravity", 0, 20, 0.1, 4, "", "Acceleration on descent. Faster droplets erode more.", "Gentle", "Steep"),
            Parameter("minSlope", "Minimum slope", 0, 0.2, 0.001, 0.02, "", "Floor on the slope term so flats still carry sediment.", "None", "Flat-biased"),
        ],
        Run(p, ctx) {
            return RunHydraulic(ctx.height, ctx.n, ctx.cell, p, ctx.seed, ctx.sea, ctx.diagnostics);
        },
    },
    thermal: {
        label: "Thermal (talus)",
        icon: "Mountain",
        hint: "Weathering collapses slopes steeper than the talus angle into scree. It limits cliffs to the rock's angle of repose.",
        parameters: [
            Parameter("talus", "Talus angle", 5, 60, 0.5, 35, "deg", "Steepest stable slope. Loose rock settles near 33°, solid rock stands steeper.", "Loose", "Solid rock"),
            Parameter("rate", "Transfer rate", 0, 0.5, 0.01, 0.4, "", "Fraction of excess height moved per iteration.", "Slow", "Fast"),
            Parameter("iterations", "Iterations", 1, 200, 1, 40, "", "Relaxation passes.", "Few", "Many"),
        ],
        Run(p, ctx) {
            return RunThermal(ctx.height, ctx.n, ctx.cell, p, ctx.sea, ctx.diagnostics);
        },
    },
    fluvial: {
        label: "Fluvial (stream power)",
        icon: "Route",
        hint: "Rivers cut valleys in proportion to their drainage area and slope. This is what makes dendritic drainage and knickpoints.",
        parameters: [
            Parameter("iterations", "Iterations", 5, 200, 1, 40, "", "Uplift and incision steps. More steps cut deeper valleys.", "Young", "Mature"),
            Parameter("erodibility", "Erodibility", 0, 0.2, 0.001, 0.02, "", "How easily rock is incised by flowing water.", "Resistant", "Soft"),
            Parameter("areaExponent", "Area exponent m", 0.2, 0.8, 0.01, 0.5, "", "How strongly river size controls incision. Around 0.5 is typical.", "Hillslope", "Channel"),
            Parameter("uplift", "Uplift per step", 0, 10, 0.1, 0.5, "m", "Land raised each step, keeping the rivers cutting.", "Stable", "Rising"),
            Parameter("hardnessContrast", "Rock hardness contrast", 0, 1, 0.01, 0.4, "", "Variation in rock resistance. Produces waterfalls and knickpoints.", "Uniform", "Hard and soft"),
        ],
        Run(p, ctx) {
            return RunFluvial(ctx.height, ctx.n, ctx.cell, p, ctx.seed, ctx.sea, ctx.diagnostics);
        },
    },
    aeolian: {
        label: "Aeolian (wind dunes)",
        icon: "Wind",
        hint: "Wind lifts sand up windward slopes and drops it in the lee. Builds transverse dunes on flat, sandy ground.",
        parameters: [
            Parameter("direction", "Wind direction", 0, 360, 1, 60, "deg", "Direction the wind blows toward, clockwise from north.", "North", "South"),
            Parameter("strength", "Sand transport", 0, 4, 0.01, 1, "", "Strength of saltation transport.", "Calm", "Gale"),
            Parameter("crestAcceleration", "Crest acceleration", 0, 6, 0.01, 3, "", "How strongly wind speeds up over crests. Drives dune growth.", "Passive", "Active"),
            Parameter("wavelength", "Dune wavelength", 40, 800, 5, 220, "m", "Spacing between dune crests.", "Ripples", "Megadunes"),
            Parameter("sandSupply", "Sand supply", 0, 1, 0.01, 0.8, "", "Fraction of the ground that can be moved.", "Bare rock", "Sand sea"),
            Parameter("iterations", "Steps", 10, 1200, 1, 90, "", "Transport steps. More steps give taller dunes. Dunes form best at 128 or 192 resolution.", "Young", "Mature"),
        ],
        Run(p, ctx) {
            return RunAeolian(ctx.height, ctx.n, ctx.cell, p, ctx.seed, ctx.sea, ctx.diagnostics);
        },
    },
    coastal: {
        label: "Coastal (wave cut)",
        icon: "Waves",
        hint: "Waves undercut cliffs at sea level and shape a beach profile. Use with a coastal mask to limit it to the shore.",
        parameters: [
            Parameter("iterations", "Iterations", 5, 200, 1, 50, "", "Wave erosion steps.", "Few", "Many"),
            Parameter("rate", "Wave cut rate", 0, 5, 0.05, 0.9, "m", "Height removed per step at the wave base.", "Slow", "Fast"),
            Parameter("reach", "Wave reach", 20, 400, 5, 120, "m", "Distance inland that waves reach.", "Short", "Long"),
            Parameter("band", "Wave band", 1, 30, 0.5, 6, "m", "Vertical band around sea level where waves cut.", "Narrow", "Wide"),
            Parameter("cliffAngle", "Cliff angle", 10, 80, 0.5, 35, "deg", "Steepness at which undercutting is strongest.", "Gentle", "Steep"),
            Parameter("beachSlope", "Beach slope", 0, 10, 0.1, 3, "deg", "Gradient of the beach profile. Zero disables beach shaping.", "None", "Steep"),
            Parameter("beachWidth", "Beach width", 0, 400, 5, 80, "m", "Width of beach shaping inland from the shore.", "None", "Wide"),
        ],
        Run(p, ctx) {
            return RunCoastal(ctx.height, ctx.n, ctx.cell, p, ctx.seed, ctx.sea, ctx.diagnostics);
        },
    },
};

export const ErosionVariantNames = Object.keys(ErosionVariants);

// Runs one erosion type on the given height array in place. Returns the diagnostics that accumulated erosion and deposition.
export function RunErosion(kind, params, height, n, extent, seed, sea) {
    const spec = ErosionVariants[kind] || ErosionVariants.hydraulic;
    const size = n * n;
    const diagnostics = { erosion: new Float32Array(size), deposition: new Float32Array(size) };
    // Missing parameters fall back to their slider defaults, so partial calls cannot pass undefined into a solver.
    const full = { ...DefaultsOf(spec.parameters), ...(params || {}) };
    spec.Run(full, { height, n, cell: extent / n, seed, sea, diagnostics });
    return diagnostics;
}
