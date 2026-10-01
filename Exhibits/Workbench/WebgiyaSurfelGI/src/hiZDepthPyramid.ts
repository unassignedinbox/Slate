import * as THREE from 'three/webgpu';
import {
  Fn,
  int,
  instanceIndex,
  ivec2,
  max,
  min,
  textureLoad,
  textureStore,
  vec4,
} from 'three/tsl';

const MAX_HIZ_LEVELS = 6;

export type HiZLevel = {
  level: number;
  width: number;
  height: number;
  offsetY: number;
  parity: 0 | 1;
};

export type HiZDepthPyramid = {
  run: (
    renderer: THREE.WebGPURenderer,
    sourceDepth: THREE.DepthTexture,
    width: number,
    height: number,
  ) => void;
  getEvenTexture: () => THREE.Texture | null;
  getOddTexture: () => THREE.Texture | null;
  getLevelCount: () => number;
  getLevels: () => readonly HiZLevel[];
};

function makeLevels(width: number, height: number): HiZLevel[] {
  const levels: HiZLevel[] = [];
  const offsets = [0, 0];
  let levelWidth = width;
  let levelHeight = height;
  let level = 0;

  while (true) {
    const parity = (level & 1) as 0 | 1;
    levels.push({
      level,
      width: levelWidth,
      height: levelHeight,
      offsetY: offsets[parity],
      parity,
    });
    offsets[parity] += levelHeight;
    if ((levelWidth === 1 && levelHeight === 1) || level + 1 >= MAX_HIZ_LEVELS)
      break;
    levelWidth = Math.max(1, Math.ceil(levelWidth / 2));
    levelHeight = Math.max(1, Math.ceil(levelHeight / 2));
    level += 1;
  }

  return levels;
}

function makeAtlasTexture(width: number, height: number, name: string) {
  const texture = new THREE.StorageTexture(width, height);
  texture.type = THREE.FloatType;
  texture.format = THREE.RGFormat;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = name;
  return texture;
}

/**
 * Builds conservative min/max depth bounds. Even and odd levels are packed
 * into separate atlases so every reduction reads and writes different WebGPU
 * resources; this avoids read/write aliasing without requiring optional
 * read-write storage-texture support.
 */
export function createHiZDepthPyramid(): HiZDepthPyramid {
  let sourceDepth: THREE.DepthTexture | null = null;
  let evenAtlas: THREE.StorageTexture | null = null;
  let oddAtlas: THREE.StorageTexture | null = null;
  let levels: HiZLevel[] = [];
  let nodes: THREE.ComputeNode[] = [];
  let sourceWidth = 0;
  let sourceHeight = 0;

  function rebuild(
    nextDepth: THREE.DepthTexture,
    width: number,
    height: number,
  ) {
    sourceDepth = nextDepth;
    sourceWidth = width;
    sourceHeight = height;
    levels = makeLevels(width, height);

    let evenHeight = 1;
    let oddHeight = 1;
    for (const level of levels) {
      if (level.parity === 0) {
        evenHeight = Math.max(evenHeight, level.offsetY + level.height);
      } else {
        oddHeight = Math.max(oddHeight, level.offsetY + level.height);
      }
    }
    evenAtlas?.dispose();
    oddAtlas?.dispose();
    evenAtlas = makeAtlasTexture(width, evenHeight, 'Hi-Z Even Levels');
    oddAtlas = makeAtlasTexture(
      levels[1]?.width ?? 1,
      oddHeight,
      'Hi-Z Odd Levels',
    );
    nodes = [];

    for (const level of levels) {
      const outputAtlas = level.parity === 0 ? evenAtlas : oddAtlas;
      if (level.level === 0) {
        const node = Fn(() => {
          const index = int(instanceIndex);
          const x = index.mod(int(level.width));
          const y = index.div(int(level.width));
          const depth = textureLoad(sourceDepth!, ivec2(x, y)).r;
          textureStore(
            outputAtlas,
            ivec2(x, y.add(level.offsetY)),
            vec4(depth, depth, 0.0, 0.0),
          );
        })()
          .compute(level.width * level.height)
          .setName('Hi-Z Level 0');
        nodes.push(node);
        continue;
      }

      const previous = levels[level.level - 1];
      const inputAtlas = previous.parity === 0 ? evenAtlas : oddAtlas;
      const node = Fn(() => {
        const index = int(instanceIndex);
        const x = index.mod(int(level.width));
        const y = index.div(int(level.width));
        const childX = x.mul(2);
        const childY = y.mul(2);
        const maxChildX = int(previous.width - 1);
        const maxChildY = int(previous.height - 1);

        const x0 = min(childX, maxChildX);
        const x1 = min(childX.add(1), maxChildX);
        const y0 = min(childY, maxChildY).add(previous.offsetY);
        const y1 = min(childY.add(1), maxChildY).add(previous.offsetY);

        const d00 = textureLoad(inputAtlas, ivec2(x0, y0)).xy;
        const d10 = textureLoad(inputAtlas, ivec2(x1, y0)).xy;
        const d01 = textureLoad(inputAtlas, ivec2(x0, y1)).xy;
        const d11 = textureLoad(inputAtlas, ivec2(x1, y1)).xy;
        const minimum = min(min(d00.x, d10.x), min(d01.x, d11.x));
        const maximum = max(max(d00.y, d10.y), max(d01.y, d11.y));

        textureStore(
          outputAtlas,
          ivec2(x, y.add(level.offsetY)),
          vec4(minimum, maximum, 0.0, 0.0),
        );
      })()
        .compute(level.width * level.height)
        .setName(`Hi-Z Level ${level.level}`);
      nodes.push(node);
    }
  }

  function run(
    renderer: THREE.WebGPURenderer,
    nextDepth: THREE.DepthTexture,
    width: number,
    height: number,
  ) {
    if (
      nextDepth !== sourceDepth ||
      width !== sourceWidth ||
      height !== sourceHeight ||
      !evenAtlas ||
      !oddAtlas
    ) {
      rebuild(nextDepth, width, height);
    }

    for (const node of nodes) {
      renderer.compute(node);
    }
  }

  return {
    run,
    getEvenTexture: () => evenAtlas,
    getOddTexture: () => oddAtlas,
    getLevelCount: () => levels.length,
    getLevels: () => levels,
  };
}
