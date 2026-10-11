// Builds the road scene off the main thread so the UI stays responsive while editing.
import { buildScene } from '../engine/roadGeometry.js';

self.onmessage = (e) => {
  const { id, doc } = e.data;
  try {
    const t0 = performance.now();
    const scene = buildScene(doc);
    scene.stats.buildMs = Math.round(performance.now() - t0);
    const data = scene.data;
    self.postMessage({ id, ok: true, data, stats: scene.stats, paths: scene.paths }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack ? err.stack : err) });
  }
};
