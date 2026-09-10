// Renderer — raymarched SDF terrain + water + particle sprites into the
// default framebuffer (with depth for correct occlusion).
import { FULLSCREEN_VS } from './glutil.js';
import { state, FLOW_RES } from './config.js';
import { terrainFS, PARTICLE_VS, PARTICLE_FS } from './glsl/render.js';
import { ATLAS_GLSL } from './glsl/common.js';
import { PT } from './sim.js';

export class Renderer {
  constructor(G, volume, sim, camera) {
    this.G = G;
    this.vol = volume;
    this.sim = sim;
    this.cam = camera;
    this.showParticles = true;
    this.particleScale = 1.0;
    this.scale = 1.0;               // resolution scale
    this.opts = {
      shadows: 1, ao: 1, steps: 1.0, flowStrength: 1.0,
      exposure: 1.15, waterLevel: 0.0,
      waveHeight: 0.35, wavelength: 9.0, foam: 0.7, clarity: 0.55,
    };
    this.sun = { az: 2.3, el: 0.55 };
    this.mode = 0;
    this.build();
    this.resize();
  }

  build() {
    const G = this.G;
    this.pTerrain = G.program('terrain', FULLSCREEN_VS, terrainFS, 'terrain');
    this.pParticles = G.program('particles', PARTICLE_VS, PARTICLE_FS, 'particles');
  }

  canvasSize() {
    const cv = this.G.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    return [Math.max(2, Math.round(cv.clientWidth * dpr)), Math.max(2, Math.round(cv.clientHeight * dpr))];
  }

  resize() {
    const [w, h] = this.canvasSize();
    if (this.G.canvas.width !== w || this.G.canvas.height !== h) {
      this.G.canvas.width = w;
      this.G.canvas.height = h;
    }
  }

  sunDir() {
    const ce = Math.cos(this.sun.el);
    return [ce * Math.cos(this.sun.az), Math.sin(this.sun.el), ce * Math.sin(this.sun.az)];
  }

  bindCommon(prog) {
    const gl = this.G.gl, u = prog.u;
    const cam = this.cam;
    const [w, h] = [this.G.canvas.width, this.G.canvas.height];
    gl.uniform3f(u.uCamPos, cam.pos[0], cam.pos[1], cam.pos[2]);
    gl.uniform3f(u.uCamRight, cam.right[0], cam.right[1], cam.right[2]);
    gl.uniform3f(u.uCamUp, cam.up[0], cam.up[1], cam.up[2]);
    gl.uniform3f(u.uCamFwd, cam.fwd[0], cam.fwd[1], cam.fwd[2]);
    gl.uniform2f(u.uScreen, w, h);
    gl.uniform1f(u.uTanFov, Math.tan(cam.fov / 2));
    const n = cam.near, f = cam.far;
    gl.uniform2f(u.uDepthParams, (f + n) / (n - f), 2 * f * n / (n - f));
  }

  setVolumeUniforms(prog) {
    const gl = this.G.gl, u = prog.u;
    gl.uniform3i(u.uDim, state.dim[0], state.dim[1], state.dim[2]);
    gl.uniform3f(u.uLo, state.lo[0], state.lo[1], state.lo[2]);
    gl.uniform3f(u.uHi, state.hi[0], state.hi[1], state.hi[2]);
    gl.uniform1f(u.uCell, state.cell);
    const s = this.vol.size();
    gl.uniform2i(u.uAtlasSize, s[0], s[1]);
  }

  render(time) {
    const G = this.G, gl = G.gl;
    this.resize();
    const [w, h] = [this.G.canvas.width, this.G.canvas.height];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.02, 0.022, 0.026, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ── terrain + water ──
    {
      const p = this.pTerrain;
      gl.useProgram(p.p);
      this.bindCommon(p);
      this.setVolumeUniforms(p);
      const sd = this.sunDir();
      gl.uniform3f(p.u.uSunDir, sd[0], sd[1], sd[2]);
      gl.uniform3f(p.u.uSunCol, 1.28, 1.13, 0.94);
      gl.uniform1f(p.u.uTime, time);
      gl.uniform1f(p.u.uExposure, this.opts.exposure);
      gl.uniform1f(p.u.uWaterLevel, this.opts.waterLevel);
      gl.uniform4f(p.u.uWaterOpt, this.opts.waveHeight, this.opts.wavelength, this.opts.foam, this.opts.clarity);
      gl.uniform4f(p.u.uRenderOpt, this.opts.shadows, this.opts.ao, this.opts.steps, this.opts.flowStrength);
      gl.uniform1i(p.u.uMode, this.mode);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.vol.tex());
      gl.uniform1i(p.u.uTerrain, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.G.tex.get(this.sim.flowRead));
      gl.uniform1i(p.u.uFlow, 1);
      G.drawQuad(p);
    }

    // ── particles ──
    if (this.showParticles) {
      const p = this.pParticles;
      gl.useProgram(p.p);
      this.bindCommon(p);
      gl.uniform1f(p.u.uSizeMul, this.particleScale);
      gl.uniform2i(p.u.uPT, PT[0], PT[1]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const S = this.sim;
      const bindTex = (name, texName) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, G.tex.get(texName));
        gl.uniform1i(p.u[name], 0);
      };
      bindTex('uPosAge', 'posAge' + S.pRead);
      bindTex('uMeta', 'meta' + S.pRead);
      bindTex('uSpecies', 'species' + S.sRead);
      G.drawQuadsInstanced(p, PT[0] * PT[1]);
      gl.disable(gl.BLEND);
    }
  }

  screenshot() {
    // called right after a render with preserveDrawingBuffer: true
    const cv = this.G.canvas;
    const url = cv.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `slate-view-${Date.now()}.png`;
    a.click();
  }
}

export { FLOW_RES };
