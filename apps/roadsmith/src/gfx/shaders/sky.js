// Full-screen physical-ish sky: Rayleigh-tinted gradient, sun disc, horizon haze, star field at night.

import { STRUCTS, BINDINGS, NOISE } from './common.js';

export const SKY_WGSL = /* wgsl */ `
${STRUCTS}
${BINDINGS}
${NOISE}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.clip = vec4f(p[vi], 1.0, 1.0);
  o.ndc = p[vi];
  return o;
}

fn rayDir(ndc: vec2f) -> vec3f {
  let m = G.invViewProj;
  let near = m * vec4f(ndc, 0.0, 1.0);
  let far = m * vec4f(ndc, 1.0, 1.0);
  return normalize(far.xyz / far.w - near.xyz / near.w);
}

@fragment
fn fs_main(i: VSOut) -> @location(0) vec4f {
  let d = rayDir(i.ndc);
  let up = clamp(d.y, -1.0, 1.0);
  let sun = normalize(G.sunDir.xyz);
  let mu = dot(d, sun);

  let zenith = G.skyColour.rgb;
  let horizon = G.horizon.rgb;
  var col = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.62));
  // below the horizon: ground haze
  col = mix(G.fog.rgb * 0.75, col, smoothstep(-0.12, 0.04, up));

  // forward scattering + sun disc with soft limb
  let halo = pow(max(mu, 0.0), 24.0) * 0.55 + pow(max(mu, 0.0), 5.0) * 0.12;
  col += G.sunColour.rgb * halo * G.sunDir.w * 0.6;
  let disc = smoothstep(0.99955, 0.99985, mu);
  col += G.sunColour.rgb * disc * G.sunDir.w * 9.0;

  // night: stars and a cooler dome
  let night = G.flags.z;
  if (night > 0.01) {
    // gnomonic-ish projection of the dome onto a 2D star field
    let sp = d.xz / max(abs(d.y) + 0.35, 0.001);
    let cell = worley(sp * 42.0);
    let star = smoothstep(0.055, 0.0, cell.x) * step(0.84, cell.y) * smoothstep(0.0, 0.25, up);
    let twinkle = 0.6 + 0.4 * sin(G.camPos.w * 2.1 + cell.y * 90.0);
    col += vec3f(0.85, 0.9, 1.0) * star * twinkle * night * 0.9;
  }

  // very light banding breakup
  col += (hash21(i.ndc * 937.0) - 0.5) * 0.0025;
  return vec4f(col, 1.0);
}
`;
