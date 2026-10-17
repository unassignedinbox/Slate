// Greybox geometry builder.
//
// Every vertex carries, besides position/normal:
//   gpos  - its position in "pattern space" (building-local, or route space for
//           roads). The greybox shader draws grids, windows, tiles and lane
//           markings from gpos, so patterns stay continuous across fracture
//           cracks and never swim when a piece drifts.
//   gkind - which procedural pattern the surface uses (see K below).
//   color - base albedo (linear).
// All geometry is indexed and carries the same attribute set so the whole level
// can live in a single BatchedMesh (a handful of draw calls for thousands of
// independently moving fragments).
import * as THREE from 'three';

/** Surface kinds - mirrored in render/greyboxMaterial.js */
export const K = {
  PLAIN: 0,   // prototype grid
  FACADE: 1,  // walls: grid + window bays every floor
  ROAD: 2,    // asphalt with lane markings (gpos.x = lateral, gpos.z = route s)
  CUT: 3,     // fresh fracture face
  ROOF: 4,    // pitched roof tiles
  GRASS: 5,
  SOIL: 6,    // torn underside of the ground
  FLOOR: 7,   // interior floor boards
  WATER: 8,
  GLASS: 9,
  PAVE: 10,   // sidewalks / plaza paving
  PROP: 11,   // furniture & props: smooth, no grid
  STONE: 12,  // church / bridge masonry courses
  METAL: 13,
  FLATROOF: 14, // drivable flat roofs (membrane + grid)
  MARK: 15,   // flat painted / signage colour, no pattern
  CURTAIN: 16, // curtain wall: glass bands, mullions, spandrels per 3.8 m floor (towers)
  STRATA: 17,  // ground cross-section: soil / rock / fill layers (torn city plates)
  LANES: 18,   // multi-lane carriageway: gpos.x lateral, gpos.z along; half-width = variant * 40 m
};

/** Greybox palette (sRGB). Desaturated, function-coded. */
export const PAL = {
  asphalt: 0x5d6166, curb: 0xa8aaa9, pave: 0xb1b0aa, wall: 0xcbc7bf, wall2: 0xbcc0c2,
  wall3: 0xd0c8bb, wall4: 0xb9b2a7, roof: 0x8a837d, roofDark: 0x6d7176, flatRoof: 0x9fa2a3,
  cut: 0x56514c, soil: 0x6b6159, grass: 0x8d9783, floor: 0xb4a894, water: 0x7c939f,
  stone: 0xbab3a5, stoneDark: 0x9a9386, metal: 0x8e959b, prop: 0xc6b794, propDark: 0x8d8576,
  propLight: 0xd8d2c4, glass: 0x6a7983, trunk: 0x695e56, leaf: 0x889880, mark: 0xdedbd2,
  hazard: 0xbf6e4e, frame: 0x3c4146, car: 0x9aa2a8, interior: 0xa79f94, white: 0xe9e6df,
  // section 2 - the city
  concrete: 0xb8b7b2, concrete2: 0xa9aaa7, tower: 0xc4c8ca, tower2: 0xb3b9bd, tower3: 0xcfccc4,
  brick: 0xb09c8c, brick2: 0x9f9488, stoneCity: 0xc9c2b4, rock: 0x8b8178, fill: 0x9a8f84,
  curtain: 0x8d989f, steel: 0x7d848a,
};

const _c = new THREE.Color();
export function lin(hex, jitter = 0, rng = null) {
  _c.setHex(hex);
  if (jitter && rng) {
    const k = 1 + (rng.next() * 2 - 1) * jitter;
    return [_c.r * k, _c.g * k, _c.b * k];
  }
  return [_c.r, _c.g, _c.b];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _g = new THREE.Vector3();
const IDENT = new THREE.Matrix4();

export function newellNormal(verts, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  for (let i = 0, m = verts.length; i < m; i++) {
    const a = verts[i], b = verts[(i + 1) % m];
    out.x += (a.y - b.y) * (a.z + b.z);
    out.y += (a.z - b.z) * (a.x + b.x);
    out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out.normalize();
}

export class MeshBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.gp = []; this.kd = []; this.col = []; this.idx = [];
    this.n = 0;
  }
  get empty() { return this.n === 0; }

  /**
   * Convex planar polygon. verts are body-local Vector3. If `outward` is given the
   * winding is fixed so the face points that way. gmat maps body-local -> pattern space.
   */
  poly(verts, kind, color, gmat = IDENT, outward = null) {
    if (verts.length < 3) return this;
    newellNormal(verts, _n);
    if (!isFinite(_n.x) || _n.lengthSq() < 0.5) return this;
    let vs = verts;
    if (outward && _n.dot(outward) < 0) { vs = verts.slice().reverse(); _n.negate(); }
    const base = this.n;
    for (const v of vs) {
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      _g.copy(v).applyMatrix4(gmat);
      this.gp.push(_g.x, _g.y, _g.z);
      this.kd.push(kind);
      this.col.push(color[0], color[1], color[2]);
      this.n++;
    }
    for (let i = 1; i < vs.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }

  /** Convex planar polygon with explicit pattern-space coordinates per vertex (ribbons, curved streets). */
  polyG(verts, gps, kind, color, outward = null) {
    if (verts.length < 3) return this;
    newellNormal(verts, _n);
    if (!isFinite(_n.x) || _n.lengthSq() < 0.5) return this;
    let vs = verts, gs = gps;
    if (outward && _n.dot(outward) < 0) { vs = verts.slice().reverse(); gs = gps.slice().reverse(); _n.negate(); }
    const base = this.n;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i], g = gs[i];
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.gp.push(g.x, g.y, g.z);
      this.kd.push(kind);
      this.col.push(color[0], color[1], color[2]);
      this.n++;
    }
    for (let i = 1; i < vs.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }

  /**
   * Box of size w,h,d centred at the origin of matrix M (body-local placement).
   * kinds: number or {top,bottom,side,front,back,left,right}; colors likewise.
   */
  box(w, h, d, M = IDENT, kinds = K.PLAIN, colors = [0.5, 0.5, 0.5], gmat = null) {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const c = [];
    for (let i = 0; i < 8; i++) {
      c.push(new THREE.Vector3(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz).applyMatrix4(M));
    }
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const faces = [
      ['right', [1, 3, 7, 5], [1, 0, 0]], ['left', [0, 4, 6, 2], [-1, 0, 0]],
      ['top', [2, 6, 7, 3], [0, 1, 0]], ['bottom', [0, 1, 5, 4], [0, -1, 0]],
      ['front', [4, 5, 7, 6], [0, 0, 1]], ['back', [0, 2, 3, 1], [0, 0, -1]],
    ];
    const gm = gmat || IDENT;
    for (const [name, ids, n] of faces) {
      const kind = typeof kinds === 'number' ? kinds : (kinds[name] ?? kinds.side ?? K.PLAIN);
      const col = Array.isArray(colors) ? colors : (colors[name] ?? colors.side ?? colors.top);
      const out = new THREE.Vector3(...n).applyMatrix3(nm).normalize();
      this.poly(ids.map((i) => c[i]), kind, col, gm, out);
    }
    return this;
  }

  /** Gable roof prism: base w (x) at y=0, ridge height h, length L along z. */
  gable(w, h, L, M = IDENT, roofKind = K.ROOF, roofCol, gableKind = K.FACADE, gableCol, gmat = null, overhang = 0.5) {
    const hw = w / 2 + overhang, hl = L / 2 + overhang * 0.6;
    const drop = (overhang / (w / 2)) * h; // eave dips below the wall top by the slope
    const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    const a0 = P(-hw, -drop, -hl), a1 = P(hw, -drop, -hl), r0 = P(0, h, -hl);
    const b0 = P(-hw, -drop, hl), b1 = P(hw, -drop, hl), r1 = P(0, h, hl);
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const O = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix3(nm).normalize();
    const gm = gmat || IDENT;
    this.poly([a0, b0, r1, r0], roofKind, roofCol, gm, O(-h, w / 2, 0));
    this.poly([a1, r0, r1, b1], roofKind, roofCol, gm, O(h, w / 2, 0));
    this.poly([a0, r0, a1], gableKind, gableCol, gm, O(0, 0, -1));
    this.poly([b0, b1, r1], gableKind, gableCol, gm, O(0, 0, 1));
    this.poly([a0, a1, b1, b0], K.CUT, gableCol, gm, O(0, -1, 0));
    return this;
  }

  /** n-sided prism / frustum along y, radius r0 at bottom (y=-h/2), r1 at top. */
  cylinder(r0, r1, h, sides, M = IDENT, sideKind = K.PLAIN, col, capKind = null, gmat = null, phase = 0) {
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const gm = gmat || IDENT;
    const bot = [], top = [];
    for (let i = 0; i < sides; i++) {
      const a = phase + (i / sides) * Math.PI * 2;
      bot.push(new THREE.Vector3(Math.cos(a) * r0, -h / 2, Math.sin(a) * r0).applyMatrix4(M));
      top.push(new THREE.Vector3(Math.cos(a) * r1, h / 2, Math.sin(a) * r1).applyMatrix4(M));
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const am = phase + ((i + 0.5) / sides) * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(am), (r0 - r1) / h, Math.sin(am)).applyMatrix3(nm).normalize();
      if (r1 < 1e-4) this.poly([bot[i], bot[j], top[i]], sideKind, col, gm, out);
      else if (r0 < 1e-4) this.poly([bot[i], top[j], top[i]], sideKind, col, gm, out);
      else this.poly([bot[i], bot[j], top[j], top[i]], sideKind, col, gm, out);
    }
    const ck = capKind ?? sideKind;
    if (r1 > 1e-4) this.poly(top.slice(), ck, col, gm, new THREE.Vector3(0, 1, 0).applyMatrix3(nm));
    if (r0 > 1e-4) this.poly(bot.slice(), ck, col, gm, new THREE.Vector3(0, -1, 0).applyMatrix3(nm));
    return this;
  }

  /** Convex polyhedron from fracture.js; faces keep their own kind/colour. */
  convex(poly, M = IDENT, gmat = null, colorOverride = null) {
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const gm = gmat || IDENT;
    for (const f of poly.faces) {
      const vs = f.v.map((v) => v.clone().applyMatrix4(M));
      const out = f.n.clone().applyMatrix3(nm).normalize();
      this.poly(vs, f.kind, colorOverride && f.kind !== K.CUT ? colorOverride : f.color, gm, out);
    }
    return this;
  }

  /** Append another builder (same body space). */
  append(other) {
    const base = this.n;
    this.pos.push(...other.pos); this.nrm.push(...other.nrm); this.gp.push(...other.gp);
    this.kd.push(...other.kd); this.col.push(...other.col);
    for (const i of other.idx) this.idx.push(i + base);
    this.n += other.n;
    return this;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('gpos', new THREE.Float32BufferAttribute(this.gp, 3));
    g.setAttribute('gkind', new THREE.Float32BufferAttribute(this.kd, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const IndexArr = this.n > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArr(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Compose helper: position + Euler(YXZ order, radians) + optional scale. */
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return m;
}
