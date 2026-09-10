// Bake shader — evaluates the graph-generated scene(p) into the volume atlas.
// occupancy a = clamp(0.5 - d/cell) anchors the interface in the band.
import { ATLAS_GLSL, NOISE_GLSL, PRIM_GLSL } from './common.js';

export const bakeFS = (sceneBody, extraUniforms) => `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${ATLAS_GLSL}
${NOISE_GLSL}
${PRIM_GLSL}
${extraUniforms}
layout(location=0) out vec4 outTerrain;
${sceneBody}
void main(){
  ivec3 q = addrVoxel(ivec2(gl_FragCoord.xy));
  vec3 p = voxelWorld(q);
  float d = scene(p);
  float a = clamp(0.5 - d / uCell, 0.0, 1.0);
  outTerrain = vec4(clamp(d, -200.0, 200.0), 0.0, 0.0, a);
}
`;

// Render helpers for the 2D domain passes (height / thermal column maps).
export const columnQuadVS = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
