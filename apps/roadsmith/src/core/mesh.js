// Quad-first mesh builder with positional welding.
//
// Roadsmith builds the whole road network — carriageways, junction plates, kerbs, footways —
// into ONE welded buffer. Quads are the authoring primitive; triangles are only emitted for the
// rare odd corner, and both index streams are kept so the viewport can draw true quad wireframe
// and the validator can audit topology (manifoldness, degenerates, T-junctions, quad ratio).

export const FLOATS_PER_VERTEX = 20; // pos3 nrm3 tan3 uv2 attrA4 attrB4 pad1
// attrA = (surfaceId, wear, ao, flagsPacked)   flagsPacked = flags | markingCode << 16
// attrB = (laneWidth, laneA, laneB, param)     laneA/laneB = travel-lane band in section metres,
//                                              param = distance to the nearest junction mouth
//                                              (ribbon) or to the junction centre (plate)
export const VERTEX_STRIDE = FLOATS_PER_VERTEX * 4;

export const SURF = {
  ASPHALT: 0,
  ASPHALT_JUNCTION: 1,
  GUTTER: 2,
  KERB_FACE: 3,
  KERB_TOP: 4,
  FOOTWAY: 5,
  VERGE: 6,
  MEDIAN: 7,
  SHOULDER: 8,
  CONCRETE: 9,
  BRIDGE_UNDER: 10,
  RAIL_BED: 11,
  METAL: 12,
  PAINTED_CONCRETE: 13,
  TACTILE: 14,
  DIRT: 15,
  WATER: 16,
  GLASS: 17,
  RUBBER: 18,
  PLASTIC: 19,
  COBBLE: 20,
  BRICK: 21,
  GRASS: 22,
  STEEL_RUST: 23,
  LAMP_LENS: 24,
  SIGNAL_LENS: 25,
  BILLBOARD: 26,
  SIGN_SPEED: 27,
  SIGN_STOP: 28,
  SIGN_GIVEWAY: 29,
  SIGN_INFO: 30,
  CONE: 31,
  BARRIER: 32,
  WOOD: 33,
  CAR_PAINT: 34,
  CAR_GLASS: 35,
  TIRE: 36,
  CHROME: 37,
  LIGHT_RED: 38,
  LIGHT_WHITE: 39,
  RAIL_STEEL: 40,
  SLEEPER: 41,
  BALLAST: 42,
  TRAIN_BODY: 43,
  ROAD_PLATE: 44,
  PAVER: 45,
  LINE_PAINT: 46,
  SOIL: 47,
  GRAVEL: 48,
  TUNNEL_LINING: 49,
};

export const SURF_NAMES = Object.fromEntries(Object.entries(SURF).map(([k, v]) => [v, k]));

// marking codes sampled by the surface shader (lateral coordinate drives the actual paint)
export const MARK = {
  NONE: 0,
  LANE_DASH: 1,
  CENTRE_DOUBLE: 2,
  CENTRE_DASH: 3,
  EDGE_SOLID: 4,
  CROSSWALK: 5,
  STOP_BAR: 6,
  PARKING_BAY: 7,
  HATCH: 8,
  YELLOW_BOX: 9,
  ARROW_THROUGH: 10,
  ARROW_LEFT: 11,
  ARROW_RIGHT: 12,
  GIVE_WAY: 13,
};

const KEY_SCALE = 1e4; // 0.1 mm weld tolerance

export class MeshBuilder {
  constructor(name = 'mesh') {
    this.name = name;
    this.v = [];            // flat float array
    this.count = 0;         // vertex count
    this.quads = [];        // 4 * n indices
    this.tris = [];         // 3 * n indices
    this.map = new Map();   // weld key -> index
    this.welds = 0;
    this._attr = {
      surface: SURF.ASPHALT, wear: 0, ao: 1, flags: 0,
      laneWidth: 3.5, laneA: -7, laneB: 7, param: 0,
    };
    this.submeshes = [];
    this._subStart = 0;
    this._subName = null;
  }

  attr(patch) { Object.assign(this._attr, patch); return this; }
  pushAttr() { this._attrStack = this._attrStack || []; this._attrStack.push({ ...this._attr }); return this; }
  popAttr() { this._attr = this._attrStack.pop(); return this; }

  beginSubmesh(name) {
    this.endSubmesh();
    this._subStart = this.tris.length;
    this._subName = name;
  }

  endSubmesh() {
    if (this._subName && this.tris.length > this._subStart) {
      this.submeshes.push({ name: this._subName, start: this._subStart, count: this.tris.length - this._subStart });
    }
    this._subName = null;
  }

  /**
   * Add (or weld to) a vertex.
   * @param {{x,y,z}} p position
   * @param {object} o {u,v, normal, tangent, ...attribute overrides}
   */
  vertex(p, o = {}) {
    const a = this._attr;
    const surface = o.surface ?? a.surface;
    const kx = Math.round(p.x * KEY_SCALE), ky = Math.round(p.y * KEY_SCALE), kz = Math.round(p.z * KEY_SCALE);
    const key = `${kx},${ky},${kz},${surface}`;
    const hit = this.map.get(key);
    if (hit !== undefined) { this.welds++; return hit; }

    const i = this.count++;
    const t = o.tangent || { x: 1, y: 0, z: 0 };
    const n = o.normal || { x: 0, y: 1, z: 0 };
    this.v.push(
      p.x, p.y, p.z,
      n.x, n.y, n.z,
      t.x, t.y, t.z,
      o.u ?? 0, o.v ?? 0,
      surface, o.wear ?? a.wear, o.ao ?? a.ao, (o.flags ?? a.flags) + (o.mark ?? a.mark ?? 0) * 65536,
      o.laneWidth ?? a.laneWidth, o.laneA ?? a.laneA, o.laneB ?? a.laneB, o.param ?? a.param,
      0,
    );
    this.map.set(key, i);
    return i;
  }

  /** CCW when viewed from the surface normal side. */
  quad(a, b, c, d) {
    if (a === b || b === c || c === d || d === a || a === c || b === d) {
      // collapsed quad -> emit the surviving triangle instead of a degenerate face
      const uniq = [...new Set([a, b, c, d])];
      if (uniq.length === 3) this.tris.push(uniq[0], uniq[1], uniq[2]);
      return;
    }
    this.quads.push(a, b, c, d);
    this.tris.push(a, b, c, a, c, d);
  }

  tri(a, b, c) {
    if (a === b || b === c || a === c) return;
    this.tris.push(a, b, c);
  }

  /** Bridge two equal-length index rows with a quad strip (rowA[i] -> rowB[i]). */
  strip(rowA, rowB, flip = false) {
    const n = Math.min(rowA.length, rowB.length);
    for (let i = 0; i < n - 1; i++) {
      if (flip) this.quad(rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]);
      else this.quad(rowA[i], rowB[i], rowB[i + 1], rowA[i + 1]);
    }
  }

  /** Close a ring of 2*k+ vertices with an all-quad midpoint fan (no n-gons, no triangle fan). */
  fanFillQuads(ring, makeVertex) {
    const n = ring.length;
    if (n < 3) return;
    const mids = [];
    for (let i = 0; i < n; i++) mids.push(makeVertex('mid', i, (i + 1) % n));
    const centre = makeVertex('centre');
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      this.quad(ring[i], mids[i], centre, mids[prev]);
    }
  }

  get vertexCount() { return this.count; }
  get triCount() { return this.tris.length / 3; }
  get quadCount() { return this.quads.length / 4; }

  /** Area-weighted smooth normals; respects welding (so kerb creases stay sharp). */
  computeNormals() {
    const V = this.v, F = FLOATS_PER_VERTEX;
    const acc = new Float64Array(this.count * 3);
    const T = this.tris;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * F, b = T[i + 1] * F, c = T[i + 2] * F;
      const ax = V[a], ay = V[a + 1], az = V[a + 2];
      const ux = V[b] - ax, uy = V[b + 1] - ay, uz = V[b + 2] - az;
      const vx = V[c] - ax, vy = V[c + 1] - ay, vz = V[c + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const idx of [T[i], T[i + 1], T[i + 2]]) {
        acc[idx * 3] += nx; acc[idx * 3 + 1] += ny; acc[idx * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < this.count; i++) {
      let nx = acc[i * 3], ny = acc[i * 3 + 1], nz = acc[i * 3 + 2];
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-9) { V[i * F + 3] = nx / l; V[i * F + 4] = ny / l; V[i * F + 5] = nz / l; }
    }
    // re-orthogonalise stored tangents against the final normals
    for (let i = 0; i < this.count; i++) {
      const o = i * F;
      const nx = V[o + 3], ny = V[o + 4], nz = V[o + 5];
      let tx = V[o + 6], ty = V[o + 7], tz = V[o + 8];
      const d = tx * nx + ty * ny + tz * nz;
      tx -= nx * d; ty -= ny * d; tz -= nz * d;
      const l = Math.hypot(tx, ty, tz);
      if (l > 1e-6) { V[o + 6] = tx / l; V[o + 7] = ty / l; V[o + 8] = tz / l; }
    }
    return this;
  }

  bounds() {
    const F = FLOATS_PER_VERTEX, V = this.v;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < this.count; i++) {
      const o = i * F;
      min.x = Math.min(min.x, V[o]); max.x = Math.max(max.x, V[o]);
      min.y = Math.min(min.y, V[o + 1]); max.y = Math.max(max.y, V[o + 1]);
      min.z = Math.min(min.z, V[o + 2]); max.z = Math.max(max.z, V[o + 2]);
    }
    return { min, max };
  }

  finish({ normals = true } = {}) {
    if (normals) this.computeNormals();
    this.endSubmesh();
    const vertices = new Float32Array(this.v);
    const indices = this.count > 65535 ? new Uint32Array(this.tris) : new Uint32Array(this.tris);
    const quads = new Uint32Array(this.quads);
    return {
      name: this.name,
      vertices,
      indices,
      quads,
      vertexCount: this.count,
      triCount: this.tris.length / 3,
      quadCount: this.quads.length / 4,
      welds: this.welds,
      submeshes: this.submeshes,
      bounds: this.bounds(),
    };
  }
}

/** Unique undirected edge list of the quad set -> wireframe for the topology overlay. */
export function quadWireIndices(quads) {
  const seen = new Set();
  const out = [];
  for (let q = 0; q < quads.length; q += 4) {
    for (let e = 0; e < 4; e++) {
      const a = quads[q + e], b = quads[q + ((e + 1) & 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b);
    }
  }
  return new Uint32Array(out);
}

/** Linear interpolation of the vertex attribute bundle (used when inserting junction midpoints). */
export function lerpAttr(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const av = a[k], bv = b[k];
    out[k] = typeof av === 'number' && typeof bv === 'number' ? av + (bv - av) * t : av;
  }
  return out;
}
