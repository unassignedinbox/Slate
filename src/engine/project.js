// Project model, presets, (de)serialisation of painted masks and imported heightmaps.
import { NODES, defaultParams } from './registry.js';
import { DEFAULT_BLEND } from './stack.js';

let nextId = 1;
export const newLayerId = () => `L${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function makeLayer(nodeId, extra = {}) {
  const node = NODES[nodeId];
  return {
    id: newLayerId(),
    nodeId,
    enabled: true,
    params: defaultParams(node),
    blend: node.mode === 'combine' ? nodeId : DEFAULT_BLEND,
    opacity: 1,
    mask: { type: null, params: {}, invert: false, contrast: 1, feather: 0 },
    ...extra,
  };
}

export function newProject(N = 256) {
  return { version: 1, name: 'Untitled', N, seed: 1, heightScale: 1, layers: [] };
}

// Starter stack: a broad mountain massif, erosion, rivers, a lake and a coastline.
export function starterProject(N = 256) {
  const p = newProject(N);
  p.name = 'Starter: mountain + river valley';
  const L = (id, params = {}, extra = {}) => makeLayer(id, { params: { ...defaultParams(NODES[id]), ...params }, ...extra });
  p.layers = [
    L(15, { scale: 3, octaves: 6, seed: 2 }, { blend: 136, opacity: 0.45 }),
    L(37, { centerX: 0.4, centerY: 0.4, radius: 0.35, seed: 4 }, { blend: 133, opacity: 0.8 }),
    L(53, { iterations: 30000 }),
    L(42, {}),
    L(58, { talus: 0.02, rate: 0.4, iterations: 20 }),
    L(87, { threshold: 0.02, depth: 0.04 }),
    L(89, { level: 0.08, shelf: 0.03 }),
    L(108, { inLow: 0, inHigh: 1, gamma: 1.2 }),
    L(179, { palette: 'earth' }, { blend: 136 }),
    L(203, {}),
  ];
  return p;
}
export function encodeFloat32(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeFloat32(b64) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
// Convert in-memory layers (typed arrays) to JSON-safe objects and back.
export function serialize(project) {
  return JSON.stringify({
    ...project,
    layers: project.layers.map((l) => {
      const o = { ...l };
      if (l.imported) o.imported = { N: l.imported.N, b64: encodeFloat32(l.imported.data) };
      if (l.mask && l.mask.painted) o.mask = { ...l.mask, painted: { N: l.mask.painted.N, b64: encodeFloat32(l.mask.painted.data) } };
      return o;
    }),
  }, null, 2);
}
export function deserialize(text) {
  const p = JSON.parse(text);
  p.layers = p.layers.map((l) => {
    const o = { ...l };
    if (l.imported) o.imported = { N: l.imported.N, data: decodeFloat32(l.imported.b64) };
    if (l.mask && l.mask.painted) o.mask = { ...l.mask, painted: { N: l.mask.painted.N, data: decodeFloat32(l.mask.painted.b64) } };
    return o;
  });
  return p;
}
