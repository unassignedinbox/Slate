// sanity: how bright is the pool under a lamp vs the daylit road?
const I = 260, h = 9.0, range = 30;
for (const d of [0, 6, 12, 20]) {
  const dist2 = h * h + d * d, dist = Math.sqrt(dist2);
  const win = Math.max(0, 1 - Math.pow(dist / range, 4)); const atten = win * win / (dist2 + 1);
  const ndl = h / dist;
  const asphalt = 0.07 / Math.PI * ndl * atten * I;
  const walk = 0.40 / Math.PI * ndl * atten * I;
  console.log(`offset ${String(d).padStart(2)} m  asphalt ${asphalt.toFixed(3)}  footway ${walk.toFixed(3)}`);
}
const sunAsphalt = 0.07 / Math.PI * 0.8 * 5.4;
console.log(`daylight asphalt ${sunAsphalt.toFixed(3)} (lamp pool should be ~20-60% of this)`);
