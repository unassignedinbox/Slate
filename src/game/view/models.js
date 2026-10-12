// Low-poly vehicle, air-unit and gadget models. Every model faces +Z (forward) with its base on y = 0.
// Bodies are merged into a single vertex-coloured mesh per vehicle to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const C = {
  tyre: 0x17181b, rim: 0xb8bcc2, glass: 0x1d2630, glassLight: 0x33414f, black: 0x111214, white: 0xf1f1ee,
  police: 0x1f4fd6, chrome: 0xc9ccd1, red: 0xe02a20, amber: 0xffb020, steel: 0x7d848c, dark: 0x2a2d31,
  heliWhite: 0xeef0f2, heliBlack: 0x1b1d20, drone: 0x2b2f36, cyan: 0x45e0ff,
};

// Shared materials.
export const MATS = {
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  air: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }),
};
const paintCache = new Map();
// Shared paint material per colour (cars of the same colour share it).
export function paintMaterial(color) {
  const key = color;
  if (!paintCache.has(key)) paintCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.3 }));
  return paintCache.get(key);
}

// Accumulates boxes/cylinders into three merged geometries:
//   paint - body panels, tinted per vehicle by its material colour (vertices stay white)
//   trim  - black/glass/chrome/livery parts with fixed vertex colours
//   glow  - lamps, drawn unlit so they stay bright at night
// Pass `null` as the colour to put a part in the paint layer.
class Builder {
  constructor() { this.paint = []; this.trim = []; this.glow = []; }
  add(g, color, glow) {
    const list = glow ? this.glow : color === null ? this.paint : this.trim;
    colorize(g, color === null || glow ? 0xffffff : color);
    list.push(g);
  }
  box(w, h, d, x, y, z, color = null, glow = false) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    this.add(g, color, glow);
    return this;
  }
  cyl(r0, r1, h, x, y, z, color = null, { axis = 'y', seg = 10 } = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg).toNonIndexed();
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.add(g, color, false);
    return this;
  }
  sphere(r, x, y, z, color = null, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, 12, 8).toNonIndexed();
    g.scale(sx, sy, sz); g.translate(x, y, z);
    this.add(g, color, false);
    return this;
  }
  build() {
    return { paint: merge(this.paint), trim: merge(this.trim), glow: merge(this.glow) };
  }
}

function merge(list) {
  if (!list.length) return null;
  const cleaned = list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; });
  return mergeGeometries(cleaned);
}

function colorize(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

function wheels(b, track, base, r = 0.34) {
  for (const x of [-track, track]) for (const z of [-base, base]) {
    b.cyl(r, r, 0.28, x, r, z, C.tyre, { axis: 'x', seg: 10 });
    b.cyl(r * 0.5, r * 0.5, 0.3, x, r, z, C.rim, { axis: 'x', seg: 8 });
  }
}

// Lamp geometry: headlights (warm white) and tail lights (red).
function lamps(zf, zb, x, y) {
  const b = new Builder();
  b.box(0.46, 0.14, 0.05, -x, y, zf, C.white, true);
  b.box(0.46, 0.14, 0.05, x, y, zf, C.white, true);
  b.box(0.46, 0.13, 0.05, -x, y, zb, C.red, true);
  b.box(0.46, 0.13, 0.05, x, y, zb, C.red, true);
  return merge(b.glow.length ? b.glow : [new THREE.BufferGeometry()]);
}

// ---------------------------------------------------------------- road vehicles
// Returns { paint, trim, glow } geometries for a body kind. Paint is tinted per vehicle.
const geoCache = new Map();
export function vehicleGeometry(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const b = new Builder();
  const P = null;
  let zf = 2.2, zb = -2.2, x = 0.82, y = 0.92;
  if (kind === 'sedan' || kind === 'van') {
    const van = kind === 'van';
    b.box(1.84, 0.62, 4.4, 0, 0.7, 0, P);
    b.box(1.7, 0.5, van ? 3.4 : 2.1, 0, van ? 1.45 : 1.25, van ? 0.2 : -0.3, P);
    b.box(1.62, 0.44, van ? 3.2 : 1.9, 0, van ? 1.45 : 1.3, van ? 0.1 : -0.3, C.glass);
    b.box(1.5, 0.05, van ? 3.0 : 1.7, 0, van ? 1.94 : 1.52, van ? 0.1 : -0.3, P);
    b.box(1.66, 0.08, 0.3, 0, 0.72, 2.25, C.black);
    wheels(b, 0.82, 1.42);
  } else if (kind === 'sport' || kind === 'muscle') {
    const wide = kind === 'muscle';
    zf = 2.25; zb = -2.3; x = 0.7; y = 0.42;
    b.box(wide ? 1.98 : 1.9, 0.36, wide ? 4.7 : 4.5, 0, 0.5, 0, P);
    b.box(wide ? 1.9 : 1.84, 0.26, wide ? 2.6 : 2.2, 0, 0.78, wide ? -0.5 : -0.3, P);   // deck
    b.box(wide ? 1.7 : 1.6, 0.3, wide ? 2.0 : 1.8, 0, 0.9, wide ? -0.35 : -0.25, C.glass); // greenhouse
    b.box(1.6, 0.06, 1.7, 0, 1.06, -0.25, P);
    b.box(1.5, 0.1, 0.6, 0, 0.28, 2.42, C.black);                                           // splitter
    b.box(1.8, 0.08, 0.5, 0, 0.92, -2.1, P);                                                // spoiler
    b.box(0.08, 0.3, 0.12, -0.75, 0.72, -2.0, C.black); b.box(0.08, 0.3, 0.12, 0.75, 0.72, -2.0, C.black);
    if (wide) { b.box(0.22, 0.04, 4.4, -0.32, 0.8, 0, C.white); b.box(0.22, 0.04, 4.4, 0.32, 0.8, 0, C.white); }
    wheels(b, 0.9, 1.45, 0.35);
  } else if (kind === 'cruiser') {
    // Crown Victoria-style police sedan: white body, black roof and rocker, blue door stripe.
    zf = 2.3; zb = -2.5; x = 0.8; y = 0.9;
    b.box(1.92, 0.62, 5.0, 0, 0.66, 0, P);
    b.box(1.94, 0.14, 5.0, 0, 0.36, 0, C.black);
    b.box(1.8, 0.56, 2.3, 0, 1.19, -0.42, C.glass);
    b.box(1.5, 0.05, 2.0, 0, 1.5, -0.42, C.black);
    b.box(1.96, 0.04, 0.9, 0, 0.99, 1.2, P);
    b.box(2.02, 0.04, 0.08, -0.97, 0.7, 0, C.police); b.box(0.02, 0.1, 4.0, 0.975, 0.7, 0, C.police);
    b.box(2.02, 0.22, 0.3, 0, 0.42, 2.62, C.black); b.box(2.02, 0.22, 0.3, 0, 0.42, -2.62, C.black);
    b.box(1.2, 0.16, 0.12, 0, 1.56, 0.1, C.black);
    wheels(b, 0.85, 1.5, 0.36);
  }
  const out = b.build();
  out.glow = mergeOr(out.glow, lamps(zf, zb, x, y));
  geoCache.set(kind, out);
  return out;
}
function mergeOr(a, b) { return a ? mergeGeometries([a, b]) : b; }

// ---------------------------------------------------------------- police light bar (animated)
export function lightBar() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.36), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }));
  base.position.set(0, 1.62, 0.1);
  g.add(base);
  const redM = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  const blueM = new THREE.MeshBasicMaterial({ color: 0x2a6bff, toneMapped: false });
  const lamps = [];
  const spec = [[-0.42, redM, 0.3], [-0.14, redM, 0.22], [0.14, blueM, 0.22], [0.42, blueM, 0.3]];
  for (const [x, m, w] of spec) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.32), m.clone());
    l.position.set(x, 1.7, 0.1);
    g.add(l); lamps.push({ mesh: l, base: m.color.clone(), red: x < 0 });
  }
  return { group: g, lamps };
}

// ---------------------------------------------------------------- helicopter
export function helicopter() {
  const g = new THREE.Group();
  const shell = new Builder();
  shell.sphere(1.0, 0, 1.9, 0.2, C.heliWhite, 1.0, 0.95, 2.1);          // cabin
  shell.sphere(0.9, 0, 1.95, 1.1, C.heliBlack, 0.9, 0.82, 1.1);         // canopy
  shell.box(1.55, 0.14, 4.6, 0, 1.92, 0.1, C.heliWhite);
  shell.box(1.78, 0.2, 0.5, 0, 1.75, 0.6, C.heliBlack);
  shell.box(0.2, 0.7, 1.0, 0, 2.55, -0.2, C.heliBlack);
  shell.cyl(0.12, 0.14, 4.6, 0, 2.22, -4.0, C.heliWhite, { axis: 'z' });   // tail boom
  shell.box(0.06, 0.8, 0.6, 0, 2.6, -6.2, C.heliBlack);                    // tail fin
  shell.box(0.18, 0.25, 1.3, 0, 1.35, 0.0, C.heliBlack);                   // engine block
  shell.box(0.1, 0.1, 3.8, -0.9, 0.2, 0.1, C.steel);                       // skids
  shell.box(0.1, 0.1, 3.8, 0.9, 0.2, 0.1, C.steel);
  shell.box(0.1, 0.5, 0.1, -0.9, 0.5, 0.8, C.steel); shell.box(0.1, 0.5, 0.1, 0.9, 0.5, 0.8, C.steel);
  shell.box(0.1, 0.5, 0.1, -0.9, 0.5, -0.9, C.steel); shell.box(0.1, 0.5, 0.1, 0.9, 0.5, -0.9, C.steel);
  shell.box(2.0, 0.14, 0.6, 0, 1.2, 1.3, C.heliBlack);                    // weapon-free sensor pod
  const m = new THREE.Mesh(shell.build().trim, MATS.air); g.add(m);
  // Black/blue livery stripe (lower side).
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 3.8), new THREE.MeshStandardMaterial({ color: C.police, roughness: 0.5 }));
  stripe.position.set(0, 1.45, -0.1); g.add(stripe);
  // Main rotor (spins) and tail rotor (spins).
  const rotor = new THREE.Group(); rotor.position.set(0, 2.72, 0.1); g.add(rotor);
  const blade = new THREE.BoxGeometry(9.2, 0.03, 0.26);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.6 });
  const b1 = new THREE.Mesh(blade, bladeMat), b2 = new THREE.Mesh(blade, bladeMat); b2.rotation.y = Math.PI / 2;
  rotor.add(b1, b2);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), bladeMat); mast.position.y = -0.12; rotor.add(mast);
  const tail = new THREE.Group(); tail.position.set(0.22, 2.95, -6.45); g.add(tail);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, 0.16), bladeMat); tail.add(tb);
  // Searchlight housing under the nose.
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }));
  lamp.position.set(0, 0.9, 1.5); g.add(lamp);
  // Beacon.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
  beacon.position.set(0, 2.85, 0.1); g.add(beacon);
  g.userData = { rotor, tail, beacon, lamp };
  return g;
}

// ---------------------------------------------------------------- drone
export function drone(color = C.drone) {
  const g = new THREE.Group();
  const b = new Builder();
  b.box(0.5, 0.18, 0.5, 0, 0.1, 0, color);
  b.box(0.22, 0.12, 0.22, 0, -0.08, 0, C.black);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(0.08, 0.05, 0.9, x * 0.42, 0.06, z * 0.42, C.black);
  const m = new THREE.Mesh(b.build().trim, MATS.air); g.add(m);
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 14), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.35, depthWrite: false }));
    r.position.set(x * 0.42, 0.16, z * 0.42); g.add(r); rotors.push(r);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false }));
  led.position.set(0, -0.2, 0); g.add(led);
  g.userData = { rotors, led };
  return g;
}

// ---------------------------------------------------------------- roadside gadgets
export function bollardPost(height = 0.95, color = 0x9aa0a6) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, height, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 }));
  post.position.y = height / 2; g.add(post);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.12, 10), new THREE.MeshBasicMaterial({ color: 0xffa000, toneMapped: false }));
  band.position.y = height * 0.82; g.add(band);
  return g;
}

export function tireNetMesh(length, width) {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 64;
  const x = cvs.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, 256, 64);
  x.strokeStyle = '#ffd34d'; x.lineWidth = 3;
  for (let i = -2; i <= 258; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); }
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, width / 2), 1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function photonWallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0x3ef2ff) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float scan = 0.5 + 0.5 * sin((vUv.y * 40.0) - uTime * 9.0);
        float grid = smoothstep(0.46, 0.5, abs(fract(vUv.x * 14.0 - uTime * 0.7) - 0.5));
        float edge = smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.08, 1.0 - vUv.y);
        float flick = 0.85 + 0.15 * sin(uTime * 37.0);
        float a = (0.18 + 0.32 * scan + 0.5 * grid) * edge * flick * uAlpha;
        gl_FragColor = vec4(uColor * (0.6 + 0.8 * scan), a);
      }`,
  });
}

export function rippleMesh(color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export { C as PALETTE };
export const TRIM_MAT = MATS.trim;
