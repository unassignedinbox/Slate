import * as THREE from 'three';

/**
 * 3D Procedural Geometry Generators for Anatomically Accurate Eagle Structures.
 * Generates true 3D meshes for cambered flight feathers, hooked raptor beaks,
 * articulated digits, and organic body contours.
 */
export class EagleGeometry {
  /**
   * Generates a 3D cambered flight feather mesh with a central rachis and asymmetric vane.
   * @param length Total length of feather in meters
   * @param width Max width of feather
   * @param emargination Fraction from tip where emargination notch starts (0 = none, 0.4 = outer primary)
   * @param camber Aerodynamic curvature depth
   * @param vaneAsymmetry Ratio of outer vane width to inner vane width (e.g. 0.35 for primaries)
   */
  public static createFeatherGeometry(
    length = 0.55,
    width = 0.12,
    emargination = 0.35,
    camber = 0.03,
    vaneAsymmetry = 0.4
  ): THREE.BufferGeometry {
    const segmentsLength = 24;
    const segmentsWidth = 10;
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const outerWidth = width * vaneAsymmetry;
    const innerWidth = width * (1 - vaneAsymmetry);

    for (let i = 0; i <= segmentsLength; i++) {
      const v = i / segmentsLength; // 0 = base (calamus), 1 = tip
      const y = v * length;

      // Feather contour profile (tapered base, broad mid-vane, tapered tip)
      let profileWidth = Math.sin(Math.pow(v, 0.6) * Math.PI);
      if (v < 0.1) profileWidth = (v / 0.1) * 0.4; // Calamus base

      // Emargination notch on leading edge near tip for slotted primaries
      let leadingEdgeMod = 1.0;
      if (emargination > 0 && v > (1.0 - emargination)) {
        const notchT = (v - (1.0 - emargination)) / emargination;
        leadingEdgeMod = 1.0 - Math.sin(notchT * Math.PI) * 0.45;
      }

      // Camber profile (aerodynamic airfoil curve)
      const camberY = -camber * Math.sin(v * Math.PI);

      for (let j = 0; j <= segmentsWidth; j++) {
        const u = j / segmentsWidth; // 0 = leading edge, 0.4 = rachis, 1 = trailing edge
        let x = 0;
        let z = 0;

        if (u <= 0.4) {
          // Outer / Leading edge vane
          const t = (0.4 - u) / 0.4;
          x = -t * outerWidth * profileWidth * leadingEdgeMod;
          z = camberY * (1 - Math.pow(t, 1.5)) - (t * 0.008 * (1 - v));
        } else {
          // Inner / Trailing edge vane
          const t = (u - 0.4) / 0.6;
          x = t * innerWidth * profileWidth;
          z = camberY * (1 - Math.pow(t, 1.2)) + (t * 0.005 * v);
        }

        // Rachis shaft thickness at center (u ≈ 0.4)
        if (Math.abs(u - 0.4) < 0.08) {
          const rachisThick = (1 - v * 0.7) * 0.006;
          z += rachisThick;
        }

        vertices.push(x, y, z);

        // UV mapping
        uvs.push(u, v);

        // Initial normal (will be computed accurately)
        normals.push(0, 0, 1);
      }
    }

    // Generate triangle face indices
    for (let i = 0; i < segmentsLength; i++) {
      for (let j = 0; j < segmentsWidth; j++) {
        const a = i * (segmentsWidth + 1) + j;
        const b = (i + 1) * (segmentsWidth + 1) + j;
        const c = (i + 1) * (segmentsWidth + 1) + (j + 1);
        const d = i * (segmentsWidth + 1) + (j + 1);

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Generates the hooked Raptor Maxilla (Upper Beak) with Cere, Tomial Notch, and Nares.
   */
  public static createBeakUpperGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    // Profile of hooked raptor beak
    shape.moveTo(0, 0.08); // Base top (cere junction)
    shape.quadraticCurveTo(0.12, 0.075, 0.16, 0.04);
    shape.quadraticCurveTo(0.19, 0.0, 0.20, -0.06); // Hook downward curve
    shape.quadraticCurveTo(0.18, -0.07, 0.17, -0.04); // Hook tip recurve
    shape.quadraticCurveTo(0.14, 0.0, 0.10, -0.01); // Tomial notch / cutting edge
    shape.quadraticCurveTo(0.04, -0.015, 0, -0.01); // Tomial base
    shape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 16,
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 8,
    };

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.center();

    // Scale and taper beak laterally toward the razor cutting edge
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // Taper width (Z) as X increases (towards tip)
      const t = Math.max(0, (x + 0.1) / 0.3);
      const taper = 1.0 - Math.pow(t, 1.2) * 0.85;
      pos.setZ(i, z * taper);

      // Bottom tomial cutting edge taper
      if (y < 0) {
        const bottomTaper = 0.5 + Math.max(0, (y + 0.05) / 0.05) * 0.5;
        pos.setZ(i, pos.getZ(i) * bottomTaper);
      }
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the Lower Mandible with articulated hinge and oral cavity floor.
   */
  public static createBeakLowerGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.06, 0.01);
    shape.quadraticCurveTo(0.06, 0.005, 0.14, -0.015);
    shape.quadraticCurveTo(0.16, -0.025, 0.17, -0.04); // Tip
    shape.quadraticCurveTo(0.13, -0.045, 0.05, -0.035);
    shape.quadraticCurveTo(-0.04, -0.025, -0.06, -0.01);
    shape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 12,
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 6,
    };

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.center();

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const t = Math.max(0, (x + 0.08) / 0.25);
      pos.setZ(i, z * (1.0 - t * 0.75));
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the Raptor Cere (fleshy soft base around nares) with sculpted nostrils.
   */
  public static createCereGeometry(): THREE.BufferGeometry {
    const geom = new THREE.SphereGeometry(0.048, 20, 16);
    geom.scale(1.2, 0.85, 0.8);

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Flatten bottom
      if (y < -0.01) y *= 0.5;

      // Nostril indentation indent
      const distToNostrilL = Math.hypot(x - 0.01, y - 0.01, z - 0.025);
      const distToNostrilR = Math.hypot(x - 0.01, y - 0.01, z + 0.025);
      if (distToNostrilL < 0.018) {
        z -= (0.018 - distToNostrilL) * 0.8;
      }
      if (distToNostrilR < 0.018) {
        z += (0.018 - distToNostrilR) * 0.8;
      }

      pos.setXYZ(i, x, y, z);
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the massive curved Raptor Talon (hallux / digit claw).
   */
  public static createTalonGeometry(length = 0.075, thickness = 0.022): THREE.BufferGeometry {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(length * 0.55, -length * 0.15, 0),
      new THREE.Vector3(length * 0.7, -length * 0.8, 0) // sharp recurve down
    );

    const geom = new THREE.TubeGeometry(curve, 20, thickness, 12, false);
    const pos = geom.attributes.position;

    // Taper tube from base to razor sharp point
    for (let i = 0; i < pos.count; i++) {
      const u = Math.min(1.0, Math.max(0, (pos.getY(i) * -1) / (length * 0.8)));
      const taper = 1.0 - Math.pow(u, 0.8) * 0.92;
      pos.setZ(i, pos.getZ(i) * taper * 0.7); // lateral razor blade compression
      pos.setX(i, pos.getX(i));
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the aerodynamic Avian Torso & Keel (Pectoralis mass).
   */
  public static createTorsoGeometry(): THREE.BufferGeometry {
    const geom = new THREE.SphereGeometry(0.38, 32, 24);
    geom.scale(1.4, 0.95, 0.82); // Streamlined egg-like body

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Deep ventral keel (carina) under breast (x: -0.1 to 0.3, y < 0)
      if (y < 0 && x > -0.2 && x < 0.35) {
        const keelFactor = Math.cos((x - 0.1) * 4) * Math.sin(-y * 3);
        y -= keelFactor * 0.08;
        // Narrow keel laterally
        z *= (1.0 - Math.abs(y) * 0.45);
      }

      // Broad muscular shoulders (x: 0.15 to 0.35, y > 0)
      if (y > 0 && x > 0.05) {
        z *= (1.0 + Math.sin(x * 3) * 0.22);
      }

      // Tapering rump and pygostyle base (x < -0.2)
      if (x < -0.15) {
        const rumpT = (-x - 0.15) / 0.4;
        y += rumpT * 0.05;
        z *= (1.0 - rumpT * 0.5);
      }

      pos.setXYZ(i, x, y, z);
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the Eagle Head Plumage Mesh with raptorial brow ridge and nape flare.
   */
  public static createHeadPlumageGeometry(): THREE.BufferGeometry {
    const geom = new THREE.SphereGeometry(0.125, 28, 22);
    geom.scale(1.2, 1.05, 0.95);

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Supraorbital brow ridge overhang (y: 0.02 to 0.07, x: 0.02 to 0.08, z: ±0.06 to ±0.1)
      if (y > 0.01 && x > 0.01 && Math.abs(z) > 0.035) {
        y += 0.022;
        x += 0.015;
        if (Math.abs(z) < 0.08) {
          z += Math.sign(z) * 0.012; // Overhanging shelf over eye
        }
      }

      // Nape feather crest (back of head, x < -0.04, y > -0.04)
      if (x < -0.03 && y > -0.05) {
        x -= 0.025 * Math.sin((y + 0.05) * 15);
      }

      // Throat / Crop contour (front underside, x > 0, y < -0.02)
      if (x > 0 && y < -0.02) {
        y -= 0.015;
      }

      pos.setXYZ(i, x, y, z);
    }
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Generates the leading-edge Propatagium skin membrane.
   */
  public static createPropatagiumGeometry(span = 0.65, chord = 0.18): THREE.BufferGeometry {
    const geom = new THREE.PlaneGeometry(span, chord, 12, 6);
    geom.center();
    const pos = geom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + span * 0.5) / span;
      const v = (pos.getY(i) + chord * 0.5) / chord;

      // Concave aerodynamic camber
      const camber = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.025;
      pos.setZ(i, pos.getZ(i) - camber);
    }
    geom.computeVertexNormals();
    return geom;
  }
}
