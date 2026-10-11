// Resolve pass: exposure, ACES-ish filmic tonemap, subtle grade, vignette, dithered output.

export const POST_WGSL = /* wgsl */ `
struct Post {
  params : vec4f,   // exposure, vignette, grain, time
  grade  : vec4f,   // lift, gamma, saturation, contrast
};

@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSamp: sampler;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  let q = p[vi];
  o.clip = vec4f(q, 0.0, 1.0);
  o.uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  return o;
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn hash12(p: vec2f) -> f32 {
  var h = fract(p * vec2f(0.1031, 0.1030));
  h += dot(h, h.yx + 33.33);
  return fract((h.x + h.y) * h.x * 97.0);
}

@fragment
fn fs_main(i: VSOut) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(srcTex));
  let texel = 1.0 / dim;
  var c = textureSample(srcTex, srcSamp, i.uv).rgb;

  // light edge-aware sharpen keeps kerb lines and markings crisp after MSAA resolve
  let n1 = textureSample(srcTex, srcSamp, i.uv + vec2f(texel.x, 0.0)).rgb;
  let n2 = textureSample(srcTex, srcSamp, i.uv - vec2f(texel.x, 0.0)).rgb;
  let n3 = textureSample(srcTex, srcSamp, i.uv + vec2f(0.0, texel.y)).rgb;
  let n4 = textureSample(srcTex, srcSamp, i.uv - vec2f(0.0, texel.y)).rgb;
  c = clamp(c + (c * 4.0 - n1 - n2 - n3 - n4) * 0.085, vec3f(0.0), vec3f(64.0));

  c *= P.params.x;
  var m = aces(c);

  // grade: contrast around 0.42, saturation, gentle lift
  m = (m - 0.42) * P.grade.w + 0.42 + P.grade.x;
  let lum = dot(m, vec3f(0.2126, 0.7152, 0.0722));
  m = mix(vec3f(lum), m, P.grade.z);
  m = pow(max(m, vec3f(0.0)), vec3f(P.grade.y));

  // vignette
  let d = distance(i.uv, vec2f(0.5));
  m *= 1.0 - smoothstep(0.42, 0.96, d) * P.params.y;

  // film grain + dither
  let g = hash12(i.uv * dim + P.params.w);
  m += (g - 0.5) * P.params.z;
  m += (hash12(i.uv * dim * 1.7 + 13.0) - 0.5) * (1.0 / 255.0);
  return vec4f(clamp(m, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
