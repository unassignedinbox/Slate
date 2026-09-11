/*
 * STRATA / SDF TERRAIN LAB
 * A dependency-free, interaction-first prototype of a volumetric terrain authoring tool.
 * The renderer is a WebGL2 ray-marched SDF with a small typed particle preview layered on top.
 * It deliberately keeps the simulation state explicit so the node graph can later be backed by
 * ping-pong 3D textures / compute passes without changing the authoring surface.
 */

(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  const state = {
    running: true,
    emitter: 'rain',
    selection: 'erosion',
    inspector: 'erosion',
    viewMode: 0,
    riverEnabled: true,
    waterEnabled: true,
    intensity: 0.68,
    radius: 3,
    capacity: 0.62,
    deposition: 0.34,
    riverSpeed: 3.2,
    waterLevel: -0.35,
    wave: 0.12,
    foam: 0.42,
    relief: 12,
    roughness: 0.48,
    clock: 0,
    simTime: 0,
    steps: 482,
    erosion: 0.42,
    removed: 18.42,
    deposited: 7.08,
    sediment: 0.18,
    lastFrame: 16.6,
  };

  let seed = 0x5a17c9;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };

  // ---------------------------------------------------------------------------
  // WebGL2 SDF renderer
  // ---------------------------------------------------------------------------

  const canvas = $('#viewport');
  let gl = null;
  let terrainProgram = null;
  let particleProgram = null;
  let quadBuffer = null;
  let particlePositionBuffer = null;
  let particleSizeBuffer = null;
  let particleTypeBuffer = null;
  let particleEnergyBuffer = null;
  let terrainUniforms = {};
  let particleUniforms = {};
  let rendererReady = false;

  const terrainVertex = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const terrainFragment = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;

    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uSimTime;
    uniform float uErosion;
    uniform float uIntensity;
    uniform float uRiverSpeed;
    uniform float uWaterLevel;
    uniform float uWave;
    uniform float uFoam;
    uniform float uWaterEnabled;
    uniform float uRoughness;
    uniform int uViewMode;
    uniform vec3 uCamera;
    uniform vec3 uTarget;

    const float FAR_CLIP = 62.0;
    const vec3 SUN = vec3(-0.384, 0.790, 0.485);

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float hash31(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0));
      float n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0));
      float n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1));
      float n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1));
      float n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y), mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        value += amp * noise3(p);
        p = p * 2.02 + vec3(13.1, 7.7, 4.3);
        amp *= 0.5;
      }
      return value;
    }

    float sdBox(vec3 p, vec3 b) {
      vec3 q = abs(p) - b;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }

    float sdRoundBox(vec3 p, vec3 b, float r) {
      vec3 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
    }

    float sdEllipsoid(vec3 p, vec3 r) {
      return (length(p / r) - 1.0) * min(min(r.x, r.y), r.z);
    }

    float riverCenter(float z) {
      return 0.76 * (2.4 * sin(z * 0.17 + 0.3) + 0.9 * sin(z * 0.39 - 0.6));
    }

    float riverWidth(float z) {
      return 1.72 + 0.18 * sin(z * 0.31 + 1.2);
    }

    float riverWave(vec3 p) {
      float primary = sin(p.z * 4.5 - uTime * (1.7 + uRiverSpeed * 0.34) + p.x * 1.35);
      float cross = sin(p.z * 9.0 + p.x * 3.0 - uTime * 2.6);
      float detail = noise3(vec3(p.x * 1.5, p.y * 4.0, p.z * 0.65) + vec3(uTime * .08, 0.0, -uTime * .13));
      return uWaterLevel + uWave * (primary * 0.42 + cross * 0.12 + (detail - .5) * .18);
    }

    // The canyon is a union of volumetric primitives followed by subtractions.
    // It intentionally has finite walls, a cut channel, and true 3D cavities.
    float terrainSdf(vec3 p) {
      float d = 100.0;
      d = min(d, sdRoundBox(p - vec3(0.0, -2.20, 0.0), vec3(12.9, 2.35, 10.8), 0.90));
      d = min(d, sdRoundBox(p - vec3(-7.30, 2.10, -4.20), vec3(4.35, 5.10, 4.75), 0.72));
      d = min(d, sdRoundBox(p - vec3(7.10, 1.72, -4.90), vec3(4.60, 4.72, 5.15), 0.82));
      d = min(d, sdRoundBox(p - vec3(-1.10, 0.55, -8.00), vec3(3.60, 3.70, 2.45), 0.60));
      d = min(d, sdRoundBox(p - vec3(10.0, -0.15, 4.0), vec3(2.5, 2.0, 3.0), 0.62));

      // A bounded, open-top river cutter. bed - y means the region above the bed is removed.
      float cx = riverCenter(p.z);
      // Erosion is a real modifier in the preview: accumulated contact requests deepen
      // and very slightly widen the channel instead of only tinting the material.
      float wear = clamp(uErosion, 0.0, 1.6);
      float bed = -1.06 - wear * 0.26 + 0.10 * sin(p.z * .42);
      float channel = max(abs(p.x - cx) - riverWidth(p.z) - wear * 0.055, bed - p.y);
      channel = max(channel, abs(p.z) - 11.4);
      d = max(d, -channel);

      // Side cave and a second undercut produce topology a height field cannot represent.
      float cave = sdEllipsoid(p - vec3(-8.40, -0.35, 0.42), vec3(2.30, 1.65, 2.55));
      d = max(d, -cave);
      float undercut = sdEllipsoid(p - vec3(7.10, -0.55, 0.70), vec3(2.40, 1.28, 2.75));
      d = max(d, -undercut);

      // Bedding and wind-cut grooves stay in the signed field instead of a normal-map-only pass.
      float bedding = 0.09 * sin(p.y * 5.0 + 0.7 * sin(p.z * .38)) + 0.035 * sin(p.y * 17.0 + p.x * .4);
      float rough = (noise3(p * vec3(.32, .44, .32)) - .5) * (.09 + uRoughness * .08);
      d += (bedding + rough) * (1.0 - smoothstep(0.0, 5.5, abs(d)));
      return d;
    }

    float waterSdf(vec3 p) {
      float side = abs(p.x - riverCenter(p.z)) - riverWidth(p.z) + 0.03;
      float along = abs(p.z) - 11.38;
      float surface = abs(p.y - riverWave(p)) - 0.055;
      return max(max(side, along), surface);
    }

    vec3 terrainNormal(vec3 p) {
      const float e = 0.018;
      vec2 h = vec2(e, 0.0);
      return normalize(vec3(
        terrainSdf(p + h.xyy) - terrainSdf(p - h.xyy),
        terrainSdf(p + h.yxy) - terrainSdf(p - h.yxy),
        terrainSdf(p + h.yyx) - terrainSdf(p - h.yyx)
      ));
    }

    vec3 waterNormal(vec3 p) {
      const float e = 0.014;
      return normalize(vec3(
        waterSdf(p + vec3(e,0,0)) - waterSdf(p - vec3(e,0,0)),
        waterSdf(p + vec3(0,e,0)) - waterSdf(p - vec3(0,e,0)),
        waterSdf(p + vec3(0,0,e)) - waterSdf(p - vec3(0,0,e))
      ));
    }

    bool traceTerrain(vec3 ro, vec3 rd, out float hitT) {
      float t = 0.0;
      for (int i = 0; i < 116; i++) {
        vec3 p = ro + rd * t;
        float d = terrainSdf(p);
        if (d < 0.012) { hitT = t; return true; }
        t += clamp(d * 0.72, 0.025, 0.78);
        if (t > FAR_CLIP) break;
      }
      hitT = FAR_CLIP;
      return false;
    }

    bool traceWater(vec3 ro, vec3 rd, out float hitT) {
      float t = 0.0;
      for (int i = 0; i < 72; i++) {
        vec3 p = ro + rd * t;
        float d = waterSdf(p);
        if (d < 0.009) { hitT = t; return true; }
        t += clamp(d * 0.82, 0.02, 0.55);
        if (t > FAR_CLIP) break;
      }
      hitT = FAR_CLIP;
      return false;
    }

    float softShadow(vec3 ro, vec3 rd) {
      float result = 1.0;
      float t = 0.08;
      for (int i = 0; i < 22; i++) {
        float h = terrainSdf(ro + rd * t);
        result = min(result, 14.0 * h / t);
        t += clamp(h, 0.03, 0.48);
        if (h < 0.01 || t > 15.0) break;
      }
      return clamp(result, 0.18, 1.0);
    }

    float ambientOcclusion(vec3 p, vec3 n) {
      float occ = 0.0;
      float weight = 1.0;
      for (int i = 0; i < 4; i++) {
        float h = 0.10 + float(i) * 0.22;
        occ += (h - terrainSdf(p + n * h)) * weight;
        weight *= 0.58;
      }
      return clamp(1.0 - occ * 0.55, 0.35, 1.0);
    }

    vec3 sky(vec3 rd) {
      float horizon = smoothstep(-0.28, 0.55, rd.y);
      vec3 low = vec3(0.025, 0.045, 0.065);
      vec3 high = vec3(0.115, 0.15, 0.205);
      vec3 col = mix(low, high, horizon);
      float sun = pow(max(dot(rd, SUN), 0.0), 90.0);
      col += vec3(1.0, .52, .28) * sun * .38;
      return col;
    }

    vec3 rockMaterial(vec3 p, vec3 n) {
      float fine = noise3(p * 2.1);
      float strata = 0.5 + 0.5 * sin(p.y * 5.7 + p.z * .12 + fine * 1.2);
      vec3 sandstone = mix(vec3(.30,.13,.085), vec3(.60,.28,.14), fine);
      sandstone = mix(sandstone, vec3(.70,.39,.22), strata * .33);
      float mineral = smoothstep(.48,.82,noise3(p * vec3(.8,3.0,.8) + 8.0));
      sandstone = mix(sandstone, vec3(.25,.16,.14), mineral * .25);
      // Wet banks and the channel cut show the material exchange happening in the field.
      float wet = 1.0 - smoothstep(.9, 2.35, abs(p.x - riverCenter(p.z)));
      wet *= smoothstep(-1.4, .4, p.y);
      sandstone = mix(sandstone, vec3(.19,.25,.24), wet * .36);
      float depositBand = smoothstep(.2, .78, uErosion) * (1.0 - smoothstep(.05, .95, abs(p.x-riverCenter(p.z))));
      sandstone = mix(sandstone, vec3(.62,.36,.18), depositBand * .22);
      float facing = max(dot(n, SUN), 0.0);
      sandstone *= .78 + facing * .32;
      if (uViewMode == 1) {
        float clay = dot(sandstone, vec3(.299,.587,.114));
        sandstone = vec3(clay) * vec3(1.02,.96,.88);
      } else if (uViewMode == 2) {
        float heat = clamp(.22 + uErosion * .48 + wet * .32 + sin(p.z * 1.2) * .05, 0.0, 1.0);
        sandstone = mix(vec3(.06,.16,.25), vec3(.86,.28,.10), heat);
      }
      return sandstone;
    }

    vec3 shadeWater(vec3 p, vec3 rd, vec3 n) {
      vec3 reflected = sky(reflect(rd, n));
      float fresnel = pow(1.0 - max(dot(-rd,n),0.0), 4.0);
      float flow = 0.5 + 0.5 * sin(p.z * 8.5 - uTime * (2.0 + uRiverSpeed * .48) + p.x * 3.2);
      float flowFine = 0.5 + 0.5 * sin(p.z * 21.0 - uTime * 3.2 + p.x * 5.0);
      float bank = smoothstep(riverWidth(p.z)-.22, riverWidth(p.z)-.02, abs(p.x-riverCenter(p.z)));
      float foamNoise = noise3(vec3(p.x*2.0, p.z*.55, uTime*.08 + p.y));
      float foam = bank * uFoam * smoothstep(.34,.8,foamNoise) * (.55 + flow*.45);
      vec3 deep = mix(vec3(.025,.20,.22), vec3(.035,.37,.40), flow*.4 + flowFine*.18);
      vec3 color = mix(deep, reflected, fresnel*.64);
      color += vec3(.16,.38,.32) * flowFine * .11;
      color = mix(color, vec3(.78,.82,.70), foam*.72);
      color += vec3(1.0,.65,.35) * pow(max(dot(reflect(-SUN,n),-rd),0.0), 50.0) * .42;
      if (uViewMode == 2) color = mix(color, vec3(.25,.83,.77), .28);
      return color;
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec3 forward = normalize(uTarget - uCamera);
      vec3 right = normalize(cross(forward, vec3(0.0,1.0,0.0)));
      vec3 up = normalize(cross(right, forward));
      float fov = 0.74;
      vec3 rd = normalize(forward + centered.x * right * aspect * fov + centered.y * up * fov);
      vec3 ro = uCamera;

      float terrainT, waterT;
      bool terrainHit = traceTerrain(ro, rd, terrainT);
      bool waterHit = uWaterEnabled > 0.5 && traceWater(ro, rd, waterT);
      vec3 color = sky(rd);

      if (terrainHit || waterHit) {
        bool showWater = waterHit && (!terrainHit || waterT < terrainT);
        if (showWater) {
          vec3 wp = ro + rd * waterT;
          vec3 wn = waterNormal(wp);
          color = shadeWater(wp, rd, wn);
          // Bed depth tint keeps the water shader tied to the SDF channel instead of a flat decal.
          float depth = clamp((wp.y + 1.05) * .7, 0.0, 1.0);
          color = mix(color, color * vec3(.72, .82, .77), depth * .22);
        } else {
          vec3 p = ro + rd * terrainT;
          vec3 n = terrainNormal(p);
          vec3 base = rockMaterial(p, n);
          float light = softShadow(p + n*.025, SUN);
          float ao = ambientOcclusion(p, n);
          float rim = pow(1.0 - max(dot(n, -rd),0.0), 3.0);
          color = base * (0.35 + .65 * light) * ao;
          color += vec3(.48,.20,.10) * rim * .16;
          // Contact glow visualises the local particle/field interaction.
          float contact = exp(-abs(p.x - riverCenter(p.z)) * 1.8) * smoothstep(-1.2,.15,p.y);
          color += vec3(.12,.34,.33) * contact * .08 * (0.7 + uIntensity);
          if (uViewMode == 2) color = mix(color, vec3(.15,.26,.36), .12);
        }
      }

      float haze = smoothstep(28.0, FAR_CLIP, length(ro + rd * (terrainHit ? terrainT : 30.0)));
      color = mix(color, vec3(.045,.063,.085), haze * .34);
      color = pow(max(color, vec3(0.0)), vec3(.92));
      float vignette = 1.0 - smoothstep(.55, 1.44, length(centered * vec2(.84,.96))) * .22;
      color *= vignette;
      outColor = vec4(color, 1.0);
    }
  `;

  const particleVertex = `#version 300 es
    precision highp float;
    in vec3 aPosition;
    in float aSize;
    in float aType;
    in float aEnergy;
    uniform mat4 uView;
    uniform mat4 uProjection;
    uniform vec2 uResolution;
    out float vType;
    out float vEnergy;
    void main() {
      vec4 viewPosition = uView * vec4(aPosition, 1.0);
      gl_Position = uProjection * viewPosition;
      gl_PointSize = clamp(aSize * (uResolution.y * .80) / max(-viewPosition.z, 1.0), 1.4, 10.0);
      vType = aType;
      vEnergy = aEnergy;
    }
  `;

  const particleFragment = `#version 300 es
    precision highp float;
    in float vType;
    in float vEnergy;
    out vec4 outColor;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = dot(p,p);
      if (d > 1.0) discard;
      float soft = smoothstep(1.0, .12, d);
      vec3 color;
      if (vType < .5) color = vec3(.67,.88,1.0);
      else if (vType < 1.5) color = vec3(.25,.92,.86);
      else if (vType < 2.5) color = vec3(1.0,.74,.40);
      else color = vec3(1.0,.42,.24);
      color += vec3(1.0) * vEnergy * .18;
      outColor = vec4(color, soft * (.32 + vEnergy * .46));
    }
  `;

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
      console.error(message, source);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const vertex = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }

  function initRenderer() {
    try {
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 context is unavailable');
      terrainProgram = createProgram(terrainVertex, terrainFragment);
      particleProgram = createProgram(particleVertex, particleFragment);
      if (!terrainProgram || !particleProgram) throw new Error('SDF shader compilation failed');

      quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

      terrainUniforms = {
        position: gl.getAttribLocation(terrainProgram, 'aPosition'),
        resolution: gl.getUniformLocation(terrainProgram, 'uResolution'),
        time: gl.getUniformLocation(terrainProgram, 'uTime'),
        simTime: gl.getUniformLocation(terrainProgram, 'uSimTime'),
        erosion: gl.getUniformLocation(terrainProgram, 'uErosion'),
        intensity: gl.getUniformLocation(terrainProgram, 'uIntensity'),
        riverSpeed: gl.getUniformLocation(terrainProgram, 'uRiverSpeed'),
        waterLevel: gl.getUniformLocation(terrainProgram, 'uWaterLevel'),
        wave: gl.getUniformLocation(terrainProgram, 'uWave'),
        foam: gl.getUniformLocation(terrainProgram, 'uFoam'),
        waterEnabled: gl.getUniformLocation(terrainProgram, 'uWaterEnabled'),
        roughness: gl.getUniformLocation(terrainProgram, 'uRoughness'),
        viewMode: gl.getUniformLocation(terrainProgram, 'uViewMode'),
        camera: gl.getUniformLocation(terrainProgram, 'uCamera'),
        target: gl.getUniformLocation(terrainProgram, 'uTarget'),
      };

      particleUniforms = {
        position: gl.getAttribLocation(particleProgram, 'aPosition'),
        size: gl.getAttribLocation(particleProgram, 'aSize'),
        type: gl.getAttribLocation(particleProgram, 'aType'),
        energy: gl.getAttribLocation(particleProgram, 'aEnergy'),
        view: gl.getUniformLocation(particleProgram, 'uView'),
        projection: gl.getUniformLocation(particleProgram, 'uProjection'),
        resolution: gl.getUniformLocation(particleProgram, 'uResolution'),
      };

      particlePositionBuffer = gl.createBuffer();
      particleSizeBuffer = gl.createBuffer();
      particleTypeBuffer = gl.createBuffer();
      particleEnergyBuffer = gl.createBuffer();
      gl.disable(gl.DEPTH_TEST);
      rendererReady = true;
    } catch (error) {
      console.warn(error);
      $('#webglFallback').classList.remove('hidden');
      canvas.style.background = 'radial-gradient(ellipse at 56% 36%, #2a3336 0%, #151b22 45%, #080b11 90%)';
    }
  }

  // ---------------------------------------------------------------------------
  // Camera / particle state
  // ---------------------------------------------------------------------------

  const camera = {
    yaw: 0.72,
    pitch: 0.33,
    distance: 27.0,
    target: [0, 0.5, 0],
  };

  function cameraPosition() {
    const cp = Math.cos(camera.pitch);
    return [
      camera.target[0] + Math.sin(camera.yaw) * cp * camera.distance,
      camera.target[1] + Math.sin(camera.pitch) * camera.distance,
      camera.target[2] + Math.cos(camera.yaw) * cp * camera.distance,
    ];
  }

  function normalize3(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }
  function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

  function lookAt(eye, target) {
    const z = normalize3([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
    const x = normalize3(cross3([0,1,0], z));
    const y = cross3(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
    ]);
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0,
    ]);
  }

  const PARTICLE_COUNT = 1024;
  const particles = [];
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleSizes = new Float32Array(PARTICLE_COUNT);
  const particleTypes = new Float32Array(PARTICLE_COUNT);
  const particleEnergies = new Float32Array(PARTICLE_COUNT);

  function riverCenterJS(z) { return 0.76 * (2.4 * Math.sin(z * 0.17 + 0.3) + 0.9 * Math.sin(z * 0.39 - 0.6)); }
  function surfaceHeight(x, z) {
    const cx = riverCenterJS(z);
    if (Math.abs(x - cx) < 2.05 && Math.abs(z) < 11.6) return -1.02 + .07 * Math.sin(z * .42);
    let height = 0.12;
    if (x < -3.0 && z < 1.0) height = Math.max(height, 6.55 - Math.abs(x + 7) * .11 + Math.sin(z * .33) * .24);
    if (x > 2.6 && z < 1.1) height = Math.max(height, 5.95 - Math.abs(x - 7) * .09 + Math.sin(z * .28 + 1) * .18);
    if (z < -5.5 && Math.abs(x + 1) < 4.4) height = Math.max(height, 4.05);
    return height;
  }

  function createParticle(kind) {
    return { kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, settled: 0, bounces: 0, energy: .35, phase: random(), cargo: .05 + random() * .12 };
  }

  function respawnParticle(p, preferredKind = null) {
    if (preferredKind !== null) p.kind = preferredKind;
    p.age = random() * 1.2;
    p.settled = 0;
    p.bounces = 0;
    p.phase = random() * TAU;
    p.cargo = .04 + random() * .16;
    p.energy = .3 + random() * .7;
    const z = lerp(-10.8, 10.6, random());
    const cx = riverCenterJS(z);
    if (p.kind === 0) {
      p.x = lerp(-11.4, 11.4, random());
      p.z = lerp(-10.5, 10.5, random());
      p.y = 9.0 + random() * 9.0;
      p.vx = (random() - .5) * .35;
      p.vy = -4.7 - random() * 4.4;
      p.vz = (random() - .5) * .35;
    } else if (p.kind === 1) {
      p.x = cx + (random() - .5) * 2.6;
      p.y = state.waterLevel + (random() - .5) * .08;
      p.z = -10.7 + random() * 1.7;
      p.vx = 0;
      p.vy = 0;
      p.vz = state.riverSpeed * (.72 + random() * .48);
    } else if (p.kind === 2) {
      p.x = -12.4 - random() * 1.7;
      p.y = 2.1 + random() * 6.3;
      p.z = lerp(-10.5, 10.5, random());
      p.vx = 3.0 + random() * 3.2;
      p.vy = (random() - .5) * .22;
      p.vz = (random() - .5) * .9;
    } else {
      p.x = (random() > .5 ? -7.4 : 7.0) + (random() - .5) * 4.0;
      p.z = -5.2 + (random() - .5) * 5.5;
      p.y = 7.2 + random() * 5.8;
      p.vx = (random() - .5) * .9;
      p.vy = -1.2 - random() * 2.5;
      p.vz = (random() - .5) * .7;
    }
  }

  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ratio = i / PARTICLE_COUNT;
      const kind = ratio < .58 ? 0 : ratio < .79 ? 1 : ratio < .94 ? 2 : 3;
      const p = createParticle(kind);
      respawnParticle(p);
      particles.push(p);
    }
    syncParticleBuffers();
  }

  function setParticleKindFocus(kind) {
    const kindId = { rain: 0, river: 1, wind: 2, rockfall: 3 }[kind];
    particles.forEach((p, i) => {
      // Keep a minority of other material types in frame so the mixed ledger remains legible.
      if (i < PARTICLE_COUNT * .67) respawnParticle(p, kindId);
      else respawnParticle(p);
    });
  }

  function updateParticles(dt) {
    if (!state.running) return;
    const intensity = .25 + state.intensity * 1.45;
    const riverFactor = state.riverEnabled ? 1 : 0;
    for (const p of particles) {
      p.age += dt;
      if (p.kind === 0) {
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const ground = surfaceHeight(p.x, p.z);
        if (p.y <= ground + .035) {
          p.y = ground + .04;
          p.settled += dt;
          p.energy = .24;
          p.cargo = Math.min(1, p.cargo + dt * .38 * intensity);
          state.erosion = clamp(state.erosion + dt * .008 * intensity, .12, 1.6);
          state.removed += dt * .0024 * intensity;
          state.deposited += dt * .0014 * state.deposition;
          state.sediment = clamp(state.sediment + dt * .0015, .05, .92);
          if (p.settled > .10 + p.phase * .08) respawnParticle(p);
        }
        if (p.age > 8.0) respawnParticle(p);
      } else if (p.kind === 1) {
        if (!state.riverEnabled) {
          p.x += (Math.sin(p.phase + state.clock) * .1) * dt;
          p.z += .3 * dt;
        } else {
          const cx = riverCenterJS(p.z);
          p.x += (cx - p.x) * dt * 2.8;
          p.z += p.vz * dt * riverFactor;
          p.y = state.waterLevel + Math.sin(p.phase + state.clock * 2.0) * .035;
          p.energy = .42 + .34 * Math.sin(p.phase + state.clock * 3.0);
          p.cargo = clamp(p.cargo + dt * .018 * intensity - dt * .012 * state.deposition, .03, .9);
          state.erosion = clamp(state.erosion + dt * .0048 * intensity * riverFactor, .12, 1.6);
          state.removed += dt * .0045 * intensity * riverFactor;
          state.deposited += dt * .0036 * state.deposition;
          state.sediment = clamp(state.sediment + dt * .002 * intensity, .05, .92);
        }
        if (p.z > 11.9 || p.age > 18) respawnParticle(p);
      } else if (p.kind === 2) {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += p.vy * dt + Math.sin(state.clock * 1.7 + p.phase) * dt * .12;
        p.vy += (3.7 + Math.sin(state.clock + p.phase) * .45 - p.y) * dt * .02;
        const ground = surfaceHeight(p.x, p.z);
        if (p.x > 12.0 || (p.y < ground + .12 && p.x > -6)) {
          p.settled += dt;
          p.energy = .58;
          state.erosion = clamp(state.erosion + dt * .0032 * intensity, .12, 1.6);
          state.removed += dt * .0012 * intensity;
          if (p.settled > .14) respawnParticle(p);
        }
        if (p.age > 13) respawnParticle(p);
      } else {
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const ground = surfaceHeight(p.x, p.z);
        if (p.y <= ground + .08) {
          p.y = ground + .08;
          state.removed += .0028 * intensity;
          state.erosion = clamp(state.erosion + .012 * intensity, .12, 1.6);
          p.bounces += 1;
          if (p.bounces < 2) {
            p.vy = Math.abs(p.vy) * (.20 + (1 - state.deposition) * .12);
            p.vx *= .48;
            p.vz *= .48;
            p.energy *= .56;
          } else {
            p.settled += dt;
            p.energy = .9;
            state.deposited += .0018 * state.deposition;
            if (p.settled > .25) respawnParticle(p);
          }
        }
        if (p.age > 9) respawnParticle(p);
      }
    }
    state.steps += 1;
    syncParticleBuffers();
  }

  function syncParticleBuffers() {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      particlePositions[i*3] = p.x;
      particlePositions[i*3+1] = p.y;
      particlePositions[i*3+2] = p.z;
      particleTypes[i] = p.kind;
      const radiusScale = clamp(state.radius / 3.0, .62, 1.55);
      particleSizes[i] = (p.kind === 3 ? .095 : p.kind === 2 ? .065 : p.kind === 1 ? .058 : .048) * radiusScale;
      particleEnergies[i] = clamp(p.energy, .1, 1);
    }
    if (!rendererReady) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, particlePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particlePositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particleSizes, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleTypeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particleTypes, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleEnergyBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particleEnergies, gl.DYNAMIC_DRAW);
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  function resizeRenderer() {
    const rect = canvas.getBoundingClientRect();
    // Keep the ray marcher inside a predictable pixel budget on laptops and preview sandboxes.
    const pixelBudget = 900000;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(pixelBudget / Math.max(1, rect.width * rect.height)));
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      if (rendererReady) gl.viewport(0, 0, width, height);
    }
  }

  function render() {
    if (!rendererReady) return;
    resizeRenderer();
    const width = canvas.width;
    const height = canvas.height;
    const eye = cameraPosition();
    const view = lookAt(eye, camera.target);
    const projection = perspective(.74, width / Math.max(height, 1), .1, 100);

    gl.viewport(0, 0, width, height);
    gl.clearColor(.025, .035, .05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(terrainProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(terrainUniforms.position);
    gl.vertexAttribPointer(terrainUniforms.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(terrainUniforms.resolution, width, height);
    gl.uniform1f(terrainUniforms.time, state.clock);
    gl.uniform1f(terrainUniforms.simTime, state.simTime);
    gl.uniform1f(terrainUniforms.erosion, state.erosion);
    gl.uniform1f(terrainUniforms.intensity, state.intensity);
    gl.uniform1f(terrainUniforms.riverSpeed, state.riverSpeed);
    gl.uniform1f(terrainUniforms.waterLevel, state.waterLevel);
    gl.uniform1f(terrainUniforms.wave, state.wave);
    gl.uniform1f(terrainUniforms.foam, state.foam);
    gl.uniform1f(terrainUniforms.waterEnabled, state.waterEnabled ? 1 : 0);
    gl.uniform1f(terrainUniforms.roughness, state.roughness);
    gl.uniform1i(terrainUniforms.viewMode, state.viewMode);
    gl.uniform3fv(terrainUniforms.camera, eye);
    gl.uniform3fv(terrainUniforms.target, camera.target);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(particleProgram);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, particlePositionBuffer);
    gl.enableVertexAttribArray(particleUniforms.position);
    gl.vertexAttribPointer(particleUniforms.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleSizeBuffer);
    gl.enableVertexAttribArray(particleUniforms.size);
    gl.vertexAttribPointer(particleUniforms.size, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleTypeBuffer);
    gl.enableVertexAttribArray(particleUniforms.type);
    gl.vertexAttribPointer(particleUniforms.type, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleEnergyBuffer);
    gl.enableVertexAttribArray(particleUniforms.energy);
    gl.vertexAttribPointer(particleUniforms.energy, 1, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(particleUniforms.view, false, view);
    gl.uniformMatrix4fv(particleUniforms.projection, false, projection);
    gl.uniform2f(particleUniforms.resolution, width, height);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    gl.disable(gl.BLEND);
  }

  // ---------------------------------------------------------------------------
  // UI state and interactions
  // ---------------------------------------------------------------------------

  let toastTimer = 0;
  function showToast(message) {
    $('#toastMessage').textContent = message;
    const toast = $('#toast');
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function updateRunButton() {
    const button = $('#runButton');
    const label = $('#runLabel');
    const glyph = $('.run-glyph', button);
    button.classList.toggle('paused', !state.running);
    label.textContent = state.running ? 'PAUSE' : 'RUN';
    glyph.textContent = state.running ? 'Ⅱ' : '▶';
  }

  function updateStatsUI() {
    $('#agentCountValue').textContent = '1,024';
    $('#graphAgentCount').textContent = '1,024';
    $('#riverSpeedReadout').textContent = `${state.riverSpeed.toFixed(1)} m/s`;
    $('#speedValue').textContent = `${state.riverSpeed.toFixed(1)} m/s`;
    $('#stepsReadout').textContent = String(state.steps).padStart(5, '0');
    $('#cacheStep').textContent = `step ${String(state.steps).padStart(5, '0')}`;
    $('#removedReadout').textContent = `${state.removed.toFixed(2)} m³`;
    $('#depositedReadout').textContent = `${state.deposited.toFixed(2)} m³`;
    $('#sedimentReadout').textContent = state.sediment.toFixed(2);
    $('#frameReadout').textContent = `${state.lastFrame.toFixed(1)} ms`;
    $('#cacheProgress').style.width = `${clamp(44 + state.erosion * 28, 42, 90)}%`;
  }

  function setInspectorTab(name) {
    state.inspector = name;
    $$('.inspector-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.inspector === name));
    $$('.inspector-view').forEach(view => view.classList.add('hidden'));
    const view = $(`.${name}-inspector`);
    if (view) view.classList.remove('hidden');
    const title = name === 'water' ? 'RIVER SURFACE' : name === 'terrain' ? 'TERRAIN SDF' : 'HYDRAULIC EROSION';
    $('#inspectorTitle').textContent = title;
  }

  function setSelection(id) {
    state.selection = id;
    $$('.tree-row, .stack-item').forEach(row => row.classList.toggle('selected', row.dataset.select === id));
    $$('.graph-node').forEach(node => node.classList.toggle('selected-node', node.dataset.node === id));
    if (id === 'water') setInspectorTab('water');
    else if (id === 'erosion' || id === 'wind' || id === 'deposit') setInspectorTab('erosion');
    else setInspectorTab('terrain');
    const name = id === 'water' ? 'River surface' : id === 'wind' ? 'Wind abrasion' : id === 'cave' ? 'Cave + overhang' : id === 'base' ? 'Rounded formation' : id === 'terrain' ? 'Terrain SDF' : id === 'deposit' ? 'Sediment ledger' : 'Hydraulic erosion';
    const heading = $('#selectedNodeName');
    if (heading) heading.textContent = name;
    const node = $(`.graph-node[data-node="${id}"]`);
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(updateGraphConnections);
  }

  function bindRange(id, outputId, formatter, callback) {
    const input = $(`#${id}`);
    const output = $(`#${outputId}`);
    if (!input || !output) return;
    const update = () => {
      const value = Number(input.value);
      output.textContent = formatter(value);
      if (callback) callback(value);
    };
    input.addEventListener('input', update);
    update();
  }

  function initUI() {
    // Scene/outliner selection.
    $$('.tree-row[data-select], .stack-item[data-select]').forEach(row => row.addEventListener('click', () => setSelection(row.dataset.select)));
    $$('.graph-node[data-node]').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target.closest('.node-menu')) return;
        setSelection(node.dataset.node);
      });
    });

    $$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => setInspectorTab(tab.dataset.inspector)));
    $$('.emitter-button').forEach(button => button.addEventListener('click', () => {
      $$('.emitter-button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      state.emitter = button.dataset.emitter;
      setParticleKindFocus(state.emitter);
      showToast(`${button.textContent.trim().split(/\s+/)[0]} emitter loaded · particles retain cargo`);
    }));

    bindRange('intensityRange', 'intensityValue', value => `${Math.round(value)}%`, value => { state.intensity = value / 100; });
    bindRange('radiusRange', 'radiusValue', value => `${value.toFixed(1)} mm`, value => { state.radius = value; syncParticleBuffers(); });
    bindRange('capacityRange', 'capacityValue', value => value.toFixed(2), value => { state.capacity = value; });
    bindRange('depositionRange', 'depositionValue', value => value.toFixed(2), value => { state.deposition = value; });
    bindRange('speedRange', 'speedValue', value => `${value.toFixed(1)} m/s`, value => { state.riverSpeed = value; $('#riverSpeedReadout').textContent = `${value.toFixed(1)} m/s`; });
    bindRange('reliefRange', 'reliefValue', value => `${value.toFixed(1)} m`, () => {});
    bindRange('roughnessRange', 'roughnessValue', value => value.toFixed(2), value => { state.roughness = value; });
    bindRange('levelRange', 'levelValue', value => `${value.toFixed(2)} m`, value => { state.waterLevel = value; });
    bindRange('waveRange', 'waveValue', value => `${value.toFixed(2)} m`, value => { state.wave = value; });
    bindRange('foamRange', 'foamValue', value => value.toFixed(2), value => { state.foam = value; });

    $('#runButton').addEventListener('click', () => {
      state.running = !state.running;
      updateRunButton();
      showToast(state.running ? 'Particle solver resumed' : 'Solver paused · water shader remains live');
    });
    $('#riverToggle').addEventListener('click', () => {
      state.riverEnabled = !state.riverEnabled;
      $('#riverToggle').classList.toggle('on', state.riverEnabled);
      showToast(state.riverEnabled ? 'River transport enabled' : 'River transport disabled · agents retained');
    });
    $('#waterToggle').addEventListener('click', () => {
      state.waterEnabled = !state.waterEnabled;
      $('#waterToggle').classList.toggle('on', state.waterEnabled);
      showToast(state.waterEnabled ? 'Water surface visible' : 'Water surface hidden · transport unchanged');
    });
    $('#resetSimulation').addEventListener('click', resetSimulation);
    $('#newSceneButton').addEventListener('click', () => {
      resetSimulation();
      camera.yaw = .72; camera.pitch = .33; camera.distance = 27; camera.target = [0,.5,0];
      showToast('New bounded land plot created · graph preserved');
    });
    $('#auditButton').addEventListener('click', () => {
      const balance = (state.removed - state.deposited).toFixed(2);
      showToast(`Mass audit complete · ${balance} m³ suspended / deposited`);
      $('#auditButton').classList.add('audit-done');
      window.setTimeout(() => $('#auditButton').classList.remove('audit-done'), 700);
    });
    $('#frameButton').addEventListener('click', () => {
      camera.yaw = .72; camera.pitch = .33; camera.distance = 27; camera.target = [0,.5,0];
      showToast('Camera framed to volume');
    });
    $('#viewModeButton').addEventListener('click', () => {
      state.viewMode = (state.viewMode + 1) % 3;
      $('#viewModeButton').innerHTML = `${state.viewMode === 0 ? 'LIT + SDF' : state.viewMode === 1 ? 'CLAY / NORMALS' : 'EROSION HEAT'} <span>⌄</span>`;
      showToast(state.viewMode === 2 ? 'Erosion heatmap preview' : state.viewMode === 1 ? 'Clay / normal preview' : 'Lit SDF preview');
    });
    $('#settingsButton').addEventListener('click', () => showToast('Project settings are scoped to the selected node'));
    $('#closeInspector').addEventListener('click', () => showToast('Inspector stays docked for deterministic authoring'));
    $('#focusGraph').addEventListener('click', () => { $('#nodeDock').classList.remove('collapsed'); showToast('Node graph focused'); });
    $('#collapseGraph').addEventListener('click', () => $('#nodeDock').classList.toggle('collapsed'));
    $$('.switcher').forEach(button => button.addEventListener('click', () => {
      $$('.switcher').forEach(item => item.classList.toggle('active', item === button));
      $$('.left-view').forEach(view => view.classList.toggle('hidden', view.classList.contains(`${button.dataset.leftView}-view`) === false));
    }));
    $$('.top-tab').forEach(button => button.addEventListener('click', () => {
      $$('.top-tab').forEach(item => item.classList.toggle('active', item === button));
      showToast(`${button.textContent.trim().toLowerCase()} workspace selected`);
    }));
    $('#addNodeButton').addEventListener('click', addGraphNode);
    $('#helpButton').addEventListener('click', () => openModal('helpModal'));
    $('#openResearch').addEventListener('click', () => openModal('researchModal'));
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => button.closest('.modal-backdrop').classList.add('hidden')));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.classList.add('hidden'); }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') $$('.modal-backdrop').forEach(modal => modal.classList.add('hidden'));
      if (event.target.matches('input, textarea, select')) return;
      if (event.code === 'Space') { event.preventDefault(); $('#runButton').click(); }
      if (event.key.toLowerCase() === 'a') $('#auditButton').click();
      if (event.key === '?') openModal('helpModal');
      if (event.key.toLowerCase() === '1') setInspectorTab('erosion');
      if (event.key.toLowerCase() === '2') setInspectorTab('terrain');
      if (event.key.toLowerCase() === '3') setInspectorTab('water');
    });

    initCameraControls();
    initGraphDragging();
    updateRunButton();
    updateStatsUI();
    setSelection('erosion');
    requestAnimationFrame(updateGraphConnections);
  }

  function openModal(id) { const modal = $(`#${id}`); if (modal) modal.classList.remove('hidden'); }

  function resetSimulation() {
    state.steps = 482;
    state.erosion = .42;
    state.removed = 18.42;
    state.deposited = 7.08;
    state.sediment = .18;
    state.simTime = 0;
    initParticles();
    updateStatsUI();
    showToast('Erosion state reset · SDF modifiers retained');
  }

  function addGraphNode() {
    const graph = $('#nodeGraph');
    const node = document.createElement('article');
    const id = `custom-${Date.now()}`;
    node.className = 'graph-node small-graph-node';
    node.dataset.node = id;
    node.style.left = `${55 + (graph.children.length * 31) % Math.max(440, graph.clientWidth - 200)}px`;
    node.style.top = `${graph.clientHeight > 130 ? 128 : 64}px`;
    node.innerHTML = '<div class="node-topline"><span class="node-type-icon violet">＋</span><span>MODIFIER</span><button class="node-menu">•••</button></div><h3>Custom SDF stamp</h3><p>new live input</p><div class="node-port-row"><span class="port-row-label right-label">OUTPUT</span><i class="port output"></i></div>';
    graph.appendChild(node);
    node.addEventListener('click', event => { if (!event.target.closest('.node-menu')) setSelection(id); });
    attachNodeDrag(node);
    setSelection(id);
    showToast('Live modifier node added');
    requestAnimationFrame(updateGraphConnections);
  }

  // ---------------------------------------------------------------------------
  // Graph connections and dragging
  // ---------------------------------------------------------------------------

  function portCenter(port, graphRect) {
    const rect = port.getBoundingClientRect();
    return { x: rect.left - graphRect.left + rect.width / 2, y: rect.top - graphRect.top + rect.height / 2 };
  }
  function updateGraphConnections() {
    const svg = $('#graphConnections');
    const graph = $('#nodeGraph');
    if (!svg || !graph) return;
    const graphRect = graph.getBoundingClientRect();
    const connections = [
      ['primitive-out','csg-in', false], ['csg-out','cave-in', false], ['cave-out','erosion-in', true], ['erosion-out','water-in', true], ['wind-out','erosion-in', false], ['erosion-out','deposit-in', false],
    ];
    svg.innerHTML = '';
    for (const [from, to, active] of connections) {
      const a = graph.querySelector(`[data-port="${from}"]`);
      const b = graph.querySelector(`[data-port="${to}"]`);
      if (!a || !b) continue;
      const p1 = portCenter(a, graphRect); const p2 = portCenter(b, graphRect);
      const bend = Math.max(24, Math.abs(p2.x-p1.x)*.42);
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x+bend} ${p1.y}, ${p2.x-bend} ${p2.y}, ${p2.x} ${p2.y}`);
      if (active) path.classList.add('active-link');
      svg.appendChild(path);
    }
  }

  function initGraphDragging() { $$('.graph-node').forEach(attachNodeDrag); }
  function attachNodeDrag(node) {
    if (node.dataset.dragReady) return;
    node.dataset.dragReady = '1';
    let drag = null;
    node.addEventListener('pointerdown', event => {
      if (event.target.closest('button, .port')) return;
      const graphRect = $('#nodeGraph').getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, graphRect, moved: false };
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    node.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.moved = true;
      const x = clamp(event.clientX - drag.graphRect.left - drag.offsetX, 6, Math.max(6, drag.graphRect.width - node.offsetWidth - 6));
      const y = clamp(event.clientY - drag.graphRect.top - drag.offsetY, 6, Math.max(6, drag.graphRect.height - node.offsetHeight - 6));
      node.style.left = `${x}px`; node.style.top = `${y}px`;
      updateGraphConnections();
    });
    node.addEventListener('pointerup', event => { if (drag && node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); drag = null; });
  }

  // ---------------------------------------------------------------------------
  // Viewport input
  // ---------------------------------------------------------------------------

  function initCameraControls() {
    let pointer = null;
    canvas.addEventListener('pointerdown', event => {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button, yaw: camera.yaw, pitch: camera.pitch, target: [...camera.target] };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (pointer.button === 1 || event.shiftKey) {
        const scale = camera.distance * .0023;
        camera.target[0] = pointer.target[0] - dx * scale;
        camera.target[1] = pointer.target[1] + dy * scale;
        camera.target[2] = pointer.target[2] + dx * scale * .45;
      } else {
        camera.yaw = pointer.yaw + dx * .006;
        camera.pitch = clamp(pointer.pitch + dy * .005, -0.1, 1.2);
      }
    });
    const release = event => { if (pointer && pointer.id === event.pointerId && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); pointer = null; };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', event => { camera.distance = clamp(camera.distance * Math.exp(event.deltaY * .001), 13, 48); event.preventDefault(); }, { passive: false });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  initRenderer();
  initParticles();
  initUI();

  let lastTime = performance.now();
  function frame(now) {
    const elapsed = Math.min(.05, Math.max(.001, (now - lastTime) / 1000));
    lastTime = now;
    state.clock += elapsed;
    if (state.running) state.simTime += elapsed;
    const frameMs = lerp(state.lastFrame, elapsed * 1000, .08);
    state.lastFrame = clamp(frameMs, 8.2, 32);
    updateParticles(elapsed);
    render();
    updateStatsUI();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => { resizeRenderer(); updateGraphConnections(); });
})();
