/* ============================================================================
 * TyreForge — tyre.js
 * Procedural 3D tyre: cross-section profile, tread band with true displaced
 * geometry (height-field → displacement map), carcass, rim, and export.
 *
 * World units: 1 unit = 1 mm.  Tyre axis = Z.  Spin = rotation around Z.
 * ========================================================================== */

'use strict';

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TreadField, rasterizePrimitive, applyWear } from './treads.js';
import { drawSidewall } from './sidewall.js';

const IN = 25.4;                       // inch → mm

/* --------------------------------------------------------------------------
 * Tyre size math — everything a racing game needs about the physical tyre
 * ------------------------------------------------------------------------ */
export function tyreMetrics(s) {
  const rimDia = s.rim * IN;
  const rimW = s.rimW * IN;
  const sidewall = s.sw * s.ar / 100;                 // section height mm
  const outerR = rimDia / 2 + sidewall + s.treadDepth;
  const treadW = s.sw * s.treadWidthFrac;
  return {
    rimDia, rimW, rimR: rimDia / 2,
    sidewall, outerR, capR: outerR - s.treadDepth,
    treadW,
    diameter: outerR * 2,
    circumference: 2 * Math.PI * outerR,
    revsPerKm: 1e6 / (2 * Math.PI * outerR),
    sizeText: `${s.sw}/${s.ar} R${s.rim}`,
    stretch: rimW - s.sw,                             // >0 = stretched fitment
  };
}

/* --------------------------------------------------------------------------
 * Cross-section profile.
 * Returns closed list of profile points [{r,z}] tracing:
 *   left bead lip → left shoulder → under-tread cap → right shoulder → bead
 * Sidewall halves are returned separately for textured meshes.
 * ------------------------------------------------------------------------ */
export function buildProfile(s) {
  const m = tyreMetrics(s);
  const Rb = m.rimR - 1;                     // bead seat radius
  const zRim = m.rimW / 2 + 3;               // lip sticks just past the rim
  const zMax = Math.max(s.sw / 2, m.rimW / 2 + 2);   // max section half-width
  const TW2 = m.treadW / 2;
  const arc = s.shoulderArc;                 // shoulder blend arc length (mm)

  /* helpers */
  const ss = t => t * t * (3 - 2 * t);       // smoothstep

  const half = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const u = i / N;                          // 0 bead → 1 shoulder edge
    let r, z;
    if (u < 0.5) {                            // bead → max width bulge
      const t = u / 0.5;
      r = Rb + (m.rimR + m.sidewall * 0.36 - Rb) * ss(t);
      z = zRim - (zRim - zMax) * ss(t);
    } else {                                  // max width → shoulder
      const t = (u - 0.5) / 0.5;
      r = m.rimR + m.sidewall * 0.36 + (m.capR - arc - (m.rimR + m.sidewall * 0.36)) * ss(t);
      z = zMax - (zMax - (TW2 - arc * 0.65)) * (t < 0.8 ? ss(t / 0.8) : 1);
    }
    half.push({ r, z });
  }
  /* shoulder fillet → tread edge */
  const FE = 6;
  for (let i = 1; i <= FE; i++) {
    const t = i / FE;
    const a = t * Math.PI / 2;
    half.push({
      r: m.capR - arc + Math.sin(a) * arc,
      z: (TW2 - arc * 0.65) + (TW2) * 0 + Math.sin(a) * arc * 0.65,
    });
  }
  const topR = half[half.length - 1].r;      // ≈ capR at tread edge
  /* stitch: left sidewall (bead→shoulder), cap, right sidewall (shoulder→bead) */
  const left = half.map(p => ({ r: p.r, z: -p.z }));
  const right = half.map(p => ({ r: p.r, z: p.z })).reverse();
  return { left, right, capTopR: topR, beadR: Rb, zRim };
}

/* --------------------------------------------------------------------------
 * Revolve helper: profile pts [{r,z}] around Z axis → BufferGeometry
 * with uv.u = angle, uv.v = normalised profile position.
 * ------------------------------------------------------------------------ */
export function revolve(pts, radial, vMap = null) {
  const geo = new THREE.BufferGeometry();
  const nP = pts.length;
  const pos = new Float32Array((radial + 1) * nP * 3);
  const uv = new Float32Array((radial + 1) * nP * 2);
  const idx = [];
  let k = 0, q = 0;
  for (let i = 0; i <= radial; i++) {
    const th = (i / radial) * Math.PI * 2;
    const c = Math.cos(th), s2 = Math.sin(th);
    for (let j = 0; j < nP; j++) {
      pos[k++] = pts[j].r * c; pos[k++] = pts[j].r * s2; pos[k++] = pts[j].z;
      uv[q++] = i / radial;
      uv[q++] = vMap ? vMap(j / (nP - 1), pts[j]) : j / (nP - 1);
    }
  }
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < nP - 1; j++) {
      const a = i * nP + j, b = a + nP;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------------------------------------------------
 * mirrorZ — mirror a revolve geometry across the z=0 plane, keeping the
 * triangle winding (and therefore outward normals) intact.
 * ------------------------------------------------------------------------ */
function mirrorZ(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -pos.getZ(i));
  const idx = geo.getIndex();
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1), c = idx.getX(i + 2);
    idx.setX(i + 1, c); idx.setX(i + 2, b);
  }
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------------------------------------------------
 * TyreView — owns the THREE objects; rebuilds on spec / pattern change.
 * ------------------------------------------------------------------------ */
export class TyreView {
  constructor() {
    this.group = new THREE.Group();
    this.hfW = 2048; this.hfH = 512;
    this.field = new TreadField(this.hfW, this.hfH);
    this.worn = null;
    this.spec = null; this.pattern = null;
    this.showRim = true;
    this.spin = 0; this.spinning = false;

    this._initMeshes();
  }

  _initMeshes() {
    /* tread band */
    this.treadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.7, metalness: 0.0,
    });
    /* sidewalls */
    this.sideMatL = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0 });
    this.sideMatR = this.sideMatL.clone();
    /* under-tread cap (visible inside deep grooves) */
    this.capMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.95, side: THREE.DoubleSide });
    /* rim */
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.32, metalness: 0.95 });
    this.rimFaceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.9 });

    this.treadMesh = new THREE.Mesh(); this.treadMesh.material = this.treadMat;
    this.sideL = new THREE.Mesh(); this.sideL.material = this.sideMatL;
    this.sideR = new THREE.Mesh(); this.sideR.material = this.sideMatR;
    this.cap = new THREE.Mesh(); this.cap.material = this.capMat;
    this.rim = new THREE.Group();

    this.group.add(this.treadMesh, this.sideL, this.sideR, this.cap, this.rim);
  }

  /* ------------------------------------------------------------------ */
  setRimVisible(v) { this.showRim = v; this.rim.visible = v; }

  /** effective groove depth: editor pattern depth overrides the size spec */
  depthNow() { return this.pattern?.depth ?? this.spec?.treadDepth ?? 6; }

  /* ---------- geometry + textures ------------------------------------ */

  /** Full rebuild: spec (size params) + pattern (prims/tiles/wear). */
  rebuild(spec, pattern, sidewallOpts) {
    this.spec = spec; this.pattern = pattern; this.sidewallOpts = sidewallOpts;
    const m = tyreMetrics(spec);
    this._buildCarcass(spec, m);
    this._buildBandGeometry(spec, m);
    this._buildRim(spec, m);
    this.rebakeTread();
    this._bakeSidewalls(m);
  }

  /** Re-rasterise height-field + all tread maps (pattern/wear/depth change). */
  rebakeTread() {
    const { spec, pattern } = this;
    if (!spec || !pattern) return;
    const m = tyreMetrics(spec);

    /* 1 — fresh height-field */
    this.field.reset();
    for (const p of pattern.prims) rasterizePrimitive(this.field, p);

    /* 2 — wear */
    const wz = applyWear(this.field, pattern.wear ?? 0, pattern.camber ?? 0, pattern.seed ?? 7);
    this.worn = wz.data; this.wornTop = wz.top;

    /* 3 — textures */
    this._makeTreadMaps(m);
  }

  _buildCarcass(spec, m) {
    const P = buildProfile(spec);
    this.profilePts = P;
    const radial = 220;

    /* sidewalls: v=0 at bead lip → v=1 at tread edge; right side is the
     * mirrored left (identical UVs, corrected winding + normals).      */
    const geoL = revolve(P.left, radial);
    const geoR = mirrorZ(geoL.clone());
    this.sideL.geometry?.dispose(); this.sideL.geometry = geoL;
    this.sideR.geometry?.dispose(); this.sideR.geometry = geoR;

    /* under-tread cap: half mm below the displacement base */
    const capPts = [];
    const NN = 24;
    for (let i = 0; i <= NN; i++) {
      const t = i / NN;
      capPts.push({
        r: m.capR - 0.6 - Math.sin(t * Math.PI) * 0.4,
        z: -P.left[P.left.length - 1].z + (2 * P.left[P.left.length - 1].z) * t,
      });
    }
    this.cap.geometry?.dispose(); this.cap.geometry = revolve(capPts, 120);
  }

  /** Tread band: custom parametric strip carrying the displacement. */
  _buildBandGeometry(spec, m) {
    const wrap = spec.shoulderArc + 4;            // strip extends over shoulder
    const TW = m.treadW, capR = m.capR;
    const crown = spec.crown ?? 2;
    const td = this.depthNow();

    this.band = { wrap, TW, capR, crown, segU: 1024, segV: 96 };
    const { segU, segV } = this.band;

    const pos = new Float32Array((segU + 1) * (segV + 1) * 3);
    const uv = new Float32Array((segU + 1) * (segV + 1) * 2);
    let k = 0, q = 0;
    for (let j = 0; j <= segV; j++) {
      const t = j / segV;                         // 0..1 across (incl. wrap)
      const zAbs = (t - 0.5) * (TW + 2 * wrap);   // mm from centre plane
      const a = Math.abs(zAbs);
      let r = capR + crown * Math.max(0, 1 - Math.pow(Math.min(1, a / (TW / 2)), 2));
      if (a > TW / 2) {                           // roll down the shoulder
        const tt = (a - TW / 2) / wrap;
        r = capR - Math.sin(tt * Math.PI / 2) * (td * 0.7 + 2.5);
      }
      /* texcoord v: clamp so edge pixels stretch over the wrap zone */
      const vTex = Math.max(0, Math.min(1, zAbs / TW + 0.5));
      for (let i = 0; i <= segU; i++) {
        const th = (i / segU) * Math.PI * 2;
        pos[k++] = r * Math.cos(th);
        pos[k++] = r * Math.sin(th);
        pos[k++] = zAbs;
        uv[q++] = i / segU;
        uv[q++] = vTex;
      }
    }
    const idx = [];
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = j * (segU + 1) + i, b = a + segU + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.treadMesh.geometry?.dispose();
    this.treadMesh.geometry = g;
  }

  _buildRim(spec, m) {
    this.rim.clear();
    const RR = m.rimR, RH = m.rimW / 2;
    /* barrel */
    const pts = [
      { r: RR - 16, z: -RH - 2 }, { r: RR - 5, z: -RH + 2 }, { r: RR, z: -RH + 5 },
      { r: RR, z: RH - 5 }, { r: RR - 5, z: RH - 2 }, { r: RR - 16, z: RH + 2 },
      { r: RR - 16, z: 0 },
    ];
    const barrel = new THREE.Mesh(revolve(pts, 96), this.rimMat);
    this.rim.add(barrel);
    /* spokes face (textured disc) */
    const face = new THREE.Mesh(new THREE.CircleGeometry(RR - 6, 72), this.rimFaceMat);
    face.position.z = RH - 6;
    const faceB = face.clone(); faceB.rotation.y = Math.PI; faceB.position.z = -RH + 6;
    this.rim.add(face, faceB);
    /* hub */
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, RH * 2 - 10, 24), this.rimMat);
    hub.rotation.x = Math.PI / 2;
    this.rim.add(hub);
    this.rim.visible = this.showRim;
    this._bakeRimFace(RR - 6);
  }

  _bakeRimFace(R) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#93989e'; g.fillRect(0, 0, 512, 512);
    const cx = 256, cy = 256;
    g.save(); g.translate(cx, cy);
    /* 5 spokes */
    for (let i = 0; i < 5; i++) {
      g.rotate(Math.PI * 2 / 5);
      g.fillStyle = '#6f747a';
      g.beginPath();
      g.moveTo(-26, 0); g.quadraticCurveTo(-46, -140, 0, -232);
      g.quadraticCurveTo(46, -140, 26, 0); g.closePath(); g.fill();
      /* lug hole */
      g.fillStyle = '#2b2d30'; g.beginPath(); g.arc(0, -58, 13, 0, 7); g.fill();
      g.fillStyle = '#c9cdd2'; g.beginPath(); g.arc(0, -58, 8, 0, 7); g.fill();
    }
    g.fillStyle = '#383b3f'; g.beginPath(); g.arc(0, 0, 34, 0, 7); g.fill();
    g.fillStyle = '#b9bec4'; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill();
    g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    if (this.rimFaceMat.map) this.rimFaceMat.map.dispose();
    this.rimFaceMat.map = t; this.rimFaceMat.needsUpdate = true;
  }

  /* ---------- tread texture bake -------------------------------------- */
  _makeTreadMaps(m) {
    const { spec, pattern } = this;
    const W = this.hfW, H = this.hfH;
    const tiles = pattern.tiles;
    const td = this.depthNow();
    const wear = pattern.wear ?? 0;

    /* --- height/displacement canvas --- */
    const cD = document.createElement('canvas'); cD.width = W; cD.height = H;
    const gD = cD.getContext('2d');
    const imgD = gD.createImageData(W, H);

    /* --- albedo --- */
    const cA = document.createElement('canvas'); cA.width = W; cA.height = H;
    const gA = cA.getContext('2d');
    const imgA = gA.createImageData(W, H);

    /* --- roughness --- */
    const cR = document.createElement('canvas'); cR.width = W; cR.height = H;
    const gR = cR.getContext('2d');
    const imgR = gR.createImageData(W, H);

    /* --- normal map (Sobel over worn field) --- */
    const cN = document.createElement('canvas'); cN.width = W; cN.height = H;
    const gN = cN.getContext('2d');
    const imgN = gN.createImageData(W, H);

    /* world size of one texel */
    const circTile = (2 * Math.PI * m.outerR) / tiles;
    const dxW = circTile / W, dyW = m.treadW / H;
    const normK = 2.0;

    /* compound base rgb */
    const cc = new THREE.Color(spec.compound.color ?? 0x1c1c1c);
    const cR8 = cc.r * 255, cG8 = cc.g * 255, cB8 = cc.b * 255;
    const baseRough = spec.compound.rough ?? 0.65;

    const F = this.worn, T = this.wornTop;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, i4 = i * 4;
        const h = F[i];

        /* displacement */
        const dv = h * 255;
        imgD.data[i4] = imgD.data[i4 + 1] = imgD.data[i4 + 2] = dv; imgD.data[i4 + 3] = 255;

        /* normal from central differences (wrap in x) */
        const xl = F[y * W + ((x - 1 + W) % W)], xr = F[y * W + ((x + 1) % W)];
        const yu = F[Math.max(0, y - 1) * W + x], yd = F[Math.min(H - 1, y + 1) * W + x];
        let nx = (xl - xr) * (td * normK) / (2 * dxW);
        let ny = (yu - yd) * (td * normK) / (2 * dyW);
        const nl = Math.sqrt(nx * nx + ny * ny + 1);
        imgN.data[i4] = (nx / nl * 0.5 + 0.5) * 255;
        imgN.data[i4 + 1] = (ny / nl * 0.5 + 0.5) * 255;
        imgN.data[i4 + 2] = (1 / nl * 0.5 + 0.5) * 255;
        imgN.data[i4 + 3] = 255;

        /* albedo: grooves darker, worn tops polished lighter */
        const depthShade = 0.42 + 0.58 * Math.pow(h, 0.8);
        const polished = (wear > 0.02 && h >= T[i] - 0.002) ? wear * 46 : 0;
        imgA.data[i4]     = Math.min(255, cR8 * depthShade + polished);
        imgA.data[i4 + 1] = Math.min(255, cG8 * depthShade + polished);
        imgA.data[i4 + 2] = Math.min(255, cB8 * depthShade + polished);
        imgA.data[i4 + 3] = 255;

        /* roughness: polished contact rubber vs raw groove rubber */
        let rough = baseRough + (1 - h) * 0.25;
        if (wear > 0.02 && h >= T[i] - 0.002) rough = Math.max(0.22, baseRough - wear * 0.5);
        const rv = rough * 255;
        imgR.data[i4] = imgR.data[i4 + 1] = imgR.data[i4 + 2] = rv; imgR.data[i4 + 3] = 255;
      }
    }
    gD.putImageData(imgD, 0, 0); gA.putImageData(imgA, 0, 0);
    gR.putImageData(imgR, 0, 0); gN.putImageData(imgN, 0, 0);

    /* cosmetic studs on albedo/roughness */
    for (const [sx, sy, sr] of this.field.studs) {
      const px = sx * W, py = sy * H, pr = sr * H;
      gA.fillStyle = '#b9c1c9'; gA.beginPath(); gA.arc(px, py, pr, 0, 7); gA.fill();
      gA.fillStyle = '#5f666e'; gA.beginPath(); gA.arc(px, py, pr * 0.45, 0, 7); gA.fill();
      gR.fillStyle = '#2a2a2a'; gR.beginPath(); gR.arc(px, py, pr, 0, 7); gR.fill();
    }

    /* store canvases for export & maps panel */
    this.maps = { disp: cD, albedo: cA, rough: cR, normal: cN };

    const set = (key, canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.x = tiles;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (this.treadMat[key]) this.treadMat[key].dispose();
      this.treadMat[key] = t;
    };
    set('map', cA, true);
    set('roughnessMap', cR, false);
    set('normalMap', cN, false);
    set('displacementMap', cD, false);
    this.treadMat.displacementScale = td;
    this.treadMat.displacementBias = 0;
    this.treadMat.roughness = 1.0;            // driven by map
    this.treadMat.normalScale.set(1, 1);
    this.treadMat.needsUpdate = true;
  }

  _bakeSidewalls(m) {
    const spec = this.spec, opts = this.sidewallOpts;
    /* two canvases: right side drawn mirrored so text reads correctly */
    for (const side of ['L', 'R']) {
      const c = drawSidewall({
        brand: opts.brand, model: opts.model,
        sizeText: m.sizeText, loadIdx: opts.loadIdx ?? '94Y',
        line1: spec.sidewall?.text ?? '', ring: spec.sidewall?.ring ?? '#c0362c',
        arrow: spec.sidewall?.arrow ?? false, raised: spec.sidewall?.raised ?? false,
        aspect: (m.sidewall / (m.treadW / 2)), mirror: side === 'L',
        compoundColor: spec.compound?.color ?? 0x1c1c1c,
      });
      this.sidewallCanvases = this.sidewallCanvases || [];
      this.sidewallCanvases[side === 'L' ? 0 : 1] = c;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      const mat = side === 'L' ? this.sideMatL : this.sideMatR;
      if (mat.map) mat.map.dispose();
      mat.map = t; mat.needsUpdate = true;
    }
  }

  /* ---------- runtime ------------------------------------------------- */
  update(dt) {
    if (this.spinning) {
      this.spin += dt;
      this.group.rotation.z -= dt * 2.4;
    }
  }

  /* ---------- export --------------------------------------------------- */

  /** Bake worn displacement into real geometry and export GLB. */
  exportGLB(onDone) {
    const exporter = new GLTFExporter();
    const { spec, pattern } = this;
    const m = tyreMetrics(spec);
    const { wrap, TW, capR, crown } = this.band;

    const segU = 1024, segV = 96;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((segU + 1) * (segV + 1) * 3);
    const uv = new Float32Array((segU + 1) * (segV + 1) * 2);
    const W = this.hfW, H = this.hfH;
    let k = 0, q = 0;
    for (let j = 0; j <= segV; j++) {
      const t = j / segV;
      const zAbs = (t - 0.5) * (TW + 2 * wrap);
      const a = Math.abs(zAbs);
      let r = capR + crown * Math.max(0, 1 - Math.pow(Math.min(1, a / (TW / 2)), 2));
      let hTex = null;
      const vTex = Math.max(0, Math.min(1, zAbs / TW + 0.5));
      if (a <= TW / 2) hTex = vTex;
      for (let i = 0; i <= segU; i++) {
        const th = (i / segU) * Math.PI * 2;
        let rr = r;
        if (hTex !== null) {
          /* sample worn height field at tiled u */
          const uTile = ((i / segU) * pattern.tiles) % 1;
          const fx = uTile * (W - 1), fy = vTex * (H - 1);
          const hh = this.worn[Math.round(fy) * W + Math.round(fx)];
          rr += hh * this.depthNow();
        } else {
          rr -= Math.sin(((a - TW / 2) / wrap) * Math.PI / 2) * (this.depthNow() * 0.7 + 2.5);
        }
        pos[k++] = rr * Math.cos(th); pos[k++] = rr * Math.sin(th); pos[k++] = zAbs;
        uv[q++] = i / segU; uv[q++] = vTex;
      }
    }
    const idx = [];
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
      const a2 = j * (segU + 1) + i, b = a2 + segU + 1;
      idx.push(a2, a2 + 1, b, b, a2 + 1, b + 1);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: this.treadMat.map, normalMap: this.treadMat.normalMap,
      roughnessMap: this.treadMat.roughnessMap, roughness: 1, metalness: 0,
    });
    const tread = new THREE.Mesh(geo, mat); tread.name = 'Tread';

    const grp = new THREE.Group(); grp.name = 'Tyre';
    grp.add(tread);
    const sL = this.sideL.clone(); sL.name = 'Sidewall_L'; grp.add(sL);
    const sR = this.sideR.clone(); sR.name = 'Sidewall_R'; grp.add(sR);
    const cap = this.cap.clone(); cap.name = 'UnderTread'; grp.add(cap);
    if (this.showRim) { const rim = this.rim.clone(); rim.name = 'Rim'; grp.add(rim); }
    /* convert mm → m for game engines */
    grp.scale.setScalar(0.001);

    exporter.parse(grp, buf => onDone(buf), err => console.error(err), { binary: true });
  }

  /** Download the baked maps as PNGs (game-ready texture set). */
  getMapURLs() {
    const out = {};
    for (const k of Object.keys(this.maps)) out[k] = this.maps[k].toDataURL('image/png');
    if (this.sidewallCanvases) out.sidewalls = this.sidewallCanvases.map(c => c.toDataURL('image/png'));
    return out;
  }
}
