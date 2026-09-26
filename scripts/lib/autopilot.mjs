// Shared headless driver used by scripts/sim.mjs and scripts/selftest.mjs.
// It is deliberately simple: steer at the target, look a couple of car lengths
// ahead for solid clutter, back out when wedged.
import { Colliders } from '../../src/physics.js';
import { clamp } from '../../src/util.js';

export function makeAutopilot(car, colliders, { speedCap = 18 } = {}) {
  return function drive(targetX, targetZ) {
    const desired = Math.atan2(targetX - car.pos.x, targetZ - car.pos.z);
    let diff = desired - car.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // Wedged: reverse out with opposite lock.
    if (car.stuckTimer > 1.0) {
      return { throttle: 0, brake: 1, steer: diff > 0 ? -1 : 1, handbrake: false };
    }

    let steer = clamp(diff * 1.8, -1, 1);
    const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    const right = { x: Math.cos(car.yaw), z: -Math.sin(car.yaw) };
    const reach = clamp(7 + Math.abs(car.speed) * 0.9, 9, 28);
    let bias = 0;
    let blocked = 0;
    for (const side of [-1, 1]) {
      for (const dist of [0.45, 0.8, 1.0]) {
        const px = car.pos.x + fwd.x * reach * dist + right.x * side * 2.0;
        const pz = car.pos.z + fwd.z * reach * dist + right.z * side * 2.0;
        for (const it of colliders.nearby(px, pz, 4)) {
          if (it.kind !== 'solid' && it.kind !== 'trigger') continue;
          if (Colliders.penetration(it, px, pz, 2.5)) {
            const weight = it.kind === 'trigger' ? 0.5 : 1.4;
            bias -= side * weight * (1.2 - dist);
            blocked += weight;
          }
        }
      }
    }
    steer = clamp(steer + bias * 0.9, -1, 1);
    const cap = blocked > 2.5 ? speedCap * 0.5 : speedCap;
    const throttle = car.speed > cap ? 0 : Math.abs(diff) > 1.2 ? 0.4 : 1;
    const brake = car.speed > cap + 4 ? 0.5 : 0;
    return { throttle: brake ? 0 : throttle, brake, steer, handbrake: false };
  };
}
