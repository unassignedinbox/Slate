// GPU FFT cascade manager: spectrum evolution -> IFFT -> displacement textures.
import * as THREE from 'three';
import { makeRT, FullscreenPass, makeButterflyTexture } from '../core/gpu.js';
import { SPECTRUM_FRAG, FFT_FRAG, COMBINE_FRAG } from './glsl_sim.js';
import { cascadeBands } from './spectra.js';

export const COPY_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
void main() { gl_FragColor = texture2D(uSrc, vUv); }
`;

class Cascade {
  constructor(renderer, caps, N, band, shared) {
    this.N = N;
    this.band = band;
    const stages = Math.log2(N);
    const floatF = caps.floatRT ? THREE.FloatType : THREE.HalfFloatType;

    const mkSpec = () => makeRT(N, N, { type: floatF, filter: THREE.NearestFilter });
    this.rtSpec = mkSpec();
    this.rtA = mkSpec();
    this.rtB = mkSpec();
    this.rtDy = mkSpec();
    this.rtDx = mkSpec();
    this.rtDz = mkSpec();

    const dispType = caps.floatLinear && caps.floatRT ? THREE.FloatType : THREE.HalfFloatType;
    this.rtDisp = makeRT(N, N, { type: dispType, filter: THREE.LinearFilter });
    this.rtDisp.texture.wrapS = THREE.RepeatWrapping;
    this.rtDisp.texture.wrapT = THREE.RepeatWrapping;

    const S = shared;
    this.specPass = new FullscreenPass(SPECTRUM_FRAG, {
      uN: { value: N }, uNH: { value: N / 2 }, uStages: { value: stages },
      uTileL: { value: band.tile }, uTime: S.uTime, uSeed: { value: 1 },
      uMode: { value: 0 },
      uWindSpeed: S.uWindSpeed, uWindDir: S.uWindDir, uFetch: S.uFetch, uGamma: S.uGamma,
      uSpecMode: S.uSpecMode, uSwellHs: S.uSwellHs, uSwellTp: S.uSwellTp,
      uSwellDir: S.uSwellDir, uSwellBeta: S.uSwellBeta, uSwellOn: S.uSwellOn,
      uEnergy: S.uEnergy, uRefDepth: S.uRefDepth, uChop: S.uChop, uChopLen: S.uChopLen,
      uKLo0: { value: band.kLo0 }, uKLo1: { value: band.kLo1 },
      uKHi0: { value: band.kHi0 }, uKHi1: { value: band.kHi1 },
    });
    this.fftPass = new FullscreenPass(FFT_FRAG, {
      uSrc: { value: null }, uButterfly: { value: null },
      uN: { value: N }, uStages: { value: stages },
      uStage: { value: 0 }, uDir: { value: 0 },
    });
    this.combinePass = new FullscreenPass(COMBINE_FRAG, {
      uDy: { value: this.rtDy.texture },
      uDx: { value: this.rtDx.texture },
      uDz: { value: this.rtDz.texture },
    });
    this.stages = stages;
    void renderer;
  }

  setSeed(seed) { this.specPass.material.uniforms.uSeed.value = seed; }
  setButterfly(tex) { this.fftPass.material.uniforms.uButterfly.value = tex; }

  runFFT(renderer, srcRT) {
    const U = this.fftPass.material.uniforms;
    let cur = srcRT, other = null;
    const pair = [this.rtA, this.rtB];
    let ping = 0;
    // horizontal
    U.uDir.value = 0;
    let input = srcRT;
    for (let s = 0; s < this.stages; s++) {
      U.uStage.value = s;
      U.uSrc.value = input.texture;
      const out = pair[ping ^ 1];
      this.fftPass.render(renderer, out);
      input = out; ping ^= 1;
    }
    // vertical
    U.uDir.value = 1;
    for (let s = 0; s < this.stages; s++) {
      U.uStage.value = s;
      U.uSrc.value = input.texture;
      const out = pair[ping ^ 1];
      this.fftPass.render(renderer, out);
      input = out; ping ^= 1;
    }
    return input;
  }

  update(renderer, copyPass) {
    const modes = [
      [0, this.rtDy], [1, this.rtDx], [2, this.rtDz],
    ];
    for (const [mode, dest] of modes) {
      this.specPass.material.uniforms.uMode.value = mode;
      this.specPass.render(renderer, this.rtSpec);
      const result = this.runFFT(renderer, this.rtSpec);
      copyPass.material.uniforms.uSrc.value = result.texture;
      copyPass.render(renderer, dest);
    }
    this.combinePass.render(renderer, this.rtDisp);
  }

  dispose(renderer) {
    for (const rt of [this.rtSpec, this.rtA, this.rtB, this.rtDy, this.rtDx, this.rtDz, this.rtDisp]) rt.dispose();
    this.specPass.dispose(); this.fftPass.dispose(); this.combinePass.dispose();
    void renderer;
  }
}

export class OceanField {
  constructor(renderer, caps, shared, opts = {}) {
    this.renderer = renderer;
    this.caps = caps;
    this.shared = shared;
    this.N = opts.N ?? 256;
    this.tiles = opts.tiles ?? [1024, 256, 64];
    this.copyPass = new FullscreenPass(COPY_FRAG, { uSrc: { value: null } });
    this.build();
  }

  build() {
    this.disposeCascades();
    const { texture: butterfly } = makeButterflyTexture(this.N);
    this.butterfly = butterfly;
    const bands = cascadeBands(this.tiles, this.N);
    this.cascades = bands.map((band, i) => {
      const c = new Cascade(this.renderer, this.caps, this.N, band, this.shared);
      c.setButterfly(butterfly);
      c.setSeed(1 + i * 7);
      return c;
    });
    const dispType = this.cascades[0].rtDisp.texture.type;
    this.rtDispPrev0 = makeRT(this.N, this.N, { type: dispType, filter: THREE.LinearFilter });
    this.rtDispPrev0.texture.wrapS = THREE.RepeatWrapping;
    this.rtDispPrev0.texture.wrapT = THREE.RepeatWrapping;
    const S = this.shared;
    S.uDisp0.value = this.cascades[0].rtDisp.texture;
    S.uDisp1.value = this.cascades[1].rtDisp.texture;
    S.uDisp2.value = this.cascades[2].rtDisp.texture;
    S.uTiles.value.set(this.tiles[0], this.tiles[1], this.tiles[2]);
    S.uDispPrev0.value = this.rtDispPrev0.texture;
    this.ready = false;
  }

  disposeCascades() {
    if (this.cascades) for (const c of this.cascades) c.dispose();
    if (this.butterfly) this.butterfly.dispose();
    if (this.rtDispPrev0) this.rtDispPrev0.dispose();
    this.cascades = null;
  }

  setSize(N) {
    if (N === this.N) return;
    this.N = N;
    this.build();
  }

  update(time) {
    const renderer = this.renderer;
    // stash previous-frame cascade-0 displacement for velocity measurement
    if (this.ready) {
      this.copyPass.material.uniforms.uSrc.value = this.cascades[0].rtDisp.texture;
      this.copyPass.render(renderer, this.rtDispPrev0);
    }
    for (const c of this.cascades) c.update(renderer, this.copyPass);
    if (!this.ready) {
      this.copyPass.material.uniforms.uSrc.value = this.cascades[0].rtDisp.texture;
      this.copyPass.render(renderer, this.rtDispPrev0);
      this.ready = true;
    }
  }

  dispose() {
    this.disposeCascades();
    this.copyPass.dispose();
  }
}
