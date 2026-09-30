/**
 * GPU side of the baked deformation: vertex-animation textures.
 *
 * Three textures:
 *   uVatPos   RGBA32F   xyz = vertex displacement, w = plastic strain
 *   uVatNrm   RGBA32F   xyz = recomputed normal
 *   uVatSlot  R32F      per (site, vertex): slot+1 inside that site's patch,
 *                       or 0 if the vertex is outside it
 * plus
 *   uCageTex  RGBA32F   the same bake fitted to a deformation lattice, which
 *                       deforms *any* mesh bound to the cage (lights, glass,
 *                       trim, LODs) without needing its own bake.
 *
 * Everything is addressed with texelFetch on a linear index unwrapped to a
 * 2048-wide texture, so there is no filtering, no precision surprise and no
 * limit on vertex count beyond total texels.
 */

import { GL } from './gl';
import { CarRig, MAX_ACTIVE } from '../app/carrig';

export const TEXW = 2048;
export const MAX_SITES = 16;

/** GLSL shared by the main and shadow vertex shaders. */
export const DEFORM_GLSL = /* glsl */`
uniform sampler2D uVatPos, uVatNrm, uVatSlot, uCageTex;
uniform int uDefMode;        // 0 = none, 1 = per-vertex VAT, 2 = lattice cage
uniform int uDefCount, uDefFrames, uTexW, uVerts, uCageNodes;
uniform vec3 uDent[${MAX_ACTIVE}];       // x = site, y = frame cursor, z = amplitude
uniform vec4 uSiteInfo[${MAX_SITES}];    // x = vat base texel, y = patch size, z = cage base
uniform vec3 uCageMin, uCageSize, uCageDim;

vec4 vatFetch(sampler2D t, int idx){
  return texelFetch(t, ivec2(idx % uTexW, idx / uTexW), 0);
}

vec3 cageSample(vec3 p, int base, out float dmg){
  vec3 f = clamp((p - uCageMin) / uCageSize, 0.0, 1.0) * uCageDim;
  vec3 i0 = min(floor(f), uCageDim - 1.0);
  vec3 t = f - i0;
  float sx = uCageDim.x + 1.0, sy = uCageDim.y + 1.0;
  vec3 acc = vec3(0.0);
  dmg = 0.0;
  for(int a=0;a<2;a++) for(int b=0;b<2;b++) for(int c=0;c<2;c++){
    float w = (a==1 ? t.x : 1.0-t.x) * (b==1 ? t.y : 1.0-t.y) * (c==1 ? t.z : 1.0-t.z);
    if(w <= 0.0) continue;
    float id = ((i0.z + float(c)) * sy + (i0.y + float(b))) * sx + (i0.x + float(a));
    vec4 d = vatFetch(uCageTex, base + int(id));
    acc += d.xyz * w;
    dmg += d.w * w;
  }
  return acc;
}

void applyDeform(inout vec3 pos, inout vec3 nrm, float vid, out float dmg){
  dmg = 0.0;
  if(uDefMode == 0 || uDefCount == 0) return;
  vec3 p0 = pos, dp = vec3(0.0), dn = vec3(0.0);
  for(int k=0;k<${MAX_ACTIVE};k++){
    if(k >= uDefCount) break;
    int si = int(uDent[k].x);
    float fr = uDent[k].y;
    float amp = uDent[k].z;
    int f0 = int(floor(fr));
    int f1 = min(f0 + 1, uDefFrames - 1);
    float tt = fr - float(f0);
    vec4 info = uSiteInfo[si];
    if(uDefMode == 1){
      float slot = vatFetch(uVatSlot, si * uVerts + int(vid)).r;
      if(slot < 0.5) continue;                 // vertex not in this dent's patch
      int s0 = int(slot) - 1;
      int base = int(info.x);
      int P = int(info.y);
      vec4 a = vatFetch(uVatPos, base + f0 * P + s0);
      vec4 b = vatFetch(uVatPos, base + f1 * P + s0);
      vec4 d = mix(a, b, tt);
      dp += d.xyz * amp;
      dmg = max(dmg, d.w * amp);
      vec3 na = vatFetch(uVatNrm, base + f0 * P + s0).xyz;
      vec3 nb = vatFetch(uVatNrm, base + f1 * P + s0).xyz;
      dn += (normalize(mix(na, nb, tt)) - nrm) * amp;
    } else {
      int cb = int(info.z);
      float d0, d1;
      vec3 c0 = cageSample(p0, cb + f0 * uCageNodes, d0);
      vec3 c1 = cageSample(p0, cb + f1 * uCageNodes, d1);
      dp += mix(c0, c1, tt) * amp;
      dmg = max(dmg, mix(d0, d1, tt) * amp);
    }
  }
  pos = p0 + dp;
  nrm = normalize(nrm + dn);
}
`;

interface SiteSlot { base: number; count: number; cageBase: number; }

const pad = (texels: number) => Math.max(TEXW, Math.ceil(texels / TEXW) * TEXW);

export class VatGpu {
  posTex: WebGLTexture;
  nrmTex: WebGLTexture;
  slotTex: WebGLTexture;
  cageTex: WebGLTexture;
  siteInfo = new Float32Array(MAX_SITES * 4);
  texels = 0;
  private slots: (SiteSlot | null)[];
  private posData: Float32Array;
  private nrmData: Float32Array;
  private slotData: Float32Array;
  private cageData: Float32Array;
  private uploaded = -1;

  constructor(public gl: GL, public rig: CarRig) {
    const n = rig.shell.n;
    const sites = rig.sites.length;
    this.slots = new Array(sites).fill(null);
    // grows on demand; a dent patch is usually 5-20 % of the body
    const cap = pad(Math.ceil(n * 0.12) * rig.frames * sites);
    this.posData = new Float32Array(cap * 4);
    this.nrmData = new Float32Array(cap * 4);
    this.slotData = new Float32Array(pad(n * sites));
    this.cageData = new Float32Array(pad(rig.cage.nodes * rig.frames * sites) * 4);

    const mk = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.posTex = mk(); this.nrmTex = mk(); this.slotTex = mk(); this.cageTex = mk();
    this.uploadAll();
  }

  private grow(need: number): void {
    if (need * 4 <= this.posData.length) return;
    let cap = this.posData.length / 4;
    while (cap < need) cap *= 2;
    cap = pad(cap);
    const p = new Float32Array(cap * 4); p.set(this.posData); this.posData = p;
    const q = new Float32Array(cap * 4); q.set(this.nrmData); this.nrmData = q;
  }

  private uploadAll(): void {
    const gl = this.gl;
    const up = (t: WebGLTexture, ifmt: number, fmt: number, data: Float32Array, comps: number) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, TEXW, data.length / comps / TEXW, 0, fmt, gl.FLOAT, data);
    };
    up(this.posTex, gl.RGBA32F, gl.RGBA, this.posData, 4);
    up(this.nrmTex, gl.RGBA32F, gl.RGBA, this.nrmData, 4);
    up(this.cageTex, gl.RGBA32F, gl.RGBA, this.cageData, 4);
    up(this.slotTex, gl.R32F, gl.RED, this.slotData, 1);
  }

  /** Push any sites that were baked since the last call. */
  sync(): void {
    if (this.uploaded === this.rig.revision) return;
    this.uploaded = this.rig.revision;
    const n = this.rig.shell.n;
    let dirty = false;
    for (let i = 0; i < this.rig.sites.length; i++) {
      const st = this.rig.sites[i];
      if (!st.bake || this.slots[i]) continue;
      const P = st.bake.count;
      const frames = this.rig.frames;
      const base = this.texels;
      const cageBase = i * frames * this.rig.cage.nodes;
      this.grow(base + P * frames);
      this.slots[i] = { base, count: P, cageBase };
      this.posData.set(st.bake.pos, base * 4);
      this.nrmData.set(st.bake.nrm, base * 4);
      if (st.cage) this.cageData.set(st.cage, cageBase * 4);
      for (let k = 0; k < P; k++) this.slotData[i * n + st.bake.verts[k]] = k + 1;
      this.texels += P * frames;
      this.siteInfo[i * 4] = base;
      this.siteInfo[i * 4 + 1] = P;
      this.siteInfo[i * 4 + 2] = cageBase;
      st.uploaded = true;
      dirty = true;
    }
    if (dirty) this.uploadAll();
  }

  megabytes(): number {
    return (this.posData.length + this.nrmData.length + this.slotData.length + this.cageData.length)
      * 4 / (1024 * 1024);
  }
}
