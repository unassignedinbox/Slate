// Runs the layer stack off the main thread. Requests carry an id so stale results can be dropped.
import { evaluate } from './engine/stack.js';

self.onmessage = (e) => {
  const { id, project } = e.data;
  try {
    const st = evaluate(project);
    const result = {
      N: st.N,
      h: st.h,
      albedo: st.albedo,
      water: st.water,
      maps: st.maps,
      stats: st.stats,
      range: st.range,
      histogram: st.histogram,
      view: st.view,
      view3D: st.view3D,
      timings: st.timings,
      seaLevel: st.seaLevel,
    };
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
