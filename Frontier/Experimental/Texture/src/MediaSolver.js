//============================================================================================================================================
// 🧪 MediaSolver.js — how each medium lays down: bristle combs, paper tooth, ink bleed, felt streaks, dust and wax skip
//============================================================================================================================================
// One model, written twice. `Deposit` below is the JavaScript reading of it and `MediaChunk` in ShadingGlsl.js is the
// GLSL reading, line for line and constant for constant. The card's ribbon runs the first so the preview is the paint,
// not a drawing of it; the stamping pass runs the second. When one changes the other must follow — the unit tests pin
// the numbers the two must agree on.
//
// Nothing here samples a texture. A bristle gap is a lane index, paper tooth is value noise read at a world position,
// a dust speck is a texel hash: the mark is computed where it lands, so it stays sharp at any resolution, never tiles,
// and the same patch of surface always has the same tooth no matter which direction the stroke crossed it.
//
// Coordinates the model works in:
//   Across — signed distance from the stroke's centreline, in radii: ±1 is the nominal rim.
//   Along  — distance travelled along the stroke so far, in metres: this is what dries a brush out.
//   Press  — 0..1 pressure at this point of the stroke, already tapered and smoothed by StrokeProjection.
//   Tooth / Fibre / Speck — three 0..1 fields: surface-anchored paper grain, along-stroke streaking, per-texel hash.
//============================================================================================================================================

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));
const Mix = (Low, High, Amount) => Low + (High - Low) * Amount;

// The same curve GLSL's smoothstep walks, so a preview pixel and a texel agree to the last decimal.
const Smoothstep = (Edge0, Edge1, Value) =>
{
    const Span = Edge1 - Edge0;
    if (Math.abs(Span) < 1e-9) return Value < Edge0 ? 0 : 1;
    const Local = Clamp((Value - Edge0) / Span, 0, 1);
    return Local * Local * (3 - 2 * Local);
};

const Fract = (Value) => Value - Math.floor(Value);

// Hash11 from the shader's noise chunk, to the bit where it matters: a bristle picked here is the bristle picked there.
export const Hash11 = (Seed) => Fract(Math.sin(Seed * 127.1) * 43758.5453123);

export const Hash21 = (X, Y) => Fract(Math.sin(X * 127.1 + Y * 311.7) * 43758.5453123);

// Value noise with the shader's smoothstep interpolation — the preview's paper and the surface's paper are one paper.
export const ValueNoise = (X, Y) =>
{
    const CellX = Math.floor(X);
    const CellY = Math.floor(Y);
    const LocalX = X - CellX;
    const LocalY = Y - CellY;
    const SmoothX = LocalX * LocalX * (3 - 2 * LocalX);
    const SmoothY = LocalY * LocalY * (3 - 2 * LocalY);
    const A = Hash21(CellX, CellY);
    const B = Hash21(CellX + 1, CellY);
    const C = Hash21(CellX, CellY + 1);
    const D = Hash21(CellX + 1, CellY + 1);
    return Mix(Mix(A, B, SmoothX), Mix(C, D, SmoothX), SmoothY);
};

// Two octaves is all paper needs: a coarse weave and the fibres sitting on it.
export const ToothField = (X, Y) => ValueNoise(X, Y) * 0.65 + ValueNoise(X * 2.17 + 11.3, Y * 2.17 - 7.1) * 0.35;

//--------------------------------------------------------------------------------------------------------------------------
// The media.
//
// 📝 `plain` is the brush the editor starts with and the one the eraser always uses. It is the soft round dab the pass
//    drew before any of this existed, kept as medium zero so an untouched project paints exactly as it used to and an
//    unset uniform cannot accidentally mean "charcoal".
//--------------------------------------------------------------------------------------------------------------------------
export const MediumOrdering = [
    { Identifier: "plain", Index: 0, Label: "Plain", Note: "A soft round dab" },
    { Identifier: "brush", Index: 1, Label: "Bristle", Note: "Hairs comb the paint into lanes and run dry" },
    { Identifier: "pencil", Index: 2, Label: "Graphite", Note: "Lead only reaches the peaks of the paper" },
    { Identifier: "pen", Index: 3, Label: "Ink", Note: "A hard wet edge that creeps into the fibres" },
    { Identifier: "marker", Index: 4, Label: "Felt", Note: "Flat colour, streaked, pooling at the rim" },
    { Identifier: "dry", Index: 5, Label: "Dry pigment", Note: "Crushed into the tooth, shedding dust" },
    { Identifier: "wax", Index: 6, Label: "Wax", Note: "Skips the valleys until it is pushed hard enough" },
];

export const MediumIndex = Object.fromEntries(MediumOrdering.map((Entry) => [Entry.Identifier, Entry.Index]));

export const MediumByIndex = Object.fromEntries(MediumOrdering.map((Entry) => [Entry.Index, Entry]));

//--------------------------------------------------------------------------------------------------------------------------
// A profile is the whole of what a medium needs, in the units the model works in. Every field is finite, clamped, and
// safe to hand straight to a uniform.
//--------------------------------------------------------------------------------------------------------------------------
export const PlainMedia = {
    Medium: "plain",
    Index: 0,
    Grain: 0,          // [-]   how much of the mark the paper tooth gets to decide
    Tooth: 0,          // [1/m] tooth frequency in cycles per metre of surface
    Scatter: 0,        // [-]   dust shed outside the body of the mark
    Bleed: 0,          // [-]   how far wet ink creeps past the rim
    Bristles: 0,       // [#]   hairs across the head
    Splay: 0,          // [-]   how much the head fans out under pressure
    Swell: 0,          // [-]   how much of the width follows pressure
    Wetness: 0,        // [-]   water in the head: closes the comb, pools at the rim
    Darkness: 1,       // [-]   pigment strength of the grade in hand
    Tilt: 0,           // [-]   laying the stick over: wider, lighter
    Melt: 0,           // [-]   wax pushed into the valleys
    Dry: 0,            // [-]   how much of the load is gone by the end of `Reach`
    Reach: 1,          // [m]   how far one load of the head carries
    Fibre: 0,          // [1/m] along-stroke streak frequency
    Ratio: 1,          // [-]   narrow side of the nib over the wide side
    Angle: 0,          // [rad] which way the nib is held, in the surface frame
    Taper: 0,          // [-]   entry ramp and speed thinning
    Pressure: false,   // [-]   whether the stroke is pressure driven at all
    Smoothing: 0,      // [-]   how far the mark lags the pointer
    Seed: 0,           // [-]   per-instrument constant: two brushes are not the same brush
};

const Seeded = (Key) =>
{
    let Total = 0;
    for (let Index = 0; Index < Key.length; Index += 1) Total = (Total * 31 + Key.charCodeAt(Index)) % 9973;
    return Total / 9973;
};

// Lead grades, in the only terms the model cares about: how black the pigment is and how willingly it leaves the stick.
const GradeDarkness = { "2H": 0.42, HB: 0.68, "2B": 0.9, "6B": 1.15 };

// The narrow side of a nib over its wide side. A round head is 1 — it draws the same width whichever way it moves.
const HeadRatio = { Round: 1, Filbert: 0.74, Flat: 0.38, Fan: 0.92 };
const NibRatio = { Fine: 0.92, Chisel: 0.3, Broad: 0.34 };
const PenRatio = { tube: 1, ball: 1, fountain: 0.62, chisel: 0.2 };
const StickRatio = { square: 0.56, round: 1 };
const WaxRatio = { crayon: 0.88, oil: 0.78, china: 1 };

// Hairs across the head, before pressure splays them.
const HeadBristles = { Round: 15, Filbert: 18, Flat: 24, Fan: 11 };

const Percent = (Value, Fallback = 0) => Clamp((Value ?? Fallback) / 100, 0, 1);

//--------------------------------------------------------------------------------------------------------------------------
// Instrument → medium. The card's settings are percentages a painter understands; this is the one place they become the
// physical numbers the model needs, so there is a single answer to "what does Wetness 70 actually do".
//--------------------------------------------------------------------------------------------------------------------------
export const MediaFromInstrument = (Type, Settings) =>
{
    const Base = {
        ...PlainMedia,
        Medium: Type.Family,
        Index: MediumIndex[Type.Family] ?? 0,
        Grain: Percent(Settings.Grain),
        Scatter: Percent(Settings.Scatter),
        Bleed: Percent(Settings.Bleed),
        Wetness: Percent(Settings.Wetness),
        Tilt: Settings.Pressure ? Percent(Settings.Tilt) : 0,
        Melt: Percent(Settings.Melt),
        // 🔴 An instrument with no Taper control still gets an entry ramp. Every hand-made mark starts light — a
        //    stroke that arrives at full width is the single clearest tell that nothing drew it — so the schemas
        //    without the control inherit a quarter ramp rather than none at all.
        Taper: Settings.Pressure !== true ? 0 : Settings.Taper === undefined ? 0.25 : Percent(Settings.Taper),
        Pressure: Settings.Pressure === true,
        Smoothing: Percent(Settings.Smoothing),
        Angle: (-35 * Math.PI) / 180,
        Seed: Seeded(Type.Key),
    };
    const Art = Type.Art || {};
    const Size = Clamp((Settings.Size ?? 4) / 100, 0.004, 0.6);

    if (Type.Family === "brush")
    {
        const Head = Settings.Head || "Round";
        return {
            ...Base,
            Tooth: 150,
            Fibre: 190,
            Bristles: HeadBristles[Head] ?? 15,
            Splay: Head === "Fan" ? 0.85 : Head === "Flat" ? 0.22 : 0.4,
            Swell: 0.62,
            Ratio: HeadRatio[Head] ?? 1,
            // A loaded brush carries further than a dry one, and a big head carries further than a small one.
            Dry: Clamp(0.72 - 0.55 * Base.Wetness, 0.1, 0.8),
            Reach: Size * Mix(6, 30, Base.Wetness),
            Grain: Mix(0.55, 0.12, Base.Wetness),
        };
    }

    if (Type.Family === "pencil")
    {
        return {
            ...Base,
            Tooth: 330,
            Fibre: 420,
            Swell: 0.18,
            Darkness: GradeDarkness[Settings.Grade] ?? 0.7,
            Ratio: Art.Clutch ? 1 : 0.9,
            Dry: 0.08,
            Reach: Size * 90,
        };
    }

    if (Type.Family === "pen")
    {
        return {
            ...Base,
            Tooth: 260,
            Fibre: 520,
            Swell: Art.Nib === "fountain" ? 0.42 : Art.Nib === "ball" ? 0.12 : 0.06,
            Ratio: PenRatio[Art.Nib] ?? 1,
            Darkness: 1,
            // A ballpoint skips when it is dragged fast; a fineliner never does.
            Dry: Art.Nib === "ball" ? 0.22 : 0.04,
            Reach: Size * 120,
            Grain: Art.Nib === "ball" ? 0.35 : 0.1,
        };
    }

    if (Type.Family === "marker")
    {
        const Nib = Settings.Nib || "Fine";
        return {
            ...Base,
            Tooth: 170,
            Fibre: 230,
            Swell: Art.Nib === "taper" ? 0.55 : 0.12,
            Ratio: Art.Nib === "chisel" ? 0.3 : Art.Nib === "broad" ? 0.34 : (NibRatio[Nib] ?? 0.92),
            Darkness: 1,
            Dry: 0.12,
            Reach: Size * 60,
            Grain: 0.22,
        };
    }

    if (Type.Family === "dry")
    {
        return {
            ...Base,
            Tooth: 210,
            Fibre: 260,
            Swell: 0.3,
            Ratio: StickRatio[Art.Section] ?? 0.8,
            Darkness: Art.Pigment === "charcoal" ? 1.1 : Art.Pigment === "conte" ? 0.95 : 0.85,
            Dry: 0.34,
            Reach: Size * 14,
        };
    }

    if (Type.Family === "wax")
    {
        return {
            ...Base,
            Tooth: 240,
            Fibre: 300,
            Swell: 0.16,
            Ratio: WaxRatio[Art.Pigment] ?? 0.9,
            Darkness: 1,
            Dry: 0.16,
            Reach: Size * 25,
        };
    }

    return { ...Base, Medium: "plain", Index: 0 };
};

//--------------------------------------------------------------------------------------------------------------------------
// Uniform packing. Four vec4s and an int, in the order ShadingGlsl.js unpacks them.
//
// 🔴 `Scale` converts cycles per metre into cycles per whatever the pass is measuring in. Surface strokes measure in
//    metres and pass 1; the flattened plane measures in UV, so it passes the surface's span and the paper comes out the
//    same size in both views. Without it the plane's tooth would be hundreds of times too fine to see.
//--------------------------------------------------------------------------------------------------------------------------
export const MediaUniforms = (Profile, Scale = 1) =>
{
    const Media = Profile || PlainMedia;
    return {
        Medium: Media.Index | 0,
        A: [Media.Grain, Media.Tooth * Scale, Media.Scatter, Media.Bleed],
        B: [Media.Bristles, Media.Splay, Media.Swell, Media.Wetness],
        C: [Media.Darkness, Media.Tilt, Media.Melt, Media.Seed],
        // Frequencies are cycles per metre and multiply by the scale; a reach is metres and divides by it.
        D: [Media.Dry, Math.max(Media.Reach / Math.max(Scale, 1e-6), 1e-4), Media.Fibre * Scale, Media.Ratio],
    };
};

// How far past the nominal rim this medium can still put pigment: dust, bleed and a laid-over lead all reach further
// than the mark itself, and whoever is walking texels has to keep those alive long enough to ask.
export const MediaExtent = (Profile) =>
{
    const Media = Profile || PlainMedia;
    if (Media.Index === 2) return 1 + 1.3 * Media.Tilt;
    if (Media.Index === 3) return 1 + 1.8 * Media.Bleed;
    if (Media.Index === 4) return 1 + 1.5 * Media.Bleed;
    if (Media.Index === 5) return 1 + 1.6 * Media.Scatter;
    return 1;
};

//--------------------------------------------------------------------------------------------------------------------------
// How wide the mark is for the direction it is being dragged in.
//
// A chisel nib dragged across its edge is as wide as the nib; dragged along it, as thin as its waist. The whole of
// calligraphy is in that one number, and it is computed per segment rather than per texel because a segment only ever
// has one direction.
//--------------------------------------------------------------------------------------------------------------------------
export const MediaWidth = (Profile, Turn) =>
{
    const Media = Profile || PlainMedia;
    if (!Number.isFinite(Turn) || Media.Ratio >= 0.999) return 1;
    const Swing = Math.abs(Math.sin(Turn - Media.Angle));
    return Mix(Media.Ratio, 1, Swing);
};

//--------------------------------------------------------------------------------------------------------------------------
// The model itself.
//
// Returns the share of the texel the medium covers and the shade it covers it with: 1 is the colour in hand, below 1 is
// pigment piling into a valley or pooling at a wet rim, above 1 is wax catching the light. Shade is what stops a stroke
// reading as a decal of flat colour — real media are never one value all the way across.
//--------------------------------------------------------------------------------------------------------------------------
export const Deposit = (Profile, Sample) =>
{
    const Media = Profile || PlainMedia;
    const Across = Sample.Across;
    const Rim = Math.abs(Across);
    const Press = Clamp(Sample.Press ?? 1, 0, 1);
    const Hardness = Clamp(Sample.Hardness ?? 0.5, 0, 1);
    const Tooth = Clamp(Sample.Tooth ?? 0.5, 0, 1);
    const Fibre = Clamp(Sample.Fibre ?? 0.5, 0, 1);
    const Speck = Clamp(Sample.Speck ?? 0, 0, 1);
    const Along = Math.max(Sample.Along ?? 0, 0);
    const Load = 1 - Media.Dry * Clamp(Along / Math.max(Media.Reach, 1e-3), 0, 1);

    const Body = (Edge) => 1 - Smoothstep(Mix(0, 0.96, Edge), 1, Rim);

    if (Media.Index === 1)
    {
        // Bristle. The head is a row of hairs; each lays its own ridge and the gaps between them are the drag marks a
        // brush leaves. Water closes those gaps, which is why a wash reads flat and a dry brush reads like straw.
        const Lanes = Math.max(Media.Bristles * (1 + 0.45 * Media.Splay * Press), 3);
        const Lane = (Across * 0.5 + 0.5) * Lanes;
        const Cell = Math.floor(Lane);
        const Within = Lane - Cell;
        const Pick = Hash11(Cell * 1.73 + Media.Seed * 7);
        // 🔴 Hairs are not a comb. Each one sits off-centre in its lane and is its own thickness, or the mark reads as
        //    corduroy — evenly ruled lines is the one thing a brush never leaves behind.
        const Shift = Hash11(Cell * 3.11 + Media.Seed * 13) * 0.5 - 0.25;
        const Thin = Mix(0.1, 0.44, Hash11(Cell * 5.37 + Media.Seed * 3));
        const Edge = Clamp(Within - Shift, 0, 1);
        const Ridge = Smoothstep(0, Thin, Edge) * Smoothstep(1, 1 - Thin, Edge);
        const Comb = Mix(Mix(0.25, 1, Pick) * Ridge, 1, Clamp(Media.Wetness * 0.9, 0, 0.9));
        const Streak = Mix(1, 0.45 + 0.55 * Fibre, (1 - Media.Wetness) * 0.75);
        const Alpha = Body(Hardness * Mix(0.75, 1, Press)) * Mix(Comb, 1, 0.12) * Streak * Load * Mix(0.45, 1, Press);
        const Shade = 1 - 0.18 * Media.Wetness * Smoothstep(0.5, 1, Rim) + 0.04 * (1 - Press);
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    if (Media.Index === 2)
    {
        // Graphite. Lead cannot reach into a valley of the paper, so the tooth decides where the mark is; pressure and
        // grade decide how far down the sides of those valleys it gets.
        const Spread = 1 + 1.3 * Media.Tilt;
        const Reach = 1 - Smoothstep(Mix(0.25, 0.9, Hardness) * Spread, 1 * Spread, Rim);
        const Bite = Clamp(Press * Media.Darkness * Mix(1, 0.55, Media.Tilt), 0, 1);
        const Cover = Clamp(Bite * Mix(0.55, 1, Reach), 0, 1);
        const Gate = Smoothstep(1 - Cover - 0.28, 1 - Cover + 0.24, Tooth + 0.16 * Fibre - 0.08);
        const Alpha = Reach * Mix(Cover, Gate, Media.Grain);
        const Shade = Mix(1.02, 0.8, Clamp(Cover * 0.6 + 0.4 * Tooth, 0, 1));
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    if (Media.Index === 3)
    {
        // Ink. A hard wet edge, and past it the fibres of the paper drinking what the nib left behind.
        const Core = 1 - Smoothstep(Mix(0.6, 0.94, Hardness), 1, Rim);
        const Halo = (1 - Smoothstep(1, 1 + 1.8 * Media.Bleed, Rim)) * Media.Bleed * (0.18 + 0.5 * Fibre);
        const Skip = Mix(1, 0.55 + 0.45 * Fibre, Media.Grain) * Load;
        const Alpha = Clamp(Core * Skip + Halo * (1 - Core), 0, 1) * Mix(0.82, 1, Press);
        const Shade = Mix(1, 0.94, Halo);
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    if (Media.Index === 4)
    {
        // Felt. Flat colour laid by a bundle of fibres, with solvent pushing a darker rim out to the edge of the mark —
        // the wet edge every marker drawing has and no flat-colour brush ever produces.
        const Core = 1 - Smoothstep(Mix(0.55, 0.92, Hardness), 1, Rim);
        const Streak = Mix(1, 0.72 + 0.28 * Fibre, 0.55);
        const Halo = (1 - Smoothstep(1, 1 + 1.5 * Media.Bleed, Rim)) * Media.Bleed * 0.55;
        const Alpha = Clamp(Core * Streak * Load + Halo * (1 - Core), 0, 1);
        const Rimness = Smoothstep(0.45, 0.95, Rim) * Core;
        const Shade = Mix(1, 0.8, Rimness * Mix(0.4, 1, Media.Bleed));
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    if (Media.Index === 5)
    {
        // Dry pigment. The tooth again, but coarser and with nothing holding the pigment together, so it sheds: specks
        // land outside the mark and the edge of a chalk line is never a line.
        const Reach = 1 - Smoothstep(Mix(0.2, 0.85, Hardness), 1, Rim);
        const Cover = Clamp(Press * Media.Darkness * Reach, 0, 1);
        const Gate = Smoothstep(1 - Cover - 0.38, 1 - Cover + 0.3, Tooth);
        const Dust =
            (Speck > 1 - 0.1 * Media.Scatter ? 1 : 0) *
            (1 - Smoothstep(0.8, 1 + 1.6 * Media.Scatter, Rim)) *
            (0.35 + 0.5 * Press);
        const Alpha = Math.max(Reach * Mix(Cover, Gate, Media.Grain) * Load, Dust);
        const Shade = Mix(1.05, 0.82, Cover);
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    if (Media.Index === 6)
    {
        // Wax. Stiff enough to bridge the valleys instead of filling them, until the heat of a hard stroke melts it in.
        const Reach = 1 - Smoothstep(Mix(0.45, 0.92, Hardness), 1, Rim);
        const Cover = Clamp(Press * 1.05, 0, 1);
        // 🔴 The threshold never reaches zero: wax bridges the valleys of the paper however hard it is pushed, and a
        //    crayon line that fills in completely at full pressure is a felt pen with a different label.
        const Ridge = 0.3 + 0.55 * (1 - Cover);
        const Gate = Smoothstep(Ridge - 0.16, Ridge + 0.14, Tooth);
        const Filled = Mix(Gate, 1, Clamp(Media.Melt * Press * 1.3, 0, 1));
        const Alpha = Reach * Mix(Cover, Filled, Media.Grain) * Load;
        const Shade = Mix(1, 1.07, Media.Melt * 0.6 * Alpha);
        return { Alpha: Clamp(Alpha, 0, 1), Shade: Clamp(Shade, 0.7, 1.08) };
    }

    return { Alpha: Clamp(1 - Smoothstep(Mix(0, 0.94, Hardness), 1, Rim), 0, 1), Shade: 1 };
};

// A line for the heads-up display: what is in hand, in the words a painter would use.
export const MediaSummary = (Profile) =>
{
    const Media = Profile || PlainMedia;
    const Entry = MediumByIndex[Media.Index] || MediumOrdering[0];
    const Parts = [Entry.Label.toLowerCase()];
    if (Media.Index === 1) Parts.push(`${Math.round(Media.Bristles)} hairs`, `wet ${Math.round(Media.Wetness * 100)}%`);
    if (Media.Index === 2 || Media.Index === 5 || Media.Index === 6) Parts.push(`tooth ${Math.round(Media.Grain * 100)}%`);
    if (Media.Index === 3 || Media.Index === 4) Parts.push(`bleed ${Math.round(Media.Bleed * 100)}%`);
    if (Media.Ratio < 0.999) Parts.push(`nib ${Math.round(Media.Ratio * 100)}%`);
    if (Media.Pressure) Parts.push("pressure");
    return Parts.join(" · ");
};
