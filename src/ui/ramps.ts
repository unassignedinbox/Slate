// Shared colour ramps for satmap layers.

import type { ChannelId, ColorStop } from '../engine/types';

export const RAMPS: { name: string; stops: ColorStop[] }[] = [
  { name: 'Sandstone', stops: [{ at: 0, color: '#6b3f26' }, { at: 0.5, color: '#c2764a' }, { at: 1, color: '#f0d3a6' }] },
  { name: 'Rock', stops: [{ at: 0, color: '#2e2f33' }, { at: 0.55, color: '#6d6a63' }, { at: 1, color: '#cdc7ba' }] },
  { name: 'Alpine', stops: [{ at: 0, color: '#3d4a35' }, { at: 0.45, color: '#78806a' }, { at: 1, color: '#f2f4f3' }] },
  { name: 'Volcanic', stops: [{ at: 0, color: '#17181b' }, { at: 0.5, color: '#4a423c' }, { at: 1, color: '#9c8f84' }] },
  { name: 'Desert', stops: [{ at: 0, color: '#8a5a2b' }, { at: 0.6, color: '#d8a75c' }, { at: 1, color: '#f6e2b0' }] },
  { name: 'Silt', stops: [{ at: 0, color: '#4d4230' }, { at: 0.5, color: '#8f8265' }, { at: 1, color: '#d9cdae' }] },
  { name: 'Wet sediment', stops: [{ at: 0, color: '#2c3330' }, { at: 0.5, color: '#5d6a58' }, { at: 1, color: '#a9b39a' }] },
  { name: 'Scree', stops: [{ at: 0, color: '#4a4642' }, { at: 0.5, color: '#8b857c' }, { at: 1, color: '#d5cfc4' }] },
  { name: 'Vegetation', stops: [{ at: 0, color: '#33402a' }, { at: 0.5, color: '#5c6b3c' }, { at: 1, color: '#9aa566' }] },
  { name: 'Basalt', stops: [{ at: 0, color: '#191b1f' }, { at: 0.6, color: '#454a52' }, { at: 1, color: '#8b8f94' }] },
  { name: 'Snow', stops: [{ at: 0, color: '#8e9aa4' }, { at: 0.5, color: '#c9d3da' }, { at: 1, color: '#ffffff' }] },
  { name: 'Water', stops: [{ at: 0, color: '#0d2733' }, { at: 0.6, color: '#1f5566' }, { at: 1, color: '#4f9aa6' }] },
];

const BY_NAME = new Map(RAMPS.map((r) => [r.name, r]));

const CHANNEL_RAMP: Partial<Record<ChannelId, string>> = {
  height: 'Sandstone',
  protrusion: 'Scree',
  strata: 'Sandstone',
  slope: 'Rock',
  aspect: 'Rock',
  curvature: 'Rock',
  roughness: 'Scree',
  cavity: 'Basalt',
  flow: 'Water',
  rivers: 'Water',
  wetness: 'Wet sediment',
  sediment: 'Silt',
  eroded: 'Scree',
  snow: 'Snow',
  sea: 'Water',
  constant: 'Basalt',
  noise: 'Basalt',
  grain: 'Scree',
  cells: 'Vegetation',
};

export function rampForChannel(channel: ChannelId): ColorStop[] {
  const name = CHANNEL_RAMP[channel] ?? 'Rock';
  return (BY_NAME.get(name) ?? RAMPS[1]).stops.map((s) => ({ ...s }));
}
