import * as THREE from 'three';

/**
 * A stand-in player vehicle carrying an external fuel tank.
 * The only thing the mosquito cares about is `pickSite()` and `fuel`.
 */
export class Vehicle {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.55, roughness: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, metalness: 0.7, roughness: 0.45 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x223038, metalness: 0.1, roughness: 0.08,
      transmission: 0.7, thickness: 0.2, transparent: true, opacity: 0.6,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121316, metalness: 0.1, roughness: 0.92 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 5.6), bodyMat);
    chassis.position.y = 1.15; this.group.add(chassis);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 2.4), bodyMat);
    cab.position.set(0, 2.0, 0.5); this.group.add(cab);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.6, 2.3), glassMat);
    glass.position.set(0, 2.25, 0.5); this.group.add(glass);

    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 2.8), darkMat);
    bed.position.set(0, 1.85, -1.75); this.group.add(bed);

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.52, 22), rubber);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 1.42, 0.72, sz * 1.85);
      this.group.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.56, 14), darkMat);
      hub.rotation.z = Math.PI / 2; hub.position.copy(w.position);
      this.group.add(hub);
    }

    // ---- the fuel tank: a cylinder slung on the left flank -------------
    this.tankRadius = 0.72;
    this.tankLength = 2.3;
    this.wallThickness = 0.035;
    this.capacity = 60;
    this.fuel = 60;

    this.tankGroup = new THREE.Group();
    this.tankGroup.position.set(-0.55, 2.82, -1.75);
    this.tankGroup.rotation.x = Math.PI / 2;   // drum lies fore-aft on the bed
    this.group.add(this.tankGroup);

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x8d949c, metalness: 0.85, roughness: 0.3,
      transmission: 0.22, thickness: 0.1, transparent: true, opacity: 0.72,
      side: THREE.DoubleSide,
    });
    this.shell = new THREE.Mesh(
      new THREE.CylinderGeometry(this.tankRadius, this.tankRadius, this.tankLength, 40, 1, false),
      shellMat);
    this.tankGroup.add(this.shell);

    for (const s of [-1, 1]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(this.tankRadius * 1.02, 0.045, 8, 36),
        new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.8, roughness: 0.35 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = s * this.tankLength * 0.3;
      this.tankGroup.add(band);
    }

    // internal fuel volume - height tracks the level, so the tank
    // visibly empties. No HUD needed.
    this.fuelMat = new THREE.MeshPhysicalMaterial({
      color: 0xd79a2b, metalness: 0.0, roughness: 0.15,
      transmission: 0.35, thickness: 0.6, ior: 1.44,
      emissive: 0x2a1c05, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.92,
    });
    this.fuelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(this.tankRadius * 0.94, this.tankRadius * 0.94, this.tankLength * 0.94, 32),
      this.fuelMat);
    this.tankGroup.add(this.fuelMesh);

    // 1/R of the drum wall - the feet use this to wrap the curve
    this.surfaceCurvature = 1 / this.tankRadius;

    this.centre = new THREE.Vector3();
    this.tankGroup.getWorldPosition(this.centre);

    this._axis = new THREE.Vector3();
    this.breachPoints = [];
  }

  /** A point on the cylindrical wall facing up-and-outboard, plus its normal. */
  pickSite() {
    // Local frame: +Y is the drum axis, the wall is the XZ circle. The
    // group is rotated 90deg about X, so a local normal (cos a, 0, sin a)
    // comes out as world (cos a, -sin a, 0): a = -90deg is straight up.
    const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.3;
    const along = (Math.random() - 0.5) * this.tankLength * 0.5;
    const local = new THREE.Vector3(Math.cos(ang) * this.tankRadius, along, Math.sin(ang) * this.tankRadius);
    const localN = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    this.tankGroup.updateMatrixWorld(true);
    return {
      point: local.applyMatrix4(this.tankGroup.matrixWorld),
      normal: localN.transformDirection(this.tankGroup.matrixWorld).normalize(),
    };
  }

  /**
   * Snap an arbitrary world point onto the drum wall. Used to plant the
   * feet on the real curved surface rather than on a flat tangent plane.
   */
  projectToSurface(p) {
    this.tankGroup.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.tankGroup.matrixWorld).invert();
    const l = p.clone().applyMatrix4(inv);
    const half = this.tankLength * 0.5;
    l.y = THREE.MathUtils.clamp(l.y, -half * 0.96, half * 0.96);
    const rad = Math.hypot(l.x, l.z) || 1e-6;
    const nx = l.x / rad, nz = l.z / rad;
    const surf = new THREE.Vector3(nx * this.tankRadius, l.y, nz * this.tankRadius);
    const normal = new THREE.Vector3(nx, 0, nz);
    return {
      point: surf.applyMatrix4(this.tankGroup.matrixWorld),
      normal: normal.transformDirection(this.tankGroup.matrixWorld).normalize(),
    };
  }

  markBreach(point) {
    const g = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 }));
    g.position.copy(point);
    this.group.parent.add(g);
    this.breachPoints.push(g);
  }

  update() {
    const f = Math.max(0, Math.min(1, this.fuel / this.capacity));
    // the cylinder lies on its side, so the "level" is a chord; scaling
    // the radius is the cheap read and it looks right through the shell
    this.fuelMesh.visible = f > 0.002;
    this.fuelMesh.scale.set(Math.sqrt(f), 1, Math.sqrt(f));
    this.tankGroup.getWorldPosition(this.centre);
  }
}
