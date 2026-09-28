/*
  Golden Eagle — Aquila chrysaetos
  A visible mesh study built from feather volumes and anatomical forms.
  Animation is intentionally direct-transform based: there is no armature or 2D plane.
*/

(() => {
  'use strict';

  const THREE = window.THREE;
  const stage = document.getElementById('stage');
  const loading = document.getElementById('loading');
  const poseLabel = document.getElementById('poseLabel');
  const readout = document.getElementById('readout');
  const speedInput = document.getElementById('speed');
  const speedValue = document.getElementById('speedValue');
  const playToggle = document.getElementById('playToggle');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111312);
  scene.fog = new THREE.Fog(0x111312, 14, 33);

  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
  camera.position.set(8.6, 5.9, 10.8);
  camera.lookAt(0, 2.35, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.appendChild(renderer.domElement);

  // Small dependency-free orbit controller. Keeping camera interaction local avoids a second runtime asset.
  class OrbitView {
    constructor(viewCamera, element) {
      this.camera = viewCamera;
      this.element = element;
      this.target = new THREE.Vector3(0, 2.4, 0);
      this.radius = 13.0;
      this.theta = 0.68;
      this.phi = 1.12;
      this.targetTheta = this.theta;
      this.targetPhi = this.phi;
      this.targetRadius = this.radius;
      this.dragging = false;
      this.lastX = 0;
      this.lastY = 0;
      this.dampingFactor = 0.065;
      element.style.touchAction = 'none';
      element.addEventListener('pointerdown', (event) => {
        this.dragging = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        element.setPointerCapture(event.pointerId);
      });
      element.addEventListener('pointermove', (event) => {
        if (!this.dragging) return;
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.targetTheta -= dx * 0.008;
        this.targetPhi = THREE.MathUtils.clamp(this.targetPhi + dy * 0.006, 0.30, 1.49);
      });
      const stop = () => { this.dragging = false; };
      element.addEventListener('pointerup', stop);
      element.addEventListener('pointercancel', stop);
      element.addEventListener('wheel', (event) => {
        event.preventDefault();
        this.targetRadius = THREE.MathUtils.clamp(this.targetRadius * Math.exp(event.deltaY * 0.0009), 5.7, 18);
      }, { passive: false });
    }
    update() {
      this.theta += (this.targetTheta - this.theta) * this.dampingFactor;
      this.phi += (this.targetPhi - this.phi) * this.dampingFactor;
      this.radius += (this.targetRadius - this.radius) * this.dampingFactor;
      const sinPhi = Math.sin(this.phi);
      this.camera.position.set(
        this.target.x + this.radius * sinPhi * Math.sin(this.theta),
        this.target.y + this.radius * Math.cos(this.phi),
        this.target.z + this.radius * sinPhi * Math.cos(this.theta)
      );
      this.camera.lookAt(this.target);
    }
  }
  const controls = new OrbitView(camera, renderer.domElement);

  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x34251b, roughness: 0.92, metalness: 0.0, flatShading: true }),
    bodyLight: new THREE.MeshStandardMaterial({ color: 0x503823, roughness: 0.94, flatShading: true }),
    bodyDark: new THREE.MeshStandardMaterial({ color: 0x201814, roughness: 0.96, flatShading: true }),
    wing: new THREE.MeshStandardMaterial({ color: 0x251b15, roughness: 0.91, flatShading: true }),
    wingWarm: new THREE.MeshStandardMaterial({ color: 0x3b291d, roughness: 0.92, flatShading: true }),
    primary: new THREE.MeshStandardMaterial({ color: 0x211916, roughness: 0.88, flatShading: true }),
    primaryEdge: new THREE.MeshStandardMaterial({ color: 0x39291e, roughness: 0.9, flatShading: true }),
    gold: new THREE.MeshStandardMaterial({ color: 0xa87536, roughness: 0.9, flatShading: true }),
    goldLight: new THREE.MeshStandardMaterial({ color: 0xc5954d, roughness: 0.91, flatShading: true }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3e2e21, roughness: 0.9, flatShading: true }),
    tailLight: new THREE.MeshStandardMaterial({ color: 0x67503a, roughness: 0.9, flatShading: true }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc29d31, roughness: 0.72, flatShading: true }),
    black: new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: 0.6, flatShading: true }),
    beak: new THREE.MeshStandardMaterial({ color: 0x302d27, roughness: 0.72, flatShading: true }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 0.95, flatShading: true }),
    eye: new THREE.MeshStandardMaterial({ color: 0x060504, roughness: 0.18, metalness: 0.08 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x8d662b, roughness: 0.42, metalness: 0.02 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x373a34, roughness: 1, flatShading: true }),
    ground: new THREE.MeshStandardMaterial({ color: 0x181b18, roughness: 1, metalness: 0 }),
    groundAccent: new THREE.MeshStandardMaterial({ color: 0x252a24, roughness: 1, flatShading: true })
  };

  const eagle = new THREE.Group();
  eagle.name = 'GoldenEagle_DirectMeshModel';
  scene.add(eagle);

  const refs = {
    torso: null,
    neck: null,
    head: null,
    beak: null,
    lowerBeak: null,
    mouth: null,
    wingRoots: [],
    secondaries: [],
    primaries: [],
    coverts: [],
    tail: null,
    tailFeathers: [],
    legs: [],
    feet: []
  };
  const animNodes = [];

  const sideSign = (side) => side === 'L' ? 1 : -1;
  const add = (parent, child) => { parent.add(child); return child; };
  const register = (node) => {
    node.userData.base = {
      position: node.position.clone(),
      rotation: node.rotation.clone(),
      scale: node.scale.clone()
    };
    animNodes.push(node);
    return node;
  };
  const resetNode = (node) => {
    const b = node.userData.base;
    if (!b) return;
    node.position.copy(b.position);
    node.rotation.copy(b.rotation);
    node.scale.copy(b.scale);
  };
  const resetPose = () => {
    animNodes.forEach(resetNode);
    eagle.position.set(0, 0, 0);
    eagle.rotation.set(0, 0, 0);
    eagle.scale.set(1, 1, 1);
  };

  function ellipsoid(name, position, scale, material, segments = 16) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(8, Math.floor(segments * 0.65))), material);
    mesh.name = name;
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // Feather mesh: a thin but fully volumetric extruded vane with a raised central shaft.
  function featherGeometry(length, width, depth, primary = false) {
    const shape = new THREE.Shape();
    const w = width;
    const l = length;
    if (primary) {
      shape.moveTo(-w * 0.13, 0);
      shape.lineTo(-w * 0.46, l * 0.25);
      shape.lineTo(-w * 0.52, l * 0.60);
      shape.lineTo(-w * 0.42, l * 0.78);
      shape.lineTo(-w * 0.25, l * 0.88);
      shape.lineTo(-w * 0.10, l * 0.92); // inner-vane notch
      shape.lineTo(0, l);
      shape.lineTo(w * 0.20, l * 0.94);
      shape.lineTo(w * 0.45, l * 0.74);
      shape.lineTo(w * 0.49, l * 0.40);
      shape.lineTo(w * 0.27, l * 0.12);
      shape.closePath();
    } else {
      shape.moveTo(-w * 0.16, 0);
      shape.lineTo(-w * 0.47, l * 0.28);
      shape.lineTo(-w * 0.52, l * 0.60);
      shape.lineTo(-w * 0.32, l * 0.86);
      shape.lineTo(0, l);
      shape.lineTo(w * 0.33, l * 0.86);
      shape.lineTo(w * 0.52, l * 0.58);
      shape.lineTo(w * 0.43, l * 0.27);
      shape.lineTo(w * 0.16, 0);
      shape.closePath();
    }
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geometry.translate(0, 0, -depth * 0.5);
    geometry.computeVertexNormals();
    return geometry;
  }

  function makeFeather(name, length, width, depth, material, primary = false, shaftMaterial = materials.tailLight) {
    const group = new THREE.Group();
    group.name = name;
    const vane = new THREE.Mesh(featherGeometry(length, width, depth, primary), material);
    vane.name = `${name}_Vane`;
    vane.castShadow = true;
    vane.receiveShadow = true;
    group.add(vane);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.009, depth * 0.16), Math.max(0.014, depth * 0.23), length * 1.01, 5), shaftMaterial);
    shaft.name = `${name}_Shaft`;
    shaft.position.y = length * 0.49;
    shaft.castShadow = true;
    group.add(shaft);
    return group;
  }

  function cylinderBetween(name, a, b, radius, material, radialSegments = 7) {
    const direction = new THREE.Vector3().subVectors(b, a);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius, length, radialSegments), material);
    mesh.name = name;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    return mesh;
  }

  function createTalonCurve(name, points, radius = 0.035) {
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 7, radius, 5, false), materials.black);
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  }

  function buildBody() {
    const torso = new THREE.Group();
    torso.name = 'Torso_Chest_And_Belly';
    torso.position.set(0, 2.34, 0);
    register(torso);
    refs.torso = torso;
    add(eagle, torso);

    add(torso, ellipsoid('Deep barrel chest', new THREE.Vector3(0, 0.02, 0.10), new THREE.Vector3(0.82, 1.05, 1.32), materials.body, 20));
    add(torso, ellipsoid('Warm throat', new THREE.Vector3(0, 0.48, 0.76), new THREE.Vector3(0.57, 0.65, 0.55), materials.bodyLight, 16));
    add(torso, ellipsoid('Back mantle', new THREE.Vector3(0, 0.25, -0.67), new THREE.Vector3(0.72, 0.72, 0.98), materials.bodyDark, 16));

    // A layered breast gives the chest a feathered break-up rather than a smooth primitive.
    for (let i = 0; i < 12; i++) {
      const x = (i % 4 - 1.5) * 0.16;
      const y = -0.04 + Math.floor(i / 4) * 0.20;
      const z = 0.94 - Math.floor(i / 4) * 0.07;
      const f = makeFeather(`Breast feather ${i + 1}`, 0.46 - Math.floor(i / 4) * 0.035, 0.21, 0.075, i % 3 === 0 ? materials.bodyLight : materials.body);
      f.position.set(x, y, z);
      f.rotation.x = -0.07;
      f.rotation.z = x * 0.16;
      add(torso, f);
    }
  }

  function buildHeadAndNeck() {
    const neck = new THREE.Group();
    neck.name = 'Neck';
    neck.position.set(0, 3.05, 0.68);
    register(neck);
    refs.neck = neck;
    add(eagle, neck);
    add(neck, ellipsoid('Neck base', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.48, 0.66, 0.54), materials.body, 16));

    const head = new THREE.Group();
    head.name = 'Head_With_Visible_Facial_Meshes';
    head.position.set(0, 3.48, 1.14);
    register(head);
    refs.head = head;
    add(eagle, head);
    add(head, ellipsoid('Eagle head', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.55, 0.58, 0.69), materials.body, 18));
    add(head, ellipsoid('Brow ridge', new THREE.Vector3(0, 0.16, 0.39), new THREE.Vector3(0.47, 0.25, 0.34), materials.bodyLight, 12));

    // Golden nape hackles: lance-shaped, individually modeled feathers.
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const ring = i < 10 ? 0.39 : 0.49;
      const f = makeFeather(`Golden nape hackle ${i + 1}`, 0.40 + (i % 3) * 0.06, 0.17, 0.055, i % 4 === 0 ? materials.goldLight : materials.gold, false, materials.gold);
      f.position.set(Math.sin(angle) * ring * 0.78, -0.04 + Math.cos(angle) * 0.16, -0.32 + Math.cos(angle) * 0.28);
      f.rotation.x = -0.34 + Math.cos(angle) * 0.20;
      f.rotation.z = Math.sin(angle) * 0.36;
      add(head, f);
    }

    // Eye sockets, amber irises, and black pupils are real inset volumes on the head.
    for (const side of [1, -1]) {
      const socket = ellipsoid(`Eye socket ${side}`, new THREE.Vector3(side * 0.405, 0.11, 0.43), new THREE.Vector3(0.13, 0.13, 0.075), materials.iris, 12);
      add(head, socket);
      const eye = ellipsoid(`Gloss black eye ${side}`, new THREE.Vector3(side * 0.435, 0.115, 0.475), new THREE.Vector3(0.064, 0.064, 0.042), materials.eye, 12);
      add(head, eye);
      const catchlight = ellipsoid(`Eye catchlight ${side}`, new THREE.Vector3(side * 0.455, 0.145, 0.505), new THREE.Vector3(0.012, 0.012, 0.008), new THREE.MeshBasicMaterial({ color: 0xfff2cc }), 8);
      add(head, catchlight);
    }

    const beak = new THREE.Group();
    beak.name = 'Upper_Beak';
    beak.position.set(0, -0.01, 0.49);
    register(beak);
    refs.beak = beak;
    add(head, beak);
    const cere = ellipsoid('Yellow cere', new THREE.Vector3(0, 0.02, 0.05), new THREE.Vector3(0.22, 0.16, 0.20), materials.yellow, 10);
    add(beak, cere);
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.72, 5, 1), materials.beak);
    upper.name = 'Hooked upper bill';
    upper.rotation.x = Math.PI / 2;
    upper.position.set(0, 0.01, 0.33);
    upper.scale.set(1, 1, 1.1);
    upper.castShadow = true;
    add(beak, upper);

    const mouth = ellipsoid('Mouth interior', new THREE.Vector3(0, -0.085, 0.50), new THREE.Vector3(0.17, 0.035, 0.34), materials.mouth, 10);
    refs.mouth = mouth;
    add(head, mouth);
    const lowerBeak = new THREE.Group();
    lowerBeak.name = 'Lower_Beak_Animated';
    lowerBeak.position.set(0, -0.09, 0.53);
    register(lowerBeak);
    refs.lowerBeak = lowerBeak;
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.44, 5, 1), materials.beak);
    lower.name = 'Lower bill';
    lower.rotation.x = Math.PI / 2;
    lower.position.z = 0.19;
    lower.castShadow = true;
    add(lowerBeak, lower);
    add(head, lowerBeak);

    // Nostrils, set into the cere.
    for (const side of [1, -1]) {
      const nostril = ellipsoid(`Nostril ${side}`, new THREE.Vector3(side * 0.105, 0.04, 0.23), new THREE.Vector3(0.026, 0.020, 0.017), materials.black, 7);
      add(beak, nostril);
    }
  }

  function buildWing(sideName) {
    const side = sideSign(sideName);
    const root = new THREE.Group();
    root.name = `${sideName}_Wing_DirectMeshRoot`;
    root.position.set(side * 0.56, 3.02, -0.03);
    root.userData.side = side;
    register(root);
    refs.wingRoots.push({ node: root, side });
    add(eagle, root);

    const upperWingMass = ellipsoid(`${sideName} muscular upper wing`, new THREE.Vector3(side * 0.75, 0.05, -0.10), new THREE.Vector3(1.38, 0.30, 0.55), materials.wing, 14);
    add(root, upperWingMass);

    // Layered coverts sit above the wing and overlap toward the trailing edge.
    for (let i = 0; i < 9; i++) {
      const g = makeFeather(`${sideName} covert ${i + 1}`, 0.82 - i * 0.035, 0.34, 0.085, i % 3 === 0 ? materials.wingWarm : materials.wing, false, materials.primaryEdge);
      g.position.set(side * (0.18 + i * 0.17), 0.22 - i * 0.018, 0.25 - i * 0.09);
      g.rotation.z = side * (-Math.PI / 2 + 0.02 + i * 0.012);
      g.rotation.y = side * (0.12 + i * 0.025);
      register(g);
      refs.coverts.push({ node: g, side, index: i });
      add(root, g);
    }

    // About fourteen rounded secondaries form the inner flight feather fan.
    for (let i = 0; i < 9; i++) {
      const g = makeFeather(`${sideName} secondary ${i + 1}`, 1.34 + i * 0.055, 0.31, 0.082, i % 2 ? materials.wingWarm : materials.wing, false, materials.primaryEdge);
      g.position.set(side * (0.72 + i * 0.15), 0.08 - i * 0.012, -0.12 - i * 0.13);
      g.rotation.z = side * (-Math.PI / 2 + 0.018 + i * 0.018);
      g.rotation.y = side * (0.075 + i * 0.018);
      register(g);
      refs.secondaries.push({ node: g, side, index: i });
      add(root, g);
    }

    // Ten asymmetrical primaries with notched tips make the diagnostic fingered silhouette.
    for (let i = 0; i < 10; i++) {
      const g = makeFeather(`${sideName} primary ${i + 1}`, 1.82 + (9 - i) * 0.035, 0.27 + (i < 4 ? 0.02 : 0), 0.073, i < 4 ? materials.primary : materials.primaryEdge, true, materials.primaryEdge);
      g.position.set(side * (1.83 + i * 0.095), -0.005 - i * 0.008, -0.78 - i * 0.115);
      g.rotation.z = side * (-Math.PI / 2 - 0.08 + i * 0.022);
      g.rotation.y = side * (-0.09 + i * 0.027);
      register(g);
      refs.primaries.push({ node: g, side, index: i });
      add(root, g);
    }
  }

  function buildTail() {
    const tail = new THREE.Group();
    tail.name = 'Tail_12_Rounded_Rectrix_Feathers';
    tail.position.set(0, 2.02, -1.25);
    register(tail);
    refs.tail = tail;
    add(eagle, tail);
    for (let i = 0; i < 12; i++) {
      const center = i - 5.5;
      const g = makeFeather(`Tail rectrix ${i + 1}`, 1.31 + (5.5 - Math.abs(center)) * 0.03, 0.29, 0.09, i % 3 === 0 ? materials.tailLight : materials.tail, false, materials.tailLight);
      g.position.set(center * 0.105, 0.12 - Math.abs(center) * 0.009, 0);
      g.rotation.x = -Math.PI / 2;
      g.rotation.z = center * 0.035;
      register(g);
      refs.tailFeathers.push({ node: g, index: i, center });
      add(tail, g);
    }
  }

  function buildLegs() {
    for (const sideName of ['L', 'R']) {
      const side = sideSign(sideName);
      const leg = new THREE.Group();
      leg.name = `${sideName}_Feathered_Tarsus_And_Foot`;
      leg.position.set(side * 0.34, 1.40, 0.16);
      leg.userData.side = side;
      register(leg);
      refs.legs.push({ node: leg, side });
      add(eagle, leg);

      // Booted eagle: feathers continue down the tarsus, ending at the ankle.
      add(leg, ellipsoid(`${sideName} feathered tarsus`, new THREE.Vector3(0, -0.59, 0), new THREE.Vector3(0.235, 0.79, 0.23), materials.body, 12));
      add(leg, ellipsoid(`${sideName} ankle transition`, new THREE.Vector3(0, -1.03, 0.03), new THREE.Vector3(0.14, 0.24, 0.14), materials.yellow, 10));

      const foot = new THREE.Group();
      foot.name = `${sideName}_Foot_And_Talons`;
      foot.position.set(0, -1.10, 0.08);
      register(foot);
      refs.feet.push({ node: foot, side });
      add(leg, foot);
      // Three forward toes plus the rear hallux. Each is a volume, not a line sprite.
      const toes = [
        { end: new THREE.Vector3(side * 0.20, -0.08, 0.43), bend: 0.30 },
        { end: new THREE.Vector3(side * 0.05, -0.10, 0.53), bend: 0.34 },
        { end: new THREE.Vector3(-side * 0.14, -0.08, 0.40), bend: 0.28 },
        { end: new THREE.Vector3(-side * 0.18, -0.06, -0.20), bend: 0.23 }
      ];
      toes.forEach((toe, index) => {
        const start = new THREE.Vector3(0, 0.02, index === 3 ? -0.02 : 0.06);
        const mid = start.clone().lerp(toe.end, 0.68);
        add(foot, cylinderBetween(`${sideName} toe ${index + 1}`, start, mid, 0.052, materials.yellow, 7));
        const clawEnd = toe.end.clone().add(new THREE.Vector3(0, -toe.bend, index === 3 ? 0.03 : 0.10));
        add(foot, createTalonCurve(`${sideName} black talon ${index + 1}`, [mid, toe.end, clawEnd], 0.027));
      });
    }
  }

  buildBody();
  buildHeadAndNeck();
  buildWing('L');
  buildWing('R');
  buildTail();
  buildLegs();

  // Stage: a low matte plane and a small rough-rock reference perch give the model scale.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), materials.ground);
  ground.name = 'Matte ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(50, 25, 0x353932, 0x20251f);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  scene.add(grid);

  const perch = new THREE.Group();
  perch.name = 'Low field rock scale reference';
  perch.position.set(-3.15, 0.02, -0.55);
  const rockA = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1), materials.rock);
  rockA.scale.set(1.25, 0.45, 0.8);
  rockA.rotation.set(0.14, -0.26, -0.08);
  rockA.castShadow = true;
  rockA.receiveShadow = true;
  perch.add(rockA);
  const rockB = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 1), materials.groundAccent);
  rockB.position.set(0.78, 0.24, -0.05);
  rockB.scale.set(1.15, 0.62, 0.8);
  rockB.rotation.set(-0.2, 0.5, 0.15);
  rockB.castShadow = true;
  perch.add(rockB);
  scene.add(perch);

  // Lighting is broad and directional so the individual feather volumes read in the viewport.
  scene.add(new THREE.HemisphereLight(0xa9b4af, 0x11100d, 1.8));
  const key = new THREE.DirectionalLight(0xffe1b5, 3.7);
  key.position.set(-5, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 11;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.00035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c9da1, 1.1);
  rim.position.set(6, 5, -8);
  scene.add(rim);
  const fill = new THREE.PointLight(0xc18b52, 0.55, 12);
  fill.position.set(0, 4, 4);
  scene.add(fill);

  const poseText = {
    idle: 'Direct mesh animation · breath + balance',
    flap: 'Powered flight · deep beats · tuck',
    glide: 'Soaring profile · dihedral · steering tail',
    walk: 'Ground locomotion · rolling weight shift',
    head: 'Neck counter-motion · visual scan',
    screech: 'Display behavior · gape + feather flare'
  };
  const labels = { idle: 'IDLE', flap: 'WING FLAP', glide: 'GLIDE', walk: 'WALK', head: 'HEAD TURN', screech: 'SCREECH' };
  const durations = { idle: 5, flap: 3.2, glide: 6.5, walk: 3.5, head: 4.8, screech: 2.0 };
  let mode = 'idle';
  let elapsed = 0;
  let speed = Number(speedInput.value);
  let playing = true;

  function setWingFold(amount = 0.58, lift = 0.18) {
    refs.wingRoots.forEach(({ node, side }) => {
      node.scale.set(amount, 0.78 + amount * 0.22, 0.79 + amount * 0.21);
      node.rotation.z = side * lift;
      node.rotation.y = side * 0.10 * (1 - amount);
    });
  }

  function setWingFlight(lift, flex, phase) {
    refs.wingRoots.forEach(({ node, side }) => {
      node.scale.set(0.98 + flex * 0.04, 0.98 + flex * 0.02, 0.96 + flex * 0.04);
      node.rotation.z = side * lift;
      node.rotation.y = side * (0.045 + flex * 0.04);
    });
    refs.coverts.forEach(({ node, side, index }) => {
      node.rotation.y += side * (0.02 * Math.sin(phase * Math.PI * 2 + index * 0.55));
      node.rotation.x = -0.035 * Math.sin(phase * Math.PI * 2 + index * 0.32);
    });
    refs.secondaries.forEach(({ node, side, index }) => {
      node.rotation.y += side * flex * (0.052 + index * 0.004);
      node.rotation.x = -0.025 + flex * 0.085 * Math.sin(phase * Math.PI * 2 + index * 0.28);
    });
    refs.primaries.forEach(({ node, side, index }) => {
      node.rotation.y += side * flex * (0.06 + index * 0.006);
      node.rotation.x = -0.02 + flex * (0.035 + index * 0.003) * Math.sin(phase * Math.PI * 2 + index * 0.19);
    });
  }

  function setTuckedLegs(amount, phase = 0) {
    refs.legs.forEach(({ node, side }) => {
      node.rotation.x = amount * (0.90 + side * 0.015);
      node.rotation.z = side * amount * 0.035;
      node.position.z += -amount * 0.12;
      node.position.y += amount * 0.07;
    });
    refs.feet.forEach(({ node, side }) => {
      node.rotation.x = amount * 0.18;
      node.rotation.z = side * amount * 0.04;
    });
  }

  function animateTail(spread, steer) {
    refs.tail.rotation.x = -spread * 0.12;
    refs.tail.rotation.z = steer * 0.09;
    refs.tailFeathers.forEach(({ node, center }) => {
      node.rotation.z += center * spread * 0.010;
      node.rotation.y = center * steer * 0.018;
    });
  }

  function applyPose(name, t) {
    resetPose();
    const cycle = t / durations[name];
    const phase = cycle - Math.floor(cycle);
    const wave = Math.sin(phase * Math.PI * 2);
    const ease = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);

    if (name === 'idle') {
      const breath = Math.sin(t * Math.PI * 0.78);
      eagle.position.y = 0.015 + breath * 0.015;
      refs.torso.scale.y = 1 + breath * 0.015;
      refs.torso.rotation.z = Math.sin(t * 0.55) * 0.012;
      setWingFold(0.57, 0.15 + Math.sin(t * 0.48) * 0.018);
      refs.head.rotation.y = Math.sin(t * 0.54) * 0.08;
      refs.head.rotation.z = Math.sin(t * 0.39) * 0.018;
      refs.neck.rotation.y = -Math.sin(t * 0.54) * 0.025;
      refs.lowerBeak.rotation.x = 0.015 + Math.max(0, Math.sin(t * 0.31)) * 0.025;
      refs.tail.rotation.z = Math.sin(t * 0.33) * 0.018;
      animateTail(0.18, Math.sin(t * 0.29));
      readout.textContent = poseText.idle;
    }

    if (name === 'flap') {
      // A golden eagle uses a small group of deep beats before settling into a short glide.
      const beat = Math.sin(phase * Math.PI * 2);
      const lift = 0.26 + (0.58 + 0.08 * Math.sin(phase * Math.PI * 4)) * (0.5 + 0.5 * beat);
      const downstroke = Math.max(0, -beat);
      eagle.position.y = 0.40 + Math.sin(phase * Math.PI * 4) * 0.09;
      eagle.rotation.x = -0.025 + Math.sin(phase * Math.PI * 2) * 0.024;
      refs.torso.rotation.z = Math.sin(phase * Math.PI * 2) * 0.025;
      refs.head.rotation.y = Math.sin(phase * Math.PI * 2 + 0.3) * 0.045;
      setWingFlight(lift, 0.76 + downstroke * 0.24, phase);
      setTuckedLegs(0.78 + 0.10 * (0.5 + 0.5 * beat), phase);
      animateTail(0.75, Math.sin(phase * Math.PI * 2 + 0.45));
      readout.textContent = poseText.flap;
    }

    if (name === 'glide') {
      const glideWave = Math.sin(t * 0.44);
      eagle.position.y = 1.82 + glideWave * 0.08;
      eagle.rotation.x = -0.055 + glideWave * 0.012;
      refs.torso.rotation.z = Math.sin(t * 0.32) * 0.014;
      refs.head.rotation.y = Math.sin(t * 0.35) * 0.045;
      // Slight dihedral, broad straight wings, and fully spread primaries.
      setWingFlight(0.34 + glideWave * 0.018, 1.0, phase);
      refs.primaries.forEach(({ node, side, index }) => {
        node.rotation.y += side * (0.02 + index * 0.004);
      });
      setTuckedLegs(0.95, phase);
      animateTail(1.0, Math.sin(t * 0.29) * 0.8);
      readout.textContent = poseText.glide;
    }

    if (name === 'walk') {
      const step = Math.sin(phase * Math.PI * 2);
      const lift = Math.max(0, step);
      eagle.position.y = 0.01 + Math.abs(step) * 0.018;
      eagle.rotation.z = step * 0.035;
      refs.torso.position.y += Math.abs(step) * 0.052;
      refs.torso.rotation.x = -0.035 + Math.abs(step) * 0.018;
      refs.head.position.y += Math.abs(step) * 0.035;
      refs.head.rotation.y = Math.sin(phase * Math.PI * 2) * 0.07;
      refs.neck.rotation.y = -Math.sin(phase * Math.PI * 2) * 0.028;
      setWingFold(0.51, 0.18 + Math.abs(step) * 0.045);
      refs.legs.forEach(({ node, side }) => {
        const stride = Math.sin(phase * Math.PI * 2 + (side === 1 ? 0 : Math.PI));
        node.position.z += stride * 0.17;
        node.position.y += Math.max(0, -stride) * 0.025;
        node.rotation.x = -stride * 0.11;
        node.rotation.z = side * stride * 0.018;
      });
      refs.feet.forEach(({ node, side }) => {
        const stride = Math.sin(phase * Math.PI * 2 + (side === 1 ? 0 : Math.PI));
        node.rotation.x = -stride * 0.10;
      });
      animateTail(0.28, step * 0.35);
      readout.textContent = poseText.walk;
    }

    if (name === 'head') {
      const turn = Math.sin(phase * Math.PI * 2);
      const settle = Math.sin(phase * Math.PI * 4) * 0.035;
      eagle.position.y = 0.02 + Math.abs(turn) * 0.01;
      refs.torso.rotation.z = turn * 0.012;
      setWingFold(0.56, 0.16);
      refs.neck.rotation.y = -turn * 0.18;
      refs.neck.rotation.z = -turn * 0.025;
      refs.head.rotation.y = turn * 0.66;
      refs.head.rotation.z = settle;
      refs.head.rotation.x = Math.abs(turn) * 0.03;
      refs.lowerBeak.rotation.x = 0.02;
      animateTail(0.20, turn * 0.22);
      readout.textContent = poseText.head;
    }

    if (name === 'screech') {
      const q = Math.min(t / durations.screech, 1);
      const attack = Math.sin(Math.min(q * 1.24, 1) * Math.PI);
      const open = Math.sin(Math.min(q * 1.13, 1) * Math.PI);
      eagle.position.y = 0.03 + attack * 0.10;
      refs.torso.rotation.x = -attack * 0.08;
      refs.torso.rotation.z = Math.sin(q * Math.PI * 2) * 0.028;
      refs.neck.rotation.x = -attack * 0.08;
      refs.head.rotation.x = -attack * 0.13;
      refs.head.rotation.y = Math.sin(q * Math.PI * 2) * 0.12;
      refs.lowerBeak.rotation.x = open * 0.72;
      refs.mouth.scale.y = 1 + open * 1.4;
      refs.mouth.position.y -= open * 0.03;
      setWingFold(0.70 - attack * 0.05, 0.28 + attack * 0.22);
      refs.wingRoots.forEach(({ node, side }) => { node.rotation.x = attack * 0.10; });
      refs.coverts.forEach(({ node, side, index }) => { node.rotation.x -= attack * 0.14 * (0.5 + index / 18); });
      refs.tail.rotation.x = -attack * 0.15;
      readout.textContent = poseText.screech;
    }
  }

  function selectMode(next) {
    mode = next;
    elapsed = 0;
    document.querySelectorAll('.mode-btn').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    poseLabel.textContent = labels[mode];
    if (mode === 'screech') readout.textContent = poseText.screech;
  }

  document.querySelectorAll('.mode-btn').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.mode)));
  playToggle.addEventListener('click', () => {
    playing = !playing;
    playToggle.textContent = playing ? 'Ⅱ' : '▶';
    playToggle.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
  });
  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value);
    speedValue.textContent = `${speed.toFixed(2)}×`;
  });

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  window.addEventListener('resize', resize);
  resize();
  loading.classList.add('done');

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (playing) elapsed += dt * speed;
    applyPose(mode, elapsed);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
