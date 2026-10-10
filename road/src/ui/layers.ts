/**
 * The surface stack. This is the texturing UI: an ordered list of layers, each
 * with a toggle, an opacity and two or three parameters. No node graph - the
 * order in the list IS the composition order, exactly as the shader walks it.
 */
export interface LayerParam { key: string; label: string; min: number; max: number; step: number; fmt?: (v: number) => string }
export interface Layer {
  id: string; name: string; note: string;
  on: boolean; opacity: number;
  slot: number;                       // index into the shader's L[] array
  params: LayerParam[];
  values: [number, number, number];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const m = (v: number) => `${v.toFixed(2)} m`;

export function defaultStack(): Layer[] {
  return [
    {
      id: 'asphalt', name: 'Asphalt base', note: 'AC 10 surf course', on: true, opacity: 1, slot: 0,
      params: [
        { key: 'lightness', label: 'Lightness', min: 0, max: 1, step: 0.01, fmt: pct },
        { key: 'warmth', label: 'Warmth', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [0.30, 0.35, 0],
    },
    {
      id: 'aggregate', name: 'Exposed aggregate', note: 'chipping size and bite', on: true, opacity: 1, slot: 1,
      params: [
        { key: 'size', label: 'Chipping size', min: 0.2, max: 2, step: 0.01, fmt: (v) => `${(10 / v).toFixed(0)} mm` },
        { key: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [1.0, 0.55, 0],
    },
    {
      id: 'patching', name: 'Patching & bleed', note: 'old reinstatements', on: true, opacity: 0.8, slot: 2,
      params: [
        { key: 'size', label: 'Patch size', min: 0.2, max: 3, step: 0.01, fmt: (v) => `${(v * 16).toFixed(0)} m` },
        { key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [1.0, 0.6, 0],
    },
    {
      id: 'polish', name: 'Tyre polish', note: 'wheel-path burnish', on: true, opacity: 1, slot: 3,
      params: [
        { key: 'width', label: 'Path width', min: 0.1, max: 1.2, step: 0.01, fmt: m },
        { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [0.42, 0.8, 0],
    },
    {
      id: 'cracking', name: 'Cracking', note: 'thermal and fatigue', on: true, opacity: 0.85, slot: 4,
      params: [
        { key: 'scale', label: 'Block size', min: 0.2, max: 3, step: 0.01, fmt: (v) => `${(v * 1.9).toFixed(1)} m` },
        { key: 'age', label: 'Age', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [0.8, 0.45, 0],
    },
    {
      id: 'markings', name: 'Road markings', note: 'thermoplastic', on: true, opacity: 1, slot: 5,
      params: [
        { key: 'bright', label: 'Brightness', min: 0, max: 1.4, step: 0.01, fmt: pct },
        { key: 'wear', label: 'Wear', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [1.0, 0.45, 0],
    },
    {
      id: 'kerb', name: 'Kerb concrete', note: 'precast HB2', on: true, opacity: 1, slot: 6,
      params: [
        { key: 'lightness', label: 'Lightness', min: 0, max: 1, step: 0.01, fmt: pct },
        { key: 'staining', label: 'Staining', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [0.62, 0.5, 0],
    },
    {
      id: 'paving', name: 'Footway paving', note: 'pattern and unit size', on: true, opacity: 1, slot: 7,
      params: [
        { key: 'pattern', label: 'Pattern', min: 0, max: 0.99, step: 0.33, fmt: (v) => ['Slabs', 'Stretcher', 'Herringbone', 'Ashlar'][Math.min(3, Math.floor(v * 4))] },
        { key: 'unit', label: 'Unit size', min: 0.15, max: 1.2, step: 0.01, fmt: m },
      ],
      values: [0.34, 0.45, 0],
    },
    {
      id: 'grime', name: 'Grime & staining', note: 'global dirt', on: true, opacity: 0.7, slot: 8,
      params: [
        { key: 'scale', label: 'Scale', min: 0.2, max: 3, step: 0.01, fmt: (v) => `${(v * 10).toFixed(0)} m` },
        { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [1.0, 0.6, 0],
    },
    {
      id: 'water', name: 'Standing water', note: 'ponding in the channel', on: false, opacity: 0.5, slot: 9,
      params: [
        { key: 'coverage', label: 'Coverage', min: 0.1, max: 2, step: 0.01, fmt: pct },
        { key: 'ripple', label: 'Ripple', min: 0, max: 1, step: 0.01, fmt: pct },
      ],
      values: [0.7, 0.3, 0],
    },
  ];
}

/** Pack the stack into the shader's L[] array. */
export function packLayers(stack: Layer[], out: Float32Array): void {
  out.fill(0);
  for (const l of stack) {
    const o = l.slot * 4;
    out[o] = l.on ? l.opacity : 0;
    out[o + 1] = l.values[0];
    out[o + 2] = l.values[1];
    out[o + 3] = l.values[2];
  }
}
