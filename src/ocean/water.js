// Water surface, seabed and sky meshes.
import * as THREE from 'three';
import { WATER_VERT, WATER_FRAG, SEABED_VERT, SEABED_FRAG, SKY_VERT, SKY_FRAG } from './glsl_render.js';

// Radial log-spaced grid: dense near the camera, reaching the horizon.
export function buildRadialGeometry(rings, segs, rMin, rMax) {
  const verts = 1 + rings * segs;
  const pos = new Float32Array(verts * 3);
  let v = 1;
  for (let i = 0; i < rings; i++) {
    const r = rMin * Math.pow(rMax / rMin, rings === 1 ? 1 : i / (rings - 1));
    for (let j = 0; j < segs; j++) {
      const th = (2 * Math.PI * j) / segs;
      pos[v * 3] = r * Math.cos(th);
      pos[v * 3 + 1] = 0;
      pos[v * 3 + 2] = r * Math.sin(th);
      v++;
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) {
    idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      const a = 1 + i * segs + j;
      const b = 1 + i * segs + j1;
      const c = 1 + (i + 1) * segs + j;
      const d = 1 + (i + 1) * segs + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

export class WaterSurface {
  constructor(scene, shared, foamField, opts = {}) {
    this.shared = shared;
    const S = shared;
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: S.uTime,
        uDisp0: S.uDisp0, uDisp1: S.uDisp1, uDisp2: S.uDisp2, uTiles: S.uTiles,
        uSrcCount: S.uSrcCount, uSrcA: S.uSrcA, uSrcB: S.uSrcB, uSrcC: S.uSrcC,
        uBathy0: S.uBathy0, uBathy1: S.uBathy1, uBathy2: S.uBathy2,
        uPeakK: S.uPeakK, uLip: S.uLip,
        uHsRef: S.uHsRef,
        uFoamTex: foamField.foamTex,
        uFoamCenter: { value: foamField.center },
        uFoamSize: { value: foamField.tileSize },
        uDeep: S.uDeep, uMid: S.uMid, uShallow: S.uShallow, uSSSColor: S.uSSSColor,
        uSunDir: S.uSunDir, uSunColor: S.uSunColor,
        uZenith: S.uZenith, uHorizon: S.uHorizon,
        uCloudiness: S.uCloudiness, uSkyTime: S.uSkyTime,
        uFogColor: S.uFogColor, uFogDensity: S.uFogDensity,
        uFoamStrength: S.uFoamStrength, uDetailAmp: S.uDetailAmp, uWindVec: S.uWindVec,
      },
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    const geo = buildRadialGeometry(opts.rings ?? 150, opts.segs ?? 224, opts.rMin ?? 1.2, opts.rMax ?? 7500);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  follow(x, z) { this.mesh.position.set(x, 0, z); }
}

export class Seabed {
  constructor(scene, shared, opts = {}) {
    const S = shared;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SEABED_VERT,
      fragmentShader: SEABED_FRAG,
      uniforms: {
        uTime: S.uTime,
        uBathy0: S.uBathy0, uBathy1: S.uBathy1, uBathy2: S.uBathy2,
        uSunDir: S.uSunDir,
        uDeepTint: S.uDeep,
        uFogColor: S.uFogColor, uFogDensity: S.uFogDensity,
      },
    });
    const geo = buildRadialGeometry(opts.rings ?? 110, opts.segs ?? 180, 2, 7500);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }
}

export class Sky {
  constructor(scene, shared) {
    const S = shared;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: S.uSunDir, uSunColor: S.uSunColor,
        uZenith: S.uZenith, uHorizon: S.uHorizon,
        uCloudiness: S.uCloudiness, uSkyTime: S.uSkyTime,
        uFogColor: S.uFogColor,
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 40, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  follow(cam) { this.mesh.position.copy(cam.position); }
}
