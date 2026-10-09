//============================================================================================================================================
//                                                          PRESETRENDERSEQUENCE.MJS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/scripts/PresetRenderSequence.mjs — Renders every preset to PNG (satmap, shaded relief) and two contact
//    sheets, with per-preset metrics and timings.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { buildTerrain } from '../src/engine/TerrainSequence.js';
import { createLayerIndex } from '../src/engine/LayerIndex.js';
import { PRESETS } from '../src/engine/PresetConfiguration.js';
import { renderView } from '../src/engine/SatmapProjection.js';
import { encodePng } from '../src/engine/PngCodec.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTPUT LOCATION
//------------------------------------------------------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.RENDER_DIR || resolve(here, '../../../Scratchpad/LandscapeEditor/renders');
const resolution = Number(process.env.RENDER_RES || 256);
const filter = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const deflate = (bytes) => deflateSync(bytes, { level: 6 });

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONTACT SHEET
//------------------------------------------------------------------------------------------------------------------------
function contactSheet(tiles, columns, tileSize, gutter)
{
    const rows = Math.ceil(tiles.length / columns);
    const width = columns * tileSize + (columns + 1) * gutter;
    const height = rows * tileSize + (rows + 1) * gutter;
    const out = new Uint8ClampedArray(width * height * 4);
    out.fill(16);
    for (let t = 0; t < tiles.length; t++)
    {
        const col = t % columns;
        const row = Math.floor(t / columns);
        const x0 = gutter + col * (tileSize + gutter);
        const y0 = gutter + row * (tileSize + gutter);
        const tile = tiles[t];
        const samples = tile.size;
        for (let y = 0; y < tileSize; y++)
        {
            for (let x = 0; x < tileSize; x++)
            {
                const sx = Math.floor((x / tileSize) * samples);
                const sy = Math.floor((y / tileSize) * samples);
                const from = (sy * samples + sx) * 4;
                const to = ((y0 + y) * width + (x0 + x)) * 4;
                out[to] = tile.rgba[from];
                out[to + 1] = tile.rgba[from + 1];
                out[to + 2] = tile.rgba[from + 2];
                out[to + 3] = 255;
            }
        }
    }
    return encodePng(width, height, out, deflate);
}

const summary = [];
const satmapTiles = [];
const shadedTiles = [];
for (const preset of PRESETS)
{
    if (filter.length && !filter.includes(preset.id))
    {
        continue;
    }
    const project = {
        settings: { ...preset.settings, resolution },
        heightLayers: preset.heightLayers,
        satmapLayers: preset.satmapLayers
    };
    const index = createLayerIndex(24);
    const started = performance.now();
    const result = buildTerrain(project, index);
    const elapsed = performance.now() - started;
    const satmap = renderView('satmap', result);
    const shaded = renderView('shaded', result);
    writeFileSync(resolve(outDir, `${preset.id}-satmap.png`), encodePng(resolution, resolution, satmap, deflate));
    writeFileSync(resolve(outDir, `${preset.id}-shaded.png`), encodePng(resolution, resolution, shaded, deflate));
    satmapTiles.push({ rgba: satmap, size: resolution });
    shadedTiles.push({ rgba: shaded, size: resolution });
    const m = result.metrics;
    summary.push({
        id: preset.id,
        elapsedMs: Math.round(elapsed),
        timings: Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, Math.round(v)])),
        minM: Math.round(m.minM),
        maxM: Math.round(m.maxM),
        reliefM: Math.round(m.reliefM),
        landFraction: Number(m.landFraction.toFixed(3)),
        meanSlopeDeg: Number(m.meanSlopeDeg.toFixed(1)),
        p95SlopeDeg: Number(m.p95SlopeDeg.toFixed(1)),
        channelKm: Number((m.channelLengthM / 1000).toFixed(2)),
        erodedMm3: Number((m.erodedM3 / 1e6).toFixed(1)),
        depositedMm3: Number((m.depositedM3 / 1e6).toFixed(1)),
        layers: result.log.map((entry) => `${entry.name}:${Math.round(entry.ms)}ms`)
    });
    console.log(`${preset.id.padEnd(18)} ${String(Math.round(elapsed)).padStart(6)} ms  relief ${String(Math.round(m.reliefM)).padStart(5)} m  slope95 ${m.p95SlopeDeg.toFixed(1).padStart(5)}°  river ${(m.channelLengthM / 1000).toFixed(1).padStart(6)} km`);
}

if (satmapTiles.length)
{
    const columns = Math.min(5, satmapTiles.length);
    writeFileSync(resolve(outDir, 'sheet-satmap.png'), contactSheet(satmapTiles, columns, 256, 8));
    writeFileSync(resolve(outDir, 'sheet-shaded.png'), contactSheet(shadedTiles, columns, 256, 8));
}
writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('wrote renders to', outDir);
