// Generates presets/*.json — run: node scripts/make-presets.mjs (from Tools/SdfTerrainLab)
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Graph, makeNode } from '../js/core/graph.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'presets'), { recursive: true });

function link(g, a, ap, b, bp) {
  const r = g.connect(a.id, ap, b.id, bp);
  if (!r.ok) throw new Error('link failed: ' + r.error);
}
function node(g, type, x, y, params = {}) {
  const n = makeNode(type, x, y);
  Object.assign(n.params, params);
  g.addNode(n);
  return n;
}
// canyon centerline (must match sdf.js canyon node)
const canyonX = (z, meander = 9, phase = 0, bends = 1, cx = 0) =>
  cx + meander * (2.5 * Math.sin(0.15 * z + phase) + Math.sin(0.36 * z * bends + 1 + phase));

// ── 1. canyon: plateau + buttes − meandering canyon, river + lake + rain + thermal ──
{
  const g = new Graph();
  const out = node(g, 'output', 1180, 300);
  const disp = node(g, 'fbmDisplace', 940, 300, { amount: 1.8, feature: 16, octaves: 4, range: 12, seed: 3 });
  const sub = node(g, 'subtract', 720, 300);
  const cut = node(g, 'canyon', 720, 520, { centerX: 0, bedY: 4, width: 15, depth: 30, meander: 9, bends: 1, flare: 1.6, phase: 0 });
  const u2 = node(g, 'union', 500, 300);
  const u1 = node(g, 'union', 280, 300);
  const gr = node(g, 'ground', 60, 180, { level: 10, bottom: -6 });
  const m1 = node(g, 'mesa', 60, 420, { center: [52, 18, -30], radiusTop: 12, radiusBottom: 26, halfHeight: 15, mat: 0 });
  const m2 = node(g, 'mesa', 280, 520, { center: [-56, 15, 42], radiusTop: 9, radiusBottom: 20, halfHeight: 12, mat: 0 });
  link(g, gr, 'f', u1, 'a'); link(g, m1, 'f', u1, 'b');
  link(g, u1, 'f', u2, 'a'); link(g, m2, 'f', u2, 'b');
  link(g, u2, 'f', sub, 'a'); link(g, cut, 'f', sub, 'b');
  link(g, sub, 'f', disp, 'in'); link(g, disp, 'f', out, 'field');
  const pts = [];
  for (let z = -88; z <= 88; z += 14) pts.push({ x: +canyonX(z).toFixed(1), z });
  node(g, 'river', 940, 560, { enabled: true, rate: 700, discharge: 6, brush: 1.4, capacity: 1.4, width: 7, speed: 5, showWater: true, points: pts });
  node(g, 'rain', 1180, 560, { enabled: true, rate: 900, dropSize: 3, brush: 1.1, capacity: 1, erode: 1, deposit: 1, evap: 0.35, center: [0, 40, 0], size: [150, 20, 150] });
  node(g, 'thermal', 1180, 100, { enabled: true, talus: 34, rate: 1, every: 4, samples: 1500 });
  const lakeX = canyonX(92);
  node(g, 'lake', 720, 100, { enabled: true, level: 5.5, cx: +lakeX.toFixed(1), cz: 82, rx: 30, rz: 20, flow: 0.35, showWater: true });
  writeFileSync(join(root, 'presets', 'canyon.json'), JSON.stringify(g.toJSON(), null, 1));
  console.log('canyon.json', g.nodes.length, 'nodes');
}

// ── 2. coast: sea cliffs + real caves + arch, wind + rockfall + sea ──
{
  const g = new Graph();
  const out = node(g, 'output', 1180, 300);
  const sub = node(g, 'subtract', 940, 300);
  const caves = node(g, 'caves', 940, 540, { feature: 20, radius: 4, center: 0.05, warp: 6, yMin: 0, yMax: 12, worms: 3, seed: 21 });
  const disp = node(g, 'fbmDisplace', 700, 300, { amount: 2.2, feature: 14, octaves: 4, range: 12, seed: 8 });
  const u1 = node(g, 'union', 480, 300);
  const plat = node(g, 'plateau', 240, 180, { center: [-30, 0, -15], radius: 75, baseLow: -4, baseHigh: 24, cliffWidth: 10, feature: 30, edgeNoise: 16, bottom: -6, seed: 9 });
  const stack = node(g, 'cylinder', 240, 430, { center: [42, 8, 38], radius: 7, halfHeight: 12, round: 1.5, mat: 0 });
  const arch = node(g, 'torus', 480, 540, { center: [-8, 7, 52], major: 9, minor: 2.6, mat: 0 });
  link(g, plat, 'f', u1, 'a'); link(g, stack, 'f', u1, 'b');
  const u2 = node(g, 'union', 700, 120);
  link(g, u1, 'f', u2, 'a'); link(g, arch, 'f', u2, 'b');
  link(g, u2, 'f', disp, 'in'); link(g, disp, 'f', sub, 'a'); link(g, caves, 'f', sub, 'b');
  link(g, sub, 'f', out, 'field');
  node(g, 'rain', 1180, 540, { enabled: true, rate: 700, dropSize: 3, brush: 1.1, capacity: 1, erode: 1, deposit: 1, evap: 0.3, center: [-20, 40, -10], size: [170, 20, 170] });
  node(g, 'wind', 940, 100, { enabled: true, rate: 600, dir: 235, speed: 11, height: 16, band: 12, gust: 0.4, brush: 1, abrade: 0.8, capacity: 1 });
  node(g, 'rockfall', 1180, 100, { enabled: true, rate: 20, minSlope: 55, size: 260, restitution: 0.25, brush: 1.6 });
  node(g, 'lake', 700, 560, { enabled: true, level: 5.5, cx: 55, cz: 65, rx: 120, rz: 110, flow: 0.5, showWater: true });
  writeFileSync(join(root, 'presets', 'coast.json'), JSON.stringify(g.toJSON(), null, 1));
  console.log('coast.json', g.nodes.length, 'nodes');
}

// ── 3. dunes: sand sea + oasis, wind-driven ──
{
  const g = new Graph();
  const out = node(g, 'output', 900, 260);
  const warp = node(g, 'warp', 680, 260, { amount: 4, feature: 60 });
  const dunes = node(g, 'dunes', 460, 260, { base: 7, height: 6, wavelength: 26, sharpness: 1.6, windDir: 35, bottom: -6, seed: 5 });
  const gr = node(g, 'ground', 240, 260, { level: 4, bottom: -6 });
  const u = node(g, 'smoothUnion', 460, 60);
  link(g, gr, 'f', u, 'a'); link(g, dunes, 'f', u, 'b');
  link(g, u, 'f', warp, 'in'); link(g, warp, 'f', out, 'field');
  node(g, 'wind', 900, 60, { enabled: true, rate: 900, dir: 35, speed: 11, height: 14, band: 9, gust: 0.35, brush: 1, abrade: 0.9, capacity: 1.1 });
  node(g, 'rain', 680, 480, { enabled: true, rate: 120, dropSize: 2.5, brush: 1, capacity: 0.9, erode: 0.8, deposit: 1.2, evap: 0.8, center: [0, 40, 0], size: [170, 20, 170] });
  node(g, 'thermal', 900, 480, { enabled: true, talus: 32, rate: 1.2, every: 3, samples: 2000 });
  node(g, 'lake', 240, 480, { enabled: true, level: 5.6, cx: 30, cz: 40, rx: 15, rz: 10, flow: 0.15, showWater: true });
  writeFileSync(join(root, 'presets', 'dunes.json'), JSON.stringify(g.toJSON(), null, 1));
  console.log('dunes.json', g.nodes.length, 'nodes');
}

// ── 4. empty plot ──
{
  const g = new Graph();
  const out = node(g, 'output', 420, 60);
  const gr = node(g, 'ground', 120, 120, { level: 8, bottom: -6 });
  link(g, gr, 'f', out, 'field');
  writeFileSync(join(root, 'presets', 'empty.json'), JSON.stringify(g.toJSON(), null, 1));
  console.log('empty.json', g.nodes.length, 'nodes');
}
