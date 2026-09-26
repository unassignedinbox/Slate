import * as THREE from 'three';
import { TIDE, COLORS } from './config.js';
import { clamp, smoothstep } from './util.js';

const WAVES = [
  { dx: 0.86, dz: 0.51, len: 52, amp: 0.42, speed: 7.2 },
  { dx: -0.44, dz: 0.9, len: 29, amp: 0.24, speed: 5.4 },
  { dx: 0.96, dz: -0.28, len: 14.5, amp: 0.13, speed: 4.1 },
];

const vert = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform sampler2D uHeightTex;
  uniform vec4 uBounds;      // minX, minZ, sizeX, sizeZ
  uniform vec2 uHeightRange; // min, range

  varying vec3 vWorld;
  varying float vDepth;
  varying float vShore;

  #include <fog_pars_vertex>

  float terrainHeight(vec2 p) {
    vec2 uv = (p - uBounds.xy) / uBounds.zw;
    vec2 cl = clamp(uv, 0.0, 1.0);
    float inside = step(0.0001, 1.0 - max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0);
    float h = texture2D(uHeightTex, cl).r * uHeightRange.y + uHeightRange.x;
    return mix(-9.0, h, inside);
  }

  void main() {
    vec3 pos = position;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    float ground = terrainHeight(wp.xz);
    float depth = uLevel - ground;
    // Waves flatten out as the water gets shallow.
    float shallowFade = smoothstep(0.0, 4.0, depth);

    float y = 0.0;
    ${WAVES.map(
      (w, i) => `{
      vec2 d = normalize(vec2(${w.dx.toFixed(3)}, ${w.dz.toFixed(3)}));
      float k = 6.2831853 / ${w.len.toFixed(2)};
      float ph = dot(d, wp.xz) * k + uTime * ${w.speed.toFixed(2)} * k * 0.35;
      y += sin(ph) * ${w.amp.toFixed(3)};
    }`
    ).join('\n')}
    // Steeper swell just before it breaks on the sand.
    float surf = smoothstep(2.6, 0.35, depth) * smoothstep(-0.3, 0.4, depth);
    y += sin(depth * 2.4 - uTime * 2.6) * 0.30 * surf;

    y *= shallowFade * 0.85 + 0.15;

    wp.y = uLevel + y;
    vWorld = wp.xyz;
    vDepth = depth + y;
    vShore = surf;

    // fog_vertex needs mvPosition; the scene fog varying must be written here
    // or the program fails to link (fog_fragment consumes vFogDepth).
    vec4 mvPosition = viewMatrix * wp;
    #include <fog_vertex>

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uSunDir;
  uniform vec3 uSkyColor;

  varying vec3 vWorld;
  varying float vDepth;
  varying float vShore;

  #include <fog_pars_fragment>

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    // Faceted low-poly normal straight from the rasterised triangle.
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;

    vec3 viewDir = normalize(cameraPosition - vWorld);
    float depth = max(vDepth, 0.0);

    vec3 col = mix(uShallow, uDeep, smoothstep(0.4, 9.0, depth));
    col = mix(col * 1.18, col, smoothstep(0.0, 3.0, depth));

    // Sun specular + sky fresnel.
    vec3 h = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 48.0);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.55;
    col = mix(col, uSkyColor, fres * 0.48);
    col *= 0.82 + 0.35 * max(dot(n, uSunDir), 0.0);

    // Breaking foam near the shoreline + streaks of spume.
    float bandNoise = noise(vWorld.xz * 0.14 + vec2(uTime * 0.25, -uTime * 0.18));
    float edgeFoam = smoothstep(0.62, 0.0, depth);
    float surfFoam = vShore * smoothstep(0.42, 0.95, bandNoise) * 0.9;
    float crestFoam = smoothstep(0.55, 0.95, bandNoise) * smoothstep(1.2, 4.0, depth) * 0.12;
    float foam = clamp(edgeFoam + surfFoam + crestFoam, 0.0, 1.0);
    col = mix(col, uFoam, foam * 0.92);

    float alpha = mix(0.72, 0.97, smoothstep(0.0, 1.6, depth));
    alpha = max(alpha, foam * 0.95);
    if (depth <= 0.005) discard;

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

export class Ocean {
  constructor(terrain, sunDir, skyColor) {
    this.terrain = terrain;
    this.level = TIDE.start;
    this.time = 0;
    this.elapsed = 0;

    const sizeX = 1500;
    const sizeZ = 1150;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, 168, 128);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uLevel: { value: this.level },
        uHeightTex: { value: null },
        uBounds: { value: new THREE.Vector4() },
        uHeightRange: { value: new THREE.Vector2() },
        uDeep: { value: new THREE.Color(COLORS.waterDeep) },
        uShallow: { value: new THREE.Color(COLORS.waterShallow) },
        uFoam: { value: new THREE.Color(COLORS.foam) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6) },
        uSkyColor: { value: new THREE.Color(COLORS.sky) },
      },
    ]);
    this.uniforms.uHeightTex.value = terrain.heightTexture;
    this.uniforms.uBounds.value.set(
      terrain.minX,
      terrain.minZ,
      terrain.maxX - terrain.minX,
      terrain.maxZ - terrain.minZ
    );
    this.uniforms.uHeightRange.value.set(
      terrain.heightRange.min,
      terrain.heightRange.max - terrain.heightRange.min
    );
    if (sunDir) this.uniforms.uSunDir.value.copy(sunDir).normalize();
    if (skyColor) this.uniforms.uSkyColor.value.set(skyColor);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(0, 0, 220);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ocean';
  }

  /** 0..1 how far the tide has come in. */
  get tideProgress() {
    return clamp(this.elapsed / TIDE.duration, 0, 1);
  }

  update(dt, running = true) {
    this.time += dt;
    if (running) this.elapsed += dt;
    const p = this.tideProgress;
    const base = TIDE.start + (TIDE.end - TIDE.start) * Math.pow(p, 1.12);
    const surge =
      Math.sin((this.elapsed / TIDE.surgePeriod) * Math.PI * 2) * TIDE.surgeAmount * (0.35 + 0.65 * p);
    this.level = base + surge;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uLevel.value = this.level;
    this.terrain.setWaterLevel(this.level);
  }

  /** CPU mirror of the vertex-shader wave sum (for buoyancy + splashes). */
  waveHeightAt(x, z) {
    const ground = this.terrain.heightAt(x, z);
    const depth = this.level - ground;
    const shallowFade = smoothstep(0, 4, depth) * 0.85 + 0.15;
    let y = 0;
    for (const w of WAVES) {
      const len = Math.hypot(w.dx, w.dz);
      const dx = w.dx / len;
      const dz = w.dz / len;
      const k = (Math.PI * 2) / w.len;
      y += Math.sin((dx * x + dz * z) * k + this.time * w.speed * k * 0.35) * w.amp;
    }
    const surf = smoothstep(2.6, 0.35, depth) * smoothstep(-0.3, 0.4, depth);
    y += Math.sin(depth * 2.4 - this.time * 2.6) * 0.3 * surf;
    return this.level + y * shallowFade;
  }

  /** Water depth over the ground at a point (<=0 means dry). */
  depthAt(x, z) {
    return this.waveHeightAt(x, z) - this.terrain.heightAt(x, z);
  }

  /** Approximate Z of the waterline on the open beach (for the HUD). */
  shorelineZ() {
    let lo = -300;
    let hi = 300;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.terrain.heightAt(0, mid) > this.level) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
}
