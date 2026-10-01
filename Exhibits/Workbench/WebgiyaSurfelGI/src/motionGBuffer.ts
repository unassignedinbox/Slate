import * as THREE from 'three/webgpu';
import {
  diffuseColor,
  materialReference,
  mrt,
  normalWorld,
  vec4,
  velocity,
} from 'three/tsl';
import type { GBufferBundle } from './gbuffer';

/**
 * Derived four-target G-buffer used by the host extension. The pinned upstream
 * gbuffer.ts remains unchanged for the exact Webgiya baseline.
 *
 * 0: encoded world normal
 * 1: diffuse/base colour
 * 2: NDC motion vector
 * 3: stable surface/material ID
 */
export function createMotionGBuffer(
  renderer: THREE.WebGPURenderer,
): GBufferBundle {
  const dpr = renderer.getPixelRatio
    ? renderer.getPixelRatio()
    : globalThis.devicePixelRatio;
  const rawWidth = Math.max(1, Math.floor(globalThis.innerWidth * dpr));
  const rawHeight = Math.max(1, Math.floor(globalThis.innerHeight * dpr));

  const target = new THREE.RenderTarget(rawWidth, rawHeight, {
    count: 4,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
  });
  target.depthTexture = new THREE.DepthTexture(rawWidth, rawHeight);
  target.textures[0].name = 'normal';
  target.textures[1].name = 'diffuseColor';
  target.textures[2].name = 'velocity';
  target.textures[3].name = 'surfaceId';

  for (const texture of target.textures) {
    texture.generateMipmaps = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
  }

  const surfaceId = materialReference('surfaceId', 'float');
  const surfaceVersion = materialReference('surfaceVersion', 'float');
  const sceneMRT = mrt({
    normal: normalWorld.mul(0.5).add(0.5),
    diffuseColor: vec4(diffuseColor.rgb, 1.0),
    velocity: vec4(velocity, 0.0, 1.0),
    surfaceId: vec4(surfaceId, surfaceVersion, 0.0, 1.0),
  });

  function resize(activeRenderer: THREE.WebGPURenderer) {
    const pixelRatio = activeRenderer.getPixelRatio
      ? activeRenderer.getPixelRatio()
      : globalThis.devicePixelRatio;
    const width = Math.max(1, Math.floor(globalThis.innerWidth * pixelRatio));
    const height = Math.max(1, Math.floor(globalThis.innerHeight * pixelRatio));
    target.setSize(width, height);
  }

  return { target, sceneMRT, resize };
}
