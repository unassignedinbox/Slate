/**
 * WebGL2 GLSL 300 es Shaders for the Cloth & Human Avatar Fallback Engine
 * Matches the WGSL physically-based anisotropic silk/satin/velvet shading and debug channels.
 */

export const GLSL_FLOOR_VS = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
out vec3 vWorldPos;

void main() {
  vec2 quad[6] = vec2[6](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0,  1.0)
  );
  vec2 p = quad[gl_VertexID] * 3.6;
  vec3 world = vec3(p.x, -0.039, p.y);
  vWorldPos = world;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const GLSL_FLOOR_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
uniform vec3 uTrimColor;
out vec4 fragColor;

void main() {
  float r = length(vWorldPos.xz);
  if (r > 3.5) discard;
  float fade = clamp(1.0 - r / 3.5, 0.0, 1.0);
  vec2 g = abs(fract(vWorldPos.xz * 4.0 - 0.5) - 0.5) / fwidth(vWorldPos.xz * 4.0);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float ring = 1.0 - clamp(abs(r - 0.56) / 0.012, 0.0, 1.0);
  float shadow = smoothstep(0.08, 0.65, r);
  vec3 col = vec3(0.075, 0.078, 0.085) * (0.45 + 0.55 * shadow);
  col += vec3(0.11, 0.115, 0.125) * line * fade * 0.45;
  col += uTrimColor * ring * 0.22;
  fragColor = vec4(col * fade, 1.0);
}
`;

export const GLSL_AVATAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
uniform mat4 uViewProj;
out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vWorldPos = aPos;
  vNormal = aNrm;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const GLSL_AVATAR_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
uniform vec4 uCameraPos;   // xyz: pos, w: exposure
uniform vec4 uLightDir;    // xyz: dir, w: sunIntensity
uniform vec4 uPrimaryCol;  // rgb: primary, w: ambientIntensity
uniform vec4 uExtraParams; // x: channel, y: sss, z: seams, w: avatarFinish
out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos.xyz - vWorldPos);
  vec3 L = normalize(uLightDir.xyz);
  vec3 H = normalize(V + L);

  int finish = int(uExtraParams.w + 0.5);
  vec3 baseCol = vec3(0.76, 0.65, 0.58);
  float rough = 0.36;
  float metallic = 0.04;
  if (finish == 1) {
    baseCol = vec3(0.56, 0.41, 0.28);
    rough = 0.25;
    metallic = 0.65;
  } else if (finish == 2) {
    baseCol = vec3(0.18, 0.19, 0.21);
    rough = 0.52;
  } else if (finish == 3) {
    baseCol = vec3(0.86, 0.85, 0.83);
    rough = 0.28;
  }

  if (vWorldPos.y < 0.006) {
    baseCol = vec3(0.12, 0.125, 0.135);
    rough = 0.28;
  }

  float wrapDiff = max(0.0, (dot(N, L) + 0.35) / 1.35);
  float ndv = max(0.001, dot(N, V));
  float ndh = max(0.0, dot(N, H));
  float specPow = exp2(10.0 * (1.0 - rough));
  float spec = pow(ndh, specPow) * (0.12 + 0.65 * metallic);
  float rim = pow(1.0 - ndv, 3.2) * 0.28;

  float sunI = uLightDir.w * 0.48;
  float ambI = uPrimaryCol.w * 0.42;

  vec3 color = baseCol * (ambI * (0.6 + 0.4 * N.y) + sunI * wrapDiff)
             + vec3(1.0, 0.97, 0.92) * spec * sunI + baseCol * rim;
  color = vec3(1.0) - exp(-color * uCameraPos.w);
  fragColor = vec4(color, 1.0);
}
`;

export const GLSL_CLOTH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPosStrain;
layout(location = 1) in vec4 aNormal;
layout(location = 2) in vec4 aUVPanel;
layout(location = 3) in vec4 aVelSdf;

uniform mat4 uViewProj;
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vUVPanel;
out vec4 vTelemetry;

void main() {
  vWorldPos = aPosStrain.xyz;
  vNormal = aNormal.xyz;
  vUVPanel = aUVPanel;
  vTelemetry = vec4(aPosStrain.w, length(aVelSdf.xyz), aVelSdf.w, 0.0);
  gl_Position = uViewProj * vec4(aPosStrain.xyz, 1.0);
}
`;

export const GLSL_CLOTH_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vUVPanel;
in vec4 vTelemetry;

uniform vec4 uCameraPos;
uniform vec4 uLightDir;
uniform vec4 uPrimaryCol;
uniform vec4 uSheenCol;
uniform vec4 uTrimCol;
uniform vec4 uWeaveParams;
uniform vec4 uExtraParams;

out vec4 fragColor;

vec3 evalWeavePattern(vec2 uv, int weaveType, float scale) {
  vec2 p = uv * scale * vec2(2.4, 1.8);
  float wx = sin(p.x * 6.2831853);
  float wy = sin(p.y * 6.2831853);

  if (weaveType == 0) {
    float h = 0.65 * wx + 0.35 * wy;
    return vec3(cos(p.x * 6.28318) * 0.35, cos(p.y * 6.28318) * 0.15, h);
  } else if (weaveType == 1) {
    float diag = sin((p.x + p.y * 1.5) * 6.2831853);
    return vec3(diag * 0.45, -diag * 0.32, diag);
  } else if (weaveType == 2) {
    float c1 = sin(p.x * 9.0 + sin(p.y * 7.0) * 1.8);
    float c2 = cos(p.y * 9.0 + sin(p.x * 7.0) * 1.8);
    return vec3(c1 * 0.5, c2 * 0.5, 0.5 * (c1 + c2));
  } else if (weaveType == 3) {
    float tuft = sin(p.x * 12.5) * sin(p.y * 12.5);
    return vec3(tuft * 0.25, tuft * 0.25, tuft);
  } else if (weaveType == 4) {
    float grid = max(abs(wx), abs(wy));
    return vec3(wx * 0.4, wy * 0.4, grid);
  } else {
    vec2 cell = fract(p * 0.85) - vec2(0.5);
    float d = length(cell);
    float seq = smoothstep(0.45, 0.22, d);
    return vec3(cell.x * seq * 1.4, cell.y * seq * 1.4, seq);
  }
}

vec3 heatmapColor(float t) {
  float x = clamp(t, 0.0, 1.0);
  return clamp(
    vec3(
      1.5 - abs(4.0 * x - 3.0),
      1.5 - abs(4.0 * x - 2.0),
      1.5 - abs(4.0 * x - 1.0)
    ),
    vec3(0.0),
    vec3(1.0)
  );
}

vec3 pieSizingColor(float sizingMm) {
  float t = clamp((sizingMm - 2.5) / 10.5, 0.0, 1.0);
  vec3 c0 = vec3(0.22, 0.18, 0.78);
  vec3 c1 = vec3(0.12, 0.68, 0.88);
  vec3 c2 = vec3(0.28, 0.85, 0.52);
  vec3 c3 = vec3(0.98, 0.62, 0.24);
  if (t < 0.33) return mix(c0, c1, t / 0.33);
  if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33);
  return mix(c2, c3, (t - 0.66) / 0.34);
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;

  vec2 uv = vUVPanel.xy;
  int panelId = int(floor(vUVPanel.z + 0.0001));
  float sizingMm = fract(vUVPanel.z) * 20.0;
  float pleatPhase = vUVPanel.w;
  float strain = vTelemetry.x;
  float velMag = vTelemetry.y;
  float sdfClear = vTelemetry.z;

  int weaveType = int(uWeaveParams.x + 0.5);
  float weaveScale = uWeaveParams.y;
  float weaveBump = uWeaveParams.z;
  float roughness = uWeaveParams.w;
  int channel = int(uExtraParams.x + 0.5);

  vec3 weave = evalWeavePattern(uv, weaveType, weaveScale);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, N) + vec3(1e-4, 0.0, 0.0));
  vec3 B = normalize(cross(N, T));
  N = normalize(N + (T * weave.x + B * weave.y) * weaveBump * 0.32);

  vec3 L = normalize(uLightDir.xyz);
  float ndl = max(0.0, dot(N, L));

  if (channel == 1) {
    fragColor = vec4(heatmapColor(strain * 1.6), 1.0);
    return;
  } else if (channel == 2) {
    vec3 pCol = vec3(0.22, 0.55, 0.85);
    if (panelId == 1) pCol = vec3(0.32, 0.72, 0.58);
    if (panelId == 2) pCol = vec3(0.88, 0.58, 0.30);
    if (panelId == 3) pCol = vec3(0.76, 0.42, 0.72);
    vec2 uvScaled = uv * 24.0;
    vec2 duv = max(fwidth(uvScaled), vec2(1e-4));
    vec2 gridDist = abs(fract(uvScaled - 0.5) - 0.5) / duv;
    float line = 1.0 - clamp(min(gridDist.x, gridDist.y), 0.0, 1.0);
    vec3 shadedPanel = pCol * (0.76 + 0.24 * ndl) + vec3(line * 0.28);
    fragColor = vec4(clamp(shadedPanel, vec3(0.0), vec3(1.0)), 1.0);
    return;
  } else if (channel == 3) {
    fragColor = vec4(N * 0.5 + vec3(0.5), 1.0);
    return;
  } else if (channel == 4) {
    fragColor = vec4(heatmapColor(velMag * 0.45), 1.0);
    return;
  } else if (channel == 5) {
    fragColor = vec4(heatmapColor(1.0 - sdfClear), 1.0);
    return;
  } else if (channel == 6) {
    vec3 baseCol = pieSizingColor(sizingMm);
    float iso = abs(fract(sizingMm * 0.75) - 0.5);
    float isoLine = smoothstep(0.06, 0.015, iso) * 0.28;
    vec3 shaded = baseCol * (0.68 + 0.32 * ndl) + vec3(isoLine);
    fragColor = vec4(clamp(shaded, vec3(0.0), vec3(1.0)), 1.0);
    return;
  }

  vec3 V = normalize(uCameraPos.xyz - vWorldPos);
  vec3 H = normalize(V + L);

  float ndv = max(0.001, dot(N, V));
  float ndh = max(0.0, dot(N, H));

  vec3 albedo = uPrimaryCol.rgb * (1.08 - 0.24 * uv.y);
  albedo *= 0.92 + 0.14 * weave.z * weaveBump;
  float pleatAO = 0.86 + 0.14 * pleatPhase;
  albedo *= pleatAO;
  if (!gl_FrontFacing) albedo *= 0.72;

  float hemBand = smoothstep(0.952, 0.968, uv.y) + smoothstep(0.032, 0.015, uv.y);
  float lacePattern = 0.5 + 0.5 * sin(uv.x * 120.0);
  float trimMask = clamp(hemBand * (0.7 + 0.3 * lacePattern) * uTrimCol.w, 0.0, 1.0);
  albedo = mix(albedo, uTrimCol.rgb, trimMask);

  if (uExtraParams.z > 0.5) {
    float sideSeam = min(abs(uv.x - 0.5), min(uv.x, 1.0 - uv.x));
    float waistSeam = abs(uv.y - 0.28);
    float stitchDash = step(0.4, fract((uv.x + uv.y) * 90.0));
    float seamMask = (smoothstep(0.0045, 0.0015, sideSeam) + smoothstep(0.005, 0.0015, waistSeam)) * stitchDash;
    albedo = mix(albedo, uTrimCol.rgb * 0.95, clamp(seamMask * 0.55, 0.0, 1.0));
  }

  float sinTH = sqrt(max(0.0, 1.0 - dot(T, H) * dot(T, H)));
  float anisoSpec = pow(sinTH, exp2(6.0 * (1.0 - roughness))) * ndl * 0.45;
  float fresnelSheen = pow(1.0 - ndv, 2.6) * uSheenCol.w;
  vec3 sheenContrib = uSheenCol.rgb * (fresnelSheen * 0.55 + anisoSpec * uSheenCol.w * 0.65);

  float backLight = max(0.0, dot(-N, L));
  vec3 sss = uPrimaryCol.rgb * backLight * uExtraParams.y * 0.38;

  float sunI = uLightDir.w * 0.52;
  float ambI = uPrimaryCol.w * 0.50;
  float hemiAmb = ambI * (0.65 + 0.35 * N.y) * pleatAO;

  vec3 color = albedo * (hemiAmb + sunI * (ndl * 0.82 + 0.18))
             + sheenContrib * (0.45 + 0.55 * sunI)
             + sss * sunI;

  if (weaveType == 5) {
    float sparkle = pow(ndh, 48.0) * max(0.0, weave.z) * 1.8;
    color += uTrimCol.rgb * sparkle * sunI;
  }

  vec3 exposed = color * uCameraPos.w;
  vec3 mapped = (exposed * (2.51 * exposed + 0.03)) / (exposed * (2.43 * exposed + 0.59) + 0.14);
  fragColor = vec4(clamp(mapped, vec3(0.0), vec3(1.0)), 1.0);
}
`;
