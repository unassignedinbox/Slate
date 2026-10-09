//============================================================================================================================================
//                                                             TERRAINSEQUENCE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/TerrainSequence.js — Top-level evaluation of one landscape project: height stack, derived
//    surface attributes, satmap composition and summary metrics, with per-stage timings.

import { normalizeSettings } from './TerrainConfiguration.js';
import { buildElevation } from './LayerSequence.js';
import { deriveSurface } from './SurfaceSpace.js';
import { renderSatmap } from './SatmapSequence.js';
import { summarizeTerrain } from './TerrainMetrics.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                       EVALUATION
//------------------------------------------------------------------------------------------------------------------------
export function buildTerrain(project, index)
{
    const settings = normalizeSettings(project.settings);
    const n = settings.resolution;
    const dx = settings.sizeM / (n - 1);
    const sea = settings.seaLevelM;

    const heightStarted = performance.now();
    const height = buildElevation(settings, project.heightLayers || [], index);
    const heightMs = performance.now() - heightStarted;

    const context = {
        n,
        dx,
        sizeM: settings.sizeM,
        sea,
        seed: settings.seed,
        bedding: settings.bedding,
        riverKm2: settings.riverKm2,
        stylize: settings.stylize,
        sunAzimuthDeg: settings.sunAzimuthDeg,
        sunElevationDeg: settings.sunElevationDeg,
        protrusionRadiusM: Math.max(200, 0.06 * settings.sizeM)
    };

    const surfaceStarted = performance.now();
    const attrs = deriveSurface(height.elevation, { ...context, preErosion: height.preErosion, uplift: height.uplift });
    const surfaceMs = performance.now() - surfaceStarted;

    const satmapStarted = performance.now();
    const satmapRgba = renderSatmap(context, project.satmapLayers || [], height.elevation, attrs);
    const satmapMs = performance.now() - satmapStarted;

    const metrics = summarizeTerrain(height.elevation, attrs, { dx, sea });

    return {
        settings,
        n,
        dx,
        sizeM: settings.sizeM,
        elevation: height.elevation,
        attrs,
        satmapRgba,
        metrics,
        log: height.log,
        timings: { heightMs, surfaceMs, satmapMs, totalMs: heightMs + surfaceMs + satmapMs }
    };
}
