import { HEADER, NOISE } from '../core/shaders/lib';

/**
 * Viewport raymarcher for the hybrid SDF.
 *
 *   dGround(p) = p.y - H(p.xz) * heightScale        <- analytic, FULL resolution
 *   dCave(p)   = trilinear sample of the 3D volume  <- low resolution, smooth
 *   d(p)       = smax(dGround, -dCave, k)
 *
 * The ground term never passes through the voxel grid, so a 1024²–4096²
 * heightfield keeps every erosion channel razor sharp while the caves are free
 * to be a soft 128³. Marching uses relaxed sphere tracing (the heightfield term
 * is Lipschitz-bounded, not a true distance) followed by bisection refinement,
 * which is what keeps overhangs and thin arches from being missed.
 */
export const RAYMARCH_FRAG = /* glsl */ `${HEADER}
${NOISE}

uniform sampler2D uHeight;
uniform sampler2D uColor;
uniform sampler2D uWater;
uniform sampler3D uVolume;
uniform float uHasHeight, uHasColor, uHasWater, uHasVolume;

uniform vec3  uCamPos;
uniform vec3  uCamTarget;
uniform float uFov;
uniform float uWorldSize, uHeightScale, uExag;
uniform float uSeaLevel, uCaveBlend;
uniform vec3  uSunDir;
uniform float uSunIntensity, uAmbient;
uniform vec3  uSkyTop, uSkyBottom, uGroundCol;
uniform float uShowGrid, uShowWater, uShadows, uAO, uFog;
uniform float uQuality;     // 0.35 .. 1 -> step relaxation / iteration budget
uniform float uWireframe;   // heightfield contour overlay
uniform int   uShadeMode;   // 0 = shaded, 1 = albedo, 2 = normals, 3 = field
uniform float uTime;

layout(location = 0) out vec4 fragColor;

const float BIG = 1e9;

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k){ return -smin(-a, -b, k); }

vec2 worldToUV(vec2 xz){ return xz / uWorldSize + 0.5; }

float terrainH(vec2 xz){
  if (uHasHeight < 0.5) return 0.0;
  vec2 uv = worldToUV(xz);
  uv = clamp(uv, vec2(0.0005), vec2(0.9995));
  return texture(uHeight, uv).r * uHeightScale * uExag;
}

float waterH(vec2 xz){
  float w = uSeaLevel > 0.0 ? uSeaLevel * uHeightScale * uExag : -BIG;
  if (uHasWater > 0.5){
    vec2 uv = clamp(worldToUV(xz), vec2(0.0005), vec2(0.9995));
    float r = texture(uWater, uv).r;
    if (r > -1e3) w = max(w, r * uHeightScale * uExag);
  }
  return w;
}

float caveD(vec3 p){
  if (uHasVolume < 0.5) return BIG;
  vec3 uvw = vec3(worldToUV(p.xz), p.y / max(1.0, uHeightScale * uExag));
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return BIG;
  return texture(uVolume, uvw).r;
}

float mapGround(vec3 p){ return p.y - terrainH(p.xz); }

float map(vec3 p){
  float g = mapGround(p);
  if (uHasVolume < 0.5) return g;
  float c = caveD(p);
  float k = max(0.5, uCaveBlend);
  return smax(g, -c, k);
}

/** how much of the surface at p is cave wall rather than outer terrain */
float caveness(vec3 p){
  if (uHasVolume < 0.5) return 0.0;
  float g = mapGround(p);
  return clamp(1.0 - g / (-max(1.0, uCaveBlend) * 3.0 - 1.0), 0.0, 1.0);
}

bool boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out float t0, out float t1){
  vec3 inv = 1.0 / rd;
  vec3 a = (lo - ro) * inv;
  vec3 b = (hi - ro) * inv;
  vec3 mn = min(a, b), mx = max(a, b);
  t0 = max(max(mn.x, mn.y), mn.z);
  t1 = min(min(mx.x, mx.y), mx.z);
  return t1 > max(t0, 0.0);
}

vec3 calcNormal(vec3 p, float t){
  float e = max(uWorldSize * 2e-4, t * 8e-4);
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * e) +
    k.yyx * map(p + k.yyx * e) +
    k.yxy * map(p + k.yxy * e) +
    k.xxx * map(p + k.xxx * e));
}

/** relaxed sphere trace + bisection; returns t or -1 */
float trace(vec3 ro, vec3 rd, float tNear, float tFar, int maxSteps, out int steps){
  float t = tNear;
  float prevT = tNear;
  float prevD = map(ro + rd * tNear);
  steps = 0;
  if (prevD < 0.0) return tNear;
  float relax = mix(0.32, 0.62, uQuality);
  for (int i = 0; i < 512; i++){
    if (i >= maxSteps) break;
    steps = i;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0){
      // bisect between the last outside sample and here
      float lo = prevT, hi = t;
      for (int j = 0; j < 12; j++){
        float mid = 0.5 * (lo + hi);
        if (map(ro + rd * mid) < 0.0) hi = mid; else lo = mid;
      }
      return hi;
    }
    float eps = max(uWorldSize * 3e-5, t * 5e-4);
    if (d < eps) return t;
    prevT = t; prevD = d;
    t += max(d * relax, eps * 1.2);
    if (t > tFar) break;
  }
  return -1.0;
}

float softShadow(vec3 p, vec3 ldir){
  if (uShadows < 0.5) return 1.0;
  float res = 1.0;
  float t = uWorldSize * 0.002;
  float maxT = uWorldSize * 0.75;
  for (int i = 0; i < 48; i++){
    vec3 q = p + ldir * t;
    if (q.y > uHeightScale * uExag * 1.05) break;
    float d = map(q);
    if (d < 0.0) return 0.0;
    res = min(res, 12.0 * d / t);
    t += max(d * 0.6, uWorldSize * 0.0015);
    if (t > maxT) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcc(vec3 p, vec3 n){
  if (uAO < 0.5) return 1.0;
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++){
    float h = 0.002 + 0.06 * float(i) * uWorldSize * 0.25;
    float d = map(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.2 * occ / (uWorldSize * 0.25), 0.0, 1.0);
}

vec3 skyColor(vec3 rd){
  float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uSkyBottom, uSkyTop, pow(t, 0.9));
  float sun = pow(max(0.0, dot(rd, uSunDir)), 900.0);
  c += vec3(1.0, 0.92, 0.78) * sun * 3.0;
  float halo = pow(max(0.0, dot(rd, uSunDir)), 8.0);
  c += vec3(1.0, 0.85, 0.65) * halo * 0.12;
  return c;
}

/** Infinite reference grid, matching the viewport chrome. */
vec4 gridPlane(vec3 ro, vec3 rd, float tMax){
  if (uShowGrid < 0.5) return vec4(0.0);
  if (abs(rd.y) < 1e-6) return vec4(0.0);
  float t = -ro.y / rd.y;
  if (t < 0.0 || t > tMax) return vec4(0.0);
  vec3 p = ro + rd * t;
  float cell = uWorldSize / 32.0;
  vec2 g = abs(fract(p.xz / cell - 0.5) - 0.5) / fwidth(p.xz / cell);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec2 g10 = abs(fract(p.xz / (cell * 8.0) - 0.5) - 0.5) / fwidth(p.xz / (cell * 8.0));
  float line10 = 1.0 - min(min(g10.x, g10.y), 1.0);

  float fade = 1.0 - smoothstep(uWorldSize * 0.8, uWorldSize * 2.4, length(p.xz));
  vec3 col = mix(vec3(0.42), vec3(0.56), line10);
  float a = max(line * 0.28, line10 * 0.5) * fade;

  // axis lines
  float ax = 1.0 - min(abs(p.z) / fwidth(p.z) / 1.6, 1.0);
  float az = 1.0 - min(abs(p.x) / fwidth(p.x) / 1.6, 1.0);
  if (ax > 0.0){ col = mix(col, vec3(0.82, 0.30, 0.34), ax); a = max(a, ax * 0.85 * fade); }
  if (az > 0.0){ col = mix(col, vec3(0.30, 0.52, 0.85), az); a = max(a, az * 0.85 * fade); }
  return vec4(col, a);
}

void main(){
  vec2 uv = (vUV * 2.0 - 1.0);
  uv.x *= uRes.x / uRes.y;

  vec3 fwd = normalize(uCamTarget - uCamPos);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + uv.x * right * uFov + uv.y * up * uFov);
  vec3 ro = uCamPos;

  float top = uHeightScale * uExag * 1.02 + 1.0;
  vec3 lo = vec3(-uWorldSize * 0.5, -uHeightScale * uExag * 0.05, -uWorldSize * 0.5);
  vec3 hi = vec3( uWorldSize * 0.5,  top,                          uWorldSize * 0.5);

  vec3 col = skyColor(rd);
  float tMax = uWorldSize * 4.0;

  float t0, t1;
  bool inside = boxHit(ro, rd, lo, hi, t0, t1);
  float hitT = -1.0;
  int steps = 0;
  if (inside && uHasHeight > 0.5){
    float tn = max(t0, 0.0) + 1e-3;
    int budget = int(mix(140.0, 420.0, uQuality));
    hitT = trace(ro, rd, tn, min(t1, tMax), budget, steps);
  }

  // ---- water surface -------------------------------------------------------
  float waterT = -1.0;
  if (uShowWater > 0.5 && (uHasWater > 0.5 || uSeaLevel > 0.0)){
    // march the water field coarsely; it is nearly flat so this is cheap
    float tn = inside ? max(t0, 0.0) : 0.0;
    float tf = hitT > 0.0 ? hitT : min(t1 > 0.0 ? t1 : tMax, tMax);
    float prev = 0.0;
    float tt = tn;
    float dtw = (tf - tn) / 96.0;
    if (dtw > 0.0){
      vec3 q = ro + rd * tn;
      prev = q.y - waterH(q.xz);
      for (int i = 1; i <= 96; i++){
        tt = tn + dtw * float(i);
        vec3 p = ro + rd * tt;
        float f = p.y - waterH(p.xz);
        if (f < 0.0 && prev >= 0.0){
          float a = tt - dtw, b = tt;
          for (int j = 0; j < 8; j++){
            float m = 0.5 * (a + b);
            vec3 pm = ro + rd * m;
            if (pm.y - waterH(pm.xz) < 0.0) b = m; else a = m;
          }
          waterT = b;
          break;
        }
        prev = f;
      }
    }
  }

  vec3 surfaceCol = col;
  bool hitAnything = false;

  if (hitT > 0.0){
    hitAnything = true;
    vec3 p = ro + rd * hitT;
    vec3 n = calcNormal(p, hitT);

    vec2 uvw = clamp(worldToUV(p.xz), vec2(0.0), vec2(1.0));
    vec3 albedo = uHasColor > 0.5 ? texture(uColor, uvw).rgb : vec3(0.52, 0.50, 0.46);

    // Cave walls read as bare rock, damp and unlit by the sky.
    float cv = caveness(p);
    albedo = mix(albedo, vec3(0.19, 0.175, 0.165), cv);

    if (uShadeMode == 1){
      surfaceCol = albedo;
    } else if (uShadeMode == 2){
      surfaceCol = n * 0.5 + 0.5;
    } else if (uShadeMode == 3){
      float hv = uHasHeight > 0.5 ? texture(uHeight, uvw).r : 0.0;
      surfaceCol = vec3(clamp(hv, 0.0, 1.0));
    } else {
      float sh = softShadow(p + n * uWorldSize * 0.0008, uSunDir);
      float ao = ambientOcc(p, n) * mix(1.0, 0.35, cv);
      float ndl = max(0.0, dot(n, uSunDir));
      vec3 diff = albedo * uSunIntensity * ndl * sh * vec3(1.0, 0.96, 0.89);
      vec3 sky = albedo * uAmbient * (0.5 + 0.5 * n.y) * uSkyTop * ao;
      vec3 bounce = albedo * uGroundCol * 0.18 * (0.5 - 0.5 * n.y) * ao;
      // subtle specular sheen on wet channels
      vec3 h = normalize(uSunDir - rd);
      float spec = pow(max(0.0, dot(n, h)), 48.0) * 0.06 * sh;
      surfaceCol = diff + sky + bounce + vec3(spec);
    }

    if (uWireframe > 0.5){
      float hv = uHasHeight > 0.5 ? texture(uHeight, uvw).r : 0.0;
      float c = fract(hv * 40.0);
      float lw = min(c, 1.0 - c) / fwidth(hv * 40.0);
      surfaceCol = mix(vec3(0.05, 0.9, 0.7), surfaceCol, clamp(lw, 0.0, 1.0));
    }

    float fog = 1.0 - exp(-hitT * uFog / uWorldSize);
    surfaceCol = mix(surfaceCol, skyColor(rd), clamp(fog, 0.0, 1.0));
    col = surfaceCol;
  }

  // grid under / behind the terrain
  vec4 g = gridPlane(ro, rd, hitT > 0.0 ? hitT : tMax);
  if (g.a > 0.0) col = mix(col, g.rgb, g.a);

  // ---- water shading -------------------------------------------------------
  if (waterT > 0.0 && (hitT < 0.0 || waterT < hitT)){
    vec3 wp = ro + rd * waterT;
    float e = uWorldSize * 0.0015;
    vec3 wn = normalize(vec3(
      waterH(wp.xz - vec2(e, 0.0)) - waterH(wp.xz + vec2(e, 0.0)),
      2.0 * e,
      waterH(wp.xz - vec2(0.0, e)) - waterH(wp.xz + vec2(0.0, e))));
    // fine ripples
    vec2 rp = wp.xz / uWorldSize * 340.0;
    float r1 = valueNoise2(rp + uTime * 0.35);
    float r2 = valueNoise2(rp * 1.9 - uTime * 0.21);
    wn = normalize(wn + vec3(r1, 0.0, r2) * 0.045);

    float bedH = terrainH(wp.xz);
    float depth = max(0.0, wp.y - bedH);
    vec3 refl = skyColor(reflect(rd, wn));
    float fres = pow(1.0 - max(0.0, dot(-rd, wn)), 5.0);
    fres = mix(0.03, 1.0, fres);

    vec3 deepCol = vec3(0.035, 0.085, 0.105);
    vec3 shallow = col;
    float absorb = 1.0 - exp(-depth * 0.09);
    vec3 water = mix(shallow, deepCol, clamp(absorb, 0.0, 1.0));
    water = mix(water, refl, clamp(fres, 0.0, 1.0));

    float spec = pow(max(0.0, dot(reflect(-uSunDir, wn), -rd)), 180.0);
    water += vec3(1.0, 0.95, 0.85) * spec * 1.4;

    float fog = 1.0 - exp(-waterT * uFog / uWorldSize);
    col = mix(water, skyColor(rd), clamp(fog, 0.0, 1.0));
  }

  // tonemap + gamma
  col = col / (1.0 + col * 0.42);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}
`;
