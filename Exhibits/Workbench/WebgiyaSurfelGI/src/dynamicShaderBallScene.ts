import * as THREE from 'three/webgpu';
import type { DynamicRigidProxy } from './dynamicRigidState.ts';
import { makeNodeStandard } from './materials.ts';

const baseUrl = import.meta.env.BASE_URL;

async function loadShaderBallGeometry(): Promise<THREE.BufferGeometry> {
  const response = await fetch(`${baseUrl}models/ShaderBall.mesh`);
  if (!response.ok) throw new Error(`ShaderBall.mesh: HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  const header = new DataView(data);
  if (data.byteLength < 16 || header.getUint32(0, true) !== 0x314d4253) {
    throw new Error('ShaderBall asset is not SBM1');
  }
  const vertexCount = header.getUint32(4, true);
  const indexCount = header.getUint32(8, true);
  const indexOffset = 16 + vertexCount * 8 * Float32Array.BYTES_PER_ELEMENT;
  if (
    data.byteLength !==
    indexOffset + indexCount * Uint32Array.BYTES_PER_ELEMENT
  ) {
    throw new Error('ShaderBall asset byte count is invalid');
  }
  const packed = new Float32Array(data, 16, vertexCount * 8);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; ++index) {
    const source = index * 8;
    const target = index * 3;
    positions[target] = packed[source];
    positions[target + 1] = packed[source + 2];
    positions[target + 2] = -packed[source + 1];
    normals[target] = packed[source + 3];
    normals[target + 1] = packed[source + 5];
    normals[target + 2] = -packed[source + 4];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(data.slice(indexOffset)), 1),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

function addBox(
  scene: THREE.Scene,
  size: [number, number, number],
  position: [number, number, number],
  colour: number,
  roughness = 0.9,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    makeNodeStandard(colour, roughness, 0),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addStaticLightLab(scene: THREE.Scene): void {
  addBox(scene, [18, 0.2, 14], [0, -0.1, 0], 0x777b73, 0.96);
  addBox(scene, [18, 7, 0.2], [0, 3.5, -7], 0xaeb5ad, 0.93);
  addBox(scene, [0.2, 7, 14], [-9, 3.5, 0], 0x8f2418, 0.9);
  addBox(scene, [0.2, 7, 14], [9, 3.5, 0], 0x155a64, 0.9);
  addBox(scene, [0.35, 3.4, 4.3], [-3.0, 1.7, -4.1], 0xc34c24, 0.82);
  addBox(scene, [0.35, 2.6, 3.8], [3.2, 1.3, -4.3], 0x176c81, 0.8);
  addBox(scene, [3.2, 0.25, 2.0], [0, 0.13, 3.8], 0xd1b458, 0.72);
}

function configureShadow(dirLight: THREE.DirectionalLight): void {
  dirLight.color.setRGB(1.0, 0.91, 0.78);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(4096, 4096);
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 80;
  dirLight.shadow.camera.left = -12;
  dirLight.shadow.camera.right = 12;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  dirLight.shadow.bias = -0.00008;
  dirLight.shadow.normalBias = 0.018;
  dirLight.shadow.radius = 2;
  dirLight.shadow.camera.updateProjectionMatrix();
}

export async function populateDynamicShaderBallScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
): Promise<void> {
  addStaticLightLab(scene);
  const geometry = await loadShaderBallGeometry();
  const sphere = geometry.boundingSphere;
  if (!sphere) throw new Error('ShaderBall has no bounding sphere');

  const colours = [
    0xf04a21, 0xf0b629, 0x1596cf, 0x36b980, 0xc747dd, 0x42d5d2, 0xff7a22,
    0x7090ff,
  ];
  const proxies: DynamicRigidProxy[] = [];
  const motion: Array<{
    mesh: THREE.Mesh;
    anchor: THREE.Vector3;
    phase: number;
    orbitX: number;
    orbitZ: number;
    bob: number;
    speed: number;
  }> = [];

  for (let index = 0; index < colours.length; ++index) {
    const row = index < 4 ? 0 : 1;
    const column = index % 4;
    const anchor = new THREE.Vector3(
      -5.4 + column * 3.6,
      0.8 + row * 2.1,
      row === 0 ? 0.9 : -2.6,
    );
    const scale = 1.05 + (index % 3) * 0.11;
    const material = makeNodeStandard(
      colours[index],
      0.2 + (index % 4) * 0.08,
      index === 1 ? 0.55 : 0.05,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.dynamicRigid = true;
    scene.add(mesh);

    const phase = index * 0.83;
    motion.push({
      mesh,
      anchor,
      phase,
      orbitX: 0.55 + (index % 2) * 0.2,
      orbitZ: 0.45 + ((index + 1) % 3) * 0.16,
      bob: 0.28 + (index % 3) * 0.08,
      speed: 0.38 + index * 0.035,
    });
    proxies.push({
      mesh,
      localCenter: sphere.center.clone(),
      localRadius: sphere.radius,
      albedo: new THREE.Color(colours[index]),
    });
  }

  const updateDynamicRigids = (seconds: number) => {
    for (const item of motion) {
      const t = seconds * item.speed + item.phase;
      item.mesh.position.set(
        item.anchor.x + Math.sin(t) * item.orbitX,
        item.anchor.y + Math.sin(t * 1.73) * item.bob,
        item.anchor.z + Math.cos(t * 1.19) * item.orbitZ,
      );
      item.mesh.rotation.y = t * 0.7;
      item.mesh.rotation.x = Math.sin(t * 0.61) * 0.12;
      item.mesh.updateMatrixWorld(true);
    }
  };

  updateDynamicRigids(0);
  scene.userData.dynamicRigidProxies = proxies;
  scene.userData.updateDynamicRigids = updateDynamicRigids;
  scene.userData.dynamicRigidMode = true;
  configureShadow(dirLight);
}
