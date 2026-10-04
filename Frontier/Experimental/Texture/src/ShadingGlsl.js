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

// A sparse field of oriented flakes: each cell either carries one or it does not, and the ones that do catch the light.
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
    vec3 ColourA, vec3 ColourB, vec4 Shape, vec4 Trim)
{
    float Scale = max(Shape.x, 0.001);
    float Density = Shape.y;
    float Strength = Shape.z;
    float Gloss = clamp(Shape.w, 0.0, 1.0);
    float Coat = clamp(Trim.x, 0.0, 1.0);
    float Angle = radians(Trim.y);
    float Variation = Trim.z;
    float Seed = Trim.w;

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
        // Automotive. A pigmented base, a flake layer, then clear coat over the top.
        float Facet = 0.0;
        float Flakes = FlakeField(Turned, Scale * 240.0, Density, Seed, Facet);
        float Drift = Fractal(Turned * (2.0 + Scale * 3.0) + Seed, 4);
        vec3 Body = mix(ColourA, ColourA * mix(0.72, 1.28, Drift), Variation);
        if (Style == 1) Body = mix(Body, ColourB, 0.35 + 0.45 * Drift);            // candy pearl shifts between two pigments
        float Sparkle = Flakes * Strength * mix(0.6, 1.0, Facet);
        Result.Colour = mix(Body, ColourB, clamp(Sparkle, 0.0, 1.0));
        Result.Metalness = clamp(Sparkle * 0.9, 0.0, 1.0);
        Result.Roughness = clamp(mix(1.0 - Gloss, 0.18, Sparkle) + Drift * 0.04 * Variation, 0.02, 1.0);
        Result.Height = 0.5 + (Flakes - 0.5) * 0.02 * Strength;
        Result.Coat = Coat;
        Result.CoatRoughness = clamp((1.0 - Gloss) * 0.22 + Fractal(Turned * 11.0, 2) * 0.05 * Variation, 0.008, 1.0);
        if (Style == 2)
        {
            // Matte wrap: no flake, a fine grain, coat held flat.
            float Grain = Fractal(Turned * 260.0 * Scale, 3);
            Result.Colour = mix(ColourA, ColourB, Grain * 0.25 * Variation);
            Result.Metalness = 0.0;
            Result.Roughness = clamp(0.62 + Grain * 0.16 - Gloss * 0.2, 0.2, 1.0);
            Result.Coat = Coat * 0.25;
            Result.CoatRoughness = 0.55;
            Result.Height = 0.5 + (Grain - 0.5) * 0.01;
        }
        else if (Style == 3)
        {
            // Primer: chalky, speckled, no coat worth the name.
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
    int FieldKind, vec4 A, vec4 B, vec3 Lower, vec3 Key, float Tolerance, float Softness, float Invert)
{
    float Mask = 1.0;
    if (Kind == 1) Mask = Painted;
    else if (Kind == 2)
        Mask = SampleGenerator(FieldKind, Coordinate, Position, Normal, Field, A.x, int(A.y), A.z, A.w, B.x, B.y, B.z, B.w);
    else if (Kind == 3) Mask = ColourMask(Lower, Key, Tolerance, Softness);
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
uniform int uStampMode;        // 0 surface space · 1 texture space
out vec4 oCoverage;
void main()
{
    vec4 Sample = texture(uPositionSource, vCoordinate);
    float Distance;
    float Facing = 1.0;
    float Radius = uRadius;
    if (uStampMode == 1)
    {
        vec2 Segment = uStrokeEndPlane - uStrokeStartPlane;
        float SegmentLength = max(dot(Segment, Segment), 1e-9);
        float Travel = clamp(dot(vCoordinate - uStrokeStartPlane, Segment) / SegmentLength, 0.0, 1.0);
        Distance = length(vCoordinate - (uStrokeStartPlane + Segment * Travel));
        Radius = uPlaneRadius;
    }
    else
    {
        if (Sample.w < 0.5) discard;
        vec3 Position = Sample.xyz;
        vec3 Normal = normalize(texture(uNormalSource, vCoordinate).xyz);
        vec3 Segment = uStrokeEnd - uStrokeStart;
        float SegmentLength = max(dot(Segment, Segment), 1e-9);
        float Travel = clamp(dot(Position - uStrokeStart, Segment) / SegmentLength, 0.0, 1.0);
        vec3 Closest = uStrokeStart + Segment * Travel;
        Distance = length(Position - Closest);
        Facing = smoothstep(uFacingLimit, mix(uFacingLimit, 1.0, 0.45), dot(Normal, uStrokeNormal));
    }
    float Falloff = 1.0 - smoothstep(Radius * mix(0.0, 0.94, uHardness), Radius, Distance);
    if (Falloff <= 0.0) discard;
    float Jitter = mix(1.0, 0.65 + 0.35 * Hash21(vCoordinate * 512.0), uAlphaJitter);
    float Alpha = clamp(Falloff * Facing * uFlow * Jitter, 0.0, 1.0);
    if (Alpha <= 0.0015) discard;
    oCoverage = vec4(uStrokeColour * Alpha, Alpha);
}`;

//--------------------------------------------------------------------------------------------------------------------------
// ⑤ Compositor — one layer per invocation, four RGBA8 targets in, four out.
//--------------------------------------------------------------------------------------------------------------------------
export const CompositeFragment = /* glsl */ `
in vec2 vCoordinate;

uniform sampler2D uLower0;
uniform sampler2D uLower1;
uniform sampler2D uLower2;
uniform sampler2D uLower3;
uniform sampler2D uCoverageMap;
uniform sampler2D uDecalMap;
uniform sampler2D uMaskMap;

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

uniform int uFinishFamily;
uniform int uFinishStyle;
uniform vec3 uFinishColourA;
uniform vec3 uFinishColourB;
uniform vec4 uFinishShape;      // scale, density, strength, gloss
uniform vec4 uFinishTrim;       // coat, angle, variation, seed

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

    if (uKind == 1)
    {
        vec4 Painted = texture(uCoverageMap, vCoordinate);
        Coverage = Painted.a;
        Colour = Painted.a > 0.0019 ? Painted.rgb / Painted.a : uBaseColour;
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
            uFinishColourA, uFinishColourB, uFinishShape, uFinishTrim);
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
            uMaskField, uMaskA, uMaskB, Lower0.rgb, uMaskColour, uMaskTolerance, uMaskSoftness, uMaskInvert);

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
    vec3 Emission = mix(Lower3.rgb, BlendColour(uBlend, Lower3.rgb, uEmissionColour), Coverage * uEnabled[10]);
    float Transmission = mix(Lower3.a, BlendScalar(uBlend, Lower3.a, uScalar[8]), Coverage * uEnabled[11]);

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
        uMaskColour, uMaskTolerance, uMaskSoftness, uMaskInvert);
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
uniform vec3 uMaskTint;

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

out vec4 oColour;

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

    // Channel inspections short-circuit the whole slab evaluation. The overlay is not an inspection — it shades first.
    if (uDisplay > 0.5 && int(uDisplay + 0.5) != 15)
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

        float AnisotropicRoughness = mix(Roughness, clamp(Roughness * (1.0 - uAnisotropy * 0.85), 0.01, 1.0), 0.5);
        float Distribution = DistributionGgx(NdotH, AnisotropicRoughness);
        float Visibility = VisibilitySmith(NdotV, NdotL, AnisotropicRoughness);
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
        float Distance = length(vPosition - uBrushCentre);
        float Facing = step(0.0, dot(normalize(vNormal), uBrushNormal));
        float Width = max(uBrushRadius * 0.035, 0.0016);
        float Outer = 1.0 - smoothstep(Width, Width * 2.2, abs(Distance - uBrushRadius));
        float Inner = (1.0 - smoothstep(Width * 0.7, Width * 1.6, abs(Distance - uBrushRadius * max(uBrushHardness, 0.05)))) * 0.45;
        float Ring = clamp(Outer + Inner, 0.0, 1.0) * Facing;
        Radiance = mix(Radiance, vec3(1.6, 1.6, 1.7) * (0.3 + Luminance(Radiance)), Ring * 0.75);
    }

    vec3 Shaded = ToneMap(Radiance);
    if (int(uDisplay + 0.5) == 15)
    {
        // Mask overlay: the surface stays paintable and what the mask hides is washed with the overlay tint.
        float Mask = texture(uMaskPreview, vCoordinate).a;
        Shaded = mix(mix(Shaded * 0.45 + uMaskTint * 0.55, Shaded, 0.25), Shaded, Mask);
    }
    oColour = vec4(Shaded, 1.0);
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
uniform vec3 uMaskTint;
uniform vec3 uCursor;          // texture-space x, y, radius
uniform float uCursorVisible;
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
        else if (Mode == 15)
        {
            float Mask = texture(uMaskPreview, Coordinate).a;
            Colour = mix(mix(Channel0.rgb * 0.45 + uMaskTint * 0.55, Channel0.rgb, 0.25), Channel0.rgb, Mask);
        }
        else Colour = Channel0.rgb;
        if (Field.a <= 0.0 && Mode == 0) Colour *= 0.35;
    }
    if (uCursorVisible > 0.5)
    {
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
