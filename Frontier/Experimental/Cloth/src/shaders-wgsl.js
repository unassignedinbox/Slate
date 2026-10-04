/**
 * WebGPU WGSL Compute & Physically-Based Render Shaders for Real-Time Dress Simulation
 * - @compute @workgroup_size(64) XPBD Cloth Solver with 16-Capsule Articulated Human Avatar SDF Collision
 * - Physically-based Anisotropic Silk/Satin/Velvet/Organza Dress Shader + Sculpted Mannequin Shader
 */

export const WGSL_CLOTH_COMPUTE_SHADER = /* wgsl */ `
struct SimParams {
  gridInfo     : vec4<f32>, // x: numCols, y: numRows, z: vertexCount, w: dt
  solverInfo   : vec4<f32>, // x: stretchCompliance, y: shearCompliance, z: bendStiffness, w: damping
  envInfo      : vec4<f32>, // x: gravity, y: clothThickness, z: bodyFriction, w: time
  windInfo     : vec4<f32>, // x: windX, y: windY, z: windZ, w: windTurbulence
  avatarMotion : vec4<f32>, // x: yaw, y: offsetY, z: hipSwingX, w: shoulderTilt
  brushPos     : vec4<f32>, // x, y, z, w: active (0 or 1)
  brushVel     : vec4<f32>, // x, y, z, w: radius
  impulseInfo  : vec4<f32>, // x: updraft, y: twirlOmega, z: windEnabled, w: pad
  capsules     : array<vec4<f32>, 48>, // 16 capsules * 3 vec4f (pA_rA, pB_rB, vel_pad)
};

@group(0) @binding(0) var<uniform> uSim : SimParams;
@group(0) @binding(1) var<storage, read> posIn : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> posOut : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> prevPos : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> restLengths : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> anchorTargets : array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> normalsOut : array<vec4<f32>>;

fn transformAnchor(localPos: vec3<f32>) -> vec3<f32> {
  let yaw = uSim.avatarMotion.x;
  let offsetY = uSim.avatarMotion.y;
  let hipSwingX = uSim.avatarMotion.z;
  let shoulderTilt = uSim.avatarMotion.w;

  let y = localPos.y + offsetY;
  let hipInf = max(0.0, 1.0 - abs(localPos.y - 0.90) / 0.32);
  let upperInf = clamp((localPos.y - 1.02) / 0.45, 0.0, 1.0);
  let lx = localPos.x + hipSwingX * hipInf + shoulderTilt * upperInf;
  let lz = localPos.z;

  let c = cos(yaw);
  let s = sin(yaw);
  return vec3<f32>(lx * c + lz * s, y, -lx * s + lz * c);
}

fn wrapCol(c: i32, numCols: i32) -> i32 {
  let m = c % numCols;
  return select(m, m + numCols, m < 0);
}

fn idxOf(c: i32, r: i32, numCols: i32) -> u32 {
  return u32(r * numCols + wrapCol(c, numCols));
}

@compute @workgroup_size(64)
fn csPredict(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = u32(uSim.gridInfo.z);
  if (idx >= count) {
    return;
  }

  let dt = uSim.gridInfo.w;
  let pCurr = posIn[idx];
  let velData = velocities[idx];
  let anchor = anchorTargets[idx];
  let pinWeight = anchor.w;

  prevPos[idx] = vec4<f32>(pCurr.xyz, pinWeight);

  var acc = vec3<f32>(0.0, -uSim.envInfo.x, 0.0);

  // Aerodynamic wind + spatial gust turbulence
  if (uSim.impulseInfo.z > 0.5) {
    let t = uSim.envInfo.w;
    let turb = uSim.windInfo.w;
    let gust = vec3<f32>(
      sin(pCurr.y * 5.5 + pCurr.z * 3.8 + t * 3.4),
      0.35 * cos(pCurr.x * 4.8 - t * 2.7),
      cos(pCurr.x * 5.2 + pCurr.y * 4.1 - t * 3.1)
    ) * turb;
    let windVec = uSim.windInfo.xyz + gust;
    let nrm = normalsOut[idx].xyz;
    let normalFacing = abs(dot(nrm, normalize(windVec + vec3<f32>(1e-4, 0.0, 0.0))));
    acc += windVec * (0.85 + 1.65 * normalFacing);
  }

  // Updraft gust & centrifugal twirl impulse
  let updraft = uSim.impulseInfo.x;
  let twirlOmega = uSim.impulseInfo.y;
  if (abs(updraft) > 1e-3) {
    acc.y += updraft * (1.15 - 0.4 * clamp(pCurr.y, 0.0, 1.5));
  }
  if (abs(twirlOmega) > 1e-3) {
    let radial = vec3<f32>(pCurr.x, 0.0, pCurr.z);
    let rLen = max(0.04, length(radial));
    let tangent = vec3<f32>(-radial.z / rLen, 0.0, radial.x / rLen);
    acc += tangent * twirlOmega * 2.4 + (radial / rLen) * abs(twirlOmega) * 1.65;
  }

  var pred = pCurr.xyz + velData.xyz * dt + acc * (dt * dt);

  // Interactive 3D cursor drape / grab brush
  if (uSim.brushPos.w > 0.5) {
    let toBrush = pred - uSim.brushPos.xyz;
    let bDist = length(toBrush);
    let bRad = max(0.08, uSim.brushVel.w);
    if (bDist < bRad) {
      let falloff = pow(1.0 - bDist / bRad, 1.5);
      pred += uSim.brushVel.xyz * dt * falloff * 1.35;
    }
  }

  // Soft/hard tailoring anchor to animated human avatar shoulders & waist
  if (pinWeight > 0.001) {
    let targetW = transformAnchor(anchor.xyz);
    let stiffness = clamp(pinWeight, 0.0, 1.0);
    pred = mix(pred, targetW, stiffness);
  }

  posOut[idx] = vec4<f32>(pred, pCurr.w);
}

fn solveSpringPair(
  pSelf: vec3<f32>,
  pOther: vec3<f32>,
  restLen: f32,
  stiffness: f32
) -> vec3<f32> {
  if (restLen <= 0.0001) {
    return vec3<f32>(0.0);
  }
  let delta = pOther - pSelf;
  let d = length(delta);
  if (d < 1e-6) {
    return vec3<f32>(0.0);
  }
  let err = d - restLen;
  return (delta / d) * (err * stiffness);
}

@compute @workgroup_size(64)
fn csSolveConstraints(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let numCols = i32(uSim.gridInfo.x);
  let numRows = i32(uSim.gridInfo.y);
  let count = u32(uSim.gridInfo.z);
  if (idx >= count) {
    return;
  }

  let r = i32(idx) / numCols;
  let c = i32(idx) - r * numCols;

  let pSelf = posIn[idx].xyz;
  let pinWeight = prevPos[idx].w;
  if (pinWeight >= 0.96) {
    posOut[idx] = vec4<f32>(pSelf, 0.0);
    return;
  }

  let stretchStiff = clamp(1.0 / (1.0 + uSim.solverInfo.x * 28.0), 0.15, 0.95);
  let shearStiff = clamp(1.0 / (1.0 + uSim.solverInfo.y * 36.0), 0.08, 0.75);
  let bendStiff = clamp(uSim.solverInfo.z * 0.45, 0.02, 0.45);

  var corr = vec3<f32>(0.0);
  var weightSum = 0.0;
  var strainAcc = 0.0;

  // 1. Structural Weft Right (c+1, r) & Left (c-1, r)
  let rlSelf = restLengths[idx];
  let idxRight = idxOf(c + 1, r, numCols);
  let idxLeft = idxOf(c - 1, r, numCols);
  let rlLeft = restLengths[idxLeft];

  let dRight = solveSpringPair(pSelf, posIn[idxRight].xyz, rlSelf.x, stretchStiff);
  let dLeft = solveSpringPair(pSelf, posIn[idxLeft].xyz, rlLeft.x, stretchStiff);
  corr += dRight + dLeft;
  weightSum += 2.0;

  let curWeft = length(posIn[idxRight].xyz - pSelf);
  strainAcc += abs(curWeft - rlSelf.x) / max(0.005, rlSelf.x);

  // 2. Structural Warp Down (c, r+1) & Up (c, r-1)
  if (r < numRows - 1) {
    let idxDown = idxOf(c, r + 1, numCols);
    corr += solveSpringPair(pSelf, posIn[idxDown].xyz, rlSelf.y, stretchStiff);
    weightSum += 1.0;
    let curWarp = length(posIn[idxDown].xyz - pSelf);
    strainAcc += abs(curWarp - rlSelf.y) / max(0.005, rlSelf.y);
  }
  if (r > 0) {
    let idxUp = idxOf(c, r - 1, numCols);
    let rlUp = restLengths[idxUp];
    corr += solveSpringPair(pSelf, posIn[idxUp].xyz, rlUp.y, stretchStiff);
    weightSum += 1.0;
  }

  // 3. Diagonal Shear Springs
  if (r < numRows - 1) {
    let idxRD = idxOf(c + 1, r + 1, numCols);
    corr += solveSpringPair(pSelf, posIn[idxRD].xyz, rlSelf.z, shearStiff);
    let idxLD = idxOf(c - 1, r + 1, numCols);
    corr += solveSpringPair(pSelf, posIn[idxLD].xyz, rlSelf.z, shearStiff);
    weightSum += 1.4;
  }
  if (r > 0) {
    let idxLU = idxOf(c - 1, r - 1, numCols);
    let rlLU = restLengths[idxLU];
    corr += solveSpringPair(pSelf, posIn[idxLU].xyz, rlLU.z, shearStiff);
    let idxRU = idxOf(c + 1, r - 1, numCols);
    let rlRU = restLengths[idxRU];
    corr += solveSpringPair(pSelf, posIn[idxRU].xyz, rlRU.z, shearStiff);
    weightSum += 1.4;
  }

  // 4. 2-Hop Circumferential Pleat / Bending Springs (c+2, r) & (c-2, r)
  let idxR2 = idxOf(c + 2, r, numCols);
  let idxL2 = idxOf(c - 2, r, numCols);
  let rlL2 = restLengths[idxL2];
  corr += solveSpringPair(pSelf, posIn[idxR2].xyz, rlSelf.w, bendStiff);
  corr += solveSpringPair(pSelf, posIn[idxL2].xyz, rlL2.w, bendStiff);
  weightSum += 1.0;

  let mobility = 1.0 - pinWeight * 0.92;
  let newPos = pSelf + (corr / max(1.0, weightSum * 0.55)) * mobility;
  posOut[idx] = vec4<f32>(newPos, clamp(strainAcc * 1.8, 0.0, 1.0));
}

@compute @workgroup_size(64)
fn csCollideAndUpdate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = u32(uSim.gridInfo.z);
  if (idx >= count) {
    return;
  }

  let dt = max(1e-4, uSim.gridInfo.w);
  let thickness = uSim.envInfo.y;
  let friction = uSim.envInfo.z;
  let damping = uSim.solverInfo.w;

  var p = posIn[idx].xyz;
  let strain = posIn[idx].w;
  let pPrev = prevPos[idx].xyz;
  let pinWeight = prevPos[idx].w;

  var minSdf = 10.0;
  var bodyVelTransfer = vec3<f32>(0.0);

  // Collide against all 16 articulated human avatar capsules
  for (var k : u32 = 0u; k < 16u; k = k + 1u) {
    let base = k * 3u;
    let pA_rA = uSim.capsules[base + 0u];
    let pB_rB = uSim.capsules[base + 1u];
    let cVel  = uSim.capsules[base + 2u].xyz;

    let a = pA_rA.xyz;
    let b = pB_rB.xyz;
    let ab = b - a;
    let abLenSq = dot(ab, ab);
    let t = select(clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0), 0.0, abLenSq < 1e-6);
    let closest = a + ab * t;
    let radius = mix(pA_rA.w, pB_rB.w, t) + thickness;

    let diff = p - closest;
    let dist = length(diff);
    let sdf = dist - radius;
    minSdf = min(minSdf, sdf);

    if (sdf < 0.0) {
      let n = select(vec3<f32>(0.0, 1.0, 0.0), diff / dist, dist > 1e-5);
      p = closest + n * radius;
      // Tangential friction + bone velocity carry
      let relMove = (p - pPrev) - cVel * dt;
      let normalMove = n * dot(relMove, n);
      let tangentMove = relMove - normalMove;
      p = pPrev + cVel * dt + normalMove + tangentMove * (1.0 - friction * 0.65);
      // Re-project outside capsule surface
      let reDiff = p - closest;
      let reDist = length(reDiff);
      if (reDist < radius) {
        p = closest + n * radius;
      }
      bodyVelTransfer = cVel * 0.35;
    }
  }

  // Collide with studio runway floor / plinth
  if (p.y < 0.012) {
    p.y = 0.012;
  }

  // Re-enforce pinned shoulder straps after collision
  if (pinWeight > 0.65) {
    let anchorW = transformAnchor(anchorTargets[idx].xyz);
    p = mix(p, anchorW, pinWeight);
  }

  var vel = ((p - pPrev) / dt + bodyVelTransfer * 0.15) * exp(-damping * dt * 2.5);
  let speed = length(vel);
  if (speed > 6.0) {
    vel = (vel / speed) * 6.0;
  }

  posOut[idx] = vec4<f32>(p, strain);
  velocities[idx] = vec4<f32>(vel, clamp(minSdf * 8.0, 0.0, 1.0));
}

@compute @workgroup_size(64)
fn csComputeNormals(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let numCols = i32(uSim.gridInfo.x);
  let numRows = i32(uSim.gridInfo.y);
  let count = u32(uSim.gridInfo.z);
  if (idx >= count) {
    return;
  }

  let r = i32(idx) / numCols;
  let c = i32(idx) - r * numCols;

  let pC = posIn[idx].xyz;
  let pR = posIn[idxOf(c + 1, r, numCols)].xyz - pC;
  let pL = posIn[idxOf(c - 1, r, numCols)].xyz - pC;
  let pD = select(vec3<f32>(0.0, -0.02, 0.0), posIn[idxOf(c, r + 1, numCols)].xyz - pC, r < numRows - 1);
  let pU = select(vec3<f32>(0.0, 0.02, 0.0), posIn[idxOf(c, r - 1, numCols)].xyz - pC, r > 0);

  let nsum = cross(pD, pR) + cross(pR, pU) + cross(pU, pL) + cross(pL, pD);
  let nLen = length(nsum);
  let n = select(vec3<f32>(0.0, 0.0, 1.0), nsum / nLen, nLen > 1e-6);

  normalsOut[idx] = vec4<f32>(n, posIn[idx].w);
}
`;

export const WGSL_CLOTH_RENDER_SHADER = /* wgsl */ `
struct RenderUniforms {
  viewProj     : mat4x4<f32>,
  cameraPos    : vec4<f32>, // xyz: cameraPos, w: exposure
  lightDir     : vec4<f32>, // xyz: sunDir, w: sunIntensity
  primaryColor : vec4<f32>, // rgb: dye primary, w: ambientIntensity
  sheenColor   : vec4<f32>, // rgb: anisotropic sheen, w: sheenIntensity
  trimColor    : vec4<f32>, // rgb: couture trim, w: hemTrim
  weaveParams  : vec4<f32>, // x: weaveType, y: weaveScale, z: weaveBump, w: roughness
  extraParams  : vec4<f32>, // x: renderChannel, y: subsurface, z: showSeamLines, w: avatarFinish
};

@group(0) @binding(0) var<uniform> uRender : RenderUniforms;

// -----------------------------------------------------------------------------
// 1. STUDIO FLOOR & CONTACT SHADOW PASS
// -----------------------------------------------------------------------------
struct FloorVSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos  : vec3<f32>,
};

@vertex
fn vsFloor(@builtin(vertex_index) vid : u32) -> FloorVSOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  let p = quad[vid] * 3.6;
  let world = vec3<f32>(p.x, -0.039, p.y);
  var out : FloorVSOut;
  out.pos = uRender.viewProj * vec4<f32>(world, 1.0);
  out.worldPos = world;
  return out;
}

@fragment
fn fsFloor(in : FloorVSOut) -> @location(0) vec4<f32> {
  let r = length(in.worldPos.xz);
  if (r > 3.5) {
    discard;
  }
  let fade = clamp(1.0 - r / 3.5, 0.0, 1.0);
  let gx = abs(fract(in.worldPos.x * 4.0 - 0.5) - 0.5) / fwidth(in.worldPos.x * 4.0);
  let gz = abs(fract(in.worldPos.z * 4.0 - 0.5) - 0.5) / fwidth(in.worldPos.z * 4.0);
  let line = 1.0 - min(min(gx, gz), 1.0);

  let ring = 1.0 - clamp(abs(r - 0.56) / 0.012, 0.0, 1.0);
  let shadow = smoothstep(0.08, 0.65, r);
  var col = vec3<f32>(0.075, 0.078, 0.085) * (0.45 + 0.55 * shadow);
  col += vec3<f32>(0.11, 0.115, 0.125) * line * fade * 0.45;
  col += uRender.trimColor.rgb * ring * 0.22;

  return vec4<f32>(col * fade, 1.0);
}

// -----------------------------------------------------------------------------
// 2. SCULPTED HUMAN AVATAR MANNEQUIN PASS
// -----------------------------------------------------------------------------
struct AvatarVSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos  : vec3<f32>,
  @location(1) normal    : vec3<f32>,
};

@vertex
fn vsAvatar(
  @location(0) inPos : vec3<f32>,
  @location(1) inNrm : vec3<f32>
) -> AvatarVSOut {
  var out : AvatarVSOut;
  out.pos = uRender.viewProj * vec4<f32>(inPos, 1.0);
  out.worldPos = inPos;
  out.normal = inNrm;
  return out;
}

@fragment
fn fsAvatar(in : AvatarVSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.normal);
  let V = normalize(uRender.cameraPos.xyz - in.worldPos);
  let L = normalize(uRender.lightDir.xyz);
  let H = normalize(V + L);

  let finish = i32(uRender.extraParams.w + 0.5);
  var baseCol = vec3<f32>(0.76, 0.65, 0.58); // Warm porcelain mannequin
  var rough = 0.36;
  var metallic = 0.04;
  if (finish == 1) {
    baseCol = vec3<f32>(0.56, 0.41, 0.28); // Sculpted bronze
    rough = 0.25;
    metallic = 0.65;
  } else if (finish == 2) {
    baseCol = vec3<f32>(0.18, 0.19, 0.21); // Charcoal studio matte
    rough = 0.52;
  } else if (finish == 3) {
    baseCol = vec3<f32>(0.86, 0.85, 0.83); // Alabaster satin
    rough = 0.28;
  }

  // Plinth base darker finish
  if (in.worldPos.y < 0.006) {
    baseCol = vec3<f32>(0.12, 0.125, 0.135);
    rough = 0.28;
  }

  let ndl = max(0.0, dot(N, L));
  let wrapDiff = max(0.0, (dot(N, L) + 0.35) / 1.35);
  let ndv = max(0.001, dot(N, V));
  let ndh = max(0.0, dot(N, H));
  let specPow = exp2(10.0 * (1.0 - rough));
  let spec = pow(ndh, specPow) * (0.12 + 0.65 * metallic);
  let rim = pow(1.0 - ndv, 3.2) * 0.28;

  let sunI = uRender.lightDir.w * 0.48;
  let ambI = uRender.primaryColor.w * 0.42;

  var color = baseCol * (ambI * (0.6 + 0.4 * N.y) + sunI * wrapDiff) + vec3<f32>(1.0, 0.97, 0.92) * spec * sunI + baseCol * rim;
  color = vec3<f32>(1.0) - exp(-color * uRender.cameraPos.w);
  return vec4<f32>(color, 1.0);
}

// -----------------------------------------------------------------------------
// 3. PHYSICALLY-BASED COUTURE DRESS CLOTH PASS
// -----------------------------------------------------------------------------
struct ClothVSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos  : vec3<f32>,
  @location(1) normal    : vec3<f32>,
  @location(2) uvPanel   : vec4<f32>, // u, v, panelId, pleatPhase
  @location(3) telemetry : vec4<f32>, // strain, velLen, sdfClearance, pinWeight
};

@group(0) @binding(1) var<storage, read> clothPos : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> clothNrm : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> clothUV  : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> clothVel : array<vec4<f32>>;

@vertex
fn vsCloth(@builtin(vertex_index) vid : u32) -> ClothVSOut {
  let p = clothPos[vid];
  let n = clothNrm[vid];
  let uv = clothUV[vid];
  let v = clothVel[vid];

  var out : ClothVSOut;
  out.pos = uRender.viewProj * vec4<f32>(p.xyz, 1.0);
  out.worldPos = p.xyz;
  out.normal = n.xyz;
  out.uvPanel = uv;
  out.telemetry = vec4<f32>(p.w, length(v.xyz), v.w, 0.0);
  return out;
}

fn evalWeavePattern(uv: vec2<f32>, weaveType: i32, scale: f32) -> vec3<f32> {
  let p = uv * scale * vec2<f32>(2.4, 1.8);
  let wx = sin(p.x * 6.2831853);
  let wy = sin(p.y * 6.2831853);

  if (weaveType == 0) {
    // Silk charmeuse: fine anisotropic warp float
    let h = 0.65 * wx + 0.35 * wy;
    return vec3<f32>(cos(p.x * 6.28318) * 0.35, cos(p.y * 6.28318) * 0.15, h);
  } else if (weaveType == 1) {
    // Satin twill: diagonal 3/1 twill ridge
    let diag = sin((p.x + p.y * 1.5) * 6.2831853);
    return vec3<f32>(diag * 0.45, -diag * 0.32, diag);
  } else if (weaveType == 2) {
    // Pleated crepe: pebbled micro-crinkle
    let c1 = sin(p.x * 9.0 + sin(p.y * 7.0) * 1.8);
    let c2 = cos(p.y * 9.0 + sin(p.x * 7.0) * 1.8);
    return vec3<f32>(c1 * 0.5, c2 * 0.5, 0.5 * (c1 + c2));
  } else if (weaveType == 3) {
    // Velvet pile: plush tufted micro-fibers
    let tuft = sin(p.x * 12.5) * sin(p.y * 12.5);
    return vec3<f32>(tuft * 0.25, tuft * 0.25, tuft);
  } else if (weaveType == 4) {
    // Sheer organza: crisp open filament mesh
    let grid = max(abs(wx), abs(wy));
    return vec3<f32>(wx * 0.4, wy * 0.4, grid);
  } else {
    // Sequined brocade: hexagonal metallic paillettes
    let cell = fract(p * 0.85) - vec2<f32>(0.5);
    let d = length(cell);
    let seq = smoothstep(0.45, 0.22, d);
    return vec3<f32>(cell.x * seq * 1.4, cell.y * seq * 1.4, seq);
  }
}

fn heatmapColor(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  return clamp(
    vec3<f32>(
      1.5 - abs(4.0 * x - 3.0),
      1.5 - abs(4.0 * x - 2.0),
      1.5 - abs(4.0 * x - 1.0)
    ),
    vec3<f32>(0.0),
    vec3<f32>(1.0)
  );
}

@fragment
fn fsCloth(
  in : ClothVSOut,
  @builtin(front_facing) isFront : bool
) -> @location(0) vec4<f32> {
  var N = normalize(in.normal);
  if (!isFront) {
    N = -N;
  }

  let uv = in.uvPanel.xy;
  let panelId = i32(in.uvPanel.z + 0.5);
  let pleatPhase = in.uvPanel.w;
  let strain = in.telemetry.x;
  let velMag = in.telemetry.y;
  let sdfClear = in.telemetry.z;

  let weaveType = i32(uRender.weaveParams.x + 0.5);
  let weaveScale = uRender.weaveParams.y;
  let weaveBump = uRender.weaveParams.z;
  let roughness = uRender.weaveParams.w;
  let channel = i32(uRender.extraParams.x + 0.5);

  let weave = evalWeavePattern(uv, weaveType, weaveScale);

  // Perturb normal with procedural weave micro-relief
  let up = vec3<f32>(0.0, 1.0, 0.0);
  let T = normalize(cross(up, N) + vec3<f32>(1e-4, 0.0, 0.0));
  let B = normalize(cross(N, T));
  N = normalize(N + (T * weave.x + B * weave.y) * weaveBump * 0.32);

  // Debug Render Channels
  if (channel == 1) {
    // Warp/Weft Strain Heatmap
    return vec4<f32>(heatmapColor(strain * 1.6), 1.0);
  } else if (channel == 2) {
    // 2D Pattern Panels & UV Grid
    var pCol = vec3<f32>(0.22, 0.55, 0.85);
    if (panelId == 1) { pCol = vec3<f32>(0.32, 0.72, 0.58); }
    if (panelId == 2) { pCol = vec3<f32>(0.88, 0.58, 0.30); }
    if (panelId == 3) { pCol = vec3<f32>(0.76, 0.42, 0.72); }
    let gridU = abs(fract(uv.x * 24.0) - 0.5);
    let gridV = abs(fract(uv.y * 24.0) - 0.5);
    let line = select(0.0, 0.25, min(gridU, gridV) < 0.04);
    return vec4<f32>(pCol + vec3<f32>(line), 1.0);
  } else if (channel == 3) {
    // Procedural Weave Normals
    return vec4<f32>(N * 0.5 + vec3<f32>(0.5), 1.0);
  } else if (channel == 4) {
    // Cloth Velocity Field
    return vec4<f32>(heatmapColor(velMag * 0.45), 1.0);
  } else if (channel == 5) {
    // Avatar SDF Collision Clearance
    return vec4<f32>(heatmapColor(1.0 - sdfClear), 1.0);
  }

  let V = normalize(uRender.cameraPos.xyz - in.worldPos);
  let L = normalize(uRender.lightDir.xyz);
  let H = normalize(V + L);

  let ndl = max(0.0, dot(N, L));
  let ndv = max(0.001, dot(N, V));
  let ndh = max(0.0, dot(N, H));

  // Primary dye with subtle vertical ombre richness toward hem
  var albedo = uRender.primaryColor.rgb * (1.08 - 0.24 * uv.y);
  // Subtle weave thread variation
  albedo *= 0.92 + 0.14 * weave.z * weaveBump;
  // Pleat valley self-occlusion
  let pleatAO = 0.86 + 0.14 * pleatPhase;
  albedo *= pleatAO;

  // Interior lining slightly darker satin tone
  if (!isFront) {
    albedo *= 0.72;
  }

  // Couture metallic border trim at neckline (uv.y < 0.03) and hemline (uv.y > 0.955)
  let hemBand = smoothstep(0.952, 0.968, uv.y) + smoothstep(0.032, 0.015, uv.y);
  let lacePattern = 0.5 + 0.5 * sin(uv.x * 120.0);
  let trimMask = clamp(hemBand * (0.7 + 0.3 * lacePattern) * uRender.trimColor.w, 0.0, 1.0);
  albedo = mix(albedo, uRender.trimColor.rgb, trimMask);

  // Stitched seam highlight (side seams at u=0, u=0.5, waist seam at v=0.28)
  if (uRender.extraParams.z > 0.5) {
    let sideSeam = min(abs(uv.x - 0.5), min(uv.x, 1.0 - uv.x));
    let waistSeam = abs(uv.y - 0.28);
    let stitchDash = step(0.4, fract((uv.x + uv.y) * 90.0));
    let seamMask = (smoothstep(0.0045, 0.0015, sideSeam) + smoothstep(0.005, 0.0015, waistSeam)) * stitchDash;
    albedo = mix(albedo, uRender.trimColor.rgb * 0.95, clamp(seamMask * 0.55, 0.0, 1.0));
  }

  // Anisotropic silk / velvet Charlie & Kajiya-Kay grazing sheen
  let sinTH = sqrt(max(0.0, 1.0 - dot(T, H) * dot(T, H)));
  let anisoSpec = pow(sinTH, exp2(6.0 * (1.0 - roughness))) * ndl * 0.45;
  let fresnelSheen = pow(1.0 - ndv, 2.6) * uRender.sheenColor.w;
  let sheenContrib = uRender.sheenColor.rgb * (fresnelSheen * 0.55 + anisoSpec * uRender.sheenColor.w * 0.65);

  // Subsurface silk translucency when backlit
  let backLight = max(0.0, dot(-N, L));
  let sss = uRender.primaryColor.rgb * backLight * uRender.extraParams.y * 0.38;

  let sunI = uRender.lightDir.w * 0.52;
  let ambI = uRender.primaryColor.w * 0.50;
  let hemiAmb = ambI * (0.65 + 0.35 * N.y) * pleatAO;

  var color = albedo * (hemiAmb + sunI * (ndl * 0.82 + 0.18)) + sheenContrib * (0.45 + 0.55 * sunI) + sss * sunI;

  // Sequined brocade sparkle
  if (weaveType == 5) {
    let sparkle = pow(ndh, 48.0) * max(0.0, weave.z) * 1.8;
    color += uRender.trimColor.rgb * sparkle * sunI;
  }

  // ACES-inspired filmic tone mapping
  let exposed = color * uRender.cameraPos.w;
  let mapped = (exposed * (2.51 * exposed + 0.03)) / (exposed * (2.43 * exposed + 0.59) + 0.14);
  return vec4<f32>(clamp(mapped, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
