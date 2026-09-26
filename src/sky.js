import * as THREE from 'three';
import { COLORS } from './config.js';

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const skyFrag = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;

  void main() {
    float h = vDir.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
    col = mix(uBottom, col, smoothstep(-0.28, 0.02, h));

    // Low sun glow burning through the overcast.
    float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 6.0) * 0.55;
    col += uSunColor * pow(sd, 90.0) * 1.4;

    // Faint banded cloud deck.
    float band = sin(vDir.y * 16.0 + vDir.x * 2.0) * 0.5 + 0.5;
    col = mix(col, col * 1.06, band * smoothstep(0.05, 0.5, h) * 0.5);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(scene, renderer) {
  const sunDir = new THREE.Vector3(-0.34, 0.38, 0.78).normalize();

  const topColor = new THREE.Color(0x6f8aa5);
  const horizonColor = new THREE.Color(0xc3cdd2);
  const bottomColor = new THREE.Color(0x8d959a);
  const sunColor = new THREE.Color(0xffd9a0);

  const geo = new THREE.SphereGeometry(4000, 32, 20);
  const material = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: {
      uTop: { value: topColor },
      uHorizon: { value: horizonColor },
      uBottom: { value: bottomColor },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: sunColor },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(geo, material);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  scene.fog = new THREE.Fog(new THREE.Color(COLORS.fog).getHex(), 260, 1150);
  scene.background = new THREE.Color(0xb5c2cb);

  /* ---- lighting ---- */
  const sun = new THREE.DirectionalLight(0xfff0d2, 1.95);
  sun.position.copy(sunDir).multiplyScalar(260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 620;
  const s = 135;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd2e0, 0x6a6350, 0.78);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0x9fb6c9, 0.3);
  fill.position.set(80, 120, -180);
  scene.add(fill);

  /* ---- cheap environment map so metals are not black ---- */
  const size = 32;
  const data = new Uint8Array(size * size * 2 * 4);
  const tmp = new THREE.Color();
  for (let y = 0; y < size; y++) {
    const v = 1 - y / (size - 1);
    const elev = v * 2 - 1;
    tmp.copy(bottomColor).lerp(horizonColor, THREE.MathUtils.smoothstep(elev, -0.3, 0.02));
    tmp.lerp(topColor, THREE.MathUtils.smoothstep(elev, 0.0, 0.6));
    for (let x = 0; x < size * 2; x++) {
      const i = (y * size * 2 + x) * 4;
      data[i] = Math.round(tmp.r * 255);
      data[i + 1] = Math.round(tmp.g * 255);
      data[i + 2] = Math.round(tmp.b * 255);
      data[i + 3] = 255;
    }
  }
  const envSrc = new THREE.DataTexture(data, size * 2, size, THREE.RGBAFormat);
  envSrc.mapping = THREE.EquirectangularReflectionMapping;
  envSrc.colorSpace = THREE.SRGBColorSpace;
  envSrc.needsUpdate = true;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromEquirectangular(envSrc);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  } catch (e) {
    // Environment maps are a nicety, never fatal.
    console.warn('env map unavailable', e);
  }
  envSrc.dispose();

  /** Keep the shadow frustum tight around the player. */
  function followTarget(pos) {
    sun.target.position.set(pos.x, 0, pos.z);
    sun.position.set(pos.x + sunDir.x * 240, sunDir.y * 240, pos.z + sunDir.z * 240);
    sun.target.updateMatrixWorld();
  }

  return { dome, sun, hemi, sunDir, followTarget, sunColor };
}
