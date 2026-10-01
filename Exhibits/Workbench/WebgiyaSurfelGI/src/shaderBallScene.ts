import * as THREE from 'three/webgpu';
import { makeNodeStandard } from './materials.ts';

const baseUrl = import.meta.env.BASE_URL;

async function loadShaderBallGeometry(): Promise<THREE.BufferGeometry> {
  const response = await fetch(`${baseUrl}models/ShaderBall.mesh`);
  if (!response.ok) {
    throw new Error(`ShaderBall.mesh: HTTP ${response.status}`);
  }

  const data = await response.arrayBuffer();
  const header = new DataView(data);
  if (data.byteLength < 16 || header.getUint32(0, true) !== 0x314d4253) {
    throw new Error('ShaderBall asset is not SBM1');
  }

  const vertexCount = header.getUint32(4, true);
  const indexCount = header.getUint32(8, true);
  const vertexBytes = vertexCount * 8 * Float32Array.BYTES_PER_ELEMENT;
  const indexOffset = 16 + vertexBytes;
  const expectedBytes =
    indexOffset + indexCount * Uint32Array.BYTES_PER_ELEMENT;
  if (data.byteLength !== expectedBytes) {
    throw new Error('ShaderBall asset byte count is invalid');
  }

  const packed = new Float32Array(data, 16, vertexCount * 8);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; ++index) {
    const source = index * 8;
    const target = index * 3;
    // The Slate asset is Z-up. Rotate it into Three.js' Y-up coordinates
    // without changing handedness or the original indexed topology.
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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addBox(
  scene: THREE.Scene,
  size: [number, number, number],
  position: [number, number, number],
  colour: number,
  roughness = 0.88,
  metalness = 0.0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    makeNodeStandard(colour, roughness, metalness),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

export async function populateShaderBallSurfelScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
): Promise<void> {
  // An open, high-contrast light lab gives Webgiya's unmodified surfel gather
  // nearby coloured surfaces, thin occluders, and deep corners to resolve.
  addBox(scene, [18, 0.2, 14], [0, -0.1, 0], 0x777b73, 0.96);
  addBox(scene, [18, 7, 0.2], [0, 3.5, -7], 0xaeb5ad, 0.93);
  addBox(scene, [0.2, 7, 14], [-9, 3.5, 0], 0x8f2418, 0.9);
  addBox(scene, [0.2, 7, 14], [9, 3.5, 0], 0x155a64, 0.9);

  addBox(scene, [0.35, 3.6, 5.0], [-2.9, 1.8, -3.6], 0xc34c24, 0.82);
  addBox(scene, [0.35, 2.8, 4.5], [3.1, 1.4, -3.0], 0x176c81, 0.8);
  addBox(scene, [4.4, 0.25, 2.4], [0.1, 0.13, 3.4], 0xd1b458, 0.72);
  addBox(scene, [2.1, 1.8, 2.1], [-6.5, 0.9, 3.8], 0x29433a, 0.86);
  addBox(scene, [2.0, 2.7, 2.0], [6.2, 1.35, 3.2], 0x453a62, 0.78);

  const geometry = await loadShaderBallGeometry();
  const balls: Array<{
    position: [number, number, number];
    scale: number;
    colour: number;
    roughness: number;
    metalness: number;
    pedestalHeight: number;
  }> = [
    {
      position: [-5.0, 0.66, -1.7],
      scale: 1.72,
      colour: 0xf04a21,
      roughness: 0.26,
      metalness: 0.04,
      pedestalHeight: 0.62,
    },
    {
      position: [-1.55, 0.94, 1.0],
      scale: 1.58,
      colour: 0xf0b629,
      roughness: 0.18,
      metalness: 0.72,
      pedestalHeight: 0.9,
    },
    {
      position: [2.05, 0.55, -1.15],
      scale: 1.86,
      colour: 0x1596cf,
      roughness: 0.22,
      metalness: 0.18,
      pedestalHeight: 0.51,
    },
    {
      position: [5.25, 0.76, 1.0],
      scale: 1.52,
      colour: 0x36b980,
      roughness: 0.34,
      metalness: 0.02,
      pedestalHeight: 0.72,
    },
  ];

  for (const ball of balls) {
    addBox(
      scene,
      [2.0, ball.pedestalHeight, 2.0],
      [ball.position[0], ball.pedestalHeight * 0.5, ball.position[2]],
      0x30342f,
      0.92,
    );
    const mesh = new THREE.Mesh(
      geometry,
      makeNodeStandard(ball.colour, ball.roughness, ball.metalness),
    );
    mesh.position.set(...ball.position);
    mesh.scale.setScalar(ball.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  dirLight.color.setRGB(1.0, 0.91, 0.78);
  dirLight.castShadow = true;
  // A 1K map keeps the animated direct shadow practical on the 4 GB target.
  dirLight.shadow.mapSize.set(1024, 1024);
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

  // Low-frequency ambient fill matches the role of the environment while the
  // camera-space visibility raster supplies local occlusion.
  const ambient = new THREE.HemisphereLight(0xc7dcff, 0x2a2119, 0.2);
  scene.add(ambient);
}
