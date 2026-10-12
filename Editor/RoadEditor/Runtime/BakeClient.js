//============================================================================================================================================
// 📦 Editor/RoadEditor/Runtime/BakeClient.js — Debounced, coalesced, worker-backed bakes with a synchronous fallback
//============================================================================================================================================
// Editing a road should feel instant even though the bake costs a second: requests are debounced, an in-flight bake is never duplicated — the newest
//    revision simply queues behind it — and the result is applied by revision so a stale worker answer can never overwrite a newer one. If Workers are
//    unavailable (a restricted host, a test runner, a file:// open) the same call runs inline and the editor keeps working, just less smoothly.
'use strict';

import { buildWorld, DEFAULTS } from '../Kernel/SkinSolver.js';

export class BakeClient {
    /** @param {object} app {doc, viewport, chrome} @param {{WorkerCtor?:Function}} opts */
    constructor(app, { WorkerCtor } = {}) {
        this.app = app;
        this.revision = 0;
        this.pending = null;
        this.busy = false;
        this.worker = null;
        this.workerFailed = false;
        this.debounce = 140;
        this.onProgress = null;
        if (WorkerCtor && typeof Worker !== 'undefined') {
            try {
                // A `?worker` import gives Vite's own constructor, so the kernel inside the worker shares the page's module graph and its chunk hash.
                this.worker = new WorkerCtor();
                this.worker.onmessage = (e) => this._receive(e.data);
                this.worker.onerror = (e) => { e.preventDefault?.(); this._fallback('worker error'); };
            } catch (err) {
                this.worker = null;
                this.workerFailed = true;
            }
        } else {
            this.workerFailed = true;
        }
    }
    _fallback(why) {
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        this.workerFailed = true;
        this.app.chrome?.notify?.('baking inline (' + why + ')', 'warn');
        this.request(true);
    }
    /** @param {boolean} immediate skip the debounce */
    request(immediate) {
        const rev = ++this.revision;
        this.pending = rev;
        clearTimeout(this._t);
        const go = () => {
            if (this.busy) return;                     // [-] the finisher will restart with the newest revision
            const doc = this.app.doc.forBake();
            const settings = { ...DEFAULTS, ...this.app.settings };
            this.busy = true;
            this.app.chrome?.progressTo?.(0.05, 'baking…');
            this.onProgress?.(true);
            if (this.workerFailed) {
                const t0 = performance.now();
                let out;
                try { out = buildWorld(doc, settings); } catch (err) { this._fail(err); return; }
                out.stats.workerMs = Math.round(performance.now() - t0);
                this._receive({ type: 'bake', revision: rev, sectors: out.sectors, props: out.props, stats: { ...out.stats, propInstances: out.propStats ? out.propStats.propInstances : 0 } });
                return;
            }
            try {
                this.worker.postMessage({ type: 'bake', doc, settings, revision: rev });
            } catch (err) {
                this._fallback('postMessage: ' + err.message);
            }
        };
        if (immediate) go(); else this._t = setTimeout(go, this.debounce);
        return rev;
    }
    _fail(err) {
        this.busy = false;
        this.onProgress?.(false);
        this.app.chrome?.notify?.('bake failed: ' + (err && err.message ? err.message : err), 'err');
        this.app.chrome?.progressTo?.(0, 'failed');
        console.error('[bake]', err);
    }
    _receive(msg) {
        if (!msg || msg.type === 'error') { this._fail(new Error(msg && msg.message || 'worker error')); return; }
        if (msg.revision < this.pending) {                 // [-] newer edits queued while this was in flight
            this.busy = false;
            this.onProgress?.(false);
            this.request(true);
            return;
        }
        let stats;
        try {
            stats = this.app.viewport.applyBake(msg);
        } catch (err) {
            this._fail(err);
            return;
        }
        this.app.lastStats = msg.stats;
        this.busy = false;
        this.onProgress?.(false);
        this.app.chrome?.progressTo?.(1, `${msg.stats.roads} roads · ${msg.stats.km.toFixed(1)} km · ${(msg.stats.tris / 1000).toFixed(0)}k tris · ${msg.stats.ms} ms`);
        setTimeout(() => this.app.chrome?.progressTo?.(0, ''), 900);
        if (this.pending > msg.revision) this.request(true);
        else this.app.chrome?.sync?.();
        void stats;
    }
    dispose() { if (this.worker) this.worker.terminate(); }
}
