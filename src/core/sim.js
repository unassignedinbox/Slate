// Simulation orchestrator — drives the multi-agent erosion passes on the GPU.
// Per step: motion → event → scatter → acceptance → cargo feedback → repair
//           (+ height/thermal, + flow-map decay/splat).
//
// State sides:
//   particleA/B : posAge · velWater · meta · impact   (4 MRT, motion rewrites all)
//   speciesA/B  : cargo                                (1 MRT, feedback rewrites)
// Volume ping-pong lives in Volume.
import { FULLSCREEN_VS } from './glutil.js';
import { state, FLOW_RES } from './config.js';
import {
  motionFS, eventFS, scatterVS, scatterFS, acceptFS, feedbackFS,
  repairFS, heightFS, thermalFS, flowDecayFS, flowSplatVS, flowSplatFS, countFS,
} from './glsl/sim.js';

const PT = [128, 64]; // particle texture (up to 8192 agents)

export class Simulation {
  constructor(G, volume) {
    this.G = G;
    this.vol = volume;
    this.step = 0;
    this.alive = 0;
    this.buildTextures();
    this.buildPrograms();
    this.reset();
  }

  atlasSize() { return this.vol.size(); }

  buildTextures() {
    const G = this.G, gl = G.gl;
    const [aw, ah] = this.atlasSize();
    for (const s of ['A', 'B']) {
      G.tex2D('posAge' + s, PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
      G.tex2D('velWater' + s, PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
      G.tex2D('meta' + s, PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
      G.tex2D('impact' + s, PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
      G.fbo('particle' + s, [G.tex.get('posAge' + s), G.tex.get('velWater' + s), G.tex.get('meta' + s), G.tex.get('impact' + s)]);
      G.tex2D('species' + s, PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
      G.fbo('species' + s, [G.tex.get('species' + s)]);
    }
    G.tex2D('demand', PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
    G.tex2D('sums', PT[0], PT[1], gl.RGBA32F, gl.RGBA, gl.FLOAT);
    G.fbo('event', [G.tex.get('demand'), G.tex.get('sums')]);
    // exchange + acceptance (16F — blendable in core ES3.0, compact)
    G.tex2D('exchange', aw, ah, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    G.fbo('exchange', [G.tex.get('exchange')]);
    G.tex2D('accept', aw, ah, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    G.fbo('accept', [G.tex.get('accept')]);
    // column maps
    G.tex2D('height', state.dim[0], state.dim[2], gl.RGBA32F, gl.RGBA, gl.FLOAT);
    G.fbo('height', [G.tex.get('height')]);
    G.tex2D('count', 1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    G.fbo('count', [G.tex.get('count')]);
    // flow map (filterable 16F)
    G.tex2D('flowA', FLOW_RES[0], FLOW_RES[1], gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    G.tex2D('flowB', FLOW_RES[0], FLOW_RES[1], gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    G.fbo('flowA', [G.tex.get('flowA')]);
    G.fbo('flowB', [G.tex.get('flowB')]);
    this.pRead = 'A'; this.pWrite = 'B';
    this.sRead = 'A'; this.sWrite = 'B';
    this.flowRead = 'flowA';
  }

  buildPrograms() {
    const G = this.G;
    this.pMotion = G.program('motion', FULLSCREEN_VS, motionFS, 'motion');
    this.pEvent = G.program('event', FULLSCREEN_VS, eventFS, 'event');
    this.pScatter = G.program('scatter', scatterVS, scatterFS, 'scatter');
    this.pAccept = G.program('accept', FULLSCREEN_VS, acceptFS, 'accept');
    this.pFeedback = G.program('feedback', FULLSCREEN_VS, feedbackFS, 'feedback');
    this.pRepair = G.program('repair', FULLSCREEN_VS, repairFS, 'repair');
    this.pHeight = G.program('height', FULLSCREEN_VS, heightFS, 'height');
    this.pThermal = G.program('thermal', FULLSCREEN_VS, thermalFS, 'thermal');
    this.pFlowDecay = G.program('flowDecay', FULLSCREEN_VS, flowDecayFS, 'flowDecay');
    this.pFlowSplat = G.program('flowSplat', flowSplatVS, flowSplatFS, 'flowSplat');
    this.pCount = G.program('count', FULLSCREEN_VS, countFS, 'count');
  }

  reset() {
    const G = this.G, gl = G.gl;
    for (const s of ['A', 'B']) {
      G.bindFbo('particle' + s);
      gl.clearBufferfv(gl.COLOR, 0, [-1, 0, 0, 0]);   // posAge: dead
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);    // velWater
      gl.clearBufferfv(gl.COLOR, 2, [0, 0.5, 3, 0.05]);// meta
      gl.clearBufferfv(gl.COLOR, 3, [0, 0, 0, 0]);    // impact
      G.bindFbo('species' + s);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    }
    for (const f of ['flowA', 'flowB']) {
      G.bindFbo(f);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    }
    this.pRead = 'A'; this.pWrite = 'B';
    this.sRead = 'A'; this.sWrite = 'B';
    this.flowRead = 'flowA';
    this.step = 0;
    this.alive = 0;
  }

  setCommon(prog) {
    const gl = this.G.gl, u = prog.u;
    gl.uniform3i(u.uDim, state.dim[0], state.dim[1], state.dim[2]);
    gl.uniform3f(u.uLo, state.lo[0], state.lo[1], state.lo[2]);
    gl.uniform3f(u.uHi, state.hi[0], state.hi[1], state.hi[2]);
    gl.uniform1f(u.uCell, state.cell);
    const s = this.atlasSize();
    gl.uniform2i(u.uAtlasSize, s[0], s[1]);
    gl.uniform2i(u.uPT, PT[0], PT[1]);
  }

  bind(prog, map) {
    const gl = this.G.gl;
    let unit = 0;
    for (const [name, texName] of Object.entries(map)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.G.tex.get(texName));
      gl.uniform1i(prog.u[name], unit);
      unit++;
    }
  }

  swapParticles() { const t = this.pRead; this.pRead = this.pWrite; this.pWrite = t; }
  swapSpecies() { const t = this.sRead; this.sRead = this.sWrite; this.sWrite = t; }

  // erosion: { detach, hardness, deposition, capacity, attrition, maxDetach, wetDecay }
  // agents: { rain:{on,intensity,grain,impact,evap}, river:{...}, wind:{...} }
  // thermal: null | { on, angle, rate }
  update(dt, erosion, agents, thermal) {
    const G = this.G, gl = G.gl;
    const [aw, ah] = this.atlasSize();
    this.step++;
    const windRad = (agents.wind.dir || 0) * Math.PI / 180;
    const { detach, hardness, deposition, capacity } = erosion;
    gl.disable(gl.BLEND);

    // ── 1 · motion (positions/velocities/meta/impact) ──
    {
      const p = this.pMotion;
      G.bindFbo('particle' + this.pWrite);
      G.viewport(0, 0, PT[0], PT[1]);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, {
        uTerrain: this.vol.read,
        uPosAge: 'posAge' + this.pRead,
        uVelWater: 'velWater' + this.pRead,
        uMeta: 'meta' + this.pRead,
        uSpecies: 'species' + this.sRead,
      });
      gl.uniform4f(p.u.uProcess, detach, hardness, deposition, capacity);
      gl.uniform4f(p.u.uEnv, dt, this.step, 0.5, windRad);
      const r = agents.rain, rv = agents.river, w = agents.wind;
      gl.uniform4f(p.u.uRain, r.intensity, r.grain, r.impact, r.evap);
      gl.uniform4f(p.u.uRiver, rv.intensity, rv.speed, rv.brush, rv.grain);
      gl.uniform4f(p.u.uWind, w.speed, w.height, w.spread, w.abrasion);
      gl.uniform4f(p.u.uSpawnW, r.on ? r.intensity : 0, rv.on ? rv.intensity : 0, w.on ? w.intensity : 0, 0);
      gl.uniform3f(p.u.uRiverSrc, rv.srcX, rv.srcZ, rv.spread);
      gl.uniform1f(p.u.uMaxDetach, erosion.maxDetach);
      G.drawQuad(p);
      this.swapParticles();
    }

    // ── 2 · event (detach/deposit demands + normalized brush sums) ──
    {
      const p = this.pEvent;
      G.bindFbo('event');
      G.viewport(0, 0, PT[0], PT[1]);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, {
        uTerrain: this.vol.read,
        uPosAge: 'posAge' + this.pRead,
        uVelWater: 'velWater' + this.pRead,
        uMeta: 'meta' + this.pRead,
        uSpecies: 'species' + this.sRead,
        uImpact: 'impact' + this.pRead,
      });
      gl.uniform4f(p.u.uProcess, detach, hardness, deposition, capacity);
      gl.uniform4f(p.u.uEnv, dt, this.step, 0.5, windRad);
      const r = agents.rain, rv = agents.river, w = agents.wind;
      gl.uniform4f(p.u.uRain, r.intensity, r.grain, r.impact, r.evap);
      gl.uniform4f(p.u.uRiver, rv.intensity, rv.speed, rv.brush, rv.grain);
      gl.uniform4f(p.u.uWind, w.speed, w.height, w.spread, w.abrasion);
      gl.uniform1f(p.u.uMaxDetach, erosion.maxDetach);
      G.drawQuad(p);
    }

    // ── 3 · scatter (accumulate into the exchange atlas, additive) ──
    {
      const maxBrush = Math.max(
        agents.river.on ? agents.river.brush : 0,
        agents.rain.on ? 0.7 : 0,
        agents.wind.on ? 0.55 : 0);
      const foot = Math.max(1, Math.min(4, Math.ceil(maxBrush / state.cell)));
      const p = this.pScatter;
      G.bindFbo('exchange');
      G.viewport(0, 0, aw, ah);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, {
        uTerrain: this.vol.read,
        uPosAge: 'posAge' + this.pRead,
        uMeta: 'meta' + this.pRead,
        uDemand: 'demand',
        uSums: 'sums',
      });
      gl.uniform1f(p.u.uFoot, foot);
      G.drawQuadsInstanced(p, PT[0] * PT[1] * 9);
      gl.disable(gl.BLEND);
    }

    // ── 4 · acceptance (terrain update + per-voxel accept ratios) ──
    {
      const p = this.pAccept;
      G.bindFbo(this.vol.write);
      G.viewport(0, 0, aw, ah);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.G.tex.get('accept'), 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, { uTerrain: this.vol.read, uExchange: 'exchange' });
      gl.uniform1f(p.u.uWetDecay, erosion.wetDecay);
      G.drawQuad(p);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      this.vol.swap();
    }

    // ── 5 · cargo feedback (accepted ratios → species) ──
    {
      const p = this.pFeedback;
      G.bindFbo('species' + this.sWrite);
      G.viewport(0, 0, PT[0], PT[1]);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, {
        uTerrain: this.vol.read,
        uPosAge: 'posAge' + this.pRead,
        uVelWater: 'velWater' + this.pRead,
        uMeta: 'meta' + this.pRead,
        uSpecies: 'species' + this.sRead,
        uAccept: 'accept',
        uDemand: 'demand',
        uSums: 'sums',
      });
      gl.uniform4f(p.u.uEnv, dt, this.step, 0.5, windRad);
      gl.uniform1f(p.u.uAttrition, erosion.attrition);
      G.drawQuad(p);
      this.swapSpecies();
    }

    // ── 6 · distance repair ──
    {
      const p = this.pRepair;
      G.bindFbo(this.vol.write);
      G.viewport(0, 0, aw, ah);
      gl.useProgram(p.p);
      this.setCommon(p);
      this.bind(p, { uTerrain: this.vol.read });
      G.drawQuad(p);
      this.vol.swap();
    }

    // ── 7 · thermal (every 2nd step) ──
    if (thermal && thermal.on && this.step % 2 === 0) {
      const [dx, dz] = [state.dim[0], state.dim[2]];
      const ph = this.pHeight;
      G.bindFbo('height');
      G.viewport(0, 0, dx, dz);
      gl.useProgram(ph.p);
      this.setCommon(ph);
      this.bind(ph, { uTerrain: this.vol.read });
      G.drawQuad(ph);
      const pt = this.pThermal;
      G.bindFbo(this.vol.write);
      G.viewport(0, 0, aw, ah);
      gl.useProgram(pt.p);
      this.setCommon(pt);
      this.bind(pt, { uTerrain: this.vol.read, uHeight: 'height' });
      gl.uniform1f(pt.u.uTalus, Math.tan(thermal.angle * Math.PI / 180));
      gl.uniform1f(pt.u.uRate, thermal.rate);
      G.drawQuad(pt);
      this.vol.swap();
    }

    // ── 8 · flow map: decay then splat wet agents ──
    {
      const writeFlow = this.flowRead === 'flowA' ? 'flowB' : 'flowA';
      const pd = this.pFlowDecay;
      G.bindFbo(writeFlow);
      G.viewport(0, 0, FLOW_RES[0], FLOW_RES[1]);
      gl.useProgram(pd.p);
      gl.uniform1f(pd.u.uDecay, Math.exp(-dt * 0.14));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.G.tex.get(this.flowRead));
      gl.uniform1i(pd.u.uFlow, 0);
      G.drawQuad(pd);
      const ps = this.pFlowSplat;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(ps.p);
      gl.uniform2i(ps.u.uPT, PT[0], PT[1]);
      gl.uniform2f(ps.u.uFlowRes, FLOW_RES[0], FLOW_RES[1]);
      gl.uniform3f(ps.u.uLo, state.lo[0], state.lo[1], state.lo[2]);
      gl.uniform3f(ps.u.uHi, state.hi[0], state.hi[1], state.hi[2]);
      this.bind(ps, { uPosAge: 'posAge' + this.pRead, uVelWater: 'velWater' + this.pRead, uMeta: 'meta' + this.pRead });
      G.drawQuadsInstanced(ps, PT[0] * PT[1]);
      gl.disable(gl.BLEND);
      this.flowRead = writeFlow;
    }
  }

  countParticles() {
    const G = this.G, gl = G.gl;
    const p = this.pCount;
    G.bindFbo('count');
    G.viewport(0, 0, 1, 1);
    gl.useProgram(p.p);
    gl.uniform2i(p.u.uPT, PT[0], PT[1]);
    this.bind(p, { uPosAge: 'posAge' + this.pRead });
    G.drawQuad(p);
    try {
      const buf = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, buf);
      this.alive = buf[0] | 0;
    } catch (e) { /* readback unsupported — keep last value */ }
    return this.alive;
  }
}

export { PT };
