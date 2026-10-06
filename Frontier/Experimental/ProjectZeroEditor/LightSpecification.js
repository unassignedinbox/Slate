//============================================================================================================================================
//                                                          LIGHTSPECIFICATION.JS
//============================================================================================================================================
// 📦 Owned light glyphs, source defaults, and illustrative photometric preset parameters.

// Reuse the shipped engine icon library; do not create another light glyph set.
export const LightIcons = {
  pointlight: "editor-point-light",
  spotlight: "editor-spotlight",
  ieslight: "editor-dome-light",
  arealight: "editor-area-light",
  tubelight: "light-area-2d",
  ledlight: "light-point-2d",
  ledstrip: "slate-ring-light",
};
export const LightNames = {
  pointlight: "Point light",
  spotlight: "Spot light",
  ieslight: "IES photometric",
  arealight: "Area / softbox",
  tubelight: "Tube light",
  ledlight: "LED emitter",
  ledstrip: "LED strip",
};
export const LightDefaults = {
  ledlight: {
    pos: [0, 2, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    temperature: 4000,
    watts: 10,
    efficacy: 110,
    dimmer: 1,
    angle: 120,
    diameter: 40,
    shadows: true,
    showShape: true,
  },
  ledstrip: {
    pos: [0, 2, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    temperature: 3000,
    length: 2.4,
    lumensPerMetre: 1000,
    wattsPerMetre: 14.4,
    ledsPerMetre: 60,
    voltage: 24,
    dimmer: 1,
    routing: "Cove",
    diffuser: false,
    shadows: true,
    showShape: true,
  },
};
export const LightPresetDefaults = {
  "IES Downlight": {
    profile: "Downlight",
    lumens: 1600,
    multiplier: 1,
    cone: 60,
    range: 30,
    cutoff: 0,
    temperature: 4000,
    color: "#ffffff",
  },
};
