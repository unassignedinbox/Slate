// ============================================================================
// world.js — the arena around the track: night sky, Zalem spire + floating
// sky-city, Iron City skyline, grandstand bowl with crowd, floodlight pylons,
// sponsor boards and the center-hung jumbotron. All procedural, low-poly.
// ============================================================================
import * as THREE from 'three';

export class World {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.blinkers = [];
    this._lights(scene);
    this._sky(scene);
    this._grandstands(scene);
    this._crowd(scene);
    this._floodlights(scene);
    this._zalem(scene);
    this._ironCity(scene);
    this._jumbotron(scene);
    this._sponsorBoards(scene);
  }

  // ------------------------------------------------------------ lighting
  _lights(scene) {
    scene.fog = new THREE.FogExp2(0x070d16, 0.00085);
    scene.add(new THREE.HemisphereLight(0x274158, 0x0a0c10, 0.85));
    const moon = new THREE.DirectionalLight(0x8fb7d9, 0.5);
    moon.position.set(-300, 380, -240);
    scene.add(moon);
    // a few warm arena point lights so the stadium feels lit from inside
    const pts = [
      [180, 60, 90, 0xffd9a0], [-190, 60, -60, 0xa8e6ff],
      [0, 55, -120, 0xffd9a0], [60, 52, 120, 0xa8e6ff],
    ];
    for (const [x, y, z, c] of pts) {
      const l = new THREE.PointLight(c, 9000, 340, 1.8);
      l.position.set(x, y, z);
      scene.add(l);
    }
  }

  // ------------------------------------------------------------ sky
  _sky(scene) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#020409');
    grad.addColorStop(0.45, '#071120');
    grad.addColorStop(0.72, '#0d2033');
    grad.addColorStop(1, '#10283d');
    g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1600, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    scene.add(dome);

    // stars
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = Math.random() * 0.55 + 0.08;
      const r = 1500;
      pos[i * 3] = Math.cos(a) * r * Math.cos(h);
      pos[i * 3 + 1] = Math.sin(h) * r;
      pos[i * 3 + 2] = Math.sin(a) * r * Math.cos(h);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcfe4ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8,
    }));
    scene.add(stars);

    // moon sprite
    const mc = document.createElement('canvas');
    mc.width = mc.height = 128;
    const mg = mc.getContext('2d');
    const mgrad = mg.createRadialGradient(64, 64, 8, 64, 64, 64);
    mgrad.addColorStop(0, 'rgba(235,244,255,1)');
    mgrad.addColorStop(0.45, 'rgba(200,224,250,0.95)');
    mgrad.addColorStop(0.72, 'rgba(150,190,235,0.25)');
    mgrad.addColorStop(1, 'rgba(150,190,235,0)');
    mg.fillStyle = mgrad; mg.fillRect(0, 0, 128, 128);
    const moonTex = new THREE.CanvasTexture(mc);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false }));
    moon.scale.setScalar(180);
    moon.position.set(-900, 900, -1250);
    scene.add(moon);
  }

  // ------------------------------------------------------------ grandstands
  _grandstands(scene) {
    // elliptical tiered bowl surrounding the circuit
    const rx0 = 345, rz0 = 265, tiers = 5, rise = 4.4, depth = 9.5;
    const seg = 96;
    const matConcrete = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.95 });
    const matSeat = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.9 });
    const geo = new THREE.BufferGeometry();
    const pos = [], nor = [], uvA = [], idx = [];
    let vi = 0;
    const push = (x, y, z, u, v) => { pos.push(x, y, z); nor.push(0, 1, 0); uvA.push(u, v); return vi++; };
    for (let t = 0; t < tiers; t++) {
      const rxA = rx0 + t * depth, rzA = rz0 + t * depth * 0.8;
      const rxB = rx0 + (t + 1) * depth, rzB = rz0 + (t + 1) * depth * 0.8;
      const yA = 7 + t * rise, yB = 7 + (t + 1) * rise;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        // riser (vertical face)
        let A = push(c0 * rxA, 0.02, s0 * rzA, s / seg, 0);
        let B = push(c1 * rxA, 0.02, s1 * rzA, (s + 1) / seg, 0);
        let C = push(c1 * rxA, yA, s1 * rzA, (s + 1) / seg, 0.4);
        let D = push(c0 * rxA, yA, s0 * rzA, s / seg, 0.4);
        idx.push(A, B, C, A, C, D);
        // tread (flat walking/sitting surface)
        A = D; B = C;
        C = push(c1 * rxB, yA, s1 * rzB, (s + 1) / seg, 1);
        D = push(c0 * rxB, yA, s0 * rzB, s / seg, 1);
        idx.push(A, C, B, A, D, C);
        if (t === tiers - 1) {
          // top back wall
          A = push(c0 * rxB, yA, s0 * rzB, s / seg, 0);
          B = push(c1 * rxB, yA, s1 * rzB, (s + 1) / seg, 0);
          C = push(c1 * rxB, yB + 4, s1 * rzB, (s + 1) / seg, 1);
          D = push(c0 * rxB, yB + 4, s0 * rzB, s / seg, 1);
          idx.push(A, B, C, A, C, D);
        }
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    const bowl = new THREE.Mesh(geo, matConcrete);
    bowl.material.side = THREE.DoubleSide;
    scene.add(bowl);

    // inner arena wall band (the tall dark band with light strip below the seats)
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.9, metalness: 0.3 })
    );
    band.scale.set(rx0 - 1, 7.05, rz0 - 1);
    band.position.y = 3.5;
    band.material.side = THREE.DoubleSide;
    scene.add(band);

    const strip = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x2ee6ff, toneMapped: false, side: THREE.DoubleSide })
    );
    strip.scale.set(rx0 - 0.8, 0.22, rz0 - 0.8);
    strip.position.y = 7.1;
    scene.add(strip);
  }

  _crowd(scene) {
    const rx0 = 348, rz0 = 268;
    const box = new THREE.BoxGeometry(0.5, 0.85, 0.45);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const count = 5200;
    const inst = new THREE.InstancedMesh(box, mat, count);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let k = 0;
    for (let t = 0; t < 5 && k < count; t++) {
      const perRow = Math.floor(count / 5 / 2);
      for (let r = 0; r < 2 && k < count; r++) {
        const rx = rx0 + t * 9.5 + 2 + r * 3.4;
        const rz = rz0 + t * 7.6 + 1.6 + r * 2.7;
        const y = 7 + t * 4.4 + 0.6;
        for (let s = 0; s < perRow && k < count; s++, k++) {
          const a = (s / perRow) * Math.PI * 2 + Math.random() * 0.01;
          m.makeRotationY(-a + Math.PI / 2);
          m.setPosition(Math.cos(a) * rx, y + Math.random() * 0.15, Math.sin(a) * rz);
          inst.setMatrixAt(k, m);
          // night crowd: mostly dark clothing, some bright specs
          if (Math.random() < 0.16) col.setHSL(Math.random(), 0.75, 0.55);
          else col.setHSL(0.55 + Math.random() * 0.12, 0.25, 0.1 + Math.random() * 0.18);
          inst.setColorAt(k, col);
        }
      }
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);

    // seat rows hint (thin dark boxes rows)
    this.scene.add(inst);
  }

  // ------------------------------------------------------------ floodlights
  _floodlights(scene) {
    const matPole = new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.5, metalness: 0.8 });
    const lampTexC = document.createElement('canvas');
    lampTexC.width = 128; lampTexC.height = 64;
    const lg = lampTexC.getContext('2d');
    lg.fillStyle = '#101318'; lg.fillRect(0, 0, 128, 64);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 2; y++) {
      const grd = lg.createRadialGradient(11 + x * 21, 17 + y * 30, 1, 11 + x * 21, 17 + y * 30, 12);
      grd.addColorStop(0, 'rgba(255,250,235,1)');
      grd.addColorStop(0.5, 'rgba(255,240,210,0.75)');
      grd.addColorStop(1, 'rgba(255,240,210,0)');
      lg.fillStyle = grd;
      lg.beginPath(); lg.arc(11 + x * 21, 17 + y * 30, 12, 0, 7); lg.fill();
    }
    const lampTex = new THREE.CanvasTexture(lampTexC);
    lampTex.colorSpace = THREE.SRGBColorSpace;

    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 312, z = Math.sin(a) * 240;
      const grp = new THREE.Group();
      const h = 46;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, h, 8), matPole);
      pole.position.y = h / 2;
      grp.add(pole);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(9, 4.5, 0.8),
        [
          matPole, matPole, matPole, matPole,
          new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false }),
          matPole,
        ]
      );
      head.position.y = h;
      grp.add(head);
      grp.position.set(x, 0, z);
      grp.lookAt(0, 6, 0);
      scene.add(grp);

      // fake volumetric cone
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(26, h + 4, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff3cf, transparent: true, opacity: 0.045,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        })
      );
      cone.position.set(x - Math.cos(a) * 9, h / 2 + 2, z - Math.sin(a) * 7);
      scene.add(cone);
    }
  }

  // ------------------------------------------------------------ Zalem
  _zalem(scene) {
    const grp = new THREE.Group();
    const matDark = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.7, metalness: 0.65 });
    const matDarker = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.8, metalness: 0.5 });
    const glowCyan = new THREE.MeshBasicMaterial({ color: 0x38e6ff, toneMapped: false });
    const glowWarm = new THREE.MeshBasicMaterial({ color: 0xffc46b, toneMapped: false });

    // Factory base — stack of drums in the middle of the infield
    const drums = [[34, 26, 13], [42, 16, 24], [28, 30, 40], [36, 12, 58]];
    for (const [r, h, y] of drums) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, h, 14), matDark);
      d.position.y = y;
      grp.add(d);
    }
    // greeble boxes + pipes around the base
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 16;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(3 + Math.random() * 7, 2 + Math.random() * 9, 3 + Math.random() * 7),
        Math.random() < 0.5 ? matDark : matDarker
      );
      b.position.set(Math.cos(a) * r, b.geometry.parameters.height / 2 + Math.random() * 16, Math.sin(a) * r);
      b.rotation.y = a;
      grp.add(b);
      if (Math.random() < 0.4) {
        const gl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), Math.random() < 0.6 ? glowCyan : glowWarm);
        gl.position.copy(b.position).y += b.geometry.parameters.height / 2 + 0.3;
        grp.add(gl);
      }
    }

    // the great tube up to the sky city
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 148, 12), matDarker);
    tube.position.y = 66 + 74;
    grp.add(tube);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(12.2, 0.5, 6, 20), matDark);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 84 + i * 26;
      grp.add(ring);
    }

    // floating city — Zalem above the arena
    const city = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(95, 68, 14, 18), matDark);
    city.add(plate);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(66, 30, 22, 14), matDarker);
    under.position.y = -17;
    city.add(under);
    const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(88, 1.6, 8, 40), glowCyan);
    ringGlow.rotation.x = Math.PI / 2;
    ringGlow.position.y = -4;
    city.add(ringGlow);
    const ringGlow2 = new THREE.Mesh(new THREE.TorusGeometry(70, 1.1, 8, 36), glowWarm);
    ringGlow2.rotation.x = Math.PI / 2;
    ringGlow2.position.y = 8;
    city.add(ringGlow2);

    // towers on top with emissive windows
    const winC = document.createElement('canvas');
    winC.width = 64; winC.height = 128;
    const wg = winC.getContext('2d');
    wg.fillStyle = '#10141b'; wg.fillRect(0, 0, 64, 128);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 14; y++) {
      if (Math.random() < 0.55) {
        wg.fillStyle = Math.random() < 0.6 ? 'rgba(140,225,255,0.9)' : 'rgba(255,196,107,0.9)';
        wg.fillRect(4 + x * 10, 6 + y * 9, 6, 5);
      }
    }
    const winTex = new THREE.CanvasTexture(winC);
    winTex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 66;
      const h = 8 + Math.random() * 26;
      const tw = new THREE.Mesh(
        new THREE.BoxGeometry(6 + Math.random() * 9, h, 6 + Math.random() * 9),
        new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: 0x88ccff, emissiveIntensity: 0.65, roughness: 0.85 })
      );
      tw.position.set(Math.cos(a) * r, 7 + h / 2, Math.sin(a) * r);
      city.add(tw);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(9, 30, 8), matDarker);
    spire.position.y = 26;
    city.add(spire);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4444, toneMapped: false }));
    beacon.position.y = 42;
    city.add(beacon);
    this._beacon = beacon;

    city.position.y = 236;
    grp.add(city);
    this.zalemCity = city;

    // hanging cables to the arena roof ring
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x0c0f14 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const top = new THREE.Vector3(Math.cos(a) * 80, 240, Math.sin(a) * 80);
      const bot = new THREE.Vector3(Math.cos(a) * 330, 30, Math.sin(a) * 252);
      const dir = bot.clone().sub(top);
      const len = dir.length();
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 4), cableMat);
      cable.position.copy(top).addScaledVector(dir, 0.5);
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      grp.add(cable);
    }

    grp.position.set(0, 0, -4);
    this.scene.add(grp);
  }

  // ------------------------------------------------------------ Iron City
  _ironCity(scene) {
    const winTex = (warm) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#0d1117'; g.fillRect(0, 0, 64, 128);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 16; y++) {
        if (Math.random() < 0.38) {
          g.fillStyle = warm && Math.random() < 0.7 ? 'rgba(255,180,90,0.85)' : 'rgba(110,200,255,0.85)';
          g.fillRect(5 + x * 12, 4 + y * 8, 7, 4);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const mats = [
      new THREE.MeshStandardMaterial({ map: winTex(false), emissiveMap: winTex(false), emissive: 0x9fd4ff, emissiveIntensity: 0.5, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: winTex(true), emissiveMap: winTex(true), emissive: 0xffc080, emissiveIntensity: 0.5, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.95 }),
    ];
    const geoBox = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 470 + Math.random() * 260;
      const h = 20 + Math.random() * 85;
      const b = new THREE.Mesh(geoBox, mats[Math.floor(Math.random() * 2.6)]);
      b.scale.set(18 + Math.random() * 30, h, 18 + Math.random() * 30);
      b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      b.rotation.y = Math.random() * Math.PI;
      scene.add(b);
      if (Math.random() < 0.25) {
        const blink = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }));
        blink.position.set(b.position.x, h + 1.5, b.position.z);
        scene.add(blink);
        this.blinkers.push({ mesh: blink, phase: Math.random() * Math.PI * 2 });
      }
    }
  }

  // ------------------------------------------------------------ jumbotron
  _jumbotron(scene) {
    this.jumboCanvas = document.createElement('canvas');
    this.jumboCanvas.width = 512; this.jumboCanvas.height = 128;
    this.jumboTex = new THREE.CanvasTexture(this.jumboCanvas);
    this.jumboTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.jumboTex, toneMapped: false, side: THREE.DoubleSide });
    // center-hung scoreboard cylinder (like the arena halo board)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 8, 24, 1, true), mat);
    this.jumboTex.wrapS = THREE.RepeatWrapping;
    this.jumboTex.repeat.set(4, 1);
    ring.position.set(0, 52, -4);
    scene.add(ring);
    this.jumboRing = ring;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(20.5, 20.5, 0.8, 24),
      new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.8, metalness: 0.4 }));
    cap.position.set(0, 56.4, -4);
    scene.add(cap);
    const capB = cap.clone(); capB.position.y = 47.6;
    scene.add(capB);
    // support cables up to the spire
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const top = new THREE.Vector3(Math.cos(a) * 8, 92, -4 + Math.sin(a) * 8);
      const bot = new THREE.Vector3(Math.cos(a) * 18, 56.5, -4 + Math.sin(a) * 18);
      const dir = bot.clone().sub(top); const len = dir.length();
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 4),
        new THREE.MeshBasicMaterial({ color: 0x0c0f14 }));
      cable.position.copy(top).addScaledVector(dir, 0.5);
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      scene.add(cable);
    }
    this.drawJumbo('MOTOR BALL GP', 'PRESS START', '#ffd320');
  }

  drawJumbo(line1, line2, color = '#2ee6ff') {
    const g = this.jumboCanvas.getContext('2d');
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#1b3d4a'; g.lineWidth = 4;
    g.strokeRect(3, 3, 506, 122);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd320';
    g.font = '900 44px Arial';
    g.fillText(line1, 256, 42);
    g.fillStyle = color;
    g.font = '700 40px Arial';
    g.fillText(line2, 256, 94);
    this.jumboTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ sponsors
  _sponsorBoards(scene) {
    const names = [
      ['ZALEM MOTOR WORKS', '#2ee6ff'], ['MOTOR BALL', '#ffd320'],
      ['FACTORY RACEWAYS', '#ff6b3d'], ['IRON CITY TIRE', '#7dffb0'],
      ['HUNTER-WARRIOR GUILD', '#c99bff'], ['KANSAS BAR', '#ffd320'],
      ['PANZER KUNST', '#ff4d6d'], ['DESTY NOVA LABS', '#2ee6ff'],
    ];
    const mats = names.map(([txt, col]) => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = '#07090e'; g.fillRect(0, 0, 512, 96);
      g.strokeStyle = col; g.lineWidth = 5; g.strokeRect(5, 5, 502, 86);
      g.fillStyle = col; g.font = '900 46px Arial';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, 256, 50);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: t, toneMapped: false, side: THREE.DoubleSide });
    });
    const geo = new THREE.PlaneGeometry(30, 5.6);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.08;
      const x = Math.cos(a) * 336, z = Math.sin(a) * 257;
      const board = new THREE.Mesh(geo, mats[i % mats.length]);
      board.position.set(x, 10.4, z);
      board.lookAt(0, 10, 0);
      scene.add(board);
    }
  }

  update(t) {
    if (this.jumboRing) this.jumboRing.rotation.y = t * 0.06;
    if (this._beacon) {
      const on = Math.sin(t * 3) > 0;
      this._beacon.material.color.setHex(on ? 0xff4444 : 0x441111);
    }
    for (const b of this.blinkers) {
      const on = Math.sin(t * 2.2 + b.phase) > 0.2;
      b.mesh.material.color.setHex(on ? 0xff3b30 : 0x330d0b);
    }
  }
}
