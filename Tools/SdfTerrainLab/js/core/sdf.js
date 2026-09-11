// SDF primitives, combinators and the field-graph → voxel compiler.
// Convention: inside solid d < 0, surface d = 0, air d > 0. Y-up, meters.
import { makeNoise } from './noise.js';

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── primitives (all take (x,y,z,p), p = params object) ──
export const Prim = {
  ground(x, y, z, p) { // infinite slab: top at p.level, bottom at p.bottom
    const top = y - p.level, bot = p.bottom - y;
    return Math.max(top, bot);
  },
  box(x, y, z, p) {
    const qx = Math.abs(x - p.center[0]) - p.size[0] * 0.5;
    const qy = Math.abs(y - p.center[1]) - p.size[1] * 0.5;
    const qz = Math.abs(z - p.center[2]) - p.size[2] * 0.5;
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0), az = Math.max(qz, 0);
    return Math.hypot(ax, ay, az) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - (p.round || 0);
  },
  sphere(x, y, z, p) {
    return Math.hypot(x - p.center[0], y - p.center[1], z - p.center[2]) - p.radius;
  },
  ellipsoid(x, y, z, p) {
    const k0 = Math.hypot((x - p.center[0]) / p.radii[0], (y - p.center[1]) / p.radii[1], (z - p.center[2]) / p.radii[2]);
    if (k0 < 1e-9) return -Math.min(p.radii[0], p.radii[1], p.radii[2]);
    const k1 = Math.hypot((x - p.center[0]) / (p.radii[0] * p.radii[0]), (y - p.center[1]) / (p.radii[1] * p.radii[1]), (z - p.center[2]) / (p.radii[2] * p.radii[2]));
    return k0 * (k0 - 1) / (k1 + 1e-9);
  },
  capsule(x, y, z, p) { // vertical capsule
    const px = x - p.center[0], pz = z - p.center[2];
    let py = y - (p.center[1] - p.halfLen);
    py = clamp(py, 0, p.halfLen * 2) - (py - 0); // project onto segment
    const cy = clamp(y, p.center[1] - p.halfLen, p.center[1] + p.halfLen);
    return Math.hypot(px, y - cy, pz) - p.radius;
  },
  torus(x, y, z, p) { // ring in XZ plane (lying flat), tube R
    const qx = Math.hypot(x - p.center[0], z - p.center[2]) - p.major;
    const qy = y - p.center[1];
    return Math.hypot(qx, qy) - p.minor;
  },
  cylinder(x, y, z, p) { // vertical, rounded top edge by p.round
    const dx = Math.hypot(x - p.center[0], z - p.center[2]) - p.radius;
    const dy = Math.abs(y - p.center[1]) - p.halfHeight;
    const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - (p.round || 0);
  },
  // Vertical mesa/butte with sloped sides (top radius < bottom radius → cliff)
  mesa(x, y, z, p) {
    const dx = x - p.center[0], dz = z - p.center[2];
    const r = Math.hypot(dx, dz);
    const yTop = p.center[1] + p.halfHeight, yBot = p.center[1] - p.halfHeight;
    const t = clamp((y - yBot) / (yTop - yBot + 1e-6), 0, 1);
    const rr = lerp(p.radiusBottom, p.radiusTop, t);
    const dr = r - rr;
    const dy = y > yTop ? y - yTop : y < yBot ? yBot - y : -Math.min(yTop - y, y - yBot, rr - r);
    if (y > yTop || y < yBot) return Math.hypot(Math.max(dr, 0), y > yTop ? y - yTop : yBot - y);
    return Math.max(dr, dy);
  },
};

// ── combinators ──
export const Op = {
  u: (a, b) => Math.min(a, b),
  s: (a, b) => Math.max(a, -b),       // a minus b
  i: (a, b) => Math.max(a, b),
  su: (a, b, k) => {                   // polynomial smooth-min
    if (k <= 1e-4) return Math.min(a, b);
    const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
  },
};

// ── field-graph compiler ──
// Compiles FIELD nodes reachable from the Output node into one closure:
//   eval(x, y, z, out) → distance; out.mat = material id (0 rock,1 sand,2 soil,3 sediment,4 clay)
export const MAT = { ROCK: 0, SAND: 1, SOIL: 2, SEDIMENT: 3, CLAY: 4, SNOW: 5 };
export const MAT_NAMES = ['Rock', 'Sand', 'Soil', 'Sediment', 'Clay', 'Snow'];

export function compileField(graph, noise) {
  const out = graph.nodes.find(n => n.type === 'output');
  if (!out) return { eval: () => 1e6, order: [] };
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const incoming = new Map(); // nodeId.port → link
  for (const l of graph.links) incoming.set(l.to.node + ':' + l.to.port, l);
  const srcOf = (nodeId, port) => {
    const l = incoming.get(nodeId + ':' + port);
    return l ? byId.get(l.from.node) : null;
  };
  const memo = new Map();
  const order = [];
  const visiting = new Set();

  function build(node) {
    if (!node || node.disabled) return null;
    if (memo.has(node.id)) return memo.get(node.id);
    if (visiting.has(node.id)) return null; // cycle guard (validated on connect, belt & braces)
    visiting.add(node.id);
    const fn = buildNode(node, srcOf, build, noise);
    visiting.delete(node.id);
    memo.set(node.id, fn);
    order.push(node.id);
    return fn;
  }
  const rootSrc = srcOf(out.id, 'field');
  const root = rootSrc ? build(rootSrc) : null;
  const fn = root || (() => 1e6);
  return {
    order,
    eval: (x, y, z, o) => { o.mat = 0; return fn(x, y, z, o); },
  };
}

function child(build, srcOf, node, port) {
  const s = srcOf(node.id, port);
  return s ? build(s) : null;
}

function buildNode(node, srcOf, build, noise) {
  const p = node.params;
  switch (node.type) {
    // ── sources ──
    case 'ground': return (x, y, z, o) => { o.mat = MAT.SOIL; return Prim.ground(x, y, z, p); };
    case 'box': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.box(x, y, z, p); };
    case 'sphere': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.sphere(x, y, z, p); };
    case 'ellipsoid': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.ellipsoid(x, y, z, p); };
    case 'capsule': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.capsule(x, y, z, p); };
    case 'torus': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.torus(x, y, z, p); };
    case 'cylinder': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.cylinder(x, y, z, p); };
    case 'mesa': return (x, y, z, o) => { o.mat = p.mat ?? MAT.ROCK; return Prim.mesa(x, y, z, p); };

    // ── generators (procedural, domain-aware) ──
    case 'mountain': {
      return (x, y, z, o) => {
        o.mat = MAT.ROCK;
        const f = 1 / Math.max(p.feature, 1);
        const r = noise.ridged(x * f + p.seed * 0.13, 0.37, z * f - p.seed * 0.29, p.octaves);
        const maskR = Math.hypot(x - p.center[0], z - p.center[2]);
        const mask = sstep(p.radius, p.radius * 0.25, maskR); // 1 inside
        const h = p.base + Math.max(r, 0) * p.height * mask + noise.fbm(x * f * 3.1, 7.7, z * f * 3.1, 3) * p.height * 0.06 * mask;
        return Math.max(y - h, p.bottom - y);
      };
    }
    case 'hills': {
      return (x, y, z, o) => {
        o.mat = MAT.SOIL;
        const f = 1 / Math.max(p.feature, 1);
        const n = noise.billow(x * f + p.seed, 3.1, z * f, p.octaves) - 0.45;
        const h = p.base + n * p.height;
        return Math.max(y - h, p.bottom - y);
      };
    }
    case 'canyon': { // subtractive channel cutter driven by meander — combine with Subtract
      return (x, y, z, o) => {
        o.mat = MAT.ROCK;
        const cx = p.centerX + p.meander * (2.5 * Math.sin(0.15 * z + p.phase) + Math.sin(0.36 * z * p.bends + 1 + p.phase));
        const halfW = p.width * 0.5 + p.flare * Math.max(0, y - p.bedY) * 0.12;
        const dx = Math.abs(x - cx) - halfW;
        const dy = Math.abs(y - (p.bedY + p.depth * 0.5)) - p.depth * 0.5 - 30; // tall cutter
        const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
        return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay);
      };
    }
    case 'caves': { // worm tunnels (subtractive). Domain-warped fBm thresholded into tubes.
      return (x, y, z, o) => {
        o.mat = MAT.ROCK;
        const f = 1 / Math.max(p.feature, 1);
        const w = noise.warped(x * f, y * f, z * f, 3, p.warp, f * 2.2);
        const band = Math.abs(w - p.center) * p.feature * 0.5 - p.radius;
        const yMask = Math.max(p.yMin - y, y - p.yMax); // keep inside band vertically
        // union with a few horizontal worm tubes for guaranteed connectivity
        let d = Math.max(band, yMask);
        for (let i = 0; i < (p.worms || 0); i++) {
          const ph = p.seed * 1.7 + i * 2.39;
          const wy = p.yMin + (p.yMax - p.yMin) * (0.25 + 0.5 * ((i * 0.37 + 0.11) % 1));
          const cx = Math.sin(z * 0.05 + ph) * 30 + Math.sin(i * 3.1) * 20;
          const tube = Math.hypot(x - cx, (y - wy) * 1.4) - p.radius * (0.7 + 0.3 * Math.sin(i * 7.7));
          d = Math.min(d, tube);
        }
        return d;
      };
    }
    case 'dunes': {
      return (x, y, z, o) => {
        o.mat = MAT.SAND;
        const dirx = Math.cos(p.windDir * Math.PI / 180), dirz = Math.sin(p.windDir * Math.PI / 180);
        const along = x * dirx + z * dirz, across = -x * dirz + z * dirx;
        const dune = Math.abs(Math.sin(along * 6.2831 / Math.max(p.wavelength, 1) +
          noise.fbm(across * 0.02, 1.7, p.seed * 0.1, 2) * 3.0));
        const sharp = Math.pow(1 - dune, p.sharpness);
        const h = p.base + sharp * p.height + noise.fbm(x * 0.05, 9.1, z * 0.05, 2) * p.height * 0.15;
        return Math.max(y - h, p.bottom - y);
      };
    }
    case 'plateau': {
      return (x, y, z, o) => {
        o.mat = MAT.ROCK;
        const f = 1 / Math.max(p.feature, 1);
        const edge = noise.fbm(x * f, 4.2, z * f, 3) * p.edgeNoise;
        const r = Math.hypot(x - p.center[0], z - p.center[2]) + edge;
        const inside = sstep(p.radius, p.radius - p.cliffWidth, r); // 1 core → 0 outside
        const h = lerp(p.baseLow, p.baseHigh, inside);
        return Math.max(y - h, p.bottom - y);
      };
    }

    // ── combinators ──
    case 'union': case 'smoothUnion': case 'subtract': case 'intersect': {
      const a = child(build, srcOf, node, 'a'), b = child(build, srcOf, node, 'b');
      const oa = { mat: 0 }, ob = { mat: 0 };
      if (!a && !b) return () => 1e6;
      if (!a) return (x, y, z, o) => b(x, y, z, o);
      if (!b) return (x, y, z, o) => a(x, y, z, o);
      if (node.type === 'union') return (x, y, z, o) => {
        const da = a(x, y, z, oa), db = b(x, y, z, ob);
        if (da < db) { o.mat = oa.mat; return da; } o.mat = ob.mat; return db;
      };
      if (node.type === 'smoothUnion') return (x, y, z, o) => {
        const da = a(x, y, z, oa), db = b(x, y, z, ob);
        o.mat = da < db ? oa.mat : ob.mat;
        return Op.su(da, db, p.smooth ?? 2);
      };
      if (node.type === 'subtract') return (x, y, z, o) => {
        const da = a(x, y, z, oa); o.mat = oa.mat;
        const db = b(x, y, z, ob);
        return Op.s(da, db);
      };
      return (x, y, z, o) => { // intersect
        const da = a(x, y, z, oa), db = b(x, y, z, ob);
        if (da > db) { o.mat = oa.mat; return da; } o.mat = ob.mat; return db;
      };
    }

    // ── modifiers ──
    case 'fbmDisplace': case 'ridgedDisplace': {
      const c = child(build, srcOf, node, 'in');
      if (!c) return () => 1e6;
      const f = 1 / Math.max(p.feature, 1);
      const ridged = node.type === 'ridgedDisplace';
      return (x, y, z, o) => {
        const d = c(x, y, z, o);
        const n = ridged
          ? (noise.ridged(x * f + p.seed, y * f * 0.7, z * f, p.octaves) - 0.45)
          : noise.fbm(x * f + p.seed, y * f, z * f, p.octaves);
        const surfW = sstep(p.range, 0, Math.abs(d)); // only near surface
        return d - n * p.amount * surfW;
      };
    }
    case 'terrace': {
      const c = child(build, srcOf, node, 'in');
      if (!c) return () => 1e6;
      return (x, y, z, o) => {
        const d = c(x, y, z, o);
        if (d > p.range) return d;
        const t = y / Math.max(p.step, 0.5);
        const q = Math.floor(t) + sstep(0.5 - p.sharp * 0.5, 0.5 + p.sharp * 0.5, t - Math.floor(t));
        return d + (q * Math.max(p.step, 0.5) - y) * p.amount * sstep(p.range, 0, Math.abs(d));
      };
    }
    case 'warp': {
      const c = child(build, srcOf, node, 'in');
      if (!c) return () => 1e6;
      const f = 1 / Math.max(p.feature, 1);
      return (x, y, z, o) => {
        const wx = noise.fbm(x * f + 11, y * f, z * f, 3);
        const wy = noise.fbm(x * f, y * f + 27, z * f, 3);
        const wz = noise.fbm(x * f, y * f, z * f + 43, 3);
        return c(x + wx * p.amount, y + wy * p.amount, z + wz * p.amount, o);
      };
    }
    case 'transform': {
      const c = child(build, srcOf, node, 'in');
      if (!c) return () => 1e6;
      const [rx, ry, rz] = [p.rot[0] * Math.PI / 180, p.rot[1] * Math.PI / 180, p.rot[2] * Math.PI / 180];
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
      // inverse transform: world → local (translate, rotate⁻¹, scale⁻¹)
      return (x, y, z, o) => {
        let lx = (x - p.pos[0]) / p.scale[0], ly = (y - p.pos[1]) / p.scale[1], lz = (z - p.pos[2]) / p.scale[2];
        let t1 = cy * lx - sy * lz, t3 = sy * lx + cy * lz; lx = t1; lz = t3;       // yaw⁻¹
        t1 = cx * ly + sx * lz; t3 = -sx * ly + cx * lz; ly = t1; lz = t3;          // pitch⁻¹
        t1 = cz * lx + sz * ly; const t2 = -sz * lx + cz * ly; lx = t1; ly = t2;   // roll⁻¹
        const sMin = Math.min(p.scale[0], p.scale[1], p.scale[2]);
        return c(lx, ly, lz, o) * sMin;
      };
    }
    case 'materialPaint': { // override material id inside child-b region
      const c = child(build, srcOf, node, 'in'), m = child(build, srcOf, node, 'mask');
      if (!c) return () => 1e6;
      if (!m) return (x, y, z, o) => c(x, y, z, o);
      const om = { mat: 0 };
      return (x, y, z, o) => {
        const d = c(x, y, z, o);
        if (d < 0.5 && m(x, y, z, om) < 0) o.mat = p.mat;
        return d;
      };
    }
    default: return () => 1e6;
  }
}

export function makeFieldNoise(seed) { return makeNoise(seed); }
