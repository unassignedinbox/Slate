//============================================================================================================================================
//                                                             TERRAINSEQUENCE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/TerrainSequence.js — Top-level evaluation of one landscape project: height stack, derived
//    surface attributes, satmap composition and summary metrics, with per-stage timings.

import { createField, diffuseField, clampNumber } from './HeightSpace.js';
import { normalizeSettings } from './TerrainConfiguration.js';
import { buildElevation } from './LayerSequence.js';
import { deriveSurface } from './SurfaceSpace.js';
import { renderSatmap } from './SatmapSequence.js';
import { summarizeTerrain } from './TerrainMetrics.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                       EVALUATION
//------------------------------------------------------------------------------------------------------------------------
// Light isotropic diffusion after the height stack. Each pass is a 0.2 creep step, so the surface loses cell-scale
// roughness from stream-power and droplet stages while the landforms keep their shape. Mass is conserved.
function smoothSurface(elevation, n, smoothing)
{
    const passes = Math.round(clampNumber(smoothing, 0, 1) * 10);
    if (passes === 0)
    {
        return elevation;
    }
    const creep = createField(n * n, 0.2);
    let out = elevation;
    for (let pass = 0; pass < passes; pass++)
    {
        out = diffuseField(out, n, creep);
    }
    return out;
}

export function buildTerrain(project, index)
{
    const settings = normalizeSettings(project.settings);
    const n = settings.resolution;
    const dx = settings.sizeM / (n - 1);
    const sea = settings.seaLevelM;

    const heightStarted = performance.now();
    const height = buildElevation(settings, project.heightLayers || [], index);
    const heightMs = performance.now() - heightStarted;
    const elevation = smoothSurface(height.elevation, n, settings.smoothing);

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
    const attrs = deriveSurface(elevation, { ...context, preErosion: height.preErosion, uplift: height.uplift });
    const surfaceMs = performance.now() - surfaceStarted;

    const satmapStarted = performance.now();
    const satmapRgba = renderSatmap(context, project.satmapLayers || [], elevation, attrs);
    const satmapMs = performance.now() - satmapStarted;

    const metrics = summarizeTerrain(elevation, attrs, { dx, sea, exportedM3: height.exportedM3 });

    return {
        settings,
        n,
        dx,
        sizeM: settings.sizeM,
        elevation,
        attrs,
        satmapRgba,
        metrics,
        log: height.log,
        timings: { heightMs, surfaceMs, satmapMs, totalMs: heightMs + surfaceMs + satmapMs }
    };
}
