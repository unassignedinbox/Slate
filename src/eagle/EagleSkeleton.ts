import * as THREE from 'three';

/**
 * 3D Avian Skeletal Architecture for Anatomical X-Ray / Bone Visualization.
 * Accurately models the lightweight, fused, and pneumatic bird skeleton.
 */
export class EagleSkeleton {
  /**
   * Creates a complete 3D skeleton group attached to the eagle rig's bone hierarchy.
   */
  public static createSkeletonMesh(): THREE.Group {
    const skeletonGroup = new THREE.Group();
    skeletonGroup.name = 'eagle_skeleton_mesh';

    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xefebd8,
      roughness: 0.35,
      metalness: 0.1,
      emissive: 0x221f15,
      emissiveIntensity: 0.2,
    });

    const cartilageMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.3,
    });

    // 1. Sternum with deep Carina (Keel)
    const sternumGroup = new THREE.Group();
    sternumGroup.name = 'skel_sternum';

    const keelShape = new THREE.Shape();
    keelShape.moveTo(0.18, 0.05);
    keelShape.quadraticCurveTo(0.05, -0.16, -0.15, -0.12);
    keelShape.quadraticCurveTo(-0.18, -0.04, -0.15, 0.02);
    keelShape.quadraticCurveTo(0.0, 0.06, 0.18, 0.05);

    const keelGeom = new THREE.ExtrudeGeometry(keelShape, {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 3,
    });
    keelGeom.center();
    const keelMesh = new THREE.Mesh(keelGeom, boneMat);
    keelMesh.position.set(0.05, -0.12, 0);
    sternumGroup.add(keelMesh);

    // Coracoids and Furcula (Wishbone)
    const furculaCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0.18, 0.08, 0.09),
      new THREE.Vector3(0.24, -0.05, 0),
      new THREE.Vector3(0.18, 0.08, -0.09)
    );
    const furculaGeom = new THREE.TubeGeometry(furculaCurve, 16, 0.006, 8, false);
    const furculaMesh = new THREE.Mesh(furculaGeom, boneMat);
    sternumGroup.add(furculaMesh);

    skeletonGroup.add(sternumGroup);

    // 2. Synsacrum / Pelvis and Pygostyle
    const pelvisGeom = new THREE.CylinderGeometry(0.04, 0.025, 0.26, 12);
    pelvisGeom.rotateZ(Math.PI / 2);
    const pelvisMesh = new THREE.Mesh(pelvisGeom, boneMat);
    pelvisMesh.position.set(-0.16, 0.02, 0);
    skeletonGroup.add(pelvisMesh);

    // Pygostyle (Tail blade)
    const pygostyleGeom = new THREE.ConeGeometry(0.035, 0.08, 6);
    pygostyleGeom.rotateZ(-Math.PI / 2);
    pygostyleGeom.scale(0.3, 1, 1);
    const pygostyleMesh = new THREE.Mesh(pygostyleGeom, boneMat);
    pygostyleMesh.position.set(-0.32, 0.03, 0);
    skeletonGroup.add(pygostyleMesh);

    // 3. Cervical Vertebrae (S-shaped neck column)
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.18, 0.06, 0),
      new THREE.Vector3(0.24, 0.12, 0),
      new THREE.Vector3(0.22, 0.22, 0),
      new THREE.Vector3(0.28, 0.26, 0),
    ]);
    const neckGeom = new THREE.TubeGeometry(neckCurve, 20, 0.015, 8, false);
    const neckMesh = new THREE.Mesh(neckGeom, boneMat);
    skeletonGroup.add(neckMesh);

    // 4. Skull & Beak Bones
    const skullGroup = new THREE.Group();
    skullGroup.name = 'skel_skull';
    skullGroup.position.set(0.28, 0.26, 0);

    const craniumGeom = new THREE.SphereGeometry(0.065, 16, 12);
    craniumGeom.scale(1.2, 0.9, 0.85);
    const craniumMesh = new THREE.Mesh(craniumGeom, boneMat);
    skullGroup.add(craniumMesh);

    // Sclerotic rings (eye bone rings)
    const scleroticGeom = new THREE.TorusGeometry(0.024, 0.004, 8, 20);
    const scleroticL = new THREE.Mesh(scleroticGeom, cartilageMat);
    scleroticL.position.set(0.03, 0.01, 0.055);
    scleroticL.rotation.y = Math.PI / 6;
    skullGroup.add(scleroticL);

    const scleroticR = new THREE.Mesh(scleroticGeom, cartilageMat);
    scleroticR.position.set(0.03, 0.01, -0.055);
    scleroticR.rotation.y = -Math.PI / 6;
    skullGroup.add(scleroticR);

    // Rostrum / Upper beak core
    const rostrumGeom = new THREE.ConeGeometry(0.03, 0.12, 8);
    rostrumGeom.rotateZ(-Math.PI / 2.3);
    rostrumGeom.scale(0.8, 1, 0.6);
    const rostrumMesh = new THREE.Mesh(rostrumGeom, boneMat);
    rostrumMesh.position.set(0.09, -0.01, 0);
    skullGroup.add(rostrumMesh);

    // Mandible bone
    const mandibleGeom = new THREE.CylinderGeometry(0.012, 0.005, 0.11, 8);
    mandibleGeom.rotateZ(-Math.PI / 2.2);
    const mandibleMesh = new THREE.Mesh(mandibleGeom, boneMat);
    mandibleMesh.position.set(0.07, -0.045, 0);
    skullGroup.add(mandibleMesh);

    skeletonGroup.add(skullGroup);

    return skeletonGroup;
  }

  /**
   * Helper to generate a single articulated bone visualizer tube.
   */
  public static createBoneSegment(
    length: number,
    radiusTop = 0.018,
    radiusBottom = 0.014
  ): THREE.Mesh {
    const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 10);
    geom.translate(0, length / 2, 0); // Origin at joint
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf5f0db,
      roughness: 0.35,
      metalness: 0.1,
      emissive: 0x332e1d,
      emissiveIntensity: 0.25,
    });
    return new THREE.Mesh(geom, mat);
  }
}
