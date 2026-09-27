import * as THREE from 'three';
import { COLORS } from '../config.js';
import { makeRNG } from '../util/mathx.js';
import { mergeInPlace } from '../util/geo.js';

// Overcast June morning: high hazy dome, hard low sun through the murk,
// drifting cloud slabs and columns of smoke over the wall.

export function buildSky(scene) {
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.fog, 420, 2400);

  const domeGeo = new THREE.SphereGeometry(4000, 16, 10);
  const colors = new Float32Array(domeGeo.attributes.position.count * 3);
  const top = new THREE.Color(0x7c98ae);
  const horizon = new THREE.Color(0xc3cdd1);
  const c = new THREE.Color();
  const pos = domeGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 4000);
    c.copy(horizon).lerp(top, Math.pow(t, 0.7));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.name = 'sky';
  dome.renderOrder = -1;
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0xcfdae2, 0x6b6553, 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d8, 1.45);
  sun.position.set(-180, 260, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 820;
  const S = 150;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.9;
  scene.add(sun);
  scene.add(sun.target);

  const amb = new THREE.AmbientLight(0x5c6875, 0.35);
  scene.add(amb);

  // --- clouds --------------------------------------------------------------
  const rng = makeRNG(88);
  const clouds = new THREE.Group();
  clouds.name = 'clouds';
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xe6e9ea, flatShading: true, transparent: true, opacity: 0.92, fog: false });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group();
    const puffs = rng.int(3, 6);
    for (let p = 0; p < puffs; p++) {
      const s = rng.range(40, 110);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), cloudMat);
      m.position.set(rng.range(-140, 140), rng.range(-12, 12), rng.range(-70, 70));
      m.scale.set(1, rng.range(0.32, 0.5), 1);
      g.add(m);
    }
    g.position.set(rng.range(-2200, 2200), rng.range(420, 700), rng.range(-3200, 800));
    g.updateMatrix();
    clouds.add(g);
  }
  // bake the whole sky into a single mesh - they only drift as one
  for (const g of [...clouds.children]) {
    mergeInPlace(g);
    const m = g.children[0];
    if (!m) continue;
    m.applyMatrix4(g.matrix);
    m.geometry.applyMatrix4(g.matrix);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    clouds.add(m);
    clouds.remove(g);
  }
  mergeInPlace(clouds);
  scene.add(clouds);

  // --- smoke columns over the wall ----------------------------------------
  const smoke = new THREE.Group();
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x6d6b68, flatShading: true, transparent: true, opacity: 0.26, depthWrite: false, fog: true });
  for (let i = 0; i < 9; i++) {
    const x = rng.range(-700, 700);
    const z = -2900 + rng.range(-500, 40);
    const col = new THREE.Group();
    let y = 0;
    for (let s = 0; s < 9; s++) {
      const r = 3.5 + s * 2.4;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), smokeMat);
      y += r * 0.85;
      m.position.set(rng.range(-6, 6) * (1 + s * 0.4), y, rng.range(-6, 6) * (1 + s * 0.3));
      m.scale.set(1, 0.8, 1);
      col.add(m);
    }
    col.position.set(x, 10, z);
    col.updateMatrix();
    mergeInPlace(col);
    const m = col.children[0];
    if (m) {
      m.geometry.applyMatrix4(col.matrix);
      smoke.add(m);
      smoke.remove(col);
    }
  }
  mergeInPlace(smoke);
  scene.add(smoke);

  return { sun, hemi, clouds, smoke };
}
