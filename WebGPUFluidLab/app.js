/*
 * SLATE / FLUID VOLUME
 * A compact WebGPU SPH lab: uniform-grid neighbor search, pressure + viscosity forces,
 * analytic collider contacts, adhesion, dynamic-resolution render targets, and a ray-lit
 * presentation pass. The simulation is deliberately kept in WGSL instead of hiding the
 * interesting work behind a framework so the shader path is easy to inspect and extend.
 */

const canvas = document.querySelector('#fluid-canvas');
const loadingCard = document.querySelector('#loading-card');
const loadingMessage = document.querySelector('#loading-message');
const errorCard = document.querySelector('#error-card');
const statusLabel = document.querySelector('#status-label');
const gpuLabel = document.querySelector('#gpu-label');
const backendLabel = document.querySelector('#backend-label');
const fpsValue = document.querySelector('#fps-value');
const resolutionValue = document.querySelector('#resolution-value');
const dynamicResValue = document.querySelector('#dynamic-res');
const playButton = document.querySelector('#play-button');
const playLabel = document.querySelector('#play-label');
const playGlyph = document.querySelector('.play-glyph');
const resetButton = document.querySelector('#reset-button');
const particleValue = document.querySelector('#particle-value');
const materialDescription = document.querySelector('#material-description');

const PARTICLE_COUNT = 12_288;
const WORKGROUP_SIZE = 64;
const GRID = { x: 26, y: 24, z: 22 };
const CELL_COUNT = GRID.x * GRID.y * GRID.z;
const CELL_CAPACITY = 64;
const SMOOTHING_LENGTH = 0.12;
const DOMAIN_MIN = [-1.56, 0.0, -1.32];
const DOMAIN_MAX = [1.56, 2.88, 1.32];
const SIM_PARAMS_SIZE = 112;
const FRAME_SIZE = 128;
const NEAR = 0.05;
const FAR = 18.0;

const MATERIALS = {
  water: {
    name: 'Water',
    color: [0.035, 0.29, 0.92],
    alpha: 0.74,
    restDensity: 998,
    mass: 0.22,
    pressure: 2100,
    viscosity: 0.045,
    adhesion: 0.06,
    cohesion: 0.08,
    description: 'Clear, fast-moving liquid with a crisp surface response.'
  },
  milk: {
    name: 'Milk',
    color: [0.92, 0.82, 0.58],
    alpha: 0.82,
    restDensity: 1030,
    mass: 0.23,
    pressure: 2300,
    viscosity: 0.22,
    adhesion: 0.22,
    cohesion: 0.15,
    description: 'Creamy, denser flow with a soft highlight and gentle cling.'
  },
  chocolate: {
    name: 'Chocolate',
    color: [0.39, 0.055, 0.014],
    alpha: 0.93,
    restDensity: 1320,
    mass: 0.28,
    pressure: 3100,
    viscosity: 0.66,
    adhesion: 0.62,
    cohesion: 0.25,
    description: 'Slow, glossy couverture with high viscosity and surface cling.'
  },
  mud: {
    name: 'Mud',
    color: [0.31, 0.15, 0.065],
    alpha: 0.97,
    restDensity: 1650,
    mass: 0.34,
    pressure: 3600,
    viscosity: 0.92,
    adhesion: 0.88,
    cohesion: 0.34,
    description: 'Heavy granular slurry: thick motion, high adhesion, matte finish.'
  }
};

let device;
let context;
let presentationFormat;
let computePipelines;
let backgroundPipeline;
let fluidPipeline;
let presentPipeline;
let computeBindGroup;
let backgroundBindGroup;
let fluidBindGroup;
let presentBindGroup;
let particleBuffer;
let velocityBuffer;
let densityBuffer;
let cellCountBuffer;
let cellParticleBuffer;
let colliderBuffer;
let simParamsBuffer;
let frameBuffer;
let sceneTexture;
let sceneDepthTexture;
let sampler;
let frameData = new Float32Array(FRAME_SIZE / 4);
let simData = new ArrayBuffer(SIM_PARAMS_SIZE);
let simView = new DataView(simData);
let particleInitialPositions;
let particleInitialVelocities;
let currentMaterial = 'water';
let running = true;
let stickySurfaces = true;
let movingPaddle = true;
let showGrid = true;
let lastTime = performance.now();
let elapsed = 0;
let frameCounter = 0;
let fpsAccumulator = 0;
let fpsFrames = 0;
let displayedFps = 0;
let renderScale = 0.90;
let targetScale = 0.90;
let renderWidth = 1;
let renderHeight = 1;
let canvasWidth = 1;
let canvasHeight = 1;
let activeTargetKey = '';
let orbitYaw = 0.48;
let orbitPitch = 0.10;
let orbitDistance = 4.75;
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

const camera = {
  eye: [0, 0, 0],
  forward: [0, 0, -1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  tanHalf: Math.tan(32 * Math.PI / 180)
};

const COMPUTE_SHADER = /* wgsl */`
struct SimParams {
  particleCount: u32,
  gridX: u32,
  gridY: u32,
  gridZ: u32,
  cellCapacity: u32,
  colliderCount: u32,
  substeps: u32,
  flags: u32,
  dt: f32,
  smoothingLength: f32,
  particleMass: f32,
  restDensity: f32,
  pressure: f32,
  viscosity: f32,
  adhesion: f32,
  cohesion: f32,
  gravity: vec4<f32>,
  domainMin: vec4<f32>,
  domainMax: vec4<f32>,
};

struct Collider {
  data0: vec4<f32>, // xyz = center, w = 0 sphere / 1 box
  data1: vec4<f32>, // sphere: x radius; box: xyz half extents
  data2: vec4<f32>, // display color
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densities: array<f32>;
@group(0) @binding(3) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellParticles: array<u32>;
@group(0) @binding(5) var<uniform> params: SimParams;
@group(0) @binding(6) var<storage, read> colliders: array<Collider>;

const PI: f32 = 3.14159265359;
const PARTICLE_RADIUS: f32 = 0.037;

fn gridCoord(p: vec3<f32>) -> vec3<i32> {
  let q = floor((p - params.domainMin.xyz) / params.smoothingLength);
  return clamp(vec3<i32>(q), vec3<i32>(0), vec3<i32>(i32(params.gridX) - 1, i32(params.gridY) - 1, i32(params.gridZ) - 1));
}

fn cellIndex(c: vec3<i32>) -> u32 {
  return u32(c.x) + u32(c.y) * params.gridX + u32(c.z) * params.gridX * params.gridY;
}

fn poly6(r2: f32) -> f32 {
  let h2 = params.smoothingLength * params.smoothingLength;
  if (r2 >= h2) { return 0.0; }
  let x = h2 - r2;
  return 315.0 / (64.0 * PI * pow(params.smoothingLength, 9.0)) * x * x * x;
}

fn spikyGradient(r: f32, dir: vec3<f32>) -> vec3<f32> {
  if (r <= 0.0001 || r >= params.smoothingLength) { return vec3<f32>(0.0); }
  let x = params.smoothingLength - r;
  return -45.0 / (PI * pow(params.smoothingLength, 6.0)) * x * x * dir;
}

fn viscosityLaplacian(r: f32) -> f32 {
  if (r >= params.smoothingLength) { return 0.0; }
  return 45.0 / (PI * pow(params.smoothingLength, 6.0)) * (params.smoothingLength - r);
}

// Returns signed distance to a collider and the outward normal. The box branch is
// intentionally analytic: it remains stable at low render rates and gives the
// adhesion force a clean surface normal to work against.
fn colliderSurface(p: vec3<f32>, collider: Collider) -> vec4<f32> {
  let center = collider.data0.xyz;
  if (collider.data0.w < 0.5) {
    let q = p - center;
    let d = length(q);
    let n = select(vec3<f32>(0.0, 1.0, 0.0), q / max(d, 0.0001), d > 0.0001);
    return vec4<f32>(d - collider.data1.x - PARTICLE_RADIUS, n);
  }
  let halfSize = collider.data1.xyz;
  let q = abs(p - center) - halfSize;
  let outside = max(q, vec3<f32>(0.0));
  let outsideDistance = length(outside);
  var normal = normalize(select(vec3<f32>(0.0, 1.0, 0.0), p - center, length(p - center) > 0.0001));
  if (outsideDistance > 0.0001) {
    normal = normalize(outside * sign(p - center));
  } else {
    if (q.x > q.y && q.x > q.z) { normal = vec3<f32>(sign(p.x - center.x), 0.0, 0.0); }
    else if (q.y > q.z) { normal = vec3<f32>(0.0, sign(p.y - center.y), 0.0); }
    else { normal = vec3<f32>(0.0, 0.0, sign(p.z - center.z)); }
  }
  let insideDistance = max(q.x, max(q.y, q.z));
  return vec4<f32>(select(insideDistance, outsideDistance, outsideDistance > 0.0001) - PARTICLE_RADIUS, normal);
}

@compute @workgroup_size(64)
fn clearCells(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.gridX * params.gridY * params.gridZ) {
    atomicStore(&cellCounts[id.x], 0u);
  }
}

@compute @workgroup_size(64)
fn buildGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.particleCount) { return; }
  let c = gridCoord(positions[id.x].xyz);
  let cell = cellIndex(c);
  let slot = atomicAdd(&cellCounts[cell], 1u);
  if (slot < params.cellCapacity) {
    cellParticles[cell * params.cellCapacity + slot] = id.x;
  }
}

@compute @workgroup_size(64)
fn computeDensity(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.particleCount) { return; }
  let p = positions[id.x].xyz;
  let base = gridCoord(p);
  var density = 0.0;
  var dz: i32 = -1;
  loop {
    if (dz > 1) { break; }
    var dy: i32 = -1;
    loop {
      if (dy > 1) { break; }
      var dx: i32 = -1;
      loop {
        if (dx > 1) { break; }
        let sample = base + vec3<i32>(dx, dy, dz);
        if (all(sample >= vec3<i32>(0)) && sample.x < i32(params.gridX) && sample.y < i32(params.gridY) && sample.z < i32(params.gridZ)) {
          let cell = cellIndex(sample);
          let count = min(atomicLoad(&cellCounts[cell]), params.cellCapacity);
          var k: u32 = 0u;
          loop {
            if (k >= count) { break; }
            let j = cellParticles[cell * params.cellCapacity + k];
            let delta = p - positions[j].xyz;
            density += params.particleMass * poly6(dot(delta, delta));
            k += 1u;
          }
        }
        dx += 1;
      }
      dy += 1;
    }
    dz += 1;
  }
  densities[id.x] = max(density, params.restDensity * 0.20);
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.particleCount) { return; }
  var p = positions[id.x].xyz;
  var v = velocities[id.x].xyz;
  let rho = max(densities[id.x], params.restDensity * 0.20);
  let pressure = max(0.0, params.pressure * (rho / params.restDensity - 0.78));
  let base = gridCoord(p);
  var acceleration = params.gravity.xyz;
  var dz: i32 = -1;
  loop {
    if (dz > 1) { break; }
    var dy: i32 = -1;
    loop {
      if (dy > 1) { break; }
      var dx: i32 = -1;
      loop {
        if (dx > 1) { break; }
        let sample = base + vec3<i32>(dx, dy, dz);
        if (all(sample >= vec3<i32>(0)) && sample.x < i32(params.gridX) && sample.y < i32(params.gridY) && sample.z < i32(params.gridZ)) {
          let cell = cellIndex(sample);
          let count = min(atomicLoad(&cellCounts[cell]), params.cellCapacity);
          var k: u32 = 0u;
          loop {
            if (k >= count) { break; }
            let j = cellParticles[cell * params.cellCapacity + k];
            if (j != id.x) {
              let delta = p - positions[j].xyz;
              let distance = length(delta);
              if (distance > 0.0001 && distance < params.smoothingLength) {
                let direction = delta / distance;
                let otherRho = max(densities[j], params.restDensity * 0.20);
                let otherPressure = max(0.0, params.pressure * (otherRho / params.restDensity - 0.78));
                let pressureForce = -params.particleMass * (pressure + otherPressure) / (2.0 * rho * otherRho) * spikyGradient(distance, direction);
                let relativeVelocity = velocities[j].xyz - v;
                // A small shear response makes the thick presets feel different
                // when the paddle tears through them, without destabilising water.
                let shearMultiplier = 1.0 + params.viscosity * min(length(relativeVelocity) * 0.35, 3.0);
                let viscousForce = params.viscosity * shearMultiplier * params.particleMass * relativeVelocity / otherRho * viscosityLaplacian(distance);
                let cohesionForce = -direction * params.cohesion * 8.0 * (params.smoothingLength - distance) / params.smoothingLength;
                acceleration += pressureForce + viscousForce + cohesionForce;
              }
            }
            k += 1u;
          }
        }
        dx += 1;
      }
      dy += 1;
    }
    dz += 1;
  }

  // Domain walls are soft enough to read as liquid instead of a rigid box, but
  // still guarantee that no particle can escape the simulation volume.
  let wallDistance = 0.055;
  if (p.x < params.domainMin.x + wallDistance) { p.x = params.domainMin.x + wallDistance; v.x = abs(v.x) * 0.34; v.z *= 0.93; }
  if (p.x > params.domainMax.x - wallDistance) { p.x = params.domainMax.x - wallDistance; v.x = -abs(v.x) * 0.34; v.z *= 0.93; }
  if (p.y < params.domainMin.y + PARTICLE_RADIUS) { p.y = params.domainMin.y + PARTICLE_RADIUS; v.y = abs(v.y) * 0.20; v.xz = v.xz * 0.985; }
  if (p.y > params.domainMax.y - wallDistance) { p.y = params.domainMax.y - wallDistance; v.y = -abs(v.y) * 0.25; }
  if (p.z < params.domainMin.z + wallDistance) { p.z = params.domainMin.z + wallDistance; v.z = abs(v.z) * 0.34; v.x *= 0.93; }
  if (p.z > params.domainMax.z - wallDistance) { p.z = params.domainMax.z - wallDistance; v.z = -abs(v.z) * 0.34; v.x *= 0.93; }

  var colliderIndex: u32 = 0u;
  loop {
    if (colliderIndex >= params.colliderCount) { break; }
    let surface = colliderSurface(p, colliders[colliderIndex]);
    let signedDistance = surface.x;
    let normal = surface.yzw;
    if (signedDistance < 0.0) {
      p += normal * (-signedDistance + 0.001);
      let normalVelocity = dot(v, normal);
      if (normalVelocity < 0.0) { v -= normal * normalVelocity * 1.18; }
      v *= 0.985;
    } else if ((params.flags & 1u) != 0u && signedDistance < 0.17) {
      let cling = clamp((0.17 - signedDistance) / 0.17, 0.0, 1.0);
      acceleration += normal * params.adhesion * 105.0 * cling;
      v *= 1.0 - params.adhesion * 0.025 * cling;
    }
    colliderIndex += 1u;
  }

  v += acceleration * params.dt;
  // A conservative velocity limit keeps a newly released source stable while
  // preserving the material ordering: water moves fastest, mud slowest.
  let speed = length(v);
  if (speed > 7.5) { v *= 7.5 / speed; }
  p += v * params.dt;
  positions[id.x] = vec4<f32>(p, positions[id.x].w);
  velocities[id.x] = vec4<f32>(v, 0.0);
}
`;

const RENDER_SHADER = /* wgsl */`
struct FrameUniforms {
  eye: vec4<f32>,
  forward: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  projection: vec4<f32>, // tan half fov, aspect, near, far
  viewport: vec4<f32>, // width, height, time, particle size
  material: vec4<f32>, // rgb + alpha
  settings: vec4<f32>, // grid, sticky, moving paddle, unused
};
struct Collider {
  data0: vec4<f32>,
  data1: vec4<f32>,
  data2: vec4<f32>,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;

struct BackgroundVertex {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn backgroundVertex(@builtin(vertex_index) vertexIndex: u32) -> BackgroundVertex {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  let p = positions[vertexIndex];
  var out: BackgroundVertex;
  out.position = vec4<f32>(p, 0.999, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}

fn sphereHit(origin: vec3<f32>, direction: vec3<f32>, center: vec3<f32>, radius: f32) -> vec4<f32> {
  let oc = origin - center;
  let b = dot(oc, direction);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let nearHit = -b - sqrt(h);
  let farHit = -b + sqrt(h);
  let t = select(farHit, nearHit, nearHit > 0.0);
  if (t < 0.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let normal = normalize(origin + direction * t - center);
  return vec4<f32>(t, normal);
}

fn boxHit(origin: vec3<f32>, direction: vec3<f32>, center: vec3<f32>, halfSize: vec3<f32>) -> vec4<f32> {
  let inverseDirection = 1.0 / (direction + vec3<f32>(0.00001));
  let t0 = (center - halfSize - origin) * inverseDirection;
  let t1 = (center + halfSize - origin) * inverseDirection;
  let lo = min(t0, t1);
  let hi = max(t0, t1);
  let nearHit = max(0.0, max(lo.x, max(lo.y, lo.z)));
  let farHit = min(hi.x, min(hi.y, hi.z));
  if (nearHit > farHit) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let p = origin + direction * nearHit;
  let q = (p - center) / halfSize;
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(q.x) > abs(q.y) && abs(q.x) > abs(q.z)) { normal = vec3<f32>(sign(q.x), 0.0, 0.0); }
  else if (abs(q.y) > abs(q.z)) { normal = vec3<f32>(0.0, sign(q.y), 0.0); }
  else { normal = vec3<f32>(0.0, 0.0, sign(q.z)); }
  return vec4<f32>(nearHit, normal);
}

struct BackgroundFragment {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn backgroundFragment(input: BackgroundVertex) -> BackgroundFragment {
  let screen = input.uv * 2.0 - 1.0;
  let tanHalf = frame.projection.x;
  let aspect = frame.projection.y;
  let origin = frame.eye.xyz;
  let direction = normalize(frame.forward.xyz + frame.right.xyz * screen.x * tanHalf * aspect + frame.up.xyz * screen.y * tanHalf);
  var sky = mix(vec3<f32>(0.018, 0.027, 0.043), vec3<f32>(0.09, 0.15, 0.23), max(direction.y, 0.0));
  sky += vec3<f32>(0.012, 0.026, 0.045) * pow(max(dot(direction, normalize(vec3<f32>(-0.5, 0.5, 0.4))), 0.0), 20.0);
  var nearest = 100000.0;
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  var objectColor = vec3<f32>(0.10, 0.13, 0.18);

  // A thin studio floor provides contact shadows and a scale reference for the
  // fluid. Grid lines are intentionally subtle so they never overpower the sim.
  if (direction.y < -0.0001) {
    let floorT = -origin.y / direction.y;
    let floorPoint = origin + direction * floorT;
    if (floorT > 0.0 && abs(floorPoint.x) < 2.5 && abs(floorPoint.z) < 2.0) {
      nearest = floorT;
      normal = vec3<f32>(0.0, 1.0, 0.0);
      let gridX = abs(fract(floorPoint.x * 2.0) - 0.5);
      let gridZ = abs(fract(floorPoint.z * 2.0) - 0.5);
      let gridLine = 1.0 - smoothstep(0.46, 0.50, max(gridX, gridZ));
      let base = vec3<f32>(0.045, 0.064, 0.084);
      let line = vec3<f32>(0.14, 0.24, 0.30);
      objectColor = mix(base, line, gridLine * step(0.5, frame.settings.x));
    }
  }

  var colliderIndex: u32 = 0u;
  loop {
    if (colliderIndex >= 3u) { break; }
    let collider = colliders[colliderIndex];
    let hit = select(boxHit(origin, direction, collider.data0.xyz, collider.data1.xyz), sphereHit(origin, direction, collider.data0.xyz, collider.data1.x), collider.data0.w < 0.5);
    if (hit.x > 0.0 && hit.x < nearest) {
      nearest = hit.x;
      normal = hit.yzw;
      objectColor = collider.data2.xyz;
    }
    colliderIndex += 1u;
  }

  var outputColor = sky;
  var depth = 1.0;
  if (nearest < 10000.0) {
    let hitPoint = origin + direction * nearest;
    let lightDirection = normalize(vec3<f32>(-0.42, 0.86, 0.30));
    let diffuse = 0.25 + 0.75 * max(dot(normal, lightDirection), 0.0);
    let rim = pow(1.0 - max(dot(normal, -direction), 0.0), 3.0);
    let ambientOcclusion = 1.0 - 0.16 * exp(-max(hitPoint.y, 0.0) * 2.5);
    outputColor = objectColor * diffuse * ambientOcclusion + vec3<f32>(0.08, 0.13, 0.18) * rim;
    depth = clamp((nearest - frame.projection.z) / (frame.projection.w - frame.projection.z), 0.0, 0.998);
  }
  var result: BackgroundFragment;
  result.color = vec4<f32>(outputColor, 1.0);
  result.depth = depth;
  return result;
}

struct FluidVertex {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) centerDepth: f32,
};

@vertex
fn fluidVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> FluidVertex {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
  );
  let local = corners[vertexIndex];
  let center = positions[instanceIndex].xyz;
  let radius = 0.037 * frame.viewport.w;
  let toCenter = center - frame.eye.xyz;
  let centerDepth = dot(toCenter, frame.forward.xyz);
  let world = center + frame.right.xyz * local.x * radius + frame.up.xyz * local.y * radius;
  let x = dot(world - frame.eye.xyz, frame.right.xyz) / (frame.projection.x * frame.projection.y);
  let y = dot(world - frame.eye.xyz, frame.up.xyz) / frame.projection.x;
  let z = (dot(world - frame.eye.xyz, frame.forward.xyz) - frame.projection.z) / (frame.projection.w - frame.projection.z);
  var output: FluidVertex;
  output.position = vec4<f32>(x, y, z, 1.0);
  output.local = local;
  output.centerDepth = centerDepth;
  return output;
}

struct FluidFragment {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fluidFragment(input: FluidVertex) -> FluidFragment {
  let r2 = dot(input.local, input.local);
  if (r2 > 1.0) { discard; }
  let sphereZ = sqrt(1.0 - r2);
  let normal = normalize(frame.right.xyz * input.local.x + frame.up.xyz * input.local.y + frame.forward.xyz * sphereZ);
  let surfaceDepth = input.centerDepth - sphereZ * (0.037 * frame.viewport.w);
  let depth = clamp((surfaceDepth - frame.projection.z) / (frame.projection.w - frame.projection.z), 0.0, 1.0);
  let lightDirection = normalize(vec3<f32>(-0.38, 0.82, 0.32));
  let diffuse = 0.32 + 0.68 * max(dot(normal, lightDirection), 0.0);
  let view = max(dot(normal, -frame.forward.xyz), 0.0);
  let fresnel = pow(1.0 - view, 4.0);
  let specular = pow(max(dot(reflect(-lightDirection, normal), -frame.forward.xyz), 0.0), 34.0);
  let edge = smoothstep(0.0, 0.55, 1.0 - r2);
  var liquid = frame.material.rgb * diffuse;
  liquid += vec3<f32>(0.28, 0.50, 0.65) * fresnel * 0.65;
  liquid += vec3<f32>(1.0, 0.92, 0.76) * specular * (0.22 + fresnel * 0.4);
  var result: FluidFragment;
  result.color = vec4<f32>(liquid, frame.material.a * (0.64 + edge * 0.36));
  result.depth = depth;
  return result;
}
`;

const PRESENT_SHADER = /* wgsl */`
@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
struct PresentOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn presentVertex(@builtin(vertex_index) vertexIndex: u32) -> PresentOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  let position = p[vertexIndex];
  var out: PresentOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = position * 0.5 + 0.5;
  return out;
}
@fragment
fn presentFragment(input: PresentOut) -> @location(0) vec4<f32> {
  let color = textureSample(sceneTexture, sceneSampler, input.uv);
  let vignette = 1.0 - smoothstep(0.35, 0.92, distance(input.uv, vec2<f32>(0.5)));
  return vec4<f32>(color.rgb * (0.88 + vignette * 0.12), 1.0);
}
`;

function setLoading(message) {
  if (loadingMessage) loadingMessage.textContent = message;
}

function setStatus(message) {
  if (statusLabel) statusLabel.textContent = message;
}

function writeSimParams(dt) {
  simView.setUint32(0, PARTICLE_COUNT, true);
  simView.setUint32(4, GRID.x, true);
  simView.setUint32(8, GRID.y, true);
  simView.setUint32(12, GRID.z, true);
  simView.setUint32(16, CELL_CAPACITY, true);
  simView.setUint32(20, 3, true);
  simView.setUint32(24, 3, true);
  simView.setUint32(28, stickySurfaces ? 1 : 0, true);
  const material = MATERIALS[currentMaterial];
  simView.setFloat32(32, dt, true);
  simView.setFloat32(36, SMOOTHING_LENGTH, true);
  simView.setFloat32(40, material.mass, true);
  simView.setFloat32(44, material.restDensity, true);
  simView.setFloat32(48, material.pressure, true);
  simView.setFloat32(52, material.viscosity, true);
  simView.setFloat32(56, material.adhesion, true);
  simView.setFloat32(60, material.cohesion, true);
  simView.setFloat32(64, 0.0, true);
  simView.setFloat32(68, -Number(document.querySelector('#gravity-slider').value), true);
  simView.setFloat32(72, 0.0, true);
  simView.setFloat32(76, 0.0, true);
  simView.setFloat32(80, DOMAIN_MIN[0], true);
  simView.setFloat32(84, DOMAIN_MIN[1], true);
  simView.setFloat32(88, DOMAIN_MIN[2], true);
  simView.setFloat32(92, 0.0, true);
  simView.setFloat32(96, DOMAIN_MAX[0], true);
  simView.setFloat32(100, DOMAIN_MAX[1], true);
  simView.setFloat32(104, DOMAIN_MAX[2], true);
  simView.setFloat32(108, 0.0, true);
  device.queue.writeBuffer(simParamsBuffer, 0, simData);
}

function writeFrameUniforms() {
  const material = MATERIALS[currentMaterial];
  frameData.fill(0);
  frameData.set([...camera.eye, 1], 0);
  frameData.set([...camera.forward, 0], 4);
  frameData.set([...camera.right, 0], 8);
  frameData.set([...camera.up, 0], 12);
  frameData.set([camera.tanHalf, renderWidth / Math.max(1, renderHeight), NEAR, FAR], 16);
  frameData.set([renderWidth, renderHeight, elapsed, Number(document.querySelector('#size-slider').value)], 20);
  frameData.set([...material.color, material.alpha], 24);
  frameData.set([showGrid ? 1 : 0, stickySurfaces ? 1 : 0, movingPaddle ? 1 : 0, 0], 28);
  device.queue.writeBuffer(frameBuffer, 0, frameData);
}

function createParticleData() {
  particleInitialPositions = new Float32Array(PARTICLE_COUNT * 4);
  particleInitialVelocities = new Float32Array(PARTICLE_COUNT * 4);
  let index = 0;
  // A compact source volume, slightly perturbed in x/z. It drops as a single
  // cohesive pour and then spreads across the floor and collision set.
  for (let y = 0; y < 24; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 32; x++) {
        const j = index * 4;
        const wobble = Math.sin(index * 12.9898) * 0.0022;
        particleInitialPositions[j] = -0.93 + x * 0.060 + wobble;
        particleInitialPositions[j + 1] = 1.32 + y * 0.060 + Math.cos(index * 7.31) * 0.002;
        particleInitialPositions[j + 2] = -0.45 + z * 0.060 + wobble * 0.7;
        particleInitialPositions[j + 3] = 1;
        particleInitialVelocities[j] = 0;
        particleInitialVelocities[j + 1] = 0;
        particleInitialVelocities[j + 2] = 0;
        particleInitialVelocities[j + 3] = 0;
        index++;
      }
    }
  }
}

function resetParticles() {
  if (!device || !particleBuffer) return;
  device.queue.writeBuffer(particleBuffer, 0, particleInitialPositions);
  device.queue.writeBuffer(velocityBuffer, 0, particleInitialVelocities);
  const blankDensity = new Float32Array(PARTICLE_COUNT).fill(MATERIALS[currentMaterial].restDensity);
  device.queue.writeBuffer(densityBuffer, 0, blankDensity);
  elapsed = 0;
  setStatus('SIMULATION RESET');
  window.setTimeout(() => setStatus('SOLVER RUNNING'), 700);
}

function updateCamera() {
  const target = [0, 1.15, 0];
  const cp = Math.cos(orbitPitch);
  camera.eye[0] = target[0] + Math.sin(orbitYaw) * cp * orbitDistance;
  camera.eye[1] = target[1] + Math.sin(orbitPitch) * orbitDistance;
  camera.eye[2] = target[2] + Math.cos(orbitYaw) * cp * orbitDistance;
  const f = normalize(sub(target, camera.eye));
  const worldUp = [0, 1, 0];
  const r = normalize(cross(f, worldUp));
  const u = normalize(cross(r, f));
  camera.forward = f;
  camera.right = r;
  camera.up = u;
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function updateColliders() {
  if (!colliderBuffer) return;
  const data = new Float32Array(36);
  const paddleX = movingPaddle ? Math.sin(elapsed * 1.35) * 0.58 : 0;
  const paddleZ = movingPaddle ? Math.cos(elapsed * 1.35) * 0.24 - 0.24 : -0.24;
  // Sphere: center/type, radius, display color.
  data.set([0.47, 0.52, 0.04, 0, 0.34, 0, 0, 0, 0.12, 0.17, 0.24, 0], 0);
  // Fixed low box: a broad ledge catches and redirects the pour.
  data.set([-0.50, 0.48, 0.10, 1, 0.48, 0.10, 0.27, 0, 0.17, 0.23, 0.30, 0], 12);
  // Paddle: moves laterally through the settled volume.
  data.set([paddleX, 0.92, paddleZ, 1, 0.62, 0.075, 0.17, 0, 0.30, 0.18, 0.11, 0], 24);
  device.queue.writeBuffer(colliderBuffer, 0, data);
}

function createTargets() {
  const key = `${renderWidth}x${renderHeight}`;
  if (key === activeTargetKey) return;
  activeTargetKey = key;
  sceneTexture?.destroy();
  sceneDepthTexture?.destroy();
  sceneTexture = device.createTexture({
    label: 'fluid lab scene color',
    size: [renderWidth, renderHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });
  sceneDepthTexture = device.createTexture({
    label: 'fluid lab scene depth',
    size: [renderWidth, renderHeight],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });
  presentBindGroup = device.createBindGroup({
    layout: presentPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneTexture.createView() },
      { binding: 1, resource: sampler }
    ]
  });
  resolutionValue.textContent = `${renderWidth}×${renderHeight}`;
}

function resize() {
  if (!device || !context) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasWidth = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvasHeight = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    context.configure({ device, format: presentationFormat, alphaMode: 'opaque' });
  }
  renderWidth = Math.max(320, Math.floor(canvasWidth * renderScale));
  renderHeight = Math.max(240, Math.floor(canvasHeight * renderScale));
  createTargets();
}

function updateDynamicResolution(deltaMs) {
  // This is intentionally a render-target scale, not a UI-only indicator: the
  // scene color and depth attachments are recreated at the selected resolution,
  // then upsampled by the final presentation pass.
  if (displayedFps > 0 && displayedFps < 42) targetScale = Math.max(0.64, targetScale - 0.025);
  else if (displayedFps > 57) targetScale = Math.min(1.0, targetScale + 0.012);
  if (Math.abs(targetScale - renderScale) > 0.018) {
    renderScale += Math.sign(targetScale - renderScale) * 0.018;
    renderScale = Math.max(0.64, Math.min(1, renderScale));
    resize();
  }
  dynamicResValue.textContent = `${Math.round(renderScale * 100)}%`;
}

function makeBuffers() {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  particleBuffer = device.createBuffer({ label: 'SPH positions', size: PARTICLE_COUNT * 16, usage: storage });
  velocityBuffer = device.createBuffer({ label: 'SPH velocities', size: PARTICLE_COUNT * 16, usage: storage });
  densityBuffer = device.createBuffer({ label: 'SPH densities', size: PARTICLE_COUNT * 4, usage: storage });
  cellCountBuffer = device.createBuffer({ label: 'uniform grid cell counts', size: CELL_COUNT * 4, usage: storage });
  cellParticleBuffer = device.createBuffer({ label: 'uniform grid particle ids', size: CELL_COUNT * CELL_CAPACITY * 4, usage: storage });
  colliderBuffer = device.createBuffer({ label: 'analytic colliders', size: 36 * 4, usage: storage });
  simParamsBuffer = device.createBuffer({ label: 'SPH parameters', size: SIM_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  frameBuffer = device.createBuffer({ label: 'camera and frame uniforms', size: FRAME_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
}

function createPipelines() {
  const computeModule = device.createShaderModule({ label: 'SPH WGSL compute', code: COMPUTE_SHADER });
  const computeLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
  ] });
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
  computePipelines = {
    clear: device.createComputePipeline({ layout: computePipelineLayout, compute: { module: computeModule, entryPoint: 'clearCells' } }),
    build: device.createComputePipeline({ layout: computePipelineLayout, compute: { module: computeModule, entryPoint: 'buildGrid' } }),
    density: device.createComputePipeline({ layout: computePipelineLayout, compute: { module: computeModule, entryPoint: 'computeDensity' } }),
    integrate: device.createComputePipeline({ layout: computePipelineLayout, compute: { module: computeModule, entryPoint: 'integrate' } })
  };
  computeBindGroup = device.createBindGroup({ layout: computeLayout, entries: [
    { binding: 0, resource: { buffer: particleBuffer } }, { binding: 1, resource: { buffer: velocityBuffer } },
    { binding: 2, resource: { buffer: densityBuffer } }, { binding: 3, resource: { buffer: cellCountBuffer } },
    { binding: 4, resource: { buffer: cellParticleBuffer } }, { binding: 5, resource: { buffer: simParamsBuffer } },
    { binding: 6, resource: { buffer: colliderBuffer } }
  ] });

  const renderModule = device.createShaderModule({ label: 'fluid volume WGSL render', code: RENDER_SHADER });
  const backgroundLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
  ] });
  const fluidLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
  ] });
  const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [backgroundLayout] });
  backgroundPipeline = device.createRenderPipeline({
    label: 'studio background and colliders', layout: renderPipelineLayout,
    vertex: { module: renderModule, entryPoint: 'backgroundVertex' },
    fragment: { module: renderModule, entryPoint: 'backgroundFragment', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' }, depthStencil
  });
  const fluidPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [fluidLayout] });
  fluidPipeline = device.createRenderPipeline({
    label: 'SPH liquid surface', layout: fluidPipelineLayout,
    vertex: { module: renderModule, entryPoint: 'fluidVertex' },
    fragment: {
      module: renderModule, entryPoint: 'fluidFragment',
      targets: [{ format: 'rgba8unorm', blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }]
    },
    primitive: { topology: 'triangle-list' }, depthStencil
  });
  backgroundBindGroup = device.createBindGroup({ layout: backgroundLayout, entries: [
    { binding: 0, resource: { buffer: frameBuffer } }, { binding: 1, resource: { buffer: particleBuffer } }, { binding: 2, resource: { buffer: colliderBuffer } }
  ] });
  fluidBindGroup = device.createBindGroup({ layout: fluidLayout, entries: [
    { binding: 0, resource: { buffer: frameBuffer } }, { binding: 1, resource: { buffer: particleBuffer } }
  ] });

  const presentModule = device.createShaderModule({ label: 'dynamic resolution upscale WGSL', code: PRESENT_SHADER });
  const presentLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
  ] });
  presentPipeline = device.createRenderPipeline({
    label: 'dynamic resolution presenter', layout: device.createPipelineLayout({ bindGroupLayouts: [presentLayout] }),
    vertex: { module: presentModule, entryPoint: 'presentVertex' },
    fragment: { module: presentModule, entryPoint: 'presentFragment', targets: [{ format: presentationFormat }] },
    primitive: { topology: 'triangle-list' }
  });
}

function encodeSimulation(encoder) {
  if (!running) return;
  const pass = encoder.beginComputePass({ label: 'SPH solver substep' });
  pass.setBindGroup(0, computeBindGroup);
  pass.setPipeline(computePipelines.clear);
  pass.dispatchWorkgroups(Math.ceil(CELL_COUNT / WORKGROUP_SIZE));
  pass.setPipeline(computePipelines.build);
  pass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
  pass.setPipeline(computePipelines.density);
  pass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
  pass.setPipeline(computePipelines.integrate);
  pass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
  pass.end();
}

function renderFrame() {
  const now = performance.now();
  const deltaMs = Math.min(50, now - lastTime);
  lastTime = now;
  const delta = deltaMs / 1000;
  const timeScale = Number(document.querySelector('#time-slider').value);
  elapsed += delta * timeScale;
  fpsAccumulator += deltaMs;
  fpsFrames++;
  if (fpsAccumulator > 450) {
    displayedFps = Math.round((fpsFrames * 1000) / fpsAccumulator);
    fpsValue.textContent = String(displayedFps);
    fpsAccumulator = 0;
    fpsFrames = 0;
    updateDynamicResolution(deltaMs);
  }
  updateCamera();
  updateColliders();
  writeFrameUniforms();

  const encoder = device.createCommandEncoder({ label: 'fluid volume frame' });
  if (running) {
    const substeps = 3;
    const stepDt = Math.min(delta, 0.024) * timeScale / substeps;
    writeSimParams(stepDt);
    for (let i = 0; i < substeps; i++) encodeSimulation(encoder);
  }

  const sceneView = sceneTexture.createView();
  const depthView = sceneDepthTexture.createView();
  const scenePass = encoder.beginRenderPass({
    label: 'fluid lab scene',
    colorAttachments: [{ view: sceneView, clearValue: { r: 0.01, g: 0.015, b: 0.025, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }
  });
  scenePass.setPipeline(backgroundPipeline);
  scenePass.setBindGroup(0, backgroundBindGroup);
  scenePass.draw(3);
  scenePass.setPipeline(fluidPipeline);
  scenePass.setBindGroup(0, fluidBindGroup);
  scenePass.draw(6, PARTICLE_COUNT);
  scenePass.end();

  const outputView = context.getCurrentTexture().createView();
  const presentPass = encoder.beginRenderPass({
    label: 'dynamic resolution present',
    colorAttachments: [{ view: outputView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
  });
  presentPass.setPipeline(presentPipeline);
  presentPass.setBindGroup(0, presentBindGroup);
  presentPass.draw(3);
  presentPass.end();
  device.queue.submit([encoder.finish()]);
  frameCounter++;

  if (frameCounter === 2) {
    loadingCard.classList.add('hidden');
    setStatus('SOLVER RUNNING');
  }
  requestAnimationFrame(renderFrame);
}

function updateControlLabels() {
  const gravity = Number(document.querySelector('#gravity-slider').value);
  document.querySelector('#gravity-output').textContent = `-${gravity.toFixed(1)} m/s²`;
  const time = Number(document.querySelector('#time-slider').value);
  document.querySelector('#time-output').textContent = `${time.toFixed(2)}×`;
  const size = Number(document.querySelector('#size-slider').value);
  document.querySelector('#size-output').textContent = `${size.toFixed(2)}×`;
}

function selectMaterial(key) {
  if (!MATERIALS[key]) return;
  currentMaterial = key;
  document.querySelectorAll('.material-card').forEach(card => card.classList.toggle('active', card.dataset.material === key));
  materialDescription.textContent = MATERIALS[key].description;
  if (device) resetParticles();
}

function wireUI() {
  particleValue.textContent = PARTICLE_COUNT.toLocaleString();
  document.querySelectorAll('.material-card').forEach(card => card.addEventListener('click', () => selectMaterial(card.dataset.material)));
  playButton.addEventListener('click', () => {
    running = !running;
    playLabel.textContent = running ? 'PAUSE' : 'PLAY';
    playGlyph.textContent = running ? 'Ⅱ' : '▶';
    setStatus(running ? 'SOLVER RUNNING' : 'SOLVER PAUSED');
  });
  resetButton.addEventListener('click', resetParticles);
  document.querySelector('#gravity-slider').addEventListener('input', updateControlLabels);
  document.querySelector('#time-slider').addEventListener('input', updateControlLabels);
  document.querySelector('#size-slider').addEventListener('input', updateControlLabels);
  document.querySelector('#paddle-toggle').addEventListener('change', event => { movingPaddle = event.target.checked; });
  document.querySelector('#sticky-toggle').addEventListener('change', event => { stickySurfaces = event.target.checked; });
  document.querySelector('#grid-toggle').addEventListener('change', event => { showGrid = event.target.checked; });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); playButton.click(); }
    if (event.code === 'KeyR') resetParticles();
  });
  canvas.addEventListener('pointerdown', event => { isDragging = true; lastPointerX = event.clientX; lastPointerY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!isDragging) return;
    orbitYaw -= (event.clientX - lastPointerX) * 0.008;
    orbitPitch = Math.max(-0.55, Math.min(0.72, orbitPitch + (event.clientY - lastPointerY) * 0.006));
    lastPointerX = event.clientX; lastPointerY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => { isDragging = false; });
  canvas.addEventListener('pointercancel', () => { isDragging = false; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); orbitDistance = Math.max(2.7, Math.min(8.0, orbitDistance + event.deltaY * 0.0025)); }, { passive: false });
  window.addEventListener('resize', resize);
  updateControlLabels();
}

async function init() {
  wireUI();
  createParticleData();
  if (!navigator.gpu) throw new Error('navigator.gpu is not available');
  setLoading('Requesting a WebGPU adapter…');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found');
  device = await adapter.requestDevice();
  device.lost.then(info => {
    if (info.reason !== 'destroyed') showError(`GPU device lost: ${info.message || info.reason}`);
  });
  context = canvas.getContext('webgpu');
  presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  canvas.width = Math.max(1, canvas.clientWidth);
  canvas.height = Math.max(1, canvas.clientHeight);
  context.configure({ device, format: presentationFormat, alphaMode: 'opaque' });
  gpuLabel.textContent = 'WEBGPU';
  backendLabel.textContent = adapter.info?.architecture ? adapter.info.architecture.toUpperCase() : 'COMPUTE';
  setLoading('Compiling SPH compute and surface shaders…');
  makeBuffers();
  createPipelines();
  resize();
  resetParticles();
  updateCamera();
  writeFrameUniforms();
  setLoading('Uniform grid online · releasing source…');
  requestAnimationFrame(renderFrame);
}

function showError(message) {
  loadingCard.classList.add('hidden');
  errorCard.classList.remove('hidden');
  errorCard.querySelector('span').textContent = `${message}. Open this page in a WebGPU-capable browser to run the compute path.`;
  setStatus('DEVICE UNAVAILABLE');
  gpuLabel.textContent = 'OFFLINE';
  backendLabel.textContent = 'FALLBACK';
}

init().catch(error => {
  console.error(error);
  showError(error.message || 'Unable to initialize WebGPU');
});
