// Sky, cloud floor, light, fog and the ambient rubble field.
// Daylight and haze - a quiet, believable sky so the broken town reads as the event.
import * as THREE from 'three';

export const SKY = {
  zenith: new THREE.Color(0x7f9db8),
  horizon: new THREE.Color(0xd9dfe2),
  below: new THREE.Color(0xc4ccd1),
  fog: new THREE.Color(0xcfd6da),
};

export function sunDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

export function createSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir.clone() },
      uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon }, uBelow: { value: SKY.below },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uZenith, uHorizon, uBelow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, h));
        col = mix(col, uBelow, smoothstep(0.0, -0.3, h));
        float s = max(0.0, dot(d, normalize(uSun)));
        col += vec3(1.0, 0.93, 0.82) * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.16 + pow(s, 3.0) * 0.05);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function noiseCanvas(size, seed) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // tileable value-noise fbm
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const oct = [];
  for (let o = 0; o < 5; o++) {
    const n = 4 << o;
    const grid = new Float32Array(n * n).map(() => rnd());
    oct.push({ n, grid });
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.55, tot = 0;
    for (const { n, grid } of oct) {
      const fx = (x / size) * n, fy = (y / size) * n;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[(y0 % n) * n + (x0 % n)], b = grid[(y0 % n) * n + ((x0 + 1) % n)];
      const cc = grid[((y0 + 1) % n) * n + (x0 % n)], d = grid[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      v += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy);
      tot += amp; amp *= 0.5;
    }
    v /= tot;
    const k = Math.max(0, Math.min(1, (v - 0.42) * 2.6));
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(k * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Two drifting cloud layers far below the town. */
export function createCloudFloor() {
  const group = new THREE.Group();
  const layers = [];
  for (const [y, rep, op, seed] of [[-150, 26, 0.9, 7], [-118, 17, 0.55, 19]]) {
    const cv = noiseCanvas(256, seed);
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(rep, rep); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }
    const m = new THREE.MeshLambertMaterial({ color: 0xf4f6f7, map: tex, transparent: true, opacity: op, depthWrite: false, alphaTest: 0.02 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = false;
    group.add(mesh);
    layers.push({ mesh, tex, speed: 0.0018 * (y > -130 ? 1.7 : 1) });
  }
  group.userData.update = (t, focus) => {
    group.position.x = Math.round(focus.x / 400) * 400;
    group.position.z = Math.round(focus.z / 400) * 400;
    for (const L of layers) if (L.tex) { L.tex.offset.x = t * L.speed; L.tex.offset.y = t * L.speed * 0.4; }
  };
  return group;
}

export function createLights(scene, sunDir, quality = 'high') {
  const hemi = new THREE.HemisphereLight(0xdfe7ee, 0x726c66, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.5);
  sun.castShadow = quality !== 'low';
  const res = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(res, res);
  const S = 120;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 900 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  return {
    hemi, sun,
    follow(focus) {
      const snap = 2;
      const fx = Math.round(focus.x / snap) * snap, fy = Math.round(focus.y / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(fx, fy, fz);
      sun.position.set(fx + sunDir.x * 450, fy + sunDir.y * 450, fz + sunDir.z * 450);
      sun.target.updateMatrixWorld();
    },
  };
}

/**
 * Ambient rubble: thousands of small fragments, animated entirely on the GPU
 * (slow orbit + tumble). Visual only - nothing here touches the car.
 */
export function createDebrisField(level, count = 2600, seed = 5) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb4aea5, roughness: 0.95, flatShading: true });
  const uni = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute vec4 aDrift;
mat3 rotAxis(vec3 a, float t) { a = normalize(a); float s = sin(t), c = cos(t), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
mat3 dR = rotAxis(vec3(sin(aDrift.x * 3.1), cos(aDrift.x * 1.7), sin(aDrift.x * 5.3)), uTime * aDrift.w + aDrift.x);
objectNormal = dR * objectNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = dR * transformed;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
float ph = aDrift.x * 6.2831;
mvPosition.xyz += vec3(sin(uTime * aDrift.y + ph), sin(uTime * aDrift.y * 0.71 + ph * 1.3) * 0.6, cos(uTime * aDrift.y * 0.83 + ph)) * aDrift.z;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const drift = new Float32Array(count * 4);
  let s = seed * 7919;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const route = level.sections[0].route;
  const pts = [];
  for (let k = 0; k <= route.length; k += 6) pts.push(route.at(k).p);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 20) {
    p.set(-420 + rnd() * 760, -70 + rnd() * 200, -500 + rnd() * 700);
    let near = false;
    for (const r of pts) { const dx = p.x - r.x, dy = p.y - r.y, dz = p.z - r.z; if (dx * dx + dz * dz < 900 && dy > -14 && dy < 22) { near = true; break; } }
    if (near) continue;
    const size = 0.3 + Math.pow(rnd(), 2.5) * 2.2;
    q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
    sc.set(size * (0.6 + rnd()), size * (0.5 + rnd() * 0.7), size * (0.6 + rnd()));
    m.compose(p, q, sc);
    mesh.setMatrixAt(n, m);
    drift.set([rnd(), 0.05 + rnd() * 0.2, 0.3 + rnd() * 2.2, (rnd() - 0.5) * 0.6], n * 4);
    n++;
  }
  mesh.count = n;
  geo.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drift, 4));
  mesh.userData.uniforms = uni;
  return mesh;
}
