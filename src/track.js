import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONTROL_POINTS, TRACK_CONFIG, START_ANCHOR } from './trackData.js';
import { asphaltTexture, hazardTexture, panelTexture, adTexture, checkerTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/**
 * The Motorball circuit: a closed, banked, half-pipe ("trough") roadway
 * lofted along a 3D spline, with a bridge/tunnel crossover.
 *
 * Also acts as the collision surface: `sample()` returns the surface point,
 * normal and lateral offset for any world position.
 */
export class Track {
  constructor() {
    this.cfg = TRACK_CONFIG;
    this.group = new THREE.Group();
    this.group.name = 'MotorballCircuit';

    this._buildSpline();
    this._buildFrames();
    this._buildRoad();
    this._buildWalls();
    this._buildStructure();
    this._buildTunnel();
    this._buildStartLine();
    this._buildAds();
  }

  // ---------------------------------------------------------------- spline
  _buildSpline() {
    const pts = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.N = Math.max(64, Math.round(this.length / this.cfg.sampleSpacing));
    this.ds = this.length / this.N;

    const spaced = this.curve.getSpacedPoints(this.N); // N+1, last == first
    this.centers = spaced.slice(0, this.N);

    // half width interpolated from the control points
    const cw = CONTROL_POINTS.map((p) => p[3]);
    this.widths = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const t = this.curve.getUtoTmapping(i / this.N);
      const f = t * cw.length;
      const i0 = Math.floor(f) % cw.length;
      const i1 = (i0 + 1) % cw.length;
      let k = f - Math.floor(f);
      k = k * k * (3 - 2 * k); // smoothstep
      this.widths[i] = cw[i0] * (1 - k) + cw[i1] * k;
    }
  }

  _buildFrames() {
    const N = this.N;
    this.tangents = [];
    this.rights = [];
    this.ups = [];
    this.banks = new Float32Array(N);

    const flatRight = [];
    for (let i = 0; i < N; i++) {
      const a = this.centers[(i - 1 + N) % N];
      const b = this.centers[(i + 1) % N];
      const t = _v1.copy(b).sub(a).normalize().clone();
      this.tangents.push(t);
      flatRight.push(new THREE.Vector3().crossVectors(t, UP).normalize());
    }

    // signed curvature -> banking (outside of the corner is raised)
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = this.tangents[i];
      const t1 = this.tangents[(i + 1) % N];
      const dT = _v2.copy(t1).sub(t0).divideScalar(this.ds);
      const k = dT.dot(flatRight[i]); // +ve = turning right
      raw[i] = THREE.MathUtils.clamp(-k * this.cfg.bankGain, -this.cfg.maxBank, this.cfg.maxBank);
    }
    // smooth the bank so transitions are drivable
    const W = 26;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -W; j <= W; j++) s += raw[(i + j + N * 2) % N];
      this.banks[i] = s / (W * 2 + 1);
    }

    for (let i = 0; i < N; i++) {
      const t = this.tangents[i];
      const r = flatRight[i];
      const u = new THREE.Vector3().crossVectors(r, t).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(t, this.banks[i]);
      this.rights.push(r.clone().applyQuaternion(q).normalize());
      this.ups.push(u.applyQuaternion(q).normalize());
    }

    // arc-length lookup + start index
    this.startIndex = this._nearestIndexGlobal(new THREE.Vector3(START_ANCHOR[0], 0, START_ANCHOR[1]));
  }

  // ------------------------------------------------------------- profile
  /** Height of the trough (half-pipe) surface at lateral offset u. */
  profile(u, halfW) {
    const flat = this.cfg.flatRatio * halfW;
    const a = Math.abs(u);
    if (a <= flat) return 0;
    const t = Math.min((a - flat) / (halfW - flat), 1.6);
    return this.cfg.rimRatio * halfW * t * t;
  }

  profileSlope(u, halfW) {
    const flat = this.cfg.flatRatio * halfW;
    const a = Math.abs(u);
    if (a <= flat) return 0;
    const t = Math.min((a - flat) / (halfW - flat), 1.6);
    return Math.sign(u) * (2 * this.cfg.rimRatio * halfW * t) / (halfW - flat);
  }

  /** World-space point on the road surface. */
  pointAt(i, u, lift = 0) {
    const c = this.centers[i];
    const r = this.rights[i];
    const up = this.ups[i];
    const h = this.profile(u, this.widths[i]) + lift;
    return new THREE.Vector3(
      c.x + r.x * u + up.x * h,
      c.y + r.y * u + up.y * h,
      c.z + r.z * u + up.z * h
    );
  }

  // ------------------------------------------------------------ collision
  _nearestIndexGlobal(p) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const c = this.centers[i];
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const dy = (c.y - p.y) * 0.35;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Resolve a world position against the road.
   * `hint` keeps the search local so the bridge/tunnel crossover works.
   */
  sample(p, hint = null, out = {}) {
    const N = this.N;
    let i0;
    if (hint === null || hint === undefined) {
      i0 = this._nearestIndexGlobal(p);
    } else {
      let best = hint;
      let bd = Infinity;
      const win = 90;
      for (let j = -win; j <= win; j++) {
        const i = (hint + j + N * 4) % N;
        const c = this.centers[i];
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const dy = (c.y - p.y) * 0.5;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      i0 = best;
    }

    const c = this.centers[i0];
    const r = this.rights[i0];
    const up = this.ups[i0];
    const t = this.tangents[i0];
    const d = _v1.copy(p).sub(c);
    const u = d.dot(r);
    const along = d.dot(t);
    const halfW = this.widths[i0];
    const h = this.profile(u, halfW);
    const slope = this.profileSlope(u, halfW);

    out.index = i0;
    out.u = u;
    out.halfWidth = halfW;
    out.along = along;
    out.surface = (out.surface || new THREE.Vector3()).set(
      c.x + r.x * u + up.x * h + t.x * along,
      c.y + r.y * u + up.y * h + t.y * along,
      c.z + r.z * u + up.z * h + t.z * along
    );
    out.normal = (out.normal || new THREE.Vector3())
      .set(up.x - r.x * slope, up.y - r.y * slope, up.z - r.z * slope)
      .normalize();
    out.tangent = t;
    out.right = r;
    out.progress = i0 / N;
    return out;
  }

  getSpawn(offset = 0, back = 26) {
    const i = (this.startIndex - Math.round(back / this.ds) + this.N) % this.N;
    const pos = this.pointAt(i, offset, 0.55);
    const t = this.tangents[i];
    return { position: pos, yaw: Math.atan2(t.x, t.z), index: i };
  }

  // ----------------------------------------------------------------- loft
  /**
   * Generic lofted ribbon along the track.
   * section: array of {u, h, uvx} (h relative to the banked road plane)
   */
  _loft(section, opts = {}) {
    const {
      from = 0,
      count = this.N,
      closed = true,
      uvLengthScale = 1 / 10,
      widthScale = 1,
      flip = false,
      lift = 0,
    } = opts;
    const rows = closed ? count : count;
    const K = section.length;
    const verts = [];
    const uvs = [];
    const idx = [];

    for (let s = 0; s <= (closed ? count : count - 1); s++) {
      const i = (from + s) % this.N;
      const c = this.centers[i];
      const r = this.rights[i];
      const up = this.ups[i];
      const hw = this.widths[i] * widthScale;
      for (let j = 0; j < K; j++) {
        const sec = section[j];
        const u = sec.u * hw;
        const h = (sec.rel ? this.profile(u, this.widths[i]) : 0) + sec.h + lift;
        verts.push(c.x + r.x * u + up.x * h, c.y + r.y * u + up.y * h, c.z + r.z * u + up.z * h);
        uvs.push(sec.uvx, s * this.ds * uvLengthScale);
      }
    }

    const rowsTotal = (closed ? count : count - 1) + 1;
    for (let s = 0; s < rowsTotal - 1; s++) {
      for (let j = 0; j < K - 1; j++) {
        const a = s * K + j;
        const b = a + 1;
        const cI = a + K;
        const d = cI + 1;
        if (flip) idx.push(a, b, cI, b, d, cI);
        else idx.push(a, cI, b, b, cI, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    void rows;
    return g;
  }

  // ----------------------------------------------------------------- road
  _buildRoad() {
    const K = 21;
    const section = [];
    for (let j = 0; j < K; j++) {
      const u = (j / (K - 1)) * 2 - 1;
      section.push({ u, h: 0, rel: true, uvx: (u * 0.5 + 0.5) * 2 });
    }
    const roadGeo = this._loft(section, { uvLengthScale: 1 / 12 });
    const roadMat = new THREE.MeshStandardMaterial({
      map: asphaltTexture(),
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    road.name = 'road';
    this.group.add(road);

    // underside slab so the track reads as a solid structure from below
    const slabSection = [];
    for (let j = 0; j < 9; j++) {
      const u = (j / 8) * 2 - 1;
      slabSection.push({ u: u * 1.06, h: -2.2, rel: false, uvx: u * 3 });
    }
    const slab = new THREE.Mesh(
      this._loft(slabSection, { flip: true, uvLengthScale: 1 / 6 }),
      new THREE.MeshStandardMaterial({ map: panelTexture(), color: 0x6a6a72, roughness: 0.85, metalness: 0.5, side: THREE.DoubleSide })
    );
    this.group.add(slab);

    // neon rim strips (dashed) — the signature Motorball glow
    this._buildRimLights();
  }

  _buildRimLights() {
    const geos = { cyan: [], magenta: [] };
    const dash = 16;
    for (let i = 0; i < this.N; i += dash * 2) {
      for (const side of [-1, 1]) {
        const strip = [];
        const key = side < 0 ? 'cyan' : 'magenta';
        const verts = [];
        const idx = [];
        for (let s = 0; s <= dash; s++) {
          const ii = (i + s) % this.N;
          const c = this.centers[ii];
          const r = this.rights[ii];
          const up = this.ups[ii];
          const hw = this.widths[ii];
          for (const uu of [0.86, 0.97]) {
            const u = side * uu * hw;
            const h = this.profile(u, hw) + 0.06;
            verts.push(c.x + r.x * u + up.x * h, c.y + r.y * u + up.y * h, c.z + r.z * u + up.z * h);
          }
          if (s < dash) {
            const a = s * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        geos[key].push(g);
        void strip;
      }
    }
    const mkMat = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, side: THREE.DoubleSide });
    if (geos.cyan.length) this.group.add(new THREE.Mesh(mergeGeometries(geos.cyan), mkMat(0x2ff0ff)));
    if (geos.magenta.length) this.group.add(new THREE.Mesh(mergeGeometries(geos.magenta), mkMat(0xff3fa8)));
  }

  // ---------------------------------------------------------------- walls
  _buildWalls() {
    const wallH = this.cfg.wallHeight;
    const rim = this.cfg.rimRatio;

    for (const side of [-1, 1]) {
      // inner face of the barrier
      const sec = [
        { u: side * 1.0, h: rim * 0 + 0, rel: true, uvx: 0 },
        { u: side * 1.0, h: wallH * 0.5, rel: true, uvx: 0.35 },
        { u: side * 1.0, h: wallH, rel: true, uvx: 0.7 },
        { u: side * 1.08, h: wallH + 0.35, rel: true, uvx: 1 },
        { u: side * 1.08, h: -2.4, rel: true, uvx: 2 },
      ];
      const g = this._loft(sec, { uvLengthScale: 1 / 9, flip: side > 0 });
      const mat = new THREE.MeshStandardMaterial({
        map: panelTexture(),
        color: 0x9aa0ad,
        roughness: 0.78,
        metalness: 0.45,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = false;
      this.group.add(m);

      // hazard stripe band at the base of the barrier
      const band = [
        { u: side * 0.995, h: 0.05, rel: true, uvx: 0 },
        { u: side * 0.995, h: 0.95, rel: true, uvx: 1 },
      ];
      const bg = this._loft(band, { uvLengthScale: 1 / 4, flip: side > 0 });
      this.group.add(
        new THREE.Mesh(
          bg,
          new THREE.MeshStandardMaterial({
            map: hazardTexture(),
            roughness: 0.7,
            metalness: 0.2,
            side: THREE.DoubleSide,
          })
        )
      );

      // emissive capping line along the top of the barrier
      const cap = [
        { u: side * 1.0, h: wallH + 0.38, rel: true, uvx: 0 },
        { u: side * 1.09, h: wallH + 0.38, rel: true, uvx: 1 },
      ];
      this.group.add(
        new THREE.Mesh(
          this._loft(cap, { flip: side > 0 }),
          new THREE.MeshBasicMaterial({ color: side < 0 ? 0x1ad4ff : 0xff8a1e, toneMapped: false, side: THREE.DoubleSide })
        )
      );
    }
  }

  // ----------------------------------------------------- support structure
  _buildStructure() {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.72, metalness: 0.75 });
    const parts = [];
    const step = Math.max(8, Math.round(26 / this.ds));

    for (let i = 0; i < this.N; i += step) {
      const c = this.centers[i];
      const top = c.y - 2.6;
      if (top < 2.5) continue;
      // don't drop a pylon on top of another part of the circuit
      let blocked = false;
      for (let j = 0; j < this.N; j += 3) {
        const cyc = Math.min((j - i + this.N) % this.N, (i - j + this.N) % this.N);
        if (cyc < step * 2) continue;
        const o = this.centers[j];
        if (o.y > c.y - 3) continue;
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        if (dx * dx + dz * dz < (this.widths[j] + 12) ** 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const h = top;
      const w = Math.min(6.5, 2.4 + h * 0.13);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = new THREE.BoxGeometry(0.75, h, 0.75);
          leg.translate(c.x + sx * w, h / 2, c.z + sz * w);
          parts.push(leg);
        }
      }
      // cross bracing
      const rungs = Math.max(1, Math.floor(h / 6));
      for (let k = 1; k <= rungs; k++) {
        const y = (h / (rungs + 1)) * k;
        const bx = new THREE.BoxGeometry(w * 2 + 0.75, 0.4, 0.4);
        bx.translate(c.x, y, c.z - w);
        parts.push(bx);
        const bx2 = bx.clone();
        bx2.translate(0, 0, w * 2);
        parts.push(bx2);
        const bz = new THREE.BoxGeometry(0.4, 0.4, w * 2 + 0.75);
        bz.translate(c.x - w, y, c.z);
        parts.push(bz);
        const bz2 = bz.clone();
        bz2.translate(w * 2, 0, 0);
        parts.push(bz2);
        // diagonals
        const diag = new THREE.BoxGeometry(Math.hypot(w * 2, h / (rungs + 1)), 0.3, 0.3);
        diag.rotateZ(Math.atan2(h / (rungs + 1), w * 2));
        diag.translate(c.x, y - h / (rungs + 1) / 2, c.z - w);
        parts.push(diag);
      }
      // cap plate
      const cap = new THREE.BoxGeometry(w * 2 + 3, 1.2, w * 2 + 3);
      cap.translate(c.x, h + 0.6, c.z);
      parts.push(cap);
    }

    if (parts.length) {
      const merged = mergeGeometries(parts);
      const mesh = new THREE.Mesh(merged, legMat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      parts.forEach((p) => p.dispose());
    }
  }

  // --------------------------------------------------------------- tunnel
  _buildTunnel() {
    // Cover the low pass through the centre of the stadium (The Undercross).
    const idxs = [];
    for (let i = 0; i < this.N; i++) {
      const c = this.centers[i];
      if (c.y < 5 && Math.hypot(c.x, c.z) < 105) idxs.push(i);
    }
    if (!idxs.length) return;
    // contiguous run containing the lowest point
    let start = idxs[0];
    for (let k = 1; k < idxs.length; k++) {
      if (idxs[k] !== idxs[k - 1] + 1) start = idxs[k];
    }
    const run = [];
    let i = start;
    while (true) {
      const c = this.centers[i % this.N];
      if (!(c.y < 5 && Math.hypot(c.x, c.z) < 105)) break;
      run.push(i % this.N);
      i++;
      if (run.length > this.N) break;
    }
    if (run.length < 6) return;

    const K = 15;
    const sec = [];
    for (let j = 0; j < K; j++) {
      const a = (j / (K - 1)) * Math.PI;
      sec.push({ u: -Math.cos(a) * 1.22, h: Math.sin(a) * 9.5 + 0.2, rel: false, uvx: j / (K - 1) * 3 });
    }
    const shell = this._loft(sec, {
      from: run[0],
      count: run.length - 1,
      closed: false,
      flip: true,
      uvLengthScale: 1 / 8,
    });
    const mat = new THREE.MeshStandardMaterial({
      map: panelTexture(),
      color: 0x5e626c,
      roughness: 0.85,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });
    const shellMesh = new THREE.Mesh(shell, mat);
    shellMesh.receiveShadow = true;
    this.group.add(shellMesh);

    // ribs
    const ribs = [];
    for (let k = 2; k < run.length - 2; k += 10) {
      const ii = run[k];
      const c = this.centers[ii];
      const r = this.rights[ii];
      const up = this.ups[ii];
      const hw = this.widths[ii];
      for (let j = 0; j < K - 1; j++) {
        const a0 = (j / (K - 1)) * Math.PI;
        const a1 = ((j + 1) / (K - 1)) * Math.PI;
        const p0 = new THREE.Vector3(
          c.x + r.x * -Math.cos(a0) * hw * 1.28 + up.x * (Math.sin(a0) * 10 + 0.2),
          c.y + r.y * -Math.cos(a0) * hw * 1.28 + up.y * (Math.sin(a0) * 10 + 0.2),
          c.z + r.z * -Math.cos(a0) * hw * 1.28 + up.z * (Math.sin(a0) * 10 + 0.2)
        );
        const p1 = new THREE.Vector3(
          c.x + r.x * -Math.cos(a1) * hw * 1.28 + up.x * (Math.sin(a1) * 10 + 0.2),
          c.y + r.y * -Math.cos(a1) * hw * 1.28 + up.y * (Math.sin(a1) * 10 + 0.2),
          c.z + r.z * -Math.cos(a1) * hw * 1.28 + up.z * (Math.sin(a1) * 10 + 0.2)
        );
        const len = p0.distanceTo(p1);
        const box = new THREE.BoxGeometry(1.1, len, 1.1);
        const m = new THREE.Matrix4();
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const dir = p1.clone().sub(p0).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        m.compose(mid, q, new THREE.Vector3(1, 1, 1));
        box.applyMatrix4(m);
        ribs.push(box);
      }
    }
    if (ribs.length) {
      this.group.add(
        new THREE.Mesh(
          mergeGeometries(ribs),
          new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.7, metalness: 0.8 })
        )
      );
      ribs.forEach((g) => g.dispose());
    }

    // light strips running along the crown
    for (const off of [-0.45, 0.45]) {
      const lg = this._loft(
        [
          { u: off - 0.06, h: 9.1, rel: false, uvx: 0 },
          { u: off + 0.06, h: 9.1, rel: false, uvx: 1 },
        ],
        { from: run[0], count: run.length - 1, closed: false, flip: true }
      );
      this.group.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0xcfefff, toneMapped: false, side: THREE.DoubleSide })));
    }
    this.tunnelRun = run;
  }

  // ------------------------------------------------------------ start line
  _buildStartLine() {
    const i = this.startIndex;
    const c = this.centers[i];
    const t = this.tangents[i];
    const r = this.rights[i];
    const up = this.ups[i];
    const hw = this.widths[i];

    // painted start/finish strip
    const stripe = this._loft(
      [
        { u: -1, h: 0.03, rel: true, uvx: 0 },
        { u: 1, h: 0.03, rel: true, uvx: 6 },
      ],
      { from: (i - 2 + this.N) % this.N, count: 4, closed: false, uvLengthScale: 1 / 1.3 }
    );
    this.group.add(
      new THREE.Mesh(
        stripe,
        new THREE.MeshStandardMaterial({ map: checkerTexture(2), roughness: 0.8, side: THREE.DoubleSide })
      )
    );

    // gantry
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x585d67, roughness: 0.6, metalness: 0.85 });
    const towerH = 13;
    const parts = [];
    for (const side of [-1, 1]) {
      const base = this.pointAt(i, side * (hw + 1.5));
      for (const dz of [-1.4, 1.4]) {
        const leg = new THREE.BoxGeometry(1.0, towerH, 1.0);
        leg.translate(base.x + t.x * dz, base.y + towerH / 2, base.z + t.z * dz);
        parts.push(leg);
      }
      for (let k = 1; k <= 3; k++) {
        const b = new THREE.BoxGeometry(0.5, 0.5, 3.2);
        b.rotateY(Math.atan2(t.x, t.z));
        b.translate(base.x, base.y + (towerH / 4) * k, base.z);
        parts.push(b);
      }
    }
    // cross beam
    const l = this.pointAt(i, -(hw + 1.5));
    const rgt = this.pointAt(i, hw + 1.5);
    const span = l.distanceTo(rgt);
    const beam = new THREE.BoxGeometry(span, 2.4, 2.6);
    const mid = l.clone().add(rgt).multiplyScalar(0.5);
    mid.y += towerH + 0.4;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), r.clone().setY(0).normalize());
    const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    beam.applyMatrix4(mm);
    parts.push(beam);
    gantry.add(new THREE.Mesh(mergeGeometries(parts), steel));
    parts.forEach((p) => p.dispose());

    // start lights (5 pods) — turned on during the countdown
    this.startLights = [];
    for (let k = 0; k < 5; k++) {
      const f = (k - 2) / 2.6;
      const p = mid.clone().addScaledVector(r, f * hw * 0.85).add(new THREE.Vector3(0, -0.2, 0));
      const pod = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.4, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.4 })
      );
      pod.position.copy(p);
      pod.quaternion.copy(q);
      gantry.add(pod);
      const bulb = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 16),
        new THREE.MeshBasicMaterial({ color: 0x220505, toneMapped: false })
      );
      bulb.position.copy(p).addScaledVector(t, -0.55);
      bulb.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.clone().negate()));
      gantry.add(bulb);
      this.startLights.push(bulb);
    }

    // banner
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 0.92, 4.6),
      new THREE.MeshBasicMaterial({ map: adTexture('MOTORBALL', '#0a0d16', '#ffb01e', 'IRON CITY GRAND PRIX'), toneMapped: false, side: THREE.DoubleSide })
    );
    banner.position.copy(mid).addScaledVector(t, -1.5).add(new THREE.Vector3(0, 3.6, 0));
    banner.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.clone().negate()));
    gantry.add(banner);

    this.group.add(gantry);
    this.startPoint = c.clone();
    void up;
  }

  // ------------------------------------------------------------------ ads
  _buildAds() {
    const ads = [
      ['FACTORY', '#101018', '#ff4a4a'],
      ['ZALEM', '#06131c', '#7df7ff'],
      ['KANSAS BAR', '#1a0f06', '#ffb347'],
      ['VECTOR IND.', '#120a1c', '#c07bff'],
      ['DOC IDO CYBERNETICS', '#08161a', '#5affc8'],
      ['NO.99 BATTLE ANGEL', '#160616', '#ff56c6'],
      ['HUNTER-WARRIOR', '#141008', '#ffd24a'],
      ['ROSCOE MOTORS', '#0a1020', '#66aaff'],
    ];
    const step = Math.round(46 / this.ds);
    let n = 0;
    const group = new THREE.Group();
    for (let i = 0; i < this.N; i += step) {
      const ad = ads[n % ads.length];
      n++;
      for (const side of [-1, 1]) {
        const hw = this.widths[i];
        const p = this.pointAt(i, side * hw * 1.02, this.cfg.wallHeight * 0.55);
        const t = this.tangents[i];
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(20, 2.6),
          new THREE.MeshBasicMaterial({ map: adTexture(ad[0], ad[1], ad[2]), toneMapped: false, side: THREE.DoubleSide })
        );
        mesh.position.copy(p).addScaledVector(this.rights[i], -side * 0.16);
        const dir = side < 0 ? t.clone() : t.clone().negate();
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-dir.z, 0, dir.x).normalize());
        mesh.lookAt(mesh.position.clone().addScaledVector(this.rights[i], -side * 10).setY(p.y));
        group.add(mesh);
      }
    }
    this.group.add(group);
  }

  /** 2D outline for the minimap. */
  outline(stepMeters = 6) {
    const step = Math.max(1, Math.round(stepMeters / this.ds));
    const pts = [];
    for (let i = 0; i < this.N; i += step) pts.push([this.centers[i].x, this.centers[i].z, this.centers[i].y]);
    return pts;
  }

  setStartLights(count, green = false) {
    this.startLights.forEach((b, k) => {
      const on = green ? true : k < count;
      b.material.color.setHex(green ? 0x39ff6a : on ? 0xff2020 : 0x220505);
    });
  }
}
