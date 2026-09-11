//==========================================================================================
// Slate SDF Terrain Studio — common WGSL foundation
// Shared uniforms, procedural noise, volumetric SDF sampling, camera setup, shading helpers.
// Everything downstream (graph bake, fluvial/aeolian/thermal solvers, renderer) includes this.
//==========================================================================================

export const COMMON = /* wgsl */ `

//------------------------------------------------------------------------------------------
// Uniforms — field order is mirrored by src/kernel/uniforms.js (single writer, no drift).
//------------------------------------------------------------------------------------------
struct Frame
{
    dims      : vec4u,   // nx, ny, nz, hydRes (XZ hydrology grid resolution)
    worldLo   : vec4f,   // lo.xyz [m], voxelSize [m]
    worldHi   : vec4f,   // hi.xyz [m], time [s]
    camPos    : vec4f,   // pos.xyz [m], tanHalfFov
    camRight  : vec4f,   // basis, w = jitter x
    camUp     : vec4f,   // basis, w = jitter y
    camFwd    : vec4f,   // basis, w = unused
    view      : vec4f,   // width, height, sampleIndex, renderScale
    sims      : vec4f,   // dt, step, rainRate [m/s], evaporation [1/s]
    fluvial   : vec4f,   // K erodibility, m areaExp, n slopeExp, deposition time
    transport : vec4f,   // settlingVel, capacityScale, coverProtection, maxStepVoxels
    aeolian   : vec4f,   // speed [m/s], dir [rad], abrasionK, depositionK
    thermal   : vec4f,   // tanRepose, rate, creep, enabled
    climate   : vec4f,   // snowline [m], temperatureLapse, humidity, rainVariation
    particles : vec4f,   // spawnRate, countLimit, gravity, sizeScale
    sun       : vec4f,   // dir.xyz, intensity
    sky       : vec4f,   // ambient, fogDensity, exposure, detailAmp [m]
    tint      : vec4f,   // biome, vegetation, sedimentMix, wetDarken
    flags     : vec4u,   // debugView, showWater, showParticles, options
    stats     : vec4f,   // eroded [m3], deposited [m3], carried [m3], escaped [m3]
    bake      : vec4f,   // seed, worldScale, previewBlend, bakeGen
    water     : vec4f,   // wave amplitude [m], refraction, foam, flow streaks
    waterOptics : vec4f, // specular, absorption [1/m], turbidity, sediment tint
    waterShallow : vec4f, // shallow tint rgb
    waterDeep : vec4f,   // deep tint rgb
    push      : vec4u,   // ping-pong source plane, destination plane, iteration, parity
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> gparams : array<vec4f, 64>;

//------------------------------------------------------------------------------------------
// Particle record. One record exists per pool slot; negative age marks a free slot.
//------------------------------------------------------------------------------------------
struct Particle
{
    pos  : vec4f,   // position [m], age [s] (negative = free slot)
    vel  : vec4f,   // velocity [m/s], water mass [m3]
    load : vec4f,   // suspended volume [m3]: sand, silt, gravel, dust
    info : vec4f,   // type, footprint radius [m], capacity multiplier, state flags
};

// type codes
const AGENT_RAIN     : f32 = 0.0;
const AGENT_RIVER    : f32 = 1.0;
const AGENT_WIND     : f32 = 2.0;
const AGENT_ROCKFALL : f32 = 3.0;

const FIXED_SCALE : f32 = 1000000.0;   // i32 fixed point: micrometres per metre

//------------------------------------------------------------------------------------------
// Grid <-> world mapping. Voxel centres sit at (q + 0.5) * voxel inside the box.
//------------------------------------------------------------------------------------------
fn voxelSize() -> f32
{
    return frame.worldLo.w;
}

fn gridDimsF() -> vec3f
{
    return vec3f(frame.dims.xyz);
}

fn worldToGrid(p : vec3f) -> vec3f
{
    return (p - frame.worldLo.xyz) / voxelSize();
}

fn gridToWorld(q : vec3f) -> vec3f
{
    return frame.worldLo.xyz + (q + vec3f(0.5)) * voxelSize();
}

fn gridToWorldCorner(q : vec3f) -> vec3f
{
    return frame.worldLo.xyz + q * voxelSize();
}

fn volumeUV(q : vec3f) -> vec3f
{
    return (q + vec3f(0.5)) / gridDimsF();
}

fn volumeIndex(q : vec3i) -> u32
{
    let d = vec3i(frame.dims.xyz);
    let c = clamp(q, vec3i(0), d - vec3i(1));
    return u32(c.x) + u32(c.y) * u32(d.x) + u32(c.z) * u32(d.x) * u32(d.y);
}

fn hydIndex(x : i32, z : i32) -> u32
{
    let g = i32(frame.dims.w);
    let cx = clamp(x, 0, g - 1);
    let cz = clamp(z, 0, g - 1);
    return u32(cx) + u32(cz) * u32(g);
}

fn hydCellWorld(x : i32, z : i32) -> vec2f
{
    // Hydrology cells are aligned to the volume XZ footprint.
    let g = f32(frame.dims.w);
    let dx = (frame.worldHi.x - frame.worldLo.x) / g;
    let dz = (frame.worldHi.z - frame.worldLo.z) / g;
    return vec2f(frame.worldLo.x + (f32(x) + 0.5) * dx, frame.worldLo.z + (f32(z) + 0.5) * dz);
}

//------------------------------------------------------------------------------------------
// Hashing / randomness — integer mixing, identical on every GPU (no sin() precision drift).
//------------------------------------------------------------------------------------------
fn pcg(v : u32) -> u32
{
    var state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn hash1(a : u32) -> f32
{
    return f32(pcg(a)) * (1.0 / 4294967296.0);
}

fn hash3(p : vec3u, seed : u32) -> f32
{
    return hash1(pcg(p.x ^ pcg(p.y ^ pcg(p.z ^ pcg(seed)))));
}

fn hash3v(p : vec3u, seed : u32) -> vec3f
{
    let a = pcg(p.x ^ pcg(seed));
    let b = pcg(p.y ^ pcg(a));
    let c = pcg(p.z ^ pcg(b));
    return vec3f(hash1(a), hash1(b), hash1(c));
}

//------------------------------------------------------------------------------------------
// Procedural noise — value, gradient, fbm, ridged, billow, worley, domain warp.
//------------------------------------------------------------------------------------------
fn fade(t : f32) -> f32
{
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn valueNoise(p : vec3f, seed : u32) -> f32
{
    let i = floor(p);
    let f = p - i;
    let b = vec3u(u32(i32(i.x) & 1023), u32(i32(i.y) & 1023), u32(i32(i.z) & 1023));
    let w = vec3f(fade(f.x), fade(f.y), fade(f.z));
    var acc = 0.0;
    for (var z = 0; z < 2; z = z + 1)
    {
        for (var y = 0; y < 2; y = y + 1)
        {
            for (var x = 0; x < 2; x = x + 1)
            {
                let c = vec3u(u32(x), u32(y), u32(z));
                let wgt = select(1.0 - w.x, w.x, x == 1) * select(1.0 - w.y, w.y, y == 1) * select(1.0 - w.z, w.z, z == 1);
                acc = acc + wgt * hash3(b + c, seed);
            }
        }
    }
    return acc;
}

fn gradientNoise(p : vec3f, seed : u32) -> f32
{
    let i = floor(p);
    let f = p - i;
    let b = vec3u(u32(i32(i.x) & 1023), u32(i32(i.y) & 1023), u32(i32(i.z) & 1023));
    let w = vec3f(fade(f.x), fade(f.y), fade(f.z));
    var acc = 0.0;
    for (var z = 0; z < 2; z = z + 1)
    {
        for (var y = 0; y < 2; y = y + 1)
        {
            for (var x = 0; x < 2; x = x + 1)
            {
                let c = vec3u(u32(x), u32(y), u32(z));
                let wgt = select(1.0 - w.x, w.x, x == 1) * select(1.0 - w.y, w.y, y == 1) * select(1.0 - w.z, w.z, z == 1);
                let g = hash3v(b + c, seed) * 2.0 - vec3f(1.0);
                acc = acc + wgt * dot(g, f - vec3f(c));
            }
        }
    }
    return acc;
}

fn fbm(p : vec3f, octaves : i32, lacunarity : f32, gain : f32, seed : u32) -> f32
{
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var norm = 0.0;
    for (var o = 0; o < octaves; o = o + 1)
    {
        sum = sum + amp * gradientNoise(p * freq, seed + u32(o) * 131u);
        norm = norm + amp;
        amp = amp * gain;
        freq = freq * lacunarity;
    }
    return sum / max(norm, 1e-5);
}

fn ridgedNoise(p : vec3f, octaves : i32, lacunarity : f32, gain : f32, seed : u32) -> f32
{
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var norm = 0.0;
    for (var o = 0; o < octaves; o = o + 1)
    {
        let n = 1.0 - abs(gradientNoise(p * freq, seed + u32(o) * 977u));
        sum = sum + amp * n * n;
        norm = norm + amp;
        amp = amp * gain;
        freq = freq * lacunarity;
    }
    return sum / max(norm, 1e-5);
}

fn billowNoise(p : vec3f, octaves : i32, lacunarity : f32, gain : f32, seed : u32) -> f32
{
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var norm = 0.0;
    for (var o = 0; o < octaves; o = o + 1)
    {
        sum = sum + amp * abs(gradientNoise(p * freq, seed + u32(o) * 733u));
        norm = norm + amp;
        amp = amp * gain;
        freq = freq * lacunarity;
    }
    return sum / max(norm, 1e-5);
}

fn worleyF1(p : vec3f, seed : u32) -> f32
{
    let i = floor(p);
    let f = p - i;
    var best = 1e9;
    let b = vec3u(u32(i32(i.x) & 1023), u32(i32(i.y) & 1023), u32(i32(i.z) & 1023));
    for (var z = -1; z <= 1; z = z + 1)
    {
        for (var y = -1; y <= 1; y = y + 1)
        {
            for (var x = -1; x <= 1; x = x + 1)
            {
                let c = vec3i(x, y, z);
                let cell = vec3u(u32((i32(b.x) + c.x) & 1023), u32((i32(b.y) + c.y) & 1023), u32((i32(b.z) + c.z) & 1023));
                let feature = hash3v(cell, seed) + vec3f(c);
                best = min(best, length(feature - f));
            }
        }
    }
    return best;
}

fn worleyF2(p : vec3f, seed : u32) -> vec2f
{
    let i = floor(p);
    let f = p - i;
    var d1 = 1e9;
    var d2 = 1e9;
    let b = vec3u(u32(i32(i.x) & 1023), u32(i32(i.y) & 1023), u32(i32(i.z) & 1023));
    for (var z = -1; z <= 1; z = z + 1)
    {
        for (var y = -1; y <= 1; y = y + 1)
        {
            for (var x = -1; x <= 1; x = x + 1)
            {
                let c = vec3i(x, y, z);
                let cell = vec3u(u32((i32(b.x) + c.x) & 1023), u32((i32(b.y) + c.y) & 1023), u32((i32(b.z) + c.z) & 1023));
                let feature = hash3v(cell, seed) + vec3f(c);
                let d = length(feature - f);
                if (d < d1)
                {
                    d2 = d1;
                    d1 = d;
                }
                else if (d < d2)
                {
                    d2 = d;
                }
            }
        }
    }
    return vec2f(d1, d2);
}

//------------------------------------------------------------------------------------------
// Signed distance primitives (exact, single-source for the graph compiler and the renderer).
//------------------------------------------------------------------------------------------
fn sdSphere(p : vec3f, r : f32) -> f32
{
    return length(p) - r;
}

fn sdRoundBox(p : vec3f, b : vec3f, r : f32) -> f32
{
    let q = abs(p) - b + vec3f(r);
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdBox(p : vec3f, b : vec3f) -> f32
{
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdPlane(p : vec3f, n : vec3f, h : f32) -> f32
{
    return dot(p, n) - h;
}

fn sdCapsule(p : vec3f, a : vec3f, b : vec3f, r : f32) -> f32
{
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn sdVerticalCapsule(p : vec3f, h : f32, r : f32) -> f32
{
    let d = vec2f(length(p.xz), abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - r;
}

fn sdCylinder(p : vec3f, r : f32, h : f32) -> f32
{
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdTorus(p : vec3f, t : vec2f) -> f32
{
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdCone(p : vec3f, h : f32, r : f32) -> f32
{
    let q = vec2f(length(p.xz), -p.y);
    let tip = q - vec2f(0.0, h);
    let mantle = q - vec2f(r, 0.0) * clamp(dot(q, vec2f(r, h)) / (r * r + h * h), 0.0, 1.0);
    return length(mantle) - r;
}

fn sdEllipsoid(p : vec3f, r : vec3f) -> f32
{
    let k0 = length(p / r);
    let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

fn sdOctahedron(p : vec3f, s : f32) -> f32
{
    let q = abs(p);
    return (q.x + q.y + q.z - s) * 0.57735027;
}

fn opUnion(a : f32, b : f32) -> f32
{
    return min(a, b);
}

fn opSmoothUnion(a : f32, b : f32, k : f32) -> f32
{
    let h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-5), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn opSubtract(a : f32, b : f32) -> f32
{
    return max(-b, a);
}

fn opSmoothSubtract(a : f32, b : f32, k : f32) -> f32
{
    let h = clamp(0.5 - 0.5 * (b + a) / max(k, 1e-5), 0.0, 1.0);
    return mix(a, -b, h) + k * h * (1.0 - h);
}

fn opIntersect(a : f32, b : f32) -> f32
{
    return max(a, b);
}

fn opSmoothIntersect(a : f32, b : f32, k : f32) -> f32
{
    let h = clamp(0.5 - 0.5 * (b - a) / max(k, 1e-5), 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

fn opChamfer(a : f32, b : f32, k : f32) -> f32
{
    return min(min(a, b), (a - k + b) * 0.70710678);
}

fn opShell(d : f32, thickness : f32) -> f32
{
    return abs(d) - thickness;
}

fn opRound(d : f32, r : f32) -> f32
{
    return d - r;
}

// Polynomial smooth minimum (smoother, wider geological joins than the exponential form).
fn opCubicUnion(a : f32, b : f32, k : f32) -> f32
{
    let h = max(k - abs(a - b), 0.0) / max(k, 1e-5);
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

//------------------------------------------------------------------------------------------
// Domain operators
//------------------------------------------------------------------------------------------
fn opRepeat(p : vec3f, period : vec3f, count : vec3f) -> vec3f
{
    var q = p;
    q.x = p.x - period.x * clamp(round(p.x / max(period.x, 1e-4)), -count.x, count.x);
    q.y = p.y - period.y * clamp(round(p.y / max(period.y, 1e-4)), -count.y, count.y);
    q.z = p.z - period.z * clamp(round(p.z / max(period.z, 1e-4)), -count.z, count.z);
    return q;
}

fn opRotateY(p : vec3f, a : f32) -> vec3f
{
    let c = cos(a);
    let s = sin(a);
    return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn opRotateX(p : vec3f, a : f32) -> vec3f
{
    let c = cos(a);
    let s = sin(a);
    return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

fn opRotateZ(p : vec3f, a : f32) -> vec3f
{
    let c = cos(a);
    let s = sin(a);
    return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

fn opBend(p : vec3f, k : f32) -> vec3f
{
    let c = cos(k * p.x);
    let s = sin(k * p.x);
    let m = mat2x2f(c, -s, s, c);
    return vec3f(p.x, m * p.yz);
}

fn opTwist(p : vec3f, k : f32) -> vec3f
{
    let a = k * p.y;
    return opRotateY(p, a);
}

//------------------------------------------------------------------------------------------
// Component selection helpers (avoid dynamic vector indexing entirely).
//------------------------------------------------------------------------------------------
fn pick2(v : vec2f, i : i32) -> f32
{
    return select(v.x, v.y, i == 1);
}

fn pick4(v : vec4f, i : i32) -> f32
{
    if (i <= 0) { return v.x; }
    if (i == 1) { return v.y; }
    if (i == 2) { return v.z; }
    return v.w;
}

//------------------------------------------------------------------------------------------
// Volume sampling. Textures are passed in explicitly so every pass reuses one helper set.
// The finite-box clamp keeps sphere tracing conservative: outside the box the box itself
// bounds the step, inside it the stored field already stores min(dist, boxDistance).
//------------------------------------------------------------------------------------------
fn boxDistance(p : vec3f) -> f32
{
    let b = max(frame.worldLo.xyz - p, p - frame.worldHi.xyz);
    return length(max(b, vec3f(0.0)));
}

// Trilinear fetch built from eight textureLoad calls. The field is stored in r32float, which
// is not a filterable format, so a filtering sampler cannot be used on it — and manual
// interpolation also keeps the marcher's interpolation identical across vendors.
fn loadTrilinear(tex : texture_3d<f32>, p : vec3f) -> vec4f
{
    let d = vec3i(frame.dims.xyz) - vec3i(1);
    let u = worldToGrid(p) - vec3f(0.5);
    let base = floor(u);
    let t = clamp(u - base, vec3f(0.0), vec3f(1.0));
    let i0 = vec3i(base);
    let c00 = mix(textureLoad(tex, clamp(i0, vec3i(0), d), 0),
                  textureLoad(tex, clamp(i0 + vec3i(1, 0, 0), vec3i(0), d), 0), t.x);
    let c10 = mix(textureLoad(tex, clamp(i0 + vec3i(0, 1, 0), vec3i(0), d), 0),
                  textureLoad(tex, clamp(i0 + vec3i(1, 1, 0), vec3i(0), d), 0), t.x);
    let c01 = mix(textureLoad(tex, clamp(i0 + vec3i(0, 0, 1), vec3i(0), d), 0),
                  textureLoad(tex, clamp(i0 + vec3i(1, 0, 1), vec3i(0), d), 0), t.x);
    let c11 = mix(textureLoad(tex, clamp(i0 + vec3i(0, 1, 1), vec3i(0), d), 0),
                  textureLoad(tex, clamp(i0 + vec3i(1, 1, 1), vec3i(0), d), 0), t.x);
    return mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
}

fn terrainAt(tex : texture_3d<f32>, p : vec3f) -> f32
{
    return loadTrilinear(tex, p).r;
}

fn terrainClamped(tex : texture_3d<f32>, p : vec3f) -> f32
{
    let g = worldToGrid(p);
    let q = clamp(g, vec3f(0.0), gridDimsF() - vec3f(1.0));
    let c = textureLoad(tex, vec3i(q), 0);
    let inside = all(g >= vec3f(0.0)) && all(g <= gridDimsF() - vec3f(1.0));
    return select(1e6, c.r, inside);
}

fn terrainBound(tex : texture_3d<f32>, p : vec3f) -> f32
{
    let d = terrainAt(tex, p);
    return max(d, boxDistance(p));
}

fn materialAt(tex : texture_3d<f32>, p : vec3f) -> vec4f
{
    return loadTrilinear(tex, p);
}

fn normalAt(tex : texture_3d<f32>, p : vec3f, h : f32) -> vec3f
{
    let dx = vec3f(h, 0.0, 0.0);
    let dy = vec3f(0.0, h, 0.0);
    let dz = vec3f(0.0, 0.0, h);
    let g = vec3f(
        terrainAt(tex, p + dx) - terrainAt(tex, p - dx),
        terrainAt(tex, p + dy) - terrainAt(tex, p - dy),
        terrainAt(tex, p + dz) - terrainAt(tex, p - dz));
    let l = length(g);
    return select(vec3f(0.0, 1.0, 0.0), g / l, l > 1e-6);
}

fn curvatureAt(tex : texture_3d<f32>, p : vec3f, h : f32) -> f32
{
    let c = terrainAt(tex, p);
    var sum = 0.0;
    let o : array<vec3f, 6> = array<vec3f, 6>(
        vec3f(h, 0.0, 0.0), vec3f(-h, 0.0, 0.0),
        vec3f(0.0, h, 0.0), vec3f(0.0, -h, 0.0),
        vec3f(0.0, 0.0, h), vec3f(0.0, 0.0, -h));
    for (var i = 0; i < 6; i = i + 1)
    {
        sum = sum + terrainAt(tex, p + o[i]);
    }
    return (sum / 6.0 - c) / max(h, 1e-5);
}

fn ambientOcclusion(tex : texture_3d<f32>, p : vec3f, n : vec3f, scale : f32) -> f32
{
    var occ = 0.0;
    var sca = 1.0;
    for (var i = 0; i < 5; i = i + 1)
    {
        let h = scale * (f32(i) + 1.0) * 0.6;
        let d = terrainAt(tex, p + n * h);
        occ = occ + (h - d) * sca;
        sca = sca * 0.72;
    }
    return clamp(1.0 - 1.1 * occ / max(scale, 1e-4), 0.0, 1.0);
}

// Soft shadow via SDF penumbra estimation.
fn softShadow(tex : texture_3d<f32>, ro : vec3f, rd : vec3f, mint : f32, maxt : f32) -> f32
{
    var res = 1.0;
    var t = mint;
    for (var i = 0; i < 48; i = i + 1)
    {
        let h = terrainBound(tex, ro + rd * t);
        if (h < 0.02)
        {
            return 0.0;
        }
        res = min(res, 12.0 * h / t);
        t = t + clamp(h, 0.35, 24.0);
        if (t > maxt || res < 0.02)
        {
            break;
        }
    }
    return clamp(res, 0.0, 1.0);
}

//------------------------------------------------------------------------------------------
// Ray / volume intersection: conservative sphere trace with detail displacement optional.
//------------------------------------------------------------------------------------------
struct Hit
{
    t        : f32,
    pos      : vec3f,
    normal   : vec3f,
    steps    : f32,
    hit      : f32,   // 1 when the surface was reached, 0 for the far plane
};

fn boxIntersect(ro : vec3f, rd : vec3f) -> vec2f
{
    let inv = 1.0 / max(abs(rd), vec3f(1e-7)) * sign(rd + vec3f(1e-9));
    let t0 = (frame.worldLo.xyz - ro) * inv;
    let t1 = (frame.worldHi.xyz - ro) * inv;
    let lo = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
    let hi = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    return vec2f(lo, hi);
}

fn surfaceDetail(p : vec3f, amp : f32) -> f32
{
    if (amp <= 0.0)
    {
        return 0.0;
    }
    let s = frame.bake.x;
    let n = fbm(p * 0.11, 4, 2.03, 0.5, u32(s) + 71u) * 0.65
          + gradientNoise(p * 0.47, u32(s) + 933u) * 0.35;
    return n * amp;
}

fn detailAmp() -> f32
{
    return frame.sky.w;
}

// March the stored field, optionally adding bounded fractal detail at the zero set so
// silhouettes and close-ups stay crisp without a heightmap.
fn traceTerrain(tex : texture_3d<f32>, ro : vec3f, rd : vec3f, maxSteps : i32) -> Hit
{
    var h : Hit;
    h.t = 1e9;
    h.hit = 0.0;
    h.steps = 0.0;
    let sec = boxIntersect(ro, rd);
    let lo = max(sec.x, 0.0);
    let hi = sec.y;
    if (hi <= lo)
    {
        h.pos = ro + rd * max(lo, 0.0);
        h.normal = vec3f(0.0, 1.0, 0.0);
        return h;
    }
    var t = lo;
    let amp = detailAmp();
    for (var i = 0; i < maxSteps; i = i + 1)
    {
        let p = ro + rd * t;
        var d = terrainAt(tex, p);
        if (amp > 0.0 && abs(d) < amp * 3.0)
        {
            d = d + surfaceDetail(p, amp) * (1.0 - clamp(abs(d) / (amp * 3.0), 0.0, 1.0));
        }
        let eps = max(voxelSize() * 0.08, 0.02);
        if (d < eps)
        {
            h.t = t;
            h.pos = p;
            h.hit = 1.0;
            return h;
        }
        h.steps = f32(i);
        t = t + clamp(d * 0.85, eps * 2.0, voxelSize() * 4.0);
        if (t > hi)
        {
            break;
        }
    }
    h.pos = ro + rd * min(t, hi);
    h.normal = vec3f(0.0, 1.0, 0.0);
    return h;
}

fn traceTerrainDetailed(tex : texture_3d<f32>, ro : vec3f, rd : vec3f, maxSteps : i32, amp : f32) -> Hit
{
    var h : Hit;
    h.t = 1e9;
    h.hit = 0.0;
    h.steps = 0.0;
    let sec = boxIntersect(ro, rd);
    let lo = max(sec.x, 0.0);
    let hi = sec.y;
    if (hi <= lo)
    {
        h.pos = ro + rd * max(lo, 0.0);
        h.normal = vec3f(0.0, 1.0, 0.0);
        return h;
    }
    var t = lo;
    for (var i = 0; i < maxSteps; i = i + 1)
    {
        let p = ro + rd * t;
        var d = terrainAt(tex, p);
        if (amp > 0.0 && abs(d) < amp * 3.0)
        {
            d = d + surfaceDetail(p, amp) * (1.0 - clamp(abs(d) / (amp * 3.0), 0.0, 1.0));
        }
        let eps = max(voxelSize() * 0.08, 0.02);
        if (d < eps)
        {
            h.t = t;
            h.pos = p;
            h.hit = 1.0;
            return h;
        }
        h.steps = f32(i);
        t = t + clamp(d * 0.85, eps * 2.0, voxelSize() * 4.0);
        if (t > hi)
        {
            break;
        }
    }
    h.pos = ro + rd * min(t, hi);
    return h;
}

fn surfaceNormalDetailed(tex : texture_3d<f32>, p : vec3f, amp : f32) -> vec3f
{
    let h = max(voxelSize() * 0.35, 0.05);
    let dx = vec3f(h, 0.0, 0.0);
    let dy = vec3f(0.0, h, 0.0);
    let dz = vec3f(0.0, 0.0, h);
    var gx = terrainAt(tex, p + dx) - terrainAt(tex, p - dx);
    var gy = terrainAt(tex, p + dy) - terrainAt(tex, p - dy);
    var gz = terrainAt(tex, p + dz) - terrainAt(tex, p - dz);
    if (amp > 0.0)
    {
        let e = h;
        gx = gx + (surfaceDetail(p + dx, amp) - surfaceDetail(p - dx, amp));
        gy = gy + (surfaceDetail(p + dy, amp) - surfaceDetail(p - dy, amp));
        gz = gz + (surfaceDetail(p + dz, amp) - surfaceDetail(p - dz, amp));
    }
    let l = length(vec3f(gx, gy, gz));
    return select(vec3f(0.0, 1.0, 0.0), vec3f(gx, gy, gz) / l, l > 1e-6);
}

//------------------------------------------------------------------------------------------
// Camera
//------------------------------------------------------------------------------------------
fn primaryRay(uv : vec2f) -> vec3f
{
    let jitter = vec2f(frame.camRight.w, frame.camUp.w);
    let px = (uv * 2.0 - vec2f(1.0)) + jitter;
    let aspect = frame.view.x / max(frame.view.y, 1.0);
    let dir = frame.camFwd.xyz
        + frame.camRight.xyz * (px.x * aspect * frame.camPos.w)
        + frame.camUp.xyz * (-px.y * frame.camPos.w);
    return normalize(dir);
}

//------------------------------------------------------------------------------------------
// Sky, tone mapping, colour utilities
//------------------------------------------------------------------------------------------
fn skyColor(rd : vec3f) -> vec3f
{
    let sunDir = normalize(frame.sun.xyz);
    let up = clamp(rd.y, -1.0, 1.0);
    let horizon = vec3f(0.52, 0.58, 0.66);
    let zenith = vec3f(0.16, 0.28, 0.48);
    var col = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.55));
    col = mix(col, vec3f(0.10, 0.09, 0.09), clamp(-up * 2.2, 0.0, 1.0));
    let mu = clamp(dot(rd, sunDir), 0.0, 1.0);
    col = col + vec3f(1.0, 0.72, 0.42) * pow(mu, 8.0) * 0.35 * frame.sun.w;
    let disk = smoothstep(0.9985, 0.9995, mu);
    col = col + vec3f(1.0, 0.9, 0.75) * disk * 12.0 * frame.sun.w;
    let sunSize = 0.06;
    let glow = exp(-(1.0 - mu) / sunSize) * 0.45;
    col = col + vec3f(1.0, 0.62, 0.30) * glow * frame.sun.w;
    return col * frame.sky.x;
}

fn integrateFog(col : vec3f, dist : f32, rd : vec3f) -> vec3f
{
    let density = max(frame.sky.y, 0.0);
    let heightFade = exp(-max(frame.camPos.y, 0.0) * 0.0009);
    let f = 1.0 - exp(-dist * density * heightFade * 0.001);
    return mix(col, skyColor(rd) * 0.9, clamp(f, 0.0, 1.0));
}

fn acesFilm(x : vec3f) -> vec3f
{
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn tonemap(col : vec3f) -> vec3f
{
    let exposed = col * frame.sky.z;
    let mapped = acesFilm(exposed);
    let g = pow(mapped, vec3f(1.0 / 2.2));
    return g;
}

fn srgbToLinear(c : vec3f) -> vec3f
{
    return pow(max(c, vec3f(0.0)), vec3f(2.2));
}

fn luminance(c : vec3f) -> f32
{
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
`;
