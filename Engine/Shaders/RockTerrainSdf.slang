//============================================================================================================================================
// 📦 Engine/Shaders/RockTerrainSdf.slang — continuous geological SDF for the high-fidelity rock viewport
//============================================================================================================================================
// Include-only shader library. It deliberately contains no sampled noise texture and no repeat period. The CPU authoring
// field (Projects/Project-Zero/Source/RockTerrainSpace.cpp) and this live ray field share the same formation vocabulary:
// deposition / cooling, finite fracture events, capillary salt weathering, mineral grains and sculpt strokes.

#ifndef FRONTIER_ROCK_TERRAIN_SDF
#define FRONTIER_ROCK_TERRAIN_SDF

struct RockTerrainGpuConfiguration
{
    vec4  ExtentAndHeight;       // xy = half extent [m], z = bottom [m], w = height [m]
    vec4  FormationControls;     // x = bedding spacing, y = grain scale, z = joint spacing, w = column scale
    vec4  WeatheringControls;    // x = water, y = salt, z = freeze-thaw, w = surface detail
    uvec4 GeologicalControls;    // x = seed, y = formation regime, z = brush count, w = reserved
};

struct RockTerrainGpuBrush
{
    vec4  CenterAndRadius;       // xyz = center [m], w = radius [m]
    vec4  StrengthAndShape;      // x = strength [m], y = hardness, z = category, w = unused
};

struct RockTerrainGpuSample
{
    float Distance;
    float Hardness;
    float Grain;
    float Bedding;
    float Fracture;
    float WaterFlux;
    float Salt;
    float Oxidation;
};

uint RockTerrainHash(uint X)
{
    X ^= X >> 16u;
    X *= 0x7FEB352Du;
    X ^= X >> 15u;
    X *= 0x846CA68Bu;
    return X ^ (X >> 16u);
}

uint RockTerrainHash3(ivec3 Cell, uint Seed)
{
    uint H = RockTerrainHash(Seed ^ 0x9E3779B9u);
    H = RockTerrainHash(H ^ uint(Cell.x) * 0x85EBCA6Bu);
    H = RockTerrainHash(H ^ uint(Cell.y) * 0xC2B2AE35u);
    H = RockTerrainHash(H ^ uint(Cell.z) * 0x27D4EB2Fu);
    return H;
}

float RockTerrainUnit(uint H)
{
    return float(H & 0x00FFFFFFu) / 16777215.0;
}

float RockTerrainSpectral(vec3 P, float Frequency, uint Seed)
{
    float A = sin(dot(P, vec3(1.0000, 0.1731, 0.0713)) * Frequency + RockTerrainUnit(RockTerrainHash(Seed)) * 6.2831853);
    float B = sin(dot(P, vec3(-0.2177, 0.9411, 0.1319)) * Frequency * 1.61803 + RockTerrainUnit(RockTerrainHash(Seed + 17u)) * 6.2831853);
    float C = sin(dot(P, vec3(0.0837, -0.2913, 0.9530)) * Frequency * 2.41421 + RockTerrainUnit(RockTerrainHash(Seed + 43u)) * 6.2831853);
    float D = sin(dot(P, vec3(0.5773)) * Frequency * 3.14159 + RockTerrainUnit(RockTerrainHash(Seed + 71u)) * 6.2831853);
    return (A + 0.55 * B + 0.30 * C + 0.16 * D) / 2.01;
}

vec3 RockTerrainWarp(vec3 P, float Frequency, float Amplitude, uint Seed)
{
    return P + Amplitude * vec3(
        RockTerrainSpectral(P + vec3(19.3, -7.1, 3.7), Frequency, Seed + 3u),
        RockTerrainSpectral(P + vec3(-2.7, 13.9, 9.1), Frequency * 1.07, Seed + 19u),
        RockTerrainSpectral(P + vec3(5.2, 4.1, -17.7), Frequency * 0.93, Seed + 37u));
}

float RockTerrainSmooth01(float V)
{
    V = clamp(V, 0.0, 1.0);
    return V * V * (3.0 - 2.0 * V);
}

float RockTerrainSmoothRange(float A, float B, float V)
{
    return RockTerrainSmooth01((V - A) / max(B - A, 1e-5));
}

// A finite jittered Voronoi fabric gives mineral boundaries without a periodic texture. The integer cells are an
// addressing scheme only; the hash has no wrap and the authoring volume is finite.
vec2 RockTerrainGrainFabric(vec3 P, float Scale, uint Seed)
{
    vec3 Q = P / max(Scale, 1e-4);
    ivec3 Cell = ivec3(floor(Q));
    float Nearest = 1e9;
    float Second = 1e9;
    uint CellHash = 0u;
    for (int Z = -1; Z <= 1; ++Z)
    {
        for (int Y = -1; Y <= 1; ++Y)
        {
            for (int X = -1; X <= 1; ++X)
            {
                ivec3 C = Cell + ivec3(X, Y, Z);
                uint H = RockTerrainHash3(C, Seed);
                vec3 J = vec3(RockTerrainUnit(RockTerrainHash(H + 1u)),
                              RockTerrainUnit(RockTerrainHash(H + 7u)),
                              RockTerrainUnit(RockTerrainHash(H + 13u))) * 0.78 + 0.11;
                float D = dot(vec3(C) + J - Q, vec3(C) + J - Q);
                if (D < Nearest) { Second = Nearest; Nearest = D; CellHash = H; }
                else if (D < Second) Second = D;
            }
        }
    }
    float Boundary = 1.0 - RockTerrainSmoothRange(0.015, 0.22, sqrt(max(Second, 0.0)) - sqrt(max(Nearest, 0.0)));
    return vec2(Boundary, RockTerrainUnit(RockTerrainHash(CellHash + Seed + 431u)));
}

RockTerrainGpuSample RockTerrainSampleFormation(vec3 P, RockTerrainGpuConfiguration C)
{
    uint Seed = C.GeologicalControls.x;
    vec3 Warped = RockTerrainWarp(P, 0.095, 0.55, Seed);
    float Macro = RockTerrainSpectral(Warped, 0.24, Seed + 101u);
    float Broad = RockTerrainSpectral(Warped + vec3(6.2, -4.4, 11.7), 0.075, Seed + 151u);
    float Width = C.ExtentAndHeight.x * (0.87 + 0.075 * RockTerrainSpectral(P, 0.18, Seed + 211u));
    float Depth = C.ExtentAndHeight.y * (0.87 + 0.075 * RockTerrainSpectral(P, 0.16, Seed + 223u));
    float Ellipse = length(vec2(Warped.x / max(Width, 0.1), Warped.y / max(Depth, 0.1))) - 1.0;
    float Top = C.ExtentAndHeight.z + C.ExtentAndHeight.w * (0.78 + 0.13 * Macro + 0.05 * Broad)
              + 0.75 * RockTerrainSpectral(vec3(P.xy, 0.0), 0.31, Seed + 271u);
    float Bottom = C.ExtentAndHeight.z - 0.35 + 0.18 * RockTerrainSpectral(P, 0.21, Seed + 283u);
    float D = max(Ellipse, max(P.z - Top, Bottom - P.z));
    float Height01 = clamp((P.z - C.ExtentAndHeight.z) / max(C.ExtentAndHeight.w, 0.1), 0.0, 1.0);

    float BedCoordinate = P.z + P.x * 0.09 + P.y * 0.035 + 0.28 * RockTerrainSpectral(P, 0.19, Seed + 313u);
    float BedPhase = BedCoordinate / max(C.FormationControls.x, 0.08);
    float Bedding = 0.5 + 0.5 * cos(BedPhase * 6.2831853 + 0.30 * RockTerrainSpectral(P, 0.9, Seed + 331u));
    bool Layered = C.GeologicalControls.y == 1u || C.GeologicalControls.y == 4u;
    if (Layered)
        D += (Bedding - 0.5) * 0.42 * RockTerrainSmoothRange(-0.55, 0.4, -D);

    vec2 GrainFabric = RockTerrainGrainFabric(Warped, C.FormationControls.y, Seed + 401u);
    float GrainBoundary = GrainFabric.x;
    float Grain = clamp(0.22 + 0.53 * GrainFabric.y + 0.25 * (1.0 - GrainBoundary), 0.0, 1.0);
    float SurfaceBand = exp(-abs(D) / 0.22);
    D += (GrainBoundary - 0.45) * 0.018 * C.WeatheringControls.w * SurfaceBand;

    float Runoff = clamp((0.42 + 0.34 * Height01 + 0.24 * RockTerrainSpectral(P, 0.36, Seed + 467u)), 0.0, 1.0);
    float Water = clamp(C.WeatheringControls.x * (0.35 + 0.65 * Runoff), 0.0, 1.0);
    float Salt = clamp(Water * C.WeatheringControls.y * (0.45 + 0.55 * (1.0 - Runoff)), 0.0, 1.0);
    float Oxidation = clamp((0.18 + 0.82 * Height01) * (0.38 + 0.62 * (0.5 + 0.5 * RockTerrainSpectral(P, 0.12, Seed + 491u))), 0.0, 1.0);
    float Hardness = C.GeologicalControls.y == 2u ? 0.86
                   : C.GeologicalControls.y == 3u ? 0.93
                   : C.GeologicalControls.y == 0u ? 0.77
                   : C.GeologicalControls.y == 4u ? 0.56 : 0.61;
    Hardness = clamp(Hardness + 0.18 * (GrainFabric.y - 0.5) - 0.24 * Water - 0.11 * Salt, 0.0, 1.0);

    RockTerrainGpuSample Result;
    Result.Distance = D;
    Result.Hardness = Hardness;
    Result.Grain = Grain;
    Result.Bedding = Layered ? clamp(0.22 + 0.78 * Bedding, 0.0, 1.0) : 0.08 * Bedding;
    Result.Fracture = 0.0;
    Result.WaterFlux = Water;
    Result.Salt = Salt;
    Result.Oxidation = Oxidation;

    // Cooling-front columns: the edge of a finite jittered Voronoi cell is the crack, while the spacing changes with
    // depth. This is intentionally not a regular hexagonal wallpaper.
    if (C.GeologicalControls.y == 2u)
    {
        vec3 CoolingP = RockTerrainWarp(P, 0.19, C.FormationControls.w * 0.23, Seed + 551u) / max(C.FormationControls.w, 0.18);
        ivec2 Cell = ivec2(floor(CoolingP.xy));
        float Nearest = 1e9;
        float Second = 1e9;
        for (int Y = -1; Y <= 1; ++Y)
        {
            for (int X = -1; X <= 1; ++X)
            {
                ivec3 Cell3 = ivec3(Cell + ivec2(X, Y), 0);
                uint H = RockTerrainHash3(Cell3, Seed + 563u);
                vec2 J = vec2(RockTerrainUnit(RockTerrainHash(H + 2u)), RockTerrainUnit(RockTerrainHash(H + 5u))) * 0.78 + 0.11;
                float CellDistance = length(vec2(Cell + ivec2(X, Y)) + J - CoolingP.xy);
                if (CellDistance < Nearest) { Second = Nearest; Nearest = CellDistance; }
                else if (CellDistance < Second) Second = CellDistance;
            }
        }
        float Edge = Second - Nearest;
        float Cooling = RockTerrainSmoothRange(0.10, 0.92, 1.0 - Height01);
        float Crack = 0.012 * (0.55 + 0.75 * Cooling) / max(C.FormationControls.w, 0.18);
        Result.Fracture = max(Result.Fracture, 1.0 - RockTerrainSmoothRange(Crack, Crack + 0.11, Edge));
        Result.Distance = max(Result.Distance, Crack - Edge);
    }

    // Finite fracture episodes. Every event has its own origin, strike, dip, length, aperture and fluid gate. This is
    // deliberately evaluated as a sparse population rather than a trio of infinite planes.
    float NearestJoint = 1e9;
    for (uint I = 0u; I < 56u; ++I)
    {
        uint H = RockTerrainHash(Seed + I * 0x9E3779B9u + 0x7153u);
        float U0 = RockTerrainUnit(RockTerrainHash(H + 3u));
        float U1 = RockTerrainUnit(RockTerrainHash(H + 11u));
        float U2 = RockTerrainUnit(RockTerrainHash(H + 17u));
        float Strike = float(I % 3u) * 1.04719755 + (U0 - 0.5) * 0.25;
        float Dip = (0.17 + 0.68 * U1) * (U2 < 0.5 ? -1.0 : 1.0);
        vec3 Normal = normalize(vec3(cos(Strike) * cos(Dip), sin(Strike) * cos(Dip), sin(Dip)));
        vec3 Tangent = normalize(vec3(-Normal.y, Normal.x, 0.0));
        vec3 Bitangent = normalize(cross(Normal, Tangent));
        vec3 Origin = vec3((RockTerrainUnit(RockTerrainHash(H + 23u)) * 2.0 - 1.0) * C.ExtentAndHeight.x,
                           (RockTerrainUnit(RockTerrainHash(H + 29u)) * 2.0 - 1.0) * C.ExtentAndHeight.y,
                           C.ExtentAndHeight.z + RockTerrainUnit(RockTerrainHash(H + 31u)) * C.ExtentAndHeight.w);
        vec3 R = P - Origin;
        float Along = dot(R, Tangent);
        float Across = dot(R, Bitangent);
        float Aperture = 0.006 * (0.65 + 1.75 * RockTerrainUnit(RockTerrainHash(H + 37u)));
        float HalfLength = C.FormationControls.z * (1.3 + 4.4 * RockTerrainUnit(RockTerrainHash(H + 41u)));
        float CrackSdf = max(abs(dot(R, Normal)) - Aperture, max(abs(Along) - HalfLength, abs(Across) - HalfLength * 0.60));
        NearestJoint = min(NearestJoint, abs(dot(R, Normal)));
        float Gate = (0.45 + 0.55 * RockTerrainUnit(RockTerrainHash(H + 47u))) * (0.32 + 0.68 * Result.WaterFlux);
        if (Gate > 0.18 && CrackSdf < 0.0) Result.Distance = max(Result.Distance, -CrackSdf * Gate);
    }
    Result.Fracture = max(Result.Fracture, 1.0 - RockTerrainSmoothRange(0.015, 0.16, NearestJoint));

    // Salt cavities are sparse and face-biased. A cavity is admitted only when the selected lithology is granular and
    // the local water/salt transport is high; unequal event seeds avoid the synthetic honeycomb look.
    if (C.GeologicalControls.y == 0u || C.GeologicalControls.y == 1u)
    {
        for (uint I = 0u; I < 96u; ++I)
        {
            uint H = RockTerrainHash(Seed + I * 0x85EBCA6Bu + 0x1A53u);
            float Angle = RockTerrainUnit(RockTerrainHash(H + 2u)) * 6.2831853;
            vec3 Outward = normalize(vec3(cos(Angle), sin(Angle), 0.04 * (RockTerrainUnit(RockTerrainHash(H + 5u)) - 0.5)));
            vec3 Inward = -Outward;
            float Radius = 0.10 + RockTerrainUnit(RockTerrainHash(H + 7u)) * (0.18 + 0.55 * C.WeatheringControls.y);
            float Height = C.ExtentAndHeight.z + C.ExtentAndHeight.w * (0.20 + 0.68 * RockTerrainUnit(RockTerrainHash(H + 13u)));
            vec3 Center = vec3(Outward.x * C.ExtentAndHeight.x * (0.78 + 0.17 * RockTerrainUnit(RockTerrainHash(H + 17u))),
                               Outward.y * C.ExtentAndHeight.y * (0.78 + 0.17 * RockTerrainUnit(RockTerrainHash(H + 19u))), Height)
                         + Inward * Radius * 0.48;
            vec3 R = P - Center;
            float Axial = dot(R, Inward);
            vec3 Radial = R - Inward * Axial;
            float Aspect = 0.60 + 1.45 * RockTerrainUnit(RockTerrainHash(H + 23u));
            float Cavity = sqrt(dot(Radial, Radial) / max(Radius * Radius, 1e-5)
                               + Axial * Axial / max(Radius * Radius * Aspect * Aspect, 1e-5)) - 1.0;
            float EventExposure = 0.25 + 0.75 * RockTerrainUnit(RockTerrainHash(H + 29u));
            float Gate = C.WeatheringControls.x * C.WeatheringControls.y * EventExposure * (0.55 + 0.45 * Result.WaterFlux);
            if (Gate > 0.07 && Cavity < 0.0) Result.Distance = max(Result.Distance, -Cavity * Radius * Gate);
        }
    }

    // Curved brittle impact cups are restricted to siliceous / volcanic regimes. Their rim ripple changes with the
    // event energy and local field, so it is not a single conchoidal decal repeated over the formation.
    if (C.GeologicalControls.y == 2u || C.GeologicalControls.y == 3u)
    {
        for (uint I = 0u; I < 36u; ++I)
        {
            uint H = RockTerrainHash(Seed + I * 0xC2B2AE35u + 0x2E91u);
            float Angle = RockTerrainUnit(RockTerrainHash(H + 3u)) * 6.2831853;
            vec3 Normal = normalize(vec3(cos(Angle), sin(Angle), 0.12 * (RockTerrainUnit(RockTerrainHash(H + 5u)) - 0.5)));
            float Radius = 0.08 + RockTerrainUnit(RockTerrainHash(H + 7u)) * 0.34;
            float Height = C.ExtentAndHeight.z + C.ExtentAndHeight.w * (0.26 + 0.68 * RockTerrainUnit(RockTerrainHash(H + 11u)));
            vec3 Center = Normal * vec3(C.ExtentAndHeight.xy, 1.0) * (0.82 + 0.15 * RockTerrainUnit(RockTerrainHash(H + 13u))) + vec3(0.0, 0.0, Height);
            vec3 R = P - Center;
            float Along = dot(R, Normal);
            float Radial = length(R - Normal * Along);
            float Cap = max(0.0, 1.0 - Radial / max(Radius, 1e-4));
            float Energy = 0.20 + 0.80 * RockTerrainUnit(RockTerrainHash(H + 17u));
            float Bowl = abs(Along + Radius * (0.30 + 0.55 * Cap)) - Radius * 0.18;
            float Ripple = 0.5 + 0.5 * cos(Radial * 34.0 + Energy * 9.0 + RockTerrainSpectral(P, 1.7, Seed + 601u));
            if (Cap > 0.0 && Bowl < 0.0) { Result.Distance = max(Result.Distance, -Bowl * Energy * (0.45 + 0.55 * Ripple)); Result.Fracture = max(Result.Fracture, Energy * Cap); }
        }
    }

    Result.Distance += SurfaceBand * 0.55 * (0.014 + 0.042 * (0.35 * Water + 0.25 * Salt + 0.18 * C.WeatheringControls.z)) * (1.12 - Hardness);
    return Result;
}

RockTerrainGpuSample RockTerrainApplyBrushes(vec3 P, RockTerrainGpuConfiguration C,
                                             RockTerrainGpuBrush Brushes[64], RockTerrainGpuSample Result)
{
    uint Count = min(C.GeologicalControls.z, 64u);
    for (uint I = 0u; I < Count; ++I)
    {
        RockTerrainGpuBrush Brush = Brushes[I];
        vec3 Offset = P - Brush.CenterAndRadius.xyz;
        float Radius = max(Brush.CenterAndRadius.w, 1e-4);
        float Influence = pow(clamp(1.0 - length(Offset) / Radius, 0.0, 1.0), 1.0 + Brush.StrengthAndShape.y * 5.0);
        float Sphere = length(Offset) - Radius;
        uint Category = uint(Brush.StrengthAndShape.z);
        if (Category == 0u) Result.Distance = min(Result.Distance, Sphere - Brush.StrengthAndShape.x * Influence);
        if (Category == 1u) Result.Distance = max(Result.Distance, -Sphere + Brush.StrengthAndShape.x * Influence);
        if (Category == 2u) Result.Distance += (-Result.Distance) * Influence * clamp(Brush.StrengthAndShape.x / Radius, 0.0, 1.0);
        if (Category == 3u) { Result.Distance = max(Result.Distance, Brush.StrengthAndShape.x * Influence - abs(Offset.z) * 0.18); Result.Fracture = max(Result.Fracture, Influence); }
    }
    return Result;
}

float RockTerrainDistance(vec3 P, RockTerrainGpuConfiguration Configuration,
                          RockTerrainGpuBrush Brushes[64])
{
    return RockTerrainApplyBrushes(P, Configuration, Brushes,
                                   RockTerrainSampleFormation(P, Configuration)).Distance;
}

vec3 RockTerrainNormal(vec3 P, RockTerrainGpuConfiguration Configuration,
                       RockTerrainGpuBrush Brushes[64], float Epsilon)
{
    float X = RockTerrainDistance(P + vec3(Epsilon, 0.0, 0.0), Configuration, Brushes)
            - RockTerrainDistance(P - vec3(Epsilon, 0.0, 0.0), Configuration, Brushes);
    float Y = RockTerrainDistance(P + vec3(0.0, Epsilon, 0.0), Configuration, Brushes)
            - RockTerrainDistance(P - vec3(0.0, Epsilon, 0.0), Configuration, Brushes);
    float Z = RockTerrainDistance(P + vec3(0.0, 0.0, Epsilon), Configuration, Brushes)
            - RockTerrainDistance(P - vec3(0.0, 0.0, Epsilon), Configuration, Brushes);
    return normalize(vec3(X, Y, Z));
}

// Conservative sphere tracing. The 0.72 safety factor matters because weathering and brush fields are composed from
// several bounded terms and are distance-like rather than a single primitive exact distance.
bool RockTerrainTrace(vec3 Origin, vec3 Direction, RockTerrainGpuConfiguration Configuration,
                      RockTerrainGpuBrush Brushes[64], out vec3 HitPosition, out float Travel)
{
    vec3 Bounds = vec3(Configuration.ExtentAndHeight.xy + 1.0, Configuration.ExtentAndHeight.w + 1.4);
    float Near = 0.0;
    float Far = 1000.0;
    // Ray-box entry is intentionally kept local so this include can be used by a preview pass without a BVH dependency.
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        float O = Origin[Axis];
        float D = Direction[Axis];
        float B = Axis == 2 ? Configuration.ExtentAndHeight.z + Configuration.ExtentAndHeight.w * 0.5 : 0.0;
        float H = Axis == 2 ? Configuration.ExtentAndHeight.w * 0.5 + 1.0 : Bounds[Axis];
        float Inv = 1.0 / max(abs(D), 1e-5) * (D < 0.0 ? -1.0 : 1.0);
        float A = (B - H - O) * Inv;
        float Z = (B + H - O) * Inv;
        Near = max(Near, min(A, Z));
        Far = min(Far, max(A, Z));
    }
    if (Far < Near) return false;
    Travel = max(Near, 0.0);
    for (uint Step = 0u; Step < 192u && Travel < Far; ++Step)
    {
        HitPosition = Origin + Direction * Travel;
        float Distance = RockTerrainDistance(HitPosition, Configuration, Brushes);
        if (Distance < 0.0015) return true;
        Travel += max(Distance * 0.72, 0.0015);
    }
    return false;
}

#endif // FRONTIER_ROCK_TERRAIN_SDF
