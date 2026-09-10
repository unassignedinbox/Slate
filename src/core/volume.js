// Volume atlas — ping-pong RGBA32F atlas of Z-slices holding the SDF terrain.
// Channels: R distance · G wetness · B cumulative deposited · A solid fraction.
import { FULLSCREEN_VS } from './glutil.js';
import { state, ATLAS_COLS } from './config.js';
import { bakeFS } from './glsl/bake.js';
import { ATLAS_GLSL } from './glsl/common.js';

export class Volume {
  constructor(glutil) {
    this.G = glutil;
    const gl = glutil.gl;
    this.buildTextures();
    this.progCopy = glutil.program('volCopy', FULLSCREEN_VS, `#version 300 es
precision highp float; precision highp sampler2D;
${ATLAS_GLSL}
uniform sampler2D uSrc;
out vec4 outT;
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  outT = texelFetch(uSrc, uv, 0);
}`, 'volCopy');
  }

  atlasSize() {
    const [nx, ny, nz] = state.dim;
    return [nx * ATLAS_COLS, Math.ceil(nz / ATLAS_COLS) * ny];
  }

  buildTextures() {
    const G = this.G;
    const [w, h] = this.atlasSize();
    G.tex2D('terrainA', w, h, G.gl.RGBA32F, G.gl.RGBA, G.gl.FLOAT);
    G.tex2D('terrainB', w, h, G.gl.RGBA32F, G.gl.RGBA, G.gl.FLOAT);
    G.fbo('terrainA', [G.tex.get('terrainA')]);
    G.fbo('terrainB', [G.tex.get('terrainB')]);
    this.read = 'terrainA';
    this.write = 'terrainB';
  }

  swap() { const t = this.read; this.read = this.write; this.write = t; }
  tex() { return this.G.tex.get(this.read); }
  fbo() { return this.G.fbos.get(this.write); }
  size() { return this.atlasSize(); }

  // Bake the analytic scene into the write target, then swap.
  bake(sceneBody, extraUniforms, uniforms) {
    const G = this.G;
    const [w, h] = this.size();
    const prog = G.program('bake', FULLSCREEN_VS, bakeFS(sceneBody, extraUniforms || ''), 'bake');
    G.bindFbo(this.write);
    G.viewport(0, 0, w, h);
    G.gl.disable(G.gl.BLEND);
    G.gl.useProgram(prog.p);
    this.setCommon(prog);
    if (extraUniforms && uniforms) uniforms(prog.u);
    G.drawQuad(prog);
    this.swap();
  }

  setCommon(prog) {
    const gl = this.G.gl;
    const u = prog.u;
    gl.uniform3i(u.uDim, state.dim[0], state.dim[1], state.dim[2]);
    gl.uniform3f(u.uLo, state.lo[0], state.lo[1], state.lo[2]);
    gl.uniform3f(u.uHi, state.hi[0], state.hi[1], state.hi[2]);
    gl.uniform1f(u.uCell, state.cell);
    const s = this.size();
    gl.uniform2i(u.uAtlasSize, s[0], s[1]);
  }

  // Copy read → write (initial state).
  copyToWrite() {
    const G = this.G;
    const [w, h] = this.size();
    G.bindFbo(this.write);
    G.viewport(0, 0, w, h);
    G.gl.disable(G.gl.BLEND);
    const p = this.progCopy;
    G.gl.useProgram(p.p);
    G.gl.activeTexture(G.gl.TEXTURE0);
    G.gl.bindTexture(G.gl.TEXTURE_2D, this.tex());
    G.gl.uniform1i(p.u.uSrc, 0);
    this.setCommon(p);
    G.drawQuad(p);
    this.swap();
  }

  clearWrite(value = [0, 0, 0, 0]) {
    const G = this.G;
    G.bindFbo(this.write);
    G.gl.clearBufferfv(G.gl.COLOR, 0, value);
    this.swap();
  }
}
