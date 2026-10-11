// Road geometry: ribbons, curbs, paving, markings, bridges along a polyline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials } from './materials.js';
import { getTextures } from './textures.js';
import { BAND, TRAVEL, layoutBands, markingBoundaries, profileWidth, PROFILES } from './profiles.js';
import { buildBridgePieces } from './bridges.js';

const EPS = 0.004;

/** Resample a polyline (or Catmull-Rom for 3+ points) into arc-length samples. */
export function samplePolyline(points, step = 2) {
  let pts = points.map((p) => new THREE.Vector3(p.x, p.y ?? 0, p.z));
  let curve = null;
  if (pts.length >= 3) {
    curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const total = curve.getLength();
    const n = Math.max(8, Math.ceil(total / step));
    pts = [];
    for (let i = 0; i <= n; i++) pts.push(curve.getPoint(i / n));
  }
  const samples = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    if (t.lengthSq() < 1e-9) t.set(1, 0, 0);
    t.normalize();
    if (i > 0) s += p.distanceTo(pts[i - 1]);
    samples.push({
      x: p.x,
      y: p.y,
      z: p.z,
      tx: t.x,
      tz: t.z,
      s,
      // right-hand normal in XZ (right = forward x up)
      nx: -t.z,
      nz: t.x,
    });
  }
  return samples;
}

export function polylineSampleLength(samples) {
  return samples.length ? samples[samples.length - 1].s : 0;
}

/**
 * Ribbon strip between lateral offsets x0..x1 along the samples, at height y.
 * opts: { vScale, yFn(i, t) -> extra height, flip }
 */
export function ribbonGeometry(samples, x0, x1, y, opts = {}) {
  const vScale = opts.vScale ?? 0.12;
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  // yAcross: [leftHeight, rightHeight] for sloped strips (mountable curbs)
  const [yL, yR] = opts.yAcross || [y, y];
  for (let i = 0; i < n; i++) {
    const sm = samples[i];
    const extra = opts.yFn ? opts.yFn(i, i / (n - 1)) : 0;
    const lx = sm.x + sm.nx * x0;
    const lz = sm.z + sm.nz * x0;
    const rx = sm.x + sm.nx * x1;
    const rz = sm.z + sm.nz * x1;
    pos.set([lx, sm.y + yL + extra, lz, rx, sm.y + yR + extra, rz], i * 6);
    uv.set([0, sm.s * vScale, 1, sm.s * vScale], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical strip geometry at offset x, heights y0->y1 (double-sided plane). */
export function wallGeometry(samples, x, y0, y1) {
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const sm = samples[i];
    const px = sm.x + sm.nx * x;
    const pz = sm.z + sm.nz * x;
    pos.set([px, sm.y + y0, pz, px, sm.y + y1, pz], i * 6);
    uv.set([0, sm.s * 0.1, 1, sm.s * 0.1], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Thin painted strip between offsets x0..x1 over an arclength window. */
function paintStrip(samples, x0, x1, y, s0, s1) {
  const sub = samples.filter((sm) => sm.s >= s0 - 0.01 && sm.s <= s1 + 0.01);
  if (sub.length < 2) return null;
  return ribbonGeometry(sub, x0, x1, y, { vScale: 0.02 });
}

/** Dashed paint along an offset: 3 m mark, 6 m gap. */
function dashPaint(samples, x, y, width = 0.12, mark = 3, gap = 6, phase = 0) {
  const geos = [];
  const total = polylineSampleLength(samples);
  for (let s0 = phase; s0 < total - mark; s0 += mark + gap) {
    const g = paintStrip(samples, x - width / 2, x + width / 2, y, s0, s0 + mark);
    if (g) geos.push(g);
  }
  return geos;
}

/** Symbol quad (arrow / bike / BUS) on the road surface. */
export function symbolQuad(samples, s, x, size, matName, flip = false) {
  // find frame at arclength s
  let sm = samples[0];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].s >= s) {
      sm = samples[i];
      break;
    }
    sm = samples[i];
  }
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  if (flip) g.rotateY(Math.PI);
  g.translate(sm.x + sm.nx * x, sm.y + EPS * 4, sm.z + sm.nz * x);
  return { geo: g, mat: matName };
}

function mergeInto(buckets, matName, geos) {
  const list = geos.filter(Boolean);
  if (!list.length) return;
  if (!buckets.has(matName)) buckets.set(matName, []);
  buckets.get(matName).push(...list);
}

function finishGroup(buckets, materials, group, name) {
  for (const [matName, geos] of buckets) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[matName] || materials.concrete);
    mesh.name = `${name}:${matName}`;
    mesh.castShadow = matName !== 'paintWhite' && matName !== 'paintYellow';
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
}


const CURB_REVEAL = { barrier: 0.16, rounded: 0.16, stone: 0.22, mountable: 0.09 };

/**
 * Proper curb assembly for one curb band:
 * gutter pan -> curb face -> curb top (rounded/stone variants) -> back.
 */
function addCurbGeometry(buckets, samples, b, style) {
  const reveal = CURB_REVEAL[style] ?? 0.16;
  const inner = b.center < 0 ? b.x1 : b.x0; // edge facing the roadway
  const outer = b.center < 0 ? b.x0 : b.x1;
  const inward = b.center < 0 ? 1 : -1; // direction toward road centre

  if (style === 'mountable') {
    // low sloped mountable kerb: ramp up from the roadway to the walk
    const yAcross = b.center < 0 ? [reveal, 0] : [0, reveal];
    mergeInto(buckets, 'concrete', [
      ribbonGeometry(samples, b.x0, b.x1, 0, { vScale: 0.25, yAcross }),
      wallGeometry(samples, outer, 0, reveal),
    ]);
    return;
  }

  // gutter pan (asphalt, cross-falls toward the kerb face)
  const gutterW = 0.42;
  mergeInto(buckets, 'asphalt', [
    ribbonGeometry(samples, inner, inner + inward * gutterW, 0, {
      vScale: 0.12,
      yAcross: b.center < 0 ? [0, 0.02] : [0.02, 0],
    }),
  ]);

  // curb face (the reveal)
  mergeInto(buckets, style === 'stone' ? 'curbStone' : 'concrete', [
    wallGeometry(samples, inner, 0, reveal),
    ribbonGeometry(samples, b.x0, b.x1, reveal, { vScale: 0.3 }),
  ]);

  if (style === 'rounded') {
    // chamfered top edge on the roadway side
    const topW = b.w;
    mergeInto(buckets, 'concrete', [
      ribbonGeometry(samples, inner, inner + inward * 0.06, reveal - 0.055, {
        vScale: 0.3,
        yAcross: b.center < 0 ? [reveal - 0.055, reveal] : [reveal, reveal - 0.055],
      }),
    ]);
    void topW;
  } else if (style === 'stone') {
    // granite kerb: darker face strip + proud top stone
    mergeInto(buckets, 'curbStone', [
      ribbonGeometry(samples, inner - inward * 0.02, inner + inward * 0.06, reveal + 0.035, {
        vScale: 0.3,
        yAcross: b.center < 0 ? [reveal + 0.035, reveal] : [reveal, reveal + 0.035],
      }),
    ]);
  } else {
    // barrier kerb: slight overhanging lip on the roadway side
    mergeInto(buckets, 'concrete', [
      ribbonGeometry(samples, inner, inner + inward * 0.05, reveal + 0.012, { vScale: 0.3 }),
    ]);
  }
}

/**
 * Build the full mesh for one road segment.
 * Returns a THREE.Group whose bounding box works as a pick proxy source.
 */
export function buildSegment(segment) {
  const M = getMaterials();
  const T = getTextures();
  const profile = PROFILES[segment.profile] || PROFILES.street;
  const ov = segment.overrides || {};
  const group = new THREE.Group();
  group.name = segment.name || segment.id;
  group.userData = { objectId: segment.id, kind: 'segment' };

  const samples = samplePolyline(segment.points, 2.2);
  if (samples.length < 2) return group;
  const total = polylineSampleLength(samples);
  const layout = layoutBands(profile);
  const half = profileWidth(profile) / 2;
  const buckets = new Map();
  const showMarkings = ov.markings !== false;
  const showCurbs = ov.curbs !== false;
  const isBridge = !!segment.bridge;
  const sidewalkY = CURB_REVEAL[ov.curbStyle || profile.curbStyle || 'barrier'] ?? 0.16;

  // ---- proper bridge structures (girder / arch / cable / truss) ----
  if (isBridge) {
    const spec = typeof segment.bridge === 'object' ? segment.bridge : {};
    const btype = segment.bridgeType || spec.type || 'girder';
    const pieces = buildBridgePieces(samples, half, {
      type: btype,
      railing: spec.railing || (segment.overrides || {}).bridgeRailing || 'steel',
    });
    for (const [key, geos] of Object.entries(pieces)) {
      mergeInto(buckets, key, geos);
    }
  }

  // ---- surface bands ----
  for (const b of layout) {
    const def = BAND[b.t];
    const y = (def.y ?? 0) + EPS * 2;
    if (b.t === 'curb' || b.t === 'mountable') {
      if (!showCurbs) continue;
      const style = b.t === 'mountable' ? 'mountable' : (ov.curbStyle || profile.curbStyle || 'barrier');
      if (style === 'none') continue;
      addCurbGeometry(buckets, samples, b, style);
    } else if (b.t === 'sidewalk') {
      if (ov.sidewalks === false) continue;
      const reveal = CURB_REVEAL[ov.curbStyle || profile.curbStyle || 'barrier'] ?? 0.16;
      // sidewalk runs from the kerb back, rising 2% away from the road
      const away = b.center < 0 ? -1 : 1;
      mergeInto(buckets, 'paving', [
        ribbonGeometry(samples, b.x0, b.x1, reveal, {
          vScale: 0.18,
          yAcross: away < 0 ? [0.025, 0] : [0, 0.025],
        }),
      ]);
    } else if (b.t === 'grass' || b.t === 'verge' || b.t === 'median') {
      mergeInto(buckets, 'grass', [ribbonGeometry(samples, b.x0, b.x1, 0.1 + EPS, { vScale: 0.09 })]);
    } else if (b.t === 'tram') {
      mergeInto(buckets, 'ballast', [ribbonGeometry(samples, b.x0, b.x1, -0.02, { vScale: 0.2 })]);
      const rails = [];
      const sleepers = [];
      for (const off of [-0.72, 0.72]) {
        rails.push(ribbonGeometry(samples, b.center + off - 0.035, b.center + off + 0.035, 0.1, { vScale: 0.5 }));
        rails.push(wallGeometry(samples, b.center + off - 0.035, 0, 0.1));
        rails.push(wallGeometry(samples, b.center + off + 0.035, 0, 0.1));
      }
      for (let s = 0; s < total; s += 0.72) {
        const sm = sampleAt(samples, s);
        const sl = new THREE.BoxGeometry(b.w * 0.92, 0.12, 0.24);
        sl.translate(sm.x, sm.y + 0.02, sm.z);
        sl.rotateY(Math.atan2(sm.tx, sm.tz));
        sleepers.push(sl);
      }
      mergeInto(buckets, 'railSteel', rails);
      mergeInto(buckets, 'sleeper', sleepers);
    } else if (b.t === 'shoulder') {
      mergeInto(buckets, 'asphalt', [ribbonGeometry(samples, b.x0, b.x1, y, { vScale: 0.12 })]);
    } else {
      // drive / bus / cycle / parking
      const mat = b.t === 'bus' ? 'asphaltBus' : b.t === 'cycle' ? 'asphaltCycle' : 'asphalt';
      mergeInto(buckets, mat, [ribbonGeometry(samples, b.x0, b.x1, y, { vScale: 0.12 })]);
    }
  }

  // ---- markings ----
  if (showMarkings && !profile.pedestrian) {
    const y = EPS * 6;
    const bounds = markingBoundaries(profile, layout);
    for (const mk of bounds) {
      if (mk.style === 'center-double') {
        mergeInto(buckets, 'paintYellow', [
          paintStrip(samples, mk.x - 0.24, mk.x - 0.1, y, 0, total),
          paintStrip(samples, mk.x + 0.1, mk.x + 0.24, y, 0, total),
        ]);
      } else if (mk.style === 'center-single') {
        mergeInto(buckets, 'paintYellow', [paintStrip(samples, mk.x - 0.07, mk.x + 0.07, y, 0, total)]);
      } else if (mk.style === 'center-dashed') {
        mergeInto(buckets, 'paintWhite', dashPaint(samples, mk.x, y, 0.13, 3, 5));
      } else if (mk.style === 'solid') {
        const mat = mk.yellow ? 'paintYellow' : 'paintWhite';
        mergeInto(buckets, mat, [paintStrip(samples, mk.x - 0.07, mk.x + 0.07, y, 0, total)]);
      } else if (mk.style === 'dash') {
        mergeInto(buckets, 'paintWhite', dashPaint(samples, mk.x, y, 0.11, 2.4, 5.2));
      }
    }

    // parking bay ticks + lane symbols
    for (const b of layout) {
      if (b.t === 'parking') {
        const ticks = [];
        for (let s = 2; s < total - 1; s += 6.2) {
          const g = paintStrip(samples, b.x0 + 0.15, b.x1 - 0.15, y, s, s + 0.1);
          if (g) ticks.push(g);
        }
        mergeInto(buckets, 'paintWhite', ticks);
      }
      if (b.t === 'cycle') {
        for (let s = 6; s < total - 4; s += 28) {
          const q = symbolQuad(samples, s, b.center, Math.min(2.2, b.w * 0.9), 'symbolBike', b.dir < 0);
          mergeInto(buckets, 'symbolBike', [q.geo]);
        }
      }
      if (b.t === 'bus') {
        for (let s = 8; s < total - 5; s += 36) {
          const q = symbolQuad(samples, s, b.center, Math.min(2.8, b.w * 0.8), 'symbolBus', b.dir < 0);
          mergeInto(buckets, 'symbolBus', [q.geo]);
        }
      }
      if (b.t === 'drive') {
        // turn arrows near each end
        for (const s of [6, total - 6]) {
          if (total < 26) break;
          const kind = s < total / 2 ? 'symbolArrow' : 'symbolArrow';
          const q = symbolQuad(samples, s, b.center, 2.6, kind, b.dir < 0);
          mergeInto(buckets, kind, [q.geo]);
        }
      }
    }

    // zebra crosswalks near junction ends
    if (profile.markings.crosswalk && segment.junctions) {
      const crossXs = [];
      if (segment.junctions.start) crossXs.push(Math.min(6.5, total * 0.2));
      if (segment.junctions.end) crossXs.push(Math.max(total - 6.5, total * 0.8));
      for (const sCenter of crossXs) {
        const stripes = [];
        const roadLeft = layout.find((b) => b.t === 'curb' || b.t === 'mountable')?.x1 ?? -half;
        const roadRight = layout.slice().reverse().find((b) => b.t === 'curb' || b.t === 'mountable')?.x0 ?? half;
        const x0 = roadLeft + 0.35;
        const x1 = roadRight - 0.35;
        const width = 0.58;
        const gap = 0.62;
        let i = 0;
        for (let x = x0; x < x1 - width; x += width + gap, i++) {
          const g = paintStrip(samples, x, x + width, EPS * 6, sCenter - 1.7, sCenter + 1.7);
          if (g) stripes.push(g);
        }
        mergeInto(buckets, 'paintWhite', stripes);
      }
    }
  }

  // ---- central barrier (motorway) ----
  if (profile.markings.center === 'barrier') {
    mergeInto(buckets, 'concrete', [
      ribbonGeometry(samples, -0.32, 0.32, 0.82, { vScale: 0.2 }),
      wallGeometry(samples, -0.32, 0, 0.82),
      wallGeometry(samples, 0.32, 0, 0.82),
    ]);
  }

  finishGroup(buckets, M, group, segment.id);
  return group;
}

/** Frame sample at an exact arclength. */
export function sampleAt(samples, s) {
  if (!samples.length) return { x: 0, y: 0, z: 0, tx: 1, tz: 0, nx: 0, nz: 1 };
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].s >= s) {
      const a = samples[i - 1];
      const b = samples[i];
      const t = b.s - a.s < 1e-6 ? 0 : (s - a.s) / (b.s - a.s);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t;
      const tx = a.tx + (b.tx - a.tx) * t;
      const tz = a.tz + (b.tz - a.tz) * t;
      const len = Math.hypot(tx, tz) || 1;
      return { x, y, z, tx: tx / len, tz: tz / len, nx: -tz / len, nz: tx / len, s };
    }
  }
  const last = samples[samples.length - 1];
  return { ...last, s };
}

/**
 * Junction pad: asphalt square with zebra approaches on each arm.
 * arms: [{x, z, angle}] where angle is the arm direction (radians).
 */
export function buildJunction(x, z, size, arms = [], opts = {}) {
  const M = getMaterials();
  const group = new THREE.Group();
  const buckets = new Map();
  const half = size / 2;
  const pad = new THREE.BoxGeometry(size, 0.12, size);
  pad.translate(x, 0.05, z);
  mergeInto(buckets, 'asphalt', [pad]);

  // zebra stripes on each arm
  const stripes = [];
  for (const arm of arms) {
    const dirX = Math.cos(arm.angle);
    const dirZ = Math.sin(arm.angle);
    const px = -dirZ;
    const pz = dirX;
    const armLen = half + 1.2;
    const across = size * 0.42;
    for (let t = -across; t < across - 0.5; t += 1.15) {
      const cx = x + dirX * (armLen - 1.1) + px * t;
      const cz = z + dirZ * (armLen - 1.1) + pz * t;
      const stripe = new THREE.BoxGeometry(0.62, 0.02, 2.3);
      stripe.rotateY(-arm.angle + Math.PI / 2);
      stripe.translate(cx, 0.125, cz);
      stripes.push(stripe);
    }
  }
  mergeInto(buckets, 'paintWhite', stripes);
  finishGroup(buckets, M, group, opts.name || 'junction');
  group.userData = { kind: 'junction' };
  return group;
}

/** Standalone crosswalk slab helper (used on bridges / custom spots). */
export function buildCrosswalkStrip(x, z, angle, width, opts = {}) {
  const M = getMaterials();
  const group = new THREE.Group();
  const stripes = [];
  const n = Math.floor(width / 1.15);
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * 1.15;
    const px = -Math.sin(angle);
    const pz = Math.cos(angle);
    const stripe = new THREE.BoxGeometry(0.62, 0.02, 2.3);
    stripe.rotateY(-angle + Math.PI / 2);
    stripe.translate(x + px * t, 0.125 + (opts.y ?? 0), z + pz * t);
    stripes.push(stripe);
  }
  const buckets = new Map();
  mergeInto(buckets, 'paintWhite', stripes);
  finishGroup(buckets, M, group, 'crosswalk');
  return group;
}
