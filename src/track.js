// ============================================================================
// track.js — "Iron City Circuit"
// A redesign of the Alita: Battle Angel Motorball arena track, for racecars.
// The velodrome loop becomes a banked roval: flat main straight into a banked
// right-side bowl ("Bank of Zalem"), a technical infield esses section, then
// the huge 18° "Factory Turn" superspeedway bowl back onto the straight.
// Fully walled like the arena in the film — hazard-striped barriers that you
// can scrape but never leave.
// ============================================================================
import * as THREE from 'three';

const TAU = Math.PI * 2;

// Control points: [x, z, elevation, bankingDegrees]
// Point 0 sits mid main-straight → u = 0 is the start/finish line.
const POINTS = [
  [-60, 150, 0.0, 0],    // 0  start/finish (main straight, heading +x)
  [80, 150, 0.0, 0],    // 1  main straight
  [180, 146, 0.0, 2],    // 2  braking zone, bank ramps in
  [238, 106, 1.0, 8],    // 3  T1 "Bank of Zalem" — fast left
  [262, 40, 1.8, 10],   // 4  T1 apex
  [240, -28, 2.2, 8],    // 5  T1 exit, still banked
  [192, -80, 2.6, 3],    // 6  esses — left
  [132, -86, 2.8, -3],   // 7  esses — right flick
  [74, -124, 3.2, 3],    // 8  esses — left
  [-8, -158, 3.4, 1],    // 9  exit onto back diagonal
  [-132, -172, 3.0, 4],    // 10 back diagonal, building speed
  [-226, -138, 2.6, 12],   // 11 "Factory Turn" — dive into the big bowl
  [-272, -52, 3.4, 18],   // 12 bowl apex, full 18 degrees
  [-252, 44, 3.2, 17],   // 13 still in the bowl
  [-190, 104, 2.4, 10],   // 14 bowl exit, unwinding
  [-128, 140, 1.0, -3],   // 15 right flick back onto the straight
];

export class Track {
  constructor(scene) {
    this.halfW = 13;          // half road width (26 m — motorball scale)
    this.roadLift = 0.25;     // road sits above ground plane
    this.N = 768;             // samples around the loop

    this.curve = new THREE.CatmullRomCurve3(
      POINTS.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal', 0.5
    );

    // Per-point banking in radians, with the smooth interpolation in u-space.
    this.pointElev = POINTS.map(p => p[2]);
    this.pointBank = POINTS.map(p => THREE.MathUtils.degToRad(p[3]));
    this.nP = POINTS.length;

    this._buildSamples();

    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildGround(scene);
    this._buildRoad();
    this._buildKerbs();
    this._buildWalls();
    this._buildStartLine();
    this._buildGantry();
    this._buildPitBuilding();
    this._buildSpatialHash();
  }

  // ------------------------------------------------- u-space helpers
  _bankAt(u) {
    u = ((u % 1) + 1) % 1;
    const x = u * this.nP;
    const i = Math.floor(x) % this.nP;
    const f = x - Math.floor(x);
    const s = f * f * (3 - 2 * f);
    const a = this.pointBank[i], b = this.pointBank[(i + 1) % this.nP];
    // Wrap bank values across the seam if the circuit ever crosses +-PI
    return a + (b - a) * s;
  }
  _elevAt(u) {
    u = ((u % 1) + 1) % 1;
    const x = u * this.nP;
    const i = Math.floor(x) % this.nP;
    const f = x - Math.floor(x);
    const s = f * f * (3 - 2 * f);
    const a = this.pointElev[i], b = this.pointElev[(i + 1) % this.nP];
    return a + (b - a) * s;
  }

  _buildSamples() {
    const N = this.N;
    this.sPos = []; this.sTan = []; this.sSide = []; this.sBank = [];
    this.sEdgeL = []; this.sEdgeR = [];
    this.cumLen = new Float32Array(N + 1);
    const up = new THREE.Vector3(0, 1, 0);
    let prev = null, cum = 0;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = this.curve.getPoint(u);
      const t = this.curve.getTangent(u).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(t, up).normalize(); // right side
      const bank = this._bankAt(u);
      const elev = this._elevAt(u);
      p.y = elev + this.roadLift;
      this.sPos.push(p); this.sTan.push(t); this.sSide.push(side); this.sBank.push(bank);

      const cb = Math.cos(bank), sb = Math.sin(bank);
      const off = new THREE.Vector3().copy(side).multiplyScalar(cb).addScaledVector(up, sb);
      // remember: +o = right side ; right edge HIGHER when bank>0 is wrong way —
      // bank>0 must raise the OUTSIDE of a left-hander, i.e. the right edge here.
      const eR = p.clone().addScaledVector(off, this.halfW);
      const eL = p.clone().addScaledVector(off, -this.halfW);
      this.sEdgeR.push(eR); this.sEdgeL.push(eL);

      if (prev) cum += p.distanceTo(prev);
      this.cumLen[i] = cum;
      prev = p;
    }
    this.cumLen[N] = cum + this.sPos[N - 1].distanceTo(this.sPos[0]);
    this.length = this.cumLen[N];
  }

  // Road surface point at sample index i and lateral offset o (+ = right of travel)
  surfacePoint(i, o, out) {
    out = out || new THREE.Vector3();
    const p = this.sPos[i], side = this.sSide[i], bank = this.sBank[i];
    const cb = Math.cos(bank), sb = Math.sin(bank);
    out.copy(p).addScaledVector(side, o * cb);
    out.y = p.y + o * sb;
    return out;
  }
  surfaceNormal(i, out) {
    out = out || new THREE.Vector3();
    const side = this.sSide[i], bank = this.sBank[i];
    out.copy(side).multiplyScalar(-Math.sin(bank));
    out.y = Math.cos(bank);
    return out;
  }

  // ------------------------------------------------- geometry builders
  _hazardTexture(stripeW = 26, grime = false) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#e8b90c'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#151517';
    for (let x = -256; x < 512; x += stripeW * 2) {
      g.beginPath();
      g.moveTo(x, 256); g.lineTo(x + 256, 0); g.lineTo(x + 256 + stripeW, 0); g.lineTo(x + stripeW, 256);
      g.fill();
    }
    if (grime) {
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${10 + Math.random() * 40 | 0},${10 + Math.random() * 35 | 0},${12 + Math.random() * 30 | 0},${Math.random() * 0.25})`;
        const r = 1 + Math.random() * 6;
        g.fillRect(Math.random() * 256, Math.random() * 256, r, r * (0.3 + Math.random()));
      }
      g.strokeStyle = 'rgba(20,20,22,0.5)';
      for (let i = 0; i < 30; i++) {
        g.beginPath();
        const y = Math.random() * 256;
        g.moveTo(Math.random() * 256, y);
        g.lineTo(Math.random() * 256, y + (Math.random() - 0.5) * 14);
        g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _asphaltTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#26282c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) {
      const v = 26 + Math.random() * 34 | 0;
      g.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
    // faint tire darkening in the middle (racing groove)
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(12,12,14,0.55)');
    grad.addColorStop(0.18, 'rgba(12,12,14,0.0)');
    grad.addColorStop(0.42, 'rgba(10,10,12,0.28)');
    grad.addColorStop(0.58, 'rgba(10,10,12,0.28)');
    grad.addColorStop(0.82, 'rgba(12,12,14,0.0)');
    grad.addColorStop(1, 'rgba(12,12,14,0.55)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildGround(scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#181a1e'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1500; i++) {
      const v = 18 + Math.random() * 22 | 0;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90); tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);
  }

  _ribbon(offsets, material, vRepeat, matSide = THREE.FrontSide, yLift = 0) {
    // offsets: array of lateral offsets (right-positive) → one vertex row each
    const N = this.N, K = offsets.length;
    const pos = new Float32Array(N * K * 3);
    const nor = new Float32Array(N * K * 3);
    const uv = new Float32Array(N * K * 2);
    const idx = [];
    const tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const cum = this.cumLen[i];
      for (let k = 0; k < K; k++) {
        this.surfacePoint(i, offsets[k], tmpP);
        this.surfaceNormal(i, tmpN);
        const vi = (i * K + k);
        pos[vi * 3] = tmpP.x; pos[vi * 3 + 1] = tmpP.y + yLift; pos[vi * 3 + 2] = tmpP.z;
        nor[vi * 3] = tmpN.x; nor[vi * 3 + 1] = tmpN.y; nor[vi * 3 + 2] = tmpN.z;
        uv[vi * 2] = k / (K - 1);
        uv[vi * 2 + 1] = cum / vRepeat;
      }
    }
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      for (let k = 0; k < K - 1; k++) {
        const a = i * K + k, b = a + 1, c = i2 * K + k, d = c + 1;
        idx.push(a, d, c, a, b, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, material);
    mesh.material.side = matSide;
    this.group.add(mesh);
    return mesh;
  }

  _buildRoad() {
    const mat = new THREE.MeshStandardMaterial({
      map: this._asphaltTexture(), roughness: 0.93, metalness: 0.04,
    });
    const w = this.halfW;
    // road with a little shoulder skirt that drops to the ground
    this.road = this._ribbon([-w, -w * 0.5, 0, w * 0.5, w], mat, 26);

    // outer aprons sloping down (visual skirt so banking doesn't float)
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 1 });
    const mkSkirt = (sideSign) => {
      const N = this.N, K = 2;
      const pos = new Float32Array(N * K * 3);
      const nor = new Float32Array(N * K * 3);
      const uv = new Float32Array(N * K * 2);
      const idx = [];
      const tmp = new THREE.Vector3(), tmpN = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const o = sideSign * (this.halfW);
        this.surfacePoint(i, o, tmp);
        this.surfaceNormal(i, tmpN);
        const out = tmp.clone().addScaledVector(this.sSide[i], sideSign * 9 * Math.cos(this.sBank[i]));
        for (let k = 0; k < K; k++) {
          const vi = i * K + k;
          const P = k === 0 ? tmp : out;
          pos[vi * 3] = P.x; pos[vi * 3 + 1] = k === 0 ? P.y - 0.02 : Math.max(0.02, P.y - 4.5); pos[vi * 3 + 2] = P.z;
          nor[vi * 3] = tmpN.x; nor[vi * 3 + 1] = tmpN.y; nor[vi * 3 + 2] = tmpN.z;
          uv[vi * 2] = k; uv[vi * 2 + 1] = this.cumLen[i] / 30;
        }
      }
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        const a = i * K, b = a + 1, c = j * K, d = c + 1;
        idx.push(a, d, c, a, b, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      this.group.add(new THREE.Mesh(geo, skirtMat));
    };
    mkSkirt(1); mkSkirt(-1);
  }

  _buildKerbs() {
    const tex = this._hazardTexture(20, true);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.05 });
    const w = this.halfW;
    // hazard-painted kerb strips flat on the road just inside the walls
    this._ribbon([w - 1.7, w - 0.35], mat, 7, THREE.DoubleSide, 0.03);
    this._ribbon([-(w - 0.35), -(w - 1.7)], mat, 7, THREE.DoubleSide, 0.03);
  }

  _wall(sideSign, matHazard, matRail) {
    const N = this.N, K = 2;
    const pos = new Float32Array(N * K * 3);
    const nor = new Float32Array(N * K * 3);
    const uv = new Float32Array(N * K * 2);
    const idx = [];
    const tmpB = new THREE.Vector3();
    const heights = [];
    for (let i = 0; i < N; i++) {
      // outer wall grows tall on the banked (outside) edge — the motorball bowl wall
      const outer = sideSign > 0 ? Math.max(0, Math.sin(this.sBank[i])) : Math.max(0, -Math.sin(this.sBank[i]));
      heights.push(1.15 + 8.5 * Math.pow(outer, 1.25));
    }
    for (let i = 0; i < N; i++) {
      const o = sideSign * (this.halfW + 0.55);
      this.surfacePoint(i, o, tmpB);
      const side = this.sSide[i];
      for (let k = 0; k < K; k++) {
        const vi = i * K + k;
        pos[vi * 3] = tmpB.x;
        pos[vi * 3 + 1] = tmpB.y + (k === 0 ? -0.1 : heights[i]);
        pos[vi * 3 + 2] = tmpB.z;
        // face back toward the road
        nor[vi * 3] = -side.x * sideSign; nor[vi * 3 + 1] = 0; nor[vi * 3 + 2] = -side.z * sideSign;
        uv[vi * 2] = k;
        uv[vi * 2 + 1] = this.cumLen[i] / 14;
      }
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = i * K, b = a + 1, c = j * K, d = c + 1;
      if (sideSign > 0) idx.push(a, c, d, a, b, c);
      else idx.push(a, d, c, a, b, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.group.add(new THREE.Mesh(geo, matHazard));

    // glowing rail strip along the top of the wall (cyan energy line)
    const railPos = new Float32Array(N * K * 3);
    for (let i = 0; i < N; i++) {
      const o = sideSign * (this.halfW + 0.5);
      this.surfacePoint(i, o, tmpB);
      for (let k = 0; k < K; k++) {
        const vi = i * K + k;
        railPos[vi * 3] = tmpB.x;
        railPos[vi * 3 + 1] = tmpB.y + heights[i] + (k === 0 ? -0.02 : 0.12);
        railPos[vi * 3 + 2] = tmpB.z;
      }
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(railPos, 3));
    rgeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    rgeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    rgeo.setIndex(idx.slice());
    this.group.add(new THREE.Mesh(rgeo, matRail));
  }

  _buildWalls() {
    const hazTex = this._hazardTexture(30, true);
    const matHazard = new THREE.MeshStandardMaterial({
      map: hazTex, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide,
    });
    const matRail = new THREE.MeshBasicMaterial({ color: 0x2ee6ff, toneMapped: false, side: THREE.DoubleSide });
    matRail.color.multiplyScalar(1.6);
    this._wall(1, matHazard, matRail);
    this._wall(-1, matHazard, matRail);
  }

  _buildStartLine() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#e8e8ea' : '#0c0c0e';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96 });
    // quad across the road at sample 0
    const L = this.surfacePoint(0, -this.halfW + 0.3);
    const R = this.surfacePoint(0, this.halfW - 0.3);
    const T = this.sTan[0];
    const geo = new THREE.BufferGeometry();
    const Lb = L.clone().addScaledVector(T, -2.2), Lf = L.clone().addScaledVector(T, 2.2);
    const Rb = R.clone().addScaledVector(T, -2.2), Rf = R.clone().addScaledVector(T, 2.2);
    const pos = new Float32Array([
      Lb.x, Lb.y + 0.05, Lb.z, Rb.x, Rb.y + 0.05, Rb.z, Lf.x, Lf.y + 0.05, Lf.z,
      Rb.x, Rb.y + 0.05, Rb.z, Rf.x, Rf.y + 0.05, Rf.z, Lf.x, Lf.y + 0.05, Lf.z,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    // flip texture so it reads across
    const mesh = new THREE.Mesh(geo, mat);
    mesh.material.side = THREE.DoubleSide;
    this.group.add(mesh);
  }

  _gantryTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const g = c.getContext('2d');
    // checker band top+bottom
    for (let x = 0; x < 64; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111114' : '#dfe3e6';
      g.fillRect(x * 16, y * 16, 16, 16);
      g.fillRect(x * 16, 112 - 16 + y * 16, 16, 16);
    }
    g.fillStyle = '#0a0d12'; g.fillRect(0, 32, 1024, 80);
    g.strokeStyle = '#2ee6ff'; g.lineWidth = 3;
    g.strokeRect(4, 36, 1016, 72);
    g.font = '900 56px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd320';
    g.fillText('MOTOR BALL GP', 512, 74);
    g.fillStyle = '#2ee6ff';
    g.font = '700 30px Arial';
    g.fillText('‹  IRON CITY CIRCUIT  ›', 512, 74); // layered glow reads nicely from far
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildGantry() {
    const grp = new THREE.Group();
    const i = 0;
    const P = this.sPos[i], T = this.sTan[i], S = this.sSide[i];
    const matMetal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.8 });
    const w = this.halfW + 2.2;

    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 8.6, 8), matMetal);
      const base = this.surfacePoint(i, s * w);
      pylon.position.set(base.x, base.y + 4.3, base.z);
      grp.add(pylon);
    }
    // truss beam
    const beamLen = w * 2 + 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 1.4, 1.4), matMetal);
    const mid = P.clone().addScaledVector(S, 0); mid.y += 7.6;
    beam.position.copy(mid);
    beam.rotation.y = Math.atan2(T.x, T.z);
    grp.add(beam);

    // banner
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(beamLen - 1, 2.6),
      new THREE.MeshBasicMaterial({ map: this._gantryTexture(), side: THREE.DoubleSide, toneMapped: false })
    );
    banner.position.copy(mid).addScaledVector(T, 0.8);
    banner.position.y = mid.y - 0.35;
    banner.rotation.y = Math.atan2(T.x, T.z);
    grp.add(banner);

    // start lights (game switches red → green)
    this.startLightMats = [];
    for (let k = 0; k < 4; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x330a0a, toneMapped: false });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), m);
      bulb.position.copy(mid).addScaledVector(S, (k - 1.5) * 1.1);
      bulb.position.addScaledVector(T, -0.9);
      bulb.position.y = mid.y - 1.35;
      grp.add(bulb);
      this.startLightMats.push(m);
    }
    this.group.add(grp);
  }

  _buildPitBuilding() {
    const grp = new THREE.Group();
    // long garage block on the infield side of the main straight
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#23262d'; g.fillRect(0, 0, 512, 128);
    // garage doors
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#101317'; g.fillRect(10 + i * 63, 54, 52, 66);
      g.strokeStyle = '#3a4149'; g.strokeRect(10 + i * 63, 54, 52, 66);
      g.fillStyle = i % 2 ? '#2ee6ff' : '#ffd320';
      g.fillRect(10 + i * 63, 50, 52, 4);
      for (let l = 0; l < 5; l++) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(12 + i * 63, 60 + l * 12, 48, 3); }
    }
    // upper windows
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(120,220,255,0.5)';
      g.fillRect(8 + i * 43, 12, 32, 26);
    }
    g.fillStyle = '#e8b90c'; g.font = '900 22px Arial'; g.textAlign = 'center';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.2 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(150, 9, 13), mat);
    block.position.set(-32, 4.5, 112);
    grp.add(block);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(152, 0.8, 15),
      new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 0.9 })
    );
    roof.position.set(-32, 9.3, 112);
    grp.add(roof);

    // pit wall (low barrier between garages and the circuit)
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(150, 1.05, 0.7),
      new THREE.MeshStandardMaterial({ map: this._hazardTexture(18, true), roughness: 0.8 })
    );
    wall.position.set(-32, 0.5, 121.5);
    grp.add(wall);

    // glowing rail on pit roof
    const strip = new THREE.Mesh(new THREE.BoxGeometry(150, 0.18, 0.18),
      new THREE.MeshBasicMaterial({ color: 0x2ee6ff, toneMapped: false }));
    strip.position.set(-32, 9.8, 118);
    grp.add(strip);

    this.group.add(grp);
  }

  // ------------------------------------------------- queries
  _buildSpatialHash() {
    this.cell = 24;
    this.hash = new Map();
    for (let i = 0; i < this.N; i++) {
      const p = this.sPos[i];
      const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const key = (cx + dx) + ',' + (cz + dz);
        let arr = this.hash.get(key);
        if (!arr) { arr = []; this.hash.set(key, arr); }
        arr.push(i);
      }
    }
  }

  // Locate car relative to the circuit. Returns {i, f, d, y, along}
  //  i   : nearest sample index    f : fractional advance toward next sample
  //  d   : lateral offset (+ right of travel)   y: road surface height at (i+f, d)
  locate(x, z, out = {}) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD2 = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this.hash.get((cx + dx) + ',' + (cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const p = this.sPos[i];
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
    }
    if (best < 0) best = 0;
    const p = this.sPos[best], t = this.sTan[best], s = this.sSide[best];
    const rx = x - p.x, rz = z - p.z;
    let along = rx * t.x + rz * t.z;
    const d = rx * s.x + rz * s.z;
    const next = (best + 1) % this.N;
    const segLen = this.sPos[best].distanceTo(this.sPos[next]) || 1;
    const f = THREE.MathUtils.clamp(along / segLen, 0, 1);
    // interpolate surface frame
    const bank = this.sBank[best] + (this.sBank[next] - this.sBank[best]) * f;
    const y0 = this.sPos[best].y + (this.sPos[next].y - this.sPos[best].y) * f;
    const y = y0 + Math.sin(bank) * d;
    out.i = best; out.f = f; out.d = d; out.y = y;
    out.progress = (best + f) / this.N;
    out.tan = t; out.side = s;
    return out;
  }

  // spawn pose at a given progress
  spawnPose(progress) {
    const i = Math.floor(progress * this.N) % this.N;
    const p = this.sPos[i], t = this.sTan[i];
    return {
      x: p.x, y: p.y, z: p.z,
      yaw: Math.atan2(t.x, t.z),
    };
  }
}
