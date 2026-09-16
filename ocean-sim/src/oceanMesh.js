// src/oceanMesh.js
// GTA 6 / Unreal Engine 5 Tier PBR Ocean Water Rendering
// NO FFT • NO SHADER FOAM • Continuous Sub-Pixel Camera Tracking • Concentric Radial Horizon Mesh

import * as THREE from 'three';
import { WaveModel, NUM_WAVES } from './waveModel.js';
import { OPTICS } from './constants.js';

export class OceanMesh {
  constructor(scene, waveModel, fluidGrid) {
    this.scene = scene;
    this.waveModel = waveModel;
    this.fluidGrid = fluidGrid;

    this.initGeometry();
    this.initMaterial();
    this.initMesh();
  }

  // Generate continuous concentric radial mesh with high near-field density and an infinite horizon skirt
  initGeometry() {
    const sectors = 160;     // Angular resolution (360 degrees)
    const denseRings = 90;   // Dense near-field rings (0 to 120m)
    const midRings = 40;     // Mid-field rings (120m to 550m)
    const skirtRings = 20;   // Horizon skirt rings (550m to 3200m)
    const totalRings = denseRings + midRings + skirtRings;

    const vertexCount = (totalRings + 1) * (sectors + 1);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const weights = new Float32Array(vertexCount); // Wave displacement weight (tapers to 0 at horizon)

    let vIdx = 0;
    let uvIdx = 0;
    let wIdx = 0;

    for (let r = 0; r <= totalRings; r++) {
      let radius;
      let dispWeight;

      if (r <= denseRings) {
        // Linear spacing in near field: 0.5m to 120m
        const t = r / denseRings;
        radius = 0.5 + t * 120.0;
        dispWeight = 1.0;
      } else if (r <= denseRings + midRings) {
        // Quadratic expansion: 120m to 550m
        const t = (r - denseRings) / midRings;
        radius = 120.0 + (t * t) * 430.0;
        dispWeight = 1.0 - t * 0.2;
      } else {
        // Cubic horizon skirt: 550m to 3200m
        const t = (r - (denseRings + midRings)) / skirtRings;
        radius = 550.0 + Math.pow(t, 2.5) * 2650.0;
        dispWeight = Math.max(0.0, 0.8 * (1.0 - t));
      }

      for (let s = 0; s <= sectors; s++) {
        const theta = (s / sectors) * Math.PI * 2.0;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;

        positions[vIdx + 0] = x;
        positions[vIdx + 1] = 0.0;
        positions[vIdx + 2] = z;

        uvs[uvIdx + 0] = x * 0.01;
        uvs[uvIdx + 1] = z * 0.01;

        weights[wIdx] = dispWeight;

        vIdx += 3;
        uvIdx += 2;
        wIdx++;
      }
    }

    // Build triangle indices
    const indices = [];
    const stride = sectors + 1;

    for (let r = 0; r < totalRings; r++) {
      for (let s = 0; s < sectors; s++) {
        const i0 = r * stride + s;
        const i1 = i0 + 1;
        const i2 = (r + 1) * stride + s;
        const i3 = i2 + 1;

        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aDispWeight', new THREE.BufferAttribute(weights, 1));
    this.geometry.setIndex(indices);
  }

  initMaterial() {
    const glslWaves = WaveModel.getGLSLWaveFunction();

    this.uniforms = {
      uTime: { value: 0.0 },
      uWaveData0: { value: this.waveModel.waveData0 },
      uWaveData1: { value: this.waveModel.waveData1 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.5).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
      uSkyColor: { value: new THREE.Color(0.2, 0.48, 0.8) },
      uDeepColor: { value: new THREE.Color(OPTICS.DEEP_WATER_COLOR.r, OPTICS.DEEP_WATER_COLOR.g, OPTICS.DEEP_WATER_COLOR.b) },
      uShallowColor: { value: new THREE.Color(OPTICS.SHALLOW_WATER_COLOR.r, OPTICS.SHALLOW_WATER_COLOR.g, OPTICS.SHALLOW_WATER_COLOR.b) },
      uSssColor: { value: new THREE.Color(OPTICS.SSS_TINT.r, OPTICS.SSS_TINT.g, OPTICS.SSS_TINT.b) },
      uSssIntensity: { value: 1.0 },
      uWaterClarity: { value: 1.0 },
      uRoughness: { value: 0.05 },
      uCameraWorldPos: { value: new THREE.Vector3(0, 5, 20) },

      // Dynamic Fluid PDE Texture
      uFluidTexture: { value: this.fluidGrid.fluidTexture },
      uFluidCenter: { value: new THREE.Vector2(0, 0) },
      uFluidRadius: { value: this.fluidGrid.worldRadius },
      uFluidScale: { value: this.fluidGrid.heightScale },

      uFloorDepth: { value: 16.0 }
    };

    const vertexShader = `
      ${glslWaves}

      attribute float aDispWeight;

      uniform float uTime;
      uniform vec3 uCameraWorldPos;

      uniform sampler2D uFluidTexture;
      uniform vec2 uFluidCenter;
      float uFluidRadius_val = 120.0;
      uniform float uFluidScale;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vCrest;
      varying float vWaveHeight;
      varying float vDistance;

      void main() {
        // Continuous camera following in world space (ZERO snapping jitter!)
        vec3 worldBase = position + vec3(uCameraWorldPos.x, 0.0, uCameraWorldPos.z);

        // Evaluate analytical 32-octave Trochoidal-Stokes wave spectrum
        WaveResult wave = evaluateWaves(worldBase.xz, uTime);

        // Sample dynamic fluid PDE simulation (boat wakes and interactive splashes)
        vec2 fluidUV = (worldBase.xz - uFluidCenter) / (uFluidRadius_val * 2.0) + 0.5;
        float fluidDispY = 0.0;
        vec3 fluidNorm = vec3(0.0, 1.0, 0.0);

        if (fluidUV.x >= 0.0 && fluidUV.x <= 1.0 && fluidUV.y >= 0.0 && fluidUV.y <= 1.0) {
          vec4 fSamp = texture2D(uFluidTexture, fluidUV);
          float hRaw = fSamp.r * 255.0 - 128.0;
          if (abs(hRaw) > 1.2) {
            fluidDispY = (hRaw / 60.0) * (uFluidScale * 0.45);
            float fnx = (fSamp.g * 255.0 - 128.0) / 120.0;
            float fnz = (fSamp.b * 255.0 - 128.0) / 120.0;
            fluidNorm = normalize(vec3(-fnx * 0.85, 1.0, -fnz * 0.85));
          }
        }

        // Apply displacement weighted by radial skirt factor
        vec3 finalPos = worldBase + (wave.displacement * aDispWeight);
        finalPos.y += fluidDispY * aDispWeight;

        vec3 combinedNormal = normalize(wave.normal + vec3(fluidNorm.x, 0.0, fluidNorm.z));

        vWorldPos = finalPos;
        vNormal = combinedNormal;
        vCrest = wave.crestFactor * aDispWeight;
        vWaveHeight = finalPos.y;
        vViewDir = normalize(uCameraWorldPos - finalPos);
        vDistance = length(uCameraWorldPos - finalPos);

        gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uSssColor;
      uniform float uSssIntensity;
      uniform float uWaterClarity;
      uniform float uRoughness;
      uniform float uFloorDepth;
      uniform vec3 uCameraWorldPos;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vCrest;
      varying float vWaveHeight;
      varying float vDistance;

      // GGX Normal Distribution
      float distributionGGX(vec3 N, vec3 H, float roughness) {
        float a = roughness * roughness;
        float a2 = a * a;
        float NdotH = max(dot(N, H), 0.0);
        float NdotH2 = NdotH * NdotH;
        float denom = (NdotH2 * (a2 - 1.0) + 1.0);
        return a2 / max(3.14159265359 * denom * denom, 0.000001);
      }

      // Smith Geometric Shadowing
      float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
        float r = (roughness + 1.0);
        float k = (r * r) / 8.0;
        float NdotV = max(dot(N, V), 0.001);
        float NdotL = max(dot(N, L), 0.001);
        float ggxV = NdotV / (NdotV * (1.0 - k) + k);
        float ggxL = NdotL / (NdotL * (1.0 - k) + k);
        return ggxV * ggxL;
      }

      // Procedural micro-capillary normal disturbance
      vec3 getMicroNormals(vec2 pos, float time) {
        vec2 p1 = pos * 0.85 + vec2(time * 0.38, time * 0.22);
        vec2 p2 = pos * 1.85 - vec2(time * 0.25, time * 0.42);
        vec2 p3 = pos * 4.2 + vec2(time * 0.52, -time * 0.38);

        float s1 = sin(p1.x * 2.2 + p1.y * 1.9) * cos(p1.y * 2.4);
        float s2 = sin(p2.x * 3.4 - p2.y * 2.1) * cos(p2.x * 1.8);
        float s3 = sin(p3.x * 5.5 + p3.y * 5.0);

        float dx = (cos(p1.x * 2.2 + p1.y * 1.9) * 2.2 * cos(p1.y * 2.4) +
                    cos(p2.x * 3.4 - p2.y * 2.1) * 3.4 * cos(p2.x * 1.8) +
                    cos(p3.x * 5.5 + p3.y * 5.0) * 5.5) * 0.016;

        float dz = (cos(p1.x * 2.2 + p1.y * 1.9) * 1.9 * cos(p1.y * 2.4) -
                    sin(p1.x * 2.2 + p1.y * 1.9) * sin(p1.y * 2.4) * 2.4 -
                    cos(p2.x * 3.4 - p2.y * 2.1) * 2.1 * cos(p2.x * 1.8) +
                    cos(p3.x * 5.5 + p3.y * 5.0) * 5.0) * 0.016;

        return normalize(vec3(dx, 1.0, dz));
      }

      // Animated underwater sand caustics
      vec3 getCaustics(vec2 pos, float time) {
        vec2 p = pos * 0.32;
        vec2 p1 = p + vec2(time * 0.24, time * 0.16);
        vec2 p2 = p * 1.35 - vec2(time * 0.2, time * 0.28);

        float c1 = sin(p1.x * 3.0 + sin(p1.y * 2.6)) + cos(p1.y * 3.3 + sin(p1.x * 2.1));
        float c2 = sin(p2.x * 4.1 + cos(p2.y * 3.0)) + cos(p2.y * 4.4 + sin(p2.x * 3.7));
        float caustic = pow(max(0.0, (c1 + c2) * 0.25 + 0.5), 4.5) * 1.7;

        return vec3(caustic * 0.82, caustic * 0.95, caustic * 1.0);
      }

      void main() {
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uSunDir);

        // Perturb analytical wave normal with high-frequency micro-capillaries
        vec3 microN = getMicroNormals(vWorldPos.xz, uTime);
        vec3 N = normalize(vNormal + vec3(microN.x * 0.26, 0.0, microN.z * 0.26));

        float NdotV = max(0.001, dot(N, V));
        float NdotL = max(0.0, dot(N, L));

        // Dielectric Fresnel reflectance (Water IOR 1.333, F0 = 0.02037)
        float F0 = 0.02037;
        float fresnel = F0 + (1.0 - F0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);

        // Volumetric optical transmission via Beer-Lambert law
        float effectiveDepth = max(1.0, uFloorDepth - vWaveHeight);
        vec3 extCoeffs = vec3(0.25, 0.052, 0.014) * (1.0 / max(0.2, uWaterClarity));
        vec3 transmittance = exp(-extCoeffs * effectiveDepth);

        // Seabed sand floor with caustics visible in clear/shallow water
        vec3 sandColor = vec3(0.72, 0.65, 0.48);
        vec3 caustics = getCaustics(vWorldPos.xz, uTime) * max(0.2, NdotL);
        vec3 seaBed = (sandColor + caustics * 0.4) * max(0.18, NdotL * 0.85 + 0.22);

        // Refracted body color: blend shallow turquoise to deep ocean abyss
        vec3 bodyColor = mix(uDeepColor, uShallowColor, exp(-effectiveDepth * 0.16));
        vec3 refractedLight = mix(bodyColor, seaBed * bodyColor * 2.2, transmittance);

        // Translucent Wave Crest Subsurface Scattering (SSS):
        // Backlit wave peaks transmit intense emerald/aquamarine radiance
        vec3 sssDir = normalize(V - N * 0.38);
        float sssDot = max(0.0, dot(sssDir, -L));
        float sssCrest = pow(sssDot, 4.0) * smoothstep(0.15, 2.4, vWaveHeight) * uSssIntensity;
        vec3 sssLight = uSssColor * (sssCrest * 1.9) * uSunColor;

        // Cook-Torrance GGX Specular Reflection with guarded denominator
        vec3 H = normalize(L + V);
        float D = distributionGGX(N, H, uRoughness);
        float G = geometrySmith(N, V, L, uRoughness);
        float denom = max(0.05, 4.0 * NdotV * max(0.05, NdotL));
        vec3 specular = (D * G * fresnel / denom) * uSunColor * NdotL * 3.2;

        // Micro-glitter sparkle across capillary ripples
        float microGlint = pow(max(0.0, dot(microN, H)), 140.0) * 3.8;
        specular += microGlint * uSunColor * fresnel;

        // Realistic procedural sky reflection
        vec3 R = reflect(-V, N);
        float skyHemi = max(0.0, R.y);
        vec3 skyReflection = mix(uSkyColor * 0.75, vec3(0.85, 0.92, 1.0), pow(1.0 - skyHemi, 3.0));
        float sunGlow = pow(max(0.0, dot(R, L)), 18.0) * 0.65;
        skyReflection += uSunColor * sunGlow;

        // Composite PBR Water: Refraction + SSS + Reflection + Specular
        vec3 waterColor = mix(refractedLight + sssLight, skyReflection, fresnel) + specular;

        // Atmospheric aerial perspective & horizon fog:
        // Seamlessly blends ocean into the sky dome at the horizon
        float fogFactor = 1.0 - exp(-pow(vDistance * 0.00065, 1.25));
        vec3 horizonFogColor = mix(uSkyColor * 1.2, vec3(0.72, 0.82, 0.94), 0.55);

        // Sunset/golden hour blush in horizon fog
        if (L.y < 0.35) {
          float sunsetFog = smoothstep(0.35, -0.05, L.y);
          horizonFogColor = mix(horizonFogColor, vec3(0.98, 0.52, 0.25), sunsetFog * 0.85);
        }

        vec3 finalColor = mix(waterColor, horizonFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      side: THREE.DoubleSide,
      wireframe: false
    });
  }

  initMesh() {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(time, cameraPos, sunDir, sunColor, skyColor) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCameraWorldPos.value.copy(cameraPos);

    // Continuous camera positioning: mesh origin stays centered on camera smoothly
    this.mesh.position.set(cameraPos.x, 0, cameraPos.z);

    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSkyColor.value.copy(skyColor);

    this.uniforms.uFluidCenter.value.copy(this.fluidGrid.worldCenter);
  }

  setClarity(clarity) {
    this.uniforms.uWaterClarity.value = clarity;
  }

  setSssIntensity(intensity) {
    this.uniforms.uSssIntensity.value = intensity;
  }

  setWaterColors(deepHex, shallowHex, sssHex) {
    this.uniforms.uDeepColor.value.set(deepHex);
    this.uniforms.uShallowColor.value.set(shallowHex);
    this.uniforms.uSssColor.value.set(sssHex);
  }

  setWireframe(enabled) {
    this.material.wireframe = enabled;
  }
}
