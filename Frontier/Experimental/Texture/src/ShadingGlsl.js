//============================================================================================================================================
// 🔆 ShadingGlsl.js — GLSL ES 3.0 sources: surface bake, texture-space compositing, 3D stamping and OpenPBR viewport shading
//============================================================================================================================================
// Pass order per frame:
//   ① Bake      — mesh rasterised into UV space, producing world position / normal / occlusion maps (once per surface).
//   ② Dilate    — island padding so brushes and filters never read a hole at a UV seam.
//   ③ Curvature — convexity, cavity, inclination and altitude fields derived from the bake (drives the smart masks).
//   ④ Stamp     — brush segments written into a layer's coverage texture, evaluated in three dimensions, not in UV.
//   ⑤ Composite — the layer stack flattened into four RGBA8 channel targets (ping-ponged).
//   ⑥ Shade     — OpenPBR Surface evaluation of those targets in the viewport, or a raw channel inspection.
//============================================================================================================================================

export const QuadVertex = /* glsl */ `
layout(location = 0) in vec2 aCorner;
out vec2 vCoordinate;
void main()
{
    vCoordinate = aCorner * 0.5 + 0.5;
    gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Shared chunks.
//--------------------------------------------------------------------------------------------------------------------------
const NoiseChunk = /* glsl */ `
float Hash11(float Seed)
{
    return fract(sin(Seed * 127.1) * 43758.5453123);
}
float Hash21(vec2 Seed)
{
    return fract(sin(dot(Seed, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 Hash22(vec2 Seed)
{
    return fract(sin(vec2(dot(Seed, vec2(127.1, 311.7)), dot(Seed, vec2(269.5, 183.3)))) * 43758.5453123);
}
vec3 Hash33(vec3 Seed)
{
    return fract(
        sin(vec3(dot(Seed, vec3(127.1, 311.7, 74.7)), dot(Seed, vec3(269.5, 183.3, 246.1)), dot(Seed, vec3(113.5, 271.9, 124.6))))
        * 43758.5453123);
}
float ValueNoise(vec2 Coordinate)
{
    vec2 Cell = floor(Coordinate);
    vec2 Local = fract(Coordinate);
    vec2 Smooth = Local * Local * (3.0 - 2.0 * Local);
    float A = Hash21(Cell);
    float B = Hash21(Cell + vec2(1.0, 0.0));
    float C = Hash21(Cell + vec2(0.0, 1.0));
    float D = Hash21(Cell + vec2(1.0, 1.0));
    return mix(mix(A, B, Smooth.x), mix(C, D, Smooth.x), Smooth.y);
}
float Fractal(vec2 Coordinate, int Octaves)
{
    float Sum = 0.0;
    float Amplitude = 0.5;
    float Total = 0.0;
    for (int Index = 0; Index < 8; ++Index)
    {
        if (Index >= Octaves) break;
        Sum += ValueNoise(Coordinate) * Amplitude;
        Total += Amplitude;
        Coordinate *= 2.02;
        Amplitude *= 0.5;
    }
    return Sum / max(Total, 1e-4);
}
float Hash31(vec3 Seed)
{
    return fract(sin(dot(Seed, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
// Paper has to be anchored to the SURFACE, not to the texture and not to the stroke: cross the same patch twice from
// two directions and the same fibres must catch the pigment both times, or the grain reads as noise rather than tooth.
float ValueNoise3(vec3 Coordinate)
{
    vec3 Cell = floor(Coordinate);
    vec3 Local = fract(Coordinate);
    vec3 Smooth = Local * Local * (3.0 - 2.0 * Local);
    float A = mix(Hash31(Cell + vec3(0.0, 0.0, 0.0)), Hash31(Cell + vec3(1.0, 0.0, 0.0)), Smooth.x);
    float B = mix(Hash31(Cell + vec3(0.0, 1.0, 0.0)), Hash31(Cell + vec3(1.0, 1.0, 0.0)), Smooth.x);
    float C = mix(Hash31(Cell + vec3(0.0, 0.0, 1.0)), Hash31(Cell + vec3(1.0, 0.0, 1.0)), Smooth.x);
    float D = mix(Hash31(Cell + vec3(0.0, 1.0, 1.0)), Hash31(Cell + vec3(1.0, 1.0, 1.0)), Smooth.x);
    return mix(mix(A, B, Smooth.y), mix(C, D, Smooth.y), Smooth.z);
}
float Cellular(vec2 Coordinate)
{
    vec2 Cell = floor(Coordinate);
    vec2 Local = fract(Coordinate);
    float Closest = 1.0;
    for (int Y = -1; Y <= 1; ++Y)
        for (int X = -1; X <= 1; ++X)
        {
            vec2 Neighbour = vec2(float(X), float(Y));
            vec2 Point = Neighbour + Hash22(Cell + Neighbour) - Local;
            Closest = min(Closest, length(Point));
        }
    return clamp(Closest, 0.0, 1.0);
}
vec2 Rotate(vec2 Coordinate, float Angle)
{
    float Sine = sin(Angle);
    float Cosine = cos(Angle);
    return vec2(Coordinate.x * Cosine - Coordinate.y * Sine, Coordinate.x * Sine + Coordinate.y * Cosine);
}
float Levels(float Value, float Balance, float Contrast)
{
    float Width = max(0.012, 1.0 - Contrast * 0.985);
    float Low = Balance - Width * 0.5;
    float High = Balance + Width * 0.5;
    return clamp((Value - Low) / max(1e-4, High - Low), 0.0, 1.0);
}`;

// Procedural finishes — automotive paint, fabric, metal and plastic evaluated per texel. Family and style indices mirror
// FinishSpecification.FinishFamilies, and the eight shape/finish numbers are the controls the inspector shows by name.
const FinishChunk = /* glsl */ `
struct FinishSample
{
    vec3 Colour;
    float Roughness;
    float Metalness;
    float Specular;
    float Coat;
    float CoatRoughness;
    float Fuzz;
    float Height;
    float Occlusion;
};

//--------------------------------------------------------------------------------------------------------------------------
// Flake, properly.
//
// 🔴 The flake field lives in the WORLD, not in the unwrap. A flake is a physical thing — aluminium leaf is about 15 to
//    40 microns across, mica a little wider — and a field laid out in UV would change size wherever the unwrap changed
//    density, which is the single clearest tell of a faked metallic.
//
// 📝 And it is a FACET, not a speck. What makes a metallic panel flare as you walk past it is that each flake lies at
//    its own angle, so the one catching the light is never the one that caught it a second ago. The pass bakes into a
//    height channel that the shading differentiates into a normal, so a flake is written as a RAMP across its own
//    width — the derivative of a ramp is the tilt, and the tilt is the flare. A flat bright speck cannot flare.
//
// Cells are 3D: the surface only ever crosses a thin slab of them, so they cost a column of empty cells and in return
// the field has no seams, no poles and no stretch. The jitter and the flake radius are held below half a cell between
// them, which is what lets the eight nearest cells be the whole search.
//
// Returns: x how much of this texel the flake covers · y its own brightness · z the ramp across its facet, ±1 at the
// rim · w its radius in metres, which is what turns that ramp into a real slope.
//--------------------------------------------------------------------------------------------------------------------------
vec4 FlakeAt(vec3 Position, vec3 Normal, float Size, float Density, float Seed)
{
    float Cell = max(Size, 0.00002);
    vec3 Lattice = Position / Cell;
    vec3 Base = floor(Lattice - 0.5);
    vec3 Side = normalize(abs(Normal.y) < 0.9 ? cross(Normal, vec3(0.0, 1.0, 0.0)) : cross(Normal, vec3(1.0, 0.0, 0.0)));
    vec3 Other = cross(Normal, Side);
    vec4 Found = vec4(0.0);
    float Near = 1e9;
    for (int X = 0; X < 2; ++X)
    for (int Y = 0; Y < 2; ++Y)
    for (int Z = 0; Z < 2; ++Z)
    {
        vec3 Which = Base + vec3(float(X), float(Y), float(Z));
        if (Hash31(Which + Seed) > clamp(Density, 0.02, 1.0)) continue;
        vec3 Centre = (Which + 0.5 + (Hash33(Which + Seed * 3.17) - 0.5) * 0.4) * Cell;
        vec3 Delta = Position - Centre;
        float Through = dot(Delta, Normal);
        if (abs(Through) > Cell * 0.5) continue;
        vec2 Local = vec2(dot(Delta, Side), dot(Delta, Other));
        float Reach = length(Local);
        if (Reach > Near) continue;
        float Radius = Cell * mix(0.1, 0.25, Hash31(Which + Seed * 7.31));
        if (Reach > Radius) continue;
        Near = Reach;
        float Angle = Hash31(Which + Seed * 13.7) * 6.2831853;
        float Tilt = mix(0.35, 1.0, Hash31(Which + Seed * 19.3));
        // The ramp runs across the flake along its own direction: flat at the centre, ±1 at its edges.
        float Across = dot(Local / max(Radius, 1e-6), vec2(cos(Angle), sin(Angle)));
        Found = vec4(1.0 - smoothstep(0.72, 1.0, Reach / max(Radius, 1e-6)), Hash31(Which + Seed * 23.9), Across * Tilt, Radius);
    }
    return Found;
}

// The old flake field, still what the galvanised spangle and the weave want: cells in the unwrap, present or absent.
float FlakeField(vec2 Coordinate, float Scale, float Density, float Seed, out float Facet)
{
    vec2 Lattice = Coordinate * max(Scale, 0.001);
    vec2 Cell = floor(Lattice);
    float Draw = Hash21(Cell + Seed * 17.0);
    Facet = Hash21(Cell.yx + Seed * 31.0);
    float Present = step(1.0 - clamp(Density, 0.0, 1.0), Draw);
    vec2 Local = fract(Lattice) - 0.5 - (Hash22(Cell + Seed) - 0.5) * 0.45;
    float Disc = 1.0 - smoothstep(0.12, 0.42, length(Local));
    return Present * Disc;
}

// Warp over weft. Style 0 plain, 1 twill, 2 satin, 3 knitted ribs.
float WeaveField(vec2 Coordinate, int Style, float Scale, out float Warp, out float Ridge)
{
    vec2 Thread = Coordinate * max(Scale, 0.001);
    vec2 Cell = floor(Thread);
    vec2 Local = fract(Thread);
    float Parity = mod(Cell.x + Cell.y, 2.0);
    if (Style == 1) Parity = step(1.5, mod(Cell.x + Cell.y * 2.0, 4.0));
    else if (Style == 2) Parity = step(3.5, mod(Cell.x + Cell.y * 3.0, 5.0));
    else if (Style == 3) Parity = step(0.5, mod(Cell.y, 2.0));
    Warp = Parity;
    float Across = mix(Local.y, Local.x, Parity);
    float Round = sin(Across * 3.14159265);
    Ridge = Round;
    float Along = mix(Local.x, Local.y, Parity);
    float Edge = smoothstep(0.0, 0.14, Along) * smoothstep(1.0, 0.86, Along);
    return clamp(Round * mix(0.75, 1.0, Edge), 0.0, 1.0);
}

FinishSample SampleFinish(
    int Family, int Style, vec2 Coordinate, vec3 Position, vec3 Normal, vec4 Field,
    vec3 ColourA, vec3 ColourB, vec4 Shape, vec4 Trim, vec4 Extra)
{
    float Scale = max(Shape.x, 0.001);
    float Density = Shape.y;
    float Strength = Shape.z;
    float Gloss = clamp(Shape.w, 0.0, 1.0);
    float Coat = clamp(Trim.x, 0.0, 1.0);
    float Angle = radians(Trim.y);
    float Variation = Trim.z;
    float Seed = Trim.w;
    float PeelAmount = clamp(Extra.x, 0.0, 1.0);          // [-]   how far the clear coat failed to level
    float FlakeSize = max(Extra.y, 0.4) * 0.001;          // [m]   flake across, measured on the panel
    float FlakeTilt = clamp(Extra.z, 0.0, 1.0);           // [-]   how far the flakes lie off the panel
    float HeightRange = max(Extra.w, 0.25);               // [mm]  what the whole height channel is worth, end to end

    vec2 Turned = Rotate(Coordinate - 0.5, Angle) + 0.5;
    FinishSample Result;
    Result.Colour = ColourA;
    Result.Roughness = clamp(1.0 - Gloss, 0.02, 1.0);
    Result.Metalness = 0.0;
    Result.Specular = 1.0;
    Result.Coat = Coat;
    Result.CoatRoughness = clamp((1.0 - Gloss) * 0.35, 0.01, 1.0);
    Result.Fuzz = 0.0;
    Result.Height = 0.5;
    Result.Occlusion = 1.0;

    if (Family == 0)
    {
        // Automotive. Real paint is a stack: primer, a pigmented basecoat that may carry aluminium or mica flake, and a
        // clear coat over the top that never quite levels. That last part is orange peel, and it is the reason a
        // reflection in car paint wobbles while a reflection in a mirror does not — so it is modelled here as a shallow
        // undulation in height and a matching wobble in coat roughness, present on every style that has a coat at all.
        vec4 Leaf = FlakeAt(Position, Normal, FlakeSize, Density, Seed);
        float Flakes = Leaf.x;
        float Facet = Leaf.y;
        // 🔴 The ramp is what the shading differentiates into a tilted facet, and its height has to be a real length
        //    or the tilt changes every time the flake size or the height range does. A facet of radius r lying at an
        //    angle rises r·tanθ above its own centre, so the ramp is written in exactly those terms: the flake's
        //    radius in millimetres over what the height channel is worth end to end. Pick the numbers any other way
        //    and a coarse show flake comes out flatter than a fine one, which is backwards.
        float Slope = clamp((Leaf.w * 1000.0) / HeightRange, 0.0, 0.6);
        float Relief = Leaf.z * Flakes * FlakeTilt * Slope;
        float Drift = Fractal(Turned * (2.0 + Scale * 3.0) + Seed, 4);
        float Peel = (Fractal(Turned * 17.0 + Seed * 0.37, 3) * 0.76 + Fractal(Turned * 54.0, 2) * 0.24 - 0.5) * PeelAmount;
        vec3 Body = mix(ColourA, ColourA * mix(0.86, 1.16, Drift), Variation);
        float Sparkle = Flakes * Strength * mix(0.55, 1.0, Facet);
        float Clear = clamp(mix(0.075, 0.008, Gloss) + abs(Peel) * 0.26, 0.004, 1.0);

        // Style 0 · solid, single stage. Pigment and clear, nothing suspended in it.
        Result.Colour = Body;
        Result.Metalness = 0.0;
        Result.Roughness = clamp(mix(0.30, 0.055, Gloss) + Drift * 0.02 * Variation, 0.02, 1.0);
        Result.Coat = Coat;
        Result.CoatRoughness = Clear;
        Result.Height = 0.5 + Peel * 0.1;

        if (Style == 1)
        {
            // Metallic basecoat: aluminium flake suspended in the pigment, each one lying at its own angle, which is
            // what makes the panel flare as you walk past it.
            // Flake lifts the colour toward aluminium; it never replaces the pigment, or the panel reads as glitter.
            Result.Colour = mix(Body, ColourB, clamp(Sparkle * 0.55, 0.0, 1.0));
            Result.Metalness = clamp(Sparkle * 0.85, 0.0, 1.0);
            Result.Roughness = clamp(mix(0.30, 0.055, Gloss) * (1.0 - 0.55 * Sparkle) + Drift * 0.02 * Variation, 0.02, 1.0);
            Result.Height = 0.5 + Peel * 0.1 + Relief * Strength;
        }
        else if (Style == 2)
        {
            // Pearl tri-coat: mica, not metal. The flake refracts rather than reflects, so the colour shifts with its
            // tilt while the metalness stays near nothing and the specular lifts instead.
            // Mica is a stack of thin plates, so what it does with light depends on the angle it is lying at — the
            // ramp across the flake is exactly that angle, so the interference travels across each flake rather than
            // tinting it flat.
            float Shift = mix(0.15, 1.0, Facet) * Flakes * 0.8;
            float Travel = clamp(0.5 + Leaf.z * 0.5, 0.0, 1.0);
            Result.Colour = mix(Body, mix(ColourB, ColourB.gbr, Travel * 0.45), clamp(Shift * Strength, 0.0, 1.0));
            Result.Metalness = clamp(Sparkle * 0.18, 0.0, 1.0);
            Result.Roughness = clamp(mix(0.26, 0.05, Gloss) - Shift * 0.03, 0.02, 1.0);
            Result.Specular = clamp(1.0 + Shift * 0.35, 0.0, 2.0);
            Result.Height = 0.5 + Peel * 0.1 + Relief * Strength * 0.6;
        }
        else if (Style == 3)
        {
            // Candy: a transparent tinted layer over a bright metallic ground. Depth is what makes the colour, so the
            // tint is absorption rather than a mix — Beer's law through a coat whose thickness drifts across the panel.
            vec3 Ground = mix(vec3(0.78, 0.79, 0.80), ColourB, 0.75);
            float Thickness = mix(0.85, 1.9, Drift) * mix(1.0, 1.4, Variation);
            vec3 Tint = pow(max(ColourA, vec3(0.004)), vec3(Thickness));
            Result.Colour = Ground * Tint * mix(1.0, 1.0 + Sparkle, 0.4);
            Result.Metalness = clamp(0.55 + Sparkle * 0.45, 0.0, 1.0);
            Result.Roughness = clamp(mix(0.22, 0.04, Gloss), 0.02, 1.0);
            Result.Coat = max(Coat, 0.7);
            Result.CoatRoughness = clamp(Clear * 0.75, 0.004, 1.0);
            // The ground under a candy is a metallic basecoat, and it flares through the tint.
            Result.Height = 0.5 + Peel * 0.1 + Relief * Strength * 0.8;
        }
        else if (Style == 4)
        {
            // Matte wrap, or a matte clear over colour: no flake, a fine grain, and a coat held deliberately flat.
            float Grain = Fractal(Turned * 260.0 * Scale, 3);
            Result.Colour = mix(ColourA, ColourB, Grain * 0.25 * Variation);
            Result.Metalness = 0.0;
            Result.Roughness = clamp(0.62 + Grain * 0.16 - Gloss * 0.2, 0.2, 1.0);
            Result.Coat = Coat * 0.25;
            Result.CoatRoughness = 0.55;
            Result.Height = 0.5 + (Grain - 0.5) * 0.01 + Peel * 0.04;
        }
        else if (Style == 5)
        {
            // Flip, or chameleon: interference pigment that reads as a different colour at every angle. A texture
            // cannot know the viewing angle, so the travel is laid across the surface instead — which is what the
            // paint looks like over a curved panel anyway, three colours at once.
            // Stretched across the whole hue cycle, or the field only ever visits a third of the travel.
            float Phase = (Fractal(Turned * (1.6 + Scale * 1.6) + Seed * 0.7, 4) - 0.5) * 25.1327412;
            vec3 Third = mix(ColourA, ColourB, 0.5).gbr * 1.6;        // the gold the other two travel through
            // Cubed so one of the three wins at any given spot; averaged weights would read as mud rather than travel.
            float WeightA = pow(0.5 + 0.5 * cos(Phase), 3.0);
            float WeightB = pow(0.5 + 0.5 * cos(Phase - 2.0943951), 3.0);
            float WeightC = pow(0.5 + 0.5 * cos(Phase - 4.1887902), 3.0);
            vec3 Flip = (ColourA * WeightA + ColourB * WeightB + Third * WeightC) / max(WeightA + WeightB + WeightC, 1e-3);
            Result.Colour = mix(Body, Flip, clamp(0.45 + Variation * 0.55, 0.0, 1.0));
            Result.Metalness = clamp(0.25 + Sparkle * 0.6, 0.0, 1.0);
            Result.Roughness = clamp(mix(0.22, 0.045, Gloss), 0.02, 1.0);
            Result.Coat = max(Coat, 0.8);
            Result.Height = 0.5 + Peel * 0.1 + Relief * Strength * 0.7;
        }
        else if (Style == 6)
        {
            // Primer: chalky, speckled, no coat worth the name and no peel because there is nothing to level.
            float Speckle = Cellular(Turned * 180.0 * Scale);
            Result.Colour = mix(ColourA, ColourB, (1.0 - Speckle) * 0.3);
            Result.Metalness = 0.0;
            Result.Roughness = clamp(0.78 + (1.0 - Speckle) * 0.18 - Gloss * 0.25, 0.3, 1.0);
            Result.Coat = Coat * 0.1;
            Result.Occlusion = mix(1.0, 0.88, 1.0 - Speckle);
            Result.Height = 0.5 + (Speckle - 0.5) * 0.04 * Strength;
        }
    }
    else if (Family == 1)
    {
        // Fabric. Threads cross, catch light along their length and shade in the gaps.
        float Warp = 0.0;
        float Ridge = 0.0;
        float Weave = WeaveField(Turned, Style, Scale * 90.0, Warp, Ridge);
        float Fibre = Fractal(Turned * 420.0 * Scale, 3);
        vec3 Thread = mix(ColourA, ColourB, Warp);
        Thread = mix(Thread, Thread * mix(0.78, 1.18, Fibre), Variation);
        Result.Colour = Thread * mix(0.72, 1.0, Weave);
        Result.Roughness = clamp(0.74 + (1.0 - Weave) * 0.18 - Gloss * 0.3 + Fibre * 0.06, 0.25, 1.0);
        Result.Metalness = 0.0;
        Result.Specular = 0.35 + Gloss * 0.4;
        Result.Fuzz = clamp(Strength * mix(0.55, 1.0, Fibre), 0.0, 1.0);
        Result.Height = 0.5 + (Weave - 0.5) * 0.35;
        Result.Occlusion = mix(0.62, 1.0, Weave);
        Result.Coat = Coat * 0.12;
        if (Style == 4)
        {
            // Velvet: no visible weave, all nap.
            float Nap = Fractal(Turned * 300.0 * Scale, 4);
            Result.Colour = mix(ColourA, ColourB, Nap * mix(0.3, 0.9, Variation));
            Result.Roughness = clamp(0.88 - Gloss * 0.2, 0.4, 1.0);
            Result.Fuzz = clamp(0.65 + Strength * 0.35, 0.0, 1.0);
            Result.Height = 0.5 + (Nap - 0.5) * 0.08;
            Result.Occlusion = mix(0.8, 1.0, Nap);
        }
    }
    else if (Family == 2)
    {
        // Metal. Always conductive; the style decides how the surface was worked.
        Result.Metalness = 1.0;
        Result.Specular = 1.0;
        Result.Coat = Coat * 0.3;
        if (Style == 0)
        {
            // Brushed: long grain along the chosen angle.
            vec2 Stretched = vec2(Turned.x * Scale * 900.0, Turned.y * Scale * 14.0);
            float Grain = Fractal(Stretched, 3);
            float Fine = Fractal(Stretched * 3.1 + 11.0, 2);
            Result.Colour = ColourA * mix(0.88, 1.12, Grain);
            Result.Roughness = clamp(mix(0.42, 0.08, Gloss) + (Grain - 0.5) * 0.3 * Strength + Fine * 0.04, 0.02, 1.0);
            Result.Height = 0.5 + (Grain - 0.5) * 0.05 * Strength;
        }
        else if (Style == 1)
        {
            // Hammered: overlapping dents.
            float Dent = Cellular(Turned * Scale * 34.0);
            float Soft = smoothstep(0.0, 0.7, Dent);
            Result.Colour = ColourA * mix(0.82, 1.14, Soft);
            Result.Roughness = clamp(mix(0.34, 0.1, Gloss) + (1.0 - Soft) * 0.22 * Strength, 0.02, 1.0);
            Result.Height = 0.5 + (Soft - 0.5) * 0.5 * Strength;
            Result.Occlusion = mix(0.72, 1.0, Soft);
        }
        else if (Style == 2)
        {
            // Cast and pitted.
            float Pit = Fractal(Turned * Scale * 220.0, 5);
            float Hole = step(1.0 - clamp(Density, 0.0, 1.0) * 0.4, Hash21(floor(Turned * Scale * 160.0) + Seed));
            Result.Colour = ColourA * mix(0.7, 1.05, Pit) * mix(1.0, 0.55, Hole);
            Result.Roughness = clamp(mix(0.62, 0.3, Gloss) + Pit * 0.25 * Strength + Hole * 0.2, 0.05, 1.0);
            Result.Height = 0.5 + (Pit - 0.5) * 0.18 * Strength - Hole * 0.12;
            Result.Occlusion = mix(0.75, 1.0, Pit) * mix(1.0, 0.6, Hole);
        }
        else
        {
            // Galvanised spangle: wide crystal facets, each with its own tilt.
            float Facet = 0.0;
            float Crystal = FlakeField(Turned, Scale * 26.0, clamp(Density + 0.45, 0.0, 1.0), Seed, Facet);
            float Plate = Hash21(floor(Turned * Scale * 26.0) + Seed * 3.0);
            Result.Colour = mix(ColourA, ColourB, Crystal * 0.8) * mix(0.86, 1.1, Plate);
            Result.Roughness = clamp(mix(0.5, 0.16, Gloss) + (Plate - 0.5) * 0.3 * Strength, 0.03, 1.0);
            Result.Height = 0.5 + (Crystal - 0.5) * 0.06 * Strength;
        }
    }
    else
    {
        // Plastic. Dielectric, moulded, usually a little textured so it does not read as glass.
        Result.Metalness = 0.0;
        Result.Specular = 0.6 + Gloss * 0.4;
        float Pebble = Cellular(Turned * Scale * 150.0);
        float Grain = Fractal(Turned * Scale * 520.0, 3);
        if (Style == 0)
        {
            Result.Colour = mix(ColourA, ColourB, Grain * 0.18 * Variation);
            Result.Roughness = clamp(mix(0.42, 0.06, Gloss) + Grain * 0.05 * Strength, 0.02, 1.0);
            Result.Coat = Coat;
            Result.CoatRoughness = clamp((1.0 - Gloss) * 0.2, 0.01, 1.0);
            Result.Height = 0.5 + (Grain - 0.5) * 0.01;
        }
        else if (Style == 1)
        {
            // Pebbled, the grained finish on a dashboard.
            float Bump = smoothstep(0.05, 0.6, Pebble);
            Result.Colour = mix(ColourA, ColourB, (1.0 - Bump) * 0.25 * Variation);
            Result.Roughness = clamp(mix(0.68, 0.3, Gloss) + (1.0 - Bump) * 0.22 * Strength, 0.1, 1.0);
            Result.Height = 0.5 + (Bump - 0.5) * 0.4 * Strength;
            Result.Occlusion = mix(0.7, 1.0, Bump);
            Result.Coat = Coat * 0.3;
        }
        else if (Style == 2)
        {
            // Soft touch: rubberised, almost no specular sheen.
            Result.Colour = ColourA * mix(0.94, 1.04, Grain);
            Result.Roughness = clamp(0.82 - Gloss * 0.22 + Grain * 0.08 * Strength, 0.3, 1.0);
            Result.Fuzz = clamp(0.25 * Strength, 0.0, 1.0);
            Result.Specular = 0.3;
            Result.Coat = 0.0;
            Result.Height = 0.5 + (Grain - 0.5) * 0.02;
        }
        else
        {
            // Polycarbonate: clear, hard, faintly scratched.
            vec2 Stretched = vec2(Turned.x * Scale * 700.0, Turned.y * Scale * 18.0);
            float Scratch = smoothstep(0.78, 1.0, Fractal(Stretched, 3));
            Result.Colour = mix(ColourA, ColourB, Scratch * 0.5);
            Result.Roughness = clamp(mix(0.16, 0.02, Gloss) + Scratch * 0.3 * Strength, 0.01, 1.0);
            Result.Coat = max(Coat, 0.4);
            Result.CoatRoughness = clamp((1.0 - Gloss) * 0.08 + Scratch * 0.2, 0.004, 1.0);
            Result.Height = 0.5 + Scratch * 0.01;
        }
    }
    Result.Colour = clamp(Result.Colour, 0.0, 1.0);
    return Result;
}`;

// Masks — painted, generator-driven or keyed on a colour. Shared by the compositor and the mask preview pass.
const MaskChunk = /* glsl */ `
float ColourMask(vec3 Lower, vec3 Key, float Tolerance, float Softness)
{
    float Distance = length(Lower - Key);
    float Inner = max(Tolerance, 0.001);
    float Outer = Inner + max(Softness, 0.001);
    return 1.0 - smoothstep(Inner, Outer, Distance);
}

float SampleMask(
    int Kind, float Painted, vec2 Coordinate, vec3 Position, vec3 Normal, vec4 Field,
    int FieldKind, vec4 A, vec4 B, vec3 Lower, vec3 Key, float Tolerance, float Softness, float Invert,
    float Sheet, float Sheeted)
{
    float Mask = 1.0;
    if (Kind == 1) Mask = Painted;
    else if (Kind == 2)
        Mask = SampleGenerator(FieldKind, Coordinate, Position, Normal, Field, A.x, int(A.y), A.z, A.w, B.x, B.y, B.z, B.w);
    else if (Kind == 3) Mask = ColourMask(Lower, Key, Tolerance, Softness);
    // The generator stack arrives already solved, as one sheet: dust over wear over a selection of faces, each
    // joined to the one beneath it on the way in. Here it only has to meet the mask it is shaping, and a mask
    // shaped by two things at once is the product of them — a stack with nothing in it is white and changes nothing.
    Mask *= mix(1.0, Sheet, Sheeted);
    return mix(Mask, 1.0 - Mask, Invert);
}`;

// Generator kinds — index order mirrors GeneratorSpecification.GeneratorOrdering.
const GeneratorChunk = /* glsl */ `
uniform sampler2D uPositionMap;
uniform sampler2D uNormalMap;
uniform sampler2D uFieldMap;

float SampleGenerator(
    int Kind, vec2 Coordinate, vec3 Position, vec3 Normal, vec4 Field,
    float Scale, int Detail, float Contrast, float Balance, float Warp, float Angle, float Seed, float Invert)
{
    vec2 Placed = Rotate(Coordinate - 0.5, radians(Angle)) + 0.5;
    vec2 Scaled = Placed * Scale + Seed * 17.137;
    float Value = 0.5;
    if (Kind == 0)
    {
        vec2 Warped = Scaled + Warp * 2.0 * vec2(
            Fractal(Scaled * 0.5 + 11.3, 3) - 0.5,
            Fractal(Scaled * 0.5 - 7.1, 3) - 0.5);
        Value = Fractal(Warped, Detail);
    }
    else if (Kind == 1)
    {
        vec2 Warped = Scaled + Warp * 1.5 * vec2(Fractal(Scaled * 0.4, 3) - 0.5, Fractal(Scaled * 0.4 + 5.0, 3) - 0.5);
        Value = 1.0 - Cellular(Warped);
    }
    else if (Kind == 2)
    {
        vec2 Streak = vec2(Scaled.x * 0.08, Scaled.y * 9.0);
        float Lines = Fractal(Streak, Detail);
        float Fine = Fractal(Streak * vec2(0.6, 3.1) + 31.7, 2);
        Value = 1.0 - clamp(abs(Lines - 0.5) * 3.4 + Fine * 0.22, 0.0, 1.0);
    }
    else if (Kind == 3)
    {
        vec2 Cell = Scaled;
        vec2 Wave = sin(Cell * 3.14159265);
        float Twill = 0.5 + 0.5 * sin((Cell.x + Cell.y) * 3.14159265 * 0.5);
        Value = clamp(0.5 + 0.5 * (Wave.x * Wave.y) * mix(0.6, 1.0, Twill), 0.0, 1.0);
    }
    else if (Kind == 4)
    {
        float Along = Placed.y * Scale;
        float Across = Placed.x * Scale;
        float Turbulence = Fractal(vec2(Across * 0.35, Along * 0.08) + Seed, Detail) - 0.5;
        float Rings = fract(Along * 0.5 + Turbulence * Warp * 4.0);
        Value = abs(Rings - 0.5) * 2.0;
    }
    else if (Kind == 5)
    {
        vec2 Cell = floor(Placed * Scale);
        Value = mod(Cell.x + Cell.y, 2.0);
    }
    else if (Kind == 6)
    {
        Value = clamp(Placed.y, 0.0, 1.0);
    }
    else if (Kind == 7)
    {
        Value = clamp(Field.r, 0.0, 1.0);
    }
    else if (Kind == 8)
    {
        Value = clamp(Field.g, 0.0, 1.0);
    }
    else if (Kind == 9)
    {
        Value = clamp(Field.a, 0.0, 1.0);
    }
    else if (Kind == 10)
    {
        Value = clamp(Normal.y * 0.5 + 0.5, 0.0, 1.0);
    }
    else
    {
        Value = clamp(Field.b, 0.0, 1.0);
    }
    Value = Levels(Value, Balance, Contrast);
    return mix(Value, 1.0 - Value, Invert);
}`;

const BlendChunk = /* glsl */ `
float BlendScalar(int Mode, float Lower, float Upper)
{
    if (Mode == 1) return Lower * Upper;
    if (Mode == 2) return 1.0 - (1.0 - Lower) * (1.0 - Upper);
    if (Mode == 3) return Lower < 0.5 ? 2.0 * Lower * Upper : 1.0 - 2.0 * (1.0 - Lower) * (1.0 - Upper);
    if (Mode == 4) return Lower + Upper;
    if (Mode == 5) return Lower - Upper;
    if (Mode == 6) return min(Lower, Upper);
    if (Mode == 7) return max(Lower, Upper);
    if (Mode == 8) return abs(Lower - Upper);
    if (Mode == 9) return clamp(Lower + Upper - 1.0, 0.0, 1.0);
    return Upper;
}
vec3 BlendColour(int Mode, vec3 Lower, vec3 Upper)
{
    return vec3(
        BlendScalar(Mode, Lower.r, Upper.r),
        BlendScalar(Mode, Lower.g, Upper.g),
        BlendScalar(Mode, Lower.b, Upper.b));
}`;

const EnvironmentChunk = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uLightDirection[3];
uniform vec3 uLightRadiance[3];
uniform float uEnvironmentIntensity;
uniform float uExposure;

vec3 SkyGradient(vec3 Direction)
{
    float Elevation = Direction.y;
    vec3 Upper = mix(uSkyHorizon, uSkyZenith, pow(clamp(Elevation, 0.0, 1.0), 0.65));
    vec3 Lower = mix(uSkyHorizon, uSkyGround, pow(clamp(-Elevation, 0.0, 1.0), 0.35));
    return mix(Lower, Upper, smoothstep(-0.035, 0.035, Elevation));
}
vec3 SampleEnvironment(vec3 Direction, float Roughness)
{
    vec3 Radiance = SkyGradient(Direction);
    float Sharpness = mix(2600.0, 3.0, clamp(Roughness, 0.0, 1.0));
    for (int Index = 0; Index < 3; ++Index)
    {
        float Alignment = max(dot(Direction, uLightDirection[Index]), 0.0);
        float Lobe = pow(Alignment, Sharpness) * (Sharpness + 2.0) / 28.0;
        Radiance += uLightRadiance[Index] * Lobe;
    }
    return Radiance * uEnvironmentIntensity;
}
vec3 SampleIrradiance(vec3 Normal)
{
    vec3 Ambient = (SkyGradient(Normal) * 0.65 + SkyGradient(vec3(0.0, 1.0, 0.0)) * 0.35);
    return Ambient * uEnvironmentIntensity;
}
vec3 ToneMap(vec3 Colour)
{
    Colour *= exp2(uExposure);
    const float A = 2.51;
    const float B = 0.03;
    const float C = 2.43;
    const float D = 0.59;
    const float E = 0.14;
    Colour = clamp((Colour * (A * Colour + B)) / (Colour * (C * Colour + D) + E), 0.0, 1.0);
    return pow(Colour, vec3(1.0 / 2.2));
}
vec3 Linearise(vec3 Encoded)
{
    return pow(max(Encoded, vec3(0.0)), vec3(2.2));
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ① Surface bake — the mesh rasterised into its own UV space.
//--------------------------------------------------------------------------------------------------------------------------
export const BakeVertex = /* glsl */ `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;
layout(location = 3) in vec2 aCoordinate;
layout(location = 4) in float aOcclusion;
out vec3 vPosition;
out vec3 vNormal;
out float vOcclusion;
void main()
{
    vPosition = aPosition;
    vNormal = aNormal;
    vOcclusion = aOcclusion;
    gl_Position = vec4(aCoordinate * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BakeFragment = /* glsl */ `
in vec3 vPosition;
in vec3 vNormal;
in float vOcclusion;
layout(location = 0) out vec4 oPosition;
layout(location = 1) out vec4 oNormal;
void main()
{
    oPosition = vec4(vPosition, 1.0);
    oNormal = vec4(normalize(vNormal), vOcclusion);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ② Island dilation — one ring per invocation, run a handful of times.
//--------------------------------------------------------------------------------------------------------------------------
export const DilateFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uPositionSource;
uniform sampler2D uNormalSource;
layout(location = 0) out vec4 oPosition;
layout(location = 1) out vec4 oNormal;
void main()
{
    vec4 Centre = texture(uPositionSource, vCoordinate);
    vec4 CentreNormal = texture(uNormalSource, vCoordinate);
    if (Centre.w > 0.5)
    {
        oPosition = Centre;
        oNormal = CentreNormal;
        return;
    }
    vec2 Texel = 1.0 / vec2(textureSize(uPositionSource, 0));
    vec4 PositionSum = vec4(0.0);
    vec4 NormalSum = vec4(0.0);
    float Weight = 0.0;
    for (int Y = -1; Y <= 1; ++Y)
        for (int X = -1; X <= 1; ++X)
        {
            if (X == 0 && Y == 0) continue;
            vec2 Offset = vec2(float(X), float(Y)) * Texel;
            vec4 Neighbour = texture(uPositionSource, vCoordinate + Offset);
            if (Neighbour.w <= 0.5) continue;
            PositionSum += Neighbour;
            NormalSum += texture(uNormalSource, vCoordinate + Offset);
            Weight += 1.0;
        }
    if (Weight < 0.5)
    {
        oPosition = Centre;
        oNormal = CentreNormal;
        return;
    }
    oPosition = vec4(PositionSum.xyz / Weight, 1.0);
    oNormal = vec4(normalize(NormalSum.xyz / Weight), NormalSum.w / Weight);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ③ Derived fields: r = convex curvature, g = cavity, b = altitude, a = occlusion.
//--------------------------------------------------------------------------------------------------------------------------
export const CurvatureFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uPositionSource;
uniform sampler2D uNormalSource;
uniform vec3 uBoundsMinimum;
uniform vec3 uBoundsExtent;
out vec4 oField;
void main()
{
    vec2 Texel = 1.0 / vec2(textureSize(uNormalSource, 0));
    vec4 Centre = texture(uNormalSource, vCoordinate);
    vec3 Normal = normalize(Centre.xyz);
    vec3 Position = texture(uPositionSource, vCoordinate).xyz;
    float Convex = 0.0;
    float Concave = 0.0;
    for (int Index = 0; Index < 8; ++Index)
    {
        float Angle = float(Index) * 0.7853981634;
        vec2 Offset = vec2(cos(Angle), sin(Angle)) * Texel * 2.0;
        vec3 NeighbourPosition = texture(uPositionSource, vCoordinate + Offset).xyz;
        vec3 Delta = NeighbourPosition - Position;
        float Length = length(Delta);
        if (Length < 1e-6) continue;
        float Alignment = dot(normalize(Delta), Normal);
        Convex += max(-Alignment, 0.0);
        Concave += max(Alignment, 0.0);
    }
    float Scale = 7.5;
    float Altitude = clamp((Position.y - uBoundsMinimum.y) / max(uBoundsExtent.y * 2.0, 1e-4), 0.0, 1.0);
    oField = vec4(
        clamp(Convex * Scale / 8.0, 0.0, 1.0),
        clamp(Concave * Scale / 8.0, 0.0, 1.0),
        Altitude,
        clamp(Centre.w, 0.0, 1.0));
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Media — the physical half of a stroke: bristle lanes, paper tooth, ink bleed, felt streaks, dust and wax skip.
//
// 🔴 This is the GLSL reading of MediaSolver.js. The two are written line for line and constant for constant so the
//    card's ribbon preview and the paint on the surface are the same mark. Change one and change the other, or the
//    preview starts lying — and a preview that lies is worse than no preview.
//
// Nothing here reads a texture. Every mark is computed from where it lands, so it never tiles, never softens at a
// higher resolution, and a patch of surface keeps the same tooth whichever direction the stroke crossed it.
//--------------------------------------------------------------------------------------------------------------------------
const MediaChunk = /* glsl */ `
uniform int uMedium;            // 0 plain · 1 bristle · 2 graphite · 3 ink · 4 felt · 5 dry pigment · 6 wax
uniform vec4 uMediaA;           // grain, tooth frequency, scatter, bleed
uniform vec4 uMediaB;           // bristles, splay, swell, wetness
uniform vec4 uMediaC;           // darkness, tilt, melt, seed
uniform vec4 uMediaD;           // dry-out, reach, fibre frequency, nib ratio

// How far past the nominal rim this medium can still put pigment: dust, bleed and a laid-over lead all reach further
// than the mark itself, and the stamping pass has to keep those texels alive long enough to ask.
float MediaExtent()
{
    if (uMedium == 2) return 1.0 + 1.3 * uMediaC.y;
    if (uMedium == 3) return 1.0 + 1.8 * uMediaA.w;
    if (uMedium == 4) return 1.0 + 1.5 * uMediaA.w;
    if (uMedium == 5) return 1.0 + 1.6 * uMediaA.z;
    return 1.0;
}

// Returns (coverage, shade, relief, grit). Shade multiplies the colour in hand: below 1 is pigment piling into a valley
// or pooling at a wet rim, above 1 is wax catching the light. Relief is signed height added to the height the brush
// writes, grit is signed roughness added to its roughness — the two that make the paint a material rather than a
// picture of one. MediaSolver.js holds the same model in JavaScript, line for line and constant for constant.
vec4 MediaDeposit(float Across, float Along, float Press, float Hardness, float Tooth, float Fibre, float Speck)
{
    float Rim = abs(Across);
    float Load = 1.0 - uMediaD.x * clamp(Along / max(uMediaD.y, 1e-3), 0.0, 1.0);

    if (uMedium == 1)
    {
        // Bristle. A head is a row of hairs that keep their identity for the whole stroke — pressure FANS them apart,
        // it does not grow new ones. Dividing by the fan before the lane is taken is the whole of that: hair seven is
        // hair seven whether the head is pressed flat or barely touching, so its streak runs the length of the mark
        // instead of the comb swimming sideways every time the hand leans.
        float Fan = 1.0 + 0.5 * uMediaB.y * Press;
        float Hairs = max(uMediaB.x, 3.0);
        float Lane = (Across / Fan) * 0.5 * Hairs + Hairs * 0.5;
        float Cell = floor(Lane);
        float Within = Lane - Cell;
        float Pick = Hash11(Cell * 1.73 + uMediaC.w * 7.0);
        // 🔴 Hairs are not a comb: each sits off-centre in its lane and is its own thickness, or the mark reads as
        //    corduroy — evenly ruled lines is the one thing a brush never leaves behind.
        float Shift = Hash11(Cell * 3.11 + uMediaC.w * 13.0) * 0.5 - 0.25;
        float Thin = mix(0.1, 0.44, Hash11(Cell * 5.37 + uMediaC.w * 3.0));
        // 🔴 And a hair is not a ruled line either: it is a spring under a moving hand, so where it sits in its own
        //    lane wanders as the stroke goes on. One noise lookup keyed to the HAIR, not to the texel — a hair has
        //    to wander as one hair or the mark dissolves into static.
        float Wander = (ValueNoise(vec2(Along * uMediaD.z * 0.22, Cell * 1.7 + uMediaC.w * 31.0)) - 0.5) * 0.5 * (1.0 - uMediaB.w * 0.5);
        float Edge = clamp(Within - Shift - Wander, 0.0, 1.0);
        float Ridge = smoothstep(0.0, Thin, Edge) * smoothstep(1.0, 1.0 - Thin, Edge);
        // Each hair empties at its own rate, so a brush running out loses hairs one at a time rather than fading
        // evenly — the straw look at the end of a long drag is hairs dropping out, not pigment thinning.
        float Spend = uMediaD.x * mix(0.45, 1.65, Hash11(Cell * 7.91 + uMediaC.w * 5.0));
        // 🔴 The floor is not a fudge: a spent hair is not a clean hair. It keeps staining the paper long after it
        //    has stopped laying paint, which is why a dry-brush drag trails off instead of being cut square.
        float Hair = clamp(1.0 - Spend * clamp(Along / max(uMediaD.y, 1e-3), 0.0, 1.0), 0.08, 1.0);
        // And a hair with little left on it only reaches the peaks of the paper. Water fills the valleys, so a loaded
        // brush lays a wash and the same brush three strokes later lays scaffolding.
        float Skip = smoothstep(1.0 - Hair - 0.3, 1.0 - Hair + 0.3, Tooth * 0.75 + 0.3);
        float Bite = mix(Skip, 1.0, clamp(uMediaB.w, 0.0, 1.0));
        // 🔴 Paint bridges between the hairs while there is enough of it. A loaded head lays a CONTINUOUS film with
        //    the hairs showing as ridges in it, and only an emptying one rakes holes in what it lays — which is the
        //    difference between a brush mark and the scrubbed-out dry-brush look every naive comb produces.
        float Bare = clamp(0.18 + 0.9 * (1.0 - Hair), 0.0, 1.0) * (1.0 - clamp(uMediaB.w, 0.0, 1.0) * 0.85);
        float Comb = mix(1.0, mix(0.25, 1.0, Pick) * Ridge, Bare);
        float Streak = mix(1.0, 0.45 + 0.55 * Fibre, Bare * 0.8);
        float Shape = 1.0 - smoothstep(mix(0.0, 0.96, Hardness * mix(0.75, 1.0, Press)), 1.0, Rim);
        float Alpha = Shape * mix(Comb, 1.0, 0.12) * Streak * Hair * Bite * mix(0.45, 1.0, Press);
        float Wet = clamp(uMediaB.w, 0.0, 1.0);
        float Shade = 1.0 - 0.18 * Wet * smoothstep(0.5, 1.0, Rim) + 0.04 * (1.0 - Press) - 0.05 * (1.0 - Pick) * (1.0 - Wet);
        // A loaded hair drags a ridge of paint with a furrow either side of it, and the furrow is the rougher of the
        // two. Water flattens both: a wash is level and even, which is exactly why it looks like a wash.
        float Relief = (Ridge - 0.45) * 0.17 * (1.0 - Wet * 0.7) * Hair * mix(0.6, 1.0, Press);
        float Grit = (1.0 - Ridge) * 0.13 * (1.0 - Wet);
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    if (uMedium == 2)
    {
        // Graphite. Lead cannot reach into a valley of the paper, so the tooth decides where the mark is; pressure and
        // grade decide how far down the sides of those valleys it gets.
        float Spread = 1.0 + 1.3 * uMediaC.y;
        float Reach = 1.0 - smoothstep(mix(0.25, 0.9, Hardness) * Spread, Spread, Rim);
        float Bite = clamp(Press * uMediaC.x * mix(1.0, 0.55, uMediaC.y), 0.0, 1.0);
        float Cover = clamp(Bite * mix(0.55, 1.0, Reach), 0.0, 1.0);
        float Gate = smoothstep(1.0 - Cover - 0.28, 1.0 - Cover + 0.24, Tooth + 0.16 * Fibre - 0.08);
        float Alpha = Reach * mix(Cover, Gate, uMediaA.x);
        float Shade = mix(1.02, 0.80, clamp(Cover * 0.6 + 0.4 * Tooth, 0.0, 1.0));
        // 🔴 Burnish. Graphite is flakes of a semimetal and a hard stroke lays them flat: the patch goes smoother
        //    and shinier the harder it is pressed, which is why a pencil drawing has a sheen in its dark passages
        //    and none in the light ones.
        float Burnish = clamp(Press * uMediaC.x * (1.0 - uMediaC.y), 0.0, 1.0) * Alpha;
        float Relief = (Tooth - 0.5) * 0.05 * Alpha - Burnish * 0.02;
        float Grit = -0.26 * Burnish + 0.06 * (1.0 - Alpha) * uMediaA.x;
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    if (uMedium == 3)
    {
        // Ink. A hard wet edge, and past it the fibres of the paper drinking what the nib left behind.
        float Core = 1.0 - smoothstep(mix(0.6, 0.94, Hardness), 1.0, Rim);
        float Halo = (1.0 - smoothstep(1.0, 1.0 + 1.8 * uMediaA.w, Rim)) * uMediaA.w * (0.18 + 0.5 * Fibre);
        float Skip = mix(1.0, 0.55 + 0.45 * Fibre, uMediaA.x) * Load;
        float Alpha = clamp(Core * Skip + Halo * (1.0 - Core), 0.0, 1.0) * mix(0.82, 1.0, Press);
        float Shade = mix(1.0, 0.94, Halo);
        // Ink sinks into the sheet rather than sitting on it: level where it pooled, and the film it leaves behind
        // is smoother than the fibres it soaked into. The feathered halo is paper, so it keeps the paper's grit.
        float Relief = -0.015 * Core;
        float Grit = -0.09 * Core + 0.05 * Halo;
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    if (uMedium == 4)
    {
        // Felt. Flat colour laid by a bundle of fibres, with solvent pushing a darker rim out to the edge of the mark —
        // the wet edge every marker drawing has and no flat-colour brush ever produces.
        float Core = 1.0 - smoothstep(mix(0.55, 0.92, Hardness), 1.0, Rim);
        float Streak = mix(1.0, 0.72 + 0.28 * Fibre, 0.55);
        float Halo = (1.0 - smoothstep(1.0, 1.0 + 1.5 * uMediaA.w, Rim)) * uMediaA.w * 0.55;
        float Alpha = clamp(Core * Streak * Load + Halo * (1.0 - Core), 0.0, 1.0);
        float Rimness = smoothstep(0.45, 0.95, Rim) * Core;
        float Shade = mix(1.0, 0.80, Rimness * mix(0.4, 1.0, uMediaA.w));
        // The wet edge is a bead: it dries slightly proud of the flat middle, and slightly glossier with it.
        float Relief = Rimness * 0.035 * mix(0.4, 1.0, uMediaA.w);
        float Grit = -0.06 * Core - 0.04 * Rimness;
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    if (uMedium == 5)
    {
        // Dry pigment. The tooth again, coarser, with nothing holding the pigment together — so it sheds: specks land
        // outside the mark and the edge of a chalk line is never a line.
        float Reach = 1.0 - smoothstep(mix(0.2, 0.85, Hardness), 1.0, Rim);
        float Cover = clamp(Press * uMediaC.x * Reach, 0.0, 1.0);
        float Gate = smoothstep(1.0 - Cover - 0.38, 1.0 - Cover + 0.30, Tooth);
        float Dust = step(1.0 - 0.1 * uMediaA.z, Speck)
                   * (1.0 - smoothstep(0.8, 1.0 + 1.6 * uMediaA.z, Rim))
                   * (0.35 + 0.5 * Press);
        float Alpha = max(Reach * mix(Cover, Gate, uMediaA.x) * Load, Dust);
        float Shade = mix(1.05, 0.82, Cover);
        // 🔴 Chalk is loose pigment with nothing binding it: every grain sits on top of the tooth it was crushed
        //    into and every grain scatters. This is the roughest thing the editor can lay down and the only medium
        //    rougher than the paper under it — a chalk line that is not is a grey pencil line.
        float Grain = clamp((Tooth - 0.4) * 1.6, 0.0, 1.0);
        float Relief = Alpha * (0.055 + 0.085 * Grain) + Dust * 0.03;
        float Grit = Alpha * (0.2 + 0.14 * Grain) * mix(0.6, 1.0, uMediaC.x);
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    if (uMedium == 6)
    {
        // Wax. Stiff enough to bridge the valleys instead of filling them, until the heat of a hard stroke melts it in.
        float Reach = 1.0 - smoothstep(mix(0.45, 0.92, Hardness), 1.0, Rim);
        float Cover = clamp(Press * 1.05, 0.0, 1.0);
        // 🔴 The threshold never reaches zero: wax bridges the valleys of the paper however hard it is pushed, and a
        //    crayon line that fills in completely at full pressure is a felt pen with a different label.
        float Ridge = 0.3 + 0.55 * (1.0 - Cover);
        float Gate = smoothstep(Ridge - 0.16, Ridge + 0.14, Tooth);
        float Filled = mix(Gate, 1.0, clamp(uMediaC.z * Press * 1.3, 0.0, 1.0));
        float Alpha = Reach * mix(Cover, Filled, uMediaA.x) * Load;
        float Shade = mix(1.0, 1.07, uMediaC.z * 0.6 * Alpha);
        // Wax is laid ON the paper, so it is the thickest film of the six — and melting it with a hard stroke is
        // what turns a dusty crayon line into the waxy sheen a crayon actually has.
        float Melted = clamp(uMediaC.z * Press * 1.3, 0.0, 1.0);
        // 🔴 Wax piles on the peaks it bridges and barely reaches the valleys between them, and the stick drags the
        //    film into streaks as it goes — a crayon mark of one even thickness is a sticker of a crayon mark.
        float Peak = clamp((Tooth - 0.42) * 1.7, 0.0, 1.0);
        float Relief = Alpha * (0.06 + 0.11 * Peak) * (0.55 + 0.45 * (1.0 - Melted)) * mix(0.82, 1.18, Fibre);
        float Grit = Alpha * (0.07 * (1.0 - Gate) - 0.24 * Melted);
        return vec4(clamp(Alpha, 0.0, 1.0), clamp(Shade, 0.7, 1.08), Relief, Grit);
    }

    // Plain: the soft round dab the pass drew before any of this existed, kept as medium zero so an untouched project
    // paints exactly as it used to and an unset uniform cannot accidentally mean charcoal.
    return vec4(clamp(1.0 - smoothstep(mix(0.0, 0.94, Hardness), 1.0, Rim), 0.0, 1.0), 1.0, 0.0, 0.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ④ Brush stamping — distance to the stroke segment measured on the baked surface, not in UV.
//--------------------------------------------------------------------------------------------------------------------------
export const StampFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uPositionSource;
uniform sampler2D uNormalSource;
uniform vec3 uStrokeStart;
uniform vec3 uStrokeEnd;
uniform vec3 uStrokeNormal;
uniform vec3 uStrokeColour;
uniform vec2 uStrokeStartPlane;
uniform vec2 uStrokeEndPlane;
uniform float uRadius;
uniform float uPlaneRadius;
uniform float uHardness;
uniform float uFlow;
uniform float uFacingLimit;
uniform float uAlphaJitter;
uniform int uStampMode;        // 0 surface · 1 texture space · 2 decal burned in · 3 gradient · 4 flat gradient · 5 flat burn
uniform vec4 uGradient;        // shape (0 linear, 1 radial), easing, reverse, wrap all the way round
uniform float uGradientEdge;   // how soft the ends of the fade are
// The colours the fade runs through: rgb and the place along the axis each one sits at. A count of zero means there is
// no ramp in hand and the gradient does what it always did — fade the colour in hand away to nothing.
uniform vec4 uRampStops[8];
uniform int uRampCount;
// 🔴 Which image this draw is allowed to write, or −1 for the usual all-four draw. The hardware can mask components of
//    ONE attachment at a time, so a stroke that writes some channels and not others is drawn once per image with the
//    chosen one routed to location 0 and the colour mask doing the rest.
uniform int uSlot;
uniform sampler2D uStampDecal;
uniform vec3 uStampCentre;
uniform vec3 uStampAxis;
uniform vec3 uStampEdge;
uniform vec2 uStampSpan;
uniform float uStampReach;
uniform float uStampSoftness;
uniform float uStampColourise;
uniform vec4 uStampPlane;      // texture space: centre.xy, rotation in radians, spare
uniform vec4 uStrokePress;     // pressure at the segment's start and end, travel in metres at each
// Which ground this dab is allowed to claim. xyz is the direction the segment BEFORE this one ran in and w says
// whether there was one; uStrokeCap turns the dab into the closing cap of the whole stroke.
uniform vec4 uStrokeBefore;
uniform float uStrokeCap;

// The channel values this dab is carrying. They go down with the paint, premultiplied by the same alpha, so that the
// ordinary source-over blend leaves each texel holding whatever the last thing to cover it was carrying.
uniform vec4 uPaintSurfacing;  // roughness, metalness, occlusion, height
uniform vec4 uPaintCoating;    // specular weight, coat weight, coat roughness, fuzz weight
uniform vec4 uPaintRadiance;   // emission rgb, transmission

layout(location = 0) out vec4 oCoverage;
layout(location = 1) out vec4 oSurfacing;
layout(location = 2) out vec4 oCoating;
layout(location = 3) out vec4 oRadiance;

// Everything a dab puts down, in packing order, routed to wherever this draw is allowed to put it.
// 🔴 Grain is the medium's own microstructure — (relief, grit) out of MediaDeposit — added to the height and the
//    roughness the brush writes before either is weighted by coverage. Without it every stroke of a medium is one
//    roughness and one height from rim to rim, and a surface that is uniformly rough reads as plastic however well
//    the colour is painted. A decal, a gradient and the plain dab all pass zero and land exactly as they always did.
void Emit(vec4 Cover, float Alpha, vec2 Grain)
{
    vec4 Paint = uPaintSurfacing;
    Paint.x = clamp(Paint.x + Grain.y, 0.0, 1.0);
    Paint.w = clamp(Paint.w + Grain.x, 0.0, 1.0);
    vec4 Surfacing = Paint * Alpha;
    vec4 Coating = uPaintCoating * Alpha;
    vec4 Radiance = uPaintRadiance * Alpha;
    if (uSlot >= 0)
    {
        oCoverage = uSlot == 0 ? Cover : uSlot == 1 ? Surfacing : uSlot == 2 ? Coating : Radiance;
        return;
    }
    oCoverage = Cover;
    oSurfacing = Surfacing;
    oCoating = Coating;
    oRadiance = Radiance;
}

// 🔴 Which segment owns a texel. A stroke is a path, not a pile of dabs: every segment covers a whole capsule of
//    paint, and at a tenth of a radius between them forty of them cover the same texel. Compositing all forty is
//    what turned a brush into an airbrush — the comb of a head survives one deposit and nothing survives forty, so
//    the card's ribbon and the surface showed two different instruments. A segment therefore keeps only the ground
//    between its own two ends: the first dab of a stroke keeps the round cap behind it, the closing dab keeps the
//    one in front, and the wedge on the outside of a turn goes to the segment whose predecessor could not reach it.
//    Place is how far along this segment the texel sits, in spans; Past is how far beyond the previous segment's
//    end it sits, which is positive only where that segment gave up.
bool OwnsTexel(float Place, float Past)
{
    if (uStrokeCap > 0.5) return Place > 1.0;
    if (Place > 1.0) return false;
    if (Place < 0.0 && uStrokeBefore.w > 0.5 && Past <= 0.0) return false;
    return true;
}

float GradientRamp(float Fraction)
{
    float T = clamp(Fraction, 0.0, 1.0);
    if (uGradient.y < 0.5) return T;                                 // even
    if (uGradient.y < 1.5) return T * T * (3.0 - 2.0 * T);           // smooth
    if (uGradient.y < 2.5) return T * T;                             // ease in
    return 1.0 - (1.0 - T) * (1.0 - T);                              // ease out
}

// The colour at one place along the ramp. Walked rather than searched: eight is few enough that a loop over all of
// them is cheaper than a branch, and the LAST pair whose low stop is at or behind this texel is the one that wins —
// which is also why a texel before the first stop keeps the first colour and one past the last keeps the last.
vec3 RampColour(float Where)
{
    vec3 Ink = uRampStops[0].rgb;
    for (int Index = 1; Index < 8; Index += 1)
    {
        if (Index >= uRampCount) break;
        vec4 Low = uRampStops[Index - 1];
        vec4 High = uRampStops[Index];
        float Share = clamp((Where - Low.w) / max(High.w - Low.w, 1e-5), 0.0, 1.0);
        Ink = mix(Ink, mix(Low.rgb, High.rgb, Share), step(Low.w, Where));
    }
    return Ink;
}
void main()
{
    vec4 Sample = texture(uPositionSource, vCoordinate);

    // A gradient is not a stroke: it covers the whole sheet in one pass and fades along the axis between the two
    // points the hand dragged between. Everything else a dab carries — colour, channel values, flow — it carries too.
    if (uStampMode == 3 || uStampMode == 4)
    {
        // In texture space the fade runs between two UV points and every texel of the sheet is fair game, gutters
        // included; on the surface it runs between two places on the model and only texels the model owns are lit.
        bool Flat = uStampMode == 4;
        if (!Flat && Sample.w < 0.5) discard;
        vec3 Position = Sample.xyz;
        vec3 Axis = uStrokeEnd - uStrokeStart;
        vec2 FlatAxis = uStrokeEndPlane - uStrokeStartPlane;
        float Span = Flat ? length(FlatAxis) : length(Axis);
        if (Span < 1e-6) discard;
        float Fraction = uGradient.x < 0.5
            ? (Flat
                ? clamp(dot(vCoordinate - uStrokeStartPlane, FlatAxis) / (Span * Span), 0.0, 1.0)
                : clamp(dot(Position - uStrokeStart, Axis) / (Span * Span), 0.0, 1.0))
            : (Flat
                ? clamp(length(vCoordinate - uStrokeStartPlane) / Span, 0.0, 1.0)
                : clamp(length(Position - uStrokeStart) / Span, 0.0, 1.0));
        if (uGradient.z > 0.5) Fraction = 1.0 - Fraction;
        float Ramp = 1.0 - GradientRamp(Fraction);
        // The far end is allowed to reach zero and stop; a soft edge widens the part of the axis that is doing the
        // fading, so the same drag can be a hard wipe or a long breath.
        Ramp = pow(max(Ramp, 0.0), mix(2.2, 0.45, clamp(uGradientEdge, 0.0, 1.0)));
        float Face = 1.0;
        if (!Flat && uGradient.w < 0.5)
        {
            vec3 Normal = normalize(texture(uNormalSource, vCoordinate).xyz);
            Face = smoothstep(uFacingLimit, mix(uFacingLimit, 1.0, 0.45), dot(Normal, uStrokeNormal));
        }
        // With colours in play the paint does not fade out, it changes: full coverage all the way along, and the ramp
        // decides which colour is on the texel. Without them the ramp IS the coverage, which is a wash.
        vec3 Ink = clamp(uStrokeColour, 0.0, 1.0);
        float Wash = clamp(Ramp * Face * uFlow, 0.0, 1.0);
        if (uRampCount > 1)
        {
            Ink = clamp(RampColour(clamp(1.0 - Ramp, 0.0, 1.0)), 0.0, 1.0);
            Wash = clamp(Face * uFlow, 0.0, 1.0);
        }
        if (Wash <= 0.0015) discard;
        Emit(vec4(Ink * Wash, Wash), Wash, vec2(0.0));
        return;
    }

    // The same burn, laid flat: the artwork goes onto the sheet in UV, so it crosses no seam and needs no model.
    if (uStampMode == 5)
    {
        vec2 Delta = vCoordinate - uStampPlane.xy;
        float Cosine = cos(uStampPlane.z);
        float Sine = sin(uStampPlane.z);
        vec2 Turned = vec2(Delta.x * Cosine + Delta.y * Sine, -Delta.x * Sine + Delta.y * Cosine);
        vec2 Local = Turned / max(uStampSpan, vec2(1e-4)) + 0.5;
        vec2 Inside = step(vec2(0.0), Local) * step(Local, vec2(1.0));
        vec4 Artwork = texture(uStampDecal, vec2(Local.x, 1.0 - Local.y));
        float Rim = smoothstep(0.0, max(uStampSoftness, 0.001), Artwork.a);
        float Laid = clamp(Artwork.a * Rim * Inside.x * Inside.y * uFlow, 0.0, 1.0);
        if (Laid <= 0.0015) discard;
        vec3 Pigment = mix(Artwork.rgb, uStrokeColour, uStampColourise);
        Emit(vec4(Pigment * Laid, Laid), Laid, vec2(0.0));
        return;
    }

    // A stamped decal is paint, not a projector: the artwork is burned into the layer the moment it is placed.
    if (uStampMode == 2)
    {
        if (Sample.w < 0.5) discard;
        vec3 Position = Sample.xyz;
        vec3 Normal = normalize(texture(uNormalSource, vCoordinate).xyz);
        vec3 Bitangent = normalize(cross(uStampAxis, uStampEdge));
        vec3 Delta = Position - uStampCentre;
        vec2 Local = vec2(dot(Delta, uStampEdge) / max(uStampSpan.x, 1e-4), dot(Delta, Bitangent) / max(uStampSpan.y, 1e-4)) + 0.5;
        vec2 Within = step(vec2(0.0), Local) * step(Local, vec2(1.0));
        float Depth = abs(dot(Delta, uStampAxis));
        float Reach = 1.0 - smoothstep(uStampReach * 0.65, uStampReach, Depth);
        float Face = smoothstep(uFacingLimit, mix(uFacingLimit, 1.0, 0.45), dot(Normal, uStampAxis));
        vec4 Stencil = texture(uStampDecal, vec2(Local.x, 1.0 - Local.y));
        float Edge = smoothstep(0.0, max(uStampSoftness, 0.001), Stencil.a);
        float Burn = clamp(Stencil.a * Edge * Within.x * Within.y * Reach * Face * uFlow, 0.0, 1.0);
        if (Burn <= 0.0015) discard;
        vec3 Ink = mix(Stencil.rgb, uStrokeColour, uStampColourise);
        Emit(vec4(Ink * Burn, Burn), Burn, vec2(0.0));
        return;
    }

    // The stroke's own frame: how far along the segment this texel sits, and how far to which side of it. The side is
    // SIGNED because a bristle needs to know which hair it is under — an unsigned distance can only draw a tube.
    float Side = 0.0;
    float Travel = 0.0;
    float Facing = 1.0;
    float Radius = uRadius;
    vec3 Anchor = vec3(vCoordinate, 0.0);
    if (uStampMode == 1)
    {
        vec2 Segment = uStrokeEndPlane - uStrokeStartPlane;
        float Span = length(Segment);
        vec2 Ahead = Span > 1e-6 ? Segment / Span : vec2(1.0, 0.0);
        float Place = Span > 1e-6 ? dot(vCoordinate - uStrokeStartPlane, Ahead) / Span : 0.0;
        if (!OwnsTexel(Place, dot(vCoordinate - uStrokeStartPlane, uStrokeBefore.xy))) discard;
        Travel = clamp(Place, 0.0, 1.0);
        vec2 Offset = vCoordinate - (uStrokeStartPlane + Segment * Travel);
        Side = length(Offset) * (dot(Offset, vec2(-Ahead.y, Ahead.x)) < 0.0 ? -1.0 : 1.0);
        Radius = uPlaneRadius;
    }
    else
    {
        if (Sample.w < 0.5) discard;
        vec3 Position = Sample.xyz;
        vec3 Normal = normalize(texture(uNormalSource, vCoordinate).xyz);
        vec3 Segment = uStrokeEnd - uStrokeStart;
        float Span = length(Segment);
        vec3 Ahead = Span > 1e-6 ? Segment / Span : vec3(0.0);
        // A stroke that has not moved yet, or one dragged straight into the surface, still has to pick a side: any
        // tangent will do, so long as it is the same one for every texel of the dab.
        vec3 Sideways = cross(Normal, Ahead);
        if (dot(Sideways, Sideways) < 1e-10)
            Sideways = cross(Normal, abs(Normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
        Sideways = normalize(Sideways);
        float Place = Span > 1e-6 ? dot(Position - uStrokeStart, Ahead) / Span : 0.0;
        if (!OwnsTexel(Place, dot(Position - uStrokeStart, uStrokeBefore.xyz))) discard;
        Travel = clamp(Place, 0.0, 1.0);
        vec3 Offset = Position - (uStrokeStart + Segment * Travel);
        Side = length(Offset) * (dot(Offset, Sideways) < 0.0 ? -1.0 : 1.0);
        Facing = smoothstep(uFacingLimit, mix(uFacingLimit, 1.0, 0.45), dot(Normal, uStrokeNormal));
        Anchor = Position;
    }

    // Pressure interpolates along the segment, so one drag thins and swells the way the hand did.
    float Press = clamp(mix(uStrokePress.x, uStrokePress.y, Travel), 0.0, 1.0);
    float Along = mix(uStrokePress.z, uStrokePress.w, Travel);
    Radius *= 1.0 - uMediaB.z * (1.0 - Press);
    Radius = max(Radius, 1e-6);

    // 🔴 Reject before any noise is sampled. The pass covers the whole sheet for every segment; the handful of texels
    //    the mark can reach are the only ones worth three octaves of value noise.
    float Across = Side / Radius;
    if (abs(Across) > MediaExtent()) discard;

    float Tooth = 0.5;
    float Fibre = 0.5;
    float Speck = 0.0;
    if (uMedium != 0)
    {
        vec3 Paper = Anchor * uMediaA.y;
        Tooth = ValueNoise3(Paper) * 0.65 + ValueNoise3(Paper * 2.17 + vec3(11.3, -7.1, 3.9)) * 0.35;
        // 🔴 A fibre drags a streak ALONG the stroke. Sampling the noise fast in the travel direction and slowly
        //    across the head gave the opposite — bands marching across the mark like a comb pulled sideways.
        Fibre = ValueNoise(vec2(Along * uMediaD.z * 0.05, Across * 6.0 + uMediaC.w * 17.0));
        Speck = Hash21(vCoordinate * 1024.0 + uMediaC.w);
    }

    vec4 Media = MediaDeposit(Across, Along, Press, uHardness, Tooth, Fibre, Speck);
    if (Media.x <= 0.0) discard;
    float Jitter = mix(1.0, 0.65 + 0.35 * Hash21(vCoordinate * 512.0), uAlphaJitter);
    float Alpha = clamp(Media.x * Facing * uFlow * Jitter, 0.0, 1.0);
    if (Alpha <= 0.0015) discard;
    Emit(vec4(clamp(uStrokeColour * Media.y, 0.0, 1.0) * Alpha, Alpha), Alpha, Media.zw);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ⑤ Compositor — one layer per invocation, four RGBA8 targets in, four out.
//--------------------------------------------------------------------------------------------------------------------------
//--------------------------------------------------------------------------------------------------------------------------
// Settle — gives paint already on the sheet the channel values it was laid down with. Run once, when a layer that has
// been uniform until now is handed a second set of values and has to start keeping them per texel.
//--------------------------------------------------------------------------------------------------------------------------
export const SettleFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uCoverageSource;
uniform vec4 uSettleSurfacing;
uniform vec4 uSettleCoating;
uniform vec4 uSettleRadiance;
layout(location = 0) out vec4 oSurfacing;
layout(location = 1) out vec4 oCoating;
layout(location = 2) out vec4 oRadiance;
void main()
{
    float Alpha = texture(uCoverageSource, vCoordinate).a;
    oSurfacing = uSettleSurfacing * Alpha;
    oCoating = uSettleCoating * Alpha;
    oRadiance = uSettleRadiance * Alpha;
}
`;

export const CompositeFragment = /* glsl */ `
in vec2 vCoordinate;

uniform sampler2D uLower0;
uniform sampler2D uLower1;
uniform sampler2D uLower2;
uniform sampler2D uLower3;
uniform sampler2D uCoverageMap;
uniform sampler2D uSurfacingMap;
uniform sampler2D uCoatingMap;
uniform sampler2D uRadianceMap;
uniform sampler2D uDecalMap;
uniform sampler2D uMaskMap;
uniform float uPainted;         // 1 when the layer keeps its channel values per texel rather than as constants

uniform int uKind;              // 0 fill · 1 stroke · 2 decal · 3 generator · 4 finish
uniform int uBlend;
uniform float uOpacity;
uniform float uEnabled[12];
uniform vec3 uBaseColour;
uniform vec3 uEmissionColour;
uniform float uScalar[10];      // roughness, metalness, occlusion, height, specular, coat, coatRough, fuzz, transmission, opacity

uniform vec4 uGeneratorA;       // scale, detail, contrast, balance
uniform vec4 uGeneratorB;       // warp, angle, seed, invert
uniform int uGeneratorKind;

uniform int uMaskKind;          // 0 none · 1 painted · 2 generator · 3 colour
uniform vec4 uMaskA;
uniform vec4 uMaskB;
uniform int uMaskField;
uniform float uMaskInvert;
uniform vec3 uMaskColour;
uniform float uMaskTolerance;
uniform float uMaskSoftness;
uniform sampler2D uMaskSheet;   // the generator stack, already solved into texture space
uniform float uMaskSheeted;     // 1 when that stack has anything in it

uniform int uFinishFamily;
uniform int uFinishStyle;
uniform vec3 uFinishColourA;
uniform vec3 uFinishColourB;
uniform vec4 uFinishShape;      // scale, density, strength, gloss
uniform vec4 uFinishTrim;       // coat, angle, variation, seed
uniform vec4 uFinishExtra;      // orange peel, reserved, reserved, reserved

uniform int uDecalMode;         // 0 projection · 1 UV plane
uniform vec3 uDecalPosition;
uniform vec3 uDecalNormal;
uniform vec3 uDecalTangent;
uniform vec2 uDecalSize;
uniform float uDecalDepth;
uniform float uDecalFacing;
uniform float uDecalSoftness;
uniform vec4 uDecalPlane;       // centre.xy, size, rotation
uniform float uDecalPlaneAspect;
uniform vec3 uDecalTint;
uniform float uDecalColorise;
uniform float uDecalEmboss;

uniform vec4 uScope;            // left, bottom, size of the object's tile; w on or off

layout(location = 0) out vec4 oChannel0;
layout(location = 1) out vec4 oChannel1;
layout(location = 2) out vec4 oChannel2;
layout(location = 3) out vec4 oChannel3;

void main()
{
    vec4 Lower0 = texture(uLower0, vCoordinate);
    vec4 Lower1 = texture(uLower1, vCoordinate);
    vec4 Lower2 = texture(uLower2, vCoordinate);
    vec4 Lower3 = texture(uLower3, vCoordinate);

    vec4 Surface = texture(uPositionMap, vCoordinate);
    vec3 Position = Surface.xyz;
    vec3 Normal = normalize(texture(uNormalMap, vCoordinate).xyz + vec3(1e-6));
    vec4 Field = texture(uFieldMap, vCoordinate);

    float Coverage = 1.0;
    vec3 Colour = uBaseColour;
    float Emboss = 0.0;

    // Channel values a layer writes. Constants for every kind except a finish, which produces them per texel.
    float RoughnessValue = uScalar[0];
    float MetalnessValue = uScalar[1];
    float OcclusionValue = uScalar[2];
    float SpecularValue = uScalar[4];
    float CoatValue = uScalar[5];
    float CoatRoughnessValue = uScalar[6];
    float FuzzValue = uScalar[7];
    float HeightValue = uScalar[3];
    vec3 EmissionColour = uEmissionColour;
    float TransmissionValue = uScalar[8];

    if (uKind == 1)
    {
        vec4 Painted = texture(uCoverageMap, vCoordinate);
        Coverage = Painted.a;
        Colour = Painted.a > 0.0019 ? Painted.rgb / Painted.a : uBaseColour;
        // Each stroke left its own channel values behind, stored premultiplied by the coverage that carried them.
        if (uPainted > 0.5 && Painted.a > 0.0019)
        {
            float Share = 1.0 / Painted.a;
            vec4 Surfacing = texture(uSurfacingMap, vCoordinate) * Share;
            vec4 Coating = texture(uCoatingMap, vCoordinate) * Share;
            vec4 Radiance = texture(uRadianceMap, vCoordinate) * Share;
            RoughnessValue = Surfacing.r;
            MetalnessValue = Surfacing.g;
            OcclusionValue = Surfacing.b;
            HeightValue = Surfacing.a;
            SpecularValue = Coating.r;
            CoatValue = Coating.g;
            CoatRoughnessValue = Coating.b;
            FuzzValue = Coating.a;
            EmissionColour = Radiance.rgb;
            TransmissionValue = Radiance.a;
        }
    }
    else if (uKind == 2)
    {
        vec2 Local;
        float Gate = 1.0;
        if (uDecalMode == 0)
        {
            vec3 Bitangent = normalize(cross(uDecalNormal, uDecalTangent));
            vec3 Delta = Position - uDecalPosition;
            Local = vec2(dot(Delta, uDecalTangent) / max(uDecalSize.x, 1e-4), dot(Delta, Bitangent) / max(uDecalSize.y, 1e-4)) + 0.5;
            float Depth = dot(Delta, uDecalNormal);
            float DepthFade = 1.0 - smoothstep(uDecalDepth * 0.65, uDecalDepth, abs(Depth));
            float Facing = smoothstep(uDecalFacing, mix(uDecalFacing, 1.0, 0.4), dot(Normal, uDecalNormal));
            Gate = DepthFade * Facing;
        }
        else
        {
            vec2 Centred = (vCoordinate - uDecalPlane.xy);
            Centred = Rotate(Centred, radians(uDecalPlane.w));
            Local = Centred / max(uDecalPlane.z, 1e-4) * vec2(1.0, uDecalPlaneAspect) + 0.5;
        }
        vec2 Inside = step(vec2(0.0), Local) * step(Local, vec2(1.0));
        vec4 Stencil = texture(uDecalMap, vec2(Local.x, 1.0 - Local.y));
        float Edge = smoothstep(0.0, max(uDecalSoftness, 0.001), Stencil.a);
        Coverage = Stencil.a * Edge * Inside.x * Inside.y * Gate;
        Colour = mix(Stencil.rgb, uDecalTint, uDecalColorise);
        Emboss = Coverage * uDecalEmboss;
    }
    else if (uKind == 3)
    {
        Coverage = SampleGenerator(
            uGeneratorKind, vCoordinate, Position, Normal, Field,
            uGeneratorA.x, int(uGeneratorA.y), uGeneratorA.z, uGeneratorA.w,
            uGeneratorB.x, uGeneratorB.y, uGeneratorB.z, uGeneratorB.w);
    }
    else if (uKind == 4)
    {
        FinishSample Finish = SampleFinish(
            uFinishFamily, uFinishStyle, vCoordinate, Position, Normal, Field,
            uFinishColourA, uFinishColourB, uFinishShape, uFinishTrim, uFinishExtra);
        Colour = Finish.Colour;
        RoughnessValue = Finish.Roughness;
        MetalnessValue = Finish.Metalness;
        OcclusionValue = Finish.Occlusion * uScalar[2];
        SpecularValue = Finish.Specular * uScalar[4];
        CoatValue = Finish.Coat;
        CoatRoughnessValue = Finish.CoatRoughness;
        FuzzValue = Finish.Fuzz;
        HeightValue = Finish.Height;
    }

    if (uMaskKind > 0)
        Coverage *= SampleMask(
            uMaskKind, texture(uMaskMap, vCoordinate).a, vCoordinate, Position, Normal, Field,
            uMaskField, uMaskA, uMaskB, Lower0.rgb, uMaskColour, uMaskTolerance, uMaskSoftness, uMaskInvert,
            texture(uMaskSheet, vCoordinate).r, uMaskSheeted);

    // A layer scoped to one object only touches that object's tile of the sheet.
    if (uScope.w > 0.5)
    {
        vec2 Inside = step(vec2(uScope.x, uScope.y), vCoordinate) * step(vCoordinate, vec2(uScope.x, uScope.y) + uScope.z);
        Coverage *= Inside.x * Inside.y;
    }

    Coverage = clamp(Coverage * uOpacity, 0.0, 1.0) * Surface.w;
    if (Coverage <= 0.0)
    {
        oChannel0 = Lower0;
        oChannel1 = Lower1;
        oChannel2 = Lower2;
        oChannel3 = Lower3;
        return;
    }

    float Height = HeightValue + Emboss;

    vec3 BaseColour = mix(Lower0.rgb, BlendColour(uBlend, Lower0.rgb, Colour), Coverage * uEnabled[0]);
    float Opacity = mix(Lower0.a, BlendScalar(uBlend, Lower0.a, uScalar[9]), Coverage * uEnabled[1]);
    float Roughness = mix(Lower1.r, BlendScalar(uBlend, Lower1.r, RoughnessValue), Coverage * uEnabled[2]);
    float Metalness = mix(Lower1.g, BlendScalar(uBlend, Lower1.g, MetalnessValue), Coverage * uEnabled[3]);
    float Occlusion = mix(Lower1.b, BlendScalar(uBlend, Lower1.b, OcclusionValue), Coverage * uEnabled[4]);
    float Elevation = mix(Lower1.a, BlendScalar(uBlend, Lower1.a, Height), Coverage * uEnabled[5]);
    float Specular = mix(Lower2.r, BlendScalar(uBlend, Lower2.r, SpecularValue), Coverage * uEnabled[6]);
    float Coat = mix(Lower2.g, BlendScalar(uBlend, Lower2.g, CoatValue), Coverage * uEnabled[7]);
    float CoatRoughness = mix(Lower2.b, BlendScalar(uBlend, Lower2.b, CoatRoughnessValue), Coverage * uEnabled[8]);
    float Fuzz = mix(Lower2.a, BlendScalar(uBlend, Lower2.a, FuzzValue), Coverage * uEnabled[9]);
    vec3 Emission = mix(Lower3.rgb, BlendColour(uBlend, Lower3.rgb, EmissionColour), Coverage * uEnabled[10]);
    float Transmission = mix(Lower3.a, BlendScalar(uBlend, Lower3.a, TransmissionValue), Coverage * uEnabled[11]);

    oChannel0 = vec4(clamp(BaseColour, 0.0, 1.0), clamp(Opacity, 0.0, 1.0));
    oChannel1 = clamp(vec4(Roughness, Metalness, Occlusion, Elevation), 0.0, 1.0);
    oChannel2 = clamp(vec4(Specular, Coat, CoatRoughness, Fuzz), 0.0, 1.0);
    oChannel3 = vec4(clamp(Emission, 0.0, 1.0), clamp(Transmission, 0.0, 1.0));
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ⑤b Mask preview — the selected layer's mask evaluated on its own so the viewport can show it or tint by it.
//--------------------------------------------------------------------------------------------------------------------------
export const MaskFragment = /* glsl */ `
in vec2 vCoordinate;

uniform sampler2D uMaskMap;
uniform sampler2D uLower0;

uniform int uMaskKind;
uniform vec4 uMaskA;
uniform vec4 uMaskB;
uniform int uMaskField;
uniform float uMaskInvert;
uniform vec3 uMaskColour;
uniform float uMaskTolerance;
uniform float uMaskSoftness;
uniform sampler2D uMaskSheet;   // the generator stack, already solved into texture space
uniform float uMaskSheeted;     // 1 when that stack has anything in it

out vec4 oMask;

void main()
{
    vec4 Surface = texture(uPositionMap, vCoordinate);
    vec3 Position = Surface.xyz;
    vec3 Normal = normalize(texture(uNormalMap, vCoordinate).xyz + vec3(1e-6));
    vec4 Field = texture(uFieldMap, vCoordinate);
    float Mask = SampleMask(
        uMaskKind, texture(uMaskMap, vCoordinate).a, vCoordinate, Position, Normal, Field,
        uMaskField, uMaskA, uMaskB, texture(uLower0, vCoordinate).rgb,
        uMaskColour, uMaskTolerance, uMaskSoftness, uMaskInvert,
        texture(uMaskSheet, vCoordinate).r, uMaskSheeted);
    oMask = vec4(vec3(Mask), Mask);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ⑥ Viewport shading — OpenPBR Surface slab evaluation over the composited channels.
//--------------------------------------------------------------------------------------------------------------------------
export const SurfaceVertex = /* glsl */ `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;
layout(location = 3) in vec2 aCoordinate;
layout(location = 4) in float aOcclusion;
uniform mat4 uViewClip;
out vec3 vPosition;
out vec3 vNormal;
out vec4 vTangent;
out vec2 vCoordinate;
out float vOcclusion;
void main()
{
    vPosition = aPosition;
    vNormal = aNormal;
    vTangent = aTangent;
    vCoordinate = aCoordinate;
    vOcclusion = aOcclusion;
    gl_Position = uViewClip * vec4(aPosition, 1.0);
}`;

export const SurfaceFragment = /* glsl */ `
in vec3 vPosition;
in vec3 vNormal;
in vec4 vTangent;
in vec2 vCoordinate;
in float vOcclusion;

uniform sampler2D uChannel0;
uniform sampler2D uChannel1;
uniform sampler2D uChannel2;
uniform sampler2D uChannel3;
uniform sampler2D uField;
uniform sampler2D uMaskPreview;

uniform vec3 uViewPosition;
uniform float uNormalGain;
uniform float uDisplay;
uniform float uCheckerScale;

uniform float uDiffuseRoughness;
uniform vec3 uSpecularColour;
uniform float uSpecularIor;
uniform float uAnisotropy;
uniform vec3 uCoatColour;
uniform float uCoatIor;
uniform float uCoatDarkening;
uniform vec3 uFuzzColour;
uniform float uFuzzRoughness;
uniform float uEmissionLuminance;
uniform vec3 uTransmissionColour;
uniform float uTransmissionDepth;
uniform float uThinFilmWeight;
uniform float uThinFilmThickness;
uniform float uThinFilmIor;

uniform vec3 uBrushCentre;
uniform vec3 uBrushNormal;
uniform float uBrushRadius;
uniform float uBrushHardness;
uniform float uBrushVisible;
uniform vec3 uBrushInk;            // what the stroke would lay down, shown inside the ring
uniform float uBrushPreview;       // strength of that preview wash, 0 for ring only
uniform vec4 uMirror;              // xyz axis, w: 0 off, 1 mirrored, 2 radial
uniform float uMirrorSpan;         // surface radius, so the seam line scales with the model
uniform float uMirrorSectors;      // how many times a radial stroke repeats around the axis

uniform sampler2D uDecalPreview;
uniform vec3 uPlacePosition;
uniform vec3 uPlaceNormal;
uniform vec3 uPlaceTangent;
uniform vec2 uPlaceSize;
uniform vec3 uPlaceTint;
uniform float uPlaceColorise;
uniform float uPlaceVisible;

out vec4 oColour;

vec3 TurnAround(vec3 Vector, vec3 Axis, float Angle)
{
    float Cosine = cos(Angle);
    float Sine = sin(Angle);
    return Vector * Cosine + cross(Axis, Vector) * Sine + Axis * dot(Axis, Vector) * (1.0 - Cosine);
}
float BrushMark(vec3 Position, vec3 Centre, vec3 Normal, out float Fill)
{
    float Distance = length(Position - Centre);
    float Facing = step(0.0, dot(normalize(vNormal), Normal));
    float Width = max(uBrushRadius * 0.035, 0.0016);
    float Outer = 1.0 - smoothstep(Width, Width * 2.2, abs(Distance - uBrushRadius));
    float Inner = (1.0 - smoothstep(Width * 0.7, Width * 1.6, abs(Distance - uBrushRadius * max(uBrushHardness, 0.05)))) * 0.45;
    Fill = (1.0 - smoothstep(uBrushRadius * max(uBrushHardness, 0.05), uBrushRadius, Distance)) * Facing;
    return clamp(Outer + Inner, 0.0, 1.0) * Facing;
}
float DistributionGgx(float NdotH, float Roughness)
{
    float Alpha = max(Roughness * Roughness, 1e-4);
    float AlphaSquared = Alpha * Alpha;
    float Denominator = NdotH * NdotH * (AlphaSquared - 1.0) + 1.0;
    return AlphaSquared / max(3.14159265 * Denominator * Denominator, 1e-7);
}
float VisibilitySmith(float NdotV, float NdotL, float Roughness)
{
    float Alpha = max(Roughness * Roughness, 1e-4);
    float Lambda = sqrt(Alpha + (1.0 - Alpha) * NdotV * NdotV);
    float LambdaLight = sqrt(Alpha + (1.0 - Alpha) * NdotL * NdotL);
    return 0.5 / max(NdotL * Lambda + NdotV * LambdaLight, 1e-6);
}
// 🔴 Anisotropy is a SHAPE, not a narrower isotropic lobe. A brushed panel's highlight is drawn out across the grain
//    and squeezed along it; shrinking one roughness number can only ever make the same round highlight smaller, which
//    is why brushed aluminium never looked brushed. Both of these are the standard GGX forms with two alphas.
float DistributionGgxAnisotropic(float NdotH, vec3 Half, vec3 Tangent, vec3 Bitangent, float Along, float Across)
{
    float ToH = dot(Tangent, Half);
    float BoH = dot(Bitangent, Half);
    float Product = Along * Across;
    vec3 Axis = vec3(Across * ToH, Along * BoH, Product * NdotH);
    float Length = dot(Axis, Axis);
    float Weight = Product / max(Length, 1e-9);
    return Product * Weight * Weight * (1.0 / 3.14159265);
}
float VisibilitySmithAnisotropic(
    float Along, float Across, vec3 Tangent, vec3 Bitangent, vec3 View, vec3 Light, float NdotV, float NdotL)
{
    float ToV = dot(Tangent, View);
    float BoV = dot(Bitangent, View);
    float ToL = dot(Tangent, Light);
    float BoL = dot(Bitangent, Light);
    float LambdaView = NdotL * length(vec3(Along * ToV, Across * BoV, NdotV));
    float LambdaLight = NdotV * length(vec3(Along * ToL, Across * BoL, NdotL));
    return 0.5 / max(LambdaView + LambdaLight, 1e-6);
}
vec3 FresnelSchlick(vec3 Reflectance, float Cosine)
{
    return Reflectance + (vec3(1.0) - Reflectance) * pow(clamp(1.0 - Cosine, 0.0, 1.0), 5.0);
}
// Kutz F82-tint metal Fresnel, as adopted by OpenPBR for conductors.
vec3 FresnelF82(vec3 Reflectance, vec3 EdgeTint, float Cosine)
{
    const float CosinePeak = 1.0 / 7.0;
    vec3 White = FresnelSchlick(Reflectance, CosinePeak);
    vec3 Denominator = White * (1.0 - EdgeTint);
    vec3 Scale = Denominator / max(CosinePeak * pow(1.0 - CosinePeak, 6.0), 1e-6);
    return clamp(FresnelSchlick(Reflectance, Cosine) - Scale * Cosine * pow(1.0 - Cosine, 6.0), 0.0, 1.0);
}
// Karis split-sum environment BRDF approximation.
vec2 EnvironmentBrdf(float NdotV, float Roughness)
{
    vec4 C0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 C1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 R = Roughness * C0 + C1;
    float A004 = min(R.x * R.x, exp2(-9.28 * NdotV)) * R.x + R.y;
    return vec2(-1.04, 1.04) * A004 + R.zw;
}
float SheenLobe(float NdotH, float Roughness)
{
    float Inverted = 1.0 / max(Roughness, 0.07);
    float Cosine2 = NdotH * NdotH;
    float Sine2 = max(1.0 - Cosine2, 0.0078125);
    return (2.0 + Inverted) * pow(Sine2, Inverted * 0.5) / 6.2831853;
}
// Belcour–Barla style spectral shift, reduced to a three-tap approximation.
vec3 ThinFilmTint(float Cosine, float Thickness, float Ior)
{
    float Phase = 12.566370614 * Thickness * Ior * Cosine;
    return 0.5 + 0.5 * cos(Phase + vec3(0.0, 2.0943951, 4.1887902));
}
float Luminance(vec3 Colour)
{
    return dot(Colour, vec3(0.2126, 0.7152, 0.0722));
}

void main()
{
    vec4 Channel0 = texture(uChannel0, vCoordinate);
    vec4 Channel1 = texture(uChannel1, vCoordinate);
    vec4 Channel2 = texture(uChannel2, vCoordinate);
    vec4 Channel3 = texture(uChannel3, vCoordinate);
    vec4 Field = texture(uField, vCoordinate);

    float Opacity = Channel0.a;
    if (Opacity < 0.5 && uDisplay < 0.5) discard;

    vec2 Texel = 1.0 / vec2(textureSize(uChannel1, 0));
    float HeightRight = texture(uChannel1, vCoordinate + vec2(Texel.x, 0.0)).a;
    float HeightLeft = texture(uChannel1, vCoordinate - vec2(Texel.x, 0.0)).a;
    float HeightUp = texture(uChannel1, vCoordinate + vec2(0.0, Texel.y)).a;
    float HeightDown = texture(uChannel1, vCoordinate - vec2(0.0, Texel.y)).a;
    vec3 TangentNormal = normalize(vec3(
        (HeightLeft - HeightRight) * uNormalGain,
        (HeightDown - HeightUp) * uNormalGain,
        1.0));

    vec3 GeometricNormal = normalize(vNormal);
    vec3 Tangent = normalize(vTangent.xyz - GeometricNormal * dot(GeometricNormal, vTangent.xyz));
    vec3 Bitangent = cross(GeometricNormal, Tangent) * (vTangent.w < 0.0 ? -1.0 : 1.0);
    vec3 Normal = normalize(
        Tangent * TangentNormal.x + Bitangent * TangentNormal.y + GeometricNormal * TangentNormal.z);

    vec3 View = normalize(uViewPosition - vPosition);
    if (dot(Normal, View) < 0.0) Normal = normalize(Normal - View * dot(Normal, View) * 1.8);
    float NdotV = clamp(dot(Normal, View), 1e-4, 1.0);

    vec3 BaseColour = Linearise(Channel0.rgb);
    float Roughness = clamp(Channel1.r, 0.012, 1.0);
    float Metalness = Channel1.g;
    float Occlusion = Channel1.b * mix(1.0, vOcclusion, 0.65);
    float Specular = Channel2.r;
    float Coat = Channel2.g;
    float CoatRoughness = clamp(Channel2.b, 0.012, 1.0);
    float Fuzz = Channel2.a;
    vec3 Emission = Linearise(Channel3.rgb) * uEmissionLuminance;
    float Transmission = Channel3.a;

    // Channel inspections short-circuit the whole slab evaluation.
    if (uDisplay > 0.5)
    {
        int Mode = int(uDisplay + 0.5);
        vec3 Inspection = vec3(0.0);
        if (Mode == 1) Inspection = Channel0.rgb;
        else if (Mode == 2) Inspection = vec3(Channel1.r);
        else if (Mode == 3) Inspection = vec3(Channel1.g);
        else if (Mode == 4) Inspection = TangentNormal * 0.5 + 0.5;
        else if (Mode == 5) Inspection = vec3(Channel1.a);
        else if (Mode == 6) Inspection = vec3(Channel1.b);
        else if (Mode == 7) Inspection = Channel3.rgb;
        else if (Mode == 8) Inspection = vec3(Channel2.g);
        else if (Mode == 9) Inspection = vec3(Channel2.a);
        else if (Mode == 10) Inspection = vec3(Channel3.a);
        else if (Mode == 11) Inspection = vec3(Field.r, Field.g, 0.0);
        else if (Mode == 12) Inspection = vec3(Field.a);
        else if (Mode == 13) Inspection = vec3(0.0);
        else if (Mode == 14)
        {
            // The selected layer's mask on its own: black is hidden, white is revealed, as the brush sees it.
            float Mask = texture(uMaskPreview, vCoordinate).a;
            Inspection = mix(vec3(0.04, 0.05, 0.07), vec3(0.96), Mask);
        }
        else
        {
            vec2 Cell = floor(vCoordinate * uCheckerScale);
            float Checker = mod(Cell.x + Cell.y, 2.0);
            Inspection = mix(vec3(0.16), vec3(0.62), Checker) * mix(0.55, 1.0, clamp(dot(Normal, View), 0.0, 1.0));
        }
        float Shade = mix(0.55, 1.0, clamp(dot(Normal, normalize(vec3(0.4, 0.8, 0.5))) * 0.5 + 0.5, 0.0, 1.0));
        oColour = vec4(Inspection * mix(1.0, Shade, 0.35), 1.0);
        return;
    }

    float DielectricReflectance = pow((uSpecularIor - 1.0) / (uSpecularIor + 1.0), 2.0);
    vec3 SpecularColour = uSpecularColour * Specular;
    vec3 Reflectance = mix(vec3(DielectricReflectance) * SpecularColour, BaseColour, Metalness);
    vec3 DiffuseColour = BaseColour * (1.0 - Metalness) * (1.0 - Transmission);
    float CoatReflectance = pow((uCoatIor - 1.0) / (uCoatIor + 1.0), 2.0);

    vec3 Radiance = vec3(0.0);
    for (int Index = 0; Index < 3; ++Index)
    {
        vec3 Light = uLightDirection[Index];
        vec3 Incident = uLightRadiance[Index] * uEnvironmentIntensity;
        float NdotL = dot(Normal, Light);
        if (NdotL <= 0.0) continue;
        vec3 Half = normalize(Light + View);
        float NdotH = clamp(dot(Normal, Half), 0.0, 1.0);
        float VdotH = clamp(dot(View, Half), 0.0, 1.0);

        float Distribution;
        float Visibility;
        if (uAnisotropy > 0.001)
        {
            // Energy is preserved by widening one axis as much as the other narrows, so the grain changes the shape of
            // the highlight without changing how much light the surface returns.
            float Alpha = max(Roughness * Roughness, 1e-4);
            float Spread = clamp(uAnisotropy, 0.0, 0.98);
            float Along = max(Alpha / max(1.0 - Spread, 0.02), 1e-4);
            float Across = max(Alpha * (1.0 - Spread), 1e-4);
            Distribution = DistributionGgxAnisotropic(NdotH, Half, Tangent, Bitangent, Along, Across);
            Visibility = VisibilitySmithAnisotropic(Along, Across, Tangent, Bitangent, View, Light, NdotV, NdotL);
        }
        else
        {
            Distribution = DistributionGgx(NdotH, Roughness);
            Visibility = VisibilitySmith(NdotV, NdotL, Roughness);
        }
        vec3 Fresnel = mix(
            FresnelSchlick(Reflectance, VdotH),
            FresnelF82(BaseColour, uSpecularColour, VdotH),
            Metalness);
        if (uThinFilmWeight > 0.0)
            Fresnel = mix(Fresnel, Fresnel * ThinFilmTint(VdotH, uThinFilmThickness, uThinFilmIor) * 2.0, uThinFilmWeight);
        vec3 SpecularLobe = Fresnel * Distribution * Visibility;

        // EON-flavoured rough diffuse: Lambert tempered by a retro-reflective term.
        float Retro = 1.0 - 0.5 * uDiffuseRoughness * (1.0 - NdotL) * (1.0 - NdotV);
        vec3 DiffuseLobe = DiffuseColour * (1.0 / 3.14159265) * Retro * (1.0 - Metalness);

        vec3 Lobe = (DiffuseLobe + SpecularLobe) * NdotL;

        if (Fuzz > 0.0)
            Lobe += uFuzzColour * Fuzz * SheenLobe(NdotH, uFuzzRoughness) * NdotL * 0.6;

        if (Coat > 0.0)
        {
            float CoatDistribution = DistributionGgx(NdotH, CoatRoughness);
            float CoatVisibility = VisibilitySmith(NdotV, NdotL, CoatRoughness);
            float CoatFresnel = CoatReflectance + (1.0 - CoatReflectance) * pow(1.0 - VdotH, 5.0);
            Lobe *= mix(1.0, (1.0 - CoatFresnel * Coat) * mix(1.0, 0.82, uCoatDarkening * Coat), Coat);
            Lobe += uCoatColour * Coat * CoatFresnel * CoatDistribution * CoatVisibility * NdotL;
        }
        Radiance += Lobe * Incident;
    }

    // Image-based terms.
    vec3 ReflectionDirection = reflect(-View, Normal);
    vec3 SpecularEnvironment = SampleEnvironment(ReflectionDirection, Roughness);
    vec2 Brdf = EnvironmentBrdf(NdotV, Roughness);
    vec3 AmbientSpecular = SpecularEnvironment * (Reflectance * Brdf.x + Brdf.y) * Occlusion;
    vec3 AmbientDiffuse = SampleIrradiance(Normal) * DiffuseColour * Occlusion * 0.55;
    Radiance += AmbientDiffuse + AmbientSpecular;

    if (Coat > 0.0)
    {
        vec3 CoatEnvironment = SampleEnvironment(ReflectionDirection, CoatRoughness);
        float CoatFresnel = CoatReflectance + (1.0 - CoatReflectance) * pow(1.0 - NdotV, 5.0);
        Radiance = mix(Radiance, Radiance * mix(1.0, 0.78, uCoatDarkening), Coat);
        Radiance += uCoatColour * CoatEnvironment * CoatFresnel * Coat * Occlusion;
    }

    if (Transmission > 0.0)
    {
        vec3 Refracted = refract(-View, Normal, 1.0 / max(uSpecularIor, 1.01));
        vec3 Behind = SampleEnvironment(normalize(Refracted + vec3(1e-5)), Roughness * 0.85);
        vec3 Absorption = exp(-(vec3(1.0) - uTransmissionColour) * (0.08 / max(uTransmissionDepth, 1e-3)));
        Radiance = mix(Radiance, Behind * Absorption, Transmission * (1.0 - Metalness));
    }

    Radiance += Emission;

    // Brush ring: drawn in world space so it hugs the surface rather than the screen.
    if (uBrushVisible > 0.5)
    {
        float Fill = 0.0;
        float Ring = BrushMark(vPosition, uBrushCentre, uBrushNormal, Fill);
        if (uMirror.w > 1.5)
        {
            // Radial symmetry: a cursor in every sector, so a stroke about to repeat twelve times says so first.
            for (int Index = 1; Index < 16; Index += 1)
            {
                if (float(Index) >= uMirrorSectors) break;
                float Angle = 6.2831853 * float(Index) / max(uMirrorSectors, 1.0);
                float TwinFill = 0.0;
                float TwinRing = BrushMark(
                    vPosition,
                    TurnAround(uBrushCentre, uMirror.xyz, Angle),
                    TurnAround(uBrushNormal, uMirror.xyz, Angle),
                    TwinFill);
                Ring = max(Ring, TwinRing * 0.8);
                Fill = max(Fill, TwinFill * 0.8);
            }
        }
        else if (uMirror.w > 0.5)
        {
            // The mirrored twin is drawn from the reflected centre, so what symmetry will paint is never a surprise.
            vec3 Flip = vec3(1.0) - 2.0 * uMirror.xyz;
            float TwinFill = 0.0;
            float TwinRing = BrushMark(vPosition, uBrushCentre * Flip, uBrushNormal * Flip, TwinFill);
            Ring = max(Ring, TwinRing * 0.8);
            Fill = max(Fill, TwinFill * 0.8);
        }
        Radiance = mix(Radiance, uBrushInk * (0.35 + Luminance(Radiance) * 1.4), Fill * uBrushPreview);
        Radiance = mix(Radiance, vec3(1.6, 1.6, 1.7) * (0.3 + Luminance(Radiance)), Ring * 0.75);
    }

    if (uMirror.w > 1.5)
    {
        // The spokes a radial brush paints along, drawn where they fall on the model and meeting at the axis.
        float Sector = 6.2831853 / max(uMirrorSectors, 1.0);
        float Around = atan(vPosition.z, vPosition.x);
        float Phase = abs(mod(Around + Sector * 0.5, Sector) - Sector * 0.5);
        float Reach = length(vPosition.xz);
        float Width = max(uMirrorSpan * 0.004, 0.0012);
        float Seam = 1.0 - smoothstep(Width, Width * 2.6, Phase * Reach);
        Radiance = mix(Radiance, vec3(0.2, 0.78, 0.35) * (0.5 + Luminance(Radiance) * 1.5), Seam * 0.45);
    }
    else if (uMirror.w > 0.5)
    {
        // Where the mirror plane cuts the surface, so the axis in the viewport bar means something on the model.
        float Across = abs(dot(vPosition, uMirror.xyz));
        float Width = max(uMirrorSpan * 0.004, 0.0012);
        float Seam = 1.0 - smoothstep(Width, Width * 2.6, Across);
        Radiance = mix(Radiance, vec3(0.2, 0.78, 0.35) * (0.5 + Luminance(Radiance) * 1.5), Seam * 0.55);
    }

    if (uPlaceVisible > 0.5)
    {
        // The decal where it would land: the stencil itself, plus a hairline around its footprint.
        vec3 Bitangent = normalize(cross(uPlaceNormal, uPlaceTangent));
        vec3 Delta = vPosition - uPlacePosition;
        vec2 Local = vec2(dot(Delta, uPlaceTangent) / max(uPlaceSize.x, 1e-4), dot(Delta, Bitangent) / max(uPlaceSize.y, 1e-4)) + 0.5;
        float Depth = abs(dot(Delta, uPlaceNormal));
        float Facing = step(0.0, dot(normalize(vNormal), uPlaceNormal));
        float Inside = step(0.0, Local.x) * step(Local.x, 1.0) * step(0.0, Local.y) * step(Local.y, 1.0);
        float Near = 1.0 - smoothstep(uPlaceSize.x * 0.6, uPlaceSize.x, Depth);
        float Within = Inside * Facing * Near;
        vec4 Stencil = texture(uDecalPreview, vec2(Local.x, 1.0 - Local.y));
        vec3 Ink = mix(Stencil.rgb, uPlaceTint, uPlaceColorise);
        float Border = max(
            max(1.0 - smoothstep(0.0, 0.012, Local.x), 1.0 - smoothstep(0.0, 0.012, 1.0 - Local.x)),
            max(1.0 - smoothstep(0.0, 0.012, Local.y), 1.0 - smoothstep(0.0, 0.012, 1.0 - Local.y)));
        Radiance = mix(Radiance, Ink * (0.4 + Luminance(Radiance) * 1.3), Within * Stencil.a * 0.7);
        Radiance = mix(Radiance, vec3(1.5, 1.5, 1.6) * (0.3 + Luminance(Radiance)), Within * Border * 0.55);
    }

    oColour = vec4(ToneMap(Radiance), 1.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Background — the same environment the slab reflects, so the two agree.
//--------------------------------------------------------------------------------------------------------------------------
export const BackgroundFragment = /* glsl */ `
in vec2 vCoordinate;
uniform vec3 uRayOrigin;
uniform vec3 uRayForward;
uniform vec3 uRayRight;
uniform vec3 uRayUp;
uniform float uBackgroundVisible;
out vec4 oColour;
void main()
{
    vec2 Device = vCoordinate * 2.0 - 1.0;
    vec3 Direction = normalize(uRayForward + uRayRight * Device.x + uRayUp * Device.y);
    vec3 Radiance = SampleEnvironment(Direction, 0.55) * mix(0.12, 1.0, uBackgroundVisible);
    float Vignette = 1.0 - 0.34 * length(Device * vec2(0.62, 0.52));
    oColour = vec4(ToneMap(Radiance * Vignette), 1.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Texture-space inspection — the 2D view, with island padding shown against a checker.
//--------------------------------------------------------------------------------------------------------------------------
export const PlaneFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uChannel0;
uniform sampler2D uChannel1;
uniform sampler2D uChannel2;
uniform sampler2D uChannel3;
uniform sampler2D uField;
uniform sampler2D uMaskPreview;
uniform vec2 uPan;
uniform float uZoom;
uniform float uAspect;
uniform float uDisplay;
uniform float uNormalGain;
uniform float uCheckerScale;
uniform vec3 uCursor;          // texture-space x, y, radius
uniform float uCursorVisible;
uniform vec3 uCursorInk;
uniform float uCursorPreview;
out vec4 oColour;
void main()
{
    vec2 Device = (vCoordinate - 0.5) * vec2(uAspect, 1.0);
    vec2 Coordinate = Device / max(uZoom, 1e-3) + 0.5 + uPan;
    vec2 Cell = floor(vCoordinate * vec2(uAspect, 1.0) * 26.0);
    float Backdrop = mod(Cell.x + Cell.y, 2.0);
    vec3 Colour = mix(vec3(0.075), vec3(0.105), Backdrop);
    if (Coordinate.x >= 0.0 && Coordinate.x <= 1.0 && Coordinate.y >= 0.0 && Coordinate.y <= 1.0)
    {
        vec4 Channel0 = texture(uChannel0, Coordinate);
        vec4 Channel1 = texture(uChannel1, Coordinate);
        vec4 Channel2 = texture(uChannel2, Coordinate);
        vec4 Channel3 = texture(uChannel3, Coordinate);
        vec4 Field = texture(uField, Coordinate);
        int Mode = int(uDisplay + 0.5);
        if (Mode == 1) Colour = Channel0.rgb;
        else if (Mode == 2) Colour = vec3(Channel1.r);
        else if (Mode == 3) Colour = vec3(Channel1.g);
        else if (Mode == 4)
        {
            vec2 Texel = 1.0 / vec2(textureSize(uChannel1, 0));
            float Right = texture(uChannel1, Coordinate + vec2(Texel.x, 0.0)).a;
            float Left = texture(uChannel1, Coordinate - vec2(Texel.x, 0.0)).a;
            float Up = texture(uChannel1, Coordinate + vec2(0.0, Texel.y)).a;
            float Down = texture(uChannel1, Coordinate - vec2(0.0, Texel.y)).a;
            Colour = normalize(vec3((Left - Right) * uNormalGain, (Down - Up) * uNormalGain, 1.0)) * 0.5 + 0.5;
        }
        else if (Mode == 5) Colour = vec3(Channel1.a);
        else if (Mode == 6) Colour = vec3(Channel1.b);
        else if (Mode == 7) Colour = Channel3.rgb;
        else if (Mode == 8) Colour = vec3(Channel2.g);
        else if (Mode == 9) Colour = vec3(Channel2.a);
        else if (Mode == 10) Colour = vec3(Channel3.a);
        else if (Mode == 11) Colour = vec3(Field.r, Field.g, 0.0);
        else if (Mode == 12) Colour = vec3(Field.a);
        else if (Mode == 13)
        {
            vec2 CheckerCell = floor(Coordinate * uCheckerScale);
            Colour = mix(vec3(0.16), vec3(0.62), mod(CheckerCell.x + CheckerCell.y, 2.0));
        }
        else if (Mode == 14) Colour = mix(vec3(0.04, 0.05, 0.07), vec3(0.96), texture(uMaskPreview, Coordinate).a);
        else Colour = Channel0.rgb;
        if (Field.a <= 0.0 && Mode == 0) Colour *= 0.35;
    }
    if (uCursorVisible > 0.5)
    {
        float Fill = 1.0 - smoothstep(uCursor.z * 0.35, uCursor.z, length(Coordinate - uCursor.xy));
        Colour = mix(Colour, uCursorInk, Fill * uCursorPreview);
        float Ring = abs(length(Coordinate - uCursor.xy) - uCursor.z);
        float Width = max(0.9 / max(uZoom, 1e-3) * 0.0016, 0.0006);
        Colour = mix(Colour, vec3(0.95), 1.0 - smoothstep(Width, Width * 2.6, Ring));
    }
    oColour = vec4(Colour, 1.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Channel resolve — the export path. Produces one RGBA8 image per requested interchange slot.
//--------------------------------------------------------------------------------------------------------------------------
export const ResolveFragment = /* glsl */ `
in vec2 vCoordinate;
uniform sampler2D uChannel0;
uniform sampler2D uChannel1;
uniform sampler2D uChannel2;
uniform sampler2D uChannel3;
uniform sampler2D uField;
uniform int uSlot;
uniform float uNormalGain;
out vec4 oColour;
void main()
{
    vec4 Channel0 = texture(uChannel0, vCoordinate);
    vec4 Channel1 = texture(uChannel1, vCoordinate);
    vec4 Channel2 = texture(uChannel2, vCoordinate);
    vec4 Channel3 = texture(uChannel3, vCoordinate);
    vec4 Field = texture(uField, vCoordinate);
    vec4 Result = vec4(0.0, 0.0, 0.0, 1.0);
    if (uSlot == 0) Result = vec4(Channel0.rgb, 1.0);
    else if (uSlot == 1) Result = vec4(vec3(Channel1.r), 1.0);
    else if (uSlot == 2) Result = vec4(vec3(Channel1.g), 1.0);
    else if (uSlot == 3)
    {
        vec2 Texel = 1.0 / vec2(textureSize(uChannel1, 0));
        float Right = texture(uChannel1, vCoordinate + vec2(Texel.x, 0.0)).a;
        float Left = texture(uChannel1, vCoordinate - vec2(Texel.x, 0.0)).a;
        float Up = texture(uChannel1, vCoordinate + vec2(0.0, Texel.y)).a;
        float Down = texture(uChannel1, vCoordinate - vec2(0.0, Texel.y)).a;
        Result = vec4(normalize(vec3((Left - Right) * uNormalGain, (Down - Up) * uNormalGain, 1.0)) * 0.5 + 0.5, 1.0);
    }
    else if (uSlot == 4) Result = vec4(vec3(Channel1.a), 1.0);
    else if (uSlot == 5) Result = vec4(vec3(Channel1.b * Field.a), 1.0);
    else if (uSlot == 6) Result = vec4(Channel3.rgb, 1.0);
    else if (uSlot == 7) Result = vec4(vec3(Channel0.a), 1.0);
    else if (uSlot == 8) Result = vec4(vec3(Channel2.r), 1.0);
    else if (uSlot == 9) Result = vec4(vec3(Channel2.g), 1.0);
    else if (uSlot == 10) Result = vec4(vec3(Channel2.b), 1.0);
    else if (uSlot == 11) Result = vec4(vec3(Channel2.a), 1.0);
    else if (uSlot == 12) Result = vec4(vec3(Channel3.a), 1.0);
    else if (uSlot == 13) Result = vec4(Channel1.b * Field.a, Channel1.r, Channel1.g, 1.0);
    oColour = Result;
}`;

//--------------------------------------------------------------------------------------------------------------------------
// Assembly — fragment shaders declare which chunks they need by name.
//--------------------------------------------------------------------------------------------------------------------------
export const Chunks = {
    Noise: NoiseChunk,
    Media: MediaChunk,
    Generator: GeneratorChunk,
    Finish: FinishChunk,
    Mask: MaskChunk,
    Blend: BlendChunk,
    Environment: EnvironmentChunk,
};

export const ExportSlots = [
    { Slot: 0, Identifier: "base_color", Export: "BaseColor", Encoding: "srgb" },
    { Slot: 1, Identifier: "specular_roughness", Export: "Roughness", Encoding: "linear" },
    { Slot: 2, Identifier: "base_metalness", Export: "Metalness", Encoding: "linear" },
    { Slot: 3, Identifier: "geometry_normal", Export: "Normal", Encoding: "linear" },
    { Slot: 4, Identifier: "height", Export: "Height", Encoding: "linear" },
    { Slot: 5, Identifier: "ambient_occlusion", Export: "Occlusion", Encoding: "linear" },
    { Slot: 6, Identifier: "emission_color", Export: "Emission", Encoding: "srgb" },
    { Slot: 7, Identifier: "geometry_opacity", Export: "Opacity", Encoding: "linear" },
    { Slot: 8, Identifier: "specular_weight", Export: "SpecularWeight", Encoding: "linear" },
    { Slot: 9, Identifier: "coat_weight", Export: "CoatWeight", Encoding: "linear" },
    { Slot: 10, Identifier: "coat_roughness", Export: "CoatRoughness", Encoding: "linear" },
    { Slot: 11, Identifier: "fuzz_weight", Export: "FuzzWeight", Encoding: "linear" },
    { Slot: 12, Identifier: "transmission_weight", Export: "Transmission", Encoding: "linear" },
    { Slot: 13, Identifier: "metallic_roughness", Export: "OcclusionRoughnessMetalness", Encoding: "linear" },
];

export const SlotByIdentifier = Object.fromEntries(ExportSlots.map((Entry) => [Entry.Identifier, Entry]));
