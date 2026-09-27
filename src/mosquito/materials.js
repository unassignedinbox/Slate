import * as THREE from 'three';

/**
 * Police-drone read: ceramic white shell over a graphite exoskeleton,
 * smoked membrane wings, a few hot emissive accents. Everything is
 * physically-based so it holds up under any lighting.
 */
export function makeMaterials() {
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xdfe3e7, metalness: 0.15, roughness: 0.34,
    clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 0.2,
  });
  const shellDark = new THREE.MeshPhysicalMaterial({
    color: 0x2a2e34, metalness: 0.55, roughness: 0.42, clearcoat: 0.5,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x15171b, metalness: 0.92, roughness: 0.33,
  });
  const joint = new THREE.MeshStandardMaterial({
    color: 0x3c4148, metalness: 0.95, roughness: 0.22,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb9c0c8, metalness: 1.0, roughness: 0.16,
  });
  const stylet = new THREE.MeshStandardMaterial({
    color: 0xd8dde3, metalness: 1.0, roughness: 0.09,
  });
  const eye = new THREE.MeshPhysicalMaterial({
    color: 0x0a0d12, metalness: 0.35, roughness: 0.12,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    emissive: 0x0d2b3a, emissiveIntensity: 0.55,
    flatShading: true, iridescence: 0.85, iridescenceIOR: 1.9,
  });
  const membrane = new THREE.MeshPhysicalMaterial({
    color: 0x9aa6b4, metalness: 0.0, roughness: 0.22,
    transmission: 0.82, thickness: 0.012, ior: 1.36,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    iridescence: 1.0, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 560],
    clearcoat: 0.6,
  });
  const scaleBand = new THREE.MeshStandardMaterial({
    color: 0x14161a, metalness: 0.3, roughness: 0.62,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x101319, emissive: 0x2ad9ff, emissiveIntensity: 3.2, roughness: 0.4,
  });
  const accentHot = new THREE.MeshStandardMaterial({
    color: 0x180c06, emissive: 0xff7518, emissiveIntensity: 4.0, roughness: 0.4,
  });
  const fluid = new THREE.MeshPhysicalMaterial({
    color: 0xd9962a, metalness: 0.0, roughness: 0.12,
    transmission: 0.55, thickness: 0.4, ior: 1.44,
    emissive: 0x6b3d05, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.9,
  });
  return { shell, shellDark, frame, joint, steel, stylet, eye, membrane, scaleBand, accent, accentHot, fluid };
}

/**
 * Injects live spanwise twist + aeroelastic flexure into a wing material.
 * Doing this on the GPU keeps the wing smooth at 800 Hz instead of
 * chunking it into rigid panels.
 */
export function makeWingDeformable(material, uniformsOut) {
  const u = {
    uTwist: { value: 0 },      // radians of extra twist, root -> tip
    uTwistLag: { value: 0 },   // how far the tip lags the root
    uFlex: { value: 0 },       // signed bend amount
    uSpanLen: { value: 1 },
  };
  Object.assign(uniformsOut, u);
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSpan;
        uniform float uTwist; uniform float uTwistLag; uniform float uFlex; uniform float uSpanLen;
        vec3 slateWingDeform(vec3 p, float s){
          // spanwise torsion, tip leads the root by uTwistLag
          float w = pow(s, 1.0 + uTwistLag);
          float a = uTwist * w;
          float ca = cos(a), sa = sin(a);
          // rotate the chord about the span axis (span = +Z)
          vec2 rc = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
          // aeroelastic bend: quadratic deflection normal to the plane
          float bend = uFlex * uSpanLen * s * s;
          return vec3(rc.x, rc.y + bend, p.z);
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = normal;
        {
          float e = 0.004;
          vec3 pA = slateWingDeform(position, aSpan);
          vec3 pB = slateWingDeform(position + vec3(e,0.0,0.0), aSpan);
          vec3 pC = slateWingDeform(position + vec3(0.0,0.0,e), min(1.0, aSpan + e/max(uSpanLen,1e-4)));
          objectNormal = normalize(cross(pC - pA, pB - pA));
        }`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = slateWingDeform(position, aSpan);`);
  };
  material.customProgramCacheKey = () => 'slateWing';
  return u;
}
