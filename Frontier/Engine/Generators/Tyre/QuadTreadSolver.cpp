//============================================================================================================================================
//                                                           QUADTREADSOLVER.CPP
//============================================================================================================================================
// 📦 The quad tread pipeline: trace one tile with a conforming quad grid, align, array, bridge. Port of References/QuadTreadModelling.html.

#include "QuadTreadSolver.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace Frontier {

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                      SMALL VECTORS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Geometry is derived in double throughout, exactly as the reference page computes it in JavaScript
//    numbers, and drops to float only at the weld. Two emitters that reach the same corner reach it through
//    the same double expressions, so they agree bitwise and the weld is never asked to paper over drift.
struct Vec3
{
    double X = 0.0, Y = 0.0, Z = 0.0;
};

[[nodiscard]] Vec3   Subtract(const Vec3& A, const Vec3& B) noexcept { return { A.X - B.X, A.Y - B.Y, A.Z - B.Z }; }
[[nodiscard]] double Dot(const Vec3& A, const Vec3& B) noexcept      { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
[[nodiscard]] Vec3   Cross(const Vec3& A, const Vec3& B) noexcept
{
    return { A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X };
}
[[nodiscard]] Vec3 Normalised(const Vec3& A) noexcept
{
    const double Length = std::sqrt(Dot(A, A));
    return Length > 0.0 ? Vec3{ A.X / Length, A.Y / Length, A.Z / Length } : Vec3{ 0.0, 1.0, 0.0 };
}

constexpr double π = 3.14159265358979323846;

//------------------------------------------------------------------------------------------------------------------------
//                                                      TILE LAYOUT
//------------------------------------------------------------------------------------------------------------------------

/// 📦 What a lateral interval of the grid is. The region decides the depth a band of it sits at.
enum class Region : uint8_t { CentreGroove, Rib, Groove, Lug };

/// 📦 What a circumferential interval of the grid is. Block is rubber, Sipe is a thin cut inside the tile,
///    Gap is the spacing between tiles that the Bridge step closes.
enum class Band : uint8_t { Block, Sipe, Gap };

//------------------------------------------------------------------------------------------------------------------------
//                                                        BUILDER
//------------------------------------------------------------------------------------------------------------------------

/// 📦 One solve, all state in one place. Methods mirror the functions of the reference page by name.
struct QuadTreadBuilder
{
    const TreadSpecification&     Carcass;
    const QuadTreadSpecification& Pattern;
    QuadTreadStage                Stage;
    TyreMeshStructure&            Mesh;
    QuadTreadMetrics              Metrics;

    // ---- derived, mirrors derive() ------------------------------------------------------------------------
    double HalfWidth     = 0.0;   // [mm]  - half the patterned band, Width × TreadFraction / 2
    double OuterRadius   = 0.0;   // [mm]  - crown apex radius
    double Circumference = 0.0;   // [mm]  - 2π at the apex, the pattern's periodic length
    double Pitch         = 0.0;   // [mm]  - one tile, Circumference / PitchCount — exact fit by construction
    double GapLength     = 0.0;   // [mm]  - the bridged spacing between tiles
    double BlockLength   = 0.0;   // [mm]  - the tile's own length
    double CentreHalf    = 0.0;   // [mm]  - centre groove half width
    double RibOuter      = 0.0;   // [mm]  - rib outer edge, also where the chevron shear starts
    double GrooveOuter   = 0.0;   // [mm]  - circumferential groove outer edge
    double ShoulderLen   = 0.0;   // [mm]  - roundover reach, clamped into the lug
    double ShearSlope    = 0.0;   // [-]   - tan of the chevron angle
    double SipeDepth     = 0.0;   // [mm]  - sipe floor below the tread surface
    int    SipeTally     = 0;     // [-]   - rounded sipe count

    // ---- the grid ------------------------------------------------------------------------------------------
    std::vector<double> Columns;        // [mm]  - lateral stations, sitting exactly on the feature edges
    std::vector<Region> ColumnRegion;   // [-]   - region of the interval after each station
    std::vector<double> Rows;           // [mm]  - circumferential stations over one pitch
    std::vector<Band>   RowBand;        // [-]   - band of the interval after each station

    bool Flat       = false;   // [-]  - Trace stage: the tile stays in the plane
    bool WithBridge = false;   // [-]  - Bridge stage: gap cells and gap walls are emitted
    uint32_t Tiles  = 1u;      // [-]  - tiles for the requested stage

    QuadTreadBuilder(const TreadSpecification&     CarcassIn,
                     const QuadTreadSpecification& PatternIn,
                     QuadTreadStage                StageIn,
                     TyreMeshStructure&            MeshIn) noexcept
        : Carcass(CarcassIn), Pattern(PatternIn), Stage(StageIn), Mesh(MeshIn)
    {
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                     DERIVATION
    //------------------------------------------------------------------------------------------------------------------------

    void Derive() noexcept
    {
        HalfWidth     = double(Carcass.Width) * double(Carcass.TreadFraction) / 2.0;
        OuterRadius   = double(Carcass.Rim) * 25.4 / 2.0 + double(Carcass.Width) * double(Carcass.Aspect) / 100.0;
        Circumference = 2.0 * π * OuterRadius;
        Pitch         = Circumference / double(Pattern.PitchCount);
        GapLength     = std::min(std::max(double(Pattern.GapFraction) * Pitch, 2.0), Pitch - 4.0);
        BlockLength   = Pitch - GapLength;
        CentreHalf    = std::min(double(Pattern.CentreWidth) / 2.0, HalfWidth * 0.2);
        RibOuter      = std::min(CentreHalf + double(Pattern.RibWidth) / 2.0, HalfWidth * 0.55);
        GrooveOuter   = std::min(RibOuter + double(Pattern.GrooveWidth), HalfWidth - 6.0);
        ShoulderLen   = std::min(double(Pattern.ShoulderLength), (HalfWidth - GrooveOuter) * 0.8);
        ShearSlope    = std::tan(double(Pattern.ChevronAngle) * π / 180.0);
        SipeDepth     = double(Carcass.TreadDepth) * double(Pattern.SipeDepthFraction);
        SipeTally     = std::max(0, int(std::llround(double(Pattern.SipeCount))));

        Flat       = Stage == QuadTreadStage::Trace;
        WithBridge = Stage == QuadTreadStage::Bridge;
        Tiles      = Stage <= QuadTreadStage::Align ? 1u : uint32_t(Pattern.PitchCount);

        Metrics.PitchLength = float(Pitch);
        Metrics.TileCount   = Tiles;
    }

    /// 📦 Crown bulge plus shoulder roundover: tread-surface radius across the width. Mirrors rTop().
    [[nodiscard]] double SurfaceRadius(double Lateral) const noexcept
    {
        const double A = std::fabs(Lateral);
        double Radius = OuterRadius - double(Carcass.Crown) * (A / HalfWidth) * (A / HalfWidth);
        if (ShoulderLen > 0.5)
        {
            const double T = (A - (HalfWidth - ShoulderLen)) / ShoulderLen;
            if (T > 0.0)
                Radius -= double(Pattern.ShoulderDrop) * T * T;
        }
        return Radius;
    }

    /// 📦 Chevron: every column shifts along the circumference with its distance from the rib edge. The
    ///    shift is per column and identical for every tile, so arrayed tiles stay in phase and the gap
    ///    width never varies. Mirrors shear().
    [[nodiscard]] double Shear(double Lateral) const noexcept
    {
        return -ShearSlope * std::max(0.0, std::fabs(Lateral) - RibOuter);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                     TILE LAYOUT
    //------------------------------------------------------------------------------------------------------------------------

    /// 📦 Lateral stations and interval regions. Grid columns sit ON the feature edges — that is what lets
    ///    quads trace the pattern instead of sampling it. Mirrors buildColumns().
    void BuildColumns() noexcept
    {
        struct Segment { double A, B; Region Kind; int Count; };
        std::vector<Segment> Half;   // from the centre outward

        if (CentreHalf > 0.5)
            Half.push_back({ 0.0, CentreHalf, Region::CentreGroove, 2 });
        if (RibOuter - CentreHalf > 0.5)
            Half.push_back({ CentreHalf, RibOuter, Region::Rib, 3 });
        if (GrooveOuter - RibOuter > 0.5)
            Half.push_back({ RibOuter, GrooveOuter, Region::Groove, 2 });

        const double LugInner = GrooveOuter;
        const double LugOuter = HalfWidth;
        const double FlatRun  = std::max(1.0, LugOuter - LugInner - ShoulderLen);
        Half.push_back({ LugInner, LugOuter - ShoulderLen, Region::Lug,
                         std::max(3, int(std::llround(FlatRun / 5.0))) });
        if (ShoulderLen > 0.5)
            Half.push_back({ LugOuter - ShoulderLen, LugOuter, Region::Lug, 4 });

        Columns.clear();
        ColumnRegion.clear();
        const auto Push = [this](double A, double B, Region Kind, int Count)
        {
            for (int Step = 0; Step < Count; ++Step)
            {
                Columns.push_back(A + (B - A) * double(Step) / double(Count));
                ColumnRegion.push_back(Kind);
            }
        };
        for (size_t Seat = Half.size(); Seat-- > 0u;)
            Push(-Half[Seat].B, -Half[Seat].A, Half[Seat].Kind, Half[Seat].Count);   // mirrored half
        for (const Segment& Seat : Half)
            Push(Seat.A, Seat.B, Seat.Kind, Seat.Count);                             // positive half
        Columns.push_back(HalfWidth);
    }

    /// 📦 Circumferential stations and interval bands over one pitch. Grid rows sit ON the block, sipe and
    ///    gap edges. Mirrors buildRows().
    void BuildRows() noexcept
    {
        const double SipeWidth = std::min(double(Pattern.SipeWidth),
                                          BlockLength / double(SipeTally + 1) * 0.5);
        const double SubBlock  = (BlockLength - double(SipeTally) * SipeWidth) / double(SipeTally + 1);

        struct Strip { Band Kind; double Length; };
        std::vector<Strip> Strips;
        for (int Cut = 0; Cut <= SipeTally; ++Cut)
        {
            Strips.push_back({ Band::Block, SubBlock });
            if (Cut < SipeTally)
                Strips.push_back({ Band::Sipe, SipeWidth });
        }
        Strips.push_back({ Band::Gap, GapLength });

        Rows.clear();
        RowBand.clear();
        double At = 0.0;
        for (const Strip& Piece : Strips)
        {
            const int Count = Piece.Kind == Band::Block ? std::max(2, int(std::llround(Piece.Length / 5.0)))
                            : Piece.Kind == Band::Gap   ? 2
                                                        : 1;
            for (int Step = 0; Step < Count; ++Step)
            {
                Rows.push_back(At + Piece.Length * double(Step) / double(Count));
                RowBand.push_back(Piece.Kind);
            }
            At += Piece.Length;
        }
        Rows.push_back(Pitch);
    }

    /// 📦 Depth below the tread surface for one grid cell — this IS the pattern. Mirrors depthOf().
    [[nodiscard]] double DepthOf(Region Kind, Band Strip) const noexcept
    {
        if (Kind == Region::Rib)
            return 0.0;                                    // rib: continuous ring of rubber
        if (Kind == Region::CentreGroove || Kind == Region::Groove)
            return double(Carcass.TreadDepth);             // circumferential grooves: floor
        if (Strip == Band::Block)
            return 0.0;                                    // lug block top
        if (Strip == Band::Sipe)
            return SipeDepth;                              // sipe floor
        return double(Carcass.TreadDepth);                 // gap: lateral groove floor
    }

    /// 📦 Walls split at the sipe depth whenever it falls strictly inside their span, so every wall edge
    ///    loop lines up with the sipe floors and sipe walls — conforming topology, no T-junctions.
    ///    Mirrors wallSegs().
    [[nodiscard]] std::vector<std::pair<double, double>> WallSegments(double Top, double Bottom) const noexcept
    {
        if (SipeTally > 0 && SipeDepth > Top + 1.0e-6 && SipeDepth < Bottom - 1.0e-6)
            return { { Top, SipeDepth }, { SipeDepth, Bottom } };
        return { { Top, Bottom } };
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                      GEOMETRY
    //------------------------------------------------------------------------------------------------------------------------

    /// 📦 Position of (lateral, circumferential, depth). Flat for Trace, wrapped on the wheel otherwise.
    ///    Mirrors pos().
    [[nodiscard]] Vec3 Position(double Lateral, double Along, double Depth) const noexcept
    {
        const double Sheared = Along + Shear(Lateral);
        if (Flat)
            return { Lateral, -Depth, Sheared - Pitch / 2.0 };
        const double θ      = Sheared / Circumference * 2.0 * π;
        const double Radius = SurfaceRadius(Lateral) - Depth;
        return { Lateral, Radius * std::cos(θ), Radius * std::sin(θ) };
    }

    /// 📦 Smooth analytic normal of the tread surface of revolution, so the crown shades smoothly while
    ///    walls stay hard. Mirrors surfNormal().
    [[nodiscard]] Vec3 SurfaceNormal(double Lateral, double Along) const noexcept
    {
        if (Flat)
            return { 0.0, 1.0, 0.0 };
        const double θ = (Along + Shear(Lateral)) / Circumference * 2.0 * π;
        const double Step = 0.25;
        const double Slope = (SurfaceRadius(Lateral + Step) - SurfaceRadius(Lateral - Step)) / (2.0 * Step);
        return Normalised({ -Slope, std::cos(θ), std::sin(θ) });
    }

    /// 📦 Circumferential tangent, for orienting the block leading and trailing walls. Mirrors tangent().
    [[nodiscard]] Vec3 Tangent(double Lateral, double Along) const noexcept
    {
        if (Flat)
            return { 0.0, 0.0, 1.0 };
        const double θ = (Along + Shear(Lateral)) / Circumference * 2.0 * π;
        return { 0.0, -std::sin(θ), std::cos(θ) };
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                      EMISSION
    //------------------------------------------------------------------------------------------------------------------------

    /// 📦 One quad into the welded pool: corners in ring order, flipped if the geometric normal disagrees
    ///    with the expected facing, recorded as a quad with per-corner shading. Mirrors quad().
    void EmitQuad(const Vec3  Corner[4],
                  const Vec3  Normal[4],
                  const Vec3& Expected,
                  bool        Bridging) noexcept
    {
        const Vec3 Geometric = Cross(Subtract(Corner[1], Corner[0]), Subtract(Corner[3], Corner[0]));
        if (Dot(Geometric, Geometric) < 1.0e-9)
            return;   // degenerate: a region clamped to zero width

        int Ring[4] = { 0, 1, 2, 3 };
        if (Dot(Geometric, Expected) < 0.0)
        {
            Ring[1] = 3;
            Ring[3] = 1;
        }

        uint32_t         Welded[4];
        TyreCornerRecord Attribute[4];
        for (int Seat = 0; Seat < 4; ++Seat)
        {
            const Vec3& P = Corner[Ring[Seat]];
            const Vec3& N = Normal[Ring[Seat]];
            Welded[Seat] = Mesh.WeldPosition(float(P.X), float(P.Y), float(P.Z));
            Attribute[Seat].NormalX = float(N.X);
            Attribute[Seat].NormalY = float(N.Y);
            Attribute[Seat].NormalZ = float(N.Z);
            Attribute[Seat].U       = float(std::atan2(P.Z, P.Y) / (2.0 * π) + 0.5);
            Attribute[Seat].V       = float((P.X + HalfWidth) / (2.0 * HalfWidth));
            Attribute[Seat].Group   = Bridging ? uint16_t(1) : uint16_t(0);
        }
        Mesh.AddQuad(Welded[0], Welded[1], Welded[2], Welded[3],
                     Attribute[0], Attribute[1], Attribute[2], Attribute[3]);
        (Bridging ? Metrics.BridgeQuad : Metrics.TileQuad) += 1u;
    }

    /// 📦 A wall quad: flat-shaded, its one normal taken from the geometry and flipped to face the groove.
    void EmitWall(const Vec3 Corner[4], const Vec3& Expected, bool Bridging) noexcept
    {
        Vec3 Geometric = Cross(Subtract(Corner[1], Corner[0]), Subtract(Corner[3], Corner[0]));
        if (Dot(Geometric, Geometric) < 1.0e-9)
            return;
        if (Dot(Geometric, Expected) < 0.0)
            Geometric = Vec3{ -Geometric.X, -Geometric.Y, -Geometric.Z };
        Geometric = Normalised(Geometric);
        const Vec3 Normal[4] = { Geometric, Geometric, Geometric, Geometric };
        EmitQuad(Corner, Normal, Geometric, Bridging);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                       THE BUILD
    //------------------------------------------------------------------------------------------------------------------------

    void Build() noexcept
    {
        Derive();
        BuildColumns();
        BuildRows();

        const size_t ColumnCount = Columns.size() - 1u;
        const size_t RowCount    = Rows.size() - 1u;

        for (uint32_t Tile = 0; Tile < Tiles; ++Tile)
        {
            const double Base = double(Tile) * Pitch;

            // ---- ① surface cells: block tops, groove floors, sipe floors — the trace of the pattern ---------
            for (size_t Row = 0; Row < RowCount; ++Row)
            {
                const Band Strip = RowBand[Row];
                const bool Bridging = Strip == Band::Gap;
                if (Bridging && !WithBridge)
                    continue;
                const double Y0 = Base + Rows[Row];
                const double Y1 = Base + Rows[Row + 1];
                for (size_t Column = 0; Column < ColumnCount; ++Column)
                {
                    const double Depth = DepthOf(ColumnRegion[Column], Strip);
                    const double X0 = Columns[Column];
                    const double X1 = Columns[Column + 1];
                    const Vec3 Corner[4] = { Position(X0, Y0, Depth), Position(X1, Y0, Depth),
                                             Position(X1, Y1, Depth), Position(X0, Y1, Depth) };
                    const Vec3 Normal[4] = { SurfaceNormal(X0, Y0), SurfaceNormal(X1, Y0),
                                             SurfaceNormal(X1, Y1), SurfaceNormal(X0, Y1) };
                    const Vec3 Expected  = { Normal[0].X + Normal[2].X,
                                             Normal[0].Y + Normal[2].Y,
                                             Normal[0].Z + Normal[2].Z };
                    EmitQuad(Corner, Normal, Expected, Bridging);
                }
            }

            // ---- ② vertical walls: where two lateral regions sit at different depths ------------------------
            for (size_t Column = 1; Column < ColumnCount; ++Column)
            {
                for (size_t Row = 0; Row < RowCount; ++Row)
                {
                    const Band Strip = RowBand[Row];
                    const bool Bridging = Strip == Band::Gap;
                    if (Bridging && !WithBridge)
                        continue;
                    const double Left  = DepthOf(ColumnRegion[Column - 1], Strip);
                    const double Right = DepthOf(ColumnRegion[Column], Strip);
                    if (std::fabs(Left - Right) < 1.0e-6)
                        continue;
                    const double X  = Columns[Column];
                    const double Y0 = Base + Rows[Row];
                    const double Y1 = Base + Rows[Row + 1];
                    const Vec3 Expected = { Left < Right ? 1.0 : -1.0, 0.0, 0.0 };   // faces into the groove
                    for (const auto& [Top, Bottom] : WallSegments(std::min(Left, Right), std::max(Left, Right)))
                    {
                        const Vec3 Corner[4] = { Position(X, Y0, Top),    Position(X, Y1, Top),
                                                 Position(X, Y1, Bottom), Position(X, Y0, Bottom) };
                        EmitWall(Corner, Expected, Bridging);
                    }
                }
            }

            // ---- ③ horizontal walls: block leading and trailing edges, sipe walls — the block outline -------
            for (size_t Row = 0; Row < RowCount; ++Row)
            {
                const Band Before = Row == 0u ? Band::Gap : RowBand[Row - 1];   // before y = 0 lies the previous tile's gap
                const Band After  = RowBand[Row];
                for (size_t Column = 0; Column < ColumnCount; ++Column)
                {
                    const double Previous = DepthOf(ColumnRegion[Column], Before);
                    const double Current  = DepthOf(ColumnRegion[Column], After);
                    if (std::fabs(Previous - Current) < 1.0e-6)
                        continue;
                    const double Y  = Base + Rows[Row];
                    const double X0 = Columns[Column];
                    const double X1 = Columns[Column + 1];
                    const double Facing = Previous < Current ? 1.0 : -1.0;       // faces into the groove
                    const Vec3 Middle = Tangent((X0 + X1) / 2.0, Y);
                    const Vec3 Expected = { Middle.X * Facing, Middle.Y * Facing, Middle.Z * Facing };
                    for (const auto& [Top, Bottom] : WallSegments(std::min(Previous, Current), std::max(Previous, Current)))
                    {
                        const Vec3 Corner[4] = { Position(X0, Y, Top),    Position(X1, Y, Top),
                                                 Position(X1, Y, Bottom), Position(X0, Y, Bottom) };
                        EmitWall(Corner, Expected, false);                       // always tile: it outlines the blocks
                    }
                }
            }

            // ---- ④ optional shoulder skirt: quads hanging off the two outer edges for a closed look ---------
            if (Pattern.Skirt)
            {
                const size_t Edge[2] = { 0u, ColumnCount };
                for (int Side = 0; Side < 2; ++Side)
                {
                    const double X = Columns[Edge[Side]];
                    const Vec3 Expected = { Side == 0 ? -1.0 : 1.0, 0.0, 0.0 };
                    for (size_t Row = 0; Row < RowCount; ++Row)
                    {
                        const Band Strip = RowBand[Row];
                        const bool Bridging = Strip == Band::Gap;
                        if (Bridging && !WithBridge)
                            continue;
                        const double Surface = DepthOf(Region::Lug, Strip);
                        if (Surface >= double(Carcass.TreadDepth) - 1.0e-6)
                            continue;                                            // gap floor is already at skirt depth
                        const double Y0 = Base + Rows[Row];
                        const double Y1 = Base + Rows[Row + 1];
                        for (const auto& [Top, Bottom] : WallSegments(Surface, double(Carcass.TreadDepth)))
                        {
                            const Vec3 Corner[4] = { Position(X, Y0, Top),    Position(X, Y1, Top),
                                                     Position(X, Y1, Bottom), Position(X, Y0, Bottom) };
                            EmitWall(Corner, Expected, Bridging);
                        }
                    }
                }
            }
        }
    }
};

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                         SOLVER
//------------------------------------------------------------------------------------------------------------------------

QuadTreadMetrics SolveQuadTread(const TreadSpecification&     Carcass,
                                const QuadTreadSpecification& Pattern,
                                QuadTreadStage                Stage,
                                TyreMeshStructure&            Mesh) noexcept
{
    Mesh.Clear();
    if (!Carcass.IsValid() || !Pattern.IsValid())
        return {};

    QuadTreadBuilder Builder(Carcass, Pattern, Stage, Mesh);
    Builder.Build();
    return Builder.Metrics;
}

}   // namespace Frontier
