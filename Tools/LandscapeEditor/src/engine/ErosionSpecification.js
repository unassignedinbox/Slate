//============================================================================================================================================
//                                                          EROSIONSPECIFICATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/ErosionSpecification.js — Erosion type catalogue: parameter schemas, lithologic erodibility and
//    talus coupling from bedding, and dispatch to the hydraulic, thermal, fluvial, glacial, aeolian and coastal solvers.

import { createField, clampNumber } from './HeightSpace.js';
import { computeBedding } from './BeddingSpace.js';
import { runHydraulic } from './HydraulicIntegrator.js';
import { runThermal } from './ThermalSolver.js';
import { runFluvial } from './FluvialSolver.js';
import { runGlacial } from './GlacialSolver.js';
import { runAeolian } from './AeolianIntegrator.js';
import { runCoastal } from './CoastalSolver.js';
import { sliderParameter, initialParameters, clampParameters } from './ParameterSpecification.js';

const LITHOLOGY = sliderParameter('litho', 'Lithology contrast', 0, 1, 0.01, 0.3, '', 'Hard caprock resists erosion; soft beds give way. Driven by the bedding model.');

//------------------------------------------------------------------------------------------------------------------------
//                                                   EROSION CATALOGUE
//------------------------------------------------------------------------------------------------------------------------
export const EROSION_TYPES = [
    {
        id: 'hydraulic',
        label: 'Hydraulic (rain)',
        blurb: 'Rain droplets pick up sediment on steep ground and drop it on flats. Fine gullies, branching drainage and alluvial fans.',
        params: [
            sliderParameter('density', 'Droplet density', 0.2, 6, 0.05, 1.2, 'per cell', 'Droplets released per cell; more gives denser, finer gullies.'),
            sliderParameter('lifetime', 'Droplet lifetime', 20, 120, 1, 48, 'steps', 'Steps before a droplet evaporates.'),
            sliderParameter('inertia', 'Inertia', 0, 0.5, 0.01, 0.1, '', 'Momentum carried through bends.'),
            sliderParameter('capacity', 'Carry capacity', 1, 10, 0.1, 4, '', 'Sediment carried per unit of speed and water.'),
            sliderParameter('erodeRate', 'Erode rate', 0, 1, 0.01, 0.35, '', 'Share of spare capacity turned into erosion.'),
            sliderParameter('depositRate', 'Deposit rate', 0, 1, 0.01, 0.3, '', 'Share of excess sediment dropped each step.'),
            sliderParameter('evaporation', 'Evaporation', 0, 0.2, 0.001, 0.02, '', 'Water lost per step.'),
            sliderParameter('radius', 'Brush radius', 1, 4, 1, 2, 'cells', 'Erosion footprint around each droplet.'),
            sliderParameter('gravity', 'Gravity', 1, 10, 0.1, 4, '', 'Acceleration gained downhill.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runHydraulic(elevation, context.n, context.dx, context.sea, p, lith.erodibility, context.seed);
        }
    },
    {
        id: 'thermal',
        label: 'Thermal (talus)',
        blurb: 'Weathering collapses over-steep faces into talus cones. Hard beds hold steeper cliffs.',
        params: [
            sliderParameter('talusDeg', 'Repose angle', 18, 55, 0.5, 34, '°', 'Stable slope; steeper material slumps.'),
            sliderParameter('rate', 'Relaxation rate', 0.05, 0.4, 0.01, 0.3, '', 'Share of excess slope moved per sweep.'),
            sliderParameter('iterations', 'Sweeps', 4, 120, 1, 40, '', 'Relaxation sweeps.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runThermal(elevation, context.n, context.dx, p, lith.talus);
        }
    },
    {
        id: 'fluvial',
        label: 'Fluvial (stream power)',
        blurb: 'Rivers incise in proportion to drainage area and slope while uplift raises the land. Canyons, valleys and terraces.',
        params: [
            sliderParameter('upliftM', 'Uplift', 0, 1200, 5, 300, 'm', 'Total uplift of land over the run. Balances incision.'),
            sliderParameter('streamK', 'Erodibility K', 0.01, 1.5, 0.01, 0.35, '', 'Stream-power coefficient.'),
            sliderParameter('areaExponent', 'Area exponent m', 0.2, 1, 0.01, 0.5, '', 'Dependence on drainage area.'),
            sliderParameter('slopeExponent', 'Slope exponent n', 0.6, 1.4, 0.01, 1.0, '', 'Dependence on slope.'),
            sliderParameter('iterations', 'Steps', 5, 150, 1, 50, '', 'Uplift and incision steps. More steps are slower and more accurate, not stronger.'),
            sliderParameter('creep', 'Hillslope creep', 0, 40, 0.5, 8, 'cells²', 'Total hillslope smoothing over the run. Softens valley walls and talus.'),
            sliderParameter('depositGradient', 'Deposition gradient', 0.005, 0.2, 0.001, 0.03, '', 'Gradient below which rivers drop their load: floodplains, lakes and fans.'),
            sliderParameter('depositFraction', 'Deposition', 0, 1, 0.01, 0.35, '', 'Share of the sediment load dropped where the gradient is gentle.'),
            sliderParameter('rainfall', 'Rainfall', 0.2, 3, 0.05, 1, '×', 'Relative runoff; scales drainage area.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runFluvial(elevation, context.n, context.dx, context.sea, p, lith.erodibility);
        }
    },
    {
        id: 'glacial',
        label: 'Glacial (ice)',
        blurb: 'Ice above the snowline carves U-shaped valleys and cirques; removed rock is exported. Approximate.',
        params: [
            sliderParameter('snowlineM', 'Snowline', 0, 5000, 10, 1800, 'm', 'Ice forms above this elevation.'),
            sliderParameter('iceFlux', 'Ice flux', 0.02, 1, 0.01, 0.25, '', 'Ice flux coefficient.'),
            sliderParameter('valleyWidthM', 'Valley width', 20, 800, 5, 180, 'm', 'Lateral spread of erosion across the valley floor.'),
            sliderParameter('cirque', 'Cirque hollowing', 0, 1, 0.01, 0.4, '', 'Headwalls and bowls above the snowline.'),
            sliderParameter('iterations', 'Steps', 4, 60, 1, 16, '', 'Ice steps.'),
            sliderParameter('maxRate', 'Max removal', 0.5, 20, 0.1, 5, 'm', 'Largest removal per step.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runGlacial(elevation, context.n, context.dx, context.sea, p, lith.erodibility);
        }
    },
    {
        id: 'aeolian',
        label: 'Aeolian (wind & dunes)',
        blurb: 'Wind deflates loose surfaces on windward crests and drops sand in the lee, forming dunes and deflation pavements.',
        params: [
            sliderParameter('windFromDeg', 'Wind from', 0, 360, 1, 225, '°', 'Bearing the wind blows from (0 = north).'),
            sliderParameter('windSpeed', 'Wind speed', 0.1, 2, 0.01, 0.8, '', 'Free-stream wind strength.'),
            sliderParameter('saltation', 'Saltation', 0.005, 0.5, 0.001, 0.05, 'm', 'Transport coefficient per sweep.'),
            sliderParameter('deflation', 'Deflation', 0, 1, 0.01, 0.35, '', 'Removal of loose surface on windward ground.'),
            sliderParameter('supply', 'Sand supply', 0, 0.5, 0.005, 0.02, 'm', 'Sand entering from the upwind edge.'),
            sliderParameter('topoBoost', 'Speed-up', 0, 6, 0.1, 2.5, '', 'Wind acceleration on windward slopes; shelter in the lee.'),
            sliderParameter('sweeps', 'Sweeps', 1, 6, 1, 3, '', 'Transport sweeps across the map.'),
            sliderParameter('maxDeflation', 'Max deflation', 0.1, 5, 0.1, 1.0, 'm', 'Largest removal per cell per sweep.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runAeolian(elevation, context.n, context.dx, context.sea, p, lith.erodibility);
        }
    },
    {
        id: 'coastal',
        label: 'Coastal (wave cut)',
        blurb: 'Waves cut shore platforms and retreat sea cliffs near sea level, shedding talus at the foot. Approximate.',
        params: [
            sliderParameter('waveEnergy', 'Wave energy', 0, 1, 0.01, 0.6, '', 'Wave energy reaching the shore.'),
            sliderParameter('fetchM', 'Wave decay', 20, 800, 5, 180, 'm', 'Distance over which wave energy decays inland.'),
            sliderParameter('reachM', 'Reach', 50, 1500, 10, 400, 'm', 'Largest distance from the shoreline affected.'),
            sliderParameter('bandM', 'Surf band', 2, 80, 0.5, 14, 'm', 'Vertical surf zone above sea level.'),
            sliderParameter('platformM', 'Platform height', 0, 10, 0.1, 3, 'm', 'Shore platform height above sea level.'),
            sliderParameter('platformRate', 'Platform rate', 0, 0.5, 0.01, 0.2, '', 'How quickly platforms flatten.'),
            sliderParameter('retreat', 'Cliff retreat', 0, 1, 0.01, 0.25, '', 'Rate of cliff retreat.'),
            sliderParameter('iterations', 'Steps', 1, 30, 1, 8, '', 'Coastal erosion steps.'),
            LITHOLOGY
        ],
        run(context, p, elevation, lith)
        {
            return runCoastal(elevation, context.n, context.dx, context.sea, p, lith.erodibility);
        }
    }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                 LITHOLOGY AND DISPATCH
//------------------------------------------------------------------------------------------------------------------------
export function erosionTypeById(id)
{
    return EROSION_TYPES.find((type) => type.id === id) || EROSION_TYPES[0];
}

export function erosionDefaults(id)
{
    return initialParameters(erosionTypeById(id).params);
}

// Hard beds erode at (1 - 0.85·contrast) and stand steeper by (1 + 2.5·contrast): caprock holds near-vertical canyon walls.
export function runErosion(context, layer, elevation)
{
    const type = erosionTypeById(layer.type);
    const params = clampParameters(type.params, layer.params);
    const contrast = clampNumber(params.litho, 0, 1);
    const count = context.n * context.n;
    const bedding = computeBedding(context.bedding, context.n, context.dx, elevation);
    const erodibility = createField(count);
    const talus = createField(count);
    for (let k = 0; k < count; k++)
    {
        erodibility[k] = 1 - 0.85 * contrast * bedding.hard[k];
        talus[k] = 1 + 2.5 * contrast * bedding.hard[k];
    }
    return type.run(context, params, elevation, { erodibility, talus, bedding });
}
