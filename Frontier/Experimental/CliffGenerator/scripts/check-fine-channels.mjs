// Compares refineField with and without the simulated channel network (continuous channels vs the
// coarse upsample). Usage: node scripts/check-fine-channels.mjs ["preset"]
const ROOT = new URL('../src/', import.meta.url).href;
const { generateTerrain } = await import(ROOT + 'pipeline.js');
const { defaults, presets } = await import(ROOT + 'params.js');
const { refineField } = await import(ROOT + 'terrain-geometry.js');
const { NO_WATER } = await import(ROOT + 'features.js');

const preset = process.argv[2] || 'Alpine granite';
const res = 256;
const params = { ...defaults, ...presets[preset], resolution: res };
params.droplets = Math.round(params.droplets * (res * res) / (512 * 512));
const field = generateTerrain(params, () => {});
const v = { ...defaults, ...presets[preset] };
const measure = (f) => {
  const M = f.resolution, H = f.height;
  let rough = 0, rn = 0, wet = 0;
  for (let j = 2; j < M - 2; j++) for (let i = 2; i < M - 2; i++) {
    const c = j * M + i;
    if (f.river[c] > 0.3) { rough += Math.abs(H[c] - (H[c - 1] + H[c + 1] + H[c - M] + H[c + M]) / 4); rn++; }
  }
  for (let c = 0; c < M * M; c++) if (f.waterLevel[c] > NO_WATER * 0.5 && f.waterLevel[c] - H[c] > 0.02) wet++;
  return { M, bankRough: +(rough / Math.max(1, rn)).toFixed(4), riverFineCells: rn, wetFineCells: wet };
};
const withNet = refineField({ ...field, _refined: undefined }, v);
const noNet = refineField({ ...field, network: null, _refined: undefined }, v);
console.log(JSON.stringify({ preset, withContinuousChannels: measure(withNet), coarseUpsampleOnly: measure(noNet) }));
