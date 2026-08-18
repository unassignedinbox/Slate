//============================================================================================================================================
//                                                         PRIMITIVESTRUCTURE.CPP
//============================================================================================================================================
// 🧩 Parametric polygon generation — the closed set of solids every authored surface and every manipulator grip is built from.

#include "SlateDocument/Document/PrimitiveStructure/Api/PrimitiveStructure.h"

#include <cmath>
#include <cstddef>

namespace Slate
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE ACCUMULATOR
//------------------------------------------------------------------------------------------------------------------------

// 📝 Positions, coordinates and perpendiculars accumulate together because a generated vertex declares all three at
//    once. Splitting them into three walks would leave the three counts able to disagree, and the disagreement is
//    only discoverable at the seal — which is far from the generation that caused it.
struct GeneratedSurface
{
    std::vector<DocumentPosition>          Positions;
    std::vector<SurfaceDirection>          Perpendiculars;
    std::vector<DomainCoordinate>          Coordinates;
    std::vector<std::vector<std::uint32_t>> Faces;

    std::uint32_t Emit(double PositionAlong, double PositionUp, double PositionAcross,
                       double DirectionAlong, double DirectionUp, double DirectionAcross,
                       double DomainAlong, double DomainAcross)
    {
        DocumentPosition Placing;
        Placing.PositionX = PositionAlong;
        Placing.PositionY = PositionUp;
        Placing.PositionZ = PositionAcross;

        SurfaceDirection Facing;

        // 📐 Normalised here rather than by the caller. Every generator below writes a direction it derived from
        //    the parametrisation, and a cone's wall perpendicular is the one place where the obvious expression is
        //    not unit length — normalising once here is what keeps that from being six separate omissions.
        const double Length = std::sqrt(DirectionAlong  * DirectionAlong
                                      + DirectionUp     * DirectionUp
                                      + DirectionAcross * DirectionAcross);

        if (Length > 0.0)
        {
            Facing.DirectionX = static_cast<float>(DirectionAlong  / Length);
            Facing.DirectionY = static_cast<float>(DirectionUp     / Length);
            Facing.DirectionZ = static_cast<float>(DirectionAcross / Length);
        }

        DomainCoordinate Addressing;
        Addressing.CoordinateAlong  = static_cast<float>(DomainAlong);
        Addressing.CoordinateAcross = static_cast<float>(DomainAcross);

        Positions.push_back(Placing);
        Perpendiculars.push_back(Facing);
        Coordinates.push_back(Addressing);

        return static_cast<std::uint32_t>(Positions.size() - 1u);
    }

    void EmitFace(std::uint32_t FirstCorner, std::uint32_t SecondCorner, std::uint32_t ThirdCorner)
    {
        Faces.push_back({ FirstCorner, SecondCorner, ThirdCorner });
    }

    void EmitFace(std::uint32_t FirstCorner, std::uint32_t SecondCorner,
                  std::uint32_t ThirdCorner, std::uint32_t FourthCorner)
    {
        Faces.push_back({ FirstCorner, SecondCorner, ThirdCorner, FourthCorner });
    }
};

constexpr double Turn = 6.283185307179586;

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE BOX
//------------------------------------------------------------------------------------------------------------------------

// 🔴 Twenty-four vertices and not eight. A box corner carries three different perpendiculars and three different
//    domain coordinates, and eight shared vertices would average them — which rounds every edge of the box and
//    puts one seam through the middle of whatever is placed on it.
void GenerateBox(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating)
{
    const double HalfAlong  = Declaring.HalfExtentAlong;
    const double HalfUp     = Declaring.HalfExtentUp;
    const double HalfAcross = Declaring.HalfExtentAcross;

    // 📝 Each row is one face's outward direction and the two spans that traverse it, in winding order. Written as
    //    data so the six faces cannot disagree about winding, which is the defect where one side of a box is
    //    invisible from outside and visible from within.
    const double Faces[6][9] =
    {
        {  1.0,  0.0,  0.0,   0.0, 0.0, -1.0,   0.0, 1.0,  0.0 },   // [-] - the far side along the first axis
        { -1.0,  0.0,  0.0,   0.0, 0.0,  1.0,   0.0, 1.0,  0.0 },   // [-] - the near side
        {  0.0,  1.0,  0.0,   1.0, 0.0,  0.0,   0.0, 0.0, -1.0 },   // [-] - the upper side
        {  0.0, -1.0,  0.0,   1.0, 0.0,  0.0,   0.0, 0.0,  1.0 },   // [-] - the lower side
        {  0.0,  0.0,  1.0,   1.0, 0.0,  0.0,   0.0, 1.0,  0.0 },   // [-] - the far side across
        {  0.0,  0.0, -1.0,  -1.0, 0.0,  0.0,   0.0, 1.0,  0.0 }    // [-] - the near side across
    };

    for (std::size_t FaceOrdinal = 0u; FaceOrdinal < 6u; ++FaceOrdinal)
    {
        const double* Declared = Faces[FaceOrdinal];

        const double CentreAlong  = Declared[0] * HalfAlong;
        const double CentreUp     = Declared[1] * HalfUp;
        const double CentreAcross = Declared[2] * HalfAcross;

        const double AlongSpanX = Declared[3] * HalfAlong;
        const double AlongSpanY = Declared[4] * HalfUp;
        const double AlongSpanZ = Declared[5] * HalfAcross;

        const double AcrossSpanX = Declared[6] * HalfAlong;
        const double AcrossSpanY = Declared[7] * HalfUp;
        const double AcrossSpanZ = Declared[8] * HalfAcross;

        const std::uint32_t LowerNear = Generating.Emit(CentreAlong  - AlongSpanX - AcrossSpanX,
                                                        CentreUp     - AlongSpanY - AcrossSpanY,
                                                        CentreAcross - AlongSpanZ - AcrossSpanZ,
                                                        Declared[0], Declared[1], Declared[2], 0.0, 0.0);

        const std::uint32_t LowerFar  = Generating.Emit(CentreAlong  + AlongSpanX - AcrossSpanX,
                                                        CentreUp     + AlongSpanY - AcrossSpanY,
                                                        CentreAcross + AlongSpanZ - AcrossSpanZ,
                                                        Declared[0], Declared[1], Declared[2], 1.0, 0.0);

        const std::uint32_t UpperFar  = Generating.Emit(CentreAlong  + AlongSpanX + AcrossSpanX,
                                                        CentreUp     + AlongSpanY + AcrossSpanY,
                                                        CentreAcross + AlongSpanZ + AcrossSpanZ,
                                                        Declared[0], Declared[1], Declared[2], 1.0, 1.0);

        const std::uint32_t UpperNear = Generating.Emit(CentreAlong  - AlongSpanX + AcrossSpanX,
                                                        CentreUp     - AlongSpanY + AcrossSpanY,
                                                        CentreAcross - AlongSpanZ + AcrossSpanZ,
                                                        Declared[0], Declared[1], Declared[2], 0.0, 1.0);

        Generating.EmitFace(LowerNear, LowerFar, UpperFar, UpperNear);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE SPHERE
//------------------------------------------------------------------------------------------------------------------------

void GenerateSphere(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating)
{
    const std::uint32_t Radial = Declaring.RadialCount;
    const std::uint32_t Axial  = Declaring.AxialCount;

    // 📝 The seam ring is emitted twice — once at zero and once at one — so the domain is continuous across it.
    //    A shared seam column would carry one coordinate for two sides and every placement crossing it would be
    //    smeared across the whole sphere, which is the artefact that reads as the texture being wrong.
    for (std::uint32_t Ring = 0u; Ring <= Axial; ++Ring)
    {
        const double AcrossFraction = static_cast<double>(Ring) / static_cast<double>(Axial);
        const double Inclination    = AcrossFraction * Turn * 0.5;
        const double RingRadius     = std::sin(Inclination);
        const double RingHeight     = std::cos(Inclination);

        for (std::uint32_t Step = 0u; Step <= Radial; ++Step)
        {
            const double AlongFraction = static_cast<double>(Step) / static_cast<double>(Radial);
            const double Azimuth       = Declaring.SweepOffset + AlongFraction * Turn;

            const double DirectionAlong  = RingRadius * std::cos(Azimuth);
            const double DirectionAcross = RingRadius * std::sin(Azimuth);

            Generating.Emit(DirectionAlong  * Declaring.HalfExtentAlong,
                            RingHeight      * Declaring.HalfExtentUp,
                            DirectionAcross * Declaring.HalfExtentAcross,
                            DirectionAlong, RingHeight, DirectionAcross,
                            AlongFraction, 1.0 - AcrossFraction);
        }
    }

    const std::uint32_t Stride = Radial + 1u;

    for (std::uint32_t Ring = 0u; Ring < Axial; ++Ring)
    {
        for (std::uint32_t Step = 0u; Step < Radial; ++Step)
        {
            const std::uint32_t UpperNear = Ring * Stride + Step;
            const std::uint32_t UpperFar  = UpperNear + 1u;
            const std::uint32_t LowerNear = UpperNear + Stride;
            const std::uint32_t LowerFar  = LowerNear + 1u;

            // 📝 The pole rings collapse to a point, so their quadrilaterals are emitted as triangles instead. A
            //    quadrilateral with two coincident corners is degenerate, and `38` §3 enrols it rather than
            //    removing it — the degenerate face then survives all the way to whatever divides by its area.
            if (Ring == 0u)
            {
                Generating.EmitFace(UpperNear, LowerNear, LowerFar);
                continue;
            }

            if (Ring == Axial - 1u)
            {
                Generating.EmitFace(UpperNear, LowerNear, UpperFar);
                continue;
            }

            Generating.EmitFace(UpperNear, LowerNear, LowerFar, UpperFar);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE SURFACE OF REVOLUTION
//------------------------------------------------------------------------------------------------------------------------

// 🔴 The cylinder and the cone are one generation with two profiles, because they differ only in the radius at the
//    upper ring. Written as two routines they would be two windings, two cap emissions and two seam conventions,
//    and only one of the six pairs would be checked when either is amended.
void GenerateRevolution(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating, double UpperFraction)
{
    const std::uint32_t Radial = Declaring.RadialCount;
    const std::uint32_t Axial  = Declaring.AxialCount;
    const std::uint32_t Stride = Radial + 1u;

    const double HalfUp = Declaring.HalfExtentUp;

    for (std::uint32_t Ring = 0u; Ring <= Axial; ++Ring)
    {
        const double AcrossFraction = static_cast<double>(Ring) / static_cast<double>(Axial);
        const double RingScale      = 1.0 + AcrossFraction * (UpperFraction - 1.0);
        const double RingHeight     = -HalfUp + AcrossFraction * 2.0 * HalfUp;

        for (std::uint32_t Step = 0u; Step <= Radial; ++Step)
        {
            const double AlongFraction = static_cast<double>(Step) / static_cast<double>(Radial);
            const double Azimuth       = Declaring.SweepOffset + AlongFraction * Turn;

            const double UnitAlong  = std::cos(Azimuth);
            const double UnitAcross = std::sin(Azimuth);

            // 📐 The wall perpendicular of a taper is not radial. Its upward part is the profile's own slope —
            //    the radius lost over the height — and a radial perpendicular on a cone shades it as a cylinder,
            //    which is visible as a band of constant brightness where the taper should darken.
            const double SlopeUp = (1.0 - UpperFraction) * Declaring.HalfExtentAlong / (2.0 * HalfUp);

            Generating.Emit(UnitAlong  * RingScale * Declaring.HalfExtentAlong,
                            RingHeight,
                            UnitAcross * RingScale * Declaring.HalfExtentAcross,
                            UnitAlong, SlopeUp, UnitAcross,
                            AlongFraction, AcrossFraction);
        }
    }

    for (std::uint32_t Ring = 0u; Ring < Axial; ++Ring)
    {
        for (std::uint32_t Step = 0u; Step < Radial; ++Step)
        {
            const std::uint32_t LowerNear = Ring * Stride + Step;
            const std::uint32_t LowerFar  = LowerNear + 1u;
            const std::uint32_t UpperNear = LowerNear + Stride;
            const std::uint32_t UpperFar  = UpperNear + 1u;

            // 📝 The apex ring of a cone is coincident, so its quadrilaterals are triangles for the same reason
            //    the sphere's poles are.
            if (UpperFraction <= 0.0 && Ring == Axial - 1u)
            {
                Generating.EmitFace(LowerNear, LowerFar, UpperNear);
                continue;
            }

            Generating.EmitFace(LowerNear, LowerFar, UpperFar, UpperNear);
        }
    }

    if (!Declaring.CapsDeclared)
    {
        return;
    }

    // 📝 Each cap is a triangle fan about its own centre vertex, and its ring is emitted afresh rather than shared
    //    with the wall. The shared ring would carry one perpendicular for two surfaces meeting at a right angle,
    //    and the edge between them would read as a bevel that no parameter asked for.
    const double CapHeights[2]  = { -HalfUp,  HalfUp     };
    const double CapFacing[2]   = { -1.0,     1.0        };
    const double CapScales[2]   = {  1.0,     UpperFraction };

    for (std::size_t CapOrdinal = 0u; CapOrdinal < 2u; ++CapOrdinal)
    {
        if (CapScales[CapOrdinal] <= 0.0)
        {
            continue;
        }

        const std::uint32_t Centre = Generating.Emit(0.0, CapHeights[CapOrdinal], 0.0,
                                                     0.0, CapFacing[CapOrdinal], 0.0,
                                                     0.5, 0.5);

        const std::uint32_t FirstRim = Centre + 1u;

        for (std::uint32_t Step = 0u; Step <= Radial; ++Step)
        {
            const double AlongFraction = static_cast<double>(Step) / static_cast<double>(Radial);
            const double Azimuth       = Declaring.SweepOffset + AlongFraction * Turn;

            const double UnitAlong  = std::cos(Azimuth);
            const double UnitAcross = std::sin(Azimuth);

            Generating.Emit(UnitAlong  * CapScales[CapOrdinal] * Declaring.HalfExtentAlong,
                            CapHeights[CapOrdinal],
                            UnitAcross * CapScales[CapOrdinal] * Declaring.HalfExtentAcross,
                            0.0, CapFacing[CapOrdinal], 0.0,
                            0.5 + 0.5 * UnitAlong, 0.5 + 0.5 * UnitAcross);
        }

        for (std::uint32_t Step = 0u; Step < Radial; ++Step)
        {
            const std::uint32_t NearRim = FirstRim + Step;
            const std::uint32_t FarRim  = NearRim + 1u;

            // 📝 The two caps wind opposite ways because they face opposite ways. One winding for both is the
            //    defect where a cylinder is closed at one end and open at the other from outside.
            if (CapFacing[CapOrdinal] > 0.0)
            {
                Generating.EmitFace(Centre, NearRim, FarRim);
            }
            else
            {
                Generating.EmitFace(Centre, FarRim, NearRim);
            }
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE TORUS
//------------------------------------------------------------------------------------------------------------------------

void GenerateTorus(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating)
{
    const std::uint32_t Radial = Declaring.RadialCount;
    const std::uint32_t Axial  = Declaring.AxialCount;
    const std::uint32_t Stride = Axial + 1u;

    const double MajorRadius = Declaring.HalfExtentAlong;
    const double MinorRadius = Declaring.MinorRadius;

    for (std::uint32_t Step = 0u; Step <= Radial; ++Step)
    {
        const double AlongFraction = static_cast<double>(Step) / static_cast<double>(Radial);
        const double Azimuth       = Declaring.SweepOffset + AlongFraction * Declaring.SweepRadians;

        const double UnitAlong  = std::cos(Azimuth);
        const double UnitAcross = std::sin(Azimuth);

        for (std::uint32_t Tube = 0u; Tube <= Axial; ++Tube)
        {
            const double AcrossFraction = static_cast<double>(Tube) / static_cast<double>(Axial);
            const double TubeAngle      = AcrossFraction * Turn;

            const double TubeOut = std::cos(TubeAngle);
            const double TubeUp  = std::sin(TubeAngle);

            const double RingRadius = MajorRadius + MinorRadius * TubeOut;

            Generating.Emit(UnitAlong * RingRadius,
                            MinorRadius * TubeUp,
                            UnitAcross * RingRadius,
                            UnitAlong * TubeOut, TubeUp, UnitAcross * TubeOut,
                            AlongFraction, AcrossFraction);
        }
    }

    for (std::uint32_t Step = 0u; Step < Radial; ++Step)
    {
        for (std::uint32_t Tube = 0u; Tube < Axial; ++Tube)
        {
            const std::uint32_t NearLower = Step * Stride + Tube;
            const std::uint32_t NearUpper = NearLower + 1u;
            const std::uint32_t FarLower  = NearLower + Stride;
            const std::uint32_t FarUpper  = FarLower + 1u;

            Generating.EmitFace(NearLower, FarLower, FarUpper, NearUpper);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE PLANE
//------------------------------------------------------------------------------------------------------------------------

void GeneratePlane(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating)
{
    const std::uint32_t Along  = Declaring.RadialCount;
    const std::uint32_t Across = Declaring.AxialCount;
    const std::uint32_t Stride = Along + 1u;

    for (std::uint32_t AcrossStep = 0u; AcrossStep <= Across; ++AcrossStep)
    {
        const double AcrossFraction = static_cast<double>(AcrossStep) / static_cast<double>(Across);

        for (std::uint32_t AlongStep = 0u; AlongStep <= Along; ++AlongStep)
        {
            const double AlongFraction = static_cast<double>(AlongStep) / static_cast<double>(Along);

            Generating.Emit((AlongFraction  * 2.0 - 1.0) * Declaring.HalfExtentAlong,
                            0.0,
                            (AcrossFraction * 2.0 - 1.0) * Declaring.HalfExtentAcross,
                            0.0, 1.0, 0.0,
                            AlongFraction, AcrossFraction);
        }
    }

    for (std::uint32_t AcrossStep = 0u; AcrossStep < Across; ++AcrossStep)
    {
        for (std::uint32_t AlongStep = 0u; AlongStep < Along; ++AlongStep)
        {
            const std::uint32_t NearLower = AcrossStep * Stride + AlongStep;
            const std::uint32_t NearUpper = NearLower + 1u;
            const std::uint32_t FarLower  = NearLower + Stride;
            const std::uint32_t FarUpper  = FarLower + 1u;

            Generating.EmitFace(NearLower, FarLower, FarUpper, NearUpper);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE ANNULAR SECTOR
//------------------------------------------------------------------------------------------------------------------------

// 🔴 A flat band and not a tube — `78` §4's rotation grips are this. A tube of the same radius reads as a ring the
//    artist can grab from any direction, and the grip's plane is then invisible at exactly the orientation where
//    knowing it matters. The band is double-sided by construction because a flat surface seen from behind is not
//    a surface the artist stopped being able to grab.
void GenerateAnnularSector(const PrimitiveSpecification& Declaring, GeneratedSurface& Generating)
{
    const std::uint32_t Radial = Declaring.RadialCount;
    const std::uint32_t Stride = 2u;

    const double InnerRadius = Declaring.HalfExtentAlong - Declaring.MinorRadius;
    const double OuterRadius = Declaring.HalfExtentAlong + Declaring.MinorRadius;

    for (std::uint32_t Step = 0u; Step <= Radial; ++Step)
    {
        const double AlongFraction = static_cast<double>(Step) / static_cast<double>(Radial);
        const double Azimuth       = Declaring.SweepOffset + AlongFraction * Declaring.SweepRadians;

        const double UnitAlong  = std::cos(Azimuth);
        const double UnitAcross = std::sin(Azimuth);

        Generating.Emit(UnitAlong * InnerRadius, 0.0, UnitAcross * InnerRadius,
                        0.0, 1.0, 0.0, AlongFraction, 0.0);

        Generating.Emit(UnitAlong * OuterRadius, 0.0, UnitAcross * OuterRadius,
                        0.0, 1.0, 0.0, AlongFraction, 1.0);
    }

    for (std::uint32_t Step = 0u; Step < Radial; ++Step)
    {
        const std::uint32_t NearInner = Step * Stride;
        const std::uint32_t NearOuter = NearInner + 1u;
        const std::uint32_t FarInner  = NearInner + Stride;
        const std::uint32_t FarOuter  = FarInner + 1u;

        Generating.EmitFace(NearInner, NearOuter, FarOuter, FarInner);
    }
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE GENERATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> GeneratePrimitive(const PrimitiveSpecification& Declaring, TopologyStructure& Generated)
{
    if (!PrimitiveGenerable(Declaring))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the declared parameters generate no surface" });
    }

    if (Generated.Sealed())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "the topology is sealed and admits no declaration" });
    }

    GeneratedSurface Generating;

    switch (Declaring.Generated)
    {
        case PrimitiveSubject::Box:           GenerateBox(Declaring, Generating);              break;
        case PrimitiveSubject::Sphere:        GenerateSphere(Declaring, Generating);           break;
        case PrimitiveSubject::Cylinder:      GenerateRevolution(Declaring, Generating, 1.0);  break;
        case PrimitiveSubject::Cone:          GenerateRevolution(Declaring, Generating, 0.0);  break;
        case PrimitiveSubject::Torus:         GenerateTorus(Declaring, Generating);            break;
        case PrimitiveSubject::Plane:         GeneratePlane(Declaring, Generating);            break;
        case PrimitiveSubject::AnnularSector: GenerateAnnularSector(Declaring, Generating);    break;

        default:
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "the declared subject names no generation" });
    }

    const Deliver<bool> Placed = Generated.DeclarePositions(Generating.Positions);

    if (!Placed.ContentPresent)
    {
        return Placed;
    }

    for (const std::vector<std::uint32_t>& Declared : Generating.Faces)
    {
        const Deliver<bool> Faced = Generated.DeclareFace(Declared);

        if (!Faced.ContentPresent)
        {
            return Faced;
        }
    }

    // 🔴 The coordinates are declared per **corner** and the generation produced one per vertex, so the run is
    //    expanded through the corner ordering here. Handing the per-vertex run straight over would be a count
    //    that agrees with the vertices and disagrees with the corners, and `TopologyStructure` refuses exactly
    //    that — but the refusal would name the count rather than the expansion that was omitted.
    std::vector<DomainCoordinate> PerCorner;
    PerCorner.reserve(static_cast<std::size_t>(Generated.CornerCount()));

    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < Generated.CornerCount(); ++CornerOrdinal)
    {
        PerCorner.push_back(Generating.Coordinates[Generated.CornerVertex(CornerOrdinal)]);
    }

    const Deliver<bool> Addressed = Generated.DeclareCoordinates(PerCorner);

    if (!Addressed.ContentPresent)
    {
        return Addressed;
    }

    const Deliver<bool> Faced = Generated.DeclarePerpendiculars(Generating.Perpendiculars);

    if (!Faced.ContentPresent)
    {
        return Faced;
    }

    return Generated.Seal();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE EXTENT
//------------------------------------------------------------------------------------------------------------------------

void ProjectPrimitiveExtent(const PrimitiveSpecification& Declaring,
                            DocumentPosition&             Least,
                            DocumentPosition&             Greatest)
{
    double HalfAlong  = Declaring.HalfExtentAlong;
    double HalfUp     = Declaring.HalfExtentUp;
    double HalfAcross = Declaring.HalfExtentAcross;

    // 📝 The torus and the sector are the two entries whose occupied extent is not the three half-extents. Both
    //    reach the major radius plus the minor one outward and only the minor one upward, and assuming otherwise
    //    frames a camera on an extent nearly twice what is there.
    if (Declaring.Generated == PrimitiveSubject::Torus)
    {
        HalfAlong  = Declaring.HalfExtentAlong + Declaring.MinorRadius;
        HalfAcross = Declaring.HalfExtentAlong + Declaring.MinorRadius;
        HalfUp     = Declaring.MinorRadius;
    }
    else if (Declaring.Generated == PrimitiveSubject::AnnularSector)
    {
        HalfAlong  = Declaring.HalfExtentAlong + Declaring.MinorRadius;
        HalfAcross = Declaring.HalfExtentAlong + Declaring.MinorRadius;
        HalfUp     = 0.0;
    }
    else if (Declaring.Generated == PrimitiveSubject::Plane)
    {
        HalfUp = 0.0;
    }

    Least.PositionX    = -HalfAlong;
    Least.PositionY    = -HalfUp;
    Least.PositionZ    = -HalfAcross;

    Greatest.PositionX =  HalfAlong;
    Greatest.PositionY =  HalfUp;
    Greatest.PositionZ =  HalfAcross;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE DECLARATIONS
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> PrimitiveIndex::Declare(const PrimitiveSpecification& Declaring)
{
    if (!PrimitiveGenerable(Declaring))
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "the declared parameters generate no surface" });
    }

    ++RevisionIssued;

    HeldPrimitive Holding;
    Holding.Declared         = Declaring;
    Holding.DeclaredRevision = RevisionIssued;
    Holding.SlotOccupied     = true;

    if (!ReleasedOrdinals.empty())
    {
        const std::uint32_t Reused = ReleasedOrdinals.back();

        ReleasedOrdinals.pop_back();
        Primitives[Reused] = Holding;
        ++OccupiedCount;

        return Deliver<std::uint32_t>::Deliver(Reused);
    }

    if (Primitives.size() >= static_cast<std::size_t>(PrimitiveCeiling))
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "the declared primitive ceiling is reached" });
    }

    const std::uint32_t Issued = static_cast<std::uint32_t>(Primitives.size());

    Primitives.push_back(Holding);
    ++OccupiedCount;

    return Deliver<std::uint32_t>::Deliver(Issued);
}

Deliver<bool> PrimitiveIndex::Amend(std::uint32_t PrimitiveOrdinal, const PrimitiveSpecification& Amending)
{
    if (PrimitiveOrdinal >= Primitives.size() || !Primitives[PrimitiveOrdinal].SlotOccupied)
    {
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no primitive is declared at that ordinal" });
    }

    if (!PrimitiveGenerable(Amending))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the amended parameters generate no surface" });
    }

    HeldPrimitive&                Holding  = Primitives[PrimitiveOrdinal];
    const PrimitiveSpecification& Standing = Holding.Declared;

    const bool SurfaceDiffers = Standing.Generated        != Amending.Generated
                             || Standing.HalfExtentAlong  != Amending.HalfExtentAlong
                             || Standing.HalfExtentUp     != Amending.HalfExtentUp
                             || Standing.HalfExtentAcross != Amending.HalfExtentAcross
                             || Standing.MinorRadius      != Amending.MinorRadius
                             || Standing.SweepRadians     != Amending.SweepRadians
                             || Standing.SweepOffset      != Amending.SweepOffset
                             || Standing.RadialCount      != Amending.RadialCount
                             || Standing.AxialCount       != Amending.AxialCount
                             || Standing.CapsDeclared     != Amending.CapsDeclared;

    Holding.Declared = Amending;

    if (SurfaceDiffers)
    {
        ++RevisionIssued;
        Holding.DeclaredRevision = RevisionIssued;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<const PrimitiveSpecification*> PrimitiveIndex::Resolve(std::uint32_t PrimitiveOrdinal) const
{
    if (PrimitiveOrdinal >= Primitives.size() || !Primitives[PrimitiveOrdinal].SlotOccupied)
    {
        return Deliver<const PrimitiveSpecification*>::Refuse(
            { RefusalReason::ContentUnsupported, "no primitive is declared at that ordinal" });
    }

    return Deliver<const PrimitiveSpecification*>::Deliver(&Primitives[PrimitiveOrdinal].Declared);
}

Deliver<bool> PrimitiveIndex::Withdraw(std::uint32_t PrimitiveOrdinal)
{
    if (PrimitiveOrdinal >= Primitives.size() || !Primitives[PrimitiveOrdinal].SlotOccupied)
    {
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no primitive is declared at that ordinal" });
    }

    Primitives[PrimitiveOrdinal].SlotOccupied     = false;
    Primitives[PrimitiveOrdinal].DeclaredRevision = 0u;

    ReleasedOrdinals.push_back(PrimitiveOrdinal);
    --OccupiedCount;

    return Deliver<bool>::Deliver(true);
}

std::uint64_t PrimitiveIndex::Revision(std::uint32_t PrimitiveOrdinal) const
{
    if (PrimitiveOrdinal >= Primitives.size() || !Primitives[PrimitiveOrdinal].SlotOccupied)
    {
        return 0u;
    }

    return Primitives[PrimitiveOrdinal].DeclaredRevision;
}

std::uint32_t PrimitiveIndex::DeclaredCount() const
{
    return OccupiedCount;
}

std::uint32_t PrimitiveIndex::SpannedCount() const
{
    return static_cast<std::uint32_t>(Primitives.size());
}

void PrimitiveIndex::Reclaim()
{
    Primitives.clear();
    ReleasedOrdinals.clear();

    OccupiedCount  = 0u;
    RevisionIssued = 0u;
}

}   // namespace Slate
