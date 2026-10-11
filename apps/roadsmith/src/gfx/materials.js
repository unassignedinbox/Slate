// The texturing layer stack: channels group the 50 surface ids into editable materials.
// Each channel writes its parameters into the GPU material array consumed by surface.wgsl.

import { SURF } from '../core/mesh.js';

export const PAVING_PATTERNS = [
  'Square slabs', 'Running bond', 'Herringbone', 'Basketweave', 'Hex setts', 'Cobble setts', 'Flagstone',
];

/**
 * channel = {
 *   id, name, group, ids[], enabled,
 *   albedo:[r,g,b], roughness, metallic, scale, detail, wear, puddle, emissive, pattern, normal, tint
 * }
 */
function ch(id, name, group, ids, o = {}) {
  return {
    id, name, group, ids,
    enabled: o.enabled !== false,
    albedo: o.albedo ?? [0.5, 0.5, 0.5],
    opacity: o.opacity ?? 1,
    roughness: o.roughness ?? 0.85,
    metallic: o.metallic ?? 0,
    scale: o.scale ?? 1,
    detail: o.detail ?? 1,
    wear: o.wear ?? 1,
    puddle: o.puddle ?? 0.5,
    emissive: o.emissive ?? 0,
    pattern: o.pattern ?? 0,
    normal: o.normal ?? 1,
    note: o.note ?? '',
  };
}

export function defaultChannels() {
  return [
    ch('asphalt', 'Asphalt carriageway', 'Carriageway', [SURF.ASPHALT, SURF.ASPHALT_JUNCTION, SURF.SHOULDER], {
      albedo: [0.33, 0.33, 0.345], roughness: 0.92, scale: 1, detail: 1, wear: 1,
      note: 'Aggregate speckle, polished wheel paths and tar seams are generated from the per-vertex wear channel.',
    }),
    ch('gutter', 'Gutter channel', 'Carriageway', [SURF.GUTTER], {
      albedo: [0.27, 0.272, 0.28], roughness: 0.88, puddle: 1, wear: 1.2,
      note: 'Holds standing water first — drives the wet-road reflections along the kerb line.',
    }),
    ch('markings', 'Road markings', 'Carriageway', [SURF.LINE_PAINT], {
      albedo: [0.74, 0.735, 0.70], roughness: 0.6, pattern: 1,
      note: 'Lane dashes, edge lines, stop bars, zebras, arrows and bay markings. Pattern 1 = yellow centre line.',
    }),
    ch('kerb', 'Kerb units', 'Kerbline', [SURF.KERB_TOP, SURF.KERB_FACE], {
      albedo: [0.44, 0.44, 0.43], roughness: 0.86, scale: 1.1,
      note: 'Pre-cast concrete with 0.9 m joints and a battered face.',
    }),
    ch('footway', 'Footway paving', 'Kerbline', [SURF.FOOTWAY], {
      albedo: [0.40, 0.395, 0.385], roughness: 0.84, pattern: 0, scale: 1,
      note: 'Choose the paving bond — slabs, brick, herringbone, basketweave, hex, cobble or flagstone.',
    }),
    ch('tactile', 'Tactile paving', 'Kerbline', [SURF.TACTILE], {
      albedo: [0.46, 0.33, 0.16], roughness: 0.8,
      note: 'Blister surface at every dropped kerb.',
    }),
    ch('verge', 'Verge & grass', 'Landscape', [SURF.VERGE, SURF.GRASS], {
      albedo: [0.30, 0.38, 0.22], roughness: 0.97, scale: 1,
    }),
    ch('soil', 'Soil & gravel', 'Landscape', [SURF.DIRT, SURF.SOIL, SURF.GRAVEL], {
      albedo: [0.30, 0.25, 0.19], roughness: 0.96,
    }),
    ch('blocks', 'City block paving', 'Landscape', [SURF.PAVER, SURF.BRICK, SURF.COBBLE], {
      albedo: [0.38, 0.355, 0.335], roughness: 0.86, pattern: 1,
      note: 'Each generated block picks one of seven bonds; this channel tints them all.',
    }),
    ch('concrete', 'Structural concrete', 'Structures', [SURF.CONCRETE, SURF.MEDIAN, SURF.BRIDGE_UNDER, SURF.TUNNEL_LINING, SURF.PAINTED_CONCRETE], {
      albedo: [0.47, 0.47, 0.46], roughness: 0.88,
    }),
    ch('steel', 'Steel & guardrail', 'Structures', [SURF.METAL, SURF.STEEL_RUST, SURF.CHROME, SURF.ROAD_PLATE], {
      albedo: [0.56, 0.57, 0.59], roughness: 0.38, metallic: 1, wear: 1,
    }),
    ch('rail', 'Permanent way', 'Rail', [SURF.RAIL_STEEL, SURF.RAIL_BED, SURF.BALLAST, SURF.SLEEPER], {
      albedo: [0.42, 0.41, 0.39], roughness: 0.7, metallic: 0.3,
      note: 'Rail heads polish to a mirror; ballast stays coarse.',
    }),
    ch('plastic', 'Signs, cones & plastics', 'Furniture', [SURF.PLASTIC, SURF.CONE, SURF.BARRIER, SURF.SIGN_SPEED, SURF.SIGN_STOP, SURF.SIGN_GIVEWAY, SURF.SIGN_INFO, SURF.WOOD], {
      albedo: [0.62, 0.60, 0.58], roughness: 0.55,
    }),
    ch('glass', 'Glass', 'Furniture', [SURF.GLASS, SURF.CAR_GLASS, SURF.WATER], {
      albedo: [0.18, 0.21, 0.24], roughness: 0.06, opacity: 1,
    }),
    ch('lights', 'Emissive lamps & signals', 'Furniture', [SURF.LAMP_LENS, SURF.SIGNAL_LENS, SURF.LIGHT_RED, SURF.LIGHT_WHITE, SURF.BILLBOARD], {
      albedo: [0.9, 0.86, 0.78], roughness: 0.25, emissive: 1,
      note: 'Signal lenses read the live controller state through the vertex stream.',
    }),
    ch('vehicles', 'Vehicle paint & tyres', 'Dynamic', [SURF.CAR_PAINT, SURF.TRAIN_BODY, SURF.TIRE, SURF.RUBBER], {
      albedo: [0.8, 0.8, 0.82], roughness: 0.28, metallic: 0.1,
    }),
  ];
}

export const MATERIAL_FLOATS = 16;   // 4 x vec4
export const MATERIAL_SLOTS = 50;

/** Pack the channel list into the Float32Array uploaded to the material uniform buffer. */
export function packMaterials(channels, out = new Float32Array(MATERIAL_SLOTS * MATERIAL_FLOATS)) {
  // defaults for any surface id not claimed by a channel
  for (let i = 0; i < MATERIAL_SLOTS; i++) {
    const o = i * MATERIAL_FLOATS;
    out[o] = 0.5; out[o + 1] = 0.5; out[o + 2] = 0.5; out[o + 3] = 1;
    out[o + 4] = 0.85; out[o + 5] = 0; out[o + 6] = 1; out[o + 7] = 1;
    out[o + 8] = 1; out[o + 9] = 0.5; out[o + 10] = 0; out[o + 11] = 0;
    out[o + 12] = 1; out[o + 13] = 1; out[o + 14] = 1; out[o + 15] = 0;
  }
  for (const c of channels) {
    for (const id of c.ids) {
      if (id == null || id < 0 || id >= MATERIAL_SLOTS) continue;
      const o = id * MATERIAL_FLOATS;
      out[o] = c.albedo[0]; out[o + 1] = c.albedo[1]; out[o + 2] = c.albedo[2]; out[o + 3] = c.opacity;
      out[o + 4] = c.roughness; out[o + 5] = c.metallic; out[o + 6] = Math.max(c.scale, 0.01); out[o + 7] = c.detail;
      out[o + 8] = c.wear; out[o + 9] = c.puddle; out[o + 10] = c.emissive; out[o + 11] = c.pattern;
      out[o + 12] = c.enabled ? 1 : 0; out[o + 13] = 1; out[o + 14] = c.normal; out[o + 15] = 0;
    }
  }
  return out;
}

/** Environment presets drive the sky, sun and grading. */
export const ENV_PRESETS = {
  overcast: {
    name: 'Overcast noon', sunAzimuth: 2.1, sunElevation: 0.95, sunIntensity: 2.2,
    sunColour: [1.0, 0.98, 0.95], zenith: [0.38, 0.44, 0.54], horizon: [0.62, 0.66, 0.71],
    ambient: 1.25, bounce: 0.35, fog: [0.66, 0.70, 0.75], fogDensity: 0.00055,
    exposure: 1.0, wetness: 0.0, night: 0, shadow: 0.55, contrast: 1.02, saturation: 0.95,
  },
  clear: {
    name: 'Clear afternoon', sunAzimuth: 1.15, sunElevation: 0.72, sunIntensity: 5.4,
    sunColour: [1.0, 0.94, 0.82], zenith: [0.21, 0.37, 0.66], horizon: [0.63, 0.72, 0.82],
    ambient: 0.85, bounce: 0.45, fog: [0.66, 0.74, 0.84], fogDensity: 0.00035,
    exposure: 1.05, wetness: 0.0, night: 0, shadow: 0.92, contrast: 1.08, saturation: 1.05,
  },
  wet: {
    name: 'After rain', sunAzimuth: 2.6, sunElevation: 0.38, sunIntensity: 2.9,
    sunColour: [1.0, 0.86, 0.72], zenith: [0.26, 0.33, 0.44], horizon: [0.58, 0.60, 0.64],
    ambient: 1.0, bounce: 0.3, fog: [0.58, 0.61, 0.66], fogDensity: 0.0009,
    exposure: 1.0, wetness: 0.9, night: 0, shadow: 0.6, contrast: 1.05, saturation: 0.95,
  },
  dusk: {
    name: 'Dusk', sunAzimuth: 3.5, sunElevation: 0.12, sunIntensity: 3.6,
    sunColour: [1.0, 0.62, 0.36], zenith: [0.10, 0.14, 0.27], horizon: [0.52, 0.36, 0.30],
    ambient: 0.5, bounce: 0.25, fog: [0.34, 0.29, 0.31], fogDensity: 0.0011,
    exposure: 1.15, wetness: 0.35, night: 0.45, shadow: 0.7, contrast: 1.1, saturation: 1.1,
  },
  night: {
    name: 'Night', sunAzimuth: 4.4, sunElevation: -0.25, sunIntensity: 0.12,
    sunColour: [0.52, 0.62, 0.86], zenith: [0.012, 0.018, 0.038], horizon: [0.05, 0.06, 0.1],
    ambient: 0.22, bounce: 0.15, fog: [0.035, 0.042, 0.06], fogDensity: 0.0013,
    exposure: 1.5, wetness: 0.55, night: 1, shadow: 0.25, contrast: 1.12, saturation: 1.0,
  },
};
