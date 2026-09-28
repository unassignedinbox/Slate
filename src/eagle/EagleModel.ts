import * as THREE from 'three';
import { EagleGeometry } from './EagleGeometry';
import { EagleTextures } from './EagleTextures';
import { EagleSkeleton } from './EagleSkeleton';
import { EagleRigNodes } from './EagleRig';

export type PlumageType = 'bald_eagle' | 'golden_eagle';

export interface AnatomicalHotspot {
  id: string;
  name: string;
  category: 'head' | 'wing' | 'body' | 'tail' | 'leg';
  position: THREE.Vector3;
  description: string;
  avianBiomechanics: string;
}

export class EagleModel {
  public group: THREE.Group;
  public rig!: EagleRigNodes;
  public hotspots: AnatomicalHotspot[] = [];
  public currentPlumage: PlumageType = 'bald_eagle';

  // Materials map for dynamic switching
  private materials: { [key: string]: THREE.Material } = {};

  constructor(plumage: PlumageType = 'bald_eagle') {
    this.group = new THREE.Group();
    this.group.name = 'eagle_master_root';
    this.currentPlumage = plumage;

    this.initMaterials();
    this.buildRigAndMesh();
    this.setupHotspots();
  }

  private initMaterials(): void {
    // Textures
    const primaryDarkTex = EagleTextures.createFeatherTexture('primary_dark');
    const secondaryDarkTex = EagleTextures.createFeatherTexture('secondary_dark');
    const tailWhiteTex = EagleTextures.createFeatherTexture('tail_white');
    const goldenMantleTex = EagleTextures.createFeatherTexture('golden_mantle');
    const covertBrownTex = EagleTextures.createFeatherTexture('covert_brown');
    const featherNorm = EagleTextures.createFeatherNormalMap();
    const eyeTex = EagleTextures.createEyeTexture();
    const beakTex = EagleTextures.createBeakTexture('beak_yellow');
    const cereTex = EagleTextures.createBeakTexture('cere_yellow');
    const talonTex = EagleTextures.createBeakTexture('talon_black');
    const tarsusTex = EagleTextures.createTarsusTexture();

    // 1. Primary Feathers Material
    this.materials['primary_feathers'] = new THREE.MeshStandardMaterial({
      map: primaryDarkTex,
      normalMap: featherNorm,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.65,
      metalness: 0.08,
      side: THREE.DoubleSide,
      alphaTest: 0.1,
    });

    // 2. Secondary Feathers Material
    this.materials['secondary_feathers'] = new THREE.MeshStandardMaterial({
      map: secondaryDarkTex,
      normalMap: featherNorm,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
      alphaTest: 0.1,
    });

    // 3. Tail Retrices Material (Bald Eagle = Pure White, Golden = Dark brown/banded)
    this.materials['tail_retrices'] = new THREE.MeshStandardMaterial({
      map: this.currentPlumage === 'bald_eagle' ? tailWhiteTex : primaryDarkTex,
      normalMap: featherNorm,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    // 4. Head & Neck Plumage
    this.materials['head_plumage'] = new THREE.MeshStandardMaterial({
      color: this.currentPlumage === 'bald_eagle' ? 0xfbfdff : 0x7c5328,
      roughness: 0.75,
      metalness: 0.02,
    });

    // 5. Body / Mantle / Coverts
    this.materials['body_plumage'] = new THREE.MeshStandardMaterial({
      map: this.currentPlumage === 'bald_eagle' ? covertBrownTex : goldenMantleTex,
      color: this.currentPlumage === 'bald_eagle' ? 0x2e241c : 0x4a341b,
      roughness: 0.8,
      metalness: 0.04,
    });

    // 6. Raptor Beak (Keratin)
    this.materials['beak'] = new THREE.MeshStandardMaterial({
      map: beakTex,
      roughness: 0.28,
      metalness: 0.15,
    });

    // 7. Cere & Gape (Yellow fleshy skin)
    this.materials['cere'] = new THREE.MeshStandardMaterial({
      map: cereTex,
      roughness: 0.45,
      metalness: 0.05,
    });

    // 8. Eyes (Raptor amber iris with glossy cornea)
    this.materials['eye_iris'] = new THREE.MeshStandardMaterial({
      map: eyeTex,
      roughness: 0.1,
      metalness: 0.3,
    });

    this.materials['eye_cornea'] = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95,
      opacity: 1,
      transparent: true,
      roughness: 0.02,
      ior: 1.38,
    });

    // 9. Nictitating Membrane
    this.materials['nictitating'] = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.65,
      roughness: 0.3,
    });

    // 10. Tarsus (Yellow reptilian scales)
    this.materials['tarsus'] = new THREE.MeshStandardMaterial({
      map: tarsusTex,
      roughness: 0.4,
      metalness: 0.1,
    });

    // 11. Talons (Razor black keratin)
    this.materials['talon'] = new THREE.MeshStandardMaterial({
      map: talonTex,
      roughness: 0.18,
      metalness: 0.2,
    });

    // 12. Oral Cavity & Tongue
    this.materials['oral_cavity'] = new THREE.MeshStandardMaterial({
      color: 0xe17070,
      roughness: 0.35,
      metalness: 0.1,
    });
  }

  public setPlumage(type: PlumageType): void {
    this.currentPlumage = type;
    const tailWhiteTex = EagleTextures.createFeatherTexture('tail_white');
    const primaryDarkTex = EagleTextures.createFeatherTexture('primary_dark');
    const covertBrownTex = EagleTextures.createFeatherTexture('covert_brown');
    const goldenMantleTex = EagleTextures.createFeatherTexture('golden_mantle');

    const tailMat = this.materials['tail_retrices'] as THREE.MeshStandardMaterial;
    if (tailMat) {
      tailMat.map = type === 'bald_eagle' ? tailWhiteTex : primaryDarkTex;
      tailMat.needsUpdate = true;
    }

    const headMat = this.materials['head_plumage'] as THREE.MeshStandardMaterial;
    if (headMat) {
      headMat.color.setHex(type === 'bald_eagle' ? 0xfbfdff : 0x7c5328);
      headMat.needsUpdate = true;
    }

    const bodyMat = this.materials['body_plumage'] as THREE.MeshStandardMaterial;
    if (bodyMat) {
      bodyMat.map = type === 'bald_eagle' ? covertBrownTex : goldenMantleTex;
      bodyMat.color.setHex(type === 'bald_eagle' ? 0x2e241c : 0x4a341b);
      bodyMat.needsUpdate = true;
    }
  }

  private buildRigAndMesh(): void {
    const root = new THREE.Group();
    root.name = 'node_root';
    this.group.add(root);

    const bodyMeshGroup = new THREE.Group();
    bodyMeshGroup.name = 'group_body_mesh';
    const wingsMeshGroup = new THREE.Group();
    wingsMeshGroup.name = 'group_wings_mesh';
    const feathersGroup = new THREE.Group();
    feathersGroup.name = 'group_feathers';
    const skeletonGroup = EagleSkeleton.createSkeletonMesh();
    skeletonGroup.visible = false; // Hidden by default, toggled via X-Ray mode

    // 1. Spine & Thorax
    const spine = new THREE.Group();
    spine.name = 'node_spine';
    root.add(spine);

    const chest = new THREE.Group();
    chest.name = 'node_chest';
    chest.position.set(0.12, 0.05, 0);
    spine.add(chest);

    // Torso Mesh
    const torsoMesh = new THREE.Mesh(EagleGeometry.createTorsoGeometry(), this.materials['body_plumage']);
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    chest.add(torsoMesh);
    bodyMeshGroup.add(torsoMesh);

    // 2. Neck & Head Hierarchy
    const neckBase = new THREE.Group();
    neckBase.name = 'node_neck_base';
    neckBase.position.set(0.25, 0.12, 0);
    chest.add(neckBase);

    // Lower neck plumage collar
    const neckCollarGeom = new THREE.CylinderGeometry(0.11, 0.14, 0.12, 18);
    neckCollarGeom.rotateZ(-Math.PI / 6);
    const neckCollar = new THREE.Mesh(neckCollarGeom, this.materials['head_plumage']);
    neckBase.add(neckCollar);

    const neckMid = new THREE.Group();
    neckMid.name = 'node_neck_mid';
    neckMid.position.set(0.08, 0.08, 0);
    neckBase.add(neckMid);

    const neckUpper = new THREE.Group();
    neckUpper.name = 'node_neck_upper';
    neckUpper.position.set(0.06, 0.08, 0);
    neckMid.add(neckUpper);

    // Head
    const head = new THREE.Group();
    head.name = 'node_head';
    head.position.set(0.06, 0.06, 0);
    neckUpper.add(head);

    const headMesh = new THREE.Mesh(EagleGeometry.createHeadPlumageGeometry(), this.materials['head_plumage']);
    headMesh.castShadow = true;
    head.add(headMesh);
    bodyMeshGroup.add(headMesh);

    // Upper Beak & Cere
    const beakUpper = new THREE.Group();
    beakUpper.name = 'node_beak_upper';
    beakUpper.position.set(0.11, 0.02, 0);
    head.add(beakUpper);

    const maxillaMesh = new THREE.Mesh(EagleGeometry.createBeakUpperGeometry(), this.materials['beak']);
    maxillaMesh.castShadow = true;
    beakUpper.add(maxillaMesh);

    const cereMesh = new THREE.Mesh(EagleGeometry.createCereGeometry(), this.materials['cere']);
    cereMesh.position.set(-0.02, 0.03, 0);
    beakUpper.add(cereMesh);

    // Lower Beak (Mandible)
    const beakLower = new THREE.Group();
    beakLower.name = 'node_beak_lower';
    beakLower.position.set(0.06, -0.015, 0);
    head.add(beakLower);

    const mandibleMesh = new THREE.Mesh(EagleGeometry.createBeakLowerGeometry(), this.materials['beak']);
    mandibleMesh.castShadow = true;
    beakLower.add(mandibleMesh);

    // Tongue & Oral lining inside lower mandible
    const tongueGeom = new THREE.ConeGeometry(0.016, 0.09, 8);
    tongueGeom.rotateZ(-Math.PI / 2.3);
    tongueGeom.scale(0.7, 1, 0.4);
    const tongueMesh = new THREE.Mesh(tongueGeom, this.materials['oral_cavity']);
    tongueMesh.position.set(0.04, 0.005, 0);
    beakLower.add(tongueMesh);

    // Throat sac for screech expansion
    const throat = new THREE.Group();
    throat.name = 'node_throat';
    throat.position.set(0.02, -0.07, 0);
    head.add(throat);

    const throatPouchGeom = new THREE.SphereGeometry(0.05, 12, 10);
    throatPouchGeom.scale(1.2, 0.9, 0.8);
    const throatMesh = new THREE.Mesh(throatPouchGeom, this.materials['head_plumage']);
    throat.add(throatMesh);

    // Eyes (Left & Right)
    const eyeGeom = new THREE.SphereGeometry(0.022, 16, 16);
    const corneaGeom = new THREE.SphereGeometry(0.023, 16, 16);
    const nictitatingGeom = new THREE.SphereGeometry(0.0235, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);

    // Left Eye
    const eyeL = new THREE.Group();
    eyeL.name = 'node_eye_l';
    eyeL.position.set(0.045, 0.032, 0.068);
    eyeL.rotation.y = Math.PI / 7;
    head.add(eyeL);

    const irisMeshL = new THREE.Mesh(eyeGeom, this.materials['eye_iris']);
    const corneaMeshL = new THREE.Mesh(corneaGeom, this.materials['eye_cornea']);
    const nictitatingL = new THREE.Mesh(nictitatingGeom, this.materials['nictitating']);
    nictitatingL.scale.set(0.01, 1, 1); // starts retracted
    eyeL.add(irisMeshL, corneaMeshL, nictitatingL);

    // Right Eye
    const eyeR = new THREE.Group();
    eyeR.name = 'node_eye_r';
    eyeR.position.set(0.045, 0.032, -0.068);
    eyeR.rotation.y = -Math.PI / 7;
    head.add(eyeR);

    const irisMeshR = new THREE.Mesh(eyeGeom, this.materials['eye_iris']);
    const corneaMeshR = new THREE.Mesh(corneaGeom, this.materials['eye_cornea']);
    const nictitatingR = new THREE.Mesh(nictitatingGeom, this.materials['nictitating']);
    nictitatingR.scale.set(0.01, 1, 1); // starts retracted
    eyeR.add(irisMeshR, corneaMeshR, nictitatingR);

    // 3. Wings Assembly (Left & Right)
    const primariesL: THREE.Group[] = [];
    const secondariesL: THREE.Group[] = [];
    const primariesR: THREE.Group[] = [];
    const secondariesR: THREE.Group[] = [];

    // Left Wing
    const shoulderL = new THREE.Group();
    shoulderL.name = 'node_shoulder_l';
    shoulderL.position.set(0.12, 0.1, 0.22);
    chest.add(shoulderL);

    const humerusL = new THREE.Group();
    humerusL.name = 'node_humerus_l';
    shoulderL.add(humerusL);

    const humerusBoneL = EagleSkeleton.createBoneSegment(0.28, 0.024, 0.02);
    humerusBoneL.rotation.x = Math.PI / 2;
    humerusL.add(humerusBoneL);

    const elbowL = new THREE.Group();
    elbowL.name = 'node_elbow_l';
    elbowL.position.set(0, 0, 0.28);
    humerusL.add(elbowL);

    const forearmL = new THREE.Group();
    forearmL.name = 'node_forearm_l';
    elbowL.add(forearmL);

    const forearmBoneL = EagleSkeleton.createBoneSegment(0.32, 0.02, 0.016);
    forearmBoneL.rotation.x = Math.PI / 2;
    forearmL.add(forearmBoneL);

    // Propatagium membrane Left
    const propatagiumL = new THREE.Mesh(EagleGeometry.createPropatagiumGeometry(0.32, 0.16), this.materials['body_plumage']);
    propatagiumL.position.set(0.06, 0.01, 0.16);
    propatagiumL.rotation.x = Math.PI / 2;
    forearmL.add(propatagiumL);

    // 14 Secondary Flight Feathers attached to Ulna (Left)
    for (let s = 0; s < 14; s++) {
      const sGroup = new THREE.Group();
      sGroup.name = `secondary_l_${s + 1}`;
      const t = s / 13;
      sGroup.position.set(-0.04, 0, 0.02 + t * 0.28);
      // Fan angle backwards along chord
      sGroup.rotation.y = -Math.PI / 2 - (t * 0.15);
      sGroup.rotation.x = 0.05 * Math.sin(t * Math.PI);

      const sLen = 0.42 + (1 - Math.abs(t - 0.5) * 2) * 0.08;
      const sWidth = 0.11;
      const sMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(sLen, sWidth, 0.0, 0.035, 0.45),
        this.materials['secondary_feathers']
      );
      sMesh.castShadow = true;
      sMesh.receiveShadow = true;
      sGroup.add(sMesh);
      forearmL.add(sGroup);
      secondariesL.push(sGroup);
      feathersGroup.add(sMesh);
    }

    const wristL = new THREE.Group();
    wristL.name = 'node_wrist_l';
    wristL.position.set(0, 0, 0.32);
    forearmL.add(wristL);

    // Alula (Thumb with 3 feathers)
    const alulaL = new THREE.Group();
    alulaL.name = 'node_alula_l';
    alulaL.position.set(0.04, 0.02, 0.02);
    wristL.add(alulaL);

    for (let a = 0; a < 3; a++) {
      const aMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(0.18 + a * 0.04, 0.05, 0.0, 0.02, 0.4),
        this.materials['primary_feathers']
      );
      aMesh.rotation.y = -Math.PI / 2 + 0.2 - a * 0.08;
      aMesh.position.set(0, 0, a * 0.015);
      alulaL.add(aMesh);
    }

    const manusL = new THREE.Group();
    manusL.name = 'node_manus_l';
    wristL.add(manusL);

    const manusBoneL = EagleSkeleton.createBoneSegment(0.22, 0.016, 0.012);
    manusBoneL.rotation.x = Math.PI / 2;
    manusL.add(manusBoneL);

    // 10 Primary Flight Feathers (P1 to P10) on Left Wing
    for (let p = 0; p < 10; p++) {
      const pGroup = new THREE.Group();
      pGroup.name = `primary_l_${p + 1}`;
      const t = p / 9;
      pGroup.position.set(-0.02, 0, 0.02 + t * 0.2);

      // Natural fanning of primaries
      const fanAngle = -Math.PI / 2 - 0.25 - t * 0.45;
      pGroup.rotation.y = fanAngle;

      // Outer primaries (P6-P10) have emarginated slotted tips & upward camber
      const isOuter = p >= 5;
      const emargination = isOuter ? 0.38 : 0.15;
      const pLen = 0.48 + t * 0.18; // outer primaries reach ~0.66m
      const pWidth = 0.13 - t * 0.02;

      const pMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(pLen, pWidth, emargination, 0.04, 0.35),
        this.materials['primary_feathers']
      );
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      pGroup.add(pMesh);
      manusL.add(pGroup);
      primariesL.push(pGroup);
      feathersGroup.add(pMesh);
    }

    // Right Wing (Symmetric Mirror)
    const shoulderR = new THREE.Group();
    shoulderR.name = 'node_shoulder_r';
    shoulderR.position.set(0.12, 0.1, -0.22);
    chest.add(shoulderR);

    const humerusR = new THREE.Group();
    humerusR.name = 'node_humerus_r';
    shoulderR.add(humerusR);

    const humerusBoneR = EagleSkeleton.createBoneSegment(0.28, 0.024, 0.02);
    humerusBoneR.rotation.x = -Math.PI / 2;
    humerusR.add(humerusBoneR);

    const elbowR = new THREE.Group();
    elbowR.name = 'node_elbow_r';
    elbowR.position.set(0, 0, -0.28);
    humerusR.add(elbowR);

    const forearmR = new THREE.Group();
    forearmR.name = 'node_forearm_r';
    elbowR.add(forearmR);

    const forearmBoneR = EagleSkeleton.createBoneSegment(0.32, 0.02, 0.016);
    forearmBoneR.rotation.x = -Math.PI / 2;
    forearmR.add(forearmBoneR);

    // Propatagium membrane Right
    const propatagiumR = new THREE.Mesh(EagleGeometry.createPropatagiumGeometry(0.32, 0.16), this.materials['body_plumage']);
    propatagiumR.position.set(0.06, 0.01, -0.16);
    propatagiumR.rotation.x = -Math.PI / 2;
    forearmR.add(propatagiumR);

    // 14 Secondary Flight Feathers (Right)
    for (let s = 0; s < 14; s++) {
      const sGroup = new THREE.Group();
      sGroup.name = `secondary_r_${s + 1}`;
      const t = s / 13;
      sGroup.position.set(-0.04, 0, -0.02 - t * 0.28);
      sGroup.rotation.y = -Math.PI / 2 + (t * 0.15);
      sGroup.rotation.x = -0.05 * Math.sin(t * Math.PI);

      const sLen = 0.42 + (1 - Math.abs(t - 0.5) * 2) * 0.08;
      const sWidth = 0.11;
      const sMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(sLen, sWidth, 0.0, 0.035, 0.45),
        this.materials['secondary_feathers']
      );
      sMesh.scale.z = -1; // Mirror vane orientation
      sMesh.castShadow = true;
      sMesh.receiveShadow = true;
      sGroup.add(sMesh);
      forearmR.add(sGroup);
      secondariesR.push(sGroup);
      feathersGroup.add(sMesh);
    }

    const wristR = new THREE.Group();
    wristR.name = 'node_wrist_r';
    wristR.position.set(0, 0, -0.32);
    forearmR.add(wristR);

    // Alula Right
    const alulaR = new THREE.Group();
    alulaR.name = 'node_alula_r';
    alulaR.position.set(0.04, 0.02, -0.02);
    wristR.add(alulaR);

    for (let a = 0; a < 3; a++) {
      const aMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(0.18 + a * 0.04, 0.05, 0.0, 0.02, 0.4),
        this.materials['primary_feathers']
      );
      aMesh.rotation.y = -Math.PI / 2 - 0.2 + a * 0.08;
      aMesh.position.set(0, 0, -a * 0.015);
      aMesh.scale.z = -1;
      alulaR.add(aMesh);
    }

    const manusR = new THREE.Group();
    manusR.name = 'node_manus_r';
    wristR.add(manusR);

    const manusBoneR = EagleSkeleton.createBoneSegment(0.22, 0.016, 0.012);
    manusBoneR.rotation.x = -Math.PI / 2;
    manusR.add(manusBoneR);

    // 10 Primary Flight Feathers (Right)
    for (let p = 0; p < 10; p++) {
      const pGroup = new THREE.Group();
      pGroup.name = `primary_r_${p + 1}`;
      const t = p / 9;
      pGroup.position.set(-0.02, 0, -0.02 - t * 0.2);

      const fanAngle = -Math.PI / 2 + 0.25 + t * 0.45;
      pGroup.rotation.y = fanAngle;

      const isOuter = p >= 5;
      const emargination = isOuter ? 0.38 : 0.15;
      const pLen = 0.48 + t * 0.18;
      const pWidth = 0.13 - t * 0.02;

      const pMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(pLen, pWidth, emargination, 0.04, 0.35),
        this.materials['primary_feathers']
      );
      pMesh.scale.z = -1; // mirror
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      pGroup.add(pMesh);
      manusR.add(pGroup);
      primariesR.push(pGroup);
      feathersGroup.add(pMesh);
    }

    // 4. Tail & Retrices Assembly
    const tailJoint = new THREE.Group();
    tailJoint.name = 'node_tail_joint';
    tailJoint.position.set(-0.35, 0.04, 0);
    spine.add(tailJoint);

    const retrices: THREE.Group[] = [];
    // 12 Retrices (Tail Feathers) arranged fan-like
    for (let r = 0; r < 12; r++) {
      const rGroup = new THREE.Group();
      rGroup.name = `retrix_${r + 1}`;
      const t = (r - 5.5) / 5.5; // -1 to +1

      rGroup.position.set(0, 0, t * 0.05);
      // Fan spread angle (-32° to +32°)
      rGroup.rotation.y = Math.PI + t * 0.55;
      rGroup.rotation.z = -0.15; // slight downward slope

      const rLen = 0.45 + (1 - Math.abs(t) * 0.3) * 0.08;
      const rWidth = 0.12;

      const rMesh = new THREE.Mesh(
        EagleGeometry.createFeatherGeometry(rLen, rWidth, 0.0, 0.015, 0.5),
        this.materials['tail_retrices']
      );
      rMesh.castShadow = true;
      rMesh.receiveShadow = true;
      rGroup.add(rMesh);
      tailJoint.add(rGroup);
      retrices.push(rGroup);
      feathersGroup.add(rMesh);
    }

    // Upper and Under tail coverts
    const upperCovertGeom = new THREE.ConeGeometry(0.12, 0.28, 8);
    upperCovertGeom.rotateZ(Math.PI / 2.2);
    upperCovertGeom.scale(0.4, 1, 1.2);
    const upperCovert = new THREE.Mesh(upperCovertGeom, this.materials['tail_retrices']);
    upperCovert.position.set(-0.1, 0.02, 0);
    tailJoint.add(upperCovert);

    // 5. Legs & Raptor Talons (Left & Right)
    // Left Leg
    const hipL = new THREE.Group();
    hipL.name = 'node_hip_l';
    hipL.position.set(-0.06, -0.12, 0.12);
    spine.add(hipL);

    const thighL = new THREE.Group();
    thighL.name = 'node_thigh_l';
    hipL.add(thighL);

    // Feathered thigh plumage ("trousers")
    const thighPlumageGeom = new THREE.CylinderGeometry(0.065, 0.045, 0.18, 12);
    const thighPlumageL = new THREE.Mesh(thighPlumageGeom, this.materials['body_plumage']);
    thighPlumageL.position.set(0, -0.09, 0);
    thighPlumageL.rotation.z = 0.2;
    thighL.add(thighPlumageL);

    const kneeL = new THREE.Group();
    kneeL.name = 'node_knee_l';
    kneeL.position.set(0.02, -0.16, 0);
    thighL.add(kneeL);

    const shankL = new THREE.Group();
    shankL.name = 'node_shank_l';
    kneeL.add(shankL);

    const ankleL = new THREE.Group();
    ankleL.name = 'node_ankle_l';
    ankleL.position.set(-0.04, -0.14, 0);
    shankL.add(ankleL);

    const tarsusL = new THREE.Group();
    tarsusL.name = 'node_tarsus_l';
    ankleL.add(tarsusL);

    // Scaled Tarsus cylinder
    const tarsusGeom = new THREE.CylinderGeometry(0.022, 0.018, 0.16, 10);
    const tarsusMeshL = new THREE.Mesh(tarsusGeom, this.materials['tarsus']);
    tarsusMeshL.position.set(0, -0.08, 0);
    tarsusMeshL.castShadow = true;
    tarsusL.add(tarsusMeshL);

    const footL = new THREE.Group();
    footL.name = 'node_foot_l';
    footL.position.set(0, -0.16, 0);
    tarsusL.add(footL);

    // 4 Raptor Toes Left
    // Hallux (D1 - Backward)
    const halluxL = new THREE.Group();
    halluxL.name = 'node_hallux_l';
    halluxL.rotation.y = Math.PI;
    const halluxTalonL = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.085, 0.025), this.materials['talon']);
    halluxTalonL.castShadow = true;
    halluxL.add(halluxTalonL);
    footL.add(halluxL);

    // Inner Toe (D2)
    const innerToeL = new THREE.Group();
    innerToeL.name = 'node_inner_toe_l';
    innerToeL.rotation.y = -0.35;
    const innerTalonL = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.075, 0.022), this.materials['talon']);
    innerTalonL.castShadow = true;
    innerToeL.add(innerTalonL);
    footL.add(innerToeL);

    // Middle Toe (D3 - Longest)
    const midToeL = new THREE.Group();
    midToeL.name = 'node_mid_toe_l';
    const midTalonL = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.08, 0.023), this.materials['talon']);
    midTalonL.castShadow = true;
    midToeL.add(midTalonL);
    footL.add(midToeL);

    // Outer Toe (D4)
    const outerToeL = new THREE.Group();
    outerToeL.name = 'node_outer_toe_l';
    outerToeL.rotation.y = 0.38;
    const outerTalonL = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.068, 0.02), this.materials['talon']);
    outerTalonL.castShadow = true;
    outerToeL.add(outerTalonL);
    footL.add(outerToeL);

    // Right Leg (Symmetric Mirror)
    const hipR = new THREE.Group();
    hipR.name = 'node_hip_r';
    hipR.position.set(-0.06, -0.12, -0.12);
    spine.add(hipR);

    const thighR = new THREE.Group();
    thighR.name = 'node_thigh_r';
    hipR.add(thighR);

    const thighPlumageR = new THREE.Mesh(thighPlumageGeom, this.materials['body_plumage']);
    thighPlumageR.position.set(0, -0.09, 0);
    thighPlumageR.rotation.z = 0.2;
    thighR.add(thighPlumageR);

    const kneeR = new THREE.Group();
    kneeR.name = 'node_knee_r';
    kneeR.position.set(0.02, -0.16, 0);
    thighR.add(kneeR);

    const shankR = new THREE.Group();
    shankR.name = 'node_shank_r';
    kneeR.add(shankR);

    const ankleR = new THREE.Group();
    ankleR.name = 'node_ankle_r';
    ankleR.position.set(-0.04, -0.14, 0);
    shankR.add(ankleR);

    const tarsusR = new THREE.Group();
    tarsusR.name = 'node_tarsus_r';
    ankleR.add(tarsusR);

    const tarsusMeshR = new THREE.Mesh(tarsusGeom, this.materials['tarsus']);
    tarsusMeshR.position.set(0, -0.08, 0);
    tarsusMeshR.castShadow = true;
    tarsusR.add(tarsusMeshR);

    const footR = new THREE.Group();
    footR.name = 'node_foot_r';
    footR.position.set(0, -0.16, 0);
    tarsusR.add(footR);

    // 4 Raptor Toes Right
    const halluxR = new THREE.Group();
    halluxR.name = 'node_hallux_r';
    halluxR.rotation.y = Math.PI;
    const halluxTalonR = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.085, 0.025), this.materials['talon']);
    halluxTalonR.castShadow = true;
    halluxR.add(halluxTalonR);
    footR.add(halluxR);

    const innerToeR = new THREE.Group();
    innerToeR.name = 'node_inner_toe_r';
    innerToeR.rotation.y = 0.35;
    const innerTalonR = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.075, 0.022), this.materials['talon']);
    innerTalonR.castShadow = true;
    innerToeR.add(innerTalonR);
    footR.add(innerToeR);

    const midToeR = new THREE.Group();
    midToeR.name = 'node_mid_toe_r';
    const midTalonR = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.08, 0.023), this.materials['talon']);
    midTalonR.castShadow = true;
    midToeR.add(midTalonR);
    footR.add(midToeR);

    const outerToeR = new THREE.Group();
    outerToeR.name = 'node_outer_toe_r';
    outerToeR.rotation.y = -0.38;
    const outerTalonR = new THREE.Mesh(EagleGeometry.createTalonGeometry(0.068, 0.02), this.materials['talon']);
    outerTalonR.castShadow = true;
    outerToeR.add(outerTalonR);
    footR.add(outerToeR);

    // Add Skeleton Group into chest/spine
    chest.add(skeletonGroup);

    // Save Rig References
    this.rig = {
      root,
      spine,
      chest,
      neckBase,
      neckMid,
      neckUpper,
      head,
      beakUpper,
      beakLower,
      throat,
      eyeL,
      eyeR,
      nictitatingL,
      nictitatingR,
      shoulderL,
      humerusL,
      elbowL,
      forearmL,
      wristL,
      manusL,
      alulaL,
      primariesL,
      secondariesL,
      shoulderR,
      humerusR,
      elbowR,
      forearmR,
      wristR,
      manusR,
      alulaR,
      primariesR,
      secondariesR,
      tailJoint,
      retrices,
      hipL,
      thighL,
      kneeL,
      shankL,
      ankleL,
      tarsusL,
      footL,
      halluxL,
      innerToeL,
      midToeL,
      outerToeL,
      hipR,
      thighR,
      kneeR,
      shankR,
      ankleR,
      tarsusR,
      footR,
      halluxR,
      innerToeR,
      midToeR,
      outerToeR,
      bodyMeshGroup,
      skeletonGroup,
      wingsMeshGroup,
      feathersGroup,
    };
  }

  private setupHotspots(): void {
    this.hotspots = [
      {
        id: 'primaries',
        name: 'Primary Remiges (P1 - P10) & Slotted Wingtips',
        category: 'wing',
        position: new THREE.Vector3(0.1, 0.15, 0.95),
        description: 'Ten outer flight feathers anchored to the carpometacarpus and phalanges. Primaries P6-P10 possess deep emarginations that allow individual feathers to act as multi-element airfoils.',
        avianBiomechanics: 'During soaring and high angles of attack, these slotted wingtips splay vertically, effectively diffusing wingtip tip vortices, reducing induced drag, and boosting aerodynamic lift-to-drag ratio.',
      },
      {
        id: 'alula',
        name: 'Alula (Bastard Wing / Slat)',
        category: 'wing',
        position: new THREE.Vector3(0.22, 0.18, 0.58),
        description: 'Three to four stiff feathers attached to the eagle\'s first digit (avian thumb).',
        avianBiomechanics: 'Functions identically to the leading-edge slats on jet aircraft. When deployed at steep landing angles or slow flight speeds, it channels smooth laminar airflow over the dorsal wing surface, preventing aerodynamic stall.',
      },
      {
        id: 'secondaries',
        name: 'Secondary Remiges (S1 - S14)',
        category: 'wing',
        position: new THREE.Vector3(-0.08, 0.12, 0.42),
        description: 'Fourteen curved lifting feathers anchored directly to quill knobs on the ulna bone.',
        avianBiomechanics: 'Generate the primary aerodynamic Bernoulli camber lift. In downstrokes, they maintain an unbroken lifting surface; during upstroke recovery, they pivot to permit airflow.',
      },
      {
        id: 'beak_cere',
        name: 'Hooked Maxilla, Tomial Notch & Cere',
        category: 'head',
        position: new THREE.Vector3(0.48, 0.28, 0),
        description: 'Heavy recurved raptor bill made of beta-keratin with a sharp cutting tomial edge and fleshy yellow cere containing the nares (nostrils).',
        avianBiomechanics: 'Capable of delivering crushing bite pressures exceeding 400 psi to tear prey muscle and sever spinal columns.',
      },
      {
        id: 'raptor_eye',
        name: 'Binocular Raptor Vision & Brow Ridge',
        category: 'head',
        position: new THREE.Vector3(0.38, 0.35, 0.1),
        description: 'Enormous eyes sheltered by a deep supraorbital brow ridge. Features two foveae (deep fovea for 4-5x telescopic forward vision and shallow fovea for lateral scanning).',
        avianBiomechanics: 'Eagles perceive ultraviolet wavelengths and can resolve a running rabbit from over 3 kilometers (2 miles) away.',
      },
      {
        id: 'talons_hallux',
        name: 'Predatory Hallux & Curved Talons',
        category: 'leg',
        position: new THREE.Vector3(-0.02, -0.42, 0.12),
        description: 'Four powerful raptorial digits armed with recurved keratin claws. The massive backward-pointing Hallux talon exerts devastating gripping force.',
        avianBiomechanics: 'Tendon locking mechanism (digital flexor tendons) allows an eagle to maintain over 400 psi of talon grip with minimal continuous muscle fatigue.',
      },
      {
        id: 'pectoral_keel',
        name: 'Carina / Sternal Keel & Flight Muscles',
        category: 'body',
        position: new THREE.Vector3(0.2, -0.05, 0),
        description: 'Deep blade-like sternal keel anchoring the massive Pectoralis major (downstroke power) and Supracoracoideus (upstroke pulley system).',
        avianBiomechanics: 'Flight muscles account for over 25% of total eagle body mass, delivering explosive flap thrust.',
      },
      {
        id: 'retrices_tail',
        name: 'Retrices (Tail Flight Feathers)',
        category: 'tail',
        position: new THREE.Vector3(-0.75, 0.05, 0),
        description: 'Twelve strong fan feathers anchored to the pygostyle bone.',
        avianBiomechanics: 'Acts as dynamic aerodynamic rudder, elevator, and airbrake. Fanning increases lift area during slow glides and landing flares; tilting controls roll and yaw trim.',
      },
    ];
  }
}
