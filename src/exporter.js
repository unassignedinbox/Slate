// Exporter — screenshots, encoded 16-bit heightmaps, flow maps, graph save/load.
import { state } from './core/config.js';
import { FULLSCREEN_VS } from './core/glutil.js';
import { ATLAS_GLSL } from './core/glsl/common.js';

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export class Exporter {
  constructor(app) {
    this.app = app;
  }

  screenshot() {
    this.app.renderer.render(this.app.time);
    const cv = this.app.G.canvas;
    cv.toBlob((b) => download(`slate-view-${Date.now()}.png`, b), 'image/png');
    this.app.toast('Screenshot saved');
  }

  // Top-surface heightfield, 16-bit height packed into R/G channels of an 8-bit PNG.
  heightmap() {
    const G = this.app.G, gl = G.gl;
    const [dx, , dz] = state.dim;
    const prog = G.program('exportH', FULLSCREEN_VS, `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${ATLAS_GLSL}
uniform sampler2D uTerrain;
layout(location=0) out vec4 outH;
void main(){
  ivec2 col = ivec2(gl_FragCoord.xy);
  float top = uLo.y - 2.0;
  for(int y = uDim.y - 1; y >= 0; y--){
    vec4 t = texelFetch(uTerrain, atlasAddr(ivec3(col.x, y, col.y)), 0);
    if(t.a > 0.5){ top = uLo.y + (float(y) + 0.5) * uCell; break; }
  }
  float h = clamp((top - uLo.y) / (uHi.y - uLo.y), 0.0, 1.0);
  outH = vec4(h, h, h, 1.0);
}`, 'exportH');
    G.tex2D('exportH', dx, dz, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    G.fbo('exportH', [G.tex.get('exportH')]);
    G.bindFbo('exportH');
    G.viewport(0, 0, dx, dz);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    this.app.vol.setCommon(prog);
    gl.uniform3i(prog.u.uDim, state.dim[0], state.dim[1], state.dim[2]);
    gl.uniform3f(prog.u.uLo, state.lo[0], state.lo[1], state.lo[2]);
    gl.uniform3f(prog.u.uHi, state.hi[0], state.hi[1], state.hi[2]);
    gl.uniform1f(prog.u.uCell, state.cell);
    const s = this.app.vol.size();
    gl.uniform2i(prog.u.uAtlasSize, s[0], s[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.app.vol.tex());
    gl.uniform1i(prog.u.uTerrain, 0);
    G.drawQuad(prog);
    const px = new Float32Array(dx * dz * 4);
    gl.readPixels(0, 0, dx, dz, gl.RGBA, gl.FLOAT, px);
    // encode 16-bit into RGB (r = hi byte, g = lo byte)
    const img = new Uint8Array(dx * dz * 4);
    for (let i = 0; i < dx * dz; i++) {
      let v = px[i * 4];
      if (px[i * 4 + 1] > 0.5) { /* no top found — keep raw */ }
      const h16 = Math.round(Math.min(Math.max(v, 0), 1) * 65535);
      img[i * 4] = (h16 >> 8) & 255;
      img[i * 4 + 1] = h16 & 255;
      img[i * 4 + 2] = 0;
      img[i * 4 + 3] = 255;
    }
    const cv = document.createElement('canvas');
    cv.width = dx; cv.height = dz;
    const ctx = cv.getContext('2d');
    const idata = ctx.createImageData(dx, dz);
    idata.data.set(img);
    ctx.putImageData(idata, 0, 0);
    cv.toBlob((b) => download(`slate-height-${dx}x${dz}-16bit.png`, b), 'image/png');
    this.app.toast(`Heightmap ${dx}×${dz} exported (16-bit in R/G)`);
  }

  flowmap() {
    const G = this.app.G, gl = G.gl;
    const [fw, fh] = [512, 512];
    G.tex2D('exportF', fw, fh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    G.fbo('exportF', [G.tex.get('exportF')]);
    G.bindFbo('exportF');
    G.viewport(0, 0, fw, fh);
    const prog = G.program('exportF', FULLSCREEN_VS, `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uFlow;
out vec4 outC;
void main(){
  vec2 uv = gl_FragCoord.xy / vec2(${fw}.0, ${fh}.0);
  vec4 f = texture(uFlow, uv);
  float mag = clamp(f.z * 2.2, 0.0, 1.0);
  vec2 dir = length(f.xy) > 1e-5 ? normalize(f.xy) * 0.5 + 0.5 : vec2(0.5);
  outC = vec4(dir, mag, 1.0);
}`, 'exportF');
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.tex.get(this.app.sim.flowRead));
    gl.uniform1i(prog.u.uFlow, 0);
    G.drawQuad(prog);
    const px = new Uint8Array(fw * fh * 4);
    gl.readPixels(0, 0, fw, fh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // flip Y (GL origin bottom-left)
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    const ctx = cv.getContext('2d');
    const idata = ctx.createImageData(fw, fh);
    for (let y = 0; y < fh; y++) {
      idata.data.set(px.subarray((fh - 1 - y) * fw * 4, (fh - y) * fw * 4), y * fw * 4);
    }
    ctx.putImageData(idata, 0, 0);
    cv.toBlob((b) => download(`slate-flow-${fw}x${fh}.png`, b), 'image/png');
    this.app.toast('Flow map exported (R/G direction · B magnitude)');
  }

  saveGraph() {
    const app = this.app;
    const data = {
      format: 'slate-graph', version: 1,
      nodes: app.graph.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params, enabled: n.enabled })),
      links: app.graph.links,
      erosion: app.erosion,
      water: app.renderer.opts.waterLevel,
      sun: app.renderer.sun,
      quality: state.quality,
    };
    download(`slate-graph-${Date.now()}.slate`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    app.toast('Graph saved');
  }

  loadGraph(file) {
    const app = this.app;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      if (data.format !== 'slate-graph') throw new Error('not a slate graph');
      app.graph.nodes = data.nodes.map(n => ({ ...n }));
      app.graph.links = data.links.map(l => ({ ...l }));
      Object.assign(app.erosion, data.erosion || {});
      if (typeof data.water === 'number') app.renderer.opts.waterLevel = data.water;
      if (data.sun) Object.assign(app.renderer.sun, data.sun);
      app.graph.emit();
      app.rebuild();
      app.toast('Graph loaded');
    }).catch((e) => app.toast('Load failed: ' + e.message, true));
  }
}
