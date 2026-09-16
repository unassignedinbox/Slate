// Rendering shaders: water surface, seabed, sky.
import { NOISE_GLSL, BATHY_GLSL, ANALYTIC_GLSL, CASCADE_SAMPLE_GLSL, SKYFN_GLSL } from './glsl_common.js';

export const WATER_VERT = /* glsl */`
${NOISE_GLSL}
${BATHY_GLSL}
${ANALYTIC_GLSL}
${CASCADE_SAMPLE_GLSL}
uniform float uTime;
uniform float uPeakK;
uniform float uLip;
varying vec3 vWorld;
varying float vHeight;
varying float vDepth;
varying float vBreaker;
varying float vKs;

float surfH(vec2 p, float dist) {
  return oceanDispFaded(p, dist).y + analyticHeight(p, uTime);
}
void main() {
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 p = wp0.xz;
  float dist = length(wp0.xyz - cameraPosition);
  vec3 D = oceanDispFaded(p, dist);
  float h = D.y + analyticHeight(p, uTime);
  float depth = bathyDepth(p);
  float Ks = shoalingGain(uPeakK, depth);

  float B = 0.0;
  if (depth > 0.05 && depth < 60.0) {
    B = smoothstep(0.45, 0.8, 2.0 * max(h * Ks, 0.0) / max(depth, 0.3));
  }
  // crest steepening: pull vertices uphill + throw lip shoreward
  float e = 2.0;
  float hx = surfH(p + vec2(e, 0.0), dist) - surfH(p - vec2(e, 0.0), dist);
  float hz = surfH(p + vec2(0.0, e), dist) - surfH(p - vec2(0.0, e), dist);
  vec2 grad = vec2(hx, hz) / (2.0 * e);
  vec2 xz = D.xz * (1.0 + 0.9 * (Ks - 1.0));
  xz -= grad * (B * 1.4);
  vec2 shore = bathyShoreDir(p);
  xz += shore * (B * uLip * max(h * Ks, 0.0));

  float y = h * Ks;
  if (depth < 60.0) y = min(y, 0.62 * max(depth, 0.0) + 0.35); // Miche depth limit

  vec3 world = vec3(p.x + xz.x, y, p.y + xz.y);
  vWorld = world;
  vHeight = y;
  vDepth = depth;
  vBreaker = B;
  vKs = Ks;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const WATER_FRAG = /* glsl */`
precision highp float;
${NOISE_GLSL}
${BATHY_GLSL}
${ANALYTIC_GLSL}
${CASCADE_SAMPLE_GLSL}
${SKYFN_GLSL}
uniform float uTime;
uniform float uHsRef;
uniform sampler2D uFoamTex;
uniform vec2 uFoamCenter;
uniform float uFoamSize;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uSSSColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFoamStrength;
uniform float uDetailAmp;
uniform vec2 uWindVec;
varying vec3 vWorld;
varying float vHeight;
varying float vDepth;
varying float vBreaker;
varying float vKs;

void main() {
  vec2 p = vWorld.xz;
  float dist = length(vWorld - cameraPosition);
  // surface normal from the displaced field (finite differences)
  float e = clamp(dist * 0.015, 0.4, 7.0);
  vec3 Xp = oceanDispFaded(p + vec2(e, 0.0), dist);
  vec3 Xm = oceanDispFaded(p - vec2(e, 0.0), dist);
  vec3 Zp = oceanDispFaded(p + vec2(0.0, e), dist);
  vec3 Zm = oceanDispFaded(p - vec2(0.0, e), dist);
  float ax = analyticHeight(p + vec2(e, 0.0), uTime) - analyticHeight(p - vec2(e, 0.0), uTime);
  float az = analyticHeight(p + vec2(0.0, e), uTime) - analyticHeight(p - vec2(0.0, e), uTime);
  vec2 grad = vec2((Xp.y - Xm.y) + ax, (Zp.y - Zm.y) + az) / (2.0 * e);
  grad *= vKs;
  // fine detail normals (wind-driven micro chop)
  float dFade = (1.0 - smoothstep(30.0, 320.0, dist)) * uDetailAmp;
  if (dFade > 0.003) {
    vec2 wdrift = uWindVec * uTime;
    grad += vnoiseGrad(p * 1.9 + wdrift * 0.55) * 0.30 * dFade;
    grad += vnoiseGrad(p * 4.7 - wdrift * 0.9 + 3.7) * 0.16 * dFade;
  }
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);

  // foam
  vec2 fuv = (p - uFoamCenter) / uFoamSize + 0.5;
  vec2 ff = texture2D(uFoamTex, fuv).rg;
  float breakup = fbm3(p * 0.55 + vec2(uTime * 0.05, -uTime * 0.03));
  float foamMask = smoothstep(0.40, 0.72, ff.r * (0.55 + 0.9 * breakup) + ff.g * 0.18 + vBreaker * 0.25);
  vec2 fo = abs(fuv - 0.5);
  foamMask *= (1.0 - smoothstep(0.30, 0.5, fo.x)) * (1.0 - smoothstep(0.30, 0.5, fo.y));
  foamMask *= uFoamStrength;

  // body color by depth
  float D = max(vDepth, 0.0);
  vec3 body = mix(uShallow, uMid, 1.0 - exp(-D * 0.14));
  body = mix(body, uDeep, 1.0 - exp(-D * 0.014));
  float dif = 0.45 + 0.55 * max(dot(n, L), 0.0);
  body *= mix(vec3(0.6), vec3(1.05), dif);

  // Fresnel reflection of the sky
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 skyRef = skyApprox(normalize(R));

  // subsurface scattering through crests when looking toward the sun
  float toward = pow(clamp(dot(normalize(vWorld - cameraPosition), -L) * 0.5 + 0.5, 0.0, 1.0), 5.0);
  float crest = clamp(vHeight / (uHsRef * 0.5 + 0.25), 0.0, 1.0) * 0.6 + vBreaker * 0.6;
  vec3 sss = uSSSColor * (toward * crest * 1.6 * (1.0 - foamMask));

  // sun specular + glitter
  vec3 Hv = normalize(L + V);
  float s = max(dot(n, Hv), 0.0);
  float glitter = 0.6 + 0.8 * vnoise(p * 6.0 + vec2(uTime * 1.5, 0.0));
  vec3 spec = uSunColor * (pow(s, 720.0) * 3.0 * glitter + pow(s, 90.0) * 0.22) * (1.0 - foamMask);

  vec3 col = mix(body + sss, skyRef, fres);
  col += spec;
  vec3 foamCol = vec3(0.87, 0.91, 0.92) * (0.55 + 0.45 * dif);
  col = mix(col, foamCol, clamp(foamMask, 0.0, 1.0));

  // alpha: shallow transparency + surface-above-seabed gate (exposes reef in troughs)
  float alpha = mix(0.42, 1.0, smoothstep(0.0, 3.5, vDepth + vHeight * 0.5));
  alpha *= smoothstep(-0.30, 0.30, vHeight + vDepth);

  float fd = dist * uFogDensity;
  float f = 1.0 - exp(-fd * fd);
  col = mix(col, uFogColor, f);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SEABED_VERT = /* glsl */`
${NOISE_GLSL}
${BATHY_GLSL}
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 p = wp0.xz;
  float D = bathyDepth(p);
  float dune = (vnoise(p * 0.045) - 0.5) * min(max(D, 0.0) * 0.12, 1.2);
  dune += (vnoise(p * 0.35) - 0.5) * 0.25 * smoothstep(30.0, 2.0, D);
  vec3 world = vec3(p.x, -D + dune, p.y);
  vWorld = world;
  vDepth = D;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const SEABED_FRAG = /* glsl */`
precision highp float;
${NOISE_GLSL}
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeepTint;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vWorld;
varying float vDepth;

float caustic(vec2 p, float t) {
  vec2 q = p + 0.013;
  vec2 i = q;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 p = vWorld.xz;
  float D = vDepth;
  // sand with variation + rock patches near the reef
  float g1 = fbm3(p * 0.02);
  vec3 sand = mix(vec3(0.62, 0.55, 0.40), vec3(0.48, 0.42, 0.30), g1);
  float rock = smoothstep(0.58, 0.75, fbm3(p * 0.008 + 4.2)) * smoothstep(14.0, 2.0, D);
  sand = mix(sand, vec3(0.23, 0.24, 0.22), rock * 0.8);
  vec3 col;
  if (vWorld.y > 0.28) {
    col = sand * 1.06; // dry sand
  } else if (vWorld.y > -0.05) {
    col = sand * 0.62; // wet band
  } else {
    col = sand * 0.8;
    col = mix(col, uDeepTint, (1.0 - exp(-max(D, 0.0) * 0.10)) * 0.75);
    float ca = caustic(p * 0.35, uTime * 0.7);
    col += vec3(0.45, 0.65, 0.62) * ca * exp(-max(D, 0.0) * 0.10) * 0.9;
  }
  float dif = 0.6 + 0.4 * max(uSunDir.y, 0.0);
  col *= dif;
  float dist = length(vWorld - cameraPosition);
  float fd = dist * uFogDensity;
  col = mix(col, uFogColor, 1.0 - exp(-fd * fd));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const SKY_FRAG = /* glsl */`
precision highp float;
${NOISE_GLSL}
${SKYFN_GLSL}
uniform vec3 uFogColor;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.5));
  col = mix(col, uFogColor, smoothstep(0.28, 0.0, abs(y)) * 0.55); // horizon haze
  if (y < 0.0) col = mix(uHorizon * 0.55, uHorizon * 0.2, clamp(-y * 5.0, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.99988, 0.99997, sd) * 5.0 + pow(sd, 600.0) * 1.2 + pow(sd, 16.0) * 0.25);
  if (y > 0.015) {
    vec2 cuv = dir.xz / (y + 0.16);
    float cl = fbm4(cuv * 1.15 + vec2(uSkyTime * 0.010, uSkyTime * 0.003));
    float cover = smoothstep(1.0 - uCloudiness * 0.78, 1.18 - uCloudiness * 0.55, cl);
    float shade = fbm4(cuv * 2.6 - vec2(uSkyTime * 0.014, 0.2) + cl);
    vec3 cloudCol = mix(vec3(0.40, 0.43, 0.48), vec3(1.04, 1.02, 1.0), smoothstep(0.25, 0.8, shade));
    cloudCol += uSunColor * pow(sd, 4.0) * 0.45;
    float cmask = cover * smoothstep(0.015, 0.18, y);
    col = mix(col, cloudCol, cmask * 0.9);
  }
  col += (hash12(dir.xy * 541.0 + dir.z * 17.0) - 0.5) / 255.0; // dither
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
