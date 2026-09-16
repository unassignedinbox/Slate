// GPU spray + foam-fleck particle system (stateful GPGPU + point sprites).
import * as THREE from 'three';
import { makeRT, FullscreenPass } from '../core/gpu.js';
import { SPRAY_UPDATE_FRAG, SPRAY_VERT, SPRAY_FRAG } from './glsl_sim.js';
import { NOISE_GLSL } from './glsl_common.js';

export class SpraySystem {
  constructor(renderer, scene, shared, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.shared = shared;
    this.res = opts.res ?? 256; // res*res particles
    this.spawnR = opts.spawnR ?? 260;
    this.capabilitiesChecked = false;
    const S = shared;
    this.updatePass = new FullscreenPass(SPRAY_UPDATE_FRAG, {
      uPosT: { value: null }, uVelT: { value: null },
      uDispPrev0: S.uDispPrev0,
      uDisp0: S.uDisp0, uDisp1: S.uDisp1, uDisp2: S.uDisp2, uTiles: S.uTiles,
      uSpawnCenter: { value: new THREE.Vector2() },
      uSpawnR: { value: this.spawnR },
      uDt: { value: 0.016 }, uTime: S.uTime, uFrame: { value: 0 },
      uWindVec: S.uWindVec,
      uLifeSpray: { value: 1.1 }, uLifeFoam: { value: 6.0 },
      uFoamFrac: { value: 0.62 }, uGain: { value: 1.0 },
      uPeakK: S.uPeakK, uMode: { value: 0 },
      uSrcCount: S.uSrcCount, uSrcA: S.uSrcA, uSrcB: S.uSrcB, uSrcC: S.uSrcC,
      uBathy0: S.uBathy0, uBathy1: S.uBathy1, uBathy2: S.uBathy2,
    });
    this.buildState();
    this.buildPoints();
    this.frame = 0;
    this.enabled = true;
  }

  get count() { return this.res * this.res; }

  buildState() {
    const floatOK = this.renderer.capabilities.isWebGL2;
    const type = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    const mk = () => makeRT(this.res, this.res, { type, filter: THREE.NearestFilter });
    if (this.rtPosA) { this.rtPosA.dispose(); this.rtPosB.dispose(); this.rtVelA.dispose(); this.rtVelB.dispose(); }
    this.rtPosA = mk(); this.rtPosB = mk();
    this.rtVelA = mk(); this.rtVelB = mk();
    // Fresh WebGL textures are zero-initialized, i.e. life=0 = dead particles.
    this.posCur = this.rtPosA; this.velCur = this.rtVelA;
  }

  buildPoints() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    const n = this.count;
    const pos = new Float32Array(n * 3);
    let i = 0;
    for (let y = 0; y < this.res; y++) {
      for (let x = 0; x < this.res; x++) {
        pos[i * 3] = (x + 0.5) / this.res;
        pos[i * 3 + 1] = (y + 0.5) / this.res;
        pos[i * 3 + 2] = 0;
        i++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const S = this.shared;
    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT,
      fragmentShader: NOISE_GLSL + SPRAY_FRAG,
      uniforms: {
        uPosT: { value: null }, uVelT: { value: null },
        uScaleH: { value: 800 }, uSizeSpray: { value: 0.55 }, uSizeFoam: { value: 1.1 },
        uFogColor: S.uFogColor, uFogDensity: S.uFogDensity, uOpacity: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(geo, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);
  }

  setRes(res) {
    if (res === this.res) return;
    this.res = res;
    this.buildState();
    this.buildPoints();
  }

  onResize(heightPx, fovDeg) {
    const uScaleH = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    if (this.pointsMat) this.pointsMat.uniforms.uScaleH.value = uScaleH;
  }

  update(cx, cz, dt, time) {
    this.points.visible = this.enabled;
    if (!this.enabled) return;
    const U = this.updatePass.material.uniforms;
    U.uSpawnCenter.value.set(cx, cz);
    U.uDt.value = Math.min(dt, 0.05);
    U.uFrame.value = this.frame = (this.frame + 1) % 4096;
    U.uPosT.value = this.posCur.texture;
    U.uVelT.value = this.velCur.texture;
    const posNext = this.posCur === this.rtPosA ? this.rtPosB : this.rtPosA;
    const velNext = this.velCur === this.rtVelA ? this.rtVelB : this.rtVelA;
    U.uMode.value = 0;
    this.updatePass.render(this.renderer, posNext);
    U.uMode.value = 1;
    this.updatePass.render(this.renderer, velNext);
    this.posCur = posNext; this.velCur = velNext;
    this.pointsMat.uniforms.uPosT.value = this.posCur.texture;
    this.pointsMat.uniforms.uVelT.value = this.velCur.texture;
    void time;
  }

  dispose() {
    this.rtPosA.dispose(); this.rtPosB.dispose();
    this.rtVelA.dispose(); this.rtVelB.dispose();
    this.updatePass.dispose();
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.pointsMat.dispose();
  }
}
