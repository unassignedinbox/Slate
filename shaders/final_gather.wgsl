// ============================================================================
// FINAL_GATHER.WGSL — Lumen final gather.
// Per screen pixel: reconstruct the G-buffer surface, fire one blue-noise-jittered
// cosine-lobe cone through the global distance field; the cone's radiance is the
// clipmap-0 voxel lighting along its travel, plus a crisp surface-cache fetch when
// the cone stops inside clipmap 0 (this is what keeps emissive bleed sharp).
// Direct sun (soft SDF shadow + GGX) is added here too. History reprojects and
// accumulates through prevViewProj — Lumen's temporal accumulation.
//   T0 rgba16f : full linear radiance  (tonemapped by composite)
//   T1 rgba16f : indirect-only rgb | accepted-history fraction
//   T2 rgba16f : world pos xyz | frame tag (disocclusion record for next frame)
// ============================================================================
//@@common

@group(3) @binding(0) var gbT0 : texture_2d<f32>;
@group(3) @binding(1) var gbT1 : texture_2d<f32>;
@group(3) @binding(2) var gbT2 : texture_2d<f32>;
@group(3) @binding(3) var gbDepth : texture_depth_2d;
@group(3) @binding(4) var histA : texture_2d<f32>;   // previous frame full radiance
@group(3) @binding(5) var histB : texture_2d<f32>;   // previous frame world pos + tag
@group(3) @binding(6) var sampNearest : sampler;

struct GatherJob { dims : vec4f }   // gather w,h, scale(capture/gather), coverageScale
@group(3) @binding(7) var<uniform> job : GatherJob;

fn worldFromDepth(px : vec2f, depth : f32) -> vec3f {
  let ndc = vec3f(px.x * F.screen.z * 2.0 - 1.0, 1.0 - px.y * F.screen.w * 2.0, depth);
  let w = F.invViewProj * vec4f(ndc, 1.0);
  return w.xyz / w.w;
}

fn ggxSpec(n : vec3f, v : vec3f, l : vec3f, rough : vec4f, metal : f32, base : vec3f) -> vec3f {
  let h = normalize(v + l);
  let a = max(rough.x * rough.x, 0.002);
  let a2 = a * a;
  let ndh = max(dot(n, h), 0.0);
  let ndv = max(dot(n, v), 0.001);
  let ndl = max(dot(n, l), 0.001);
  let dd = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
  let k = a * 0.5;
  let g = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  let f0 = mix(vec3f(0.04), base, metal);
  let fres = f0 + (vec3f(1.0) - f0) * pow(1.0 - max(dot(h, l), 0.0), 5.0);
  return (dd * g / (4.0 * ndv * ndl)) * fres;
}

struct FsOut {
  @location(0) t0 : vec4f,
  @location(1) t1 : vec4f,
  @location(2) t2 : vec4f,
}

@vertex fn vsMain(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  // fullscreen triangle
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment fn fsMain(@builtin(position) fragCoord : vec4f) -> FsOut {
  let scale = job.dims.z;                                  // capture px per gather px
  let cpx = fragCoord.xy * scale;
  let giOn = (F.frame.w & 16u) != 0u;
  let cpxI = vec2i(clamp(cpx, vec2f(0.0), F.screen.xy - vec2f(1.0)));
  let depth = textureLoad(gbDepth, cpxI, 0);
  var o : FsOut;
  if depth >= 0.99999 {
    let env = skyRadiance(normalize(worldFromDepth(cpx, 0.9999) - F.camPos.xyz), true);
    o.t0 = vec4f(env, 0.0);
    o.t1 = vec4f(0.0);
    o.t2 = vec4f(0.0);
    return o;
  }
  let t0 = textureLoad(gbT0, cpxI, 0);
  let t1 = textureLoad(gbT1, cpxI, 0);
  let t2 = textureLoad(gbT2, cpxI, 0);
  let n = octDecode(t0.xy);
  let rough = t0.z;
  let metal = t0.w;
  let albedo = t1.rgb;
  let emissive = t2.rgb;
  let pos = worldFromDepth(cpx, depth);
  let toCam = normalize(F.camPos.xyz - pos);

  // ---- direct: punctual sun + SDF soft shadow + specular ---------------------------------
  let vis = sunVisibility(pos, n);
  let ndl = max(dot(n, F.sunDir.xyz), 0.0);
  var direct = albedo * (F.sunColor.xyz * ndl * vis) + ggxSpec(n, toCam, F.sunDir.xyz, vec4f(rough), metal, albedo) * (F.sunColor.xyz * ndl * vis);

  // ---- final gather cone ------------------------------------------------------------------
  let seed = vec3u(vec2u(fragCoord.xy), F.frame.x + F.frame.z);
  var indirect = vec3f(0.0);
  if giOn {
    let dir = cosineSampleHemisphere(n, seed);
    let start = pos + n * 0.12;
    let h = coneTrace(start, dir, 0.06, 90.0, 0.62);
    if h.hit > 0.5 {
      let p = start + dir * h.t;
      if u32(h.level) == 0u {
        let card = cardFetch(p, dir);
        let vox = voxelRadiance(p + n * 0.06);
        var L = vox.rgb;
        if card.w > 0.4 { L = mix(L * 0.45, card.rgb, 0.55); }
        let cov = clamp(1.0 - exp(-h.t * 1.6), 0.0, 1.0);      // nearby hits weight more (contact)
        indirect += albedo * L * cov;
      } else {
        let vox = voxelRadiance(p + n * 0.06);
        indirect += albedo * vox.rgb * 0.55;
      }
    } else {
      indirect += albedo * skyRadiance(dir, false) * smoothstep(0.5, 0.95, h.minRatio);
    }
  } else {
    indirect += albedo * skyRadiance(n, false);               // stages off: keep a neutral ambient
  }

  var lo = direct + indirect * F.zenith.w + emissive * F.slice.y;

  // ---- temporal accumulation (Lumen's history weighting) ------------------------------------
  var accepted = 0.0;
  if F.frame.x > 0u {
    let clip = F.prevViewProj * vec4f(pos, 1.0);
    if clip.w > 0.0 {
      let ndc = clip.xyz / clip.w;
      let puv = (ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5)) * job.dims.xy;
      if puv.x >= 0.0 && puv.x < job.dims.x - 1.0 && puv.y >= 0.0 && puv.y < job.dims.y - 1.0 {
        let ha = textureLoad(histA, vec2i(puv), 0);
        let hb = textureLoad(histB, vec2i(puv), 0);
        let dPos = distance(hb.xyz, pos);
        if dPos < 0.22 {
          let w = clamp(mix(0.22, 0.08, clamp(1.0 - dPos * 8.0, 0.0, 1.0)), 0.06, 0.3);
          lo = mix(lo, ha.rgb, 1.0 - w);
          accepted = 1.0;
        }
      }
    }
  }

  o.t0 = vec4f(lo, 0.0);
  o.t1 = vec4f(indirect * F.zenith.w, accepted);
  o.t2 = vec4f(pos, f32(F.frame.x % 65536u));
  return o;
}
