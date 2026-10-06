//============================================================================================================================================
//                                                          LIGHTSPECIFICATION.JS
//============================================================================================================================================
// 📦 Owned light glyphs, source defaults, and illustrative photometric preset parameters.

const Paths = {
  pointlight:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  spotlight:
    '<path d="m5 5 7-2 5 6-6 5zM12 14l-2 7 12-7-5-5M6 13l-3 6m0 0h8"/>',
  ieslight:
    '<path d="M8 3h8l2 5H6zM12 8v13M3 13c1 10 7 8 9 3 2 5 8 7 9-3M6 11c0 5 4 8 6 5 2 3 6 0 6-5"/>',
  arealight: '<path d="m3 6 15-3 3 12-15 3zM7 21l2-4m7 3-1-4M6 8l10-2"/>',
  tubelight:
    '<path d="M4 7h16a2 2 0 0 1 0 4H4a2 2 0 0 1 0-4zM4 7v4m16-4v4M5 15v4m7-4v6m7-6v4"/>',
  ledlight:
    '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M8 2v3m8-3v3M8 19v3m8-3v3M2 8h3m-3 8h3m14-8h3m-3 8h3"/>',
  ledstrip:
    '<path d="M3 3h12a5 5 0 0 1 0 10H8a3 3 0 0 0 0 6h13M3 7h12a1 1 0 0 1 0 2H8a7 7 0 0 0 0 14"/><path d="M6 3v4m5-4v4m8 4 3 1M6 15l-3 1m9 3v4m6-4v4"/>',
};
export const LightGlyphs = Object.fromEntries(
  Object.entries(Paths).map(([Type, Path]) => [
    Type,
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#bcc4c6" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${Path}</svg>`,
  ]),
);
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
