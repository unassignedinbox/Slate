import * as THREE from 'three';

export function buildLighting(scene) {
  scene.fog = new THREE.FogExp2(0x050403, 0.28);

  const hemi = new THREE.HemisphereLight(0x24303a, 0x0a0704, 0.55);
  scene.add(hemi);

  const key = new THREE.SpotLight(0xfff1d8, 5.5, 6.5, Math.PI / 5.5, 0.55, 1.4);
  key.position.set(1.6, 2.3, -1.1);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0018;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);

  const glowColors = [0x63c69a, 0x4a8fd6, 0x8a5fd6];
  const glowLights = [];
  const glowPositions = [
    new THREE.Vector3(-1.6, -0.6, 1.2),
    new THREE.Vector3(1.3, -0.7, -1.5),
    new THREE.Vector3(-1.9, 0.9, -0.6),
  ];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(glowColors[i], 1.1, 3.2, 2.0);
    l.position.copy(glowPositions[i]);
    scene.add(l);
    glowLights.push(l);

    // small emissive "fungus" cluster mesh to sell the light source
    const geo = new THREE.IcosahedronGeometry(0.035, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: glowColors[i], emissive: glowColors[i], emissiveIntensity: 2.2, roughness: 0.5,
    });
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(l.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.12));
      m.scale.setScalar(0.6 + Math.random() * 0.8);
      scene.add(m);
    }
  }

  const rim = new THREE.PointLight(0x2a3a55, 0.6, 5);
  rim.position.set(-2, 1.4, 2);
  scene.add(rim);

  return { hemi, key, glowLights };
}

export function animateLighting(lighting, t) {
  for (let i = 0; i < lighting.glowLights.length; i++) {
    const l = lighting.glowLights[i];
    const flicker = 0.85 + Math.sin(t * (1.7 + i * 0.4) + i * 10) * 0.1 + Math.sin(t * 5.3 + i) * 0.04;
    l.intensity = 1.0 * flicker;
  }
  lighting.key.intensity = 5.3 + Math.sin(t * 0.6) * 0.15;
}
