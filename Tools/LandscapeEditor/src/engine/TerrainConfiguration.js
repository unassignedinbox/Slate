//============================================================================================================================================
//                                                          TERRAINCONFIGURATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/TerrainConfiguration.js — Terrain-wide settings: resolution, world size, sea datum, seed,
//    snowline, sun, river threshold, satmap stylisation and bedding, with schemas and normalisation.

import { sliderParameter, choiceParameter, clampParameters } from './ParameterSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        DEFAULTS
//------------------------------------------------------------------------------------------------------------------------
export const RESOLUTIONS = [128, 192, 256, 384, 512];

export const DEFAULT_BEDDING = {
    thicknessM: 60,
    dipDeg: 2,
    dipDirDeg: 35,
    hardFraction: 0.4,
    warpM: 12
};

export const DEFAULT_SETTINGS = {
    name: 'Untitled landscape',
    resolution: 256,
    sizeM: 4000,
    seaLevelM: 0,
    seed: 1729,
    snowlineM: 2200,
    sunAzimuthDeg: 135,
    sunElevationDeg: 38,
    riverKm2: 0.25,
    stylize: 0.35,
    bedding: DEFAULT_BEDDING
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        SCHEMAS
//------------------------------------------------------------------------------------------------------------------------
export const WORLD_SCHEMA = [
    choiceParameter('resolution', 'Resolution', RESOLUTIONS.map((size) => ({ id: size, label: `${size} × ${size}` })), 256, 'Grid cells per side. Higher is slower to compute.'),
    sliderParameter('sizeM', 'Map width', 1000, 20000, 50, 4000, 'm', 'Width of the square map in metres.'),
    sliderParameter('seaLevelM', 'Sea level', -500, 800, 5, 0, 'm', 'Datum. Cells below this are water.'),
    sliderParameter('seed', 'Seed', 0, 99999, 1, 1729, '', 'Changes every generator at once.'),
    sliderParameter('snowlineM', 'Snowline', 0, 5000, 10, 2200, 'm', 'Used by the snow driver and as the default glacial snowline.'),
    sliderParameter('sunAzimuthDeg', 'Sun azimuth', 0, 360, 1, 135, '°', 'Bearing of the sun, 0 = north, clockwise.'),
    sliderParameter('sunElevationDeg', 'Sun elevation', 5, 85, 1, 38, '°', 'Height of the sun above the horizon.'),
    sliderParameter('riverKm2', 'River threshold', 0.02, 5, 0.01, 0.25, 'km²', 'Catchment area that becomes a visible channel.'),
    sliderParameter('stylize', 'Stylisation', 0, 1, 0.01, 0.35, '', 'Saturation and contrast of the satmap. 0 is literal.')
];

export const BEDDING_SCHEMA = [
    sliderParameter('thicknessM', 'Bed period', 10, 400, 5, 60, 'm', 'Vertical thickness of one hard-and-soft bed cycle.'),
    sliderParameter('dipDeg', 'Dip', 0, 30, 0.5, 2, '°', 'Tilt of the beds.'),
    sliderParameter('dipDirDeg', 'Dip direction', 0, 360, 1, 35, '°', 'Direction the beds descend towards.'),
    sliderParameter('hardFraction', 'Caprock share', 0.05, 0.95, 0.01, 0.4, '', 'Share of each cycle that is hard caprock.'),
    sliderParameter('warpM', 'Bed waviness', 0, 200, 1, 12, 'm', 'Undulation of the bedding planes.')
];

//------------------------------------------------------------------------------------------------------------------------
//                                                     NORMALIZATION
//------------------------------------------------------------------------------------------------------------------------
export function normalizeSettings(input)
{
    const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };
    const clean = clampParameters(WORLD_SCHEMA, merged);
    clean.name = String(merged.name || DEFAULT_SETTINGS.name).slice(0, 60);
    clean.riverKm2 = clampParameters(WORLD_SCHEMA, merged).riverKm2;
    clean.bedding = clampParameters(BEDDING_SCHEMA, { ...DEFAULT_BEDDING, ...(input && input.bedding ? input.bedding : {}) });
    clean.resolution = Number(clean.resolution);
    return clean;
}
