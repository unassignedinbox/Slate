//============================================================================================================================================
// 🩶 EnvironmentSpecification.js — the skies, and the sun that hangs in them
//============================================================================================================================================
// An environment in this editor is not a file. There is no HDRI to download, no megabyte of latitude-longitude pixels
// to wait for; every sky here is a recipe — a gradient, a few panels of light, some cloud, a horizon glow — that
// EnvironmentSolver turns into a small equirectangular map at the moment it is needed. That is what makes the sun
// movable: the sky is regenerated around it in a few milliseconds, so the glow, the horizon and the light on the model
// all agree about where the sun is.
//
// 🔴 The recipe carries BOTH the detail and a three-colour gradient of itself. The gradient is what a rough surface
//    and an unlit corner see, and what the viewport falls back to when there is no device to hold a texture — a
//    headless driver, a lost context, the first frame. A sky that only exists as pixels is a sky that disappears.
//============================================================================================================================================

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));

//--------------------------------------------------------------------------------------------------------------------------
// Light panels, in the sky's own coordinates: where it is, how big, how bright. A softbox is a rectangle of light on
// the inside of a room, and every studio in the catalogue is three or four of them hung in the dark.
//--------------------------------------------------------------------------------------------------------------------------
const Panel = (Azimuth, Elevation, Width, Height, Strength, Tint = [1, 1, 1], Softness = 0.35) => ({
    Azimuth,
    Elevation,
    Width,
    Height,
    Strength,
    Tint,
    Softness,
});

//--------------------------------------------------------------------------------------------------------------------------
// The catalogue. Zenith, Horizon and Ground are the gradient the sky averages to; Key, Fill and Rim are what the three
// rig lights read when nobody has touched them; Sky is the recipe; Sun is where the sun starts when this sky is chosen.
//
// Scale is the brightest thing the map has to hold, which is how an eight-bit texture carries a sky with a hundred to
// one between its panels and its floor: the solver divides by it, the shader multiplies by it back.
//--------------------------------------------------------------------------------------------------------------------------
export const EnvironmentOrdering = [
    {
        Identifier: "studio",
        Label: "Studio",
        Note: "Three softboxes in a dark room",
        Zenith: [0.52, 0.56, 0.62],
        Horizon: [0.32, 0.33, 0.36],
        Ground: [0.07, 0.07, 0.08],
        Key: 7.0,
        Fill: 1.6,
        Rim: 2.4,
        Scale: 9,
        Sky: {
            Kind: "room",
            Walls: [0.06, 0.063, 0.07],
            Floor: [0.035, 0.035, 0.038],
            Ceiling: [0.1, 0.1, 0.11],
            Panels: [
                Panel(34, 42, 52, 46, 6.5, [1, 0.98, 0.95], 0.3),
                Panel(251, 18, 74, 40, 1.9, [0.86, 0.9, 1], 0.45),
                Panel(155, 34, 30, 62, 3.2, [0.95, 0.97, 1], 0.28),
            ],
            Grade: 0.06,
        },
        Sun: { On: false, Elevation: 42, Swing: 34, Strength: 3.4, Warmth: 5600, Size: 2 },
    },
    {
        Identifier: "cyclorama",
        Label: "Cyclorama",
        Note: "White seamless, two big heads",
        Zenith: [0.78, 0.79, 0.82],
        Horizon: [0.7, 0.71, 0.74],
        Ground: [0.42, 0.42, 0.44],
        Key: 5.2,
        Fill: 3.4,
        Rim: 1.4,
        Scale: 7,
        Sky: {
            Kind: "room",
            Walls: [0.52, 0.53, 0.56],
            Floor: [0.3, 0.3, 0.32],
            Ceiling: [0.66, 0.67, 0.7],
            Panels: [
                Panel(38, 34, 86, 60, 4.6, [1, 0.99, 0.97], 0.5),
                Panel(300, 26, 78, 52, 2.6, [0.97, 0.98, 1], 0.55),
            ],
            Grade: 0.02,
        },
        Sun: { On: false, Elevation: 38, Swing: 38, Strength: 2.2, Warmth: 6000, Size: 3 },
    },
    {
        Identifier: "daylight",
        Label: "Clear day",
        Note: "Blue sky, hard sun, a little cumulus",
        Zenith: [0.17, 0.3, 0.62],
        Horizon: [0.62, 0.72, 0.86],
        Ground: [0.14, 0.13, 0.11],
        Key: 8.5,
        Fill: 1.8,
        Rim: 1.5,
        Scale: 12,
        Sky: {
            Kind: "sky",
            Upper: [0.13, 0.28, 0.72],
            Lower: [0.7, 0.8, 0.95],
            Floor: [0.11, 0.105, 0.09],
            Clouds: { Cover: 0.42, Scale: 2.6, Sharpness: 0.62, Tint: [1, 1, 1], Drift: 0.3 },
            Haze: 0.35,
            Grade: 0.05,
        },
        Sun: { On: true, Elevation: 54, Swing: 40, Strength: 9, Warmth: 5800, Size: 1.4 },
    },
    {
        Identifier: "sunset",
        Label: "Sunset",
        Note: "Low sun, long haze, banded cloud",
        Zenith: [0.14, 0.18, 0.38],
        Horizon: [0.82, 0.44, 0.21],
        Ground: [0.08, 0.06, 0.05],
        Key: 9.0,
        Fill: 0.9,
        Rim: 1.6,
        Scale: 14,
        Sky: {
            Kind: "sky",
            Upper: [0.08, 0.12, 0.33],
            Lower: [0.95, 0.47, 0.2],
            Floor: [0.06, 0.05, 0.045],
            Clouds: { Cover: 0.55, Scale: 1.7, Sharpness: 0.5, Tint: [1, 0.62, 0.42], Drift: 0.75 },
            Haze: 0.72,
            Grade: 0.08,
        },
        Sun: { On: true, Elevation: 7, Swing: 24, Strength: 7.5, Warmth: 2400, Size: 2.6 },
    },
    {
        Identifier: "overcast",
        Label: "Overcast",
        Note: "One big soft box, the whole sky",
        Zenith: [0.62, 0.65, 0.7],
        Horizon: [0.5, 0.52, 0.56],
        Ground: [0.13, 0.13, 0.14],
        Key: 2.2,
        Fill: 2.0,
        Rim: 1.2,
        Scale: 4,
        Sky: {
            Kind: "sky",
            Upper: [0.62, 0.65, 0.71],
            Lower: [0.48, 0.5, 0.54],
            Floor: [0.1, 0.1, 0.105],
            Clouds: { Cover: 0.9, Scale: 1.1, Sharpness: 0.2, Tint: [0.84, 0.86, 0.9], Drift: 0.2 },
            Haze: 0.5,
            Grade: 0.03,
        },
        Sun: { On: false, Elevation: 60, Swing: 120, Strength: 1.2, Warmth: 6800, Size: 12 },
    },
    {
        Identifier: "forest",
        Label: "Forest floor",
        Note: "Dappled canopy, green bounce",
        Zenith: [0.18, 0.26, 0.14],
        Horizon: [0.2, 0.24, 0.16],
        Ground: [0.09, 0.08, 0.05],
        Key: 4.5,
        Fill: 1.4,
        Rim: 2.0,
        Scale: 10,
        Sky: {
            Kind: "canopy",
            Leaf: [0.08, 0.14, 0.05],
            Gap: [1, 0.96, 0.78],
            Floor: [0.075, 0.065, 0.04],
            Density: 0.62,
            Scale: 5.5,
            Grade: 0.1,
        },
        Sun: { On: true, Elevation: 68, Swing: 300, Strength: 6, Warmth: 5200, Size: 1.8 },
    },
    {
        Identifier: "workshop",
        Label: "Night shop",
        Note: "Strip lights overhead, an open door",
        Zenith: [0.06, 0.07, 0.09],
        Horizon: [0.1, 0.1, 0.12],
        Ground: [0.03, 0.03, 0.035],
        Key: 12.0,
        Fill: 0.5,
        Rim: 3.2,
        Scale: 16,
        Sky: {
            Kind: "room",
            Walls: [0.028, 0.03, 0.036],
            Floor: [0.016, 0.016, 0.018],
            Ceiling: [0.04, 0.042, 0.05],
            Panels: [
                // Two tubes across the ceiling and a doorway standing open on the cold side of the room.
                Panel(20, 64, 150, 9, 9, [1, 0.97, 0.88], 0.12),
                Panel(200, 64, 150, 9, 9, [1, 0.97, 0.88], 0.12),
                Panel(96, 6, 13, 30, 5.5, [0.6, 0.78, 1], 0.2),
            ],
            Grade: 0.12,
        },
        Sun: { On: false, Elevation: 20, Swing: 96, Strength: 2, Warmth: 7200, Size: 4 },
    },
    {
        Identifier: "cityglow",
        Label: "City glow",
        Note: "Sodium haze, a grid of windows, stars",
        Zenith: [0.03, 0.04, 0.07],
        Horizon: [0.22, 0.14, 0.09],
        Ground: [0.025, 0.024, 0.026],
        Key: 5.5,
        Fill: 1.1,
        Rim: 3.6,
        Scale: 8,
        Sky: {
            Kind: "city",
            Upper: [0.02, 0.028, 0.055],
            Lower: [0.3, 0.17, 0.08],
            Floor: [0.02, 0.019, 0.02],
            Windows: { Rows: 26, Columns: 150, Chance: 0.17, Strength: 3.2, Tint: [1, 0.86, 0.6] },
            Stars: 0.55,
            Grade: 0.14,
        },
        Sun: { On: false, Elevation: 12, Swing: 210, Strength: 1.4, Warmth: 3000, Size: 3 },
    },
    {
        Identifier: "nebula",
        Label: "Nebula",
        Note: "Deep space, two colours and a lot of stars",
        Zenith: [0.04, 0.05, 0.1],
        Horizon: [0.09, 0.05, 0.14],
        Ground: [0.02, 0.02, 0.04],
        Key: 4.0,
        Fill: 1.2,
        Rim: 3.0,
        Scale: 6,
        Sky: {
            Kind: "nebula",
            Deep: [0.012, 0.014, 0.03],
            Warm: [0.85, 0.22, 0.42],
            Cool: [0.16, 0.42, 0.95],
            Scale: 1.9,
            Density: 0.55,
            Stars: 1,
            Grade: 0.2,
        },
        Sun: { On: true, Elevation: 16, Swing: 140, Strength: 5.5, Warmth: 9500, Size: 1 },
    },
];

export const EnvironmentByIdentifier = Object.fromEntries(
    EnvironmentOrdering.map((Environment) => [Environment.Identifier, Environment]),
);

export const EnvironmentIndex = (Identifier) =>
    Math.max(
        0,
        EnvironmentOrdering.findIndex((Environment) => Environment.Identifier === Identifier),
    );

//--------------------------------------------------------------------------------------------------------------------------
// The sun. One light that is not part of the rig: it has an angular size, it draws a disc in the sky it lights, and it
// is the only light in the editor a person can switch off and still see where it was.
//
// 🔴 Swing is measured from the environment's rotation, exactly like the rig's lights, so turning the sky turns the
//    sun with it. A sun that stayed put while its own glow rotated away from it would be a bug nobody could name.
//--------------------------------------------------------------------------------------------------------------------------
export const SunDefaults = (Identifier = "studio") => ({
    ...(EnvironmentByIdentifier[Identifier] || EnvironmentOrdering[0]).Sun,
});

export const SanitiseSun = (Candidate, Identifier = "studio") =>
{
    const Written = SunDefaults(Identifier);
    if (!Candidate || typeof Candidate !== "object") return Written;
    return {
        On: Candidate.On !== undefined ? Boolean(Candidate.On) : Written.On,
        Elevation: Clamp(Candidate.Elevation ?? Written.Elevation, -20, 90),
        Swing: Clamp(Candidate.Swing ?? Written.Swing, 0, 360),
        Strength: Clamp(Candidate.Strength ?? Written.Strength, 0, 24),
        Warmth: Clamp(Candidate.Warmth ?? Written.Warmth, 1500, 12000),
        Size: Clamp(Candidate.Size ?? Written.Size, 0.25, 20),
    };
};

//--------------------------------------------------------------------------------------------------------------------------
// Colour temperature, as a renderer wants it: a unit-ish RGB that goes amber at two thousand Kelvin and blue at ten.
// An approximation of the Planckian locus, which is all a viewport has ever needed from one.
//--------------------------------------------------------------------------------------------------------------------------
export const WarmthColour = (Kelvin) =>
{
    const Temperature = Clamp(Kelvin, 1500, 12000) / 100;
    let Red;
    let Green;
    let Blue;
    if (Temperature <= 66)
    {
        Red = 255;
        Green = 99.4708025861 * Math.log(Temperature) - 161.1195681661;
        Blue = Temperature <= 19 ? 0 : 138.5177312231 * Math.log(Temperature - 10) - 305.0447927307;
    }
    else
    {
        Red = 329.698727446 * (Temperature - 60) ** -0.1332047592;
        Green = 288.1221695283 * (Temperature - 60) ** -0.0755148492;
        Blue = 255;
    }
    const Colour = [Red, Green, Blue].map((Part) => Clamp(Part / 255, 0, 1));
    // Normalised on the green, so turning the warmth down does not turn the light down with it.
    const Scale = 1 / Math.max(0.2, Colour[1]);
    return Colour.map((Part) => Clamp(Part * Scale, 0, 2));
};

// The sun as the shading pass wants it: a unit direction, a radiance, and the cosine of its angular radius. Size is in
// degrees across, so the real sun is about half a degree and everything above two is a sun through something.
export const SunVector = (Sun, Rotation = 0) =>
{
    const Settled = SanitiseSun(Sun);
    const Swing = ((Settled.Swing + Rotation) * Math.PI) / 180;
    const Rise = (Settled.Elevation * Math.PI) / 180;
    const Flat = Math.cos(Rise);
    const Tint = WarmthColour(Settled.Warmth);
    const Strength = Settled.On ? Settled.Strength : 0;
    const Radius = (Settled.Size * 0.5 * Math.PI) / 180;
    return {
        Direction: [Math.sin(Swing) * Flat, Math.sin(Rise), Math.cos(Swing) * Flat],
        Radiance: Tint.map((Part) => Part * Strength),
        // A disc of a fixed brightness gets dimmer as it gets bigger, the way a real one would if you could resize it.
        Disc: Tint.map((Part) => (Part * Strength) / Math.max(0.02, (Settled.Size / 2) ** 2)),
        Cosine: Math.cos(Radius),
        Radius,
        On: Settled.On,
    };
};

//--------------------------------------------------------------------------------------------------------------------------
// The rig. Three lights hang in front of the environment, and until the painter touches one they are whatever the
// environment says they are: the preset's own key, fill and rim strengths, at the angles the viewport has always used.
//
// 🔴 Three, and not a number the painter chooses. The shading pass carries three directions and three radiances, so a
//    fourth light would be a shader with nowhere to put it — and a rig that silently dropped the light you just added
//    would be worse than one that says plainly how many it holds. The sun is not one of the three; it is its own
//    uniform, because it also has to be drawn.
//--------------------------------------------------------------------------------------------------------------------------
export const LightOrdering = [
    { Identifier: "key", Label: "Key", Reads: "Key", Swing: 34, Elevation: 49, Tint: [1, 0.97, 0.92], Note: "The light that shapes it" },
    { Identifier: "fill", Label: "Fill", Reads: "Fill", Swing: 251, Elevation: 15, Tint: [0.82, 0.88, 1], Note: "Opens the shadow side" },
    { Identifier: "rim", Label: "Rim", Reads: "Rim", Swing: 155, Elevation: 31, Tint: [0.92, 0.95, 1], Note: "Draws the edge away from the background" },
];

export const DefaultLights = (Identifier) =>
{
    const Preset = EnvironmentByIdentifier[Identifier] || EnvironmentOrdering[0];
    return LightOrdering.map((Light) => ({
        Identifier: Light.Identifier,
        On: true,
        Strength: Number((Preset[Light.Reads] ?? 1).toFixed(2)),
        Swing: Light.Swing,
        Elevation: Light.Elevation,
    }));
};

// One light as the shading pass wants it: a unit direction and a tinted radiance, with an unlit light simply black.
export const LightVector = (Light, Index, Rotation) =>
{
    const Order = LightOrdering[Index] || LightOrdering[0];
    const Swing = (((Light?.Swing ?? Order.Swing) + Rotation) * Math.PI) / 180;
    const Rise = ((Light?.Elevation ?? Order.Elevation) * Math.PI) / 180;
    const Flat = Math.cos(Rise);
    const Strength = Light?.On === false ? 0 : Math.max(Light?.Strength ?? 0, 0);
    return {
        Direction: [Math.sin(Swing) * Flat, Math.sin(Rise), Math.cos(Swing) * Flat],
        Radiance: Order.Tint.map((Part) => Part * Strength),
    };
};
