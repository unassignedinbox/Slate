//============================================================================================================================================
//                                                      INTERSECTIONCLASSIFIER.SLANG.H
//============================================================================================================================================
// 🧩 Segment-segment intersection and axis-aligned extent overlap — exact where decidable, bounded where not.

#pragma once

#include "Shared/Prelude.slang.h"
#include "Shared/OrientationClassifier.slang.h"

// 📐 Two segments intersect in one of four ways: their interiors cross, they share exactly one endpoint, they
//    are collinear and overlap over a span, or they are wholly apart. The classification names the case rather
//    than answering a boolean, because `38` §6's outward rounding and `52`'s fill rule each need the case —
//    not just whether the answer is nonzero.
//
// 🔴 The crossing and collinearity tests are both orientation determinants, which are exact. The crossing
//    position itself is computed by linear interpolation (Bounded), and is therefore named and declared apart
//    from the classification that precedes it.

// 📝 The four cases are named as constants rather than as an enumeration because an enumeration declared on
//    the host has no spelling the shader toolchain shares without a second declaration that must be kept
//    identical. A constant integer has the same spelling on both sides, and the compiler rejects a mismatch.
#define SlateIntersectionCrossing  ( 2)   // [-] - interiors cross transversally
#define SlateIntersectionTouching  ( 1)   // [-] - one endpoint exactly on the other segment, or endpoints coincide
#define SlateIntersectionCollinear ( 0)   // [-] - collinear and overlapping (or coincident)
#define SlateIntersectionDisjoint  (-1)   // [-] - no shared position at all

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                             SEGMENT-SEGMENT INTERSECTION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Classifies the intersection of two segments.
/// in    AlphaX      [-]  first endpoint of the first segment
/// in    AlphaY      [-]
/// in    BetaX       [-]  second endpoint of the first segment
/// in    BetaY       [-]
/// in    GammaX      [-]  first endpoint of the second segment
/// in    GammaY      [-]
/// in    DeltaX      [-]  second endpoint of the second segment
/// in    DeltaY      [-]
/// out   Class       [-]  SlateIntersectionCrossing, Touching, Collinear, or Disjoint
/// err   never refuses; every finite input produces exactly one case
/// note  🔴 Symmetric under exchange of the two segments and under reversal of either segment's endpoints.
///       Both symmetries are checked by ParityRunner because the algorithm tests the two segments
///       asymmetrically and a lapse shows up only under one of them.
/// note  Exact — the case is decided by orientation determinants throughout. The crossing position is
///       Bounded and is resolved separately by ResolveSegmentCrossing.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Signed32 ClassifySegmentIntersection(Real64 AlphaX, Real64 AlphaY,
                                                  Real64 BetaX,  Real64 BetaY,
                                                  Real64 GammaX, Real64 GammaY,
                                                  Real64 DeltaX, Real64 DeltaY)
{
    const Signed32 GammaSide = ClassifyOrientation(AlphaX, AlphaY, BetaX, BetaY, GammaX, GammaY);
    const Signed32 DeltaSide = ClassifyOrientation(AlphaX, AlphaY, BetaX, BetaY, DeltaX, DeltaY);

    // 📐 If Gamma and Delta are on the same strict side of Alpha→Beta, or one of them lands exactly on the
    //    line, the second segment cannot cross the first's interior transversally.
    if (GammaSide == DeltaSide && GammaSide != 0)
        return SlateIntersectionDisjoint;

    const Signed32 AlphaSide = ClassifyOrientation(GammaX, GammaY, DeltaX, DeltaY, AlphaX, AlphaY);
    const Signed32 BetaSide  = ClassifyOrientation(GammaX, GammaY, DeltaX, DeltaY, BetaX,  BetaY);

    // 📐 Proper crossing: the two segments separate each other's endpoints onto strictly opposite sides.
    if (GammaSide != DeltaSide && AlphaSide != BetaSide
     && GammaSide != 0 && DeltaSide != 0
     && AlphaSide != 0 && BetaSide  != 0)
    {
        return SlateIntersectionCrossing;
    }

    // 📐 Collinear: all four orientation tests are zero. Decide by extent overlap along the dominant axis.
    if (GammaSide == 0 && DeltaSide == 0 && AlphaSide == 0 && BetaSide == 0)
    {
        // 📝 The axis is chosen by which span is wider, so a vertical segment is not forced into the
        //    X axis where it would project to a point. A degenerate segment is handled by the disjoint
        //    test below in either case.
        const Real64 SpanX = BetaX - AlphaX;
        const Real64 SpanY = BetaY - AlphaY;

        Real64 A0, A1, B0, B1;

        if (Magnitude(SpanX) >= Magnitude(SpanY))
        {
            A0 = AlphaX;  A1 = BetaX;
            B0 = GammaX;  B1 = DeltaX;
        }
        else
        {
            A0 = AlphaY;  A1 = BetaY;
            B0 = GammaY;  B1 = DeltaY;
        }

        // Normalise so A0 <= A1 and B0 <= B1.
        if (A0 > A1) { Real64 T = A0; A0 = A1; A1 = T; }
        if (B0 > B1) { Real64 T = B0; B0 = B1; B1 = T; }

        // 📐 Disjoint intervals → disjoint segments. Meeting at exactly one point → Touching.
        // Overlapping over a positive span → Collinear.
        if (B1 < A0 || A1 < B0)
            return SlateIntersectionDisjoint;

        if (B1 == A0 || A1 == B0)
            return SlateIntersectionTouching;

        return SlateIntersectionCollinear;
    }

    // 📐 At least one orientation test is zero and the segments are not collinear — an endpoint of one
    //    segment lies exactly on the other. Classify as Touching unless the endpoint is outside the
    //    other segment's extent, in which case the segments are disjoint.
    if (GammaSide == 0)
    {
        const Real64 LeastX    = AlphaX < BetaX ? AlphaX : BetaX;
        const Real64 GreatestX = AlphaX < BetaX ? BetaX  : AlphaX;
        const Real64 LeastY    = AlphaY < BetaY ? AlphaY : BetaY;
        const Real64 GreatestY = AlphaY < BetaY ? BetaY  : AlphaY;

        if (GammaX >= LeastX && GammaX <= GreatestX && GammaY >= LeastY && GammaY <= GreatestY)
            return SlateIntersectionTouching;

        return SlateIntersectionDisjoint;
    }

    if (DeltaSide == 0)
    {
        const Real64 LeastX    = AlphaX < BetaX ? AlphaX : BetaX;
        const Real64 GreatestX = AlphaX < BetaX ? BetaX  : AlphaX;
        const Real64 LeastY    = AlphaY < BetaY ? AlphaY : BetaY;
        const Real64 GreatestY = AlphaY < BetaY ? BetaY  : AlphaY;

        if (DeltaX >= LeastX && DeltaX <= GreatestX && DeltaY >= LeastY && DeltaY <= GreatestY)
            return SlateIntersectionTouching;

        return SlateIntersectionDisjoint;
    }

    if (AlphaSide == 0)
    {
        const Real64 LeastX    = GammaX < DeltaX ? GammaX : DeltaX;
        const Real64 GreatestX = GammaX < DeltaX ? DeltaX : GammaX;
        const Real64 LeastY    = GammaY < DeltaY ? GammaY : DeltaY;
        const Real64 GreatestY = GammaY < DeltaY ? DeltaY : GammaY;

        if (AlphaX >= LeastX && AlphaX <= GreatestX && AlphaY >= LeastY && AlphaY <= GreatestY)
            return SlateIntersectionTouching;

        return SlateIntersectionDisjoint;
    }

    if (BetaSide == 0)
    {
        const Real64 LeastX    = GammaX < DeltaX ? GammaX : DeltaX;
        const Real64 GreatestX = GammaX < DeltaX ? DeltaX : GammaX;
        const Real64 LeastY    = GammaY < DeltaY ? GammaY : DeltaY;
        const Real64 GreatestY = GammaY < DeltaY ? DeltaY : GammaY;

        if (BetaX >= LeastX && BetaX <= GreatestX && BetaY >= LeastY && BetaY <= GreatestY)
            return SlateIntersectionTouching;

        return SlateIntersectionDisjoint;
    }

    return SlateIntersectionDisjoint;
}

/// 🧩 Resolves the crossing position of two segments, when one exists.
/// in    AlphaX      [-]  first segment
/// in    AlphaY      [-]
/// in    BetaX       [-]
/// in    BetaY       [-]
/// in    GammaX      [-]  second segment
/// in    GammaY      [-]
/// in    DeltaX      [-]
/// in    DeltaY      [-]
/// out   CrossingX   [-]  resolved abscissa
/// out   CrossingY   [-]  resolved ordinate
/// out   Resolved    [-]  false when the segments are parallel or degenerate — refuses rather than dividing by zero
/// note  Bounded — linear interpolation over double-precision inputs.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED bool ResolveSegmentCrossing(Real64 AlphaX, Real64 AlphaY,
                                         Real64 BetaX,  Real64 BetaY,
                                         Real64 GammaX, Real64 GammaY,
                                         Real64 DeltaX, Real64 DeltaY,
                                         SLATE_OUT(Real64) CrossingX,
                                         SLATE_OUT(Real64) CrossingY)
{
    // 📐 Parametric form: P = Alpha + t*(Beta - Alpha), solved for t at the crossing.
    //    The denominator is the 2×2 determinant of the two direction vectors.
    const Real64 DirAX = BetaX  - AlphaX;
    const Real64 DirAY = BetaY  - AlphaY;
    const Real64 DirBX = DeltaX - GammaX;
    const Real64 DirBY = DeltaY - GammaY;

    const Real64 Denom = DirAX * DirBY - DirAY * DirBX;

    if (Denom == 0.0)
        return false;

    const Real64 SpanX = GammaX - AlphaX;
    const Real64 SpanY = GammaY - AlphaY;

    const Real64 T = (SpanX * DirBY - SpanY * DirBX) / Denom;

    CrossingX = AlphaX + T * DirAX;
    CrossingY = AlphaY + T * DirAY;

    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          AXIS-ALIGNED EXTENT OVERLAP
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Classifies the overlap of two axis-aligned extents.
/// in    AlphaLeastX   [-]  first extent — least corner
/// in    AlphaLeastY   [-]
/// in    AlphaGreatestX [-]  first extent — greatest corner
/// in    AlphaGreatestY [-]
/// in    BetaLeastX    [-]  second extent — least corner
/// in    BetaLeastY    [-]
/// in    BetaGreatestX [-]  second extent — greatest corner
/// in    BetaGreatestY [-]
/// out   Overlap       [-]  +1 interiors overlap, 0 touching on a bound, −1 disjoint
/// note  🔴 Returns 0 for extents that share exactly one bound but whose interiors do not overlap. `38` §6
///        rounds every extent outward before asking this predicate, so a boundary contact is turned into an
///        interior overlap at the rasterisation stage rather than here.
/// note  Exact — comparisons of representable coordinates; identical on the host and on the device.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Signed32 ClassifyExtentOverlap(Real64 AlphaLeastX,    Real64 AlphaLeastY,
                                            Real64 AlphaGreatestX, Real64 AlphaGreatestY,
                                            Real64 BetaLeastX,     Real64 BetaLeastY,
                                            Real64 BetaGreatestX,  Real64 BetaGreatestY)
{
    // 📐 Disjoint: one extent's least exceeds the other's greatest along either axis.
    if (AlphaGreatestX < BetaLeastX || BetaGreatestX < AlphaLeastX
     || AlphaGreatestY < BetaLeastY || BetaGreatestY < AlphaLeastY)
    {
        return -1;
    }

    // 📐 Touching: their bounds meet but interiors are apart along at least one axis.
    if (AlphaGreatestX == BetaLeastX || BetaGreatestX == AlphaLeastX
     || AlphaGreatestY == BetaLeastY || BetaGreatestY == AlphaLeastY)
    {
        return 0;
    }

    return 1;
}

/// 🧩 Classifies the overlap of two axis-aligned volumetric extents.
/// in    AlphaLeastX    [-]  first extent — least corner
/// in    AlphaLeastY    [-]
/// in    AlphaLeastZ    [-]
/// in    AlphaGreatestX [-]  first extent — greatest corner
/// in    AlphaGreatestY [-]
/// in    AlphaGreatestZ [-]
/// in    BetaLeastX     [-]  second extent — least corner
/// in    BetaLeastY     [-]
/// in    BetaLeastZ     [-]
/// in    BetaGreatestX  [-]  second extent — greatest corner
/// in    BetaGreatestY  [-]
/// in    BetaGreatestZ  [-]
/// out   Overlap        [-]  +1 interiors overlap, 0 touching on a bound, −1 disjoint
/// note  🔴 The volumetric form of the predicate above, declared beside it rather than derived from it by three
///        planar calls. Three planar answers do not compose into one volumetric answer: two extents may overlap
///        on all three axis-aligned projections and still be disjoint in space, so the composition would report
///        an overlap that does not exist.
/// note  🔴 `40` §6 and `44` §5 both ask this and both are Exact about it. A missed overlap in `40` is geometry
///        the artist cannot click; a missed overlap in `44` is a surface an illuminant reaches and does not light.
/// note  Exact — comparisons of representable coordinates; identical on the host and on the device.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Signed32 ClassifyVolumeOverlap(Real64 AlphaLeastX,    Real64 AlphaLeastY,    Real64 AlphaLeastZ,
                                            Real64 AlphaGreatestX, Real64 AlphaGreatestY, Real64 AlphaGreatestZ,
                                            Real64 BetaLeastX,     Real64 BetaLeastY,     Real64 BetaLeastZ,
                                            Real64 BetaGreatestX,  Real64 BetaGreatestY,  Real64 BetaGreatestZ)
{
    if (AlphaGreatestX < BetaLeastX || BetaGreatestX < AlphaLeastX
     || AlphaGreatestY < BetaLeastY || BetaGreatestY < AlphaLeastY
     || AlphaGreatestZ < BetaLeastZ || BetaGreatestZ < AlphaLeastZ)
    {
        return -1;
    }

    if (AlphaGreatestX == BetaLeastX || BetaGreatestX == AlphaLeastX
     || AlphaGreatestY == BetaLeastY || BetaGreatestY == AlphaLeastY
     || AlphaGreatestZ == BetaLeastZ || BetaGreatestZ == AlphaLeastZ)
    {
        return 0;
    }

    return 1;
}

}   // namespace Slate
