//============================================================================================================================================
// 📦 Editor/RoadEditor/Runtime/BakeWorker.js — The solver, off the main thread
//============================================================================================================================================
// A city bake is a second of pure maths; running it on the main thread would stutter the viewport and make editing feel laggy. The worker takes a
//    plain document and settings object and returns packed sectors, transferring the typed arrays so nothing is copied twice. It is stateless — the
//    document stays on the main thread — which is why an edit is always a full re-bake of the affected sectors rather than an incremental patch.
'use strict';

import { buildWorld, DEFAULTS } from '../Kernel/SkinSolver.js';

self.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type !== 'bake') return;
    let result;
    try {
        const t0 = performance.now();
        result = buildWorld(msg.doc, { ...DEFAULTS, ...(msg.settings || {}) });
        result.stats.workerMs = Math.round(performance.now() - t0);
    } catch (err) {
        // The reply has to carry the revision even on failure, or the client waits forever for a bake that already died.
        self.postMessage({ type: 'error', revision: msg.revision, message: String((err && err.stack) || err) });
        return;
    }
    const transfer = [];
    for (const s of result.sectors) {
        for (const key of ['pos', 'st', 'dist', 'misc', 'mark', 'bump', 'idx']) if (s[key] && s[key].buffer) transfer.push(s[key].buffer);
    }
    const props = result.props;
    if (props && props.types) for (const t of props.types) for (const c of t.cells) if (c.data && c.data.buffer) transfer.push(c.data.buffer);
    self.postMessage({
        type: 'bake',
        revision: msg.revision,
        sectors: result.sectors,
        props: props || null,
        stats: { ...result.stats, propInstances: result.propStats ? result.propStats.propInstances : 0, propRoads: result.propStats ? result.propStats.propRoads : 0 },
    }, transfer);
};
