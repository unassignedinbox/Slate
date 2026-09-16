// src/skyAndAtmosphere.js
// Procedural Atmospheric Sky Dome with Rayleigh and Mie Scattering
// Simulates Day, Golden Hour, Sunset, Storm, and Moonlit Night

import * as THREE from 'three';

export class SkyAndAtmosphere {
  constructor(scene) {
    this.scene = scene;

    this.sunElevation = 35.0; // degrees above horizon
    this.sunAzimuth = 45.0;   // degrees around horizon
    this.turbidity = 2.5;

    this.sunDirection = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.skyColor = new THREE.Color();
    this.ambientColor = new THREE.Color();

    this.initSkyDome();
    this.updateLighting();
  }

  initSkyDome() {
    const skyGeo = new THREE.SphereGeometry(1800, 32, 16);

    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uSkyColor: { value: new THREE.Color() },
        uGroundColor: { value: new THREE.Color(0.02, 0.05, 0.1) },
        uTime: { value: 0.0 },
        uTurbidity: { value: 2.5 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uGroundColor;
        uniform float uTime;
        uniform float uTurbidity;

        varying vec3 vWorldPosition;

        void main() {
          vec3 viewDir = normalize(vWorldPosition);
          vec3 sunDir = normalize(uSunDir);

          float cosTheta = dot(viewDir, sunDir);
          float elevation = viewDir.y;

          // Atmospheric Rayleigh scattering gradient
          vec3 zenith = uSkyColor;
          vec3 horizon = mix(uSkyColor * 1.4, vec3(0.85, 0.9, 0.98), 0.6);

          // Golden hour / sunset horizon blush
          if (sunDir.y < 0.35) {
            float sunsetFactor = smoothstep(0.35, -0.1, sunDir.y);
            horizon = mix(horizon, vec3(1.0, 0.45, 0.18), sunsetFactor * 0.9);
            zenith = mix(zenith, vec3(0.12, 0.22, 0.45), sunsetFactor * 0.7);
          }

          // Elevation blend
          vec3 sky = mix(horizon, zenith, pow(max(0.0, elevation), 0.45));

          // Night sky stars & deep space
          if (sunDir.y < 0.05) {
            float night = smoothstep(0.05, -0.2, sunDir.y);
            sky = mix(sky, vec3(0.005, 0.015, 0.04), night);

            // Procedural stars
            vec3 p = viewDir * 400.0;
            float n = fract(sin(dot(floor(p), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            if (n > 0.995 && elevation > 0.1) {
              sky += vec3(0.9, 0.95, 1.0) * pow((n - 0.995) / 0.005, 2.0) * night * 1.5;
            }
          }

          // Mie forward-scattering (Sun halo & disc)
          float sunDot = max(0.0, cosTheta);
          float sunHalo = pow(sunDot, 16.0) * 0.45 * uTurbidity;
          float sunDisc = pow(sunDot, 1200.0) * 12.0;

          // Blend sky with sun
          vec3 finalSky = sky + (uSunColor * (sunHalo + sunDisc));

          // Below horizon ground fog
          if (elevation < 0.0) {
            finalSky = mix(horizon * 0.4, uGroundColor, pow(-elevation, 0.5));
          }

          gl_FragColor = vec4(finalSky, 1.0);
        }
      `
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    // Directional Sun Light
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.scene.add(this.sunLight);

    // Ambient Light
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x112233, 1.0);
    this.scene.add(this.hemiLight);
  }

  setSunPosition(elevationDeg, azimuthDeg) {
    this.sunElevation = elevationDeg;
    this.sunAzimuth = azimuthDeg;
    this.updateLighting();
  }

  updateLighting() {
    const elRad = (this.sunElevation * Math.PI) / 180.0;
    const azRad = (this.sunAzimuth * Math.PI) / 180.0;

    // Spherical coordinates
    const x = Math.cos(elRad) * Math.sin(azRad);
    const y = Math.sin(elRad);
    const z = Math.cos(elRad) * Math.cos(azRad);

    this.sunDirection.set(x, y, z).normalize();

    // Color grading based on solar elevation
    if (this.sunElevation > 20.0) {
      // High bright daylight
      this.sunColor.setRGB(1.0, 0.97, 0.92);
      this.skyColor.setRGB(0.18, 0.45, 0.82);
      this.ambientColor.setRGB(0.25, 0.35, 0.5);
      this.sunLight.intensity = 2.4;
      this.hemiLight.intensity = 1.0;
    } else if (this.sunElevation > 2.0) {
      // Golden Hour / Warm late afternoon
      const t = (this.sunElevation - 2.0) / 18.0;
      this.sunColor.lerpColors(new THREE.Color(1.0, 0.55, 0.2), new THREE.Color(1.0, 0.97, 0.92), t);
      this.skyColor.lerpColors(new THREE.Color(0.25, 0.38, 0.65), new THREE.Color(0.18, 0.45, 0.82), t);
      this.ambientColor.lerpColors(new THREE.Color(0.4, 0.28, 0.35), new THREE.Color(0.25, 0.35, 0.5), t);
      this.sunLight.intensity = 1.8;
      this.hemiLight.intensity = 0.85;
    } else if (this.sunElevation > -6.0) {
      // Sunset / Dusk
      const t = (this.sunElevation + 6.0) / 8.0;
      this.sunColor.lerpColors(new THREE.Color(0.6, 0.2, 0.1), new THREE.Color(1.0, 0.55, 0.2), t);
      this.skyColor.lerpColors(new THREE.Color(0.08, 0.12, 0.3), new THREE.Color(0.25, 0.38, 0.65), t);
      this.ambientColor.lerpColors(new THREE.Color(0.1, 0.1, 0.2), new THREE.Color(0.4, 0.28, 0.35), t);
      this.sunLight.intensity = 0.9;
      this.hemiLight.intensity = 0.5;
    } else {
      // Night / Moonlit
      this.sunColor.setRGB(0.4, 0.55, 0.85); // Moonlight
      this.skyColor.setRGB(0.005, 0.015, 0.05);
      this.ambientColor.setRGB(0.02, 0.04, 0.08);
      this.sunLight.intensity = 0.35;
      this.hemiLight.intensity = 0.25;
    }

    // Update lights
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(200);
    this.sunLight.color.copy(this.sunColor);
    this.hemiLight.color.copy(this.skyColor);

    // Update sky dome shader uniforms
    if (this.skyMesh) {
      this.skyMesh.material.uniforms.uSunDir.value.copy(this.sunDirection);
      this.skyMesh.material.uniforms.uSunColor.value.copy(this.sunColor);
      this.skyMesh.material.uniforms.uSkyColor.value.copy(this.skyColor);
      this.skyMesh.material.uniforms.uTurbidity.value = this.turbidity;
    }
  }

  update(cameraPos, time) {
    // Keep sky centered on camera
    this.skyMesh.position.copy(cameraPos);
    this.skyMesh.material.uniforms.uTime.value = time;
  }
}
