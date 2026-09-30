/**
 * Forward renderer: shadow-mapped sun + analytic sky IBL, procedural material
 * shading, and a separate sorted pass for glass.
 *
 * The important rendering idea for fracture: every vertex carries a `fresh`
 * flag saying whether it belongs to original surface or to a brand new
 * fracture surface. Fresh surfaces shade completely differently — bright
 * unweathered mineral in rock, torn fibres in wood, stress-whitened polymer in
 * plastic, and the mirror/mist/hackle band that makes broken glass edges
 * glitter. That single flag is most of why this reads as "broken" rather than
 * "chopped up".
 */

import { M4, V3, m4, m4LookAt, m4Perspective, m4Ortho, m4mul, v3, norm, mul, add, sub } from '../core/math';
import { GL, GpuMesh, Program } from './gl';
import { DEFORM_GLSL, VatGpu, DentAtlasGpu } from './vat';

export interface DrawItem {
  mesh: GpuMesh;
  model: M4;
  style: number;          // 0 generic, 1 wood, 2 rock/concrete, 3 plastic, 4 glass, 5 crack ribbon
  color: [number, number, number];
  spec: number;
  rough: number;
  seed: number;
  strain: number;         // ductile whitening 0..1
  grain: V3;
  alpha: number;
  mask?: WebGLTexture | null;
  maskSize?: [number, number];
  emissive?: number;
  /** 0 = rigid, 1 = per-vertex VAT, 2 = lattice cage (see render/vat.ts) */
  deform?: number;
}

const COMMON = /* glsl */`
precision highp float;
float hash31(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1,0,0)), n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1)), n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),
             mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
}
float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
vec3 skyColor(vec3 d, vec3 sunDir){
  float t = clamp(d.y*0.5+0.5, 0.0, 1.0);
  vec3 up = vec3(0.34,0.46,0.68);
  vec3 hor = vec3(0.62,0.66,0.72);
  vec3 dn = vec3(0.16,0.15,0.14);
  vec3 c = d.y > 0.0 ? mix(hor, up, pow(d.y,0.55)) : mix(hor, dn, pow(-d.y,0.4));
  float sun = pow(max(dot(d,sunDir),0.0), 700.0);
  float glow = pow(max(dot(d,sunDir),0.0), 8.0);
  c += vec3(1.0,0.92,0.78)*sun*6.0 + vec3(1.0,0.85,0.65)*glow*0.22;
  return c*(0.85+0.3*t);
}
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
`;

export const VS = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2D;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aAttr;
layout(location=3) in float aVid;
uniform mat4 uModel, uViewProj, uLightVP;
${DEFORM_GLSL}
out vec3 vWorld; out vec3 vNrm; out vec3 vAttr; out vec4 vLight; out vec3 vLocal; out float vDmg;
void main(){
  vec3 p = aPos; vec3 nn = aNrm; float dmg;
  applyDeform(p, nn, aVid, dmg);
  vDmg = dmg;
  vec4 w = uModel * vec4(p,1.0);
  vWorld = w.xyz;
  vLocal = p;
  vNrm = mat3(uModel) * nn;
  vAttr = aAttr;
  vLight = uLightVP * w;
  gl_Position = uViewProj * w;
}`;

export const FS = /* glsl */`#version 300 es
${COMMON}
in vec3 vWorld; in vec3 vNrm; in vec3 vAttr; in vec4 vLight; in vec3 vLocal; in float vDmg;
uniform vec3 uCam, uSun, uColor, uGrain;
uniform float uSpec, uRough, uSeed, uStrain, uAlpha, uEmissive;
uniform int uStyle;
uniform sampler2D uShadow;
out vec4 frag;

float shadow(vec3 n){
  vec3 p = vLight.xyz/vLight.w*0.5+0.5;
  if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;
  float bias = max(0.0016*(1.0-dot(n,uSun)), 0.0006);
  float s=0.0; vec2 tx = 1.0/vec2(textureSize(uShadow,0));
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    float d = texture(uShadow, p.xy+vec2(x,y)*tx).r;
    s += (p.z-bias > d)?0.0:1.0;
  }
  return s/9.0;
}

void main(){
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCam - vWorld);
  if(dot(N,V)<0.0 && uStyle==4) N = -N;
  float fresh = vAttr.x;
  float uSeedV = uSeed >= 0.0 ? uSeed : vAttr.z;
  vec3 albedo = uColor;
  float rough = clamp(0.35 + uRough*0.5, 0.05, 1.0);
  float spec = uSpec;
  vec3 emis = vec3(0.0);

  if(uStyle==1){
    // ---- wood: growth rings around the grain axis, torn fibres on breaks
    vec3 g = normalize(uGrain);
    vec3 a1 = normalize(abs(g.y)<0.9? cross(g,vec3(0,1,0)) : cross(g,vec3(1,0,0)));
    vec3 a2 = cross(g,a1);
    vec3 q = vLocal + uSeedV*0.017;
    float along = dot(q,g);
    float r = length(vec2(dot(q,a1),dot(q,a2)));
    float rings = sin(r*230.0 + fbm(q*9.0)*7.0 + along*1.2);
    float late = smoothstep(0.1,0.85,rings);
    albedo = mix(uColor*0.72, uColor*1.22, late);
    float fibre = fbm(vec3(along*260.0, dot(q,a1)*60.0, dot(q,a2)*60.0));
    albedo *= 0.85+0.3*fibre;
    if(fresh>0.5){
      // fresh split: pale, fibrous, strongly streaked along the grain
      float streak = fbm(vec3(along*520.0, dot(q,a1)*30.0, uSeedV));
      albedo = mix(albedo, vec3(0.86,0.72,0.48), 0.55+0.35*streak);
      rough = 0.95;
    }
  } else if(uStyle==2){
    // ---- rock / concrete: matrix + aggregate, bright fresh break faces
    vec3 q = vLocal*1.0 + uSeedV*0.013;
    float grainN = fbm(q*55.0);
    float agg = smoothstep(0.62,0.78, fbm(q*24.0));
    albedo = uColor*(0.72+0.5*grainN);
    albedo = mix(albedo, uColor*vec3(1.35,1.3,1.25), agg*0.55);
    if(fresh>0.5){
      albedo *= 1.28;
      float sparkle = smoothstep(0.80,0.92, fbm(q*180.0));
      spec += sparkle*0.85;
      rough = 0.92;
      albedo += sparkle*0.25;
    } else {
      albedo *= 0.88; rough = 0.95;
    }
  } else if(uStyle==3){
    // ---- plastic: stress whitening (crazing) along torn edges
    float white = fresh*(0.35+0.65*uStrain);
    float cr = fbm(vLocal*160.0+uSeedV);
    albedo = mix(uColor, vec3(0.93,0.93,0.95), clamp(white*(0.55+0.6*cr),0.0,1.0));
    rough = mix(0.28, 0.85, fresh);
  } else if(uStyle==6){
    // ---- automotive paint: metallic basecoat under a clearcoat, and the
    // way that paint dies when the steel under it yields.
    float flake = vnoise(vLocal*820.0);
    float sparkle = pow(flake, 9.0)*0.8;
    albedo = uColor*(0.80+0.34*flake) + sparkle;
    rough = 0.075;
    spec = 1.0;
    float dmg = clamp(vDmg, 0.0, 1.0);
    // Paint has almost no ductility compared with the steel under it: past a
    // few percent plastic strain the clearcoat crazes, then the basecoat
    // flakes off and you see primer and bare metal along the crease.
    float scuff = fbm(vLocal*62.0+uSeedV);
    float craze = smoothstep(0.10, 0.40, dmg);
    float bare  = smoothstep(0.42, 0.95, dmg*(0.55+0.85*scuff));
    albedo = mix(albedo, albedo*0.82, craze);
    albedo = mix(albedo, vec3(0.43,0.44,0.46), bare);
    rough = mix(rough, 0.16, craze);
    rough = mix(rough, 0.45, bare);
    spec = mix(spec, 0.55, bare);
    albedo *= 1.0 - 0.22*smoothstep(0.05, 0.55, dmg);
  } else {
    float n = fbm(vLocal*40.0+uSeedV);
    albedo = uColor*(0.9+0.2*n);
  }

  if(uStyle==5){ // crack ribbon
    float across = abs(vAttr.y*2.0-1.0);
    float core = 1.0-smoothstep(0.0,1.0,across);
    emis = vec3(0.85,0.93,1.0)*core*uEmissive;
    albedo = vec3(0.02);
    frag = vec4(aces(emis), clamp(core*uAlpha,0.0,1.0));
    return;
  }

  float sh = shadow(N);
  vec3 L = uSun;
  vec3 H = normalize(L+V);
  float ndl = max(dot(N,L),0.0);
  float ndh = max(dot(N,H),0.0);
  float ndv = max(dot(N,V),0.0);
  float a = rough*rough;
  float d = (a*a)/(3.14159*pow(ndh*ndh*(a*a-1.0)+1.0,2.0)+1e-5);
  float k = a*0.5;
  float gg = (ndl/(ndl*(1.0-k)+k))*(ndv/(ndv*(1.0-k)+k));
  float f = 0.04 + 0.96*pow(1.0-ndv,5.0);
  vec3 sunCol = vec3(1.0,0.95,0.86)*3.1;
  vec3 diff = albedo*ndl*sunCol*sh;
  vec3 specC = sunCol*d*gg*f*spec*sh;

  // hemispheric sky IBL + bounce
  vec3 skyUp = skyColor(normalize(N+vec3(0.0,0.6,0.0)), uSun);
  vec3 amb = albedo*mix(vec3(0.20,0.22,0.26), skyUp*0.55, 0.65);
  vec3 R = reflect(-V,N);
  vec3 refl = skyColor(R,uSun)*spec*(0.08+0.35*pow(1.0-ndv,3.0));

  vec3 col = diff + specC + amb + refl + emis;
  frag = vec4(aces(col), uAlpha);
}`;

export const FS_GLASS = /* glsl */`#version 300 es
${COMMON}
in vec3 vWorld; in vec3 vNrm; in vec3 vAttr; in vec4 vLight; in vec3 vLocal; in float vDmg;
uniform vec3 uCam, uSun, uColor;
uniform float uSpec, uRough, uSeed, uAlpha, uEmissive;
uniform sampler2D uShadow;
uniform sampler2D uMask;
uniform vec2 uMaskSize;
uniform int uUseMask;
out vec4 frag;

void main(){
  float uSeedV = uSeed >= 0.0 ? uSeed : vAttr.z;
  if(uUseMask==1){
    vec2 uv = vLocal.xy/uMaskSize + 0.5;
    if(texture(uMask, uv).r > 0.5) discard;
  }
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCam - vWorld);
  if(dot(N,V)<0.0) N = -N;
  float fresh = vAttr.x;

  vec3 R = reflect(-V,N);
  vec3 env = skyColor(R, uSun);
  float ndv = max(dot(N,V),0.0);
  // Schlick fresnel, n = 1.52 -> F0 = 0.043
  float F = 0.043 + 0.957*pow(1.0-ndv,5.0);

  // Refracted background: cheap, just the sky bent through the slab.
  vec3 T = refract(-V, N, 1.0/1.52);
  vec3 back = skyColor(normalize(T+vec3(0.0,-0.15,0.0)), uSun)*0.55;

  vec3 tint = uColor;
  vec3 col = mix(back*tint, env, F);
  float alpha = mix(0.16, 0.95, F);

  if(fresh > 0.5){
    // Fracture surface: the mirror-mist-hackle bands. Near the origin the
    // surface is optically flat (mirror), then it roughens, and the hackle
    // scatters light strongly -> bright, almost opaque glittering edges.
    float band = fbm(vLocal*vec3(900.0,900.0,260.0)+uSeedV);
    float hackle = smoothstep(0.42,0.72,band);
    float mist = smoothstep(0.30,0.55,band);
    vec3 scatter = vec3(0.92,0.96,1.0)*(0.35+0.85*hackle);
    col = mix(col*1.1, scatter, 0.45+0.45*mist);
    alpha = clamp(alpha + 0.45 + 0.35*hackle, 0.0, 1.0);
    // specular glint off the hackle
    vec3 H = normalize(uSun+V);
    col += vec3(1.0)*pow(max(dot(N,H),0.0), 60.0)*1.6*hackle;
  }

  // edge caustic-ish brightening
  col += vec3(0.6,0.75,0.9)*pow(1.0-ndv,6.0)*0.5;
  frag = vec4(aces(col*1.0), clamp(alpha*uAlpha,0.0,1.0));
}`;

export const VS_SHADOW = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2D;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=3) in float aVid;
uniform mat4 uModel, uLightVP;
${DEFORM_GLSL}
void main(){
  vec3 p = aPos; vec3 nn = aNrm; float dmg;
  applyDeform(p, nn, aVid, dmg);
  gl_Position = uLightVP * uModel * vec4(p,1.0);
}`;
export const FS_SHADOW = /* glsl */`#version 300 es
precision highp float; out vec4 f; void main(){ f=vec4(1.0); }`;

const VS_SKY = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uInvViewProj; uniform vec3 uCam;
out vec3 vDir;
void main(){
  vec4 p = uInvViewProj*vec4(aPos.xy,1.0,1.0);
  vDir = p.xyz/p.w - uCam;
  gl_Position = vec4(aPos.xy,1.0,1.0);
}`;
const FS_SKY = /* glsl */`#version 300 es
${COMMON}
in vec3 vDir; uniform vec3 uSun; out vec4 frag;
void main(){ frag = vec4(aces(skyColor(normalize(vDir), uSun)*0.9), 1.0); }`;

const VS_GROUND = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj, uLightVP;
out vec3 vWorld; out vec4 vLight;
void main(){ vWorld=aPos; vLight=uLightVP*vec4(aPos,1.0); gl_Position=uViewProj*vec4(aPos,1.0); }`;
const FS_GROUND = /* glsl */`#version 300 es
${COMMON}
in vec3 vWorld; in vec4 vLight;
uniform vec3 uSun, uCam; uniform sampler2D uShadow;
out vec4 frag;
void main(){
  vec3 N = vec3(0,1,0);
  vec3 p = vLight.xyz/vLight.w*0.5+0.5;
  float sh=1.0;
  if(!(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0)){
    float s=0.0; vec2 tx=1.0/vec2(textureSize(uShadow,0));
    for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
      float d=texture(uShadow,p.xy+vec2(x,y)*tx).r;
      s += (p.z-0.0012 > d)?0.0:1.0;
    }
    sh = s/25.0;
  }
  float g = fbm(vWorld*3.0)*0.12;
  vec3 base = vec3(0.20,0.205,0.215)*(0.85+g);
  float grid = 0.0;
  vec2 q = abs(fract(vWorld.xz*1.0)-0.5);
  grid = smoothstep(0.49,0.5,max(q.x,q.y))*0.08;
  base += grid;
  float ndl = max(dot(N,uSun),0.0);
  vec3 col = base*(vec3(1.0,0.95,0.86)*2.2*ndl*sh + vec3(0.20,0.23,0.28));
  float fog = 1.0-exp(-length(vWorld-uCam)*0.012);
  col = mix(col, skyColor(normalize(vWorld-uCam), uSun)*0.8, clamp(fog,0.0,0.85));
  frag = vec4(aces(col),1.0);
}`;

export class Renderer {
  gl: GL;
  progMain: Program; progGlass: Program; progShadow: Program; progSky: Program; progGround: Program;
  shadowFB: WebGLFramebuffer; shadowTex: WebGLTexture; shadowSize = 2048;
  quadVao: WebGLVertexArrayObject;
  groundVao: WebGLVertexArrayObject;
  viewProj = m4(); lightVP = m4(); invViewProj = m4();
  sun: V3 = norm(v3(0.55, 0.78, 0.32));
  camPos: V3 = v3(0, 2, 6);
  /** baked-deformation textures, set by the scene that owns them */
  vat: VatGpu | null = null;
  /** portable dent library (frac/dentmap.ts), shared by every deformable mesh */
  dentAtlas: DentAtlasGpu | null = null;
  dents: Float32Array<ArrayBufferLike> = new Float32Array(0);
  dentCount = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance',
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 is required.');
    this.gl = gl;
    this.progMain = new Program(gl, VS, FS);
    this.progGlass = new Program(gl, VS, FS_GLASS);
    this.progShadow = new Program(gl, VS_SHADOW, FS_SHADOW);
    this.progSky = new Program(gl, VS_SKY, FS_SKY);
    this.progGround = new Program(gl, VS_GROUND, FS_GROUND);

    // shadow map
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const fbs = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fbs !== gl.FRAMEBUFFER_COMPLETE) console.warn('shadow FBO incomplete', fbs);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // fullscreen quad
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // ground
    this.groundVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVao);
    const gb = gl.createBuffer()!;
    const S = 60;
    gl.bindBuffer(gl.ARRAY_BUFFER, gb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -S, 0, -S, S, 0, -S, S, 0, S, -S, 0, -S, S, 0, S, -S, 0, S,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize(): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  setCamera(pos: V3, target: V3, fov: number): void {
    this.camPos = pos;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = m4Perspective(fov, aspect, 0.03, 200);
    const view = m4LookAt(pos, target, v3(0, 1, 0));
    m4mul(proj, view, this.viewProj);
    // light matrix focused on the action
    const c = target;
    const eye = add(c, mul(this.sun, 14));
    const lv = m4LookAt(eye, c, v3(0, 1, 0));
    const lp = m4Ortho(-6, 6, -6, 6, 0.5, 34);
    m4mul(lp, lv, this.lightVP);
    // inverse view-proj for the sky
    const inv = m4();
    invert(this.viewProj, inv);
    this.invViewProj = inv;
  }

  render(opaque: DrawItem[], glass: DrawItem[]): void {
    const gl = this.gl;

    // ---- shadow pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.drawBuffers([gl.NONE]);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.colorMask(false, false, false, false);
    this.progShadow.use();
    this.progShadow.m4('uLightVP', this.lightVP);
    for (const it of opaque) {
      this.bindDeform(this.progShadow, it.deform ?? 0);
      this.progShadow.m4('uModel', it.model);
      gl.bindVertexArray(it.mesh.vao);
      if (it.mesh.indexed) gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
    }
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);

    // ---- main pass
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.05, 0.06, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.depthMask(false);
    this.progSky.use();
    this.progSky.m4('uInvViewProj', this.invViewProj);
    this.progSky.v3('uCam', this.camPos.x, this.camPos.y, this.camPos.z);
    this.progSky.v3('uSun', this.sun.x, this.sun.y, this.sun.z);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // ground
    this.progGround.use();
    this.progGround.m4('uViewProj', this.viewProj);
    this.progGround.m4('uLightVP', this.lightVP);
    this.progGround.v3('uSun', this.sun.x, this.sun.y, this.sun.z);
    this.progGround.v3('uCam', this.camPos.x, this.camPos.y, this.camPos.z);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    this.progGround.i('uShadow', 0);
    gl.bindVertexArray(this.groundVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // opaque
    const p = this.progMain;
    p.use();
    p.m4('uViewProj', this.viewProj);
    p.m4('uLightVP', this.lightVP);
    p.v3('uCam', this.camPos.x, this.camPos.y, this.camPos.z);
    p.v3('uSun', this.sun.x, this.sun.y, this.sun.z);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    p.i('uShadow', 0);
    gl.disable(gl.BLEND);
    for (const it of opaque) this.drawWith(p, it);

    // glass + ribbons, sorted back to front
    const sorted = glass.slice().sort((a, b) => depth(b, this.camPos) - depth(a, this.camPos));
    const pg = this.progGlass;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (const it of sorted) {
      if (it.style === 5) {
        p.use();
        p.m4('uViewProj', this.viewProj);
        p.m4('uLightVP', this.lightVP);
        p.v3('uCam', this.camPos.x, this.camPos.y, this.camPos.z);
        p.v3('uSun', this.sun.x, this.sun.y, this.sun.z);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
        p.i('uShadow', 0);
        this.drawWith(p, it);
        continue;
      }
      pg.use();
      pg.m4('uViewProj', this.viewProj);
      pg.m4('uLightVP', this.lightVP);
      pg.v3('uCam', this.camPos.x, this.camPos.y, this.camPos.z);
      pg.v3('uSun', this.sun.x, this.sun.y, this.sun.z);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      pg.i('uShadow', 0);
      if (it.mask) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, it.mask);
        pg.i('uMask', 1);
        pg.i('uUseMask', 1);
        pg.v2('uMaskSize', it.maskSize![0], it.maskSize![1]);
      } else {
        pg.i('uUseMask', 0);
      }
      this.drawWith(pg, it);
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Bind the vertex-animation textures + the active dent list. */
  private bindDeform(p: Program, mode: number): void {
    const gl = this.gl;
    const vat = this.vat;
    const atlas = this.dentAtlas;
    const nDent = atlas ? atlas.count : 0;
    if (mode === 0 || (!vat && !atlas)) { p.i('uDefMode', 0); p.i('uDefCount', 0); p.i('uDentCount', 0); return; }
    p.i('uDefMode', mode);
    p.i('uDentCount', nDent);
    if (atlas && nDent > 0) {
      p.i('uDentRes', atlas.atlas.res);
      p.i('uDentFrames', atlas.atlas.frames);
      p.v4v('uDentA', atlas.A); p.v4v('uDentB', atlas.B);
      p.v4v('uDentC', atlas.C); p.v4v('uDentD', atlas.D);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, atlas.posTex); p.i('uDentPos', 6);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, atlas.nrmTex); p.i('uDentNrm', 7);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (!vat || this.dentCount === 0) { p.i('uDefCount', 0); p.i('uTexW', 2048); return; }
    p.i('uDefCount', this.dentCount);
    p.i('uDefFrames', vat.rig.frames);
    p.i('uTexW', 2048);
    p.i('uVerts', vat.rig.shell.n);
    p.i('uCageNodes', vat.rig.cage.nodes);
    p.v3v('uDent', this.dents);
    p.v4v('uSiteInfo', vat.siteInfo);
    const c = vat.rig.cage;
    p.v3('uCageMin', c.min.x, c.min.y, c.min.z);
    p.v3('uCageSize', c.size.x, c.size.y, c.size.z);
    p.v3('uCageDim', c.nx, c.ny, c.nz);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, vat.posTex); p.i('uVatPos', 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, vat.nrmTex); p.i('uVatNrm', 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, vat.slotTex); p.i('uVatSlot', 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, vat.cageTex); p.i('uCageTex', 5);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawWith(p: Program, it: DrawItem): void {
    const gl = this.gl;
    this.bindDeform(p, it.deform ?? 0);
    p.m4('uModel', it.model);
    p.v3('uColor', it.color[0], it.color[1], it.color[2]);
    p.f('uSpec', it.spec);
    p.f('uRough', it.rough);
    p.f('uSeed', it.seed);
    p.f('uStrain', it.strain);
    p.f('uAlpha', it.alpha);
    p.f('uEmissive', it.emissive ?? 1.0);
    p.i('uStyle', it.style);
    p.v3('uGrain', it.grain.x, it.grain.y, it.grain.z);
    gl.bindVertexArray(it.mesh.vao);
    if (it.mesh.indexed) gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
  }
}

function depth(it: DrawItem, cam: V3): number {
  const p = v3(it.model[12], it.model[13], it.model[14]);
  return len2(sub(p, cam));
}
const len2 = (a: V3) => a.x * a.x + a.y * a.y + a.z * a.z;

function invert(m: M4, out: M4): M4 {
  // 4x4 general inverse (same as math.m4Invert, duplicated to avoid a cycle)
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}
