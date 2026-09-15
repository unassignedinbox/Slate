//============================================================================================================================================
// 📦 Project-Zero/Source/RockTerrainSpace.cpp — Non-repeating geological SDF and authoring extraction
//============================================================================================================================================

#include "RockTerrainSpace.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace Frontier::ProjectZero {

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

float Clamp01(float V) noexcept
{
    return std::clamp(V, 0.0f, 1.0f);
}

float Smooth01(float V) noexcept
{
    V = Clamp01(V);
    return V * V * (3.0f - 2.0f * V);
}

float SmoothRange(float Edge0, float Edge1, float V) noexcept
{
    return Smooth01((V - Edge0) / std::max(Edge1 - Edge0, 1e-6f));
}

uint32_t Scramble(uint32_t X) noexcept
{
    X ^= X >> 16;
    X *= 0x7FEB352Du;
    X ^= X >> 15;
    X *= 0x846CA68Bu;
    X ^= X >> 16;
    return X;
}

uint32_t Hash3(int32_t X, int32_t Y, int32_t Z, uint32_t Seed) noexcept
{
    uint32_t H = Seed ^ 0x9E3779B9u;
    H = Scramble(H ^ static_cast<uint32_t>(X) * 0x85EBCA6Bu);
    H = Scramble(H ^ static_cast<uint32_t>(Y) * 0xC2B2AE35u);
    H = Scramble(H ^ static_cast<uint32_t>(Z) * 0x27D4EB2Fu);
    return H;
}

float HashUnit(uint32_t H) noexcept
{
    return static_cast<float>(H & 0x00FFFFFFu) / 16777215.0f;
}

float NextUnit(uint32_t& Seed) noexcept
{
    Seed = Scramble(Seed + 0x9E3779B9u);
    return HashUnit(Seed);
}

RockTerrainVector3 Cross(RockTerrainVector3 A, RockTerrainVector3 B) noexcept
{
    return RockTerrainVector3{ A.y * B.z - A.z * B.y,
                               A.z * B.x - A.x * B.z,
                               A.x * B.y - A.y * B.x };
}

RockTerrainVector3 AnyPerpendicular(RockTerrainVector3 A) noexcept
{
    const RockTerrainVector3 Reference = std::abs(A.z) < 0.8f ? RockTerrainVector3{ 0.0f, 0.0f, 1.0f }
                                                               : RockTerrainVector3{ 0.0f, 1.0f, 0.0f };
    return RockTerrainNormalize(Cross(A, Reference));
}

float SpectralField(RockTerrainVector3 P, float Frequency, uint32_t Seed) noexcept
{
    // Incommensurate finite harmonics are used only as a smooth stress / deposition field. There is no period, lookup
    // image or wrap coordinate. The changing directions are what stop bedding, grains and weathering from becoming a
    // decorative tile pasted over the rock.
    const float A = std::sin(RockTerrainDot(P, RockTerrainVector3{ 1.0000f, 0.1731f, 0.0713f }) * Frequency + HashUnit(Scramble(Seed)) * kTwoPi);
    const float B = std::sin(RockTerrainDot(P, RockTerrainVector3{ -0.2177f, 0.9411f, 0.1319f }) * Frequency * 1.61803f + HashUnit(Scramble(Seed + 17u)) * kTwoPi);
    const float C = std::sin(RockTerrainDot(P, RockTerrainVector3{ 0.0837f, -0.2913f, 0.9530f }) * Frequency * 2.41421f + HashUnit(Scramble(Seed + 43u)) * kTwoPi);
    const float D = std::sin(RockTerrainDot(P, RockTerrainVector3{ 0.5773f, 0.5773f, 0.5773f }) * Frequency * 3.14159f + HashUnit(Scramble(Seed + 71u)) * kTwoPi);
    return (A + 0.55f * B + 0.30f * C + 0.16f * D) / 2.01f;
}

RockTerrainVector3 DomainWarp(RockTerrainVector3 P, float Frequency, float Amplitude, uint32_t Seed) noexcept
{
    const float X = SpectralField(P + RockTerrainVector3{ 19.3f, -7.1f, 3.7f }, Frequency, Seed + 3u);
    const float Y = SpectralField(P + RockTerrainVector3{ -2.7f, 13.9f, 9.1f }, Frequency * 1.07f, Seed + 19u);
    const float Z = SpectralField(P + RockTerrainVector3{ 5.2f, 4.1f, -17.7f }, Frequency * 0.93f, Seed + 37u);
    return P + RockTerrainVector3{ X * Amplitude, Y * Amplitude, Z * Amplitude };
}

float EllipsoidDistance(RockTerrainVector3 P, RockTerrainVector3 Axis, float Radius, float Aspect) noexcept
{
    const float Axial = RockTerrainDot(P, Axis);
    const RockTerrainVector3 Radial = P - Axis * Axial;
    return std::sqrt(RockTerrainDot(Radial, Radial) / std::max(Radius * Radius, 1e-6f)
                   + (Axial * Axial) / std::max(Radius * Radius * Aspect * Aspect, 1e-6f)) - 1.0f;
}

float SaturatedPow(float A, float B) noexcept
{
    return std::pow(Clamp01(A), std::max(B, 0.001f));
}

struct GrainDistances
{
    float Nearest = std::numeric_limits<float>::max();
    float Second  = std::numeric_limits<float>::max();
    uint32_t Cell = 0u;
};

GrainDistances EvaluateGrains(RockTerrainVector3 P, float Scale, uint32_t Seed) noexcept
{
    const RockTerrainVector3 Q = P / std::max(Scale, 1e-4f);
    const int32_t CellX = static_cast<int32_t>(std::floor(Q.x));
    const int32_t CellY = static_cast<int32_t>(std::floor(Q.y));
    const int32_t CellZ = static_cast<int32_t>(std::floor(Q.z));
    GrainDistances Result;

    for (int32_t Z = -1; Z <= 1; ++Z)
    {
        for (int32_t Y = -1; Y <= 1; ++Y)
        {
            for (int32_t X = -1; X <= 1; ++X)
            {
                const int32_t IX = CellX + X;
                const int32_t IY = CellY + Y;
                const int32_t IZ = CellZ + Z;
                const uint32_t H = Hash3(IX, IY, IZ, Seed);
                const RockTerrainVector3 Jitter{ HashUnit(Scramble(H + 1u)) * 0.78f + 0.11f,
                                                 HashUnit(Scramble(H + 7u)) * 0.78f + 0.11f,
                                                 HashUnit(Scramble(H + 13u)) * 0.78f + 0.11f };
                const RockTerrainVector3 Delta{ static_cast<float>(IX) + Jitter.x - Q.x,
                                                static_cast<float>(IY) + Jitter.y - Q.y,
                                                static_cast<float>(IZ) + Jitter.z - Q.z };
                const float D = RockTerrainDot(Delta, Delta);
                if (D < Result.Nearest)
                {
                    Result.Second = Result.Nearest;
                    Result.Nearest = D;
                    Result.Cell = H;
                }
                else if (D < Result.Second)
                {
                    Result.Second = D;
                }
            }
        }
    }
    return Result;
}

} // namespace

RockTerrainVector3 operator+(RockTerrainVector3 A, RockTerrainVector3 B) noexcept
{
    return RockTerrainVector3{ A.x + B.x, A.y + B.y, A.z + B.z };
}

RockTerrainVector3 operator-(RockTerrainVector3 A, RockTerrainVector3 B) noexcept
{
    return RockTerrainVector3{ A.x - B.x, A.y - B.y, A.z - B.z };
}

RockTerrainVector3 operator*(RockTerrainVector3 A, float B) noexcept
{
    return RockTerrainVector3{ A.x * B, A.y * B, A.z * B };
}

RockTerrainVector3 operator/(RockTerrainVector3 A, float B) noexcept
{
    const float Inverse = 1.0f / std::max(std::abs(B), 1e-12f) * (B < 0.0f ? -1.0f : 1.0f);
    return A * Inverse;
}

float RockTerrainDot(RockTerrainVector3 A, RockTerrainVector3 B) noexcept
{
    return A.x * B.x + A.y * B.y + A.z * B.z;
}

float RockTerrainLength(RockTerrainVector3 A) noexcept
{
    return std::sqrt(RockTerrainDot(A, A));
}

RockTerrainVector3 RockTerrainNormalize(RockTerrainVector3 A) noexcept
{
    const float Length = RockTerrainLength(A);
    return Length > 1e-7f ? A / Length : RockTerrainVector3{ 0.0f, 0.0f, 1.0f };
}

RockTerrainSpace::RockTerrainSpace() noexcept
{
    RebuildGeologicalEvents();
}

RockTerrainSpace::RockTerrainSpace(const RockTerrainConfiguration& InitialConfiguration) noexcept
    : Configuration(InitialConfiguration)
{
    RebuildGeologicalEvents();
}

void RockTerrainSpace::AssignConfiguration(const RockTerrainConfiguration& NewConfiguration) noexcept
{
    Configuration = NewConfiguration;
    Configuration.ExtractionResolution = std::clamp(Configuration.ExtractionResolution, 12u, 192u);
    Configuration.ExtentX = std::max(Configuration.ExtentX, 1.0f);
    Configuration.ExtentY = std::max(Configuration.ExtentY, 1.0f);
    Configuration.Height = std::max(Configuration.Height, 0.5f);
    Configuration.Bottom = std::min(Configuration.Bottom, -0.1f);
    RebuildGeologicalEvents();
}

void RockTerrainSpace::RebuildGeologicalEvents() noexcept
{
    PocketEvents.clear();
    FractureEvents.clear();
    ImpactEvents.clear();

    uint32_t Stream = Configuration.Seed;
    const uint32_t PocketCount = static_cast<uint32_t>(std::clamp(4.0f + Configuration.TafoniDensity * 92.0f, 0.0f, 128.0f));
    for (uint32_t I = 0u; I < PocketCount; ++I)
    {
        const float Angle = NextUnit(Stream) * kTwoPi;
        const float Height = Configuration.Bottom + Configuration.Height * (0.20f + 0.68f * NextUnit(Stream));
        const float Radius = 0.10f + NextUnit(Stream) * (0.18f + 0.55f * Configuration.TafoniDensity);
        RockTerrainVector3 Outward{ std::cos(Angle), std::sin(Angle), 0.04f * (NextUnit(Stream) - 0.5f) };
        Outward = RockTerrainNormalize(Outward);
        const RockTerrainVector3 Inward = Outward * -1.0f;
        PocketEvent Event{};
        Event.Center = RockTerrainVector3{ Outward.x * Configuration.ExtentX * (0.78f + 0.17f * NextUnit(Stream)),
                                           Outward.y * Configuration.ExtentY * (0.78f + 0.17f * NextUnit(Stream)), Height } + Inward * (Radius * 0.48f);
        Event.Axis = Inward;
        Event.Radius = Radius;
        Event.Aspect = 0.60f + 1.45f * NextUnit(Stream);
        Event.Exposure = 0.25f + 0.75f * NextUnit(Stream);
        Event.CementContrast = 0.30f + 0.70f * NextUnit(Stream);
        PocketEvents.push_back(Event);
    }

    const uint32_t FractureCount = 22u + static_cast<uint32_t>(Configuration.JointSpacing > 0.0f ? 34.0f / Configuration.JointSpacing : 34.0f);
    for (uint32_t I = 0u; I < FractureCount; ++I)
    {
        const float Family = static_cast<float>(I % 3u);
        const float Strike = Family * (kPi / 3.0f) + (NextUnit(Stream) - 0.5f) * 0.25f;
        const float Dip = (0.17f + 0.68f * NextUnit(Stream)) * (NextUnit(Stream) < 0.5f ? -1.0f : 1.0f);
        RockTerrainVector3 Normal = RockTerrainNormalize(RockTerrainVector3{ std::cos(Strike) * std::cos(Dip),
                                                                              std::sin(Strike) * std::cos(Dip),
                                                                              std::sin(Dip) });
        RockTerrainVector3 Tangent = AnyPerpendicular(Normal);
        const RockTerrainVector3 Origin{ (NextUnit(Stream) * 2.0f - 1.0f) * Configuration.ExtentX,
                                         (NextUnit(Stream) * 2.0f - 1.0f) * Configuration.ExtentY,
                                         Configuration.Bottom + NextUnit(Stream) * Configuration.Height };
        FractureEvent Event{};
        Event.Origin = Origin;
        Event.Normal = Normal;
        Event.Tangent = Tangent;
        Event.HalfLength = Configuration.JointSpacing * (1.3f + 4.4f * NextUnit(Stream));
        Event.Aperture = Configuration.JointAperture * (0.65f + 1.75f * NextUnit(Stream));
        Event.Displacement = Configuration.JointDisplacement * (NextUnit(Stream) < 0.28f ? NextUnit(Stream) : 0.0f);
        Event.Weakness = 0.45f + 0.55f * NextUnit(Stream);
        FractureEvents.push_back(Event);
    }

    const uint32_t ImpactCount = static_cast<uint32_t>(std::clamp(2.0f + Configuration.ConchoidalDensity * 38.0f, 0.0f, 64.0f));
    for (uint32_t I = 0u; I < ImpactCount; ++I)
    {
        const float Angle = NextUnit(Stream) * kTwoPi;
        const float Height = Configuration.Bottom + Configuration.Height * (0.26f + 0.68f * NextUnit(Stream));
        RockTerrainVector3 Normal = RockTerrainNormalize(RockTerrainVector3{ std::cos(Angle), std::sin(Angle), 0.12f * (NextUnit(Stream) - 0.5f) });
        ImpactEvent Event{};
        Event.Normal = Normal;
        Event.Radius = 0.08f + NextUnit(Stream) * 0.34f;
        const RockTerrainVector3 SurfaceOffset{ Normal.x * Configuration.ExtentX,
                                                 Normal.y * Configuration.ExtentY,
                                                 Normal.z };
        Event.Center = SurfaceOffset * (0.82f + 0.15f * NextUnit(Stream)) + RockTerrainVector3{ 0.0f, 0.0f, Height };
        Event.Energy = 0.20f + 0.80f * NextUnit(Stream);
        ImpactEvents.push_back(Event);
    }
}

RockTerrainSample RockTerrainSpace::SampleFormation(RockTerrainVector3 Position) const noexcept
{
    const RockTerrainConfiguration& C = Configuration;
    RockTerrainVector3 Warped = DomainWarp(Position, 0.095f, 0.55f, C.Seed);
    const float Macro = SpectralField(Warped, 0.24f, C.Seed + 101u);
    const float Broad = SpectralField(Warped + RockTerrainVector3{ 6.2f, -4.4f, 11.7f }, 0.075f, C.Seed + 151u);

    const float Width = C.ExtentX * (0.87f + 0.075f * SpectralField(Position, 0.18f, C.Seed + 211u));
    const float Depth = C.ExtentY * (0.87f + 0.075f * SpectralField(Position, 0.16f, C.Seed + 223u));
    const float Ellipse = std::sqrt((Warped.x / std::max(Width, 0.1f)) * (Warped.x / std::max(Width, 0.1f))
                                  + (Warped.y / std::max(Depth, 0.1f)) * (Warped.y / std::max(Depth, 0.1f))) - 1.0f;
    const float Top = C.Bottom + C.Height * (0.78f + 0.13f * Macro + 0.05f * Broad)
                    + 0.75f * SpectralField(RockTerrainVector3{ Position.x, Position.y, 0.0f }, 0.31f, C.Seed + 271u);
    const float Bottom = C.Bottom - 0.35f + 0.18f * SpectralField(Position, 0.21f, C.Seed + 283u);
    float FormationDistance = std::max(Ellipse, std::max(Position.z - Top, Bottom - Position.z));

    RockTerrainSample Result{};
    Result.FormationDistance = FormationDistance;
    Result.Distance = FormationDistance;

    const float NormalizedHeight = Clamp01((Position.z - C.Bottom) / std::max(C.Height, 0.1f));
    const bool Layered = C.Formation == RockFormationCategory::Sandstone || C.Formation == RockFormationCategory::Schist;
    const float Dip = C.Formation == RockFormationCategory::Schist ? 0.24f : 0.09f;
    const float BedCoordinate = Position.z + Position.x * Dip + Position.y * 0.035f
                              + 0.28f * SpectralField(Position, 0.19f, C.Seed + 313u);
    const float BedPhase = BedCoordinate / std::max(C.BeddingSpacing, 0.08f);
    const float Boundary = 0.5f + 0.5f * std::cos(BedPhase * kTwoPi + 0.30f * SpectralField(Position, 0.9f, C.Seed + 331u));
    Result.Bedding = Layered ? Clamp01(0.22f + 0.78f * Boundary) : 0.08f * Boundary;
    if (Layered)
    {
        const float BedRelief = (Boundary - 0.5f) * C.BeddingVariation * (0.35f + 0.65f * SmoothRange(0.0f, 1.0f, NormalizedHeight));
        FormationDistance += BedRelief * SmoothRange(-0.55f, 0.4f, -FormationDistance);
        Result.FormationDistance = FormationDistance;
        Result.Distance = FormationDistance;
    }

    const GrainDistances Grain = EvaluateGrains(Warped, C.GrainScale, C.Seed + 401u);
    const float BoundaryDistance = std::sqrt(std::max(Grain.Second, 0.0f)) - std::sqrt(std::max(Grain.Nearest, 0.0f));
    const float GrainBoundary = 1.0f - SmoothRange(0.015f, 0.22f, BoundaryDistance);
    const float GrainCell = HashUnit(Scramble(Grain.Cell + C.Seed + 431u));
    Result.Grain = Clamp01(0.22f + 0.53f * GrainCell + 0.25f * (1.0f - GrainBoundary));

    const float FaceExposure = Clamp01(0.42f + 0.34f * NormalizedHeight + 0.24f * SpectralField(Position, 0.36f, C.Seed + 467u));
    const float Runoff = Clamp01(FaceExposure * (0.35f + 0.65f * (0.5f + 0.5f * SpectralField(Position + RockTerrainVector3{ 0.0f, 0.0f, 9.0f }, 0.17f, C.Seed + 479u))));
    Result.WaterFlux = Clamp01(C.WaterExposure * (0.35f + 0.65f * Runoff) * (0.52f + C.Porosity * 0.48f));
    Result.Salt = Clamp01(Result.WaterFlux * C.SaltWeathering * (0.45f + 0.55f * (1.0f - Runoff)));
    Result.Oxidation = Clamp01((0.18f + 0.82f * NormalizedHeight) * (0.38f + 0.62f * (0.5f + 0.5f * SpectralField(Position, 0.12f, C.Seed + 491u))));

    const float BaseHardness = C.Formation == RockFormationCategory::Basalt ? 0.86f
                             : C.Formation == RockFormationCategory::Chert ? 0.93f
                             : C.Formation == RockFormationCategory::Granite ? 0.77f
                             : C.Formation == RockFormationCategory::Schist ? 0.56f : 0.61f;
    Result.Hardness = Clamp01(BaseHardness + 0.18f * (GrainCell - 0.5f) - 0.24f * Result.WaterFlux - 0.11f * Result.Salt);

    // Grains and lithologic contrast alter the actual surface field only in a narrow exposed band; they are not a
    // normal-map overlay. The finite field remains continuous in the rock interior.
    const float SurfaceBand = std::exp(-std::abs(FormationDistance) / 0.22f);
    Result.Distance += (GrainBoundary - 0.45f) * C.GrainRelief * C.SurfaceDetail * SurfaceBand * (1.0f - 0.35f * Result.Hardness);

    // Exfoliation / spheroidal weathering is activated by pressure release and by water reaching joints. This rounds
    // intersections of the formation boundary instead of placing concentric shells around a primitive ball.
    const float CornerExposure = SmoothRange(0.0f, 0.42f, std::abs(Ellipse));
    const float SheetField = 0.5f + 0.5f * std::cos((Position.z + 0.17f * Position.x) * 2.0f * kPi / 1.7f
                                                    + 0.33f * SpectralField(Position, 0.23f, C.Seed + 521u));
    Result.Distance += SurfaceBand * C.SpheroidalWeathering * (0.028f + 0.05f * CornerExposure) * (0.48f + 0.52f * SheetField);

    if (C.Formation == RockFormationCategory::Granite)
    {
        Result.Distance += SurfaceBand * 0.035f * (0.45f + 0.55f * SheetField);
    }
    else if (C.Formation == RockFormationCategory::Basalt)
    {
        // Columns form from a cooling front. Their spacing and fracture aperture vary with depth; the edge field below
        // is a jittered Voronoi stress solution, not a tiled hexagon texture.
        const float CellScale = std::max(C.ColumnScale, 0.18f);
        const RockTerrainVector3 CoolingP = DomainWarp(Position, 0.19f, CellScale * 0.23f, C.Seed + 551u) / CellScale;
        const int32_t CellX = static_cast<int32_t>(std::floor(CoolingP.x));
        const int32_t CellY = static_cast<int32_t>(std::floor(CoolingP.y));
        float Nearest = std::numeric_limits<float>::max();
        float Second = std::numeric_limits<float>::max();
        for (int32_t Y = -1; Y <= 1; ++Y)
        {
            for (int32_t X = -1; X <= 1; ++X)
            {
                const uint32_t H = Hash3(CellX + X, CellY + Y, 0, C.Seed + 563u);
                const RockTerrainVector3 J{ HashUnit(Scramble(H + 2u)) * 0.78f + 0.11f,
                                            HashUnit(Scramble(H + 5u)) * 0.78f + 0.11f, 0.0f };
                const float D = (static_cast<float>(CellX + X) + J.x - CoolingP.x) * (static_cast<float>(CellX + X) + J.x - CoolingP.x)
                              + (static_cast<float>(CellY + Y) + J.y - CoolingP.y) * (static_cast<float>(CellY + Y) + J.y - CoolingP.y);
                if (D < Nearest) { Second = Nearest; Nearest = D; }
                else if (D < Second) Second = D;
            }
        }
        const float CellEdge = std::sqrt(std::max(Second, 0.0f)) - std::sqrt(std::max(Nearest, 0.0f));
        const float Cooling = SmoothRange(0.10f, 0.92f, 1.0f - NormalizedHeight);
        const float ColumnCrack = (C.JointAperture / CellScale) * (0.55f + 0.75f * Cooling);
        Result.Fracture = std::max(Result.Fracture, 1.0f - SmoothRange(ColumnCrack, ColumnCrack + 0.11f, CellEdge));
        Result.Distance = std::max(Result.Distance, ColumnCrack - CellEdge);
    }

    float NearestFracture = std::numeric_limits<float>::max();
    for (const FractureEvent& Event : FractureEvents)
    {
        const RockTerrainVector3 R = Position - Event.Origin;
        const float Along = RockTerrainDot(R, Event.Tangent);
        const RockTerrainVector3 Bitangent = RockTerrainNormalize(Cross(Event.Normal, Event.Tangent));
        const float Across = RockTerrainDot(R, Bitangent);
        const float Plane = std::abs(RockTerrainDot(R, Event.Normal)) - Event.Aperture;
        const float Segment = std::max(std::abs(Along) - Event.HalfLength, std::abs(Across) - Event.HalfLength * 0.60f);
        const float CrackSdf = std::max(Plane, Segment);
        NearestFracture = std::min(NearestFracture, std::abs(RockTerrainDot(R, Event.Normal)));
        const float Gate = Event.Weakness * (0.32f + 0.68f * Result.WaterFlux);
        if (Gate > 0.18f && CrackSdf < 0.0f)
        {
            Result.Distance = std::max(Result.Distance, -CrackSdf * Gate);
            Result.Debris = std::max(Result.Debris, Gate * SmoothRange(-0.18f, 0.0f, CrackSdf));
        }
    }
    Result.Fracture = std::max(Result.Fracture, 1.0f - SmoothRange(0.015f, 0.16f, NearestFracture));

    // Salt cavities are placed as a finite event population on exposed faces. Their size, direction, cement contrast and
    // nested probability are independent, so the result has no repeated honeycomb period.
    if (C.Formation == RockFormationCategory::Sandstone || C.Formation == RockFormationCategory::Granite)
    {
        for (const PocketEvent& Event : PocketEvents)
        {
            const float Cavity = EllipsoidDistance(Position - Event.Center, Event.Axis, Event.Radius, Event.Aspect);
            const float LocalSalt = C.SaltWeathering * C.WaterExposure * Event.Exposure * (1.0f - 0.45f * Event.CementContrast);
            if (LocalSalt > 0.07f && Cavity < 0.0f)
            {
                const float Aperture = LocalSalt * (0.42f + 0.58f * Result.WaterFlux);
                Result.Distance = std::max(Result.Distance, -Cavity * Event.Radius * Aperture);
                Result.Debris = std::max(Result.Debris, Aperture * SmoothRange(-0.7f, 0.0f, Cavity));
            }
        }
    }

    if (C.Formation == RockFormationCategory::Chert || C.Formation == RockFormationCategory::Basalt)
    {
        for (const ImpactEvent& Event : ImpactEvents)
        {
            const RockTerrainVector3 R = Position - Event.Center;
            const float Along = RockTerrainDot(R, Event.Normal);
            const RockTerrainVector3 Radial = R - Event.Normal * Along;
            const float RadialLength = RockTerrainLength(Radial);
            const float Cap = std::max(0.0f, 1.0f - RadialLength / std::max(Event.Radius, 1e-4f));
            const float Bowl = std::abs(Along + Event.Radius * (0.30f + 0.55f * Cap)) - Event.Radius * 0.18f;
            const float Ripple = 0.5f + 0.5f * std::cos(RadialLength * 34.0f + Event.Energy * 9.0f + SpectralField(Position, 1.7f, C.Seed + 601u));
            if (Cap > 0.0f && Bowl < 0.0f)
            {
                Result.Distance = std::max(Result.Distance, -Bowl * Event.Energy * (0.45f + 0.55f * Ripple));
                Result.Fracture = std::max(Result.Fracture, Event.Energy * Cap);
            }
        }
    }

    const float WeatheringAccess = Clamp01(0.35f * Result.WaterFlux + 0.25f * Result.Salt + 0.18f * C.FreezeThaw
                                         + 0.12f * C.Insolation + 0.10f * C.WindAbrasion);
    const float WeatheringDepth = SurfaceBand * C.MacroErosion * (0.014f + 0.042f * WeatheringAccess) * (1.12f - Result.Hardness);
    Result.Distance += WeatheringDepth;
    Result.Debris = std::max(Result.Debris, Clamp01(WeatheringAccess * (1.0f - Result.Hardness)));
    return Result;
}

RockTerrainSample RockTerrainSpace::ApplySculpting(RockTerrainVector3 Position, RockTerrainSample Result) const noexcept
{
    for (const RockBrushStroke& Stroke : SculptStrokes)
    {
        const RockTerrainVector3 Offset = Position - Stroke.Center;
        const float Distance = RockTerrainLength(Offset);
        const float Influence = SaturatedPow(1.0f - Distance / std::max(Stroke.Radius, 1e-4f), 1.0f + Stroke.Hardness * 5.0f);
        if (Influence <= 0.0f) continue;

        const float Sphere = Distance - Stroke.Radius;
        switch (Stroke.Category)
        {
            case RockBrushCategory::AddMass:
                Result.Distance = std::min(Result.Distance, Sphere - Stroke.Strength * Influence);
                break;
            case RockBrushCategory::RemoveMass:
                Result.Distance = std::max(Result.Distance, -Sphere + Stroke.Strength * Influence);
                break;
            case RockBrushCategory::SmoothFormation:
                Result.Distance += (Result.FormationDistance - Result.Distance) * Influence * Clamp01(Stroke.Strength / std::max(Stroke.Radius, 1e-4f));
                Result.Fracture *= 1.0f - Influence;
                break;
            case RockBrushCategory::SharpenFracture:
                Result.Distance = std::max(Result.Distance, Stroke.Strength * Influence - std::abs(Offset.z) * 0.18f);
                Result.Fracture = std::max(Result.Fracture, Influence);
                break;
        }
    }
    return Result;
}

RockTerrainSample RockTerrainSpace::Sample(RockTerrainVector3 Position) const noexcept
{
    return ApplySculpting(Position, SampleFormation(Position));
}

void RockTerrainSpace::AddSculptStroke(const RockBrushStroke& Stroke) noexcept
{
    RockBrushStroke Sanitised = Stroke;
    Sanitised.Radius = std::clamp(Sanitised.Radius, 0.01f, 100.0f);
    Sanitised.Hardness = Clamp01(Sanitised.Hardness);
    Sanitised.Strength = std::clamp(Sanitised.Strength, 0.0f, Sanitised.Radius * 4.0f);
    if (SculptStrokes.size() >= 1024u) SculptStrokes.erase(SculptStrokes.begin());
    SculptStrokes.push_back(Sanitised);
}

bool RockTerrainSpace::UndoSculptStroke() noexcept
{
    if (SculptStrokes.empty()) return false;
    SculptStrokes.pop_back();
    return true;
}

void RockTerrainSpace::ClearSculpting() noexcept
{
    SculptStrokes.clear();
}

void RockTerrainSpace::ExtractSurface(std::vector<RockTerrainVertex>& Vertices, std::vector<uint32_t>& Indices) const
{
    Vertices.clear();
    Indices.clear();

    const uint32_t N = std::clamp(Configuration.ExtractionResolution, 12u, 192u);
    const RockTerrainVector3 Minimum{ -Configuration.ExtentX - 1.0f, -Configuration.ExtentY - 1.0f, Configuration.Bottom - 1.0f };
    const RockTerrainVector3 Maximum{  Configuration.ExtentX + 1.0f,  Configuration.ExtentY + 1.0f, Configuration.Bottom + Configuration.Height + 1.4f };
    const RockTerrainVector3 Step{ (Maximum.x - Minimum.x) / static_cast<float>(N),
                                   (Maximum.y - Minimum.y) / static_cast<float>(N),
                                   (Maximum.z - Minimum.z) / static_cast<float>(N) };

    const auto CornerPosition = [&](uint32_t X, uint32_t Y, uint32_t Z, uint32_t Corner) -> RockTerrainVector3
    {
        return Minimum + RockTerrainVector3{ (static_cast<float>(X) + static_cast<float>((Corner >> 0u) & 1u)) * Step.x,
                                             (static_cast<float>(Y) + static_cast<float>((Corner >> 1u) & 1u)) * Step.y,
                                             (static_cast<float>(Z) + static_cast<float>((Corner >> 2u) & 1u)) * Step.z };
    };

    const auto Gradient = [&](RockTerrainVector3 P) -> RockTerrainVector3
    {
        const float E = std::max(std::min({ Step.x, Step.y, Step.z }) * 0.35f, 0.0005f);
        return RockTerrainNormalize(RockTerrainVector3{ Sample(P + RockTerrainVector3{ E, 0.0f, 0.0f }).Distance - Sample(P - RockTerrainVector3{ E, 0.0f, 0.0f }).Distance,
                                                         Sample(P + RockTerrainVector3{ 0.0f, E, 0.0f }).Distance - Sample(P - RockTerrainVector3{ 0.0f, E, 0.0f }).Distance,
                                                         Sample(P + RockTerrainVector3{ 0.0f, 0.0f, E }).Distance - Sample(P - RockTerrainVector3{ 0.0f, 0.0f, E }).Distance });
    };

    const auto EmitTriangle = [&](RockTerrainVector3 A, RockTerrainVector3 B, RockTerrainVector3 C)
    {
        RockTerrainVector3 NA = Gradient(A);
        RockTerrainVector3 NB = Gradient(B);
        RockTerrainVector3 NC = Gradient(C);
        if (RockTerrainDot(Cross(B - A, C - A), NA + NB + NC) < 0.0f)
        {
            std::swap(B, C);
            std::swap(NB, NC);
        }
        const RockTerrainVector3 Points[3] = { A, B, C };
        const RockTerrainVector3 Normals[3] = { NA, NB, NC };
        for (uint32_t I = 0u; I < 3u; ++I)
        {
            const RockTerrainSample S = Sample(Points[I]);
            Vertices.push_back(RockTerrainVertex{ Points[I], Normals[I], S.Hardness, S.Grain, S.Bedding, S.Fracture, S.Salt, S.Oxidation });
            Indices.push_back(static_cast<uint32_t>(Vertices.size() - 1u));
        }
    };

    const uint32_t Tetrahedra[6][4] =
    {
        { 0u, 1u, 3u, 7u }, { 0u, 1u, 7u, 5u }, { 0u, 2u, 3u, 7u },
        { 0u, 2u, 7u, 6u }, { 0u, 4u, 5u, 7u }, { 0u, 4u, 7u, 6u }
    };
    const uint32_t EdgeA[6] = { 0u, 0u, 0u, 1u, 1u, 2u };
    const uint32_t EdgeB[6] = { 1u, 2u, 3u, 2u, 3u, 3u };

    for (uint32_t Z = 0u; Z < N; ++Z)
    {
        for (uint32_t Y = 0u; Y < N; ++Y)
        {
            for (uint32_t X = 0u; X < N; ++X)
            {
                RockTerrainVector3 CubePosition[8];
                float CubeDistance[8];
                for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
                {
                    CubePosition[Corner] = CornerPosition(X, Y, Z, Corner);
                    CubeDistance[Corner] = Sample(CubePosition[Corner]).Distance;
                }
                for (const auto& Tetra : Tetrahedra)
                {
                    RockTerrainVector3 Hit[4];
                    uint32_t HitCount = 0u;
                    for (uint32_t Edge = 0u; Edge < 6u; ++Edge)
                    {
                        const uint32_t A = Tetra[EdgeA[Edge]];
                        const uint32_t B = Tetra[EdgeB[Edge]];
                        const bool Crosses = (CubeDistance[A] < 0.0f) != (CubeDistance[B] < 0.0f);
                        if (!Crosses || HitCount >= 4u) continue;
                        const float Denominator = CubeDistance[A] - CubeDistance[B];
                        const float T = std::clamp(std::abs(Denominator) > 1e-7f ? CubeDistance[A] / Denominator : 0.5f, 0.0f, 1.0f);
                        Hit[HitCount++] = CubePosition[A] + (CubePosition[B] - CubePosition[A]) * T;
                    }
                    if (HitCount == 3u) EmitTriangle(Hit[0], Hit[1], Hit[2]);
                    if (HitCount == 4u)
                    {
                        EmitTriangle(Hit[0], Hit[1], Hit[2]);
                        EmitTriangle(Hit[0], Hit[2], Hit[3]);
                    }
                }
            }
        }
    }
}

} // namespace Frontier::ProjectZero
