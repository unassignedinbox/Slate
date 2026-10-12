// ---------------------------------------------------------------------------
// CITY — the Kowloon stacks the circuit is threaded through: towers, haze,
// sky gradient, ground plate, and drifting sky traffic.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { glowTexture, windowTexture, deckTexture } from './textures.js';

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, '#04060d');
  grd.addColorStop(0.35, '#0a1424');
  grd.addColorStop(0.62, '#15263c');
  grd.addColorStop(0.80, '#3a2a4a');
  grd.addColorStop(0.92, '#6b3a5a');
  grd.addColorStop(1.0, '#12161f');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 256);
  // horizon smog band
  g.fillStyle = 'rgba(255,120,90,0.10)';
  g.fillRect(0, 150, 32, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCity(scene, track) {
  const group = new THREE.Group();
  scene.add(group);
  const d = track.deck;

  // ---- sky dome ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(sky);

  // ---- ground plate ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({
      map: deckTexture(), color: 0x090c13, roughness: 0.95, metalness: 0.1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  const gm = ground.material.map;
  if (gm) { gm.repeat.set(160, 160); }
  group.add(ground);

  // ---- distance to the racing spine (for keeping towers clear of the deck) ----
  const stride = 3;
  const clear = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < d.n; i += stride) {
      const dx = x - d.x[i], dz = z - d.z[i];
      const dist = Math.sqrt(dx * dx + dz * dz) - d.hw[i];
      if (dist < best) best = dist;
    }
    return best;
  };

  // ---- tower band ----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const towers = [];
  const R = 420;
  for (let gx = -R; gx <= R; gx += 46) {
    for (let gz = -R; gz <= R; gz += 46) {
      const x = gx + (Math.random() - 0.5) * 22;
      const z = gz + (Math.random() - 0.5) * 22;
      const r = Math.hypot(x, z);
      if (r < 120) continue;
      const gap = clear(x, z);
      if (gap < 13) continue;
      const near = Math.max(0, 1 - gap / 120);
      if (Math.random() < 0.55) continue;
      const w = 16 + Math.random() * 26;
      const deep = 16 + Math.random() * 26;
      const h = 40 + Math.random() * 130 * (0.4 + near * 1.5);
      towers.push({ x, z, w, deep, h });
    }
  }
  const mats = [
    new THREE.MeshStandardMaterial({ map: windowTexture(196), color: 0x9fb4d8, roughness: 0.6, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: windowTexture(280), color: 0xc79ad8, roughness: 0.6, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: windowTexture(40), color: 0xd8b48c, roughness: 0.65, metalness: 0.35 }),
  ];
  towers.forEach((tw, i) => {
    const m = new THREE.Mesh(boxGeo, mats[i % mats.length]);
    m.position.set(tw.x, tw.h / 2, tw.z);
    m.scale.set(tw.w, tw.h, tw.deep);
    m.frustumCulled = true;
    group.add(m);
    // crown light
    if (Math.random() < 0.4) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: Math.random() < 0.5 ? 0xff4a6a : 0x4ad8ff,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
      }));
      sp.position.set(tw.x, tw.h + 3, tw.z);
      sp.scale.setScalar(9);
      group.add(sp);
    }
  });
  group.userData.towers = towers;

  // ---- neon signage over the track ----
  const signs = [];
  for (const tag of ['zipper', 'traffic', 'train', 'crane']) {
    const a = track.anchors[tag];
    if (!a) continue;
    for (const frac of [0.25, 0.72]) {
      const s = a.s0 + (a.s1 - a.s0) * frac;
      const f = d.frame(s, {});
      const side = Math.random() < 0.5 ? 1 : -1;
      const hw = f.hw + 26 + Math.random() * 30;
      const x = f.x + f.rx * hw * side;
      const z = f.z + f.rz * hw * side;
      const h = f.y + 22 + Math.random() * 26;
      const w = 30 + Math.random() * 30;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w * 0.42),
        new THREE.MeshBasicMaterial({
          map: windowTexture(190 + Math.random() * 120),
          transparent: true, opacity: 0.95, side: THREE.DoubleSide,
        }),
      );
      sign.position.set(x, h, z);
      sign.lookAt(f.x, h, f.z);
      sign.rotateZ((Math.random() - 0.5) * 0.4);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff5ad8, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.position.copy(sign.position);
      halo.scale.setScalar(w * 1.3);
      group.add(sign, halo);
      signs.push({ sign, halo, base: h, ph: Math.random() * 6.28 });
    }
  }

  // ---- drifting sky traffic ----
  const skyTraffic = { n: 120 };
  const pos = new Float32Array(skyTraffic.n * 3);
  const col = new Float32Array(skyTraffic.n * 3);
  const speed = new Float32Array(skyTraffic.n);
  for (let i = 0; i < skyTraffic.n; i++) {
    const r = 260 + Math.random() * 900;
    const th = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(th) * r;
    pos[i * 3 + 1] = 60 + Math.random() * 180;
    pos[i * 3 + 2] = Math.sin(th) * r;
    const c = new THREE.Color(Math.random() < 0.5 ? 0xffd08a : 0x8ad8ff);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    speed[i] = 14 + Math.random() * 40;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const skyPts = new THREE.Points(sg, new THREE.PointsMaterial({
    size: 6, vertexColors: true, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(), sizeAttenuation: true,
  }));
  skyPts.frustumCulled = false;
  group.add(skyPts);

  // ---- lighting ----
  const hemi = new THREE.HemisphereLight(0x2a4a7a, 0x140f1c, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffd0a8, 0.55);
  key.position.set(-320, 240, 180);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4a7aff, 0.5);
  rim.position.set(280, 160, -240);
  scene.add(rim);
  const glow = new THREE.PointLight(0xff3ec8, 0, 400, 2);
  glow.position.set(0, 60, 0);
  scene.add(glow);

  function update(t, dt) {
    // sky traffic drifts around the circuit
    const p = sg.attributes.position.array;
    for (let i = 0; i < skyTraffic.n; i++) {
      const x = p[i * 3], z = p[i * 3 + 2];
      const r = Math.hypot(x, z) || 1;
      const tx = -z / r, tz = x / r;
      p[i * 3] += tx * speed[i] * dt;
      p[i * 3 + 2] += tz * speed[i] * dt;
      const rr = Math.hypot(p[i * 3], p[i * 3 + 2]);
      if (rr > 1200) { p[i * 3] *= 0.4; p[i * 3 + 2] *= 0.4; }
    }
    sg.attributes.position.needsUpdate = true;
    for (const s of signs) {
      s.halo.material.opacity = 0.36 + Math.sin(t * 2.4 + s.ph) * 0.12;
    }
    void skyTraffic;
  }

  return { group, update, skyTraffic, ground };
}
