// Packs the uniform block declared in shaders.js. Offsets are in floats.
import { GLOBALS_FLOATS, OFF } from './renderer.js';
import { PALETTE } from '../engine/materials.js';
import { packStacks } from '../engine/textures.js';
import { sunState } from '../engine/sun.js';
import { ortho, lookAt, mul } from '../engine/math.js';

export function buildGlobals({ cam, view, env, stacks }) {
  const g = new Float32Array(GLOBALS_FLOATS);
  const sun = sunState(env.time);
  // Shadow box follows the camera so road-scale detail stays sharp near the viewer.
  const shadowVP = lightMatrix(sun.sunDir, cam.target, Math.max(140, cam.dist * 0.9));
  g.set(view.viewProj, OFF.viewProj);
  g.set(shadowVP, OFF.lightVP);
  g.set(view.invViewProj, OFF.invVP);
  g.set([...view.eye, 1], OFF.camPos);
  g.set([...sun.sunDir, sun.sunIntensity], OFF.sunDir);
  g.set([...sun.sunColor, 1], OFF.sunColor);
  g.set([...sun.skyTop, 1], OFF.skyTop);
  g.set([...sun.skyHorizon, 1], OFF.skyHorizon);
  g.set([...sun.groundTint, 1], OFF.groundTint);
  g.set([env.fog, 0, env.fog > 0 ? 1 : 0, 0], OFF.fog);
  g.set([0, env.exposure ?? 1, env.shadows ? 1 : 0, env.wetness ?? 0], OFF.misc);
  PALETTE.forEach((c, i) => g.set(c, OFF.palette + i * 4));
  g.set(packStacks(stacks), OFF.stacks);
  return g;
}

// Orthographic light box centred on `focus`, looking along -sunDir.
export function lightMatrix(sunDir, focus, ext) {
  const dir = sunDir;
  const eye = [focus[0] + dir[0] * 800, focus[1] + dir[1] * 800, focus[2] + dir[2] * 800];
  const view = lookAt(eye, focus, Math.abs(dir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
  const proj = ortho(-ext, ext, -ext, ext, 100, 1800);
  return mul(proj, view);
}
