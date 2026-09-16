// src/oceanMesh.js
// GTA 6 / Unreal Engine 5 Tier PBR Ocean Water Rendering
// NO FFT (uses 32-wave Trochoidal-Stokes Spectrum)
// NO SHADER FOAM (100% pure PBR optical water surface; all foam is physical particles!)

import * as THREE from 'three';
import { WaveModel, NUM_WAVES } from './waveModel.js';
import { OPTICS } from './constants.js';

export class OceanMesh {
  constructor(scene, waveModel, fluidGrid) {
    this.scene = scene;
    this.waveModel = waveModel;
    this.fluidGrid = fluidGrid;

    // Ocean grid dimensions
    this.gridWidth = 360.0;
    this.gridDepth = 360.0;
    this.gridSegments = 220; // 220x220 = 48,400 vertices: high detail, ultra-smooth 60fps on GTX cards

    this.initGeometry();
    this.initMaterial();
    this.initMesh();
  }

  initGeometry() {
    this.geometry = new THREE.PlaneGeometry(
      this.gridWidth,
      this.gridDepth,
      this.gridSegments,
      this.gridSegments
    );
    // Rotate to horizontal XZ plane
    this.geometry.rotateX(-Math.PI * 0.5);
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
      uRoughness: { value: 0.06 },
      uCameraWorldPos: { value: new THREE.Vector3(0, 5, 20) },

      // Dynamic Fluid PDE Texture (boat wakes & splashes)
      uFluidTexture: { value: this.fluidGrid.fluidTexture },
      uFluidCenter: { value: new THREE.Vector2(0, 0) },
      uFluidRadius: { value: this.fluidGrid.worldRadius },
      uFluidScale: { value: this.fluidGrid.heightScale },

      // Underwater floor depth
      uFloorDepth: { value: 14.0 },

      // Grid center for snapping to eliminate vertex crawling
      uGridCenter: { value: new THREE.Vector2(0, 0) }
    };

    const vertexShader = `
      ${glslWaves}

      uniform float uTime;
      uniform vec3 uCameraWorldPos;
      uniform vec2 uGridCenter;

      uniform sampler2D uFluidTexture;
      uniform vec2 uFluidCenter;
      float uFluidRadius_val = 120.0;
      uniform float uFluidScale;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vCrest;
      varying float vWaveHeight;
      varying vec2 vFluidUV;

      void main() {
        // Continuous camera-centric snapping to eliminate vertex swimming
        vec3 pos = position;
        pos.x += uGridCenter.x;
        pos.z += uGridCenter.y;

        // Evaluate analytical 32-octave Trochoidal-Stokes wave spectrum
        WaveResult wave = evaluateWaves(pos.xz, uTime);

        // Sample dynamic fluid simulation texture (boat wakes / splashes)
        vec2 fluidUV = (pos.xz - uFluidCenter) / (uFluidRadius_val * 2.0) + 0.5;
        vFluidUV = fluidUV;

        float fluidDispY = 0.0;
        vec3 fluidNorm = vec3(0.0, 1.0, 0.0);

        if (fluidUV.x >= 0.0 && fluidUV.x <= 1.0 && fluidUV.y >= 0.0 && fluidUV.y <= 1.0) {
          vec4 fSamp = texture2D(uFluidTexture, fluidUV);
          float hRaw = fSamp.r * 255.0 - 128.0;
          if (abs(hRaw) > 1.5) {
            fluidDispY = (hRaw / 60.0) * (uFluidScale * 0.4);
            float fnx = (fSamp.g * 255.0 - 128.0) / 120.0;
            float fnz = (fSamp.b * 255.0 - 128.0) / 120.0;
            fluidNorm = normalize(vec3(-fnx * 0.8, 1.0, -fnz * 0.8));
          }
        }

        // Combine Trochoidal wave displacement and dynamic fluid PDE displacement
        vec3 finalPos = pos + wave.displacement;
        finalPos.y += fluidDispY;

        // Blend analytical wave normal with fluid disturbance normal
        vec3 combinedNormal = normalize(wave.normal + vec3(fluidNorm.x, 0.0, fluidNorm.z));

        vWorldPos = finalPos;
        vNormal = combinedNormal;
        vCrest = wave.crestFactor;
        vWaveHeight = finalPos.y;
        vViewDir = normalize(uCameraWorldPos - finalPos);

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
      varying vec2 vFluidUV;

      // GGX / Trowbridge-Reitz Microfacet Specular Distribution
      float distributionGGX(vec3 N, vec3 H, float roughness) {
        float a = roughness * roughness;
        float a2 = a * a;
        float NdotH = max(dot(N, H), 0.0);
        float NdotH2 = NdotH * NdotH;
        float num = a2;
        float denom = (NdotH2 * (a2 - 1.0) + 1.0);
        denom = 3.14159265359 * denom * denom;
        return num / max(denom, 0.0000001);
      }

      // Smith Geometry Shadowing
      float geometrySchlickGGX(float NdotV, float roughness) {
        float r = (roughness + 1.0);
        float k = (r * r) / 8.0;
        return NdotV / (NdotV * (1.0 - k) + k);
      }

      float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
        float NdotV = max(dot(N, V), 0.0);
        float NdotL = max(dot(N, L), 0.0);
        float ggx2 = geometrySchlickGGX(NdotV, roughness);
        float ggx1 = geometrySchlickGGX(NdotL, roughness);
        return ggx2 * ggx1;
      }

      // Procedural micro-capillary normal disturbance (animated fine ripples)
      vec3 getMicroNormals(vec2 pos, float time) {
        vec2 p1 = pos * 0.75 + vec2(time * 0.35, time * 0.25);
        vec2 p2 = pos * 1.6 - vec2(time * 0.28, time * 0.45);
        vec2 p3 = pos * 3.8 + vec2(time * 0.55, -time * 0.35);

        float s1 = sin(p1.x * 2.1 + p1.y * 1.8) * cos(p1.y * 2.5);
        float s2 = sin(p2.x * 3.3 - p2.y * 2.2) * cos(p2.x * 1.7);
        float s3 = sin(p3.x * 5.4 + p3.y * 4.9);

        float dx = (cos(p1.x * 2.1 + p1.y * 1.8) * 2.1 * cos(p1.y * 2.5) +
                    cos(p2.x * 3.3 - p2.y * 2.2) * 3.3 * cos(p2.x * 1.7) +
                    cos(p3.x * 5.4 + p3.y * 4.9) * 5.4) * 0.02;

        float dz = (cos(p1.x * 2.1 + p1.y * 1.8) * 1.8 * cos(p1.y * 2.5) -
                    sin(p1.x * 2.1 + p1.y * 1.8) * sin(p1.y * 2.5) * 2.5 -
                    cos(p2.x * 3.3 - p2.y * 2.2) * 2.2 * cos(p2.x * 1.7) +
                    cos(p3.x * 5.4 + p3.y * 4.9) * 4.9) * 0.02;

        return normalize(vec3(dx, 1.0, dz));
      }

      // Animated underwater sand caustics
      vec3 getCaustics(vec2 pos, float time) {
        vec2 p = pos * 0.35;
        vec2 p1 = p + vec2(time * 0.25, time * 0.18);
        vec2 p2 = p * 1.4 - vec2(time * 0.22, time * 0.3);

        float c1 = sin(p1.x * 3.1 + sin(p1.y * 2.7)) + cos(p1.y * 3.4 + sin(p1.x * 2.2));
        float c2 = sin(p2.x * 4.2 + cos(p2.y * 3.1)) + cos(p2.y * 4.5 + sin(p2.x * 3.8));
        float caustic = pow(max(0.0, (c1 + c2) * 0.25 + 0.5), 4.5) * 1.8;

        return vec3(caustic * 0.8, caustic * 0.95, caustic * 1.0);
      }

      void main() {
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uSunDir);

        // Perturb analytical wave normal with micro-capillary ripple details
        vec3 microN = getMicroNormals(vWorldPos.xz, uTime);
        vec3 N = normalize(vNormal + vec3(microN.x * 0.3, 0.0, microN.z * 0.3));

        float NdotV = max(dot(N, V), 0.001);
        float NdotL = max(dot(N, L), 0.0);

        // Dielectric Fresnel reflectance (Schlick formula for water, F0 = 0.02037)
        float F0 = 0.02037;
        float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

        // Volumetric optical transmission via Beer-Lambert law
        // Attenuation coefficients: red absorbs fast, blue penetrates deep
        float effectiveDepth = max(1.0, uFloorDepth - vWaveHeight);
        vec3 extCoeffs = vec3(0.24, 0.048, 0.014) * (1.0 / max(0.2, uWaterClarity));
        vec3 transmittance = exp(-extCoeffs * effectiveDepth);

        // Seabed sand floor with caustics visible in clear/shallow water
        vec3 sandColor = vec3(0.72, 0.65, 0.48);
        vec3 caustics = getCaustics(vWorldPos.xz, uTime) * max(0.2, NdotL);
        vec3 seaBed = (sandColor + caustics * 0.4) * max(0.15, NdotL * 0.9 + 0.2);

        // Refracted body color: blend shallow turquoise to deep ocean abyss
        vec3 bodyColor = mix(uDeepColor, uShallowColor, exp(-effectiveDepth * 0.15));
        vec3 refractedLight = mix(bodyColor, seaBed * bodyColor * 2.0, transmittance);

        // Subsurface Scattering (SSS) inside thin wave crests:
        // Sunlight penetrates wave peaks from behind, producing glowing emerald/aquamarine crests
        vec3 sssDir = normalize(V - N * 0.45);
        float sssDot = max(0.0, dot(sssDir, -L));
        float sssCrest = pow(sssDot, 3.5) * smoothstep(0.2, 2.5, vWaveHeight) * uSssIntensity;
        vec3 sssLight = uSssColor * (sssCrest * 1.6) * uSunColor;

        // Cook-Torrance GGX Specular Reflection (Sharp Sun Disc + Anisotropic Glitter)
        vec3 H = normalize(L + V);
        float D = distributionGGX(N, H, uRoughness);
        float G = geometrySmith(N, V, L, uRoughness);
        vec3 specular = (D * G * fresnel / max(4.0 * NdotV * NdotL, 0.001)) * uSunColor * NdotL * 3.5;

        // Micro-glitter sparkle across capillary waves
        float microGlint = pow(max(0.0, dot(microN, H)), 120.0) * 4.0;
        specular += microGlint * uSunColor * fresnel;

        // Procedural sky reflection
        vec3 R = reflect(-V, N);
        float skyHemi = max(0.0, R.y);
        vec3 skyReflection = mix(uSkyColor * 0.8, vec3(0.85, 0.92, 1.0), pow(1.0 - skyHemi, 3.0));
        // Sun glow in sky reflection
        float sunGlow = pow(max(0.0, dot(R, L)), 16.0) * 0.6;
        skyReflection += uSunColor * sunGlow;

        // Composite water surface according to energy-conserving Fresnel:
        // Reflected light + Refracted light + Wave Subsurface Scattering + Sun Specular
        vec3 waterColor = mix(refractedLight + sssLight, skyReflection, fresnel) + specular;

        // Atmospheric aerial horizon haze / fog
        float dist = length(vWorldPos - uCameraWorldPos);
        float fogFactor = 1.0 - exp(-dist * 0.0028);
        vec3 horizonFogColor = mix(uSkyColor, vec3(0.7, 0.8, 0.9), 0.5);
        vec3 finalColor = mix(waterColor, horizonFogColor, fogFactor);

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
    this.mesh.frustumCulled = false; // Always render entire ocean plane
    this.scene.add(this.mesh);
  }

  update(time, cameraPos, sunDir, sunColor, skyColor) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCameraWorldPos.value.copy(cameraPos);

    // Continuous camera snapping (keeps ocean grid centered on camera to avoid edge gaps)
    // Snaps to grid vertex spacing to eliminate sub-vertex crawling
    const snapSize = this.gridWidth / this.gridSegments;
    const snapX = Math.floor(cameraPos.x / snapSize) * snapSize;
    const snapZ = Math.floor(cameraPos.z / snapSize) * snapSize;

    this.mesh.position.set(0, 0, 0);
    this.uniforms.uGridCenter.value.set(snapX, snapZ);

    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSkyColor.value.copy(skyColor);

    // Dynamic fluid center
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
