// WebGL2 render-target helpers + capability detection.
import * as THREE from 'three';
import { precomputeButterfly } from './butterfly.js';

export function detectCapabilities(renderer) {
  const gl = renderer.getContext();
  const isWebGL2 = renderer.capabilities.isWebGL2;
  const floatRT = isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  const halfRT = isWebGL2 && !!gl.getExtension('EXT_color_buffer_half_float');
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');
  const maxVertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
  const maxFragmentTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  return { isWebGL2, floatRT, halfRT, floatLinear, maxVertexTextures, maxFragmentTextures };
}

export function makeRT(w, h, opts = {}) {
  const {
    type = THREE.FloatType,
    filter = THREE.NearestFilter,
    format = THREE.RGBAFormat,
    depth = false,
    stencil = false,
  } = opts;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type,
    format,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: depth,
    stencilBuffer: stencil,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

export function makeDataTextureRGBA(data, w, h) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Butterfly lookup texture: width N, height stages, RGBA float.
export function makeButterflyTexture(N) {
  const bf = precomputeButterfly(N);
  return { texture: makeDataTextureRGBA(bf.data, N, bf.stages), butterfly: bf };
}

// Fullscreen-triangle pass helper.
const _fsGeo = new THREE.BufferGeometry();
_fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
_fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const _fsVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class FullscreenPass {
  constructor(fragmentShader, uniforms = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: _fsVert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(_fsGeo, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
