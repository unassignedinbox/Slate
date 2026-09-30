/// <reference lib="webworker" />
// Panel baking is ~1-2 s per archetype; it runs off the main thread so the
// frame loop never hitches. In a shipping title this is an offline/cook step
// and the result is a shipped asset — here we do it at load to show the cost.
import { bakePanel, PANEL_PRESETS } from './panel';

self.onmessage = (e: MessageEvent<{ gauge: number; preset: 'blunt' | 'edge' }>) => {
  const g = e.data.gauge / 1000;
  const f = bakePanel(PANEL_PRESETS[e.data.preset](g));
  const payload = { grid: f.grid, size: f.size, frames: f.frames, depths: f.depths, ms: f.ms, data: f.data };
  (self as unknown as Worker).postMessage(payload, [payload.data.buffer]);
};
