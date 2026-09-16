// Persistent advected foam field (ping-pong).
import * as THREE from 'three';
import { makeRT, FullscreenPass } from '../core/gpu.js';
import { FOAM_FRAG } from './glsl_sim.js';

export class FoamField {
  constructor(renderer, shared, opts = {}) {
    this.shared = shared;
    this.res = opts.res ?? 512;
    this.tileSize = opts.tileSize ?? 520;
    this.center = new THREE.Vector2(0, 0);
    const mk = () => makeRT(this.res, this.res, { type: THREE.HalfFloatType, filter: THREE.LinearFilter });
    this.rtA = mk();
    this.rtB = mk();
    this.cur = this.rtA;
    const S = shared;
    this.pass = new FullscreenPass(FOAM_FRAG, {
      uPrev: { value: null },
      uDispPrev0: S.uDispPrev0,
      uDisp0: S.uDisp0, uDisp1: S.uDisp1, uDisp2: S.uDisp2, uTiles: S.uTiles,
      uCenter: { value: this.center },
      uSize: { value: this.tileSize },
      uDt: { value: 0.016 }, uTime: S.uTime,
      uCamDelta: { value: new THREE.Vector2() },
      uWindSpeed: S.uWindSpeed,
      uTau: { value: 3.2 }, uDeposit: { value: 1.0 }, uWhitecap: { value: 1.0 },
      uPeakK: S.uPeakK,
      uSrcCount: S.uSrcCount, uSrcA: S.uSrcA, uSrcB: S.uSrcB, uSrcC: S.uSrcC,
      uBathy0: S.uBathy0, uBathy1: S.uBathy1, uBathy2: S.uBathy2,
    });
    this.prevCenter = new THREE.Vector2(1e9, 0);
    this.foamTex = { value: this.cur.texture };
    void renderer;
  }

  get texture() { return this.foamTex.value; }

  setRes(renderer, res) {
    if (res === this.res) return;
    this.res = res;
    this.rtA.dispose(); this.rtB.dispose();
    const mk = () => makeRT(res, res, { type: THREE.HalfFloatType, filter: THREE.LinearFilter });
    this.rtA = mk(); this.rtB = mk();
    this.cur = this.rtA;
    this.foamTex.value = this.cur.texture;
    void renderer;
  }

  update(renderer, centerX, centerZ, dt, snap = true) {
    // snap tile to texels to avoid swimming
    const texel = this.tileSize / this.res;
    let cx = centerX, cz = centerZ;
    if (snap) { cx = Math.round(cx / texel) * texel; cz = Math.round(cz / texel) * texel; }
    const U = this.pass.material.uniforms;
    if (this.prevCenter.x > 1e8) {
      U.uCamDelta.value.set(0, 0);
    } else {
      U.uCamDelta.value.set(cx - this.prevCenter.x, cz - this.prevCenter.y);
    }
    this.prevCenter.set(cx, cz);
    this.center.set(cx, cz);
    U.uDt.value = Math.min(dt, 0.05);
    U.uPrev.value = this.cur.texture;
    const next = this.cur === this.rtA ? this.rtB : this.rtA;
    this.pass.render(renderer, next);
    this.cur = next;
    this.foamTex.value = this.cur.texture;
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.pass.dispose();
  }
}
