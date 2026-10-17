// World-space helpers shared by the game, the renderer and the checker.
// Every shard is a floating island. Its content lives in shard-local coordinates and the
// whole island bobs in the air as one rigid body (its drift). Props bob on their own.

import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;

// World position of a shard's local origin at time t.
export function shardOffset(shard, t) {
  const d = shard.drift;
  return {
    x: shard.origin[0],
    y: shard.origin[1] + d.amp * Math.sin((TAU * t) / d.period + d.phase),
    z: shard.origin[2],
  };
}

// Floating prop centre in shard-local space at time t. Slow bob, tiny orbit.
export function propCenter(prop, t) {
  const m = prop.motion;
  return {
    x: prop.x + m.orbit * Math.cos((TAU * t) / m.period + m.phase),
    y: prop.y + m.bob * Math.sin((TAU * t) / m.period + m.phase * 1.7),
    z: prop.z + m.orbit * Math.sin((TAU * t) / m.period + m.phase),
  };
}

// Deterministic per-thing RNG: seed + salt -> stream.
export function rngFor(seed, salt = 0) {
  return mulberry32((seed * 2654435761 + salt * 40503) >>> 0);
}
