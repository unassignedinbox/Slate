//============================================================================================================================================
//                                                           COMPUTEHOST.WORKER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/ComputeHost.worker.js — Web Worker host: evaluates one landscape project through a shared layer
//    index and posts back the elevation, satmap and selected 2D view.

import { buildTerrain } from './TerrainSequence.js';
import { createLayerIndex } from './LayerIndex.js';
import { renderView } from './SatmapProjection.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    REQUEST HANDLING
//------------------------------------------------------------------------------------------------------------------------
// The index persists across requests, so unchanged layer prefixes are reused. Results are posted as copies: the index keeps references to the same arrays, so transferring them would detach the cache.
const layerIndex = createLayerIndex(24);

self.onmessage = (event) =>
{
    const { requestId, project, viewId } = event.data;
    try
    {
        const result = buildTerrain(project, layerIndex);
        const viewRgba = renderView(viewId || 'satmap', result);
        self.postMessage({
            type: 'result',
            requestId,
            viewId: viewId || 'satmap',
            n: result.n,
            dx: result.dx,
            sizeM: result.sizeM,
            settings: result.settings,
            elevation: result.elevation,
            satmapRgba: result.satmapRgba,
            viewRgba,
            metrics: result.metrics,
            log: result.log,
            timings: result.timings
        });
    }
    catch (error)
    {
        self.postMessage({ type: 'error', requestId, message: error && error.message ? error.message : String(error) });
    }
};
