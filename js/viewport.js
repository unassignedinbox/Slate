// Three.js viewport: terrain / water / river / particle rendering + camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TERRAIN_VERT = /* glsl */`
attribute float aFlow; attribute float aSed; attribute float aHard; attribute float aAO;
varying vec3 vW; varying vec3 vN; varying vec4 vA;
void main(){
  vW = position; vN = normal; vA = vec4(aFlow, aSed, aHard, aAO);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TERRAIN_FRAG = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN; varying vec4 vA;
uniform vec3 uSun; uniform vec3 uCam; uniform vec3 uFog;
uniform float uFlowMax, uSedMax, uWaterY, uTime, uHx, uSliceY, uSlice;
uniform int uMode;
uniform sampler2D uFlowTex;
vec3 ramp(float t, vec3 c0, vec3 c1, vec3 c2){
  return t < 0.5 ? mix(c0, c1, t*2.0) : mix(c1, c2, (t-0.5)*2.0);
}
void main(){
  if (uSlice > 0.5 && vW.y > uSliceY) discard;
  vec3 N = normalize(vN);
  float slope = clamp(1.0 - N.y, 0.0, 1.2);
  float h = vW.y;
  float flowN = clamp(vA.x / max(1e-5, uFlowMax), 0.0, 1.0);
  float sedN = clamp(vA.y / max(1e-5, uSedMax), 0.0, 1.0);
  vec3 V = normalize(uCam - vW);
  vec3 col;
  if (uMode == 1){ // clay
    float dif = max(dot(N, normalize(uSun)), 0.0);
    col = vec3(0.62) * (0.25 + 0.85*dif) * mix(0.35, 1.0, vA.w);
  } else if (uMode == 2){ // height
    col = ramp(clamp(h/80.0,0.0,1.0), vec3(0.05,0.1,0.35), vec3(0.1,0.6,0.4), vec3(0.95,0.9,0.8));
  } else if (uMode == 3){ // slope
    col = ramp(clamp(slope,0.0,1.0), vec3(0.05,0.35,0.1), vec3(0.9,0.8,0.2), vec3(0.9,0.15,0.1));
  } else if (uMode == 4){ // flow
    col = mix(vec3(0.02,0.03,0.05), vec3(0.1,0.8,1.0), pow(flowN, 0.5));
    col = mix(col, vec3(1.0,0.9,0.4), pow(sedN,0.6)*0.7);
  } else if (uMode == 5){ // hardness
    col = ramp(vA.z, vec3(0.4,0.2,0.6), vec3(0.2,0.5,0.8), vec3(0.9,0.9,0.9));
  } else if (uMode == 6){ // normal
    col = N * 0.5 + 0.5;
  } else { // full
    float band = 0.5 + 0.5*sin(h*1.35 + vW.x*0.03 + vW.z*0.021);
    vec3 rock = mix(vec3(0.30,0.24,0.20), vec3(0.46,0.37,0.29), band);
    vec3 rockDark = vec3(0.15,0.12,0.11);
    vec3 grass = mix(vec3(0.16,0.34,0.12), vec3(0.32,0.46,0.16), band);
    vec3 sand = vec3(0.74,0.66,0.49);
    vec3 snow = vec3(0.88,0.91,0.94);
    vec3 silt = vec3(0.48,0.40,0.29);
    vec3 alb = mix(grass, rock, smoothstep(0.22, 0.5, slope));
    alb = mix(alb, rockDark, smoothstep(0.5, 0.95, slope));
    float beach = (1.0 - smoothstep(0.5, 3.2, abs(h - uWaterY))) * (1.0 - smoothstep(0.35, 0.65, slope));
    alb = mix(alb, sand, clamp(beach,0.0,1.0)*0.9);
    alb = mix(alb, snow, smoothstep(46.0, 60.0, h + (1.0-min(slope,1.0))*10.0));
    alb = mix(alb, silt, clamp(sedN*0.85, 0.0, 0.85));
    alb *= 0.72 + 0.55*vA.z;
    float wet = clamp(flowN*1.6, 0.0, 1.0);
    float under = h < uWaterY ? clamp((uWaterY-h)*0.2, 0.0, 0.75) : 0.0;
    wet = max(wet, under > 0.0 ? 1.0 : 0.0);
    alb *= (1.0 - wet*0.42);
    alb = mix(alb, vec3(0.10,0.24,0.27), under);
    vec3 L = normalize(uSun);
    float dif = max(dot(N, L), 0.0);
    vec3 hemi = mix(vec3(0.16,0.20,0.28), vec3(0.48,0.52,0.58), N.y*0.5+0.5);
    vec3 Hv = normalize(L + V);
    float spec = pow(max(dot(N, Hv), 0.0), 70.0) * (0.04 + wet*0.7);
    float ao = mix(0.32, 1.0, vA.w);
    col = alb * (hemi*ao + vec3(1.15,1.05,0.92)*dif*ao) + vec3(1.0,0.95,0.85)*spec;
    // flow-following sparkle streaks
    vec2 fuv = vW.xz / uHx * 0.5 + 0.5;
    vec4 fq = texture2D(uFlowTex, fuv);
    if (flowN > 0.01) {
      vec2 fdir = fq.gb*2.0 - 1.0;
      float streak = 0.5 + 0.5*sin(dot(vW.xz, vec2(-fdir.y, fdir.x))*1.6 - uTime*(2.0+6.0*fq.r));
      col += vec3(0.08,0.25,0.3) * flowN * (0.3 + 0.7*streak);
    }
  }
  float dist = length(uCam - vW);
  float fog = 1.0 - exp(-dist*dist*2.6e-6);
  col = mix(col, uFog, clamp(fog,0.0,1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VERT = `
varying vec3 vW;
void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WATER_FRAG = /* glsl */`
precision highp float;
varying vec3 vW;
uniform vec3 uSun; uniform vec3 uCam; uniform float uTime, uHx, uWindA;
uniform sampler2D uFlowTex;
void main(){
  vec2 fuv = vW.xz / uHx * 0.5 + 0.5;
  vec4 fq = texture2D(uFlowTex, fuv);
  vec2 fdir = fq.gb*2.0 - 1.0;
  float q = fq.r;
  vec2 wdir = vec2(cos(uWindA), sin(uWindA));
  vec2 adv = normalize(mix(wdir, length(fdir)>0.05 ? normalize(fdir) : wdir, clamp(q*2.5,0.0,0.9)));
  float t = uTime;
  vec2 p1 = vW.xz*0.35 - adv*t*(1.2+3.0*q);
  vec2 p2 = vW.xz*0.9 + vec2(-adv.y,adv.x)*t*0.7;
  float r1 = sin(p1.x)*sin(p1.y*1.3) + 0.5*sin(p1.x*2.1+p1.y*1.7);
  float r2 = sin(p2.x*1.1-p2.y*0.9) * sin(p2.x*0.7+p2.y*1.9);
  vec3 N = normalize(vec3(r1*0.12 + r2*0.05, 1.0, r2*0.12 - r1*0.05));
  vec3 V = normalize(uCam - vW);
  float fres = pow(1.0 - max(dot(N,V),0.0), 2.2);
  vec3 deep = vec3(0.02,0.13,0.18), shal = vec3(0.12,0.42,0.46);
  vec3 col = mix(deep, shal, clamp(0.25 + 0.35*r1 + q*0.5, 0.0, 1.0));
  vec3 L = normalize(uSun);
  vec3 Hv = normalize(L+V);
  col += vec3(1.0,0.9,0.75) * pow(max(dot(N,Hv),0.0), 220.0) * 2.2;
  col = mix(col, vec3(0.55,0.65,0.75), fres*0.55);
  float foamBand = smoothstep(0.45, 0.95, q) * (0.5+0.5*sin(dot(vW.xz,adv)*2.4 - t*(3.0+5.0*q)));
  col = mix(col, vec3(0.9,0.95,0.95), clamp(foamBand*0.7,0.0,0.75));
  float dist = length(uCam - vW);
  float a = mix(0.86, 0.97, fres);
  a *= 1.0 - smoothstep(380.0, 520.0, dist);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RIVER_VERT = `
attribute float aQ; attribute float aEdge;
varying vec2 vUv; varying float vQ; varying float vE; varying vec3 vW;
void main(){ vUv = uv; vQ = aQ; vE = aEdge;
  vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp; }`;
const RIVER_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; varying float vQ; varying float vE; varying vec3 vW;
uniform vec3 uSun; uniform vec3 uCam; uniform float uTime;
void main(){
  float speed = 1.5 + vQ*0.12;
  float flow = vUv.x*3.0 - uTime*speed;
  float w1 = sin(flow*4.0 + sin(vUv.y*9.0)*1.5);
  float w2 = sin(flow*9.0 - vUv.y*14.0);
  vec3 N = normalize(vec3(w1*0.18, 1.0, w2*0.14));
  vec3 V = normalize(uCam - vW);
  vec3 col = mix(vec3(0.05,0.25,0.3), vec3(0.2,0.55,0.6), 0.5+0.25*w1);
  vec3 L = normalize(uSun);
  vec3 Hv = normalize(L+V);
  col += vec3(1.0,0.95,0.8) * pow(max(dot(N,Hv),0.0), 140.0) * 1.6;
  float edgeFoam = smoothstep(0.32, 0.0, abs(vE-0.5)) ; // 1 at banks... invert below
  edgeFoam = 1.0 - smoothstep(0.0, 0.28, min(vE, 1.0-vE));
  float foam = clamp(edgeFoam*0.8 + smoothstep(0.6,1.0,0.5+0.5*w2)*clamp(vQ*0.05,0.0,0.6), 0.0, 1.0);
  col = mix(col, vec3(0.92,0.96,0.96), foam*0.75);
  float fres = pow(1.0-max(dot(N,V),0.0), 2.0);
  col = mix(col, vec3(0.5,0.6,0.68), fres*0.4);
  gl_FragColor = vec4(col, 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PTS_VERT = `
attribute vec3 aCol;
varying vec3 vC;
uniform float uSize; uniform float uScale;
void main(){ vC = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(uSize * uScale / max(1.0, -mv.z), 1.0, 22.0);
  gl_Position = projectionMatrix * mv; }`;
const PTS_FRAG = `
precision mediump float;
varying vec3 vC;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float m = dot(pc,pc);
  if (m > 0.25) discard;
  float a = smoothstep(0.25, 0.12, m);
  gl_FragColor = vec4(vC, 0.92*a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKY_VERT = `varying vec3 vD; void main(){ vD = position;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = /* glsl */`
precision mediump float;
varying vec3 vD;
uniform vec3 uSun;
void main(){
  vec3 d = normalize(vD);
  vec3 top = vec3(0.10,0.16,0.32), mid = vec3(0.23,0.30,0.42), bot = vec3(0.03,0.035,0.05);
  vec3 col = d.y > 0.0 ? mix(mid, top, pow(min(1.0,d.y*1.6),0.7)) : mix(mid, bot, min(1.0,-d.y*4.0));
  float s = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0,0.85,0.6)*pow(s, 900.0)*3.0 + vec3(0.9,0.7,0.5)*pow(s, 18.0)*0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.fog = null;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
    this.camera.position.set(150, 120, 150);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 22, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 700;
    this.controls.minDistance = 4;
    this.controls.maxPolarAngle = 1.72;
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

    // sky
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uSun: { value: this.sunDir } }, side: THREE.BackSide, depthWrite: false });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), this.skyMat));

    // lights (for helpers / wire)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.copy(this.sunDir).multiplyScalar(300);
    this.scene.add(sun); this.sunLight = sun;
    this.scene.add(new THREE.HemisphereLight(0x8aa0c0, 0x201a14, 0.7));

    // flow texture (updated live from sim)
    this.flowN = 256;
    this.flowBytes = new Uint8Array(this.flowN * this.flowN * 4);
    this.flowTex = new THREE.DataTexture(this.flowBytes, this.flowN, this.flowN, THREE.RGBAFormat);
    this.flowTex.minFilter = THREE.LinearFilter;
    this.flowTex.magFilter = THREE.LinearFilter;
    this.flowTex.needsUpdate = true;

    // terrain
    this.terrUniforms = {
      uSun: { value: this.sunDir }, uCam: { value: this.camera.position },
      uFog: { value: new THREE.Color(0x0a0e15) },
      uFlowMax: { value: 1 }, uSedMax: { value: 1 }, uWaterY: { value: 12 },
      uTime: { value: 0 }, uHx: { value: 100 }, uSliceY: { value: 55 }, uSlice: { value: 0 },
      uMode: { value: 0 }, uFlowTex: { value: this.flowTex },
    };
    this.terrMat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
      uniforms: this.terrUniforms });
    this.terrMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.terrMat);
    this.terrMesh.frustumCulled = false;
    this.scene.add(this.terrMesh);
    this.wireMesh = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ wireframe: true, color: 0x5aa2ff, transparent: true, opacity: 0.18 }));
    this.wireMesh.visible = false; this.wireMesh.frustumCulled = false;
    this.scene.add(this.wireMesh);

    // water plane (depth-tested against terrain -> fills lakes + seas + channels)
    this.waterMat = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: false,
      uniforms: { uSun: { value: this.sunDir }, uCam: { value: this.camera.position },
        uTime: { value: 0 }, uHx: { value: 100 }, uWindA: { value: 0.6 }, uFlowTex: { value: this.flowTex } } });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(320, 72), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 12;
    this.water.renderOrder = 5;
    this.scene.add(this.water);

    // river ribbons
    this.riverMat = new THREE.ShaderMaterial({ vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG,
      transparent: true, depthWrite: false,
      uniforms: { uSun: { value: this.sunDir }, uCam: { value: this.camera.position }, uTime: { value: 0 } } });
    this.riverMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.riverMat);
    this.riverMesh.frustumCulled = false; this.riverMesh.renderOrder = 6;
    this.scene.add(this.riverMesh);

    // droplet points
    this.pCap = 24000;
    this.pGeo = new THREE.BufferGeometry();
    this.pPosA = new THREE.BufferAttribute(new Float32Array(this.pCap * 3), 3);
    this.pColA = new THREE.BufferAttribute(new Float32Array(this.pCap * 3), 3);
    this.pPosA.setUsage(THREE.DynamicDrawUsage); this.pColA.setUsage(THREE.DynamicDrawUsage);
    this.pGeo.setAttribute('position', this.pPosA);
    this.pGeo.setAttribute('aCol', this.pColA);
    this.pGeo.setDrawRange(0, 0);
    this.pMat = new THREE.ShaderMaterial({ vertexShader: PTS_VERT, fragmentShader: PTS_FRAG,
      transparent: true, depthWrite: false, uniforms: { uSize: { value: 3.2 }, uScale: { value: 600 } } });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false; this.points.renderOrder = 8;
    this.scene.add(this.points);

    // wind streaks
    this.wCap = 6000;
    this.wGeo = new THREE.BufferGeometry();
    this.wPosA = new THREE.BufferAttribute(new Float32Array(this.wCap * 6), 3);
    this.wPosA.setUsage(THREE.DynamicDrawUsage);
    this.wGeo.setAttribute('position', this.wPosA);
    const wc = new Float32Array(this.wCap * 6);
    for (let i = 0; i < this.wCap; i++) {
      wc[i * 6] = 1; wc[i * 6 + 1] = 0.85; wc[i * 6 + 2] = 0.55;
      wc[i * 6 + 3] = 0.25; wc[i * 6 + 4] = 0.22; wc[i * 6 + 5] = 0.15;
    }
    this.wGeo.setAttribute('color', new THREE.BufferAttribute(wc, 3));
    this.wGeo.setDrawRange(0, 0);
    this.windLines = new THREE.LineSegments(this.wGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.windLines.frustumCulled = false; this.windLines.renderOrder = 8;
    this.scene.add(this.windLines);

    // ground grid
    this.grid = new THREE.GridHelper(200, 20, 0x2a3a55, 0x1a2436);
    this.grid.position.y = 0.05;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.5;
    this.scene.add(this.grid);

    this.tris = 0;
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || 2, h = this.canvas.clientHeight || 2;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.pMat.uniforms.uScale.value = h * pr * 0.5;
    }
  }
  setTerrain(m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('aFlow', new THREE.BufferAttribute(m.flow, 1));
    g.setAttribute('aSed', new THREE.BufferAttribute(m.sed, 1));
    g.setAttribute('aHard', new THREE.BufferAttribute(m.hard, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(m.ao, 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    this.terrMesh.geometry.dispose();
    this.terrMesh.geometry = g;
    this.wireMesh.geometry = g;
    this.tris = m.tris;
    this.terrUniforms.uFlowMax.value = Math.max(1e-4, m.maxFlow);
    this.terrUniforms.uSedMax.value = Math.max(1e-4, m.maxSed);
  }
  setRivers(r) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
    g.setAttribute('aQ', new THREE.BufferAttribute(r.q, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(r.edge, 1));
    g.setIndex(new THREE.BufferAttribute(r.index, 1));
    this.riverMesh.geometry.dispose();
    this.riverMesh.geometry = g;
  }
  updateHydro(rPos, rCol, count) {
    const n = Math.min(count, this.pCap);
    this.pPosA.array.set(rPos.subarray(0, n * 3));
    this.pColA.array.set(rCol.subarray(0, n * 3));
    this.pPosA.needsUpdate = true; this.pColA.needsUpdate = true;
    this.pGeo.setDrawRange(0, n);
  }
  clearHydro() { this.pGeo.setDrawRange(0, 0); }
  updateWind(seg, count) {
    const n = Math.min(count, this.wCap);
    this.wPosA.array.set(seg.subarray(0, n * 6));
    this.wPosA.needsUpdate = true;
    this.wGeo.setDrawRange(0, n * 2);
  }
  clearWind() { this.wGeo.setDrawRange(0, 0); }
  setFlowBytes(bytes) {
    this.flowBytes.set(bytes);
    this.flowTex.needsUpdate = true;
  }
  setWaterLevel(y) { this.water.position.y = y; this.terrUniforms.uWaterY.value = y; }
  setShade(m) { this.terrUniforms.uMode.value = m; }
  setSlice(y, on) { this.terrUniforms.uSliceY.value = y; this.terrUniforms.uSlice.value = on ? 1 : 0; }
  setSun(azDeg, elDeg) {
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.sunLight.position.copy(this.sunDir).multiplyScalar(300);
  }
  setExposure(e) { this.renderer.toneMappingExposure = e; }
  setParticleSize(s) { this.pMat.uniforms.uSize.value = s; }
  showWater(v) { this.water.visible = v; this.riverMesh.visible = v; }
  showParticles(v) { this.points.visible = v; }
  showWind(v) { this.windLines.visible = v; }
  showWire(v) { this.wireMesh.visible = v; }
  showGrid(v) { this.grid.visible = v; }
  setWindAngle(a) { this.waterMat.uniforms.uWindA.value = a; }
  focusView(preset) {
    const t = new THREE.Vector3(0, 22, 0);
    const P = {
      iso: [150, 120, 150], top: [0.1, 320, 0.1],
      front: [0, 40, 260], side: [260, 40, 0],
    }[preset] || [150, 120, 150];
    this.camera.position.set(...P);
    this.controls.target.copy(t);
    this.controls.update();
  }
  render(time) {
    this.resize();
    this.terrUniforms.uTime.value = time;
    this.waterMat.uniforms.uTime.value = time;
    this.riverMat.uniforms.uTime.value = time;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
