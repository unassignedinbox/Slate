// Tyre temperature colour ramp: cold blue -> ideal green -> hot amber -> overheat red.
const STOPS = [
  [60, [0x2a, 0x6d, 0xf4]],
  [85, [0x2e, 0xe5, 0x9d]],
  [100, [0xff, 0xc4, 0x00]],
  [115, [0xff, 0x3b, 0x30]],
];

const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function heatHex(t) {
  if (t <= STOPS[0][0]) return toHex(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    const [t0, c0] = STOPS[i - 1];
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return toHex(c0.map((c, j) => c + (c1[j] - c) * k));
    }
  }
  return toHex(STOPS[STOPS.length - 1][1]);
}
