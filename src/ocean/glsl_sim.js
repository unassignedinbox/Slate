// Simulation shaders: spectrum -> FFT -> displacement, foam, spray.
import { NOISE_GLSL, BATHY_GLSL, ANALYTIC_GLSL, CASCADE_SAMPLE_GLSL } from './glsl_common.js';

// ---------------------------------------------------------------------------
// Time-evolved wave spectrum. Writes one complex field in bit-reversed layout:
// uMode 0 = height H, 1 = choppy Dx, 2 = choppy Dz.
// Sign convention (see RESEARCH.md): H(k,t) = H0(k)e^{-iwt} + H0*(-k)e^{+iwt}
// pairs with our true inverse FFT so energy on the +k (wind) side travels
// downwind. Output .rg = complex value.
// ---------------------------------------------------------------------------
export const SPECTRUM_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
uniform float uN;
uniform float uNH;
uniform int uStages;
uniform float uTileL;
uniform float uTime;
uniform float uSeed;
uniform int uMode;
// sea state
uniform float uWindSpeed;
uniform vec2 uWindDir;
uniform float uFetch;
uniform float uGamma;
uniform float uSpecMode; // 0 jonswap+tma, 1 pm, 2 phillips
uniform float uSwellHs;
uniform float uSwellTp;
uniform vec2 uSwellDir;
uniform float uSwellBeta;
uniform float uSwellOn;
uniform float uEnergy;
uniform float uRefDepth;
uniform float uChop;
uniform float uChopLen;
uniform float uKLo0, uKLo1, uKHi0, uKHi1;

float bitrev(float v) {
  float r = 0.0;
  float x = v;
  for (int i = 0; i < 16; i++) {
    if (i >= uStages) break;
    r = r * 2.0 + mod(x, 2.0);
    x = floor(x * 0.5);
  }
  return r;
}
float cosFade(float k, float a, float b) {
  if (b <= a) return 1.0;
  float t = clamp((k - a) / (b - a), 0.0, 1.0);
  return 0.5 - 0.5 * cos(3.14159265 * t);
}
float dispOmega(float k, float D) {
  if (k <= 0.0) return 0.0;
  if (D <= 0.0) return sqrt(9.81 * k);
  return sqrt(9.81 * k * tanh(k * D));
}
float dispDeriv(float k, float D) {
  if (k <= 0.0) return 0.0;
  if (D <= 0.0) return 0.5 * sqrt(9.81 / k);
  float w = dispOmega(k, D);
  float kd = k * D;
  float s = sinh(2.0 * kd);
  float corr = s > 1e-6 ? 1.0 + (2.0 * kd) / s : 2.0;
  return (w / (2.0 * k)) * corr;
}
float wrapPi(float a) {
  return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}
// directional wavenumber spectrum Psi + omega
vec2 specPsi(vec2 kvec) {
  float k = length(kvec);
  if (k < 1e-9) return vec2(0.0);
  float theta = atan(kvec.y, kvec.x);
  float w = dispOmega(k, uRefDepth);
  float dwdk = dispDeriv(k, uRefDepth);
  float psi = 0.0;
  if (uSpecMode > 1.5) {
    // Phillips (Tessendorf), one-sided, auto-normalized to min(PM, fetch) Hs
    float U = max(uWindSpeed, 0.01);
    float L = U * U / 9.81;
    vec2 kh = kvec / k;
    float wk = dot(kh, uWindDir);
    if (wk > 0.0) {
      float ndp = 9.81 * max(uFetch, 100.0) / (U * U);
      float HsF = 0.0016 * (U * U / 9.81) * sqrt(ndp);
      float HsT = min(0.21 * (U * U) / 9.81, HsF);
      float A = (HsT * HsT / 16.0) * 4.0 / (3.14159265 * L * L);
      float k2 = k * k;
      psi = A * exp(-1.0 / (k2 * L * L)) * exp(-k2 * 0.25) * wk * wk / (k2 * k2);
      psi *= uEnergy;
    }
    if (uSwellOn > 0.5 && uSwellHs > 0.0 && uSwellTp > 0.0) {
      float wsp = 6.2831853 / uSwellTp;
      float Ss = (5.0 / 16.0) * uSwellHs * uSwellHs * pow(wsp, 4.0) / pow(max(w, 1e-4), 5.0)
               * exp(-1.25 * pow(wsp / max(w, 1e-4), 4.0));
      float sm = atan(uSwellDir.y, uSwellDir.x);
      float sd = wrapPi(theta - sm);
      float cs = cosh(uSwellBeta * sd);
      psi += Ss * 0.5 * uSwellBeta / (cs * cs) * dwdk * uEnergy / k;
    }
  } else {
    float U = max(uWindSpeed, 0.5);
    float nd = 9.81 * max(uFetch, 100.0) / (U * U);
    float alpha = 0.076 * pow(nd, -0.22);
    float fp = 3.5 * (9.81 / U) * pow(nd, -0.33); // Hasselmann fetch law
    float wp = 6.2831853 * fp;
    float gamma = uSpecMode < 0.5 ? uGamma : 1.0;
    float sig = w <= wp ? 0.07 : 0.09;
    float rr = exp(-((w - wp) * (w - wp)) / (2.0 * sig * sig * wp * wp));
    float Sj = alpha * 9.81 * 9.81 / pow(max(w, 1e-4), 5.0)
             * exp(-1.25 * pow(wp / max(w, 1e-4), 4.0)) * pow(max(gamma, 1e-3), rr);
    // TMA depth factor (Bouws/Kitaigorodskii, piecewise, clamped)
    float wh = w * sqrt(max(uRefDepth, 0.0) / 9.81);
    float ph = wh <= 1.0 ? 0.5 * wh * wh : (wh <= 2.0 ? 1.0 - 0.5 * (2.0 - wh) * (2.0 - wh) : 1.0);
    Sj *= ph * ph;
    // Donelan-Banner spreading (self-normalized sech^2)
    float x = w / max(wp, 1e-4);
    float beta = x < 0.56 ? 2.61 * pow(0.56, 1.3)
               : (x < 0.95 ? 2.61 * pow(x, 1.3)
               : (x < 1.6 ? 2.28 * pow(max(x, 1e-3), -1.3) : 1.24));
    float wm = atan(uWindDir.y, uWindDir.x);
    float dd = wrapPi(theta - wm);
    float cb = cosh(beta * dd);
    float Dj = 0.5 * beta / (cb * cb);
    float S = Sj * Dj;
    if (uSwellOn > 0.5 && uSwellHs > 0.0 && uSwellTp > 0.0) {
      float wsp = 6.2831853 / uSwellTp;
      float Ss = (5.0 / 16.0) * uSwellHs * uSwellHs * pow(wsp, 4.0) / pow(max(w, 1e-4), 5.0)
               * exp(-1.25 * pow(wsp / max(w, 1e-4), 4.0));
      float sm = atan(uSwellDir.y, uSwellDir.x);
      float sd = wrapPi(theta - sm);
      float cs = cosh(uSwellBeta * sd);
      S += Ss * 0.5 * uSwellBeta / (cs * cs);
    }
    psi = S * dwdk * uEnergy / k;
  }
  return vec2(psi, w);
}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

void main() {
  float ix = floor(vUv.x * uN);
  float iy = floor(vUv.y * uN);
  float nx = bitrev(ix);
  float ny = bitrev(iy);
  // Nyquist lines carry no energy (keeps the field real & symmetric)
  if (nx == uNH || ny == uNH) { gl_FragColor = vec4(0.0); return; }
  float dk = 6.2831853 / uTileL;
  float kx = (nx <= uNH ? nx : nx - uN) * dk;
  float ky = (ny <= uNH ? ny : ny - uN) * dk;
  float k = length(vec2(kx, ky));
  vec2 sp = specPsi(vec2(kx, ky));
  // cascade band window + sub-grid fade
  float win = cosFade(k, uKLo0, uKLo1);
  if (uKHi0 > 0.0) win *= 1.0 - cosFade(k, uKHi0, uKHi1);
  float fade = 1.5 * (uTileL / uN);
  float psiK = max(sp.x, 0.0) * win * exp(-k * k * fade * fade);
  float mx = mod(uN - nx, uN);
  float my = mod(uN - ny, uN);
  float psiM = max(specPsi(vec2(-kx, -ky)).x, 0.0) * win * exp(-k * k * fade * fade);
  float w = sp.y;
  float amp = 0.70710678 * uN * uN * dk; // N^2*dk/sqrt(2): Parseval energy match
  vec2 g1 = gauss2(vec2(nx, ny) + uSeed * 17.0);
  vec2 g2 = gauss2(vec2(mx, my) + uSeed * 17.0 + 5.0);
  vec2 h0k = g1 * (amp * sqrt(psiK));
  vec2 h0m = g2 * (amp * sqrt(psiM));
  vec2 e1 = vec2(cos(w * uTime), -sin(w * uTime)); // e^{-iwt}
  vec2 e2 = vec2(cos(w * uTime), sin(w * uTime));  // e^{+iwt}
  vec2 H = cmul(h0k, e1) + cmul(vec2(h0m.x, -h0m.y), e2);
  vec2 outv = H;
  if (uMode == 1 || uMode == 2) {
    float kk = uMode == 1 ? kx : ky;
    float atten = uChop / ((1.0 + k * uChopLen) * max(k, 1e-4));
    vec2 imH = vec2(H.y, -H.x); // -i * H
    outv = imH * (kk * atten);
  }
  gl_FragColor = vec4(outv, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// One FFT stage (ping-pong). uDir 0 = horizontal, 1 = vertical. Scales by 1/N.
// ---------------------------------------------------------------------------
export const FFT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uButterfly;
uniform float uN;
uniform float uStages;
uniform float uStage;
uniform float uDir;
void main() {
  float o = uDir < 0.5 ? floor(vUv.x * uN) : floor(vUv.y * uN);
  vec4 bf = texture2D(uButterfly, vec2((o + 0.5) / uN, (uStage + 0.5) / uStages));
  vec2 w = bf.xy;
  vec2 uvA = uDir < 0.5 ? vec2((bf.z + 0.5) / uN, vUv.y) : vec2(vUv.x, (bf.z + 0.5) / uN);
  vec2 uvB = uDir < 0.5 ? vec2((bf.w + 0.5) / uN, vUv.y) : vec2(vUv.x, (bf.w + 0.5) / uN);
  vec2 A = texture2D(uSrc, uvA).rg;
  vec2 B = texture2D(uSrc, uvB).rg;
  vec2 y = A + vec2(w.x * B.x - w.y * B.y, w.x * B.y + w.y * B.x);
  gl_FragColor = vec4(y / uN, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Merge Dy/Dx/Dz real parts into one displacement texture.
// ---------------------------------------------------------------------------
export const COMBINE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uDy;
uniform sampler2D uDx;
uniform sampler2D uDz;
void main() {
  float dy = texture2D(uDy, vUv).r;
  float dx = texture2D(uDx, vUv).r;
  float dz = texture2D(uDz, vUv).r;
  gl_FragColor = vec4(dx, dy, dz, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Persistent foam field: advect by measured surface velocity, decay, deposit.
// R = foam density, G = crest/break intensity. Tile follows the camera.
// ---------------------------------------------------------------------------
export const FOAM_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
${BATHY_GLSL}
${ANALYTIC_GLSL}
${CASCADE_SAMPLE_GLSL}
uniform sampler2D uPrev;
uniform sampler2D uDispPrev0;
uniform vec2 uCenter;
uniform float uSize;
uniform float uDt;
uniform float uTime;
uniform vec2 uCamDelta;
uniform float uWindSpeed;
uniform float uTau;
uniform float uDeposit;
uniform float uWhitecap;
uniform float uPeakK;

float breakerMask(vec2 p, float h) {
  float D = bathyDepth(p);
  if (D < 0.1 || D > 60.0) return 0.0;
  float Ks = shoalingGain(uPeakK, D);
  float Hest = 2.0 * max(h * Ks, 0.0);
  return smoothstep(0.45, 0.8, Hest / max(D, 0.3));
}

void main() {
  vec2 p = uCenter + (vUv - 0.5) * uSize;
  vec3 D0 = texture2D(uDisp0, p / uTiles.x).rgb;
  vec3 D1 = texture2D(uDisp1, p / uTiles.y).rgb;
  vec3 P0 = texture2D(uDispPrev0, p / uTiles.x).rgb;
  float dt = max(uDt, 1e-4);

  // measured horizontal surface velocity (cascade 0 dominates)
  vec2 vel = (D0.xz - P0.xz) / dt;
  float vmag = length(vel);
  if (vmag > 14.0) vel *= 14.0 / vmag;

  // advect + decay
  vec2 uvPrev = vUv - (vel * uDt + uCamDelta) / uSize;
  vec2 prev = texture2D(uPrev, uvPrev).rg;
  float foam = prev.r * exp(-uDt / max(uTau, 0.2));

  // fold (1 - Jacobian) from horizontal displacement
  float e = 1.5;
  vec3 xp = texture2D(uDisp0, (p + vec2(e, 0.0)) / uTiles.x).rgb
          + texture2D(uDisp1, (p + vec2(e, 0.0)) / uTiles.y).rgb;
  vec3 xm = texture2D(uDisp0, (p - vec2(e, 0.0)) / uTiles.x).rgb
          + texture2D(uDisp1, (p - vec2(e, 0.0)) / uTiles.y).rgb;
  vec3 zp = texture2D(uDisp0, (p + vec2(0.0, e)) / uTiles.x).rgb
          + texture2D(uDisp1, (p + vec2(0.0, e)) / uTiles.y).rgb;
  vec3 zm = texture2D(uDisp0, (p - vec2(0.0, e)) / uTiles.x).rgb
          + texture2D(uDisp1, (p - vec2(0.0, e)) / uTiles.y).rgb;
  float dxx = (xp.x - xm.x) / (2.0 * e);
  float dxz = (xp.z - xm.z) / (2.0 * e);
  float dzx = (zp.x - zm.x) / (2.0 * e);
  float dzz = (zp.z - zm.z) / (2.0 * e);
  float J = (1.0 + dxx) * (1.0 + dzz) - dxz * dzx;
  float fold = clamp(1.0 - J, 0.0, 2.0);

  float h = D0.y + D1.y + texture2D(uDisp2, p / uTiles.z).r;
  h += analyticHeight(p, uTime);
  float B = breakerMask(p, h);
  float D = bathyDepth(p);

  float dep = 0.0;
  dep += smoothstep(0.10, 0.55, fold) * 1.1;                    // folding crests
  dep += B * 3.2;                                              // breakers
  if (D > 0.0 && D < 3.0) {                                    // shoreline runup
    float band = 0.5 + 0.5 * sin(D * 2.6 - uTime * 2.4);
    dep += (0.55 + 0.9 * smoothstep(0.55, 0.95, band)) * smoothstep(3.0, 0.4, D);
  }
  if (D > 12.0) {                                              // open-ocean whitecaps
    float wcap = smoothstep(7.0, 15.0, uWindSpeed) * uWhitecap;
    float capPatch = fbm3(p * 0.02 + vec2(uTime * 0.05, 0.0));
    dep += smoothstep(0.04, 0.30, fold) * wcap * smoothstep(0.35, 0.75, capPatch) * 1.4;
  }
  foam = clamp(foam + dep * uDeposit * uDt, 0.0, 1.6);
  float crest = clamp(max(B * 1.2, smoothstep(0.05, 0.6, fold)), 0.0, 1.5);
  gl_FragColor = vec4(foam, crest, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Spray / foam particle state update (GPGPU). Two behaviors in one system:
// type 0 = ballistic spray, type 1 = surface-hugging foam fleck.
// uPosT = (x,y,z,life01), uVelT = (vx,vy,vz,type)
// ---------------------------------------------------------------------------
export const SPRAY_UPDATE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
${BATHY_GLSL}
${ANALYTIC_GLSL}
${CASCADE_SAMPLE_GLSL}
uniform sampler2D uPosT;
uniform sampler2D uVelT;
uniform sampler2D uDispPrev0;
uniform vec2 uSpawnCenter;
uniform float uSpawnR;
uniform float uDt;
uniform float uTime;
uniform float uFrame;
uniform vec2 uWindVec;
uniform float uLifeSpray;
uniform float uLifeFoam;
uniform float uFoamFrac;
uniform float uGain;
uniform float uPeakK;
uniform float uMode; // 0 = write pos, 1 = write vel

float surfH(vec2 p) {
  return oceanDisp(p).y + analyticHeight(p, uTime);
}
vec2 surfVel(vec2 p, float dt) {
  vec2 d = texture2D(uDisp0, p / uTiles.x).xz - texture2D(uDispPrev0, p / uTiles.x).xz;
  vec2 v = d / max(dt, 1e-4);
  float m = length(v);
  return m > 14.0 ? v * (14.0 / m) : v;
}

void main() {
  vec4 P = texture2D(uPosT, vUv);
  vec4 V = texture2D(uVelT, vUv);
  float life = P.w;
  float type = V.w;
  float dt = min(max(uDt, 1e-4), 0.05);

  if (life <= 0.0) {
    // ---- respawn attempt ----
    vec2 id = vUv * vec2(733.0, 517.0) + uFrame * 0.317;
    float r1 = hash12(id);
    float r2 = hash12(id + 3.1);
    float r3 = hash12(id + 7.7);
    float r4 = hash12(id + 13.3);
    float ang = 6.2831853 * r1;
    float rad = sqrt(r2) * uSpawnR;
    vec2 p = uSpawnCenter + vec2(cos(ang), sin(ang)) * rad;
    float h = surfH(p);
    float D = bathyDepth(p);
    float e = 2.0;
    vec2 gx = texture2D(uDisp0, (p + vec2(e, 0.0)) / uTiles.x).xz
            - texture2D(uDisp0, (p - vec2(e, 0.0)) / uTiles.x).xz;
    vec2 gz = texture2D(uDisp0, (p + vec2(0.0, e)) / uTiles.x).xz
            - texture2D(uDisp0, (p - vec2(0.0, e)) / uTiles.x).xz;
    float J = (1.0 + gx.x / (2.0 * e)) * (1.0 + gz.y / (2.0 * e))
            - (gx.y / (2.0 * e)) * (gz.x / (2.0 * e));
    float fold = clamp(1.0 - J, 0.0, 2.0);
    float B = 0.0;
    if (D > 0.1 && D < 60.0) {
      float Ks = shoalingGain(uPeakK, D);
      B = smoothstep(0.45, 0.8, 2.0 * max(h * Ks, 0.0) / max(D, 0.3));
    }
    float shore = (D > -0.5 && D < 3.0) ? 1.0 : 0.0;
    float white = smoothstep(8.0, 16.0, length(uWindVec)) * (D > 12.0 ? 1.0 : 0.0);
    float accept = clamp(fold * 0.85 + B * 2.4 + shore * 0.8 + white * 0.30, 0.0, 1.0) * uGain;
    if (r3 < accept && D > -1.0) {
      float nt = r4 < uFoamFrac ? 1.0 : 0.0;
      vec2 sv = surfVel(p, dt);
      vec3 np;
      vec3 nv;
      if (nt < 0.5) {
        np = vec3(p.x, h + 0.06 + r1 * 0.3, p.y);
        nv = vec3(sv.x * 0.7 + (r2 - 0.5) * 3.0 + uWindVec.x * 0.12,
                  (1.6 + 4.6 * r4) * (1.0 + B * 2.2),
                  sv.y * 0.7 + (r3 - 0.5) * 3.0 + uWindVec.y * 0.12);
      } else {
        np = vec3(p.x, h + 0.04, p.y);
        nv = vec3(sv.x + uWindVec.x * 0.02, 0.0, sv.y + uWindVec.y * 0.02);
      }
      if (uMode < 0.5) gl_FragColor = vec4(np, 1.0);
      else gl_FragColor = vec4(nv, nt);
    } else {
      if (uMode < 0.5) gl_FragColor = vec4(0.0, -100.0, 0.0, 0.0);
      else gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
    return;
  }

  // ---- integrate ----
  float span = type < 0.5 ? uLifeSpray : uLifeFoam;
  life -= dt / max(span, 0.05);
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;
  if (type < 0.5) {
    vel.y -= 9.81 * dt;
    vel *= exp(-dt * 0.55);
    pos += vel * dt;
    if (pos.y < surfH(pos.xz) - 0.15) life = 0.0;
  } else {
    vec2 sv = surfVel(pos.xz, dt);
    vel.xz = mix(vel.xz, sv + uWindVec * 0.03, clamp(dt * 2.0, 0.0, 1.0));
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    pos.y = surfH(pos.xz) + 0.04;
    if (bathyDepth(pos.xz) < -0.6) life = 0.0;
  }
  if (life <= 0.0) {
    if (uMode < 0.5) gl_FragColor = vec4(0.0, -100.0, 0.0, 0.0);
    else gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    if (uMode < 0.5) gl_FragColor = vec4(pos, life);
    else gl_FragColor = vec4(vel, type);
  }
}
`;

export const SPRAY_VERT = /* glsl */`
uniform sampler2D uPosT;
uniform sampler2D uVelT;
uniform float uScaleH;
uniform float uSizeSpray;
uniform float uSizeFoam;
varying float vAlpha;
varying float vType;
varying float vSeed;
varying float vFog;
uniform vec3 uFogColor; // unused here, keeps fog uniform shared
uniform float uFogDensity;
void main() {
  vec2 suv = position.xy;
  vec4 P = texture2D(uPosT, suv);
  vec4 V = texture2D(uVelT, suv);
  float life = P.w;
  vType = V.w;
  vSeed = fract(suv.x * 733.1 + suv.y * 517.7);
  if (life <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0; vFog = 0.0;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  float dist = max(-mv.z, 0.1);
  float ws = (vType < 0.5 ? uSizeSpray : uSizeFoam) * (0.6 + 0.8 * vSeed);
  gl_PointSize = clamp(ws * (uScaleH / dist), 0.0, 64.0);
  float age = 1.0 - life;
  vAlpha = (1.0 - smoothstep(0.5, 1.0, age)) * smoothstep(0.0, 0.05, age);
  float fd = dist * uFogDensity;
  vFog = 1.0 - exp(-fd * fd);
  gl_Position = projectionMatrix * mv;
}
`;

export const SPRAY_FRAG = /* glsl */`
precision highp float;
varying float vAlpha;
varying float vType;
varying float vSeed;
varying float vFog;
uniform vec3 uFogColor;
uniform float uOpacity;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  float a = smoothstep(1.0, 0.30, d);
  a *= 0.65 + 0.5 * fract(vSeed * 7.0 + q.x * 3.0 - q.y * 5.0);
  vec3 sprayCol = vec3(0.93, 0.96, 0.98);
  vec3 foamCol = vec3(0.80, 0.87, 0.89);
  vec3 col = mix(sprayCol, foamCol, step(0.5, vType));
  col = mix(col, uFogColor, vFog);
  float alpha = a * vAlpha * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
