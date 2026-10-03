// ============================================================================
// Post passes for screen-space fluid:
//  - depth-aware separable blur of the fluid depth buffer (narrow-range)
//  - composite: normal reconstruction, Beer-Lambert absorption, refraction,
//    fresnel reflection, per-fluid material shading, tonemap + upscale
// ============================================================================

struct Cam {
  view     : mat4x4f,
  proj     : mat4x4f,
  invView  : mat4x4f,
  invProj  : mat4x4f,
  eye      : vec3f,
  time     : f32,
  sunDir   : vec3f,
  pRadius  : f32,
  res      : vec2f,       // scaled render resolution
  thickRadius : f32,
  pad      : f32,
};
@group(0) @binding(0) var<uniform> cam : Cam;

const SUN_COLOR = vec3f(1.0, 0.96, 0.9);

fn sky(dIn: vec3f) -> vec3f {
  let d = normalize(dIn);
  let t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  var c = mix(vec3f(0.42, 0.45, 0.50), vec3f(0.55, 0.68, 0.88), pow(t, 0.55));
  c += vec3f(0.9, 0.75, 0.55) * 0.18 * pow(1.0 - abs(d.y), 5.0);
  let sd = max(dot(d, cam.sunDir), 0.0);
  c += SUN_COLOR * (pow(sd, 450.0) * 20.0 + pow(sd, 32.0) * 0.28);
  if (d.y < 0.0) {
    c = mix(c, vec3f(0.18, 0.18, 0.20), clamp(-d.y * 3.0, 0.0, 1.0));
  }
  return c;
}

// --------------------------------------------------------------- fullscreen

struct FullOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FullOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

// --------------------------------------------------------------- blur pass

struct BlurP {
  dir        : vec2f,  // (1,0) or (0,1)
  worldRadius: f32,    // blur footprint in world units
  depthRange : f32,    // bilateral range falloff
};
@group(1) @binding(0) var blurSrc : texture_2d<f32>;
@group(1) @binding(1) var<uniform> blurP : BlurP;

@fragment
fn fsBlur(in: FullOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(blurSrc));
  let ip = clamp(vec2i(in.pos.xy), vec2i(0), dims - vec2i(1));
  let z = textureLoad(blurSrc, ip, 0).r;
  if (z > 1e8) { return vec4f(1e9, 0.0, 0.0, 1.0); }

  // projected pixel radius of the blur footprint at this depth
  let rPix = clamp(blurP.worldRadius * cam.proj[1][1] * cam.res.y * 0.5 / z, 1.0, 18.0);
  let sigma = rPix * 0.55;
  let inv2s2 = 1.0 / (2.0 * sigma * sigma);
  let invR2 = 1.0 / (blurP.depthRange * blurP.depthRange);

  var sum = z;
  var wsum = 1.0;
  let d = vec2i(blurP.dir);
  for (var k = -18; k <= 18; k++) {
    if (k == 0) { continue; }
    let fk = f32(k);
    if (abs(fk) > rPix) { continue; }
    let sp = clamp(ip + d * k, vec2i(0), dims - vec2i(1));
    let zj = textureLoad(blurSrc, sp, 0).r;
    if (zj > 1e8) { continue; }
    let dz = zj - z;
    let w = exp(-fk * fk * inv2s2) * exp(-dz * dz * invR2);
    sum += zj * w;
    wsum += w;
  }
  return vec4f(sum / wsum, 0.0, 0.0, 1.0);
}

// ------------------------------------------------------------ composite

struct MatU {
  base       : vec3f,
  opacityK   : f32,
  absorb     : vec3f,
  roughness  : f32,
  specI      : f32,
  refractK   : f32,
  grain      : f32,
  fresnelK   : f32,
  scaledRes  : vec2f,
  fullRes    : vec2f,
};
@group(1) @binding(0) var<uniform> matU : MatU;
@group(1) @binding(1) var smpLin : sampler;
@group(1) @binding(2) var sceneTex : texture_2d<f32>;
@group(1) @binding(3) var thickTex : texture_2d<f32>;
@group(1) @binding(4) var depthTex : texture_2d<f32>; // textureLoad only (r32float)

fn loadZ(ip: vec2i) -> f32 {
  let dims = vec2i(matU.scaledRes);
  return textureLoad(depthTex, clamp(ip, vec2i(0), dims - vec2i(1)), 0).r;
}

fn viewPosAt(uv: vec2f, z: f32) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0);
  return vec3f(ndc.x * z / cam.proj[0][0], ndc.y * z / cam.proj[1][1], -z);
}

fn hash3(p: vec3f) -> vec3f {
  var q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453) - 0.5;
}

fn tonemap(cIn: vec3f) -> vec3f {
  let x = max(cIn, vec3f(0.0));
  let m = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(m, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

@fragment
fn fsComposite(in: FullOut) -> @location(0) vec4f {
  let uv = in.pos.xy / matU.fullRes;
  let sceneCol = textureSampleLevel(sceneTex, smpLin, uv, 0.0).rgb;

  let ip = vec2i(uv * matU.scaledRes);
  let z = loadZ(ip);
  if (z > 1e8) {
    return vec4f(tonemap(sceneCol), 1.0);
  }

  // --- reconstruct view-space position & normal from blurred depth
  let du = vec2f(1.0 / matU.scaledRes.x, 0.0);
  let dv = vec2f(0.0, 1.0 / matU.scaledRes.y);
  let pC = viewPosAt(uv, z);

  let zR = loadZ(ip + vec2i(1, 0));
  let zL = loadZ(ip - vec2i(1, 0));
  let zD = loadZ(ip + vec2i(0, 1));
  let zU = loadZ(ip - vec2i(0, 1));

  var ddx = viewPosAt(uv + du, zR) - pC;
  let ddx2 = pC - viewPosAt(uv - du, zL);
  if (abs(ddx2.z) < abs(ddx.z)) { ddx = ddx2; }
  var ddy = viewPosAt(uv + dv, zD) - pC;
  let ddy2 = pC - viewPosAt(uv - dv, zU);
  if (abs(ddy2.z) < abs(ddy.z)) { ddy = ddy2; }

  var nV = normalize(cross(ddy, ddx));
  if (nV.z < 0.0) { nV = -nV; }

  let wp = (cam.invView * vec4f(pC, 1.0)).xyz;
  var n = normalize((cam.invView * vec4f(nV, 0.0)).xyz);

  // mud / rough fluids: granular normal perturbation
  if (matU.grain > 0.001) {
    n = normalize(n + hash3(floor(wp * 55.0)) * matU.grain * 0.45);
  }

  let V = normalize(cam.eye - wp);
  let th = max(textureSampleLevel(thickTex, smpLin, uv, 0.0).r, 0.0);

  // --- diffuse body (opaque fluids: milk, chocolate, mud)
  let ndl = max(dot(n, cam.sunDir), 0.0);
  let wrap = max((dot(n, cam.sunDir) + 0.4) / 1.4, 0.0); // wrapped diffuse ~ SSS
  var diffuse = matU.base * (0.45 * sky(n) + SUN_COLOR * mix(ndl, wrap, 0.6) * 0.95);
  // thickness-based self-shadowing (depth cue in chocolate/mud)
  diffuse *= mix(1.0, 0.45 + 0.55 * exp(-th * 0.55), clamp(matU.opacityK * 0.12, 0.0, 1.0));

  // --- refraction + absorption (transparent fluids: water)
  let refrUv = clamp(uv - nV.xy * matU.refractK * min(th, 1.2), vec2f(0.001), vec2f(0.999));
  let bg = textureSampleLevel(sceneTex, smpLin, refrUv, 0.0).rgb;
  let trans = bg * exp(-matU.absorb * th);

  let alpha = 1.0 - exp(-matU.opacityK * th);
  var col = mix(trans, diffuse, alpha);

  // --- specular + fresnel reflection
  let hv = normalize(cam.sunDir + V);
  let shin = mix(900.0, 14.0, clamp(matU.roughness, 0.0, 1.0));
  let spec = pow(max(dot(n, hv), 0.0), shin) * matU.specI;
  let fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let F = 0.02 + fres * matU.fresnelK;
  col += sky(reflect(-V, n)) * F;
  col += SUN_COLOR * spec * (1.0 + 2.0 * fres);

  // soften rim where the fluid gets vanishingly thin
  let edge = clamp(th * 14.0, 0.0, 1.0);
  col = mix(sceneCol, col, edge);

  return vec4f(tonemap(col), 1.0);
}
