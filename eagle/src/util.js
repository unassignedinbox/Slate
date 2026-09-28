import * as THREE from 'three';

// ---------- deterministic hash / noise ----------
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash2(a, b) { return hash(a * 12.9898 + b * 78.233); }
export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
// smooth value noise in 1D (for organic wander)
export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 57.31), hash(i + 1 + seed * 57.31), u) * 2 - 1;
}

// ---------- loft: rings of ellipses along Z ----------
// sections: [{z, rx, ry, x=0, y=0}] ordered along z
export function loft(sections, radial = 24, capStart = true, capEnd = true) {
  const pos = [], uv = [], idx = [];
  const rows = sections.length;
  for (let r = 0; r < rows; r++) {
    const s = sections[r];
    const ox = s.x || 0, oy = s.y || 0;
    for (let i = 0; i <= radial; i++) {
      const th = (i / radial) * Math.PI * 2;
      pos.push(ox + Math.cos(th) * s.rx, oy + Math.sin(th) * s.ry, s.z);
      uv.push(i / radial, r / (rows - 1));
    }
  }
  const W = radial + 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < radial; i++) {
      const a = r * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  function cap(rowIndex, front) {
    const s = sections[rowIndex];
    const ci = pos.length / 3;
    pos.push(s.x || 0, s.y || 0, s.z);
    uv.push(0.5, front ? 0 : 1);
    for (let i = 0; i < radial; i++) {
      const a = rowIndex * W + i, b = rowIndex * W + i + 1;
      if (front) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  if (capStart) cap(0, true);
  if (capEnd) cap(rows - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- tube along a polyline with per-point radius (parallel transport) ----------
export function tube(points, radii, radial = 10, capEnd = true) {
  const pts = points.map(p => new THREE.Vector3(...p));
  const n = pts.length;
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    tangents.push(b.clone().sub(a).normalize());
  }
  // initial normal
  let normal = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) normal.set(0, 1, 0);
  normal.sub(tangents[0].clone().multiplyScalar(normal.dot(tangents[0]))).normalize();
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      normal.sub(tangents[i].clone().multiplyScalar(normal.dot(tangents[i]))).normalize();
    }
    const binormal = tangents[i].clone().cross(normal).normalize();
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const r = radii[i];
      const p = pts[i].clone()
        .add(normal.clone().multiplyScalar(Math.cos(th) * r))
        .add(binormal.clone().multiplyScalar(Math.sin(th) * r));
      pos.push(p.x, p.y, p.z);
      uv.push(j / radial, i / (n - 1));
    }
  }
  const W = radial + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (capEnd) {
    const ci = pos.length / 3;
    const last = pts[n - 1];
    pos.push(last.x, last.y, last.z); uv.push(0.5, 1);
    for (let j = 0; j < radial; j++) idx.push(ci, (n - 1) * W + j, (n - 1) * W + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// quaternion that maps +X,+Y,+Z onto the given (orthonormalized) basis
export function basisQuat(zDir, upHint) {
  const z = zDir.clone().normalize();
  const x = upHint.clone().cross(z).normalize();
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  const y = z.clone().cross(x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ---------- canvas texture helpers ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Feather alpha + shading map. type: 'flight' | 'body'
export function featherTexture(type, seed = 1) {
  const W = 128, H = 256;
  const c = canvas(W, H), ctx = c.getContext('2d');
  // base: transparent
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  // vane body (opaque core), tip at y=H
  ctx.fillStyle = 'rgb(210,205,198)';
  ctx.fillRect(0, 0, W, H);
  // shading: darker toward edges, light shaft
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  // barbs: angled streaks from shaft to edges
  const nB = type === 'body' ? 46 : 78;
  for (let i = 0; i < nB; i++) {
    const y = (i / nB) * H;
    const a = 0.10 + hash2(i, seed) * 0.16;
    ctx.strokeStyle = `rgba(20,15,10,${a})`;
    ctx.lineWidth = 0.8 + hash2(i, seed + 3) * 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(0, y + (type === 'body' ? 34 : 26) + hash2(i, seed + 5) * 8);
    ctx.moveTo(cx, y);
    ctx.lineTo(W, y + (type === 'body' ? 34 : 26) + hash2(i, seed + 7) * 8);
    ctx.stroke();
  }
  // shaft
  const sg = ctx.createLinearGradient(cx - 3, 0, cx + 3, 0);
  sg.addColorStop(0, 'rgba(120,100,80,0.0)');
  sg.addColorStop(0.5, 'rgba(235,225,210,0.85)');
  sg.addColorStop(1, 'rgba(120,100,80,0.0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cx - 3, 0, 6, H * 0.94);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // alpha map: opaque core, ragged split edges, soft base fluff
  const ca = canvas(W, H), cta = ca.getContext('2d');
  cta.fillStyle = '#fff'; cta.fillRect(0, 0, W, H);
  // edge nicks / splits between barbs
  const splits = type === 'body' ? 10 : 15;
  for (let i = 0; i < splits; i++) {
    const y = 40 + hash2(i, seed + 11) * (H - 50);
    const side = hash2(i, seed + 13) > 0.5 ? 0 : W;
    const depth = (type === 'body' ? 26 : 20) * (0.4 + hash2(i, seed + 17));
    cta.fillStyle = '#000';
    cta.beginPath();
    cta.moveTo(side, y);
    cta.lineTo(side === 0 ? depth : W - depth, y + 12 + hash2(i, seed + 19) * 8);
    cta.lineTo(side, y + 5 + hash2(i, seed + 23) * 10);
    cta.closePath(); cta.fill();
  }
  // downy base for body feathers: dither the first 20%
  if (type === 'body') {
    for (let i = 0; i < 500; i++) {
      const x = hash2(i, seed + 31) * W;
      const y = hash2(i, seed + 37) * H * 0.22;
      cta.fillStyle = 'rgba(0,0,0,0.6)';
      cta.fillRect(x, y, 2.5, 2.5);
    }
  }
  const alpha = new THREE.CanvasTexture(ca);
  alpha.anisotropy = 4;
  return { map: tex, alphaMap: alpha };
}

// ground texture: grassy meadow with dirt patches
export function groundTexture() {
  const S = 1024;
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#5d6b3c'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = hash(i * 1.3) * S, y = hash(i * 2.7 + 5) * S;
    const g = hash(i * 3.1 + 9);
    const col = g < 0.5
      ? `rgba(${70 + g * 60},${90 + g * 70},${40 + g * 40},0.5)`
      : `rgba(${100 + g * 40},${95 + g * 30},${60 + g * 25},0.35)`;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + hash(i + 77) * 4, 1 + hash(i + 99) * 9, hash(i) * 3.14, 0, 6.3);
    ctx.fill();
  }
  // grass blades
  for (let i = 0; i < 5000; i++) {
    const x = hash(i * 7.7) * S, y = hash(i * 9.1 + 3) * S;
    const h = 4 + hash(i + 11) * 9;
    ctx.strokeStyle = `rgba(${60 + hash(i) * 50},${105 + hash(i + 1) * 50},${45 + hash(i + 2) * 30},0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (hash(i + 4) - 0.5) * 6, y - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// scaly skin texture for tarsi/toes
export function scaleTexture() {
  const S = 256;
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#e2b13c'; ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < 14; r++) {
    for (let i = 0; i < 10; i++) {
      const x = i * 26 + (r % 2) * 13, y = r * 19;
      ctx.fillStyle = `rgba(${190 + hash2(i, r) * 40},${140 + hash2(i, r + 3) * 30},${40},1)`;
      ctx.beginPath();
      ctx.ellipse(x, y, 12, 8, 0, 0, 6.3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,80,20,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, 12, 8, 0, 0, 6.3);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// sky gradient
export function skyTexture() {
  const c = canvas(16, 512), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2e5fa3');
  g.addColorStop(0.45, '#7fb2e0');
  g.addColorStop(0.72, '#cfe3ef');
  g.addColorStop(1, '#e8ecdc');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
