// SLATE core configuration — volume dimensions, world scale, quality tiers.
export const QUALITY = {
  performance: { dim: [128, 84, 128],  cell: 1.25, label: 'Performance' },
  balanced:    { dim: [160, 104, 160], cell: 1.0,  label: 'Balanced' },
  quality:     { dim: [192, 124, 192], cell: 0.833, label: 'Quality' },
};

export const ATLAS_COLS = 16;      // z-slices per atlas row
export const BAND = 0.45;          // occupancy transition band (metres)
export const MAX_PARTICLES = 8192; // particle texture is square power-of-two
export const FLOW_RES = [512, 512];// 2D flow map resolution

export const state = {
  quality: 'balanced',
  dim: [160, 104, 160],
  cell: 1.0,
  // World AABB (metres). Computed from dim*cell, centred on origin.
  lo: [0, 0, 0],
  hi: [0, 0, 0],
  particles: 4096,
};

export function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.balanced;
  state.quality = name;
  state.dim = q.dim.slice();
  state.cell = q.cell;
  state.lo = q.dim.map(d => -d * q.cell / 2);
  state.hi = q.dim.map(d => d * q.cell / 2);
}
applyQuality('balanced');

export const worldSize = () => [state.hi[0] - state.lo[0], state.hi[1] - state.lo[1], state.hi[2] - state.lo[2]];
