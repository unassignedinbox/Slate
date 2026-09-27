import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { concreteTexture, crowdTexture, panelTexture, adTexture } from './textures.js';

const STADIUM = { a: 425, b: 196, tiers: 11, tierRise: 4.4, tierRun: 5.6, baseWall: 13 };

function ellipseRing(a, b, profile, segs = 160, uvRepeat = 30) {
  const verts = [];
  const uvs = [];
  const idx = [];
  const K = profile.length;
  for (let s = 0; s <= segs; s++) {
    const th = (s / segs) * Math.PI * 2;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    for (let j = 0; j < K; j++) {
      const [off, y] = profile[j];
      verts.push((a + off) * ct, y, (b + off) * st);
      uvs.push((s / segs) * uvRepeat, j / (K - 1));
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < K - 1; j++) {
      const p = s * K + j;
      idx.push(p, p + 1, p + K, p + 1, p + K + 1, p + K);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(4000, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x0a0d1c) },
      mid: { value: new THREE.Color(0x3a3350) },
      bottom: { value: new THREE.Color(0xd08a4e) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `
      uniform vec3 top, mid, bottom; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.28, h));
        c = mix(c, top, smoothstep(0.2, 0.75, h));
        // haze band
        c += vec3(0.08,0.05,0.02) * exp(-abs(h-0.02)*22.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function buildGround(scene) {
  const tex = concreteTexture();
  const g = new THREE.Mesh(
    new THREE.CircleGeometry(1600, 64),
    new THREE.MeshStandardMaterial({ map: tex, color: 0x3d3f46, roughness: 1, metalness: 0 })
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -1.5;
  g.receiveShadow = true;
  scene.add(g);

  // infield apron under the circuit
  const apron = new THREE.Mesh(
    new THREE.CircleGeometry(425, 48),
    new THREE.MeshStandardMaterial({ color: 0x2c2e34, roughness: 0.95 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(1, 0.55, 1);
  apron.position.y = -1.2;
  scene.add(apron);
  return g;
}

function buildStadium(scene) {
  const group = new THREE.Group();
  group.name = 'Stadium';

  // --- retaining wall + seating bowl profile
  const wallProfile = [
    [0, -2],
    [0, STADIUM.baseWall],
    [2, STADIUM.baseWall + 1.5],
  ];
  const wall = new THREE.Mesh(
    ellipseRing(STADIUM.a, STADIUM.b, wallProfile, 180, 60),
    new THREE.MeshStandardMaterial({ map: panelTexture(), color: 0x5c606a, roughness: 0.85, metalness: 0.4, side: THREE.DoubleSide })
  );
  group.add(wall);

  const seatProfile = [[2, STADIUM.baseWall + 1.5]];
  for (let i = 0; i < STADIUM.tiers; i++) {
    const off = 2 + i * STADIUM.tierRun;
    const y = STADIUM.baseWall + 1.5 + i * STADIUM.tierRise;
    seatProfile.push([off, y + STADIUM.tierRise]);
    seatProfile.push([off + STADIUM.tierRun, y + STADIUM.tierRise]);
  }
  const seating = new THREE.Mesh(
    ellipseRing(STADIUM.a, STADIUM.b, seatProfile, 180, 90),
    new THREE.MeshStandardMaterial({ map: crowdTexture(), color: 0x9a9aa6, roughness: 1, metalness: 0, side: THREE.DoubleSide })
  );
  group.add(seating);

  // --- outer shell
  const last = seatProfile[seatProfile.length - 1];
  const shellProfile = [
    [last[0], last[1]],
    [last[0] + 8, last[1] + 10],
    [last[0] + 10, last[1] + 10],
    [last[0] + 10, -2],
  ];
  const shell = new THREE.Mesh(
    ellipseRing(STADIUM.a, STADIUM.b, shellProfile, 120, 50),
    new THREE.MeshStandardMaterial({ map: panelTexture(), color: 0x4a4d55, roughness: 0.9, metalness: 0.5, side: THREE.DoubleSide })
  );
  group.add(shell);

  // --- instanced crowd for parallax
  const crowdGeo = new THREE.BoxGeometry(0.75, 1.25, 0.6);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: false });
  const COUNT = 5200;
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, COUNT);
  crowd.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    const th = Math.random() * Math.PI * 2;
    const tier = Math.floor(Math.random() * STADIUM.tiers);
    const off = 2 + tier * STADIUM.tierRun + 1 + Math.random() * 3.5;
    const y = STADIUM.baseWall + 2.6 + tier * STADIUM.tierRise + 0.6;
    const x = (STADIUM.a + off) * Math.cos(th);
    const z = (STADIUM.b + off) * Math.sin(th);
    m.makeRotationY(-th);
    m.setPosition(x, y, z);
    crowd.setMatrixAt(i, m);
    col.setHSL(Math.random(), 0.45, 0.25 + Math.random() * 0.35);
    crowd.setColorAt(i, col);
  }
  crowd.instanceMatrix.needsUpdate = true;
  group.add(crowd);

  // --- floodlight masts
  const masts = [];
  const lampMats = [];
  for (let i = 0; i < 10; i++) {
    const th = (i / 10) * Math.PI * 2 + 0.2;
    const off = 4 + STADIUM.tiers * STADIUM.tierRun + 14;
    const x = (STADIUM.a + off) * Math.cos(th);
    const z = (STADIUM.b + off) * Math.sin(th);
    const h = 108;
    const parts = [];
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const leg = new THREE.BoxGeometry(1.2, h, 1.2);
      leg.translate(x + dx, h / 2, z + dz);
      parts.push(leg);
    }
    for (let k = 1; k < 12; k++) {
      const b = new THREE.BoxGeometry(7.2, 0.6, 0.6);
      b.translate(x, (h / 12) * k, z - 3);
      parts.push(b);
      const b2 = b.clone();
      b2.translate(0, 0, 6);
      parts.push(b2);
      const b3 = new THREE.BoxGeometry(0.6, 0.6, 7.2);
      b3.translate(x - 3, (h / 12) * k, z);
      parts.push(b3);
      const b4 = b3.clone();
      b4.translate(6, 0, 0);
      parts.push(b4);
    }
    const merged = mergeGeometries(parts);
    masts.push(merged);
    parts.forEach((p) => p.dispose());

    const rig = new THREE.Mesh(
      new THREE.BoxGeometry(22, 8, 2),
      new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.7, metalness: 0.6 })
    );
    rig.position.set(x, h + 4, z);
    rig.lookAt(0, 0, 0);
    group.add(rig);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d4, toneMapped: false });
    lampMats.push(lampMat);
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(21, 7), lampMat);
    lamps.position.copy(rig.position);
    lamps.lookAt(0, 20, 0);
    lamps.translateZ(1.2);
    group.add(lamps);
  }
  group.add(
    new THREE.Mesh(mergeGeometries(masts), new THREE.MeshStandardMaterial({ color: 0x3e424a, roughness: 0.8, metalness: 0.7 }))
  );

  // --- jumbotrons at both ends
  const screens = [];
  for (const sgn of [-1, 1]) {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 512;
    canvasEl.height = 256;
    const tex = new THREE.CanvasTexture(canvasEl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(92, 48, 4),
      new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.8, metalness: 0.5 })
    );
    const px = sgn * (STADIUM.a - 8);
    frame.position.set(px, 48, 0);
    frame.lookAt(0, 48, 0);
    group.add(frame);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(88, 44),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    screen.position.copy(frame.position);
    screen.lookAt(0, 48, 0);
    screen.translateZ(2.3);
    group.add(screen);
    screens.push({ canvas: canvasEl, texture: tex });

    // support legs
    for (const dz of [-30, 30]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(3, 26, 3),
        new THREE.MeshStandardMaterial({ color: 0x3e424a, roughness: 0.8, metalness: 0.7 })
      );
      leg.position.set(px * 1.0, 13, dz);
      group.add(leg);
    }
  }

  // --- perimeter sponsor banners inside the bowl
  for (let i = 0; i < 22; i++) {
    const th = (i / 22) * Math.PI * 2;
    const x = (STADIUM.a - 2) * Math.cos(th);
    const z = (STADIUM.b - 2) * Math.sin(th);
    const ads = ['FACTORY', 'ZALEM', 'MOTORBALL', 'IRON CITY', 'VECTOR', 'NO.99'];
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 6),
      new THREE.MeshBasicMaterial({
        map: adTexture(ads[i % ads.length], '#0a0c14', ['#ffb01e', '#22e6ff', '#ff4a8d'][i % 3]),
        toneMapped: false,
        side: THREE.DoubleSide,
      })
    );
    mesh.position.set(x, 7, z);
    mesh.lookAt(0, 7, 0);
    group.add(mesh);
  }

  scene.add(group);
  return { group, screens };
}

/** Infield dressing: the motorball monument, pit garages and scrap piles. */
function buildInfield(scene) {
  const group = new THREE.Group();
  group.name = 'Infield';

  // --- giant motorball monument inside the east lobe
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(17, 21, 9, 8),
    new THREE.MeshStandardMaterial({ color: 0x3b3e46, roughness: 0.95, metalness: 0.2 })
  );
  plinth.position.set(210, 3, 10);
  group.add(plinth);
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(13, 1),
    new THREE.MeshStandardMaterial({ color: 0x8c9099, roughness: 0.35, metalness: 0.95, flatShading: true })
  );
  ball.position.set(210, 22, 10);
  group.add(ball);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffb01e, roughness: 0.4, metalness: 0.8, flatShading: true });
  for (const d of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0.7, 0.7, 0],
  ]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(3.2, 9, 6), spikeMat);
    const dir = new THREE.Vector3(...d).normalize();
    spike.position.copy(ball.position).addScaledVector(dir, 15);
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(spike);
  }
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(22, 0.5, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0xff3fa8, toneMapped: false })
  );
  halo.position.copy(ball.position);
  halo.rotation.x = Math.PI / 2.6;
  group.add(halo);

  // --- pit / service block inside the west lobe
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const b = new THREE.BoxGeometry(16, 9 + (i % 3) * 3, 13);
    b.translate(-238 + (i % 6) * 18, 4.5, -36 + Math.floor(i / 6) * 22);
    parts.push(b);
  }
  for (let i = 0; i < 5; i++) {
    const t = new THREE.BoxGeometry(6, 26 + i * 4, 6);
    t.translate(-205 + i * 9, 13, 34);
    parts.push(t);
  }
  group.add(
    new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ map: panelTexture(), color: 0x6c707a, roughness: 0.9, metalness: 0.35 }))
  );
  parts.forEach((p) => p.dispose());

  // --- scrap piles scattered across the infield
  const scrap = [];
  for (let i = 0; i < 140; i++) {
    const th = Math.random() * Math.PI * 2;
    const lobe = Math.random() < 0.5 ? 1 : -1;
    const r = Math.random() * 70;
    const s = 2 + Math.random() * 6;
    const b = new THREE.BoxGeometry(s, s * (0.4 + Math.random()), s * (0.5 + Math.random()));
    b.rotateY(Math.random() * Math.PI);
    b.rotateX(Math.random() * 0.4);
    b.translate(lobe * 190 + Math.cos(th) * r * (lobe > 0 ? 1.25 : 1), s * 0.4, Math.sin(th) * r * 0.75);
    scrap.push(b);
  }
  group.add(
    new THREE.Mesh(mergeGeometries(scrap), new THREE.MeshStandardMaterial({ color: 0x6a5c4c, roughness: 1, metalness: 0.3, flatShading: true }))
  );
  scrap.forEach((p) => p.dispose());

  scene.add(group);
  return group;
}

function buildZalem(scene) {
  const g = new THREE.Group();
  const y = 430;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(330, 120, 120, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3c, roughness: 0.85, metalness: 0.4, side: THREE.DoubleSide })
  );
  body.position.y = y;
  g.add(body);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(330, 330, 26, 48),
    new THREE.MeshStandardMaterial({ color: 0x353b49, roughness: 0.8, metalness: 0.45 })
  );
  disc.position.y = y + 70;
  g.add(disc);
  // under-glow ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(160, 3, 6, 64),
    new THREE.MeshBasicMaterial({ color: 0x6fe6ff, toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y - 56;
  g.add(ring);
  // the tube down to the city
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 14, 430, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x20242e, roughness: 0.9, metalness: 0.5, side: THREE.DoubleSide })
  );
  tube.position.set(620, 215, -520);
  g.add(tube);
  // window lights
  const lightGeo = new THREE.BoxGeometry(6, 2, 2);
  const lights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false }), 500);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 500; i++) {
    const th = Math.random() * Math.PI * 2;
    const t = Math.random();
    const r = 120 + t * 210;
    m.makeRotationY(-th + Math.PI / 2);
    m.setPosition(Math.cos(th) * r, y - 60 + t * 120 + Math.random() * 6, Math.sin(th) * r);
    lights.setMatrixAt(i, m);
  }
  lights.instanceMatrix.needsUpdate = true;
  g.add(lights);
  scene.add(g);
  return g;
}

function buildSkyline(scene) {
  const parts = [];
  for (let i = 0; i < 260; i++) {
    const th = Math.random() * Math.PI * 2;
    const r = 520 + Math.random() * 900;
    const h = 12 + Math.random() * 70;
    const w = 14 + Math.random() * 30;
    const b = new THREE.BoxGeometry(w, h, w * (0.6 + Math.random()));
    b.rotateY(Math.random() * Math.PI);
    b.translate(Math.cos(th) * r, h / 2 - 2, Math.sin(th) * r * 0.9);
    parts.push(b);
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: 0x33353c, roughness: 0.95, metalness: 0.2 })
  );
  parts.forEach((p) => p.dispose());
  scene.add(mesh);
  return mesh;
}

export function buildEnvironment(scene) {
  scene.fog = new THREE.FogExp2(0x6b5a55, 0.00085);

  const hemi = new THREE.HemisphereLight(0x9fb7ff, 0x3a2b22, 0.75);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffd6a0, 2.1);
  sun.position.set(-320, 260, 240);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  const S = 90;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0x6fd2ff, 0.7);
  rim.position.set(300, 140, -280);
  scene.add(rim);

  buildSky(scene);
  buildGround(scene);
  const stadium = buildStadium(scene);
  buildInfield(scene);
  buildZalem(scene);
  buildSkyline(scene);

  return { sun, stadium, screens: stadium.screens };
}

/** Live jumbotron feed. */
export function drawJumbotron({ canvas, texture }, data) {
  const g = canvas.getContext('2d');
  g.fillStyle = '#05080f';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#1d2a3d';
  g.lineWidth = 2;
  for (let x = 0; x < 512; x += 16) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.fillStyle = '#ffb01e';
  g.font = 'bold 40px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('MOTORBALL', 256, 46);
  g.fillStyle = '#22e6ff';
  g.font = 'bold 86px "Arial Black", Impact, sans-serif';
  g.fillText(`${Math.round(data.kmh)}`, 256, 138);
  g.font = 'bold 26px Arial, sans-serif';
  g.fillStyle = '#7fa7c4';
  g.fillText('KM/H', 256, 166);
  g.fillStyle = '#ffffff';
  g.font = 'bold 30px monospace';
  g.textAlign = 'left';
  g.fillText(`LAP ${data.lap}`, 24, 226);
  g.textAlign = 'right';
  g.fillText(data.best ? `BEST ${data.best}` : 'BEST --:--', 488, 226);
  texture.needsUpdate = true;
}
