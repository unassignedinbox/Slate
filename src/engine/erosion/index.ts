// The erosion registry. Each entry carries its own parameter schema, which is
// what drives the "erosion type" dropdown and its per-type sliders.

import type { ErosionDef } from './types';
import { HYDRAULIC } from './hydraulic';
import { HILLSLOPE } from './hillslope';
import { FLUVIAL } from './fluvial';
import { AEOLIAN } from './aeolian';
import { GLACIAL } from './glacial';
import { COASTAL } from './coastal';
import { CHEMICAL } from './karst';

export type { ErosionContext, ErosionDef } from './types';

export const EROSION_GROUPS: { label: string; items: ErosionDef[] }[] = [
  { label: 'Water', items: [...HYDRAULIC, ...FLUVIAL, ...COASTAL] },
  { label: 'Slopes', items: [...HILLSLOPE] },
  { label: 'Ice & wind', items: [...GLACIAL, ...AEOLIAN] },
  { label: 'Chemistry', items: [...CHEMICAL] },
];

/** Every stochastic pass gets its own seed offset so two identical passes can
 *  be stacked without producing identical results. */
const erosionSeedParam = {
  kind: 'slider' as const,
  key: 'seed',
  label: 'Seed offset',
  min: 0,
  max: 999,
  step: 1,
  def: 0,
};

export const EROSIONS: ErosionDef[] = EROSION_GROUPS.flatMap((g) =>
  g.items.map((item) => ({ ...item, params: [...item.params, erosionSeedParam] })),
);

export const EROSION_MAP: Record<string, ErosionDef> = Object.fromEntries(
  EROSIONS.map((e) => [e.id, e]),
);
