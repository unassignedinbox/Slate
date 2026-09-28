import * as THREE from 'three';
import { EagleTextures } from './EagleTextures.js';
import { EAGLE_PLUMAGE_PRESETS } from './EaglePlumages.js';

/**
 * Procedural Anatomical 3D Eagle Generator for AAA Games
 * Generates high-detail geometries, PBR materials, multi-tier feather arrays,
 * hooked beak, cere with nares, raptor eyes, talons, and full skeletal rig.
 */
export class EagleModel {
  constructor(options = {}) {
    this.options = Object.assign({
      plumage: 'bald', // 'bald' | 'golden' | 'harpy' | 'arctic' | 'shadow'
      wingspan: 2.15,  // 2.15 meters (~7 feet) - authentic adult eagle scale
      bodyLength: 0.88 // 0.88 meters (~35 inches)
    }, options);

    this.textures = new EagleTextures();
    this.bones = {};
    this.materials = {};
    this.group = new THREE.Group();
    this.group.name = 'Eagle_Root_Hierarchy';

    this.initMaterials();
    this.buildSkeleton();
    this.buildMeshes();
  }

  /**
   * Initialize PBR Materials
   */
  initMaterials() {
    const preset = EAGLE_PLUMAGE_PRESETS[this.options.plumage] || EAGLE_PLUMAGE_PRESETS.bald;

    // Body & Head Plumage Textures
    const headTex = this.textures.getBodyFeatherTexture(preset.headColor);
    const bodyTex = this.textures.getBodyFeatherTexture(preset.bodyColor);
    const wingTex = this.textures.getFeatherTexture('flight', preset.wingColor);
    const tailTex = this.textures.getFeatherTexture('flight', preset.tailColor);
    const beakTex = this.textures.getBeakTexture(preset.beakPreset);
    const eyeTex = this.textures.getEyeTexture();
    const legTex = this.textures.getLegAndTalonTexture();
    const mouthTex = this.textures.getMouthTexture();

    // Head Material
    this.materials.head = new THREE.MeshStandardMaterial({
      color: preset.headColor === 'white' ? 0xffffff : (preset.headColor === 'golden' ? 0x9b6b3b : 0x221810),
      map: headTex.diffTexture,
      normalMap: headTex.normalTexture,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: headTex.roughTexture,
      roughness: 0.75,
      metalness: 0.02,
      shadowSide: THREE.DoubleSide
    });

    // Body & Keel Plumage Material
    this.materials.body = new THREE.MeshStandardMaterial({
      color: preset.bodyColor === 'white' ? 0xffffff : (preset.bodyColor === 'golden' ? 0x5a3717 : 0x241912),
      map: bodyTex.diffTexture,
      normalMap: bodyTex.normalTexture,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughnessMap: bodyTex.roughTexture,
      roughness: 0.7,
      metalness: 0.03,
      shadowSide: THREE.DoubleSide
    });

    // Wing Flight Feathers Material (Primaries, Secondaries, Coverts)
    this.materials.flightFeathers = new THREE.MeshStandardMaterial({
      color: preset.wingColor === 'white' ? 0xf8f9fa : (preset.wingColor === 'golden' ? 0x6a401a : 0x1f1610),
      map: wingTex.diffTexture,
      normalMap: wingTex.normalTexture,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: wingTex.roughTexture,
      roughness: 0.65,
      metalness: 0.05,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    });

    // Tail Rectrices Material
    this.materials.tailFeathers = new THREE.MeshStandardMaterial({
      color: preset.tailColor === 'white' ? 0xffffff : (preset.tailColor === 'golden' ? 0x7b4a1f : 0x241a12),
      map: tailTex.diffTexture,
      normalMap: tailTex.normalTexture,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: tailTex.roughTexture,
      roughness: 0.7,
      metalness: 0.02,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    });

    // Beak Material (Keratin + Culmen)
    this.materials.beak = new THREE.MeshStandardMaterial({
      color: new THREE.Color(preset.beakColor),
      map: beakTex.diffTexture,
      normalMap: beakTex.normalTexture,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: beakTex.roughTexture,
      roughness: 0.35,
      metalness: 0.08
    });

    // Cere Material (Waxy skin base around nostrils)
    this.materials.cere = new THREE.MeshStandardMaterial({
      color: new THREE.Color(preset.cereColor),
      roughness: 0.7,
      metalness: 0.02
    });

    // Raptor Eye Material
    this.materials.eye = new THREE.MeshStandardMaterial({
      map: eyeTex.diffTexture,
      normalMap: eyeTex.normalTexture,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.05, // Glossy reflective cornea
      metalness: 0.1
    });

    // Leg Scaled Skin Material
    this.materials.legSkin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(preset.legColor),
      map: legTex.diffTexture,
      normalMap: legTex.normalTexture,
      normalScale: new THREE.Vector2(1.8, 1.8),
      roughnessMap: legTex.roughTexture,
      roughness: 0.55,
      metalness: 0.05
    });

    // Talon Claw Material (Razor Keratin)
    this.materials.talon = new THREE.MeshStandardMaterial({
      color: new THREE.Color(preset.talonColor),
      normalMap: legTex.normalTexture,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.25,
      metalness: 0.2
    });

    // Inner Mouth & Tongue Material
    this.materials.mouth = new THREE.MeshStandardMaterial({
      map: mouthTex.diffTexture,
      normalMap: mouthTex.normalTexture,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.2, // Wet oral cavity
      metalness: 0.05,
      side: THREE.DoubleSide
    });
  }

  /**
   * Update plumage preset dynamically
   */
  setPlumage(plumageKey) {
    if (!EAGLE_PLUMAGE_PRESETS[plumageKey]) return;
    this.options.plumage = plumageKey;
    this.initMaterials();
    this.applyMaterialsToHierarchy();
  }

  applyMaterialsToHierarchy() {
    this.group.traverse(child => {
      if (child.isMesh && child.userData.matKey) {
        child.material = this.materials[child.userData.matKey];
      }
    });
  }

  /**
   * Construct Skeletal Bone Hierarchy
   */
  buildSkeleton() {
    const b = this.bones;

    // Master Root (Positioned around eagle center of mass)
    b.root = new THREE.Bone();
    b.root.name = 'root';
    b.root.position.set(0, 1.2, 0);

    // Spine & Keel (Deep sternum chest)
    b.spine_base = new THREE.Bone();
    b.spine_base.name = 'spine_base';
    b.spine_base.position.set(0, 0, 0.15);
    b.root.add(b.spine_base);

    b.spine_mid = new THREE.Bone();
    b.spine_mid.name = 'spine_mid';
    b.spine_mid.position.set(0, 0.05, -0.12);
    b.spine_base.add(b.spine_mid);

    b.chest = new THREE.Bone();
    b.chest.name = 'chest';
    b.chest.position.set(0, 0.1, -0.15);
    b.spine_mid.add(b.chest);

    // Neck chain (3 flexible cervical segments for fluid S-curve & saccades)
    b.neck_1 = new THREE.Bone();
    b.neck_1.name = 'neck_1';
    b.neck_1.position.set(0, 0.1, -0.12);
    b.chest.add(b.neck_1);

    b.neck_2 = new THREE.Bone();
    b.neck_2.name = 'neck_2';
    b.neck_2.position.set(0, 0.12, -0.08);
    b.neck_1.add(b.neck_2);

    b.neck_3 = new THREE.Bone();
    b.neck_3.name = 'neck_3';
    b.neck_3.position.set(0, 0.12, -0.06);
    b.neck_2.add(b.neck_3);

    // Head (Raptor Cranium)
    b.head = new THREE.Bone();
    b.head.name = 'head';
    b.head.position.set(0, 0.08, -0.08);
    b.neck_3.add(b.head);

    // Jaw Mandible (Lower bill for screeching open-beak)
    b.jaw_lower = new THREE.Bone();
    b.jaw_lower.name = 'jaw_lower';
    b.jaw_lower.position.set(0, -0.03, -0.12);
    b.head.add(b.jaw_lower);

    // Left and Right Wings
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;

      // Shoulder
      const shoulder = new THREE.Bone();
      shoulder.name = `shoulder_${side}`;
      shoulder.position.set(sign * 0.14, 0.06, -0.05);
      b.chest.add(shoulder);
      b[`shoulder_${side}`] = shoulder;

      // Humerus (Upper arm)
      const humerus = new THREE.Bone();
      humerus.name = `humerus_${side}`;
      humerus.position.set(sign * 0.28, -0.02, 0.04);
      shoulder.add(humerus);
      b[`humerus_${side}`] = humerus;

      // Elbow & Forearm (Ulna/Radius)
      const elbow = new THREE.Bone();
      elbow.name = `elbow_${side}`;
      elbow.position.set(sign * 0.32, -0.02, 0.08);
      humerus.add(elbow);
      b[`elbow_${side}`] = elbow;

      // Wrist / Carpal joint
      const wrist = new THREE.Bone();
      wrist.name = `wrist_${side}`;
      wrist.position.set(sign * 0.32, -0.02, -0.05);
      elbow.add(wrist);
      b[`wrist_${side}`] = wrist;

      // Wing Hand / Manus
      const hand = new THREE.Bone();
      hand.name = `hand_${side}`;
      hand.position.set(sign * 0.24, -0.01, -0.08);
      wrist.add(hand);
      b[`hand_${side}`] = hand;

      // Wingtip / Primaries distal bone
      const wingtip = new THREE.Bone();
      wingtip.name = `wingtip_${side}`;
      wingtip.position.set(sign * 0.22, 0.0, -0.05);
      hand.add(wingtip);
      b[`wingtip_${side}`] = wingtip;

      // Alula (Thumb bastard wing on wrist)
      const alula = new THREE.Bone();
      alula.name = `alula_${side}`;
      alula.position.set(sign * 0.05, 0.04, -0.08);
      wrist.add(alula);
      b[`alula_${side}`] = alula;
    });

    // Tail Base & Pygostyle
    b.tail_base = new THREE.Bone();
    b.tail_base.name = 'tail_base';
    b.tail_base.position.set(0, -0.02, 0.28);
    b.spine_base.add(b.tail_base);

    b.tail_tip = new THREE.Bone();
    b.tail_tip.name = 'tail_tip';
    b.tail_tip.position.set(0, -0.04, 0.28);
    b.tail_base.add(b.tail_tip);

    // Left and Right Legs & Talons
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;

      // Hip
      const hip = new THREE.Bone();
      hip.name = `hip_${side}`;
      hip.position.set(sign * 0.1, -0.08, 0.05);
      b.spine_base.add(hip);
      b[`hip_${side}`] = hip;

      // Thigh (Femur in feather trousers)
      const thigh = new THREE.Bone();
      thigh.name = `thigh_${side}`;
      thigh.position.set(sign * 0.04, -0.18, 0.06);
      hip.add(thigh);
      b[`thigh_${side}`] = thigh;

      // Knee & Tarsus (Lower scaled leg)
      const knee = new THREE.Bone();
      knee.name = `knee_${side}`;
      knee.position.set(0, -0.22, -0.08);
      thigh.add(knee);
      b[`knee_${side}`] = knee;

      // Ankle & Foot
      const foot = new THREE.Bone();
      foot.name = `foot_${side}`;
      foot.position.set(0, -0.16, 0.04);
      knee.add(foot);
      b[`foot_${side}`] = foot;

      // Hallux (Back toe with massive grasping talon)
      const toeHallux = new THREE.Bone();
      toeHallux.name = `toe_hallux_${side}`;
      toeHallux.position.set(0, -0.02, 0.08);
      foot.add(toeHallux);
      b[`toe_hallux_${side}`] = toeHallux;

      // Inner Toe (Digit II)
      const toeInner = new THREE.Bone();
      toeInner.name = `toe_inner_${side}`;
      toeInner.position.set(sign * -0.04, -0.02, -0.09);
      foot.add(toeInner);
      b[`toe_inner_${side}`] = toeInner;

      // Middle Toe (Digit III - Longest)
      const toeMid = new THREE.Bone();
      toeMid.name = `toe_mid_${side}`;
      toeMid.position.set(0, -0.02, -0.12);
      foot.add(toeMid);
      b[`toe_mid_${side}`] = toeMid;

      // Outer Toe (Digit IV)
      const toeOuter = new THREE.Bone();
      toeOuter.name = `toe_outer_${side}`;
      toeOuter.position.set(sign * 0.04, -0.02, -0.09);
      foot.add(toeOuter);
      b[`toe_outer_${side}`] = toeOuter;
    });

    this.group.add(b.root);
  }

  /**
   * Build High-Resolution Realistic Meshes and Attach to Bones
   */
  buildMeshes() {
    this.buildTorso();
    this.buildHeadAndBeak();
    this.buildWings();
    this.buildTail();
    this.buildLegsAndTalons();
  }

  /**
   * Helper to register mesh material key for dynamic plumage swapping
   */
  tagMesh(mesh, matKey) {
    mesh.userData.matKey = matKey;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Build Eagle Torso (Chest, Keel, Flanks, Mantle)
   */
  buildTorso() {
    // Deep aerodynamic keel-shaped torso using a sculpted profile
    const bodyPoints = [
      new THREE.Vector2(0.00, 0.28),   // Upper neck base
      new THREE.Vector2(0.14, 0.24),
      new THREE.Vector2(0.22, 0.16),   // Shoulder width
      new THREE.Vector2(0.24, 0.05),   // Broad chest/keel
      new THREE.Vector2(0.23, -0.10),  // Deep belly
      new THREE.Vector2(0.18, -0.22),  // Flank taper
      new THREE.Vector2(0.11, -0.32),  // Pelvis / rump
      new THREE.Vector2(0.04, -0.38),  // Caudal pygostyle
      new THREE.Vector2(0.00, -0.40)
    ];

    const bodyGeo = new THREE.LatheGeometry(bodyPoints, 32);
    // Sculpt to aerodynamic avian cross-section: deeper along Y (keel) than X
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Squeeze laterally, deepen keel vertically, taper back
      x *= 0.85; // Lateral compression
      if (z < 0) {
        y *= 1.25; // Deep sternal keel at front/bottom
      }
      pos.setXYZ(i, x, y, z);
    }
    bodyGeo.computeVertexNormals();

    const bodyMesh = new THREE.Mesh(bodyGeo, this.materials.body);
    bodyMesh.rotation.x = Math.PI * 0.5;
    bodyMesh.position.set(0, 0.02, 0.02);
    this.tagMesh(bodyMesh, 'body');
    this.bones.chest.add(bodyMesh);

    // Scapular mantle feathers (layered feather mantle over the back)
    const mantleGeo = new THREE.PlaneGeometry(0.32, 0.28, 8, 8);
    const mPos = mantleGeo.attributes.position;
    for (let i = 0; i < mPos.count; i++) {
      const u = mPos.getX(i);
      const v = mPos.getY(i);
      mPos.setZ(i, -Math.sin((u + 0.16) / 0.32 * Math.PI) * 0.06 - (v * 0.05));
    }
    mantleGeo.computeVertexNormals();

    const mantleMesh = new THREE.Mesh(mantleGeo, this.materials.body);
    mantleMesh.rotation.x = -Math.PI * 0.35;
    mantleMesh.position.set(0, 0.14, 0.05);
    this.tagMesh(mantleMesh, 'body');
    this.bones.chest.add(mantleMesh);
  }

  /**
   * Build Sculpted Eagle Head, Beak, Cere, Eyes, and Mouth Cavity
   */
  buildHeadAndBeak() {
    const headBone = this.bones.head;

    // 1. Cranium & Neck Plumage (Sculpted raptor skull)
    const headGeo = new THREE.SphereGeometry(0.12, 32, 24);
    const hPos = headGeo.attributes.position;
    for (let i = 0; i < hPos.count; i++) {
      let x = hPos.getX(i);
      let y = hPos.getY(i);
      let z = hPos.getZ(i);

      // Flatten sides of head slightly
      x *= 0.82;

      // Elongate backward for crown/nape crest
      if (z > 0) {
        z *= 1.25;
        y += (z * 0.15);
      }

      // Slope forehead forward towards beak
      if (z < 0 && y > 0) {
        y *= 0.9;
        z *= 1.15;
      }

      // Supraorbital Brow Ridge (Bulge over eyes for intense raptor glare)
      if (y > 0.02 && y < 0.08 && z < -0.01 && Math.abs(x) > 0.05) {
        x *= 1.18;
        y += 0.018;
      }

      hPos.setXYZ(i, x, y, z);
    }
    headGeo.computeVertexNormals();

    const headMesh = new THREE.Mesh(headGeo, this.materials.head);
    headMesh.position.set(0, 0, 0);
    this.tagMesh(headMesh, 'head');
    headBone.add(headMesh);

    // 2. Supraorbital Ridge Brow Shelves (Heavy raptor bone arches over eyes)
    [-1, 1].forEach(side => {
      const browGeo = new THREE.CylinderGeometry(0.015, 0.008, 0.07, 12);
      const browMesh = new THREE.Mesh(browGeo, this.materials.head);
      browMesh.rotation.z = side * 0.45;
      browMesh.rotation.x = -0.6;
      browMesh.rotation.y = side * 0.35;
      browMesh.position.set(side * 0.072, 0.045, -0.06);
      this.tagMesh(browMesh, 'head');
      headBone.add(browMesh);
    });

    // 3. Predatory Hooked Upper Beak (Maxilla)
    const beakShape = new THREE.Shape();
    // Beak side profile
    beakShape.moveTo(0, 0.05);     // Cere top
    beakShape.quadraticCurveTo(0.08, 0.045, 0.14, -0.01); // Arched culmen
    beakShape.quadraticCurveTo(0.17, -0.06, 0.16, -0.11); // Hook tip curvature
    beakShape.lineTo(0.13, -0.09); // Hook inner point
    beakShape.quadraticCurveTo(0.07, -0.025, 0.0, -0.02); // Tomia cutting edge
    beakShape.closePath();

    const extrudeSettings = {
      steps: 8,
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 5
    };

    const maxillaGeo = new THREE.ExtrudeGeometry(beakShape, extrudeSettings);
    maxillaGeo.center();
    // Taper the beak towards the hook tip
    const bPos = maxillaGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      let x = bPos.getX(i);
      let y = bPos.getY(i);
      let z = bPos.getZ(i);

      const t = (x + 0.08) / 0.24;
      const widthScale = 1.0 - Math.max(0, Math.min(1, t)) * 0.82;
      z *= widthScale;

      bPos.setXYZ(i, x, y, z);
    }
    maxillaGeo.computeVertexNormals();

    const maxillaMesh = new THREE.Mesh(maxillaGeo, this.materials.beak);
    maxillaMesh.rotation.y = -Math.PI * 0.5;
    maxillaMesh.position.set(0, 0.01, -0.19);
    this.tagMesh(maxillaMesh, 'beak');
    headBone.add(maxillaMesh);

    // 4. Waxy Cere (Nostril saddle at base of beak)
    const cereGeo = new THREE.CylinderGeometry(0.048, 0.056, 0.045, 16);
    const cereMesh = new THREE.Mesh(cereGeo, this.materials.cere);
    cereMesh.rotation.x = Math.PI * 0.45;
    cereMesh.position.set(0, 0.028, -0.135);
    this.tagMesh(cereMesh, 'cere');
    headBone.add(cereMesh);

    // Nostrils / Nares (Angled oval slits on cere)
    [-1, 1].forEach(side => {
      const naresGeo = new THREE.CylinderGeometry(0.005, 0.003, 0.025, 8);
      const naresMat = new THREE.MeshBasicMaterial({ color: 0x1a1208 });
      const naresMesh = new THREE.Mesh(naresGeo, naresMat);
      naresMesh.rotation.x = Math.PI * 0.4;
      naresMesh.rotation.z = side * 0.35;
      naresMesh.position.set(side * 0.025, 0.035, -0.14);
      headBone.add(naresMesh);
    });

    // 5. Lower Beak (Mandible) attached to articulated jaw bone
    const jawBone = this.bones.jaw_lower;
    const mandibleShape = new THREE.Shape();
    mandibleShape.moveTo(0, 0.015);
    mandibleShape.lineTo(0.12, 0.0);
    mandibleShape.lineTo(0.12, -0.018);
    mandibleShape.quadraticCurveTo(0.05, -0.022, 0.0, -0.012);
    mandibleShape.closePath();

    const manGeo = new THREE.ExtrudeGeometry(mandibleShape, {
      steps: 6,
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 4
    });
    manGeo.center();
    const manPos = manGeo.attributes.position;
    for (let i = 0; i < manPos.count; i++) {
      let x = manPos.getX(i);
      let y = manPos.getY(i);
      let z = manPos.getZ(i);
      const t = (x + 0.06) / 0.18;
      z *= (1.0 - Math.max(0, Math.min(1, t)) * 0.75);
      manPos.setXYZ(i, x, y, z);
    }
    manGeo.computeVertexNormals();

    const mandibleMesh = new THREE.Mesh(manGeo, this.materials.beak);
    mandibleMesh.rotation.y = -Math.PI * 0.5;
    mandibleMesh.position.set(0, -0.015, -0.05);
    this.tagMesh(mandibleMesh, 'beak');
    jawBone.add(mandibleMesh);

    // 6. Oral Cavity & Tongue (For Screech Animation)
    const tongueGeo = new THREE.ConeGeometry(0.018, 0.07, 12);
    const tongueMesh = new THREE.Mesh(tongueGeo, this.materials.mouth);
    tongueMesh.rotation.x = -Math.PI * 0.48;
    tongueMesh.position.set(0, 0.005, -0.04);
    tongueMesh.scale.set(0.9, 0.3, 1.0);
    this.tagMesh(tongueMesh, 'mouth');
    jawBone.add(tongueMesh);

    // 7. Raptor Eyes (Deep set beneath supraorbital ridge)
    [-1, 1].forEach(side => {
      // Eyeball
      const eyeGeo = new THREE.SphereGeometry(0.026, 24, 24);
      const eyeMesh = new THREE.Mesh(eyeGeo, this.materials.eye);
      eyeMesh.rotation.y = side * Math.PI * 0.45;
      eyeMesh.rotation.x = 0.08;
      eyeMesh.position.set(side * 0.075, 0.022, -0.042);
      this.tagMesh(eyeMesh, 'eye');
      headBone.add(eyeMesh);

      // Peri-orbital fleshy ring / eyelid edge
      const rimGeo = new THREE.TorusGeometry(0.028, 0.006, 12, 24);
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0xdeb020,
        roughness: 0.8
      });
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.rotation.y = side * Math.PI * 0.45;
      rimMesh.position.set(side * 0.076, 0.022, -0.042);
      headBone.add(rimMesh);
    });
  }

  /**
   * Helper: Generate a single 3D aerodynamic flight feather geometry
   */
  createFeatherGeometry(length = 0.4, width = 0.09, curvature = 0.03, emargination = 0.0) {
    const geo = new THREE.PlaneGeometry(width, length, 12, 16);
    const pos = geo.attributes.position;
    const uvs = geo.attributes.uv;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Normalized along length from base (y = -len/2) to tip (y = +len/2)
      const t = (y + length * 0.5) / length; // 0 (base) to 1 (tip)

      // Feather shape outline: narrow base, broad mid-vane, tapered tip
      let widthFactor = Math.sin(t * Math.PI * 0.9 + 0.1);

      // Emargination / Notching on outer primaries (narrowed slotted finger tip)
      if (emargination > 0 && t > (1.0 - emargination)) {
        const notchFactor = (t - (1.0 - emargination)) / emargination;
        // Asymmetric notch on leading edge
        if (x < 0) {
          x *= (1.0 - notchFactor * 0.55);
        } else {
          x *= (1.0 - notchFactor * 0.35);
        }
      }

      x *= widthFactor;

      // Airfoil Camber: Curved cross-section for aerodynamic lift
      const normX = x / (width * 0.5 + 0.001);
      const camber = (1.0 - normX * normX) * (curvature * (1.0 - t * 0.3));
      
      // Longitudinal bend along shaft
      const shaftBend = Math.pow(t, 2) * (curvature * 0.8);
      z = camber - shaftBend;

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Build Fully Feathered Wings (Primaries, Secondaries, Coverts, Alula, Scapulars)
   */
  buildWings() {
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const shoulder = this.bones[`shoulder_${side}`];
      const humerus = this.bones[`humerus_${side}`];
      const elbow = this.bones[`elbow_${side}`];
      const wrist = this.bones[`wrist_${side}`];
      const hand = this.bones[`hand_${side}`];
      const alulaBone = this.bones[`alula_${side}`];

      // 1. Primaries (10 flight feathers P1 - P10)
      // Outer primaries P7-P10 have heavy emarginations (slotted finger feathers)
      const primaryCount = 10;
      for (let p = 0; p < primaryCount; p++) {
        const pNorm = p / (primaryCount - 1); // 0 (inner P1) to 1 (outer P10)
        const featherLen = 0.42 + pNorm * 0.22; // Outer primaries are longest (~0.64m)
        const featherWidth = 0.075 + (1 - pNorm) * 0.02;
        const emargination = p >= 6 ? 0.38 + (p - 6) * 0.1 : 0.0; // P7-P10 slotted tips

        const featherGeo = this.createFeatherGeometry(featherLen, featherWidth, 0.025, emargination);
        const featherMesh = new THREE.Mesh(featherGeo, this.materials.flightFeathers);

        // Position radiating along hand and wrist
        featherMesh.position.set(
          sign * (0.04 + p * 0.024),
          -0.01 + p * 0.002,
          0.12 + p * 0.035
        );
        
        // Fan angle spread for primaries
        featherMesh.rotation.x = Math.PI * 0.52 + (p * 0.04);
        featherMesh.rotation.y = sign * (0.15 + p * 0.08);
        featherMesh.rotation.z = sign * (0.12 - p * 0.05);

        this.tagMesh(featherMesh, 'flightFeathers');
        hand.add(featherMesh);
      }

      // 2. Secondaries (12 flight feathers S1 - S12 along the forearm/ulna)
      const secondaryCount = 12;
      for (let s = 0; s < secondaryCount; s++) {
        const sNorm = s / (secondaryCount - 1);
        const featherLen = 0.38 - sNorm * 0.05;
        const featherWidth = 0.08;

        const featherGeo = this.createFeatherGeometry(featherLen, featherWidth, 0.02, 0.0);
        const featherMesh = new THREE.Mesh(featherGeo, this.materials.flightFeathers);

        featherMesh.position.set(
          sign * (0.02 + s * 0.026),
          -0.012,
          0.15 + (s * 0.015)
        );

        featherMesh.rotation.x = Math.PI * 0.52;
        featherMesh.rotation.y = sign * (0.08 + s * 0.03);
        featherMesh.rotation.z = sign * 0.06;

        this.tagMesh(featherMesh, 'flightFeathers');
        elbow.add(featherMesh);
      }

      // 3. Greater & Median Wing Coverts (Layered rows covering the quill bases)
      const covertGeo = new THREE.PlaneGeometry(0.35, 0.18, 8, 4);
      const covertPos = covertGeo.attributes.position;
      for (let i = 0; i < covertPos.count; i++) {
        covertPos.setZ(i, -Math.sin(covertPos.getX(i) * 5) * 0.015);
      }
      covertGeo.computeVertexNormals();

      const greaterCovertMesh = new THREE.Mesh(covertGeo, this.materials.body);
      greaterCovertMesh.position.set(sign * 0.16, 0.015, 0.08);
      greaterCovertMesh.rotation.x = -Math.PI * 0.45;
      greaterCovertMesh.rotation.y = sign * 0.1;
      this.tagMesh(greaterCovertMesh, 'body');
      elbow.add(greaterCovertMesh);

      // 4. Patagium (Leading edge fleshy elastic membrane)
      const pataGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.36, 12);
      const pataMesh = new THREE.Mesh(pataGeo, this.materials.body);
      pataMesh.rotation.z = sign * Math.PI * 0.45;
      pataMesh.position.set(sign * 0.16, 0.01, -0.04);
      this.tagMesh(pataMesh, 'body');
      elbow.add(pataMesh);

      // 5. Alula ("Bastard Wing" - 3 small feathers mounted on the wrist thumb)
      for (let a = 0; a < 3; a++) {
        const alulaGeo = this.createFeatherGeometry(0.14 - a * 0.02, 0.035, 0.01, 0.0);
        const alulaMesh = new THREE.Mesh(alulaGeo, this.materials.flightFeathers);
        alulaMesh.position.set(sign * (a * 0.01), 0.015, -0.03 - a * 0.015);
        alulaMesh.rotation.x = -Math.PI * 0.38;
        alulaMesh.rotation.y = sign * 0.2;
        this.tagMesh(alulaMesh, 'flightFeathers');
        alulaBone.add(alulaMesh);
      }
    });
  }

  /**
   * Build Fan Tail (12 Rectrices in Wedge Array + Coverts)
   */
  buildTail() {
    const tailBase = this.bones.tail_base;

    // 12 broad rectrices arranged in fan shape
    const rectrixCount = 12;
    for (let r = 0; r < rectrixCount; r++) {
      const rNorm = (r - (rectrixCount - 1) * 0.5) / ((rectrixCount - 1) * 0.5); // -1 (leftmost) to +1 (rightmost)
      const len = 0.42 - Math.abs(rNorm) * 0.06; // Wedge tail (central pair longest)
      const width = 0.075;

      const rectrixGeo = this.createFeatherGeometry(len, width, 0.015, 0.0);
      const rectrixMesh = new THREE.Mesh(rectrixGeo, this.materials.tailFeathers);

      // Spread fan angle
      const fanAngle = rNorm * 0.32; // Fan spread
      rectrixMesh.position.set(rNorm * 0.06, -0.015 + Math.abs(rNorm) * 0.005, 0.18);
      rectrixMesh.rotation.x = Math.PI * 0.54;
      rectrixMesh.rotation.y = fanAngle;
      rectrixMesh.rotation.z = -fanAngle * 0.2;

      this.tagMesh(rectrixMesh, 'tailFeathers');
      tailBase.add(rectrixMesh);
    }

    // Uppertail Coverts (Overlapping feather mantle over tail base)
    const upperCovertGeo = new THREE.PlaneGeometry(0.24, 0.18, 6, 6);
    const upperCovertMesh = new THREE.Mesh(upperCovertGeo, this.materials.body);
    upperCovertMesh.rotation.x = -Math.PI * 0.4;
    upperCovertMesh.position.set(0, 0.04, 0.08);
    this.tagMesh(upperCovertMesh, 'body');
    tailBase.add(upperCovertMesh);

    // Undertail Coverts
    const underCovertGeo = new THREE.PlaneGeometry(0.20, 0.14, 6, 6);
    const underCovertMesh = new THREE.Mesh(underCovertGeo, this.materials.tailFeathers);
    underCovertMesh.rotation.x = -Math.PI * 0.6;
    underCovertMesh.position.set(0, -0.04, 0.08);
    this.tagMesh(underCovertMesh, 'tailFeathers');
    tailBase.add(underCovertMesh);
  }

  /**
   * Helper: Build single heavy curved talon claw
   */
  createTalonClaw(length = 0.06, baseRadius = 0.012, curvature = 1.4) {
    const clawShape = new THREE.Shape();
    // Claw curved crescent profile
    clawShape.moveTo(0, baseRadius);
    clawShape.quadraticCurveTo(length * 0.4, baseRadius * 0.9, length, 0); // Sharp tip
    clawShape.quadraticCurveTo(length * 0.4, -baseRadius * 0.5, 0, -baseRadius);
    clawShape.closePath();

    const clawGeo = new THREE.ConeGeometry(baseRadius, length, 12, 12);
    const pos = clawGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Bend along Y axis into razor-sharp raptor talon hook
      const t = (y + length * 0.5) / length; // 0 (base) to 1 (tip)
      z -= Math.pow(t, 2) * (length * curvature);

      pos.setXYZ(i, x, y, z);
    }
    clawGeo.computeVertexNormals();
    return clawGeo;
  }

  /**
   * Build Legs, Scaled Feet, Plantar Pads, and Razor Talons (Anisodactyl Layout)
   */
  buildLegsAndTalons() {
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const thigh = this.bones[`thigh_${side}`];
      const knee = this.bones[`knee_${side}`];
      const foot = this.bones[`foot_${side}`];

      // 1. Thigh Feather Trousers (Tibiotarsus Plumage breeches)
      const trouserGeo = new THREE.CylinderGeometry(0.065, 0.045, 0.22, 16);
      const trPos = trouserGeo.attributes.position;
      for (let i = 0; i < trPos.count; i++) {
        trPos.setX(i, trPos.getX(i) * 0.85); // Muscle contour
      }
      trouserGeo.computeVertexNormals();

      const trouserMesh = new THREE.Mesh(trouserGeo, this.materials.body);
      trouserMesh.position.set(0, -0.09, 0);
      this.tagMesh(trouserMesh, 'body');
      thigh.add(trouserMesh);

      // 2. Scaled Tarsus (Lower Leg / Tarsometatarsus)
      const tarsusGeo = new THREE.CylinderGeometry(0.024, 0.020, 0.20, 16);
      const tarsusMesh = new THREE.Mesh(tarsusGeo, this.materials.legSkin);
      tarsusMesh.position.set(0, -0.08, 0.01);
      this.tagMesh(tarsusMesh, 'legSkin');
      knee.add(tarsusMesh);

      // 3. Central Foot Base & Plantar Pad
      const footPadGeo = new THREE.SphereGeometry(0.032, 16, 12);
      footPadGeo.scale(1.1, 0.55, 1.2);
      const footPadMesh = new THREE.Mesh(footPadGeo, this.materials.legSkin);
      footPadMesh.position.set(0, -0.01, 0);
      this.tagMesh(footPadMesh, 'legSkin');
      foot.add(footPadMesh);

      // 4. Anisodactyl Digits (4 Toes)
      const digits = [
        { name: 'hallux', bone: this.bones[`toe_hallux_${side}`], len: 0.08, clawLen: 0.065, rotY: Math.PI, clawCurv: 1.6 }, // Massive rear claw
        { name: 'inner',  bone: this.bones[`toe_inner_${side}`],  len: 0.09, clawLen: 0.058, rotY: sign * 0.35, clawCurv: 1.5 },
        { name: 'mid',    bone: this.bones[`toe_mid_${side}`],    len: 0.11, clawLen: 0.052, rotY: 0.0, clawCurv: 1.4 },          // Longest toe
        { name: 'outer',  bone: this.bones[`toe_outer_${side}`],  len: 0.085, clawLen: 0.048, rotY: sign * -0.35, clawCurv: 1.3 }
      ];

      digits.forEach(d => {
        const toeBone = d.bone;

        // Scaled toe phalanx cylinder
        const phalanxGeo = new THREE.CylinderGeometry(0.014, 0.011, d.len, 10);
        const phalanxMesh = new THREE.Mesh(phalanxGeo, this.materials.legSkin);
        phalanxMesh.rotation.x = Math.PI * 0.5;
        phalanxMesh.position.set(0, 0, -d.len * 0.45);
        this.tagMesh(phalanxMesh, 'legSkin');
        toeBone.add(phalanxMesh);

        // Toe fleshy gripping pad (tuberculate spicule nodule)
        const padGeo = new THREE.SphereGeometry(0.012, 10, 8);
        padGeo.scale(0.9, 0.6, 1.3);
        const padMesh = new THREE.Mesh(padGeo, this.materials.legSkin);
        padMesh.position.set(0, -0.009, -d.len * 0.5);
        this.tagMesh(padMesh, 'legSkin');
        toeBone.add(padMesh);

        // Razor Curved Talon Claw
        const clawGeo = this.createTalonClaw(d.clawLen, 0.012, d.clawCurv);
        const clawMesh = new THREE.Mesh(clawGeo, this.materials.talon);
        clawMesh.rotation.x = -Math.PI * 0.45;
        clawMesh.position.set(0, -0.008, -d.len * 0.95);
        this.tagMesh(clawMesh, 'talon');
        toeBone.add(clawMesh);
      });
    });
  }
}
