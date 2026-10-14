// ============================================================================
// COMPOSITE.WGSL — upsample the gather buffer to canvas, tonemap (ACES), and draw the
// debug views of every GI stage so the structure is inspectable while the car drives:
//   0 full · 1 indirect only · 2 direct only · 3 surface-cache atlas ·
//   4 global distance field top-down slice · 5 body mesh-SDF slice ·
//   6 voxel lighting slice · 7 mesh cards id view · 8 normals · 9 depth
// ============================================================================
//@@common

@group(3) @binding(0) var gatherFull : texture_2d<f32>;
@group(3) @binding(1) var gatherInd : texture_2d<f32>;
@group(3) @binding(2) var gatherSamp : sampler;
@group(3) @binding(3) var meshSdfView : texture_3d<f32>;
@group(3) @binding(4) var scPosView : texture_2d<u32>;
@group(3) @binding(5) var gbT0View : texture_2d<f32>;
@group(3) @binding(6) var gbDepthView : texture_depth_2d;
@group(3) @binding(7) var<uniform> sdfViewCfg : SdfViewCfg;
struct SdfViewCfg { bInv0 : vec4f, bInv1 : vec4f, bInv2 : vec4f, bInv3 : vec4f, bodyMin : vec4f, bodyInvSize : vec4f, pad : vec4f, pad2 : vec4f }

@vertex fn vsMain(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

fn aces(x0 : vec3f) -> vec3f {
  let x = x0 * (F.sunColor.w);                              // exposure
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn toSrgb(c : vec3f) -> vec3f { return pow(c, vec3f(1.0 / 2.2)); }
fn turbo(t0 : f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  return pow(vec3f(0.5) + vec3f(0.5) * cos(TWO_PI * (vec3f(0.0, 0.33, 0.67) + t)), vec3f(0.8));
}

// world pos of canvas pixel for top-down debug views (ortho, focus-centred)
fn topDownWorld(canvasPx : vec2f) -> vec3f {
  let span = 48.0;
  let uv = (canvasPx * F.canvas.zw - vec2f(0.5, 0.5)) * vec2f(1.0, -1.0);
  let aspect = F.canvas.x * F.canvas.z;
  return vec3f(FD.focus.x + uv.x * span * aspect, FD.focus.y + uv.y * span, F.slice.x);
}

@fragment fn fsMain(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
  let view = F.frame.y;
  let guv = fragCoord.xy * F.canvas.zw;

  if view == 0u || view == 1u || view == 2u {
    let full = textureSampleLevel(gatherFull, gatherSamp, guv, 0.0).rgb;
    let ind = textureSampleLevel(gatherInd, gatherSamp, guv, 0.0).rgb * F.zenith.w;
    var c = full;
    if view == 1u { c = ind * 2.0; }
    if view == 2u { c = max(full - ind, vec3f(0.0)); }
    return vec4f(toSrgb(aces(c)), 1.0);
  }

  if view == 3u {   // — surface cache: radiance atlas left half, coverage mask right half
    let px = vec2i(vec2f(fragCoord.x, F.canvas.y - fragCoord.y) * (1024.0 * F.canvas.z));
    var c = textureLoad(scRadiance, clamp(px, vec2i(0), vec2i(1023)), 0).rgb;
    if guv.x > 0.5 {
      let pb = textureLoad(scPosView, clamp(px, vec2i(0), vec2i(1023)), 0);
      c = select(vec3f(0.02, 0.03, 0.05), vec3f(0.1, 0.9, 0.4), pb.w == 1u);
    }
    return vec4f(toSrgb(aces(c * 0.5)), 1.0);
  }

  if view == 4u {   // — global distance field slice, colored by clipmap that owns each point
    let p = topDownWorld(fragCoord.xy);
    let level = clipIndexForRadius(distance(p, FD.focus.xyz));
    let s = gdfSample(p, 0u);                              // always ask the finest; falls coarser itself
    var col = vec3f(0.03);
    if s.z > 0.5 {
      let d = s.x / CLIP_DMAX[u32(s.y)];
      let heat = turbo(clamp(abs(d) * 3.0, 0.0, 1.0));
      col = mix(vec3f(1.0, 0.15, 0.1), heat, clamp(abs(d) * 8.0, 0.2, 1.0));
      if d < 0.0 { col = vec3f(0.1, 0.2, 0.9); }
      let lvlTint = select(select(vec3f(1.0), vec3f(0.72, 1.0, 0.35), u32(s.y) == 1u), vec3f(0.35, 0.7, 1.0), u32(s.y) == 2u);
      col *= lvlTint;
    } else {
      col = vec3f(0.02, 0.025, 0.035);
    }
    // tile grid + clipmap reach rings
    let cellp = (p.xy / CLIP_CELL[0u]);
    let g = min(fract(cellp.x), fract(cellp.y));
    if g < 0.02 { col += vec3f(0.08); }
    let r = distance(p.xy, FD.focus.xy);
    if abs(r - CLIP_RADIUS[0u]) < 0.4 { col = vec3f(1.0, 0.8, 0.2); }
    if abs(r - CLIP_RADIUS[1u]) < 0.8 { col = vec3f(0.4, 1.0, 0.6); }
    return vec4f(col, 1.0);
  }

  if view == 5u {   // — the ControlVehicle body mesh SDF (object-space XY slice through the live transform)
    let p = topDownWorld(fragCoord.xy);
    let po = vec3f(
      dot(sdfViewCfg.bInv0.xyz, p) + sdfViewCfg.bInv0.w,
      dot(sdfViewCfg.bInv1.xyz, p) + sdfViewCfg.bInv1.w,
      dot(sdfViewCfg.bInv2.xyz, p) + sdfViewCfg.bInv2.w);
    let bmin = sdfViewCfg.bodyMin.xyz;
    let bs = sdfViewCfg.bodyInvSize.xyz;
    let uvw = (po.xyz - bmin) * bs;
    var col = vec3f(0.04);
    if uvw.x > 0.0 && uvw.x < 1.0 && uvw.y > 0.0 && uvw.y < 1.0 && uvw.z > 0.0 && uvw.z < 1.0 {
      let s = textureSampleLevel(meshSdfView, gatherSamp, uvw, 0.0).r;
      col = turbo(clamp(abs(s) * 1.4, 0.0, 1.0)) * select(1.0, 0.35, s < 0.0);
      if s < 0.0 { col = vec3f(0.15, 0.3, 0.95); }
    }
    return vec4f(col, 1.0);
  }

  if view == 6u {   // — voxel lighting slice (clipmap 0)
    let p = topDownWorld(fragCoord.xy);
    let s = voxelRadiance(p);
    var col = aces(s.rgb * 2.5);
    let gdf = gdfSample(p, 0u);
    if gdf.z < 0.5 { col *= 0.25; }
    return vec4f(toSrgb(col), 1.0);
  }

  if view == 7u {   // — mesh cards debug: nearest covered card id as hue
    let p = topDownWorld(fragCoord.xy);
    let pool = gdfTileAt(p + vec3f(0.0, 0.0, 0.06), 0u);
    var col = vec3f(0.03, 0.04, 0.06);
    if pool != 0xFFFFFFFFu {
      let info = tileCardInfo[pool];
      let start = info & 0xFFFFFu;
      let count = info >> 20u;
      var bestD = 1e5; var bestI = 0xFFFFFFFFu;
      let pp = p + vec3f(0.0, 0.0, 0.06);
      for (var i = 0u; i < count; i++) {
        let ci = tileCardIds[start + i];
        let c = cardsWorld[ci];
        let d = pp - c.org.xyz;
        let slab = max(abs(dot(d, c.t.xyz)) - c.org.w, 0.0) + max(abs(dot(d, c.b.xyz)) - c.t.w, 0.0)
                 + max(max(c.b.w - dot(d, c.n.xyz), dot(d, c.n.xyz) - c.n.w), 0.0);
        if slab < bestD { bestD = slab; bestI = ci; }
      }
      if bestI != 0xFFFFFFFFu && bestD < 0.75 {
        col = turbo(f32(bestI % 97u) / 97.0);
      }
    }
    return vec4f(col, 1.0);
  }

  if view == 8u {   // — world normals (G-buffer)
    let s = textureSampleLevel(gbT0View, gatherSamp, guv, 0.0);
    return vec4f(octDecode(s.xy) * 0.5 + vec3f(0.5), 1.0);
  }
  if view == 9u {   // — linearized depth
    let d = textureLoad(gbDepthView, vec2i(fragCoord.xy) % vec2i(textureDimensions(gbDepthView)), 0);
    let lin = clamp(1.0 - sqrt(d), 0.0, 1.0);
    return vec4f(vec3f(lin), 1.0);
  }

  let full = textureSampleLevel(gatherFull, gatherSamp, guv, 0.0).rgb;
  return vec4f(toSrgb(aces(full)), 1.0);
}
