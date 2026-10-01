//============================================================================================================================================
//                                                   WHEELRIMSPECIFICATION.CPP
//============================================================================================================================================
// See WheelRimSpecification.h. Everything below works in metres in the rim's local frame (spin axis = +Z, outboard
//    toward +Z, barrel centre plane at z = 0), and nothing here allocates once the surface vectors are reserved.

#include "WheelRimSpecification.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <unordered_map>

namespace Frontier {

namespace {

constexpr float  kPi        = 3.14159265358979f;
constexpr float  kTau       = 6.28318530717959f;
constexpr float  kInch      = 0.0254f;
constexpr float  kMilli     = 0.001f;
constexpr double kEpsilon   = 1.0e-12;

[[nodiscard]] inline float Clamp(float X, float Low, float High) noexcept { return X < Low ? Low : (X > High ? High : X); }
[[nodiscard]] inline float Saturate(float X) noexcept { return Clamp(X, 0.0f, 1.0f); }
[[nodiscard]] inline float Mix(float A, float B, float T) noexcept { return A + (B - A) * T; }
[[nodiscard]] inline float SmoothStep(float Edge0, float Edge1, float X) noexcept
{
    const float T = Edge1 > Edge0 ? Saturate((X - Edge0) / (Edge1 - Edge0)) : (X >= Edge1 ? 1.0f : 0.0f);
    return T * T * (3.0f - 2.0f * T);
}
[[nodiscard]] inline float Radians(float Degrees) noexcept { return Degrees * kPi / 180.0f; }

// Signed contour convention everywhere below: ϕ > 0 is solid. Union is therefore a (smooth) maximum and subtraction a
//    (smooth) minimum against the negated cutter — Quílez's polynomial blend, k = fillet radius in metres.
[[nodiscard]] inline float ContourUnion(float A, float B, float K) noexcept
{
    if (K <= 0.0f) return A > B ? A : B;
    const float H = Saturate(0.5f + 0.5f * (A - B) / K);
    return Mix(B, A, H) + K * H * (1.0f - H);
}
[[nodiscard]] inline float ContourIntersect(float A, float B, float K) noexcept
{
    if (K <= 0.0f) return A < B ? A : B;
    const float H = Saturate(0.5f + 0.5f * (B - A) / K);
    return Mix(B, A, H) - K * H * (1.0f - H);
}
[[nodiscard]] inline float ContourSubtract(float A, float Cutter, float K) noexcept { return ContourIntersect(A, -Cutter, K); }

// Shortest signed angular difference in (−π, π].
[[nodiscard]] inline float AngleDelta(float A, float B) noexcept
{
    float D = std::fmod(A - B + kPi, kTau);
    if (D < 0.0f) D += kTau;
    return D - kPi;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 RESOLVED DIMENSIONS
//------------------------------------------------------------------------------------------------------------------------
// Every derived length the rest of the file needs, computed once from the automotive-unit parameters.

struct RimDimensions
{
    float BeadRadius      = 0.0f;   // [m] nominal (bead seat) radius
    float InnerRadius     = 0.0f;   // [m] barrel inner surface — the face plate welds here
    float FlangeRadius    = 0.0f;   // [m] flange tip
    float HalfWidth       = 0.0f;   // [m] half the bead-seat width
    float FlangeThickness = 0.0f;   // [m]
    float WellRadius      = 0.0f;   // [m]
    float WellCentre      = 0.0f;   // [m] axial
    float WellHalfWidth   = 0.0f;   // [m]
    float SeatWidth       = 0.0f;   // [m] axial run of one bead seat
    float MountPlane      = 0.0f;   // [m] mounting pad (ET)
    float HubFront        = 0.0f;   // [m] outboard face of the hub pad
    float LipFront        = 0.0f;   // [m] face sheet height where it meets the barrel
    float LipBack         = 0.0f;   // [m]
    float HubRadius       = 0.0f;   // [m] hub disc radius
    float BandRadius      = 0.0f;   // [m] inner radius of the solid band at the lip
    float BoreRadius      = 0.0f;   // [m]
    float LugCircleRadius = 0.0f;   // [m]
    float LugHoleRadius   = 0.0f;   // [m]
    float LugSeatRadius   = 0.0f;   // [m] outer radius of the countersink
    float LugSeatDepth    = 0.0f;   // [m]
    float ValveRadius     = 0.0f;   // [m] placement radius of the valve hole
    float ValveHoleRadius = 0.0f;   // [m]
};

[[nodiscard]] RimDimensions ResolveDimensions(const WheelRimParameters& P) noexcept
{
    RimDimensions D;
    D.BeadRadius      = 0.5f * P.DiameterInch * kInch;
    D.HalfWidth       = 0.5f * P.WidthInch * kInch;
    D.FlangeThickness = P.FlangeThicknessMillimetre * kMilli;
    D.FlangeRadius    = D.BeadRadius + P.FlangeHeightMillimetre * kMilli;
    D.InnerRadius     = D.BeadRadius - std::max(2.0f * kMilli, P.BarrelWallMillimetre * kMilli);
    D.WellRadius      = std::max(D.InnerRadius * 0.45f, D.BeadRadius - P.WellDepthMillimetre * kMilli);
    D.WellCentre      = D.HalfWidth - Clamp(P.WellOffsetFraction, 0.12f, 0.88f) * 2.0f * D.HalfWidth;
    D.WellHalfWidth   = Clamp(P.WellWidthFraction, 0.08f, 0.60f) * D.HalfWidth;
    D.SeatWidth       = 0.17f * 2.0f * D.HalfWidth;
    D.MountPlane      = P.OffsetMillimetre * kMilli;
    D.HubFront        = D.MountPlane + P.PadThicknessMillimetre * kMilli;
    D.LipFront        = D.HubFront + P.DishMillimetre * kMilli;

    // The weld ring has to sit on the outboard run of the barrel's inner wall: outboard of the drop well and inboard
    //    of the flange plate, otherwise the face plate would cut across the well and the section would self-cross.
    const float LipCeiling = D.HalfWidth + D.FlangeThickness - 2.0f * kMilli;
    const float LipFloor   = D.WellCentre + D.WellHalfWidth + 4.0f * kMilli + std::max(3.0f, P.LipThicknessMillimetre) * kMilli;
    D.LipFront            = Clamp(D.LipFront, std::min(LipFloor, LipCeiling), LipCeiling);
    D.LipBack             = D.LipFront - std::max(3.0f * kMilli, P.LipThicknessMillimetre * kMilli);

    D.HubRadius       = Clamp(P.HubRadiusFraction, 0.12f, 0.80f) * D.InnerRadius;
    D.BandRadius      = D.InnerRadius * (1.0f - Clamp(P.OuterBandFraction, 0.01f, 0.40f));
    D.BoreRadius      = 0.5f * P.CentreBoreMillimetre * kMilli;
    D.LugCircleRadius = 0.5f * P.LugCircleMillimetre * kMilli;
    D.LugHoleRadius   = 0.5f * P.LugHoleMillimetre * kMilli;
    D.LugSeatDepth    = P.LugSeatDepthMillimetre * kMilli;
    const float SeatHalf = Clamp(P.LugSeatAngleDegrees, 20.0f, 160.0f) * 0.5f;
    D.LugSeatRadius   = P.LugSeat == LugSeatCategory::Flat
                      ? D.LugHoleRadius + 3.2f * kMilli
                      : D.LugHoleRadius + D.LugSeatDepth * std::tan(Radians(SeatHalf));
    D.ValveRadius     = Mix(D.HubRadius, D.BandRadius, Clamp(P.ValveRadiusFraction, 0.05f, 0.95f));
    D.ValveHoleRadius = 0.5f * P.ValveHoleMillimetre * kMilli;
    return D;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SPOKE RECIPE
//------------------------------------------------------------------------------------------------------------------------
// Per-category deltas applied on top of the authored spoke numbers, so switching SpokeContour alone already produces a
//    recognisably different wheel without re-tuning every width.

struct SpokeRecipe
{
    uint32_t Families    = 1u;      // 1, or 2 for the counter-swept weave
    float    Sweep[2]    = { 0.0f, 0.0f };   // [rad] root ⇒ tip lean per family
    float    RootHalf    = 0.0f;    // [m]
    float    TipHalf     = 0.0f;    // [m]
    float    TaperPower  = 1.0f;
    float    SplitHalf   = 0.0f;    // [rad] half opening of a split tip, 0 = single bar
    float    Lean        = 0.0f;    // [-] asymmetric centreline shift (turbine blades)
    float    RingRadius  = 0.0f;    // [m] concentric ring (Lattice / Honeycomb); 0 = none
    float    RingHalf    = 0.0f;    // [m] half width of that ring
    bool     Staggered   = false;   // [-] Honeycomb: bars sit inside the ring, then outside it with half a pitch offset
};

[[nodiscard]] SpokeRecipe ResolveSpokeRecipe(const WheelRimParameters& P, const RimDimensions& D) noexcept
{
    SpokeRecipe R;
    R.RootHalf   = 0.5f * P.SpokeRootWidthMillimetre * kMilli;
    R.TipHalf    = 0.5f * P.SpokeTipWidthMillimetre * kMilli;
    R.TaperPower = std::max(0.2f, P.SpokeTaperPower);
    const float Sweep = Radians(P.SpokeSweepDegrees);
    switch (P.SpokeContour)
    {
        case SpokeContourCategory::Straight:
            R.Sweep[0] = Sweep;
            break;
        case SpokeContourCategory::Split:
            R.Sweep[0]   = Sweep;
            R.SplitHalf  = Radians(std::max(2.0f, P.SpokeSplitDegrees));
            R.TipHalf   *= 0.52f;
            break;
        case SpokeContourCategory::Twisted:
            R.Sweep[0] = std::abs(Sweep) > Radians(10.0f) ? Sweep : Radians(20.0f);
            break;
        case SpokeContourCategory::Turbine:
            R.Sweep[0]   = std::abs(Sweep) > Radians(14.0f) ? Sweep : Radians(28.0f);
            R.RootHalf  *= 1.22f;
            R.TipHalf   *= 1.55f;
            R.TaperPower = 0.72f;
            R.Lean       = 0.38f;
            break;
        case SpokeContourCategory::Weave:
            R.Families = 2u;
            R.Sweep[0] = std::abs(Sweep) > Radians(12.0f) ?  Sweep : Radians(24.0f);
            R.Sweep[1] = -R.Sweep[0];
            R.RootHalf *= 0.46f;
            R.TipHalf  *= 0.52f;
            break;
        case SpokeContourCategory::Dished:
            R.Sweep[0]   = Sweep;
            R.RootHalf  *= 0.62f;
            R.TipHalf   *= 2.10f;
            R.TaperPower = 2.40f;
            break;
        case SpokeContourCategory::Blade:
            // Aero disc: the bars are nearly a sector wide, so what is left reads as a slot rather than a window.
            R.Sweep[0]   = Sweep;
            R.RootHalf  *= 1.25f;
            R.TipHalf    = std::max(R.TipHalf * 2.0f, 0.60f * kPi * D.BandRadius / static_cast<float>(std::max(2u, P.SpokeCount)));
            R.TaperPower = 0.55f;
            break;
        case SpokeContourCategory::Fan:
            // Luxury multi-spoke: many thin bars of almost constant width with a gentle lean.
            R.Sweep[0]   = std::abs(Sweep) > Radians(4.0f) ? Sweep : Radians(8.0f);
            R.RootHalf  *= 0.58f;
            R.TipHalf    = R.RootHalf * 0.80f;
            R.TaperPower = 1.0f;
            break;
        case SpokeContourCategory::Lattice:
            R.Sweep[0]   = Sweep;
            R.RootHalf  *= 0.72f;
            R.TipHalf   *= 0.80f;
            R.RingRadius = Mix(D.HubRadius, D.BandRadius, Clamp(P.RingRadiusFraction, 0.15f, 0.92f));
            R.RingHalf   = 0.5f * std::max(3.0f, P.RingWidthMillimetre) * kMilli;
            break;
        case SpokeContourCategory::Honeycomb:
            R.Sweep[0]   = Sweep;
            R.RootHalf  *= 0.52f;
            R.TipHalf   *= 0.58f;
            R.TaperPower = 1.0f;
            R.RingRadius = Mix(D.HubRadius, D.BandRadius, Clamp(P.RingRadiusFraction, 0.15f, 0.92f));
            R.RingHalf   = 0.5f * std::max(3.0f, P.RingWidthMillimetre) * kMilli;
            R.Staggered  = true;
            break;
    }
    return R;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FACE CONTOUR
//------------------------------------------------------------------------------------------------------------------------
// ϕ(r,θ) in metres: a smooth-union of the hub disc, the outer band and the spoke bars, with the bore, lug holes and
//    valve hole smooth-subtracted. The union radius is the casting fillet, which is exactly why a spoke grows out of
//    the hub as one continuous surface instead of meeting it in a crease.

struct FaceContour
{
    RimDimensions D;
    SpokeRecipe   S;
    float Fillet    = 0.0f;
    float LugPhase  = 0.0f;
    float Phase     = 0.0f;
    uint32_t Lugs   = 0u;
    bool  ValveHole = false;
    float ValveAngle = 0.0f;

    [[nodiscard]] float Sample(float Radius, float Angle) const noexcept
    {
        const float Span = std::max(1.0e-4f, D.BandRadius - D.HubRadius);
        const float T    = Saturate((Radius - D.HubRadius) / Span);

        float Phi = D.HubRadius + 0.5f * Fillet - Radius;                  // hub disc
        Phi = ContourUnion(Phi, Radius - (D.BandRadius - 0.5f * Fillet), Fillet);   // outer band
        if (S.RingRadius > 0.0f)                                           // concentric ring (Lattice / Honeycomb)
            Phi = ContourUnion(Phi, S.RingHalf - std::abs(Radius - S.RingRadius), Fillet);

        const float Taper   = std::pow(T, S.TaperPower);
        const float Half    = Mix(S.RootHalf, S.TipHalf, Taper);
        const float Arc     = std::max(Radius, 1.0e-3f);

        // Honeycomb staggers the bars: inside the ring at the authored phase, outside it at half a pitch — the two
        //    rows plus the ring make hexagonal cells, all still one smooth-union contour.
        const uint32_t Rows = S.Staggered ? 2u : 1u;
        const float Feather = 0.6f * Fillet;

        for (uint32_t Family = 0u; Family < S.Families; ++Family)
        for (uint32_t Row = 0u; Row < Rows; ++Row)
        {
            float RowGate = 1.0f;
            if (S.Staggered)
                RowGate = Row == 0u ? 1.0f - SmoothStep(S.RingRadius - Feather, S.RingRadius + Feather, Radius)
                                    : SmoothStep(S.RingRadius - Feather, S.RingRadius + Feather, Radius);
            if (RowGate <= 0.001f) continue;
            const float RowHalf = Half * RowGate;
            const float Lean  = S.Sweep[Family] * (T * T * (3.0f - 2.0f * T));
            for (uint32_t Bar = 0u; Bar < SpokeCount; ++Bar)
            {
                const float Stagger = S.Staggered && Row == 1u ? kPi / static_cast<float>(SpokeCount) : 0.0f;
                const float Root = Stagger + Phase + kTau * (static_cast<float>(Bar) + 0.5f * static_cast<float>(Family) * (S.Families > 1u ? 1.0f : 0.0f)) / static_cast<float>(SpokeCount);
                const float Axis = Root + Lean + S.Lean * Half / Arc;
                if (S.SplitHalf > 0.0f)
                {
                    const float Open = S.SplitHalf * T * T;
                    const float Left  = RowHalf - std::abs(AngleDelta(Angle, Axis - Open)) * Arc;
                    const float Right = RowHalf - std::abs(AngleDelta(Angle, Axis + Open)) * Arc;
                    Phi = ContourUnion(Phi, ContourUnion(Left, Right, Fillet * 1.4f), Fillet);
                }
                else
                {
                    Phi = ContourUnion(Phi, RowHalf - std::abs(AngleDelta(Angle, Axis)) * Arc, Fillet);
                }
            }
        }

        // Cutters: centre bore, lug through-holes, valve hole.
        Phi = ContourSubtract(Phi, D.BoreRadius - Radius, 0.6f * Fillet);
        const float X = Radius * std::cos(Angle), Y = Radius * std::sin(Angle);
        for (uint32_t Lug = 0u; Lug < Lugs; ++Lug)
        {
            const float A  = LugPhase + kTau * static_cast<float>(Lug) / static_cast<float>(Lugs);
            const float Dx = X - D.LugCircleRadius * std::cos(A), Dy = Y - D.LugCircleRadius * std::sin(A);
            Phi = ContourSubtract(Phi, D.LugHoleRadius - std::sqrt(Dx * Dx + Dy * Dy), 0.35f * kMilli);
        }
        if (ValveHole)
        {
            const float Dx = X - D.ValveRadius * std::cos(ValveAngle), Dy = Y - D.ValveRadius * std::sin(ValveAngle);
            Phi = ContourSubtract(Phi, D.ValveHoleRadius - std::sqrt(Dx * Dx + Dy * Dy), 0.35f * kMilli);
        }
        return Phi;
    }

    uint32_t SpokeCount = 5u;
};

[[nodiscard]] FaceContour ResolveFaceContour(const WheelRimParameters& P, const RimDimensions& D) noexcept
{
    FaceContour C;
    C.D          = D;
    C.S          = ResolveSpokeRecipe(P, D);
    C.Fillet     = std::max(0.5f * kMilli, P.FilletMillimetre * kMilli);
    C.SpokeCount = std::max(2u, P.SpokeCount);
    C.Phase      = Radians(P.SpokePhaseDegrees);
    C.LugPhase   = Radians(P.LugPhaseDegrees);
    C.Lugs       = P.LugCount;
    C.ValveHole  = P.ValveHole;
    C.ValveAngle = Radians(P.LugPhaseDegrees) + kPi / static_cast<float>(std::max(2u, P.LugCount));
    return C;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   HEIGHT SURFACES
//------------------------------------------------------------------------------------------------------------------------
// Front sheet: dish curve from the hub pad out to the weld ring, crowned across the spoke width, countersunk at each
//    lug. Back sheet: the front minus a thickness profile that thins toward the lip and is relieved in the middle of
//    every spoke back (the casting pockets you see on a real forged face).

struct HeightSurfaces
{
    RimDimensions D;
    const FaceContour* Contour = nullptr;
    float Concavity = 1.8f;
    float Crown     = 0.0f;
    float CrownFalloff = 0.02f;
    float PadThickness = 0.018f;
    float SpokeThickness = 0.013f;
    float LipThickness = 0.009f;
    float Relief    = 0.004f;
    float ReliefFalloff = 0.02f;
    float TwistLift = 0.0f;   // [m] peak-to-mean lift of the directional twist
    uint32_t Bars   = 5u;
    float Phase     = 0.0f;
    uint32_t Lugs   = 0u;
    float LugPhase  = 0.0f;
    LugSeatCategory Seat = LugSeatCategory::Conical;

    [[nodiscard]] float SeatDrop(float X, float Y) const noexcept
    {
        if (Lugs == 0u || D.LugSeatDepth <= 0.0f) return 0.0f;
        float Drop = 0.0f;
        for (uint32_t Lug = 0u; Lug < Lugs; ++Lug)
        {
            const float A  = LugPhase + kTau * static_cast<float>(Lug) / static_cast<float>(Lugs);
            const float Dx = X - D.LugCircleRadius * std::cos(A), Dy = Y - D.LugCircleRadius * std::sin(A);
            const float Dist = std::sqrt(Dx * Dx + Dy * Dy);
            if (Dist >= D.LugSeatRadius) continue;
            const float U = Saturate((D.LugSeatRadius - Dist) / std::max(1.0e-5f, D.LugSeatRadius - D.LugHoleRadius));
            float Shape = U;                                                  // Conical: straight ramp
            if (Seat == LugSeatCategory::Ball) Shape = 1.0f - std::sqrt(std::max(0.0f, 1.0f - U * U));
            if (Seat == LugSeatCategory::Flat) Shape = SmoothStep(0.0f, 0.18f, U);
            Drop = std::max(Drop, D.LugSeatDepth * Shape);
        }
        return Drop;
    }

    [[nodiscard]] float Front(float Radius, float Angle, float Phi) const noexcept
    {
        const float Span = std::max(1.0e-4f, D.InnerRadius - D.HubRadius);
        const float T    = Saturate((Radius - D.HubRadius) / Span);
        float Z = Mix(D.HubFront, D.LipFront, std::pow(T, Concavity));
        const float CrownShape = SmoothStep(0.0f, CrownFalloff, Phi) * (1.0f - SmoothStep(0.90f, 1.0f, T));
        Z += Crown * CrownShape;
        if (TwistLift != 0.0f)
            Z += TwistLift * std::sin(static_cast<float>(Bars) * (Angle - Phase)) * CrownShape * SmoothStep(0.0f, 0.55f, T);
        Z -= SeatDrop(Radius * std::cos(Angle), Radius * std::sin(Angle));
        return Z;
    }

    [[nodiscard]] float Thickness(float Radius, float Phi) const noexcept
    {
        const float Span = std::max(1.0e-4f, D.InnerRadius - D.HubRadius);
        const float T    = Saturate((Radius - D.HubRadius) / Span);
        float Th = T < 0.34f ? Mix(PadThickness, SpokeThickness, SmoothStep(0.0f, 0.34f, T))
                             : Mix(SpokeThickness, LipThickness, SmoothStep(0.34f, 1.0f, T));
        const float Pocket = SmoothStep(0.0f, ReliefFalloff, Phi)
                           * SmoothStep(0.02f, 0.26f, T)
                           * (1.0f - SmoothStep(0.80f, 0.98f, T));
        Th -= Relief * Pocket;
        return std::max(2.5f * kMilli, Th);
    }

    [[nodiscard]] float Back(float Radius, float Angle, float Phi) const noexcept
    {
        // The countersink must not thin the pad from behind: the seat drop applies to the front only.
        const float Z = Mix(D.HubFront, D.LipFront, std::pow(Saturate((Radius - D.HubRadius) / std::max(1.0e-4f, D.InnerRadius - D.HubRadius)), Concavity));
        (void)Angle;
        return Z - Thickness(Radius, Phi);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 SURFACE ASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

struct SurfaceWriter
{
    RimSurface* Out = nullptr;

    [[nodiscard]] uint32_t AddVertex(float X, float Y, float Z) noexcept
    {
        const uint32_t Slot = static_cast<uint32_t>(Out->Positions.size() / 3u);
        Out->Positions.push_back(X); Out->Positions.push_back(Y); Out->Positions.push_back(Z);
        return Slot;
    }

    void AddTriangle(uint32_t A, uint32_t B, uint32_t C, RimSurfaceSlot Slot,
                     const float UvA[2], const float UvB[2], const float UvC[2]) noexcept
    {
        Out->Corners.push_back(A); Out->Corners.push_back(B); Out->Corners.push_back(C);
        Out->Slots.push_back(static_cast<uint32_t>(Slot));
        const float* Uvs[3] = { UvA, UvB, UvC };
        for (const float* Uv : Uvs) { Out->CornerTexcoords.push_back(Uv[0]); Out->CornerTexcoords.push_back(Uv[1]); }
    }

    void AddQuad(uint32_t A, uint32_t B, uint32_t C, uint32_t Dd, RimSurfaceSlot Slot,
                 const float UvA[2], const float UvB[2], const float UvC[2], const float UvD[2]) noexcept
    {
        AddTriangle(A, B, C, Slot, UvA, UvB, UvC);
        AddTriangle(A, C, Dd, Slot, UvA, UvC, UvD);
    }
};

// Area-weighted, crease-limited corner normals over the finished triangle list.
void ComputeCornerNormals(RimSurface& Surface, float CreaseDegrees) noexcept
{
    const uint32_t Faces    = Surface.QueryTriangleCount();
    const uint32_t Vertices = Surface.QueryVertexCount();
    std::vector<float> FaceNormals(static_cast<size_t>(Faces) * 3u, 0.0f);
    std::vector<float> FaceAreas(Faces, 0.0f);
    for (uint32_t F = 0u; F < Faces; ++F)
    {
        const uint32_t A = Surface.Corners[F * 3u + 0u], B = Surface.Corners[F * 3u + 1u], C = Surface.Corners[F * 3u + 2u];
        const float* Pa = &Surface.Positions[A * 3u]; const float* Pb = &Surface.Positions[B * 3u]; const float* Pc = &Surface.Positions[C * 3u];
        const float Ux = Pb[0] - Pa[0], Uy = Pb[1] - Pa[1], Uz = Pb[2] - Pa[2];
        const float Vx = Pc[0] - Pa[0], Vy = Pc[1] - Pa[1], Vz = Pc[2] - Pa[2];
        const float Nx = Uy * Vz - Uz * Vy, Ny = Uz * Vx - Ux * Vz, Nz = Ux * Vy - Uy * Vx;
        const float Length = std::sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
        FaceAreas[F] = 0.5f * Length;
        if (Length > 0.0f) { FaceNormals[F * 3u + 0u] = Nx / Length; FaceNormals[F * 3u + 1u] = Ny / Length; FaceNormals[F * 3u + 2u] = Nz / Length; }
    }

    // Incidence in compressed row form (counts ⇒ offsets ⇒ fill).
    std::vector<uint32_t> Offsets(static_cast<size_t>(Vertices) + 1u, 0u);
    for (uint32_t I = 0u; I < Faces * 3u; ++I) ++Offsets[Surface.Corners[I] + 1u];
    for (uint32_t V = 0u; V < Vertices; ++V) Offsets[V + 1u] += Offsets[V];
    std::vector<uint32_t> Incident(static_cast<size_t>(Faces) * 3u, 0u);
    { std::vector<uint32_t> Cursor(Offsets.begin(), Offsets.end() - 1);
      for (uint32_t F = 0u; F < Faces; ++F)
          for (uint32_t K = 0u; K < 3u; ++K) Incident[Cursor[Surface.Corners[F * 3u + K]]++] = F; }

    const float CreaseCosine = std::cos(Radians(Clamp(CreaseDegrees, 1.0f, 179.0f)));
    Surface.CornerNormals.assign(static_cast<size_t>(Faces) * 9u, 0.0f);
    for (uint32_t F = 0u; F < Faces; ++F)
        for (uint32_t K = 0u; K < 3u; ++K)
        {
            const uint32_t V = Surface.Corners[F * 3u + K];
            const float* Own = &FaceNormals[F * 3u];
            float Nx = 0.0f, Ny = 0.0f, Nz = 0.0f;
            for (uint32_t I = Offsets[V]; I < Offsets[V + 1u]; ++I)
            {
                const uint32_t G = Incident[I];
                const float* Other = &FaceNormals[G * 3u];
                if (Own[0] * Other[0] + Own[1] * Other[1] + Own[2] * Other[2] < CreaseCosine) continue;
                Nx += Other[0] * FaceAreas[G]; Ny += Other[1] * FaceAreas[G]; Nz += Other[2] * FaceAreas[G];
            }
            const float Length = std::sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
            if (Length > 1.0e-20f) { Nx /= Length; Ny /= Length; Nz /= Length; }
            else                   { Nx = Own[0]; Ny = Own[1]; Nz = Own[2]; }
            Surface.CornerNormals[F * 9u + K * 3u + 0u] = Nx;
            Surface.CornerNormals[F * 9u + K * 3u + 1u] = Ny;
            Surface.CornerNormals[F * 9u + K * 3u + 2u] = Nz;
        }
}

// Flips a triangle range when its signed volume came out negative, so every shell ends up outward-facing.
void EnforceOutwardOrientation(RimSurface& Surface, uint32_t First, uint32_t Count) noexcept
{
    double Volume = 0.0;
    for (uint32_t F = First; F < First + Count; ++F)
    {
        const float* Pa = &Surface.Positions[Surface.Corners[F * 3u + 0u] * 3u];
        const float* Pb = &Surface.Positions[Surface.Corners[F * 3u + 1u] * 3u];
        const float* Pc = &Surface.Positions[Surface.Corners[F * 3u + 2u] * 3u];
        Volume += (static_cast<double>(Pa[0]) * (static_cast<double>(Pb[1]) * Pc[2] - static_cast<double>(Pb[2]) * Pc[1])
                 - static_cast<double>(Pa[1]) * (static_cast<double>(Pb[0]) * Pc[2] - static_cast<double>(Pb[2]) * Pc[0])
                 + static_cast<double>(Pa[2]) * (static_cast<double>(Pb[0]) * Pc[1] - static_cast<double>(Pb[1]) * Pc[0])) / 6.0;
    }
    if (Volume >= 0.0) return;
    for (uint32_t F = First; F < First + Count; ++F)
    {
        std::swap(Surface.Corners[F * 3u + 1u], Surface.Corners[F * 3u + 2u]);
        for (uint32_t C = 0u; C < 2u; ++C)
            std::swap(Surface.CornerTexcoords[F * 6u + 2u + C], Surface.CornerTexcoords[F * 6u + 4u + C]);
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRESETS
//------------------------------------------------------------------------------------------------------------------------

WheelRimParameters WheelRimParameters::FromPreset(RimPresetCategory Preset) noexcept
{
    WheelRimParameters P;
    switch (Preset)
    {
        case RimPresetCategory::ForgedFiveSpoke:
            break;   // the struct defaults are this wheel

        case RimPresetCategory::SplitTenSpoke:
            P.DiameterInch = 19.0f; P.WidthInch = 8.5f; P.OffsetMillimetre = 42.0f;
            P.SpokeContour = SpokeContourCategory::Split; P.SpokeCount = 5u;
            P.SpokeRootWidthMillimetre = 70.0f; P.SpokeTipWidthMillimetre = 46.0f; P.SpokeSplitDegrees = 9.0f;
            P.DishMillimetre = 20.0f; P.ConcavityPower = 1.5f; P.FilletMillimetre = 9.0f;
            P.FaceFinish = RimFinishCategory::SatinGraphite; P.LipFinish = RimFinishCategory::SatinGraphite;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::TwentySpokeWeave:
            P.DiameterInch = 21.0f; P.WidthInch = 10.0f; P.OffsetMillimetre = 30.0f;
            P.SpokeContour = SpokeContourCategory::Weave; P.SpokeCount = 10u;
            P.SpokeRootWidthMillimetre = 46.0f; P.SpokeTipWidthMillimetre = 30.0f; P.SpokeSweepDegrees = 26.0f;
            P.HubRadiusFraction = 0.26f; P.DishMillimetre = 18.0f; P.FilletMillimetre = 7.0f;
            P.SpokeThicknessMillimetre = 10.0f; P.FaceFinish = RimFinishCategory::PolishedAlloy;
            P.AngularSegments = 640u;
            break;

        case RimPresetCategory::TurbineAero:
            P.DiameterInch = 18.0f; P.WidthInch = 8.0f; P.OffsetMillimetre = 45.0f;
            P.SpokeContour = SpokeContourCategory::Turbine; P.SpokeCount = 9u;
            P.SpokeRootWidthMillimetre = 54.0f; P.SpokeTipWidthMillimetre = 58.0f; P.SpokeSweepDegrees = 30.0f;
            P.DishMillimetre = 12.0f; P.ConcavityPower = 1.2f; P.CrownMillimetre = 4.0f;
            P.FaceFinish = RimFinishCategory::GlossPaint; P.LipFinish = RimFinishCategory::MachinedFace;
            break;

        case RimPresetCategory::DeepDishConcave:
            P.DiameterInch = 20.0f; P.WidthInch = 11.0f; P.OffsetMillimetre = 15.0f;
            P.SpokeContour = SpokeContourCategory::Dished; P.SpokeCount = 7u;
            P.SpokeRootWidthMillimetre = 48.0f; P.SpokeTipWidthMillimetre = 72.0f;
            P.DishMillimetre = 46.0f; P.ConcavityPower = 2.4f; P.OuterBandFraction = 0.04f;
            P.FaceFinish = RimFinishCategory::MatteBlack; P.LipFinish = RimFinishCategory::PolishedAlloy;
            P.WellOffsetFraction = 0.68f;
            break;

        //  ── offroad ─────────────────────────────────────────────────────────────────────────────────────────────
        case RimPresetCategory::OffroadBeadlock:
            P.DiameterInch = 17.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = -12.0f;
            P.SpokeContour = SpokeContourCategory::Straight; P.SpokeCount = 6u;
            P.SpokeRootWidthMillimetre = 86.0f; P.SpokeTipWidthMillimetre = 62.0f; P.SpokeTaperPower = 1.0f;
            P.LugCount = 6u; P.LugCircleMillimetre = 139.7f; P.LugHoleMillimetre = 16.0f; P.CentreBoreMillimetre = 106.1f;
            P.PadThicknessMillimetre = 24.0f; P.SpokeThicknessMillimetre = 19.0f; P.BarrelWallMillimetre = 8.5f;
            P.DishMillimetre = 6.0f; P.ConcavityPower = 1.1f; P.FilletMillimetre = 14.0f; P.OuterBandFraction = 0.11f;
            P.GenerateLipBolts = true; P.LipBoltCount = 24u; P.LipBoltDiameterMillimetre = 10.0f;
            P.FaceFinish = RimFinishCategory::MatteBlack; P.LipFinish = RimFinishCategory::MatteBlack;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.CapFinish = RimFinishCategory::SatinGraphite;
            P.LugNutFlatsMillimetre = 22.0f; P.LugNutHeightMillimetre = 28.0f;
            break;

        case RimPresetCategory::OffroadRockEight:
            P.DiameterInch = 17.0f; P.WidthInch = 8.5f; P.OffsetMillimetre = 0.0f;
            P.SpokeContour = SpokeContourCategory::Straight; P.SpokeCount = 8u;
            P.SpokeRootWidthMillimetre = 64.0f; P.SpokeTipWidthMillimetre = 44.0f; P.SpokeTaperPower = 1.2f;
            P.LugCount = 6u; P.LugCircleMillimetre = 139.7f; P.CentreBoreMillimetre = 106.1f;
            P.PadThicknessMillimetre = 22.0f; P.SpokeThicknessMillimetre = 17.0f; P.BarrelWallMillimetre = 8.0f;
            P.DishMillimetre = 14.0f; P.ConcavityPower = 1.3f; P.FilletMillimetre = 12.0f;
            P.GenerateLipBolts = true; P.LipBoltCount = 20u;
            P.FaceFinish = RimFinishCategory::BronzeAnodised; P.LipFinish = RimFinishCategory::BronzeAnodised;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::OffroadOverland:
            P.DiameterInch = 18.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = 10.0f;
            P.SpokeContour = SpokeContourCategory::Weave; P.SpokeCount = 8u;
            P.SpokeRootWidthMillimetre = 52.0f; P.SpokeTipWidthMillimetre = 38.0f; P.SpokeSweepDegrees = 20.0f;
            P.LugCount = 6u; P.LugCircleMillimetre = 139.7f; P.CentreBoreMillimetre = 106.1f;
            P.SpokeThicknessMillimetre = 15.0f; P.DishMillimetre = 12.0f; P.FilletMillimetre = 10.0f;
            P.GenerateLipBolts = true; P.LipBoltCount = 18u; P.LipBoltDiameterMillimetre = 8.0f;
            P.FaceFinish = RimFinishCategory::MatteBlack; P.LipFinish = RimFinishCategory::SatinGraphite;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::OffroadSteelLook:
            P.DiameterInch = 16.0f; P.WidthInch = 8.0f; P.OffsetMillimetre = -6.0f;
            P.SpokeContour = SpokeContourCategory::Blade; P.SpokeCount = 5u;
            P.SpokeRootWidthMillimetre = 52.0f; P.SpokeTipWidthMillimetre = 54.0f;
            P.LugCount = 5u; P.LugCircleMillimetre = 127.0f; P.CentreBoreMillimetre = 78.1f;
            P.PadThicknessMillimetre = 16.0f; P.SpokeThicknessMillimetre = 9.0f; P.LipThicknessMillimetre = 7.0f;
            P.DishMillimetre = 20.0f; P.ConcavityPower = 1.6f; P.CrownMillimetre = 0.0f; P.BackReliefMillimetre = 0.0f;
            P.HubRadiusFraction = 0.36f; P.FilletMillimetre = 16.0f; P.BevelMillimetre = 1.2f;
            P.GenerateCentreCap = true; P.CentreCapRadiusFraction = 0.72f; P.CentreCapDomeMillimetre = 9.0f;
            P.FaceFinish = RimFinishCategory::RaceWhite; P.LipFinish = RimFinishCategory::RaceWhite;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.CapFinish = RimFinishCategory::PolishedAlloy;
            break;

        case RimPresetCategory::OffroadDuallyRing:
            P.DiameterInch = 17.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = 5.0f;
            P.SpokeContour = SpokeContourCategory::Lattice; P.SpokeCount = 8u;
            P.SpokeRootWidthMillimetre = 56.0f; P.SpokeTipWidthMillimetre = 40.0f;
            P.RingRadiusFraction = 0.54f; P.RingWidthMillimetre = 26.0f;
            P.LugCount = 8u; P.LugCircleMillimetre = 165.1f; P.CentreBoreMillimetre = 116.7f;
            P.PadThicknessMillimetre = 24.0f; P.SpokeThicknessMillimetre = 16.0f; P.BarrelWallMillimetre = 8.0f;
            P.DishMillimetre = 10.0f; P.FilletMillimetre = 11.0f;
            P.FaceFinish = RimFinishCategory::GunmetalPaint; P.LipFinish = RimFinishCategory::GunmetalPaint;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        //  ── GT3 / endurance ─────────────────────────────────────────────────────────────────────────────────────
        case RimPresetCategory::Gt3CentreLockAero:
            P.DiameterInch = 18.0f; P.WidthInch = 12.0f; P.OffsetMillimetre = 20.0f;
            P.SpokeContour = SpokeContourCategory::Blade; P.SpokeCount = 7u;
            P.SpokeRootWidthMillimetre = 50.0f; P.SpokeTipWidthMillimetre = 56.0f; P.SpokeSweepDegrees = 12.0f;
            P.LugCount = 0u; P.CentreLock = true; P.CentreLockFlatsMillimetre = 56.0f; P.GenerateCentreCap = false;
            P.CentreBoreMillimetre = 68.0f; P.HubRadiusFraction = 0.30f;
            P.DishMillimetre = 16.0f; P.ConcavityPower = 1.4f; P.SpokeThicknessMillimetre = 10.0f;
            P.FilletMillimetre = 8.0f; P.BevelMillimetre = 2.0f; P.WellOffsetFraction = 0.66f;
            P.FaceFinish = RimFinishCategory::GoldAnodised; P.LipFinish = RimFinishCategory::GoldAnodised;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.HardwareFinish = RimFinishCategory::SteelHardware;
            break;

        case RimPresetCategory::Gt3EnduranceTen:
            P.DiameterInch = 18.0f; P.WidthInch = 11.0f; P.OffsetMillimetre = 26.0f;
            P.SpokeContour = SpokeContourCategory::Fan; P.SpokeCount = 10u;
            P.SpokeRootWidthMillimetre = 58.0f; P.SpokeTipWidthMillimetre = 44.0f; P.SpokeSweepDegrees = 6.0f;
            P.LugCount = 0u; P.CentreLock = true; P.CentreLockFlatsMillimetre = 52.0f; P.GenerateCentreCap = false;
            P.CentreBoreMillimetre = 68.0f; P.DishMillimetre = 20.0f; P.SpokeThicknessMillimetre = 11.0f;
            P.FilletMillimetre = 9.0f; P.WellOffsetFraction = 0.66f;
            P.FaceFinish = RimFinishCategory::SatinGraphite; P.LipFinish = RimFinishCategory::SatinGraphite;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::Gt3TurbineCover:
            P.DiameterInch = 18.0f; P.WidthInch = 10.5f; P.OffsetMillimetre = 22.0f;
            P.SpokeContour = SpokeContourCategory::Turbine; P.SpokeCount = 11u;
            P.SpokeRootWidthMillimetre = 58.0f; P.SpokeTipWidthMillimetre = 66.0f; P.SpokeSweepDegrees = 34.0f;
            P.LugCount = 0u; P.CentreLock = true; P.GenerateCentreCap = false; P.CentreBoreMillimetre = 68.0f;
            P.DishMillimetre = 10.0f; P.ConcavityPower = 1.15f; P.CrownMillimetre = 3.0f;
            P.SpokeThicknessMillimetre = 9.0f; P.FilletMillimetre = 12.0f; P.WellOffsetFraction = 0.66f;
            P.FaceFinish = RimFinishCategory::MatteBlack; P.LipFinish = RimFinishCategory::SatinGraphite;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::Gt3SplitBlade:
            P.DiameterInch = 19.0f; P.WidthInch = 12.0f; P.OffsetMillimetre = 18.0f;
            P.SpokeContour = SpokeContourCategory::Split; P.SpokeCount = 6u;
            P.SpokeRootWidthMillimetre = 82.0f; P.SpokeTipWidthMillimetre = 62.0f; P.SpokeSplitDegrees = 11.0f;
            P.LugCount = 0u; P.CentreLock = true; P.CentreLockFlatsMillimetre = 58.0f; P.GenerateCentreCap = false;
            P.CentreBoreMillimetre = 68.0f; P.DishMillimetre = 22.0f; P.ConcavityPower = 1.7f;
            P.SpokeThicknessMillimetre = 12.0f; P.FilletMillimetre = 10.0f; P.WellOffsetFraction = 0.66f;
            P.FaceFinish = RimFinishCategory::RaceWhite; P.LipFinish = RimFinishCategory::RaceWhite;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        //  ── GT / sport ──────────────────────────────────────────────────────────────────────────────────────────
        case RimPresetCategory::GtTwinFiveSplit:
            P.DiameterInch = 19.0f; P.WidthInch = 9.5f; P.OffsetMillimetre = 38.0f;
            P.SpokeContour = SpokeContourCategory::Split; P.SpokeCount = 5u;
            P.SpokeRootWidthMillimetre = 76.0f; P.SpokeTipWidthMillimetre = 52.0f; P.SpokeSplitDegrees = 12.0f;
            P.SpokeSweepDegrees = 6.0f; P.DishMillimetre = 24.0f; P.ConcavityPower = 1.9f;
            P.FilletMillimetre = 10.0f; P.CrownMillimetre = 3.2f;
            P.FaceFinish = RimFinishCategory::MachinedFace; P.LipFinish = RimFinishCategory::MachinedFace;
            P.PocketFinish = RimFinishCategory::GunmetalPaint;
            break;

        case RimPresetCategory::GtDirectional:
            P.DiameterInch = 20.0f; P.WidthInch = 10.0f; P.OffsetMillimetre = 30.0f;
            P.SpokeContour = SpokeContourCategory::Twisted; P.SpokeCount = 9u;
            P.SpokeRootWidthMillimetre = 58.0f; P.SpokeTipWidthMillimetre = 40.0f;
            P.SpokeSweepDegrees = 26.0f; P.SpokeTwistDegrees = 14.0f;
            P.DishMillimetre = 28.0f; P.ConcavityPower = 2.0f; P.CrownMillimetre = 3.6f; P.FilletMillimetre = 9.0f;
            P.FaceFinish = RimFinishCategory::GunmetalPaint; P.LipFinish = RimFinishCategory::MachinedFace;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::GtMeshNineteen:
            P.DiameterInch = 19.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = 35.0f;
            P.SpokeContour = SpokeContourCategory::Weave; P.SpokeCount = 9u;
            P.SpokeRootWidthMillimetre = 44.0f; P.SpokeTipWidthMillimetre = 32.0f; P.SpokeSweepDegrees = 23.0f;
            P.HubRadiusFraction = 0.27f; P.DishMillimetre = 18.0f; P.SpokeThicknessMillimetre = 11.0f;
            P.FilletMillimetre = 7.0f;
            P.FaceFinish = RimFinishCategory::GlossPaint; P.LipFinish = RimFinishCategory::GlossPaint;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        case RimPresetCategory::GtHoneycomb:
            P.DiameterInch = 20.0f; P.WidthInch = 10.0f; P.OffsetMillimetre = 32.0f;
            P.SpokeContour = SpokeContourCategory::Honeycomb; P.SpokeCount = 9u;
            P.SpokeRootWidthMillimetre = 46.0f; P.SpokeTipWidthMillimetre = 42.0f;
            P.RingRadiusFraction = 0.52f; P.RingWidthMillimetre = 18.0f;
            P.HubRadiusFraction = 0.26f; P.DishMillimetre = 22.0f; P.SpokeThicknessMillimetre = 11.0f;
            P.FilletMillimetre = 8.0f; P.BevelMillimetre = 2.2f;
            P.FaceFinish = RimFinishCategory::BronzeAnodised; P.LipFinish = RimFinishCategory::BronzeAnodised;
            P.PocketFinish = RimFinishCategory::MatteBlack;
            break;

        //  ── luxury ──────────────────────────────────────────────────────────────────────────────────────────────
        case RimPresetCategory::LuxuryFanTwenty:
            P.DiameterInch = 22.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = 40.0f;
            P.SpokeContour = SpokeContourCategory::Fan; P.SpokeCount = 20u;
            P.SpokeRootWidthMillimetre = 42.0f; P.SpokeTipWidthMillimetre = 30.0f; P.SpokeSweepDegrees = 9.0f;
            P.HubRadiusFraction = 0.24f; P.DishMillimetre = 16.0f; P.SpokeThicknessMillimetre = 9.0f;
            P.FilletMillimetre = 6.0f; P.BevelMillimetre = 1.8f; P.AngularSegments = 640u;
            P.FaceFinish = RimFinishCategory::PolishedAlloy; P.LipFinish = RimFinishCategory::PolishedAlloy;
            P.PocketFinish = RimFinishCategory::SatinGraphite;
            break;

        case RimPresetCategory::LuxuryFineMesh:
            P.DiameterInch = 21.0f; P.WidthInch = 9.0f; P.OffsetMillimetre = 38.0f;
            P.SpokeContour = SpokeContourCategory::Weave; P.SpokeCount = 14u;
            P.SpokeRootWidthMillimetre = 32.0f; P.SpokeTipWidthMillimetre = 24.0f; P.SpokeSweepDegrees = 26.0f;
            P.HubRadiusFraction = 0.23f; P.DishMillimetre = 14.0f; P.SpokeThicknessMillimetre = 9.0f;
            P.FilletMillimetre = 5.5f; P.AngularSegments = 704u;
            P.FaceFinish = RimFinishCategory::Chrome; P.LipFinish = RimFinishCategory::Chrome;
            P.PocketFinish = RimFinishCategory::SatinGraphite; P.CapFinish = RimFinishCategory::Chrome;
            break;

        case RimPresetCategory::LuxuryDishCruiser:
            P.DiameterInch = 22.0f; P.WidthInch = 9.5f; P.OffsetMillimetre = 25.0f;
            P.SpokeContour = SpokeContourCategory::Dished; P.SpokeCount = 10u;
            P.SpokeRootWidthMillimetre = 40.0f; P.SpokeTipWidthMillimetre = 58.0f;
            P.DishMillimetre = 38.0f; P.ConcavityPower = 2.2f; P.OuterBandFraction = 0.05f;
            P.SpokeThicknessMillimetre = 11.0f; P.FilletMillimetre = 8.0f;
            P.FaceFinish = RimFinishCategory::GlossPaint; P.LipFinish = RimFinishCategory::PolishedAlloy;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.CapFinish = RimFinishCategory::GoldAnodised;
            break;

        case RimPresetCategory::LuxuryConcaveTen:
            P.DiameterInch = 20.0f; P.WidthInch = 8.5f; P.OffsetMillimetre = 42.0f;
            P.SpokeContour = SpokeContourCategory::Straight; P.SpokeCount = 10u;
            P.SpokeRootWidthMillimetre = 50.0f; P.SpokeTipWidthMillimetre = 30.0f; P.SpokeTaperPower = 1.7f;
            P.DishMillimetre = 30.0f; P.ConcavityPower = 2.3f; P.CrownMillimetre = 3.0f; P.FilletMillimetre = 8.0f;
            P.FaceFinish = RimFinishCategory::MachinedFace; P.LipFinish = RimFinishCategory::MachinedFace;
            P.PocketFinish = RimFinishCategory::GunmetalPaint;
            break;

        //  ── show ────────────────────────────────────────────────────────────────────────────────────────────────
        case RimPresetCategory::ShowDeepChrome:
            P.DiameterInch = 20.0f; P.WidthInch = 12.0f; P.OffsetMillimetre = -20.0f;
            P.SpokeContour = SpokeContourCategory::Dished; P.SpokeCount = 6u;
            P.SpokeRootWidthMillimetre = 52.0f; P.SpokeTipWidthMillimetre = 76.0f;
            P.DishMillimetre = 58.0f; P.ConcavityPower = 2.6f; P.OuterBandFraction = 0.035f;
            P.WellOffsetFraction = 0.72f; P.FilletMillimetre = 9.0f;
            P.GenerateLipBolts = true; P.LipBoltCount = 30u; P.LipBoltDiameterMillimetre = 8.0f;
            P.FaceFinish = RimFinishCategory::Chrome; P.LipFinish = RimFinishCategory::Chrome;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.HardwareFinish = RimFinishCategory::GoldAnodised;
            break;

        case RimPresetCategory::ShowCandyWeave:
            P.DiameterInch = 22.0f; P.WidthInch = 10.0f; P.OffsetMillimetre = 28.0f;
            P.SpokeContour = SpokeContourCategory::Weave; P.SpokeCount = 11u;
            P.SpokeRootWidthMillimetre = 40.0f; P.SpokeTipWidthMillimetre = 30.0f; P.SpokeSweepDegrees = 28.0f;
            P.HubRadiusFraction = 0.24f; P.DishMillimetre = 24.0f; P.FilletMillimetre = 6.5f;
            P.AngularSegments = 640u;
            P.FaceFinish = RimFinishCategory::CandyRed; P.LipFinish = RimFinishCategory::Chrome;
            P.PocketFinish = RimFinishCategory::GunmetalPaint; P.CapFinish = RimFinishCategory::CandyRed;
            break;

        case RimPresetCategory::ShowGoldPinwheel:
            P.DiameterInch = 21.0f; P.WidthInch = 10.5f; P.OffsetMillimetre = 25.0f;
            P.SpokeContour = SpokeContourCategory::Turbine; P.SpokeCount = 13u;
            P.SpokeRootWidthMillimetre = 48.0f; P.SpokeTipWidthMillimetre = 52.0f; P.SpokeSweepDegrees = 40.0f;
            P.SpokeTwistDegrees = 10.0f; P.DishMillimetre = 20.0f; P.CrownMillimetre = 3.4f; P.FilletMillimetre = 7.0f;
            P.AngularSegments = 640u;
            P.FaceFinish = RimFinishCategory::GoldAnodised; P.LipFinish = RimFinishCategory::PolishedAlloy;
            P.PocketFinish = RimFinishCategory::MatteBlack; P.CapFinish = RimFinishCategory::GoldAnodised;
            break;

        case RimPresetCategory::HeavyDutySixSpoke:
            P.DiameterInch = 17.0f; P.WidthInch = 8.0f; P.OffsetMillimetre = 0.0f;
            P.SpokeContour = SpokeContourCategory::Straight; P.SpokeCount = 6u;
            P.SpokeRootWidthMillimetre = 74.0f; P.SpokeTipWidthMillimetre = 52.0f; P.SpokeTaperPower = 1.1f;
            P.LugCount = 6u; P.LugCircleMillimetre = 139.7f; P.LugHoleMillimetre = 16.0f;
            P.CentreBoreMillimetre = 106.1f; P.PadThicknessMillimetre = 22.0f; P.SpokeThicknessMillimetre = 17.0f;
            P.DishMillimetre = 10.0f; P.ConcavityPower = 1.2f; P.BarrelWallMillimetre = 7.0f;
            P.FaceFinish = RimFinishCategory::MatteBlack; P.LipFinish = RimFinishCategory::MatteBlack;
            P.LugNutFlatsMillimetre = 22.0f; P.LugNutHeightMillimetre = 28.0f;
            break;
    }
    return P;
}

std::string WheelRimParameters::Normalise() noexcept
{
    std::string Note;
    const auto Pin = [&Note](float& Target, float Low, float High, const char* Name)
    {
        const float Before = Target;
        Target = Clamp(Target, Low, High);
        if (Target != Before) { Note += Name; Note += " pinned; "; }
    };
    Pin(DiameterInch, 10.0f, 34.0f, "DiameterInch");
    Pin(WidthInch, 4.0f, 20.0f, "WidthInch");
    Pin(OffsetMillimetre, -120.0f, 120.0f, "OffsetMillimetre");
    Pin(FlangeHeightMillimetre, 8.0f, 30.0f, "FlangeHeightMillimetre");
    Pin(FlangeThicknessMillimetre, 2.0f, 16.0f, "FlangeThicknessMillimetre");
    Pin(BarrelWallMillimetre, 2.0f, 18.0f, "BarrelWallMillimetre");
    Pin(WellDepthMillimetre, 6.0f, 60.0f, "WellDepthMillimetre");
    Pin(HubRadiusFraction, 0.12f, 0.80f, "HubRadiusFraction");
    Pin(OuterBandFraction, 0.01f, 0.40f, "OuterBandFraction");
    Pin(PadThicknessMillimetre, 6.0f, 60.0f, "PadThicknessMillimetre");
    Pin(SpokeThicknessMillimetre, 4.0f, 50.0f, "SpokeThicknessMillimetre");
    Pin(LipThicknessMillimetre, 3.0f, 40.0f, "LipThicknessMillimetre");
    Pin(DishMillimetre, -40.0f, 140.0f, "DishMillimetre");
    Pin(ConcavityPower, 0.35f, 5.0f, "ConcavityPower");
    Pin(CrownMillimetre, 0.0f, 30.0f, "CrownMillimetre");
    Pin(BackReliefMillimetre, 0.0f, 30.0f, "BackReliefMillimetre");
    Pin(FilletMillimetre, 0.5f, 40.0f, "FilletMillimetre");
    Pin(BevelMillimetre, 0.0f, 12.0f, "BevelMillimetre");
    Pin(SpokeRootWidthMillimetre, 6.0f, 400.0f, "SpokeRootWidthMillimetre");
    Pin(SpokeTipWidthMillimetre, 6.0f, 400.0f, "SpokeTipWidthMillimetre");
    Pin(CentreBoreMillimetre, 20.0f, 300.0f, "CentreBoreMillimetre");
    Pin(LugCircleMillimetre, 50.0f, 400.0f, "LugCircleMillimetre");
    Pin(LugHoleMillimetre, 6.0f, 40.0f, "LugHoleMillimetre");
    Pin(LugSeatDepthMillimetre, 0.0f, 20.0f, "LugSeatDepthMillimetre");
    Pin(LugNutFlatsMillimetre, 8.0f, 50.0f, "LugNutFlatsMillimetre");
    Pin(LugNutHeightMillimetre, 6.0f, 70.0f, "LugNutHeightMillimetre");
    Pin(CentreCapRadiusFraction, 0.1f, 1.0f, "CentreCapRadiusFraction");
    Pin(CreaseDegrees, 5.0f, 150.0f, "CreaseDegrees");

    SpokeCount        = std::max(2u, std::min(60u, SpokeCount));
    LugCount          = std::min(12u, LugCount);
    AngularSegments   = std::max(64u, std::min(4096u, AngularSegments));
    RadialSegments    = std::max(16u, std::min(1024u, RadialSegments));
    HardwareSegments  = std::max(8u,  std::min(256u,  HardwareSegments));
    BevelBands        = std::max(1u,  std::min(16u,   BevelBands));
    SectionSamples    = std::max(24u, std::min(2048u, SectionSamples));
    LipBoltCount      = std::min(96u, LipBoltCount);
    Pin(RingRadiusFraction, 0.15f, 0.92f, "RingRadiusFraction");
    Pin(RingWidthMillimetre, 3.0f, 80.0f, "RingWidthMillimetre");
    Pin(LipBoltDiameterMillimetre, 3.0f, 26.0f, "LipBoltDiameterMillimetre");
    Pin(LipBoltProudMillimetre, 0.5f, 14.0f, "LipBoltProudMillimetre");
    Pin(CentreLockFlatsMillimetre, 20.0f, 110.0f, "CentreLockFlatsMillimetre");
    if (CentreLock) LugCount = 0u;

    // The bolt circle must leave material between the bore and the lug holes.
    const float Clearance = 0.5f * CentreBoreMillimetre + 0.5f * LugHoleMillimetre + 6.0f;
    if (LugCount > 0u && LugCircleMillimetre < 2.0f * Clearance)
    {
        LugCircleMillimetre = 2.0f * Clearance;
        Note += "LugCircleMillimetre opened for bore clearance; ";
    }
    if (SpokeTipWidthMillimetre > 0.98f * (kTau * 0.5f * DiameterInch * 25.4f) / static_cast<float>(SpokeCount))
    {
        SpokeTipWidthMillimetre = 0.98f * (kTau * 0.5f * DiameterInch * 25.4f) / static_cast<float>(SpokeCount);
        Note += "SpokeTipWidthMillimetre capped to the sector pitch; ";
    }
    return Note;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FINISH RECIPES
//------------------------------------------------------------------------------------------------------------------------

RimFinishRecipe QueryFinishRecipe(RimFinishCategory Finish) noexcept
{
    RimFinishRecipe R;
    switch (Finish)
    {
        case RimFinishCategory::GlossPaint:
            R.Name = "rim_gloss_paint";
            R.BaseColor[0] = 0.055f; R.BaseColor[1] = 0.057f; R.BaseColor[2] = 0.062f;
            R.Metalness = 0.0f; R.SpecularRoughness = 0.28f; R.CoatWeight = 1.0f; R.CoatRoughness = 0.045f;
            R.HazinessWeight = 0.25f; R.HazinessRoughness = 0.42f;   // orange peel
            break;
        case RimFinishCategory::SatinGraphite:
            R.Name = "rim_satin_graphite";
            R.BaseColor[0] = 0.085f; R.BaseColor[1] = 0.088f; R.BaseColor[2] = 0.095f;
            R.Metalness = 0.55f; R.SpecularRoughness = 0.42f; R.CoatWeight = 0.35f; R.CoatRoughness = 0.22f;
            break;
        case RimFinishCategory::PolishedAlloy:
            R.Name = "rim_polished_alloy";
            R.BaseColor[0] = 0.913f; R.BaseColor[1] = 0.922f; R.BaseColor[2] = 0.924f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.055f;
            break;
        case RimFinishCategory::BrushedAlloy:
            R.Name = "rim_brushed_alloy";
            R.BaseColor[0] = 0.880f; R.BaseColor[1] = 0.890f; R.BaseColor[2] = 0.895f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.26f; R.SpecularAnisotropy = 0.72f;
            break;
        case RimFinishCategory::MachinedFace:
            R.Name = "rim_machined_face";
            R.BaseColor[0] = 0.900f; R.BaseColor[1] = 0.906f; R.BaseColor[2] = 0.905f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.17f; R.SpecularAnisotropy = 0.55f;
            R.CoatWeight = 1.0f; R.CoatRoughness = 0.06f;   // diamond-cut faces are lacquered
            break;
        case RimFinishCategory::Chrome:
            R.Name = "rim_chrome";
            R.BaseColor[0] = 0.550f; R.BaseColor[1] = 0.556f; R.BaseColor[2] = 0.554f;
            R.SpecularColor[0] = 0.98f; R.SpecularColor[1] = 0.98f; R.SpecularColor[2] = 1.0f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.025f;
            break;
        case RimFinishCategory::BronzeAnodised:
            R.Name = "rim_bronze_anodised";
            R.BaseColor[0] = 0.452f; R.BaseColor[1] = 0.272f; R.BaseColor[2] = 0.118f;
            R.SpecularColor[0] = 1.0f; R.SpecularColor[1] = 0.86f; R.SpecularColor[2] = 0.62f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.22f; R.CoatWeight = 0.6f; R.CoatRoughness = 0.1f;
            break;
        case RimFinishCategory::MatteBlack:
            R.Name = "rim_matte_black";
            R.BaseColor[0] = 0.028f; R.BaseColor[1] = 0.029f; R.BaseColor[2] = 0.031f;
            R.Metalness = 0.0f; R.SpecularRoughness = 0.62f; R.DiffuseRoughness = 0.6f;
            break;
        case RimFinishCategory::GoldAnodised:
            R.Name = "rim_gold_anodised";
            R.BaseColor[0] = 0.760f; R.BaseColor[1] = 0.560f; R.BaseColor[2] = 0.180f;
            R.SpecularColor[0] = 1.0f; R.SpecularColor[1] = 0.94f; R.SpecularColor[2] = 0.74f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.18f; R.CoatWeight = 0.5f;
            break;
        case RimFinishCategory::GunmetalPaint:
            R.Name = "rim_gunmetal_paint";
            R.BaseColor[0] = 0.105f; R.BaseColor[1] = 0.118f; R.BaseColor[2] = 0.132f;
            R.Metalness = 0.20f; R.SpecularRoughness = 0.35f; R.CoatWeight = 1.0f; R.CoatRoughness = 0.06f;
            R.HazinessWeight = 0.18f;
            break;
        case RimFinishCategory::CandyRed:
            R.Name = "rim_candy_red";
            R.BaseColor[0] = 0.330f; R.BaseColor[1] = 0.020f; R.BaseColor[2] = 0.028f;
            R.SpecularColor[0] = 1.0f; R.SpecularColor[1] = 0.70f; R.SpecularColor[2] = 0.70f;
            R.Metalness = 0.35f; R.SpecularRoughness = 0.18f; R.CoatWeight = 1.0f; R.CoatRoughness = 0.03f;
            break;
        case RimFinishCategory::RaceWhite:
            R.Name = "rim_race_white";
            R.BaseColor[0] = 0.780f; R.BaseColor[1] = 0.782f; R.BaseColor[2] = 0.775f;
            R.Metalness = 0.0f; R.SpecularRoughness = 0.30f; R.CoatWeight = 0.8f; R.CoatRoughness = 0.08f;
            R.DiffuseRoughness = 0.3f;
            break;
        case RimFinishCategory::SteelHardware:
            R.Name = "rim_hardware_steel";
            R.BaseColor[0] = 0.560f; R.BaseColor[1] = 0.570f; R.BaseColor[2] = 0.580f;
            R.SpecularColor[0] = 0.62f; R.SpecularColor[1] = 0.62f; R.SpecularColor[2] = 0.64f;
            R.Metalness = 1.0f; R.SpecularRoughness = 0.30f;
            break;
    }
    return R;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CROSS-SECTION
//------------------------------------------------------------------------------------------------------------------------

std::vector<SectionKnot> WheelRimSpecification::ResolveSection(const WheelRimParameters& Parameters) noexcept
{
    WheelRimParameters P = Parameters; (void)P.Normalise();
    const RimDimensions D = ResolveDimensions(P);

    std::vector<SectionKnot> Knots;
    if (!P.SectionKnots.empty())
    {
        Knots = P.SectionKnots;
    }
    else
    {
        const float Rb = D.BeadRadius, Ri = D.InnerRadius, Rf = D.FlangeRadius, Rw = D.WellRadius;
        const float Wall = Rb - Ri;
        const float Rwi = std::max(0.35f * Ri, Rw - Wall);                 // well, wheel-side surface
        const float Zo = D.HalfWidth, Zi = -D.HalfWidth, Tf = D.FlangeThickness;
        const float Taper = D.SeatWidth * std::tan(Radians(Clamp(P.BeadSeatTaperDegrees, 0.0f, 12.0f)));
        const float WellOut = D.WellCentre + D.WellHalfWidth, WellIn = D.WellCentre - D.WellHalfWidth;
        const auto Knot = [&Knots](float R, float Z, float Round, uint8_t Finish)
        { SectionKnot K; K.Radius = R; K.Axial = Z; K.Rounding = Round; K.Finish = Finish; Knots.push_back(K); };

        // Outboard weld ⇒ up the visible inner lip ⇒ over the outboard flange ⇒ down the tyre side (bead seats and
        //    drop well) ⇒ over the inboard flange ⇒ back along the wheel-side wall ⇒ inboard weld. One open polyline;
        //    the face plate closes it. Material thickness is real: the return leg is the outer leg offset by Wall.
        Knot(Ri,          D.LipFront,      0.0f,          1u);   // ── weld ring, outboard
        Knot(Ri,          Zo + Tf,         1.5f * kMilli, 1u);
        Knot(Rf,          Zo + Tf,         2.0f * kMilli, 1u);   // outboard flange, outer face
        Knot(Rf,          Zo,              2.5f * kMilli, 1u);   // flange tip
        Knot(Rb,          Zo,              3.5f * kMilli, 2u);   // flange root ⇒ bead seat
        Knot(Rb - Taper,  Zo - D.SeatWidth,2.0f * kMilli, 2u);   // 5° bead seat
        Knot(Rw,          WellOut,         6.0f * kMilli, 2u);   // drop well, tyre side
        Knot(Rw,          WellIn,          6.0f * kMilli, 2u);
        Knot(Rb - Taper,  Zi + D.SeatWidth,2.0f * kMilli, 2u);
        Knot(Rb,          Zi,              3.5f * kMilli, 2u);
        Knot(Rf,          Zi,              2.5f * kMilli, 1u);   // inboard flange tip
        Knot(Rf,          Zi - Tf,         2.0f * kMilli, 1u);
        Knot(Ri,          Zi - Tf,         1.5f * kMilli, 0u);   // ── wheel-side wall begins
        Knot(Ri,          Zi + D.SeatWidth,3.0f * kMilli, 0u);
        Knot(Rwi,         WellIn,          5.0f * kMilli, 0u);   // drop well, wheel side
        Knot(Rwi,         WellOut,         5.0f * kMilli, 0u);
        Knot(Ri,          std::min(D.LipBack - 2.0f * kMilli, WellOut + 3.0f * kMilli), 3.0f * kMilli, 0u);
        Knot(Ri,          D.LipBack,       0.0f,          0u);   // ── weld ring, inboard
    }
    if (Knots.size() < 2u) return Knots;

    // Optional relaxation of the authored corners toward their neighbours (endpoints pinned).
    if (P.SectionSmoothing > 0.0f)
        for (uint32_t Sweep = 0u; Sweep < 2u; ++Sweep)
        {
            std::vector<SectionKnot> Relaxed = Knots;
            for (size_t I = 1u; I + 1u < Knots.size(); ++I)
            {
                const float W = 0.5f * Clamp(P.SectionSmoothing, 0.0f, 1.0f);
                Relaxed[I].Radius = Mix(Knots[I].Radius, 0.5f * (Knots[I - 1u].Radius + Knots[I + 1u].Radius), W);
                Relaxed[I].Axial  = Mix(Knots[I].Axial,  0.5f * (Knots[I - 1u].Axial  + Knots[I + 1u].Axial ), W);
            }
            Knots.swap(Relaxed);
        }

    // Corner rounding: replace each interior knot by a circular arc tangent to both legs.
    std::vector<SectionKnot> Rounded;
    Rounded.push_back(Knots.front());
    for (size_t I = 1u; I + 1u < Knots.size(); ++I)
    {
        const SectionKnot& Previous = Knots[I - 1u];
        const SectionKnot& Corner   = Knots[I];
        const SectionKnot& Next     = Knots[I + 1u];
        float Ax = Previous.Radius - Corner.Radius, Az = Previous.Axial - Corner.Axial;
        float Bx = Next.Radius     - Corner.Radius, Bz = Next.Axial     - Corner.Axial;
        const float La = std::sqrt(Ax * Ax + Az * Az), Lb = std::sqrt(Bx * Bx + Bz * Bz);
        if (Corner.Rounding <= 0.0f || La < 1.0e-6f || Lb < 1.0e-6f) { Rounded.push_back(Corner); continue; }
        Ax /= La; Az /= La; Bx /= Lb; Bz /= Lb;
        const float Cosine = Clamp(Ax * Bx + Az * Bz, -0.9999f, 0.9999f);
        const float Angle  = std::acos(Cosine);
        if (Angle > kPi - 0.02f) { Rounded.push_back(Corner); continue; }   // already straight
        const float Reach  = std::min({ Corner.Rounding / std::tan(0.5f * Angle), 0.45f * La, 0.45f * Lb });
        const uint32_t Arc = std::max(2u, static_cast<uint32_t>((kPi - Angle) / 0.22f) + 1u);
        const float Sx = Corner.Radius + Ax * Reach, Sz = Corner.Axial + Az * Reach;
        const float Ex = Corner.Radius + Bx * Reach, Ez = Corner.Axial + Bz * Reach;
        for (uint32_t Step = 0u; Step <= Arc; ++Step)
        {
            // Quadratic Bézier through the corner approximates the fillet closely enough at these radii.
            const float T = static_cast<float>(Step) / static_cast<float>(Arc), U = 1.0f - T;
            SectionKnot K;
            K.Radius = U * U * Sx + 2.0f * U * T * Corner.Radius + T * T * Ex;
            K.Axial  = U * U * Sz + 2.0f * U * T * Corner.Axial  + T * T * Ez;
            K.Finish = T < 0.5f ? Previous.Finish : Next.Finish;
            if (Corner.Finish != Previous.Finish && Corner.Finish != Next.Finish) K.Finish = Corner.Finish;
            else K.Finish = Corner.Finish;
            Rounded.push_back(K);
        }
    }
    Rounded.push_back(Knots.back());

    // Uniform arc-length resample.
    std::vector<float> Lengths(Rounded.size(), 0.0f);
    for (size_t I = 1u; I < Rounded.size(); ++I)
    {
        const float Dr = Rounded[I].Radius - Rounded[I - 1u].Radius, Dz = Rounded[I].Axial - Rounded[I - 1u].Axial;
        Lengths[I] = Lengths[I - 1u] + std::sqrt(Dr * Dr + Dz * Dz);
    }
    const float Total = Lengths.back();
    if (Total <= 0.0f) return Rounded;

    const uint32_t Samples = std::max(8u, P.SectionSamples);
    std::vector<SectionKnot> Sampled;
    Sampled.reserve(Samples + 1u);
    size_t Cursor = 1u;
    for (uint32_t Step = 0u; Step <= Samples; ++Step)
    {
        const float Target = Total * static_cast<float>(Step) / static_cast<float>(Samples);
        while (Cursor + 1u < Rounded.size() && Lengths[Cursor] < Target) ++Cursor;
        const float Span = std::max(1.0e-9f, Lengths[Cursor] - Lengths[Cursor - 1u]);
        const float T    = Saturate((Target - Lengths[Cursor - 1u]) / Span);
        SectionKnot K;
        K.Radius = Mix(Rounded[Cursor - 1u].Radius, Rounded[Cursor].Radius, T);
        K.Axial  = Mix(Rounded[Cursor - 1u].Axial,  Rounded[Cursor].Axial,  T);
        K.Finish = T < 0.5f ? Rounded[Cursor - 1u].Finish : Rounded[Cursor].Finish;
        Sampled.push_back(K);
    }
    Sampled.front() = Rounded.front(); Sampled.front().Rounding = 0.0f;
    Sampled.back()  = Rounded.back();  Sampled.back().Rounding  = 0.0f;
    return Sampled;
}

float WheelRimSpecification::SampleFaceContour(const WheelRimParameters& Parameters, float Radius, float Angle) noexcept
{
    WheelRimParameters P = Parameters; (void)P.Normalise();
    const RimDimensions D = ResolveDimensions(P);
    return ResolveFaceContour(P, D).Sample(Radius, Angle);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SYNTHESIS
//------------------------------------------------------------------------------------------------------------------------

RimSurface WheelRimSpecification::Synthesise(const WheelRimParameters& Parameters) noexcept
{
    WheelRimParameters P = Parameters; (void)P.Normalise();
    const RimDimensions D = ResolveDimensions(P);
    const FaceContour   Contour = ResolveFaceContour(P, D);

    HeightSurfaces Height;
    Height.D               = D;
    Height.Contour         = &Contour;
    Height.Concavity       = P.ConcavityPower;
    Height.Crown           = P.CrownMillimetre * kMilli;
    Height.CrownFalloff    = std::max(2.0f * kMilli, 0.30f * P.SpokeRootWidthMillimetre * kMilli);
    Height.PadThickness    = P.PadThicknessMillimetre * kMilli;
    Height.SpokeThickness  = P.SpokeThicknessMillimetre * kMilli;
    Height.LipThickness    = std::max(3.0f * kMilli, P.LipThicknessMillimetre * kMilli);
    Height.Relief          = P.BackReliefMillimetre * kMilli;
    Height.ReliefFalloff   = std::max(3.0f * kMilli, 0.35f * P.SpokeRootWidthMillimetre * kMilli);
    Height.TwistLift       = std::tan(Radians(Clamp(P.SpokeTwistDegrees, -45.0f, 45.0f))) * 0.5f * P.SpokeRootWidthMillimetre * kMilli;
    Height.Bars            = std::max(2u, P.SpokeCount);
    Height.Phase           = Radians(P.SpokePhaseDegrees);
    Height.Lugs            = P.LugCount;
    Height.LugPhase        = Radians(P.LugPhaseDegrees);
    Height.Seat            = P.LugSeat;

    RimSurface Surface;
    SurfaceWriter Writer; Writer.Out = &Surface;

    const uint32_t Angular = P.AngularSegments;
    const uint32_t Radial  = P.RadialSegments;
    const float    Start   = std::max(0.35f * D.BoreRadius, 0.04f * D.InnerRadius);
    const float    Finish  = D.InnerRadius;

    Surface.Positions.reserve(static_cast<size_t>(Angular) * (Radial + 24u) * 6u);
    Surface.Corners.reserve(static_cast<size_t>(Angular) * (Radial + 24u) * 12u);

    const auto RingRadius = [&](uint32_t J) noexcept
    {
        const float T = static_cast<float>(J) / static_cast<float>(Radial);
        return Mix(Start, Finish, T);
    };
    const auto RingAngle = [&](uint32_t I) noexcept { return kTau * static_cast<float>(I % Angular) / static_cast<float>(Angular); };

    //  ── ② contour sampling on the lattice ────────────────────────────────────────────────────────────────────────
    std::vector<float> VertexPhi(static_cast<size_t>(Angular) * (Radial + 1u), 0.0f);
    std::vector<float> VertexRadius(VertexPhi.size(), 0.0f), VertexAngle(VertexPhi.size(), 0.0f);
    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J <= Radial; ++J)
        {
            const size_t Slot = static_cast<size_t>(I) * (Radial + 1u) + J;
            VertexRadius[Slot] = RingRadius(J);
            VertexAngle[Slot]  = RingAngle(I);
            VertexPhi[Slot]    = Contour.Sample(VertexRadius[Slot], VertexAngle[Slot]);
        }

    std::vector<uint8_t> Kept(static_cast<size_t>(Angular) * Radial, 0u);
    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J < Radial; ++J)
        {
            const float R = 0.5f * (RingRadius(J) + RingRadius(J + 1u));
            const float A = RingAngle(I) + 0.5f * kTau / static_cast<float>(Angular);
            const bool  Outer = J + 2u >= Radial;                       // the weld band is always solid
            Kept[static_cast<size_t>(I) * Radial + J] = (Outer || Contour.Sample(R, A) > 0.0f) ? 1u : 0u;
        }

    //  ── cleanup: drop spurs, then split pinch vertices, so every vertex star is a single fan ─────────────────────
    const auto CellKept = [&](uint32_t I, uint32_t J) noexcept -> bool
    { return J < Radial && Kept[static_cast<size_t>(I % Angular) * Radial + J] != 0u; };
    for (uint32_t Sweep = 0u; Sweep < 8u; ++Sweep)
    {
        uint32_t Removed = 0u;
        for (uint32_t I = 0u; I < Angular; ++I)
            for (uint32_t J = 0u; J + 2u < Radial; ++J)
            {
                if (!CellKept(I, J)) continue;
                const uint32_t Neighbours = static_cast<uint32_t>(CellKept(I + 1u, J)) + static_cast<uint32_t>(CellKept(I + Angular - 1u, J))
                                          + static_cast<uint32_t>(J > 0u && CellKept(I, J - 1u)) + static_cast<uint32_t>(CellKept(I, J + 1u));
                if (Neighbours <= 1u) { Kept[static_cast<size_t>(I) * Radial + J] = 0u; ++Removed; }
            }
        // Pinch vertices: the four cells around a lattice vertex must form at most one contiguous run.
        for (uint32_t I = 0u; I < Angular; ++I)
            for (uint32_t J = 1u; J + 2u < Radial; ++J)
            {
                const uint32_t Im = (I + Angular - 1u) % Angular;
                const bool Quad[4] = { CellKept(I, J), CellKept(Im, J), CellKept(Im, J - 1u), CellKept(I, J - 1u) };
                uint32_t Runs = 0u;
                for (uint32_t K = 0u; K < 4u; ++K) if (Quad[K] && !Quad[(K + 3u) % 4u]) ++Runs;
                if (Runs < 2u) continue;
                const uint32_t Cells[4][2] = { { I, J }, { Im, J }, { Im, J - 1u }, { I, J - 1u } };
                uint32_t Victim = 0u; float Weakest = 1.0e9f;
                for (uint32_t K = 0u; K < 4u; ++K)
                {
                    if (!Quad[K]) continue;
                    const uint32_t Ci = Cells[K][0], Cj = Cells[K][1];
                    if (Cj + 2u >= Radial) continue;
                    const float Phi = Contour.Sample(0.5f * (RingRadius(Cj) + RingRadius(Cj + 1u)),
                                                     RingAngle(Ci) + 0.5f * kTau / static_cast<float>(Angular));
                    if (Phi < Weakest) { Weakest = Phi; Victim = K; }
                }
                if (Weakest < 1.0e9f) { Kept[static_cast<size_t>(Cells[Victim][0]) * Radial + Cells[Victim][1]] = 0u; ++Removed; }
            }
        if (Removed == 0u) break;
    }

    //  ── ③ vertex snapping onto ϕ = 0 and the two height sheets ───────────────────────────────────────────────────
    const auto VertexUsed = [&](uint32_t I, uint32_t J) noexcept -> bool
    {
        const uint32_t Im = (I + Angular - 1u) % Angular;
        return CellKept(I, J) || CellKept(Im, J) || (J > 0u && (CellKept(I, J - 1u) || CellKept(Im, J - 1u)));
    };
    const auto VertexOnEdge = [&](uint32_t I, uint32_t J) noexcept -> bool
    {
        const uint32_t Im = (I + Angular - 1u) % Angular;
        const uint32_t Count = static_cast<uint32_t>(CellKept(I, J)) + static_cast<uint32_t>(CellKept(Im, J))
                             + static_cast<uint32_t>(J > 0u && CellKept(I, J - 1u)) + static_cast<uint32_t>(J > 0u && CellKept(Im, J - 1u));
        return Count > 0u && Count < 4u;
    };

    const float CellRadial  = (Finish - Start) / static_cast<float>(Radial);
    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J <= Radial; ++J)
        {
            if (J + 2u >= Radial || J == 0u) continue;                  // never move the weld band or the inner edge
            if (!VertexUsed(I, J) || !VertexOnEdge(I, J)) continue;
            const size_t Slot = static_cast<size_t>(I) * (Radial + 1u) + J;
            float R = VertexRadius[Slot], A = VertexAngle[Slot];
            const float CellArc = kTau * R / static_cast<float>(Angular);
            const float Reach   = 0.90f * std::max(CellRadial, CellArc);
            for (uint32_t Step = 0u; Step < 5u; ++Step)
            {
                const float H  = 0.25f * std::min(CellRadial, CellArc);
                const float Phi = Contour.Sample(R, A);
                const float Gr = (Contour.Sample(R + H, A) - Contour.Sample(R - H, A)) / (2.0f * H);
                const float Ga = (Contour.Sample(R, A + H / R) - Contour.Sample(R, A - H / R)) / (2.0f * H);
                const float G2 = Gr * Gr + Ga * Ga;
                if (G2 < 1.0e-8f) break;
                float Dr = -Phi * Gr / G2, Da = -Phi * Ga / G2;
                const float Step2 = std::sqrt(Dr * Dr + Da * Da);
                if (Step2 > Reach) { Dr *= Reach / Step2; Da *= Reach / Step2; }
                R = Clamp(R + Dr, RingRadius(J) - 1.45f * CellRadial, RingRadius(J) + 1.45f * CellRadial);
                A += Da / std::max(R, 1.0e-3f);
            }
            VertexRadius[Slot] = R; VertexAngle[Slot] = A; VertexPhi[Slot] = Contour.Sample(R, A);
        }

    constexpr uint32_t kNoVertex = 0xFFFFFFFFu;
    std::vector<uint32_t> FrontSlot(VertexPhi.size(), kNoVertex), BackSlot(VertexPhi.size(), kNoVertex);
    std::vector<float>    VertexUv(VertexPhi.size() * 2u, 0.0f);
    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J <= Radial; ++J)
        {
            if (!VertexUsed(I, J)) continue;
            const size_t Slot = static_cast<size_t>(I) * (Radial + 1u) + J;
            const float R = VertexRadius[Slot], A = VertexAngle[Slot], Phi = std::max(0.0f, VertexPhi[Slot]);
            const float X = R * std::cos(A), Y = R * std::sin(A);
            FrontSlot[Slot] = Writer.AddVertex(X, Y, Height.Front(R, A, Phi));
            BackSlot[Slot]  = Writer.AddVertex(X, Y, std::min(Height.Back(R, A, Phi), Height.Front(R, A, Phi) - 1.5f * kMilli));
            VertexUv[Slot * 2u + 0u] = A / kTau;
            VertexUv[Slot * 2u + 1u] = R / D.InnerRadius;
        }

    //  ── front and back sheets ────────────────────────────────────────────────────────────────────────────────────
    const auto SlotOf = [&](uint32_t I, uint32_t J) noexcept { return static_cast<size_t>(I % Angular) * (Radial + 1u) + J; };
    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J < Radial; ++J)
        {
            if (!CellKept(I, J)) continue;
            const size_t S00 = SlotOf(I, J), S10 = SlotOf(I + 1u, J), S11 = SlotOf(I + 1u, J + 1u), S01 = SlotOf(I, J + 1u);
            const float* Uv00 = &VertexUv[S00 * 2u]; const float* Uv10 = &VertexUv[S10 * 2u];
            const float* Uv11 = &VertexUv[S11 * 2u]; const float* Uv01 = &VertexUv[S01 * 2u];
            float Wrapped10[2] = { Uv10[0] < Uv00[0] ? Uv10[0] + 1.0f : Uv10[0], Uv10[1] };
            float Wrapped11[2] = { Uv11[0] < Uv01[0] ? Uv11[0] + 1.0f : Uv11[0], Uv11[1] };
            Writer.AddQuad(FrontSlot[S00], FrontSlot[S10], FrontSlot[S11], FrontSlot[S01], RimSurfaceSlot::FaceFront,
                           Uv00, Wrapped10, Wrapped11, Uv01);
            Writer.AddQuad(BackSlot[S01], BackSlot[S11], BackSlot[S10], BackSlot[S00], RimSurfaceSlot::WindowWall,
                           Uv01, Wrapped11, Wrapped10, Uv00);
        }

    //  ── ④ window walls: a bevelled band stitching the two sheets along every ϕ = 0 contour ───────────────────────
    const uint32_t Bands  = std::max(1u, P.BevelBands);
    const float    Bevel  = P.BevelMillimetre * kMilli;
    std::vector<uint32_t> WallSlot(VertexPhi.size() * (Bands + 1u), kNoVertex);
    const auto WallVertex = [&](size_t Slot, uint32_t Band) noexcept -> uint32_t
    {
        if (Band == 0u)     return FrontSlot[Slot];
        if (Band == Bands)  return BackSlot[Slot];
        uint32_t& Cached = WallSlot[Slot * (Bands + 1u) + Band];
        if (Cached != kNoVertex) return Cached;
        const float R = VertexRadius[Slot], A = VertexAngle[Slot];
        const float Phi = std::max(0.0f, VertexPhi[Slot]);
        // Outward direction of the window edge in the face plane = −∇ϕ.
        const float H  = 0.15f * kMilli;
        const float Gr = (Contour.Sample(R + H, A) - Contour.Sample(R - H, A)) / (2.0f * H);
        const float Ga = (Contour.Sample(R, A + H / R) - Contour.Sample(R, A - H / R)) / (2.0f * H);
        const float Length = std::sqrt(Gr * Gr + Ga * Ga);
        const float Nr = Length > 1.0e-6f ? -Gr / Length : 0.0f, Na = Length > 1.0e-6f ? -Ga / Length : 0.0f;
        const float U  = static_cast<float>(Band) / static_cast<float>(Bands);
        const float Push = Bevel * std::sin(kPi * U);
        const float Rr = R + Nr * Push;
        const float Aa = A + (Na * Push) / std::max(Rr, 1.0e-3f);
        const float Zf = Height.Front(R, A, Phi);
        const float Zb = std::min(Height.Back(R, A, Phi), Zf - 1.5f * kMilli);
        const float Zz = Mix(Zf, Zb, U);
        Cached = Writer.AddVertex(Rr * std::cos(Aa), Rr * std::sin(Aa), Zz);
        return Cached;
    };

    for (uint32_t I = 0u; I < Angular; ++I)
        for (uint32_t J = 0u; J < Radial; ++J)
        {
            if (!CellKept(I, J)) continue;
            // Edges of the kept cell, CCW seen from +Z, paired with the neighbour across each one.
            const size_t S00 = SlotOf(I, J), S10 = SlotOf(I + 1u, J), S11 = SlotOf(I + 1u, J + 1u), S01 = SlotOf(I, J + 1u);
            struct EdgeRun { size_t A, B; bool Open; };
            const EdgeRun Runs[4] = {
                { S00, S10, J == 0u || !CellKept(I, J - 1u) },
                { S10, S11, !CellKept(I + 1u, J) },
                { S11, S01, J + 1u < Radial ? !CellKept(I, J + 1u) : false },   // the outer ring welds to the barrel
                { S01, S00, !CellKept(I + Angular - 1u, J) } };
            for (const EdgeRun& Run : Runs)
            {
                if (!Run.Open) continue;
                for (uint32_t Band = 0u; Band < Bands; ++Band)
                {
                    const uint32_t A0 = WallVertex(Run.A, Band),      B0 = WallVertex(Run.B, Band);
                    const uint32_t A1 = WallVertex(Run.A, Band + 1u), B1 = WallVertex(Run.B, Band + 1u);
                    const float V0 = static_cast<float>(Band) / static_cast<float>(Bands);
                    const float V1 = static_cast<float>(Band + 1u) / static_cast<float>(Bands);
                    const float UvB0[2] = { VertexUv[Run.B * 2u], V0 }, UvA0[2] = { VertexUv[Run.A * 2u], V0 };
                    const float UvA1[2] = { VertexUv[Run.A * 2u], V1 }, UvB1[2] = { VertexUv[Run.B * 2u], V1 };
                    Writer.AddQuad(B0, A0, A1, B1, RimSurfaceSlot::WindowWall, UvB0, UvA0, UvA1, UvB1);
                }
            }
        }

    //  ── ⑤ barrel: the cross-section revolved, welded to the two outer rings ──────────────────────────────────────
    const std::vector<SectionKnot> Section = ResolveSection(P);
    if (Section.size() >= 2u)
    {
        const uint32_t Steps = static_cast<uint32_t>(Section.size());
        std::vector<float> Arc(Steps, 0.0f);
        for (uint32_t S = 1u; S < Steps; ++S)
        {
            const float Dr = Section[S].Radius - Section[S - 1u].Radius, Dz = Section[S].Axial - Section[S - 1u].Axial;
            Arc[S] = Arc[S - 1u] + std::sqrt(Dr * Dr + Dz * Dz);
        }
        const float Total = std::max(1.0e-6f, Arc.back());

        std::vector<uint32_t> Previous(Angular, kNoVertex), Current(Angular, kNoVertex);
        for (uint32_t I = 0u; I < Angular; ++I) Previous[I] = FrontSlot[SlotOf(I, Radial)];
        for (uint32_t S = 1u; S < Steps; ++S)
        {
            const bool Last = (S + 1u == Steps);
            for (uint32_t I = 0u; I < Angular; ++I)
            {
                if (Last) { Current[I] = BackSlot[SlotOf(I, Radial)]; continue; }
                const float A = VertexAngle[SlotOf(I, Radial)];
                Current[I] = Writer.AddVertex(Section[S].Radius * std::cos(A), Section[S].Radius * std::sin(A), Section[S].Axial);
            }
            const RimSurfaceSlot Slot = Section[S].Finish == 0u ? RimSurfaceSlot::BarrelBore : RimSurfaceSlot::Lip;
            const float V0 = Arc[S - 1u] / Total, V1 = Arc[S] / Total;
            for (uint32_t I = 0u; I < Angular; ++I)
            {
                const uint32_t In = (I + 1u) % Angular;
                const float U0 = static_cast<float>(I) / static_cast<float>(Angular);
                const float U1 = static_cast<float>(I + 1u) / static_cast<float>(Angular);
                const float UvA[2] = { U0, V0 }, UvB[2] = { U1, V0 }, UvC[2] = { U1, V1 }, UvD[2] = { U0, V1 };
                Writer.AddQuad(Previous[I], Previous[In], Current[In], Current[I], Slot, UvA, UvB, UvC, UvD);
            }
            Previous.swap(Current);
        }
    }

    {
        RimPartSpan Body; Body.Name = "RimBody"; Body.FirstTriangle = 0u; Body.TriangleCount = Surface.QueryTriangleCount();
        Surface.Parts.push_back(Body);
        EnforceOutwardOrientation(Surface, 0u, Body.TriangleCount);
    }

    //  ── ⑥ hardware: lug nuts and the centre cap, each its own closed shell ───────────────────────────────────────
    const uint32_t Sides = std::max(8u, P.HardwareSegments);
    const auto AddRevolution = [&](const std::vector<float>& Profile, uint32_t Facets, float CentreX, float CentreY,
                                   float Phase, RimSurfaceSlot Slot, bool Faceted) noexcept
    {
        // Profile is a list of (radius, z) pairs, bottom first; the ends are capped with fans, so the shell is closed.
        const uint32_t Rings = static_cast<uint32_t>(Profile.size() / 2u);
        if (Rings < 2u || Facets < 3u) return;
        std::vector<uint32_t> Slots(static_cast<size_t>(Rings) * Facets, kNoVertex);
        for (uint32_t R = 0u; R < Rings; ++R)
            for (uint32_t F = 0u; F < Facets; ++F)
            {
                const float A = Phase + kTau * static_cast<float>(F) / static_cast<float>(Facets);
                const float Shape = Faceted ? 1.0f / std::cos(std::fmod(A - Phase + kTau, kTau / static_cast<float>(Facets)) - 0.5f * kTau / static_cast<float>(Facets)) : 1.0f;
                const float Radius = Profile[R * 2u] * Shape;
                Slots[static_cast<size_t>(R) * Facets + F] = Writer.AddVertex(CentreX + Radius * std::cos(A), CentreY + Radius * std::sin(A), Profile[R * 2u + 1u]);
            }
        for (uint32_t R = 0u; R + 1u < Rings; ++R)
            for (uint32_t F = 0u; F < Facets; ++F)
            {
                const uint32_t Fn = (F + 1u) % Facets;
                const float U0 = static_cast<float>(F) / static_cast<float>(Facets), U1 = static_cast<float>(F + 1u) / static_cast<float>(Facets);
                const float V0 = static_cast<float>(R) / static_cast<float>(Rings - 1u), V1 = static_cast<float>(R + 1u) / static_cast<float>(Rings - 1u);
                const float UvA[2] = { U0, V0 }, UvB[2] = { U1, V0 }, UvC[2] = { U1, V1 }, UvD[2] = { U0, V1 };
                Writer.AddQuad(Slots[static_cast<size_t>(R) * Facets + F], Slots[static_cast<size_t>(R) * Facets + Fn],
                               Slots[static_cast<size_t>(R + 1u) * Facets + Fn], Slots[static_cast<size_t>(R + 1u) * Facets + F],
                               Slot, UvA, UvB, UvC, UvD);
            }
        const uint32_t Bottom = Writer.AddVertex(CentreX, CentreY, Profile[1]);
        const uint32_t Top    = Writer.AddVertex(CentreX, CentreY, Profile[(Rings - 1u) * 2u + 1u]);
        const float UvCentre[2] = { 0.5f, 0.5f };
        for (uint32_t F = 0u; F < Facets; ++F)
        {
            const uint32_t Fn = (F + 1u) % Facets;
            const float UvA[2] = { static_cast<float>(F) / static_cast<float>(Facets), 0.0f };
            const float UvB[2] = { static_cast<float>(F + 1u) / static_cast<float>(Facets), 0.0f };
            Writer.AddTriangle(Bottom, Slots[Fn], Slots[F], Slot, UvCentre, UvB, UvA);
            Writer.AddTriangle(Top, Slots[static_cast<size_t>(Rings - 1u) * Facets + F], Slots[static_cast<size_t>(Rings - 1u) * Facets + Fn], Slot, UvCentre, UvA, UvB);
        }
    };

    if (P.GenerateLugNuts && P.LugCount > 0u)
    {
        const float Flats   = P.LugNutFlatsMillimetre * kMilli;
        const float Height2 = P.LugNutHeightMillimetre * kMilli;
        const float Chamfer = P.LugNutChamferMillimetre * kMilli;
        const float Across  = 0.5f * Flats;
        const uint32_t Facets = P.LugNut == LugNutCategory::Spline ? 12u : 6u;
        for (uint32_t Lug = 0u; Lug < P.LugCount; ++Lug)
        {
            const float A  = Height.LugPhase + kTau * static_cast<float>(Lug) / static_cast<float>(P.LugCount);
            const float Cx = D.LugCircleRadius * std::cos(A), Cy = D.LugCircleRadius * std::sin(A);
            const float Surface0 = Height.Front(D.LugCircleRadius, A, 1.0f);
            const float Seat     = Surface0 - D.LugSeatDepth + P.LugNutProudMillimetre * kMilli;
            const float SeatRise = std::max(1.5f * kMilli, D.LugSeatDepth);
            std::vector<float> Profile = {
                D.LugHoleRadius * 0.92f, Seat,
                D.LugSeatRadius,         Seat + SeatRise,
                Across * 0.98f,          Seat + SeatRise + 0.6f * kMilli,
                Across,                  Seat + Height2 - Chamfer,
                Across - Chamfer,        Seat + Height2 };
            if (P.LugNut == LugNutCategory::Capped)
            {
                Profile[8] = Across - Chamfer; Profile[9] = Seat + Height2 - 0.35f * Across;
                Profile.push_back(Across * 0.55f); Profile.push_back(Seat + Height2);
            }
            const uint32_t First = Surface.QueryTriangleCount();
            AddRevolution(Profile, Facets, Cx, Cy, A, RimSurfaceSlot::Hardware, true);
            RimPartSpan Part; Part.Name = "LugNut." + std::to_string(Lug);
            Part.FirstTriangle = First; Part.TriangleCount = Surface.QueryTriangleCount() - First;
            Surface.Parts.push_back(Part);
            EnforceOutwardOrientation(Surface, Part.FirstTriangle, Part.TriangleCount);
        }
    }

    if (P.GenerateLipBolts && P.LipBoltCount > 0u)
    {
        // Beadlock-style bolt heads marching around the outer band — the offroad / show-wheel tell.
        const float Across = 0.5f * std::max(3.0f, P.LipBoltDiameterMillimetre) * kMilli;
        const float Proud  = std::max(0.8f * kMilli, P.LipBoltProudMillimetre * kMilli);
        const float Circle = Mix(D.BandRadius, D.InnerRadius, 0.55f);
        for (uint32_t Bolt = 0u; Bolt < P.LipBoltCount; ++Bolt)
        {
            const float A  = kTau * static_cast<float>(Bolt) / static_cast<float>(P.LipBoltCount);
            const float Cx = Circle * std::cos(A), Cy = Circle * std::sin(A);
            const float Seat = Height.Front(Circle, A, 1.0f) - 0.3f * kMilli;
            const std::vector<float> Profile = {
                Across * 1.25f, Seat,
                Across * 1.25f, Seat + 0.35f * Proud,
                Across,         Seat + 0.55f * Proud,
                Across,         Seat + Proud - 0.35f * Across,
                Across * 0.70f, Seat + Proud };
            const uint32_t First = Surface.QueryTriangleCount();
            AddRevolution(Profile, 6u, Cx, Cy, A, RimSurfaceSlot::Hardware, true);
            RimPartSpan Part; Part.Name = "LipBolt." + std::to_string(Bolt);
            Part.FirstTriangle = First; Part.TriangleCount = Surface.QueryTriangleCount() - First;
            Surface.Parts.push_back(Part);
            EnforceOutwardOrientation(Surface, Part.FirstTriangle, Part.TriangleCount);
        }
    }

    if (P.CentreLock)
    {
        // Single central nut (GT3 / endurance): sits on the hub pad, swallowing the bore.
        const float Across  = 0.5f * std::max(20.0f, P.CentreLockFlatsMillimetre) * kMilli;
        const float Chamfer = 0.12f * Across;
        const float Seat    = Height.Front(0.0f, 0.0f, 1.0f) - 1.0f * kMilli;
        const float Tall    = 1.15f * Across;
        const std::vector<float> Profile = {
            D.BoreRadius * 0.55f, Seat,
            Across * 1.06f,       Seat + 0.22f * Across,
            Across,               Seat + 0.34f * Across,
            Across,               Seat + Tall - Chamfer,
            Across - Chamfer,     Seat + Tall };
        const uint32_t First = Surface.QueryTriangleCount();
        AddRevolution(Profile, 6u, 0.0f, 0.0f, 0.0f, RimSurfaceSlot::Hardware, true);
        RimPartSpan Part; Part.Name = "CentreLockNut";
        Part.FirstTriangle = First; Part.TriangleCount = Surface.QueryTriangleCount() - First;
        Surface.Parts.push_back(Part);
        EnforceOutwardOrientation(Surface, Part.FirstTriangle, Part.TriangleCount);
    }

    if (P.GenerateCentreCap && !P.CentreLock)
    {
        const float Radius = Clamp(P.CentreCapRadiusFraction, 0.1f, 1.0f) * D.HubRadius;
        const float Dome   = P.CentreCapDomeMillimetre * kMilli;
        const float Base   = Height.Front(0.0f, 0.0f, 1.0f) - 2.0f * kMilli;
        std::vector<float> Profile;
        const uint32_t Rings = 10u;
        Profile.push_back(Radius * 0.96f); Profile.push_back(Base);
        Profile.push_back(Radius);         Profile.push_back(Base + 1.5f * kMilli);
        for (uint32_t R = 0u; R <= Rings; ++R)
        {
            const float T = static_cast<float>(R) / static_cast<float>(Rings);
            Profile.push_back(Radius * std::cos(0.5f * kPi * T));
            Profile.push_back(Base + 1.5f * kMilli + Dome * std::sin(0.5f * kPi * T));
        }
        const uint32_t First = Surface.QueryTriangleCount();
        AddRevolution(Profile, Sides, 0.0f, 0.0f, 0.0f, RimSurfaceSlot::CentreCap, false);
        RimPartSpan Part; Part.Name = "CentreCap";
        Part.FirstTriangle = First; Part.TriangleCount = Surface.QueryTriangleCount() - First;
        Surface.Parts.push_back(Part);
        EnforceOutwardOrientation(Surface, Part.FirstTriangle, Part.TriangleCount);
    }

    ComputeCornerNormals(Surface, P.CreaseDegrees);
    return Surface;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   AUDIT & DUMP
//------------------------------------------------------------------------------------------------------------------------

RimSurfaceAudit RimSurface::Audit(uint32_t FirstTriangle, uint32_t Count) const noexcept
{
    RimSurfaceAudit Report;
    const uint32_t Faces = QueryTriangleCount();
    const uint32_t Last  = Count == 0xFFFFFFFFu ? Faces : std::min(Faces, FirstTriangle + Count);
    if (FirstTriangle >= Last) return Report;
    Report.TriangleCount = Last - FirstTriangle;

    std::unordered_map<uint64_t, int32_t> Edges;           // key = min<<32 | max, counter = forward − backward
    std::unordered_map<uint64_t, uint32_t> Uses;
    std::unordered_map<uint32_t, uint32_t> Parent;         // union-find over the vertices actually referenced
    Edges.reserve(Report.TriangleCount * 3u);
    Uses.reserve(Report.TriangleCount * 3u);

    const std::function<uint32_t(uint32_t)> Find = [&Parent](uint32_t X) -> uint32_t
    {
        while (Parent[X] != X) { Parent[X] = Parent[Parent[X]]; X = Parent[X]; }
        return X;
    };

    for (uint32_t F = FirstTriangle; F < Last; ++F)
        for (uint32_t K = 0u; K < 3u; ++K)
        {
            const uint32_t V = Corners[F * 3u + K];
            if (Parent.find(V) == Parent.end()) Parent[V] = V;
        }
    Report.VertexCount = static_cast<uint32_t>(Parent.size());

    for (uint32_t F = FirstTriangle; F < Last; ++F)
    {
        const uint32_t A = Corners[F * 3u + 0u], B = Corners[F * 3u + 1u], C = Corners[F * 3u + 2u];
        if (A == B || B == C || A == C) { ++Report.DegenerateFaces; continue; }
        const float* Pa = &Positions[A * 3u]; const float* Pb = &Positions[B * 3u]; const float* Pc = &Positions[C * 3u];
        const double Ux = Pb[0] - Pa[0], Uy = Pb[1] - Pa[1], Uz = Pb[2] - Pa[2];
        const double Vx = Pc[0] - Pa[0], Vy = Pc[1] - Pa[1], Vz = Pc[2] - Pa[2];
        const double Nx = Uy * Vz - Uz * Vy, Ny = Uz * Vx - Ux * Vz, Nz = Ux * Vy - Uy * Vx;
        const double Area = 0.5 * std::sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
        Report.SurfaceArea += Area;
        if (Area < kEpsilon) ++Report.DegenerateFaces;
        Report.SignedVolume += (static_cast<double>(Pa[0]) * (static_cast<double>(Pb[1]) * Pc[2] - static_cast<double>(Pb[2]) * Pc[1])
                              - static_cast<double>(Pa[1]) * (static_cast<double>(Pb[0]) * Pc[2] - static_cast<double>(Pb[2]) * Pc[0])
                              + static_cast<double>(Pa[2]) * (static_cast<double>(Pb[0]) * Pc[1] - static_cast<double>(Pb[1]) * Pc[0])) / 6.0;

        const uint32_t Triple[3] = { A, B, C };
        for (uint32_t K = 0u; K < 3u; ++K)
        {
            const uint32_t X = Triple[K], Y = Triple[(K + 1u) % 3u];
            const uint64_t Key = (static_cast<uint64_t>(std::min(X, Y)) << 32) | std::max(X, Y);
            Edges[Key] += (X < Y) ? 1 : -1;
            ++Uses[Key];
            const uint32_t Rx = Find(X), Ry = Find(Y);
            if (Rx != Ry) Parent[Rx] = Ry;
        }
    }

    for (const auto& Entry : Uses)
    {
        if (Entry.second == 1u)      ++Report.BoundaryEdges;
        else if (Entry.second > 2u)  ++Report.NonManifoldEdges;
        else if (Edges[Entry.first] != 0) ++Report.FlippedEdges;
    }

    uint32_t Shells = 0u;
    for (auto& Entry : Parent) if (Find(Entry.first) == Entry.first) ++Shells;
    Report.ShellCount = Shells;
    return Report;
}

bool RimSurface::WriteWavefront(const std::string& Path, std::string* Error) const noexcept
{
    std::FILE* File = std::fopen(Path.c_str(), "wb");
    if (File == nullptr) { if (Error != nullptr) *Error = "cannot open " + Path; return false; }
    std::fprintf(File, "# Frontier WheelRimSpecification\n");
    for (size_t V = 0u; V < Positions.size(); V += 3u)
        std::fprintf(File, "v %.6f %.6f %.6f\n", Positions[V], Positions[V + 1u], Positions[V + 2u]);
    for (size_t C = 0u; C < CornerTexcoords.size(); C += 2u)
        std::fprintf(File, "vt %.6f %.6f\n", CornerTexcoords[C], CornerTexcoords[C + 1u]);
    for (size_t N = 0u; N < CornerNormals.size(); N += 3u)
        std::fprintf(File, "vn %.5f %.5f %.5f\n", CornerNormals[N], CornerNormals[N + 1u], CornerNormals[N + 2u]);
    const uint32_t Faces = QueryTriangleCount();
    uint32_t PartCursor = 0u;
    for (uint32_t F = 0u; F < Faces; ++F)
    {
        while (PartCursor < Parts.size() && F == Parts[PartCursor].FirstTriangle)
            std::fprintf(File, "g %s\n", Parts[PartCursor++].Name.c_str());
        std::fprintf(File, "usemtl slot_%u\nf", Slots.empty() ? 0u : Slots[F]);
        for (uint32_t K = 0u; K < 3u; ++K)
            std::fprintf(File, " %u/%u/%u", Corners[F * 3u + K] + 1u, F * 3u + K + 1u, F * 3u + K + 1u);
        std::fprintf(File, "\n");
    }
    std::fclose(File);
    return true;
}

} // namespace Frontier
