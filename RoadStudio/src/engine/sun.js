// Time-of-day lighting. Returns the direction towards the sun and sky colours.
import { norm, clamp } from './math.js';

export function sunState(time) {
  const t = clamp(time, 0, 24);
  const h = ((t - 6) / 12) * Math.PI;           // 0 at 06:00, PI at 18:00
  const elev = Math.sin(h);
  const dir = norm([-Math.cos(h) * 0.8, Math.max(elev, 0.03), 0.45]);
  const k = clamp(elev * 2.2, 0, 1);            // daylight factor
  const warm = [1.0, 0.62, 0.36], white = [1.0, 0.97, 0.92];
  const sunColor = warm.map((c, i) => c + (white[i] - c) * clamp(elev * 3, 0, 1));
  const lerp3 = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  return {
    sunDir: dir,
    sunIntensity: k * 1.6,
    sunColor,
    skyTop: lerp3([0.012, 0.018, 0.035], [0.22, 0.44, 0.82], k),
    skyHorizon: lerp3([0.02, 0.025, 0.04], [0.68, 0.78, 0.88], k),
    groundTint: lerp3([0.02, 0.02, 0.025], [0.16, 0.15, 0.13], k),
  };
}
