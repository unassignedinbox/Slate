// River / lake water: a standard material whose colour and opacity follow the water depth
// (per-vertex `aDepth` from buildWaterGeometry) — shallow water is clear and shows the gravel
// bed, deeper water takes the water colour, so shores and bars fade in instead of ending in a
// hard dark edge.
import * as THREE from 'three';

export function makeWaterBodyUniforms() {
  return { uShallow: { value: new THREE.Color(0x4f7f7a) }, uClearDepth: { value: 1.5 } };
}

export function makeWaterBodyMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ color: 0x1d4552, roughness: 0.16, metalness: 0.05, transparent: true, opacity: 0.85, envMapIntensity: 1.2 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uShallow = uniforms.uShallow;
    shader.uniforms.uClearDepth = uniforms.uClearDepth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute float aDepth;\nvarying float vDepth;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform vec3 uShallow;\nuniform float uClearDepth;\nvarying float vDepth;\n#include <common>')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( uShallow, diffuseColor.rgb, smoothstep( 0.0, uClearDepth * 4.0, vDepth ) );\ndiffuseColor.a *= mix( 0.35, 1.0, smoothstep( 0.0, uClearDepth, vDepth ) );');
  };
  material.customProgramCacheKey = () => 'water-body';
  return material;
}
