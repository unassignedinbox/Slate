//============================================================================================================================================
//                                                            QUADTREADPROOF.CPP
//============================================================================================================================================
// 📦 Gate for the quad tread pipeline: every face a quad, and after Bridge the only open edges are the two lateral rims.

#include "../../../Frontier/Engine/Generators/Tyre/QuadTreadSolver.h"
#include "../../../Frontier/Engine/Generators/Tyre/TreadSpecification.h"
#include "../../../Frontier/Engine/Generators/Tyre/TyreMeshStructure.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

using namespace Frontier;

//------------------------------------------------------------------------------------------------------------------------
//                                                         CASES
//------------------------------------------------------------------------------------------------------------------------

/// 📦 One proof case: a carcass, a pattern, and the quad count the reference page's own audit measured for
///    it. The counts pin the port to the page — if the C++ builder subdivides differently, the number moves
///    and the gate says so.
/// tag   proof
struct ProofCase
{
    const char*            Name;
    TreadSpecification     Carcass;
    QuadTreadSpecification Pattern;
    uint32_t               ExpectedQuads;   // [-]  - measured by the JavaScript audit of QuadTreadModelling.html
};

static std::vector<ProofCase> MakeCases()
{
    TreadSpecification Base;              // 245/40 R18, tread fraction 0.88 — the page's defaults
    Base.Width = 245.0f; Base.Aspect = 40.0f; Base.Rim = 18.0f;
    Base.TreadDepth = 8.0f; Base.TreadFraction = 0.88f; Base.Crown = 3.0f;

    QuadTreadSpecification Street;        // the page's Street preset, its defaults verbatim

    QuadTreadSpecification Sport = Street;
    Sport.PitchCount = 56; Sport.GapFraction = 0.24f; Sport.ChevronAngle = 55; Sport.RibWidth = 44;
    Sport.GrooveWidth = 11; Sport.CentreWidth = 0; Sport.SipeCount = 0;
    Sport.ShoulderLength = 18; Sport.ShoulderDrop = 5;
    TreadSpecification SportCarcass = Base;
    SportCarcass.TreadDepth = 7.0f; SportCarcass.Crown = 2.0f;

    QuadTreadSpecification Winter = Street;
    Winter.PitchCount = 72; Winter.GapFraction = 0.34f; Winter.ChevronAngle = 30; Winter.RibWidth = 22;
    Winter.GrooveWidth = 7; Winter.CentreWidth = 6; Winter.SipeCount = 3; Winter.SipeWidth = 1.4f;
    Winter.SipeDepthFraction = 0.7f; Winter.ShoulderLength = 12; Winter.ShoulderDrop = 4;
    TreadSpecification WinterCarcass = Base;
    WinterCarcass.TreadDepth = 10.0f; WinterCarcass.Crown = 3.5f;

    QuadTreadSpecification Block = Street;
    Block.PitchCount = 44; Block.GapFraction = 0.40f; Block.ChevronAngle = 12; Block.RibWidth = 0;
    Block.GrooveWidth = 10; Block.CentreWidth = 10; Block.SipeCount = 0;
    Block.ShoulderLength = 10; Block.ShoulderDrop = 3;
    TreadSpecification BlockCarcass = Base;
    BlockCarcass.TreadDepth = 11.0f; BlockCarcass.Crown = 2.0f;

    QuadTreadSpecification Bare = Street;  // no rib, no grooves, no chevron, no sipes: pure block and gap
    Bare.RibWidth = 0; Bare.CentreWidth = 0; Bare.GrooveWidth = 0; Bare.ChevronAngle = 0; Bare.SipeCount = 0;

    QuadTreadSpecification Dense = Street; // every limit at once
    Dense.SipeCount = 3; Dense.SipeWidth = 3.0f; Dense.SipeDepthFraction = 1.0f;
    Dense.ChevronAngle = 65; Dense.GapFraction = 0.55f; Dense.PitchCount = 110;

    QuadTreadSpecification Narrow = Street;
    Narrow.PitchCount = 24; Narrow.GapFraction = 0.1f;
    TreadSpecification NarrowCarcass = Base;
    NarrowCarcass.Width = 145.0f; NarrowCarcass.Aspect = 80.0f; NarrowCarcass.Rim = 13.0f;

    return {
        { "street",   Base,          Street,  40448u },
        { "sport",    SportCarcass,  Sport,   23520u },
        { "winter",   WinterCarcass, Winter,  88992u },
        { "block",    BlockCarcass,  Block,   22352u },
        { "bare",     Base,          Bare,    24064u },
        { "dense",    Base,          Dense,  107800u },
        { "narrow",   NarrowCarcass, Narrow,  18384u },
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      EDGE LEDGER
//------------------------------------------------------------------------------------------------------------------------

/// 📦 Boundary edges split into the two legitimate rim openings and everything else.
/// note  ⚠️ Classified by position, never guessed: an edge is a rim edge only if both endpoints sit on a
///       tread edge, |X| within 0.02 mm of the half width. A seam the bridging missed sits anywhere else
///       and lands in Stray.
/// tag   proof
struct BoundaryLedger
{
    uint32_t Rim   = 0u;   // [-]  - boundary edges on the two lateral rims, expected and open by design
    uint32_t Stray = 0u;   // [-]  - boundary edges anywhere else: a crack
};

static BoundaryLedger AuditBoundary(const TyreMeshStructure& Mesh, float HalfWidth)
{
    const std::vector<uint32_t>&           Indices   = Mesh.QueryIndices();
    const std::vector<TyrePositionRecord>& Positions = Mesh.QueryPositions();

    std::map<std::pair<uint32_t, uint32_t>, uint32_t> Ledger;
    for (size_t Corner = 0; Corner + 2 < Indices.size(); Corner += 3)
    {
        const uint32_t Triangle[3] = { Indices[Corner], Indices[Corner + 1], Indices[Corner + 2] };
        for (int Side = 0; Side < 3; ++Side)
        {
            const uint32_t A = Triangle[Side];
            const uint32_t B = Triangle[(Side + 1) % 3];
            ++Ledger[{ std::min(A, B), std::max(A, B) }];
        }
    }

    BoundaryLedger Result;
    for (const auto& [Edge, Uses] : Ledger)
    {
        if (Uses != 1u)
            continue;
        const TyrePositionRecord& P = Positions[Edge.first];
        const TyrePositionRecord& Q = Positions[Edge.second];
        const bool OnRim = std::fabs(std::fabs(P.X) - HalfWidth) < 0.02f
                        && std::fabs(std::fabs(Q.X) - HalfWidth) < 0.02f;
        (OnRim ? Result.Rim : Result.Stray) += 1u;
    }
    return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         GATE
//------------------------------------------------------------------------------------------------------------------------

int main()
{
    int Failures = 0;
    const auto Require = [&Failures](bool Condition, const char* What)
    {
        if (!Condition)
        {
            std::printf("  ❌ %s\n", What);
            ++Failures;
        }
    };

    std::printf("QuadTreadProof — trace, align, array, bridge\n");
    std::printf("%-8s %10s %10s %8s %8s %8s %6s %6s\n",
                "case", "quads", "expected", "rim", "stray", "nonmani", "degen", "loose");

    for (const ProofCase& Case : MakeCases())
    {
        TyreMeshStructure Mesh;
        const QuadTreadMetrics Built = SolveQuadTread(Case.Carcass, Case.Pattern, QuadTreadStage::Bridge, Mesh);
        const TyreMeshMetrics  Audit = Mesh.QueryMetrics();
        const float HalfWidth = Case.Carcass.Width * Case.Carcass.TreadFraction * 0.5f;
        const BoundaryLedger Boundary = AuditBoundary(Mesh, HalfWidth);
        const uint32_t Quads = Built.TileQuad + Built.BridgeQuad;

        std::printf("%-8s %10u %10u %8u %8u %8u %6u %6u\n",
                    Case.Name, Quads, Case.ExpectedQuads, Boundary.Rim, Boundary.Stray,
                    Audit.NonManifoldEdge, Audit.DegenerateCount, Audit.LooseTriangle);

        // ① the port is pinned to the page: the same tile must produce the same quads
        Require(Quads == Case.ExpectedQuads,             "quad count moved away from the reference audit");
        // ② every face is a quad — the topology claim, measured rather than asserted
        Require(Audit.LooseTriangle == 0u,               "a face was recorded as a loose triangle");
        Require(Audit.QuadCount * 2u == Audit.TriangleCount, "triangle count is not twice the quad count");
        // ③ watertight after Bridge: the only boundary edges are the two lateral rims
        Require(Boundary.Stray == 0u,                    "boundary edges off the rims: the bridging leaked");
        Require(Boundary.Rim > 0u,                       "no rim openings found, the classifier is blind");
        Require(Audit.NonManifoldEdge == 0u,             "non-manifold edges");
        Require(Audit.DegenerateCount == 0u,             "degenerate triangles");
        Require(Audit.DuplicateCount == 0u,              "duplicate faces");
    }

    // ④ the negative control. Stop before Bridge and the gaps must read as open seams — thousands of
    //    boundary edges away from the rims. A ledger that answered "clean" here would pass the positive
    //    cases above while being blind to the exact defect they exist to catch.
    {
        const ProofCase Control = MakeCases().front();
        TyreMeshStructure Mesh;
        (void)SolveQuadTread(Control.Carcass, Control.Pattern, QuadTreadStage::Array, Mesh);
        const float HalfWidth = Control.Carcass.Width * Control.Carcass.TreadFraction * 0.5f;
        const BoundaryLedger Boundary = AuditBoundary(Mesh, HalfWidth);
        std::printf("control  %10s %10s %8u %8u   (Array, bridging withheld — strays must appear)\n",
                    "-", "-", Boundary.Rim, Boundary.Stray);
        Require(Boundary.Stray > 1000u, "withholding the bridge did not open seams; the stray classifier proves nothing");
    }

    // ⑤ the stages are one pipeline: Trace and Align must carry identical topology, Array must carry one
    //    tile's tile-quads times the pitch count.
    {
        const ProofCase Street = MakeCases().front();
        TyreMeshStructure Scratch;
        const QuadTreadMetrics Trace = SolveQuadTread(Street.Carcass, Street.Pattern, QuadTreadStage::Trace, Scratch);
        const QuadTreadMetrics Align = SolveQuadTread(Street.Carcass, Street.Pattern, QuadTreadStage::Align, Scratch);
        const QuadTreadMetrics Array = SolveQuadTread(Street.Carcass, Street.Pattern, QuadTreadStage::Array, Scratch);
        Require(Trace.TileQuad == Align.TileQuad,  "Align changed the tile's topology; it may only bend it");
        Require(Trace.BridgeQuad == 0u && Align.BridgeQuad == 0u && Array.BridgeQuad == 0u,
                "bridge quads appeared before the Bridge stage");
        Require(Array.TileQuad == Trace.TileQuad * uint32_t(Street.Pattern.PitchCount),
                "Array is not the tile repeated verbatim");
    }

    if (Failures == 0)
        std::printf("✅ gate clean: 100%% quads, watertight after Bridge, rims the only openings\n");
    else
        std::printf("❌ %d failures\n", Failures);
    return Failures == 0 ? 0 : 1;
}
