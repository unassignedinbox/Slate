import * as THREE from 'three/webgpu';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { makeNodeStandard } from './materials.ts';
import {
  CSMHelper,
  DRACOLoader,
  GLTFLoader,
} from 'three/examples/jsm/Addons.js';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import type { LightSettings } from './lighting.ts';
import type { OcclusionSettings } from './surfelRadialDepth.ts';
import { populateShaderBallSurfelScene } from './shaderBallScene.ts';

export type SceneContent = {
  ground: THREE.Mesh;
  cube: THREE.Mesh;
  sphere: THREE.Mesh;
};

const baseUrl = import.meta.env.BASE_URL;

export function populateWithSponza(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  onLoaded?: () => void,
) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${baseUrl}draco/`);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load(`${baseUrl}models/Sponza-Draco.glb`, (gltf) => {
    const o = gltf.scene;
    o.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    scene.add(gltf.scene);

    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.bias = -0.0003;
    const csm = new CSMShadowNode(dirLight, {
      cascades: 4,
      maxFar: 50,
      mode: 'practical',
      lightMargin: 30,
    });
    dirLight.shadow.shadowNode = csm;

    // const csmHelper = new CSMHelper( csm );
    // csmHelper.visible = false;
    // scene.add( csmHelper );

    onLoaded?.();
  });
}

export function populateScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  onLoad?: (mesh: THREE.Mesh) => void,
): SceneContent {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    makeNodeStandard(0x808080, 0.95, 0.0),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  function addWall(
    w: number,
    h: number,
    pos: THREE.Vector3,
    rotY: number,
    hex: number,
  ) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      makeNodeStandard(hex, 0.9, 0.0),
    );
    wall.position.copy(pos);
    wall.rotation.y = rotY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  addWall(12, 4, new THREE.Vector3(0, 2, -6), 0, 0xb0b0b0);
  addWall(12, 4, new THREE.Vector3(0, 2, 6), Math.PI, 0xa0a0a0);
  addWall(12, 4, new THREE.Vector3(-6, 2, 0), Math.PI / 2, 0x9a9a9a);
  addWall(12, 4, new THREE.Vector3(6, 2, 0), -Math.PI / 2, 0x8a8a8a);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    makeNodeStandard(0xffff00, 0.4, 0.0),
  );
  cube.position.set(-1.8, 0.6, 0);
  cube.receiveShadow = true;
  cube.castShadow = true;
  scene.add(cube);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 48, 32),
    makeNodeStandard(0x3366ff, 0.3, 0.0),
  );
  sphere.position.set(-0.6, 0.7, 1.4);
  sphere.receiveShadow = true;
  sphere.castShadow = true;
  scene.add(sphere);

  // Bunny load
  const loader = new PLYLoader();
  loader.load(`${baseUrl}models/bunny.ply`, (geo) => {
    geo.computeVertexNormals();
    geo.center();
    geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    if (bs) {
      const targetRadius = 0.8;
      const s = targetRadius / (bs.radius || 1);
      geo.scale(s, s, s);
    }
    const bunny = new THREE.Mesh(geo, makeNodeStandard(0xeeeecc, 0.5, 0.0));
    bunny.position.set(0, 0.55, 0);
    bunny.castShadow = true;
    bunny.receiveShadow = true;
    scene.add(bunny);
    onLoad?.(bunny);
  });

  const shadowCam = dirLight.shadow.camera;
  shadowCam.left = shadowCam.bottom = -3;
  shadowCam.right = shadowCam.top = 3;
  dirLight.shadow.bias = -0.00002;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;

  const content: SceneContent = { ground, cube, sphere };
  return content;
}

export function populateMinimalScene(scene: THREE.Scene) {
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 2, 4),
    makeNodeStandard(0xff3333, 0.6, 0.0),
  );
  cube.position.set(0, 1, 0);
  cube.castShadow = true;
  // cube.rotateZ(Math.PI/4)
  scene.add(cube);

  const cube2 = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    makeNodeStandard(0x3300ff, 0.6, 0.0),
  );
  cube2.position.set(3, 0.5, 1);
  cube2.castShadow = true;
  // cube.rotateZ(M)
  scene.add(cube2);

  const cube3 = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    makeNodeStandard(0xffff00, 0.6, 0.0),
  );
  cube3.position.set(-3, 0.5, 1);
  // cube.rotateZ(M)
  cube3.castShadow = true;
  scene.add(cube3);

  // Plane
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardNodeMaterial({
      color: 0xefefef,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  plane.receiveShadow = true;
  scene.add(plane);
}

export function populateMarbleBustScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  onLoaded?: () => void,
) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${baseUrl}draco/`);

  const group = new THREE.Group();

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load(`${baseUrl}models/marble_bust/marble_bust_01_4k.gltf`, (gltf) => {
    const o = gltf.scene;
    o.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    group.add(gltf.scene);
    onLoaded?.();
  });

  const BOX_WIDTH = 1;
  const BOX_DEPTH = 1;
  const WALL_THICKNESS = 0.02;

  const redWallMaterial = new THREE.MeshPhysicalMaterial({
    color: '#ff0000',
    side: THREE.DoubleSide,
  });
  const blueWallMaterial = new THREE.MeshPhysicalMaterial({
    color: '#0000ff',
    side: THREE.DoubleSide,
  });
  const whiteMaterial = new THREE.MeshPhysicalMaterial({
    color: '#aaa',
    side: THREE.DoubleSide,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      BOX_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      BOX_DEPTH + WALL_THICKNESS,
    ),
    whiteMaterial,
  );
  floor.position.set(0, -WALL_THICKNESS * 0.5, 0);
  floor.receiveShadow = true;
  floor.castShadow = true;
  group.add(floor);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(
      BOX_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      BOX_DEPTH / 1.5,
    ),
    whiteMaterial,
  );
  back.position.set(0, 0.33, -0.5);
  back.rotateX(Math.PI / 2);
  back.receiveShadow = true;
  back.castShadow = true;
  group.position.setY(-0.9);
  group.add(back);

  // Left reflector
  const leftReflector = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, WALL_THICKNESS, 0.3),
    redWallMaterial,
  );

  leftReflector.position.set(-0.2, 0.4, 0);
  leftReflector.rotateX(Math.PI / 2);
  leftReflector.rotateZ(-Math.PI / 4);
  leftReflector.receiveShadow = true;
  leftReflector.castShadow = true;
  group.add(leftReflector);

  // Left reflector
  const rightReflector = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, WALL_THICKNESS, 0.3),
    blueWallMaterial,
  );

  rightReflector.position.set(+0.2, 0.4, 0);
  rightReflector.rotateX(Math.PI / 2);
  rightReflector.rotateZ(+Math.PI / 4);
  rightReflector.receiveShadow = true;
  rightReflector.castShadow = true;
  group.add(rightReflector);

  group.scale.set(3, 3, 3);
  scene.add(group);
  const shadowCam = dirLight.shadow.camera;
  shadowCam.left = shadowCam.bottom = -3;
  shadowCam.right = shadowCam.top = 3;
  dirLight.shadow.bias = -0.00002;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
}

export function populateCornellScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
) {
  buildCornellScene(scene, dirLight, {
    red: new THREE.MeshPhysicalMaterial({ color: '#ff0000' }),
    green: new THREE.MeshPhysicalMaterial({ color: '#00ff00' }),
    white: new THREE.MeshPhysicalMaterial({ color: '#fff' }),
  });
}

// Scene to test if textures are being read with correct luminance.
export function populateCornellSceneTextured(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
) {
  const makeSolidTexture = (hex: number) => {
    const color = new THREE.Color(hex);
    const data = new Uint8Array([
      Math.round(color.r * 255),
      Math.round(color.g * 255),
      Math.round(color.b * 255),
      255,
    ]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  };

  const redMap = makeSolidTexture(0xff0000);
  const greenMap = makeSolidTexture(0x00ff00);
  const whiteMap = makeSolidTexture(0xffffff);

  buildCornellScene(scene, dirLight, {
    red: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: redMap }),
    green: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: greenMap }),
    white: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: whiteMap }),
  });
}

type CornellMaterials = {
  red: THREE.Material;
  green: THREE.Material;
  white: THREE.Material;
};

function buildCornellScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  materials: CornellMaterials,
) {
  const BOX_WIDTH = 2;
  const BOX_DEPTH = 2;
  const BOX_HEIGHT = 1.5;
  const WALL_THICKNESS = 0.02;

  const group = new THREE.Group();

  const redWallMaterial = materials.red;
  const greenWallMaterial = materials.green;
  const whiteMaterial = materials.white;

  // Floor (0.1 thick, inner face at y = 0)
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      BOX_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      BOX_DEPTH + WALL_THICKNESS,
    ),
    whiteMaterial,
  );
  floor.position.set(0, -WALL_THICKNESS * 0.5, -WALL_THICKNESS * 0.5);
  floor.receiveShadow = true;
  floor.castShadow = true;
  group.add(floor);

  // Left wall (red) and right wall (green)
  const wallHeight = BOX_HEIGHT;
  const wallDepth = BOX_DEPTH;
  const wallOffsetX = BOX_WIDTH * 0.5 + WALL_THICKNESS * 0.5;

  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, wallHeight, wallDepth),
    redWallMaterial,
  );
  leftWall.position.set(-wallOffsetX, wallHeight * 0.5, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_THICKNESS, wallHeight, wallDepth),
    greenWallMaterial,
  );
  rightWall.position.set(wallOffsetX, wallHeight * 0.5, 0);
  rightWall.castShadow = true;
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // Back wall
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(2 + 2 * WALL_THICKNESS, 1.5, WALL_THICKNESS),
    whiteMaterial,
  );
  backWall.position.set(0, 0.75, -BOX_DEPTH * 0.5 - WALL_THICKNESS * 0.5);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  group.add(backWall);

  // Ceiling split into two panels with a center gap for light
  const ceilingPanelWidth = 0.75 + WALL_THICKNESS;
  const ceilingPanelDepth = BOX_DEPTH + WALL_THICKNESS;
  const ceilingY = BOX_HEIGHT + WALL_THICKNESS * 0.5;
  const ceilingXOffset =
    BOX_WIDTH * 0.5 - ceilingPanelWidth * 0.5 + WALL_THICKNESS; // centers at ±0.625 to match old layout

  function addCeilingPanel(x: number) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(
        ceilingPanelWidth,
        WALL_THICKNESS,
        ceilingPanelDepth,
      ),
      whiteMaterial,
    );
    panel.position.set(x, ceilingY, -0.5 * WALL_THICKNESS);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
  }

  addCeilingPanel(-ceilingXOffset);
  addCeilingPanel(ceilingXOffset);

  // Boxes
  const tallBoxGeometry = new THREE.BoxGeometry(0.5, 0.7, 0.5);
  const tallBox = new THREE.Mesh(tallBoxGeometry, whiteMaterial);
  tallBox.rotation.y = Math.PI * 0.25;
  tallBox.position.set(-0.3, 0.35, -0.2);
  tallBox.castShadow = true;
  tallBox.receiveShadow = true;
  group.add(tallBox);

  const shortBoxGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const shortBox = new THREE.Mesh(shortBoxGeometry, whiteMaterial);
  shortBox.rotation.y = Math.PI * -0.1;
  shortBox.position.set(0.4, 0.2, 0.4);
  shortBox.castShadow = true;
  shortBox.receiveShadow = true;
  group.add(shortBox);

  // const axesHelper = new THREE.AxesHelper(3)
  // scene.add(axesHelper)

  group.position.setY(-0.5);
  group.scale.set(4, 4, 4);
  scene.add(group);

  // Adjust the shadow map
  const shadowCam = dirLight.shadow.camera;
  // shadowCam.left = shadowCam.bottom = -1;
  // shadowCam.right = shadowCam.top = 1;
  // shadowCam.far = 10;
  // shadowCam.near = 0.05;

  shadowCam.left = shadowCam.bottom = -10;
  shadowCam.right = shadowCam.top = 10;
  dirLight.position.set(1, 3, 1);
  dirLight.shadow.bias = -0.00002;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  dirLight.shadow.needsUpdate = true;
  // dirLight.shadow.shadowNode.maxFar = 10;
  // dirLight.shadow.shadowNode.lightMargin = 3;
  // dirLight.shadow.bias = -0.0006
  // dirLight.shadow.mapSize.width = 2048;
  // dirLight.shadow.mapSize.height = 2048;
}

export async function populateBeastScene(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${baseUrl}draco/`);

  const group = new THREE.Group();

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const whiteMaterial = new THREE.MeshPhysicalMaterial({ color: '#999' });

  //brutalist_interior_vr_room_baked.glb
  // loader.load('/models/canyon.glb', (gltf) => {
  // loader.load('/models/zdm3.glb', (gltf) => {

  const gltf = await loader.loadAsync(
    `${baseUrl}models/inferno-beast-from-space-from-jurafjvs-cc0-2.glb`,
  );
  const o = gltf.scene;
  o.traverse((c) => {
    (c as THREE.Mesh).material = whiteMaterial;
    c.castShadow = true;
    c.receiveShadow = true;
  });
  gltf.scene.rotateY(Math.PI / 2);
  gltf.scene.position.setY(1.63);
  gltf.scene.scale.set(2, 2, 2);

  group.add(gltf.scene);

  const sponza = await loader.loadAsync(`${baseUrl}models/Sponza-Draco.glb`);
  const s = sponza.scene;
  s.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  scene.add(sponza.scene);

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.top = 5;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.camera.left = -5;
  dirLight.shadow.camera.right = 5;
  dirLight.shadow.bias = -0.0002;
  const csm = new CSMShadowNode(dirLight, {
    cascades: 4,
    maxFar: 50,
    mode: 'practical',
    lightMargin: 15,
  });
  dirLight.shadow.shadowNode = csm;

  const csmHelper = new CSMHelper(csm);
  scene.userData.csmHelper = csmHelper;
  csmHelper.visible = false;
  // scene.add( csmHelper );

  const BOX_WIDTH = 2;
  const BOX_DEPTH = 2;
  const WALL_THICKNESS = 0.02;

  // Floor (0.1 thick, inner face at y = 0)
  // const floor = new THREE.Mesh(
  //   new THREE.BoxGeometry(BOX_WIDTH + WALL_THICKNESS*2, WALL_THICKNESS, BOX_DEPTH + WALL_THICKNESS),
  //   whiteMaterial
  // );
  // floor.position.set(0, -0.72, -WALL_THICKNESS * 0.5);
  // floor.receiveShadow = true;
  // floor.castShadow = true;
  // group.add(floor);

  group.position.setY(0.2);
  scene.add(group);

  // Adjust the shadow map
  // const shadowCam = dirLight.shadow.camera;
  // 			shadowCam.left = shadowCam.bottom = -10;
  // 			shadowCam.right = shadowCam.top = 10;
  //       // dirLight.shadow.bias = -0.00002
  //       dirLight.shadow.mapSize.width = 4096;
  // 			dirLight.shadow.mapSize.height = 4096;
}

export function populateLeonardo(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  onLoaded: () => void,
) {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  loader.load(`${baseUrl}models/leonardo.glb`, (gltf) => {
    const o = gltf.scene;
    o.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    gltf.scene.scale.set(1, 1, 1);

    group.add(gltf.scene);
    onLoaded?.();
  });

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.top = 5;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.camera.left = -5;
  dirLight.shadow.camera.right = 5;
  dirLight.shadow.bias = -0.0002;
  const csm = new CSMShadowNode(dirLight, {
    cascades: 4,
    maxFar: 50,
    mode: 'practical',
    lightMargin: 15,
  });
  dirLight.shadow.shadowNode = csm;

  const csmHelper = new CSMHelper(csm);
  scene.userData.csmHelper = csmHelper;
  csmHelper.visible = false;
  group.scale.set(7, 7, 7);
  group.position.setY(-0.2);
  scene.add(group);
}

export function populateOcclusion(
  scene: THREE.Scene,
  dirLight: THREE.DirectionalLight,
  onLoaded: () => void,
) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${baseUrl}draco/`);

  const group = new THREE.Group();

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const whiteMaterial = new THREE.MeshPhysicalMaterial({ color: '#fff' });

  //brutalist_interior_vr_room_baked.glb
  // loader.load('/models/canyon.glb', (gltf) => {
  // loader.load('/models/zdm3.glb', (gltf) => {
  loader.load(`${baseUrl}models/testocc.glb`, (gltf) => {
    const o = gltf.scene;
    o.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    gltf.scene.scale.set(1, 1, 1);

    group.add(gltf.scene);
    onLoaded?.();
  });

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.top = 5;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.camera.left = -5;
  dirLight.shadow.camera.right = 5;
  dirLight.shadow.bias = -0.0002;
  const csm = new CSMShadowNode(dirLight, {
    cascades: 4,
    maxFar: 50,
    mode: 'practical',
    lightMargin: 15,
  });
  dirLight.shadow.shadowNode = csm;

  const csmHelper = new CSMHelper(csm);
  scene.userData.csmHelper = csmHelper;
  csmHelper.visible = false;
  // scene.add( csmHelper );

  const BOX_WIDTH = 2;
  const BOX_DEPTH = 2;
  const WALL_THICKNESS = 0.02;

  // Floor (0.1 thick, inner face at y = 0)
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      BOX_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      BOX_DEPTH + WALL_THICKNESS,
    ),
    whiteMaterial,
  );
  floor.position.set(0, -0.72, -WALL_THICKNESS * 0.5);
  floor.receiveShadow = true;
  floor.castShadow = true;
  // group.add(floor);

  group.position.setY(0.2);
  scene.add(group);

  // Adjust the shadow map
  // const shadowCam = dirLight.shadow.camera;
  // 			shadowCam.left = shadowCam.bottom = -10;
  // 			shadowCam.right = shadowCam.top = 10;
  //       // dirLight.shadow.bias = -0.00002
  //       dirLight.shadow.mapSize.width = 4096;
  // 			dirLight.shadow.mapSize.height = 4096;
}

export type DirectionalLightDefaults = {
  color: THREE.Color;
  intensity: number;
  position: THREE.Vector3;
  castShadow: boolean;
  shadow: {
    mapSize: THREE.Vector2;
    bias: number;
    normalBias: number;
    radius: number;
    camera: {
      near: number;
      far: number;
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
  };
};

export function captureDirectionalLightDefaults(
  light: THREE.DirectionalLight,
): DirectionalLightDefaults {
  return {
    color: light.color.clone(),
    intensity: light.intensity,
    position: light.position.clone(),
    castShadow: light.castShadow,
    shadow: {
      mapSize: light.shadow.mapSize.clone(),
      bias: light.shadow.bias,
      normalBias: light.shadow.normalBias,
      radius: light.shadow.radius,
      camera: {
        near: light.shadow.camera.near,
        far: light.shadow.camera.far,
        left: light.shadow.camera.left,
        right: light.shadow.camera.right,
        top: light.shadow.camera.top,
        bottom: light.shadow.camera.bottom,
      },
    },
  };
}

function applyDirectionalLightDefaults(
  light: THREE.DirectionalLight,
  defaults: DirectionalLightDefaults,
) {
  light.color.copy(defaults.color);
  light.intensity = defaults.intensity;
  light.position.copy(defaults.position);
  light.castShadow = defaults.castShadow;
  light.shadow.mapSize.copy(defaults.shadow.mapSize);
  light.shadow.bias = defaults.shadow.bias;
  light.shadow.normalBias = defaults.shadow.normalBias;
  light.shadow.radius = defaults.shadow.radius;
  light.shadow.camera.near = defaults.shadow.camera.near;
  light.shadow.camera.far = defaults.shadow.camera.far;
  light.shadow.camera.left = defaults.shadow.camera.left;
  light.shadow.camera.right = defaults.shadow.camera.right;
  light.shadow.camera.top = defaults.shadow.camera.top;
  light.shadow.camera.bottom = defaults.shadow.camera.bottom;
  light.shadow.camera.updateProjectionMatrix();
}

function disposeDirectionalLight(light: THREE.DirectionalLight) {
  if (light.parent) {
    light.parent.remove(light);
  }

  light.dispose();
}

export function recreateDirectionalLight(
  scene: THREE.Scene,
  previousLight: THREE.DirectionalLight | null,
  defaults: DirectionalLightDefaults,
): THREE.DirectionalLight {
  if (previousLight) {
    disposeDirectionalLight(previousLight);
  }

  const light = new THREE.DirectionalLight(defaults.color, defaults.intensity);
  applyDirectionalLightDefaults(light, defaults);
  scene.add(light);
  return light;
}

export function clearSceneContent(scene: THREE.Scene) {
  const csmHelper = scene.userData.csmHelper;
  if (csmHelper) {
    scene.remove(csmHelper);
    delete scene.userData.csmHelper;
  }

  for (const child of [...scene.children]) {
    if (child.type !== 'DirectionalLight') {
      scene.remove(child);
    }
  }
}

export type SceneGiSettings = {
  mode?: 'direct' | 'indirect' | 'combined';
  indirectIntensity?: number;
};

export type SceneCameraSettings = {
  position: THREE.Vector3;
  target?: THREE.Vector3;
};

export type SceneSettings = {
  gi?: SceneGiSettings;
  light?: Partial<LightSettings>;
  occlusion?: Partial<OcclusionSettings>;
  camera?: SceneCameraSettings;
  integrator?: {
    baseSampleCount?: number;
  };
  transport?: {
    envIntensity?: number;
    envLod?: number;
    giFromDirect?: number;
    giFromIndirect?: number;
    albedoBoost?: number;
  };
};

export type SceneDefinition = {
  id: string;
  label: string;
  hdr: string;
  populate: (
    scene: THREE.Scene,
    dirLight: THREE.DirectionalLight,
  ) => Promise<void>;
  settings?: SceneSettings;
};

export const SCENE_PRESETS: SceneDefinition[] = [
  {
    id: 'shaderball-light-lab',
    label: 'ShaderBall GI · Screen Probes + Multi-bounce Surfels',
    hdr: `${baseUrl}exr/pizzo_pernice_puresky_2k.hdr`,
    settings: {
      light: {
        intensity: 7.0,
        animate: true,
        speed: 0.22,
      },
      camera: {
        position: new THREE.Vector3(10.5, 6.2, 12.5),
        target: new THREE.Vector3(0, 1.35, -0.4),
      },
      gi: {
        mode: 'combined',
        indirectIntensity: 1.45,
      },
      integrator: {
        baseSampleCount: 4,
      },
      transport: {
        envIntensity: 0.35,
        envLod: 4.0,
        giFromDirect: 1.65,
        giFromIndirect: 1.0,
        albedoBoost: 1.08,
      },
      occlusion: {
        shadowStrength: 0.8,
        bleedReduction: 0.2,
        grazingBiasScale: 0.25,
        varianceBleedScale: 0.35,
      },
    },
    populate: populateShaderBallSurfelScene,
  },
];
