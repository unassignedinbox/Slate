//============================================================================================================================================
// 🩶 ReadingSpecification.js — the maps a surface can be read into, and how finely to read them
//============================================================================================================================================
// Every painting tool worth using opens by reading the model: Substance calls them bakers, Unreal calls them bake maps,
// Blender calls them bake passes and hides two more of them — pointiness and the bevel node — inside the shader graph.
// They are all the same idea. Fire a question at the geometry once, keep the answer in texture space, and spend the rest
// of the session asking the texture instead of the triangles.
//
// This is the catalogue of the questions. What answers them is ReadingSolver.js; what spends them is the generator
// stack on a mask, the exporter, and the viewport.
//
// 🔴 Nothing here promises anything the geometry cannot answer. There is no high-poly to low-poly transfer in this
//    editor and no vertex colour attribute on the surface, so neither is offered — a map that bakes to a flat grey is
//    worse than a map that is not in the list, because somebody will spend an afternoon deciding it is their fault.
//============================================================================================================================================

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));

//--------------------------------------------------------------------------------------------------------------------------
// The spaces a direction can be written in. Tangent is the one a painting app wants — it survives the model being
// moved, and it is what the normal channel already means — but a lighting rig wants world and a transfer wants object.
//--------------------------------------------------------------------------------------------------------------------------
export const ReadingSpaces = [
    { Identifier: "tangent", Label: "Tangent", Hint: "Relative to the surface. Survives the model being moved or posed." },
    { Identifier: "object", Label: "Object", Hint: "The model's own axes, whatever the scene does with it." },
    { Identifier: "world", Label: "World", Hint: "Scene axes. What a lighting rig wants." },
];

//--------------------------------------------------------------------------------------------------------------------------
// What an identity map is identity of. Substance's ID map keyed on colour; the same idea answers to four questions here
// and the answer is always the same kind of thing — a flat colour per part, for a mask to key on.
//--------------------------------------------------------------------------------------------------------------------------
export const IdentityKinds = [
    { Identifier: "object", Label: "Object", Hint: "One colour per object in the scene." },
    { Identifier: "island", Label: "UV island", Hint: "One colour per shell of the unwrap." },
    { Identifier: "tile", Label: "UDIM tile", Hint: "One colour per tile." },
    { Identifier: "face", Label: "Face", Hint: "One colour per triangle. Dense, and useful for finding a seam." },
];

//--------------------------------------------------------------------------------------------------------------------------
// The maps. Family is what the question is about rather than where it came from; Heritage says which of the three
// editors ships it, because that is the whole of what "the bake channels Substance has" means in practice.
//--------------------------------------------------------------------------------------------------------------------------
export const ReadingOrdering = [
    {
        Identifier: "normal",
        Label: "Normal",
        Short: "Normal",
        Family: "direction",
        Glyph: "vector",
        Channels: 3,
        Spaced: true,
        Chosen: true,
        Heritage: "Substance · Unreal · Blender",
        Hint: "The surface's own shading normal. In tangent space a smoothed low-poly stops reading as flat.",
    },
    {
        Identifier: "bevel",
        Label: "Bevel normal",
        Short: "Bevel",
        Family: "direction",
        Glyph: "edge",
        Channels: 3,
        Spaced: true,
        Chosen: true,
        Rounded: true,
        Heritage: "Blender's bevel node",
        Hint: "Rounds an edge in the shading without rounding it in the geometry. A hard corner catches a highlight.",
    },
    {
        Identifier: "bent",
        Label: "Bent normal",
        Short: "Bent",
        Family: "direction",
        Glyph: "sun",
        Channels: 3,
        Spaced: true,
        Chosen: true,
        Rays: true,
        Heritage: "Substance · Unreal · Blender",
        Hint: "The direction the sky actually reaches this point from. Leans out of a corner the normal points into.",
    },
    {
        Identifier: "face",
        Label: "Face normal",
        Short: "Face",
        Family: "direction",
        Glyph: "facet",
        Channels: 3,
        Spaced: true,
        Heritage: "Unreal",
        Hint: "Flat, per triangle. What the geometry says before any smoothing is applied to it.",
    },
    {
        Identifier: "occlusion",
        Label: "Ambient occlusion",
        Short: "Occlusion",
        Family: "light",
        Glyph: "occlusion",
        Channels: 1,
        Chosen: true,
        Rays: true,
        Heritage: "Substance · Unreal · Blender",
        Hint: "How much of the sky each point can see. The shadow a shape casts on itself.",
    },
    {
        Identifier: "thickness",
        Label: "Thickness",
        Short: "Thickness",
        Family: "light",
        Glyph: "thickness",
        Channels: 1,
        Rays: true,
        Heritage: "Substance",
        Hint: "How much material stands behind each point. Thin walls light up; what subsurface and translucency want.",
    },
    {
        Identifier: "curvature",
        Label: "Curvature",
        Short: "Curvature",
        Family: "shape",
        Glyph: "edge",
        Channels: 1,
        Chosen: true,
        Heritage: "Substance · Blender's pointiness",
        Hint: "Convex white, concave black, flat grey. The one every edge-wear mask is built on.",
    },
    {
        Identifier: "cavity",
        Label: "Cavity",
        Short: "Cavity",
        Family: "shape",
        Glyph: "cavity",
        Channels: 1,
        Heritage: "Substance",
        Hint: "Curvature with only the creases kept, for grime and panel lines.",
    },
    {
        Identifier: "position",
        Label: "Position",
        Short: "Position",
        Family: "shape",
        Glyph: "axis",
        Channels: 3,
        Heritage: "Substance · Unreal · Blender",
        Hint: "Where each texel is in the model's bounds, as a colour. Drives anything that varies along an axis.",
    },
    {
        Identifier: "height",
        Label: "World height",
        Short: "Height",
        Family: "shape",
        Glyph: "height",
        Channels: 1,
        Heritage: "Substance · Unreal",
        Hint: "Altitude through the bounds, bottom black and top white.",
    },
    {
        Identifier: "coordinate",
        Label: "UV coordinate",
        Short: "UV",
        Family: "layout",
        Glyph: "grid",
        Channels: 3,
        Heritage: "Blender",
        Hint: "The unwrap as a colour. Red runs across, green runs up, and a twist in it is a twist in the unwrap.",
    },
    {
        Identifier: "identity",
        Label: "Identity",
        Short: "ID",
        Family: "layout",
        Glyph: "box",
        Channels: 3,
        Chosen: true,
        Keyed: true,
        Heritage: "Substance's ID map",
        Hint: "A flat colour per object, island, tile or face, for a mask to key on.",
    },
    {
        Identifier: "density",
        Label: "Texel density",
        Short: "Density",
        Family: "layout",
        Glyph: "ramp",
        Channels: 1,
        Heritage: "Unreal's texel density tool",
        Hint: "How much texture each part of the model is getting. Even grey is an even unwrap.",
    },
    {
        Identifier: "coverage",
        Label: "Coverage",
        Short: "Coverage",
        Family: "layout",
        Glyph: "mask",
        Channels: 1,
        Heritage: "Substance's opacity",
        Hint: "White where the unwrap lands and black where nothing does. The map that shows what padding is for.",
    },
];

export const ReadingByIdentifier = Object.fromEntries(ReadingOrdering.map((Entry) => [Entry.Identifier, Entry]));

export const ReadingFamilies = [
    { Identifier: "direction", Label: "Directions", Hint: "Which way the surface is facing, four ways of asking." },
    { Identifier: "light", Label: "Light", Hint: "What the shape does to light before any light is in the scene." },
    { Identifier: "shape", Label: "Shape", Hint: "The form itself, read as a value." },
    { Identifier: "layout", Label: "Layout", Hint: "The unwrap and what is on which part of it." },
];

//--------------------------------------------------------------------------------------------------------------------------
// Antialiasing. A bake is a point sample of a surface through a grid of texels, and a point sample of an edge is a
// staircase. The cure is the same one every renderer uses: take the question several times from slightly different
// places inside the texel and weigh the answers. How many places is Samples; how they are weighed is the filter.
//
// 📝 The samples reach beyond the texel for every filter but the box, which is what makes the choice worth having —
//    a box can only ever average what is inside one texel, and the wider kernels can see the edge coming.
//--------------------------------------------------------------------------------------------------------------------------
export const SampleCounts = [
    { Value: 1, Label: "Off", Hint: "One sample at the centre of each texel. Fastest, and stairs on every seam." },
    { Value: 4, Label: "2 × 2", Hint: "Four samples a texel. Enough for a preview." },
    { Value: 9, Label: "3 × 3", Hint: "Nine. The usual answer." },
    { Value: 16, Label: "4 × 4", Hint: "Sixteen. For a final bake on a hard-surface model." },
    { Value: 36, Label: "6 × 6", Hint: "Thirty-six, and slow. Only worth it on a thin diagonal seam." },
];

export const FilterKinds = [
    { Identifier: "box", Label: "Box", Radius: 0.5, Hint: "Everything inside the texel counts the same. No reach." },
    { Identifier: "tent", Label: "Tent", Radius: 1, Hint: "Linear falloff. Cheap and softer than a box." },
    { Identifier: "gaussian", Label: "Gaussian", Radius: 1, Hint: "The safe one. Soft, no ringing, slightly blurry." },
    { Identifier: "mitchell", Label: "Mitchell", Radius: 1.25, Hint: "Sharper than a Gaussian with very little overshoot." },
    { Identifier: "catmull", Label: "Catmull-Rom", Radius: 1.25, Hint: "Sharpest. Rings a little on a hard edge, which can read as crisper." },
    { Identifier: "blackman", Label: "Blackman-Harris", Radius: 1.25, Hint: "What Cycles reaches for. Wide, smooth, no ringing at all." },
];

export const FilterByIdentifier = Object.fromEntries(FilterKinds.map((Entry) => [Entry.Identifier, Entry]));

//--------------------------------------------------------------------------------------------------------------------------
// The filter itself, at an offset from the texel's centre in texels. Normalised by the caller, so only the shape
// matters here.
//
// 🔴 A box is square and everything else is round. A box filter measured as a radius drops the corners of its own
//    lattice, which quietly turns sixteen samples into thirteen and biases them towards the middle of the texel.
// 🔴 Mitchell and Catmull-Rom go NEGATIVE past their first lobe and that is the point of them — it is the overshoot
//    that makes an edge read as sharp. A weight of zero is dropped; a weight below zero is kept.
//--------------------------------------------------------------------------------------------------------------------------
export const FilterWeight = (Identifier, X, Y = 0) =>
{
    const Kind = FilterByIdentifier[Identifier] || FilterByIdentifier.box;
    const Radius = Kind.Radius;
    if (Identifier === "box") return Math.abs(X) <= Radius && Math.abs(Y) <= Radius ? 1 : 0;
    const Distance = Math.hypot(X, Y);
    if (Distance > Radius) return 0;
    const Fraction = Distance / Radius;
    if (Identifier === "tent") return 1 - Fraction;
    if (Identifier === "gaussian")
    {
        // Truncated at the radius and lifted to zero there, so the kernel has no step in it at the edge.
        const Sharpness = 4;
        return Math.exp(-Sharpness * Fraction * Fraction) - Math.exp(-Sharpness);
    }
    if (Identifier === "blackman")
    {
        const Angle = Math.PI * (Fraction + 1);
        return 0.35875 - 0.48829 * Math.cos(Angle) + 0.14128 * Math.cos(2 * Angle) - 0.01168 * Math.cos(3 * Angle);
    }
    // Mitchell-Netravali, over its own support of two. Catmull-Rom is the same curve with B at nought.
    const B = Identifier === "catmull" ? 0 : 1 / 3;
    const C = Identifier === "catmull" ? 0.5 : 1 / 3;
    const Reach = Math.abs(Fraction * 2);
    if (Reach < 1) return ((12 - 9 * B - 6 * C) * Reach ** 3 + (-18 + 12 * B + 6 * C) * Reach ** 2 + (6 - 2 * B)) / 6;
    return ((-B - 6 * C) * Reach ** 3 + (6 * B + 30 * C) * Reach ** 2 + (-12 * B - 48 * C) * Reach + (8 * B + 24 * C)) / 6;
};

//--------------------------------------------------------------------------------------------------------------------------
// Where the samples sit. A square lattice over the filter's own support, jittered by a fixed low-discrepancy wobble so
// that a diagonal seam is not sampled by a perfectly diagonal grid, with the filter's weight at each one.
//
// 🔴 Weights are normalised and a zero-weight lattice falls back to the centre. A filter whose weights all land
//    outside its support would otherwise divide a finished bake by nothing.
//--------------------------------------------------------------------------------------------------------------------------
export const SampleOffsets = (Samples = 1, Filter = "box") =>
{
    const Count = Math.max(1, Math.round(Math.sqrt(Math.max(1, Samples))));
    if (Count === 1) return [{ X: 0, Y: 0, Weight: 1 }];
    const Radius = (FilterByIdentifier[Filter] || FilterByIdentifier.box).Radius;
    // 🔴 How far the lattice is allowed to spread. A square lattice inside a round kernel would throw its own
    //    corners away, so it is laid inside the kernel's inscribed square; and below nine samples it is kept inside
    //    the texel whatever the kernel says, because four samples spread across two and a half texels is not
    //    antialiasing, it is noise — with Mitchell they can all land on the curve's zero and leave one sample.
    const Span = Count < 3 ? Math.min(Radius, 0.5) : Filter === "box" ? Radius : (Radius / Math.SQRT2) * 0.98;
    const Offsets = [];
    let Total = 0;
    for (let Row = 0; Row < Count; Row += 1)
        for (let Column = 0; Column < Count; Column += 1)
        {
            // The wobble is the fractional part of the golden ratio walked over the lattice: deterministic, so two
            // bakes of the same model agree, and uneven, so the lattice has no axis of its own.
            const Index = Row * Count + Column;
            const WobbleX = ((Index * 0.618033988749895) % 1) - 0.5;
            const WobbleY = ((Index * 0.414213562373095) % 1) - 0.5;
            const X = ((Column + 0.5 + WobbleX * 0.6) / Count - 0.5) * 2 * Span;
            const Y = ((Row + 0.5 + WobbleY * 0.6) / Count - 0.5) * 2 * Span;
            const Weight = FilterWeight(Filter, X, Y);
            if (Math.abs(Weight) < 1e-9) continue;
            Offsets.push({ X, Y, Weight });
            Total += Weight;
        }
    if (!Offsets.length || Total <= 0) return [{ X: 0, Y: 0, Weight: 1 }];
    for (const Offset of Offsets) Offset.Weight /= Total;
    return Offsets;
};

//--------------------------------------------------------------------------------------------------------------------------
// The whole order: what to read, how big, how finely, and what to do with the texels the unwrap never landed on.
//--------------------------------------------------------------------------------------------------------------------------
export const ReadingSizes = [256, 512, 1024, 2048];

export const ReadingDefaults = () => ({
    Size: 512,
    Samples: 9,
    Filter: "gaussian",
    Space: "tangent",
    Identity: "object",
    Width: 0.06,
    Rays: 24,
    Padding: 8,
    Wanted: ReadingOrdering.filter((Entry) => Entry.Chosen).map((Entry) => Entry.Identifier),
});

export const SanitiseReading = (Candidate = {}) =>
{
    const Order = ReadingDefaults();
    const Wanted = Array.isArray(Candidate.Wanted)
        ? Candidate.Wanted.filter((Identifier) => ReadingByIdentifier[Identifier])
        : Order.Wanted;
    return {
        // The dialog offers four sizes; the rule is only that a sheet has to be one a processor can finish. A
        // preview asks for a small one and a test asks for a tiny one, and neither of them is wrong.
        Size: Number.isFinite(Number(Candidate.Size)) ? Math.round(Clamp(Candidate.Size, 32, 2048)) : Order.Size,
        Samples: SampleCounts.some((Entry) => Entry.Value === Math.round(Candidate.Samples)) ? Math.round(Candidate.Samples) : Order.Samples,
        Filter: FilterByIdentifier[Candidate.Filter] ? Candidate.Filter : Order.Filter,
        Space: ReadingSpaces.some((Entry) => Entry.Identifier === Candidate.Space) ? Candidate.Space : Order.Space,
        Identity: IdentityKinds.some((Entry) => Entry.Identifier === Candidate.Identity) ? Candidate.Identity : Order.Identity,
        Width: Clamp(Candidate.Width ?? Order.Width, 0.005, 0.3),
        Rays: Math.round(Clamp(Candidate.Rays ?? Order.Rays, 4, 128)),
        Padding: Math.round(Clamp(Candidate.Padding ?? Order.Padding, 0, 64)),
        Wanted: [...new Set(Wanted)],
    };
};

// How far apart the traced points are allowed to get. Occlusion, bent normals and thickness are all integrals over
// the hemisphere above a point, and all three are smooth: they are worth measuring densely enough to follow the
// model's shape and no denser. So the rays are fired on a lattice of at most this many points across, whatever the
// sheet's resolution, and the texels between them are reconstructed from their neighbours.
//
// 🔴 This is what stops the ray cost from following the SHEET. Doubling the resolution of a bake quadruples the
//    number of texels but does not add one triangle to the model, and firing four times as many rays at the same
//    unchanged shape buys four times the samples of a signal that was already smooth. A 2048² bake traces exactly
//    as many rays as a 512² one and simply reconstructs them further.
export const TraceLimit = 256;

// What the order will cost, near enough to put in front of somebody before they press the button: a raster pass per
// antialiasing sample, a fixed lattice of rays, and a little for the size of the model behind both.
export const ReadingEstimate = (Order, Triangles = 0) => {
    const Texels = Order.Size * Order.Size;
    const Lattice = Math.max(1, Math.round(Math.sqrt(Order.Samples)) ** 2);
    const Maps = Order.Wanted.map((Identifier) => ReadingByIdentifier[Identifier]).filter(Boolean);
    const Channels = Maps.reduce((Sum, Entry) => Sum + Entry.Channels, 0);
    const Rayed = Maps.some((Entry) => Entry.Rays);
    // Four fifths of the lattice lands on the model on a well packed sheet, and the thickness rays on top of the
    // occlusion ones come to about another third again.
    const Traced = Math.min(Texels, TraceLimit * TraceLimit) * 0.8;
    const Seconds =
        (Texels * Lattice * (Math.max(1, Channels) + 4)) / 1.3e7 +
        (Rayed ? (Traced * Order.Rays * 1.3) / 3.5e5 : 0) +
        Triangles / 2.4e5;
    return {
        Lattice,
        Channels,
        // Accumulators while it runs, plus the finished image for each map, as megabytes.
        Megabytes: (Texels * (Channels * 4 + 4) + Texels * Maps.length * 4) / 1048576,
        Seconds,
    };
};
