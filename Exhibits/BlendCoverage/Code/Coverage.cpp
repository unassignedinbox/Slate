// Blend coverage probe: for every edge of a set of canonical solids, try a chamfer
// and a fillet and record accept / refuse. Classifies each edge by its adjacent
// surface pair so the result is a matrix, not an anecdote.
#include "Kernel/BlendSolver.h"
#include "Kernel/IntersectionSolver.h"
#include "Kernel/SurfaceSpecification.h"
#include "Kernel/TopologySpecification.h"

#include <chrono>
#include <cstdio>
#include <map>
#include <set>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{
    const char* Name(SurfaceClassification C) noexcept
    {
        switch (C)
        {
            case SurfaceClassification::Plane:      return "Plane";
            case SurfaceClassification::Cylinder:   return "Cylinder";
            case SurfaceClassification::Cone:       return "Cone";
            case SurfaceClassification::Sphere:     return "Sphere";
            case SurfaceClassification::Torus:      return "Torus";
            case SurfaceClassification::Extrusion:  return "Extrusion";
            case SurfaceClassification::Revolution: return "Revolution";
            case SurfaceClassification::Ruled:      return "Ruled";
            case SurfaceClassification::Loft:       return "Loft";
            case SurfaceClassification::Sweep:      return "Sweep";
            case SurfaceClassification::Coons:      return "Coons";
            case SurfaceClassification::FairPatch:  return "FairPatch";
            default:                                return "Freeform";
        }
    }

    // Canonical, order-independent label for the two faces meeting at an edge.
    std::string PairLabel(const BrepBody& B, int Edge) noexcept
    {
        const BrepEdge& E = B.Edges[Edge];
        std::vector<std::string> Names;
        for (int C : E.Coedges)
        {
            int F = B.Coedges[C].Face;
            if (F >= 0 && F < (int)B.Faces.size())
                Names.push_back(Name(B.Faces[F].Surface.Classification));
        }
        std::set<std::string> Unique(Names.begin(), Names.end());
        std::string Out;
        for (const std::string& S : Unique) { if (!Out.empty()) Out += "+"; Out += S; }
        return Out;
    }

    struct Tally
    {
        int Accept = 0;
        int Refuse = 0;
        std::map<std::string, int> Reasons;
    };

    Tally& Slot(std::map<std::string, Tally>& M, const std::string& K) { return M[K]; }

    void Probe(const char* Shape, const BrepBody& Body, double Size,
               std::map<std::string, Tally>& Chamfers, std::map<std::string, Tally>& Fillets) noexcept;

    void Probe(const char* Shape, const Deliver<BrepBody>& Delivered, double Size,
               std::map<std::string, Tally>& Chamfers, std::map<std::string, Tally>& Fillets) noexcept
    {
        if (!Delivered) { std::printf("  %-22s  (construction refused: %s)\n", Shape, Delivered.Denial.Detail); return; }
        Probe(Shape, Delivered.Payload, Size, Chamfers, Fillets);
    }

    void Probe(const char* Shape, const BrepBody& Body, double Size,
               std::map<std::string, Tally>& Chamfers, std::map<std::string, Tally>& Fillets) noexcept
    {
        if (!Body.Validate().Solid()) { std::printf("  %-22s  (not a valid solid — skipped)\n", Shape); return; }
        auto ShapeStart = std::chrono::steady_clock::now();
        for (int E = 0; E < (int)Body.Edges.size(); ++E)
        {
            const std::string Pair = PairLabel(Body, E);
            if (Body.Edges[E].Coedges.size() != 2) continue;      // seam / non-manifold

            {
                Deliver<BrepBody> R = BlendSolver::ChamferEdge(Body, E, Size);
                Tally& T = Slot(Chamfers, Pair);
                if (R) ++T.Accept; else { ++T.Refuse; T.Reasons[R.Denial.Detail]++; }
            }
            {
                Deliver<BrepBody> R = BlendSolver::FilletEdge(Body, E, Size);
                Tally& T = Slot(Fillets, Pair);
                if (R) ++T.Accept; else { ++T.Refuse; T.Reasons[R.Denial.Detail]++; }
            }
        }
        const double ShapeMs = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - ShapeStart).count();
        std::printf("  %-22s  edges=%d  (%.1f ms)\n", Shape, (int)Body.Edges.size(), ShapeMs);
        std::fflush(stdout);
    }

    void Report(const char* Title, const std::map<std::string, Tally>& M) noexcept
    {
        std::printf("\n=== %s ===\n", Title);
        std::printf("%-26s %7s %7s  %s\n", "adjacent surface pair", "accept", "refuse", "dominant refusal");
        int TotalAccept = 0, TotalRefuse = 0;
        for (const auto& [Pair, T] : M)
        {
            std::string Top; int Best = 0;
            for (const auto& [Why, N] : T.Reasons) if (N > Best) { Best = N; Top = Why; }
            if (Top.size() > 62) Top = Top.substr(0, 59) + "...";
            std::printf("%-26s %7d %7d  %s\n", Pair.c_str(), T.Accept, T.Refuse, Top.c_str());
            TotalAccept += T.Accept; TotalRefuse += T.Refuse;
        }
        std::printf("%-26s %7d %7d  (%.1f%% accepted)\n", "TOTAL", TotalAccept, TotalRefuse,
                    100.0 * TotalAccept / double(TotalAccept + TotalRefuse));
    }
}

int main() noexcept
{
    std::map<std::string, Tally> Chamfers, Fillets;
    const double Size = 0.004;                                   // 4 mm: deliberately small so it should fit

    std::printf("Probing chamfer + fillet on every 2-coedge edge (size = %g m)\n", Size);

    Probe("Box",                 BrepBody::Box({ 0, 0, 0 }, { 0.1, 0.08, 0.06 }), Size, Chamfers, Fillets);
    Probe("Cylinder",            BrepBody::Cylinder({ 0, 0, 0 }, Vec3::UnitZ(), 0.04, 0.1), Size, Chamfers, Fillets);
    Probe("Cone",                BrepBody::Cone({ 0, 0, 0 }, Vec3::UnitZ(), 0.05, 0.02, 0.1), Size, Chamfers, Fillets);
    Probe("Sphere",              BrepBody::Sphere({ 0, 0, 0 }, 0.05), Size, Chamfers, Fillets);
    Probe("Torus",               BrepBody::Torus({ 0, 0, 0 }, Vec3::UnitZ(), 0.05, 0.015), Size, Chamfers, Fillets);

    // Rounded-rectangle extrusion: Plane+Plane convex corners and Plane+Cylinder tangencies.
    {
        std::vector<Vec3> Pts;
        for (double A = 0; A < 6.283185307179586; A += 0.39269908169872414)
            Pts.push_back(Vec3{ 0.04 * std::cos(A), 0.03 * std::sin(A), 0.0 });
        Deliver<NurbsCurve> Loop = NurbsCurve::Interpolate(Pts, 3);
        if (Loop) Probe("Extrude(circle)", BrepBody::Extrude(Loop.Payload, Vec3::UnitZ(), 0.05), Size, Chamfers, Fillets);
    }

    // Box with a through cylinder removed: concave Plane+Cylinder junctions.
    {
        Deliver<BrepBody> BlockD = BrepBody::Box({ 0, 0, 0 }, { 0.1, 0.1, 0.06 });
        Deliver<BrepBody> BoreD  = BrepBody::Cylinder({ 0.05, 0.05, -0.01 }, Vec3::UnitZ(), 0.02, 0.08);
        if (!BlockD || !BoreD) { std::printf("  %-22s  (primitive refused)\n", "Box-Cylinder(bore)"); }
        else {
            Deliver<BrepBody> Cut = IntersectionSolver::Combine(BlockD.Payload, BoreD.Payload, BodyOperation::Subtract);
            if (Cut) Probe("Box-Cylinder(bore)", Cut.Payload, Size, Chamfers, Fillets);
            else std::printf("  %-22s  (boolean refused: %s)\n", "Box-Cylinder(bore)", Cut.Denial.Detail);
        }
    }

#if 0
    // Sphere fused to a box: the case the optional OCCT worker is special-cased for.
    {
        Deliver<BrepBody> BlockD = BrepBody::Box({ 0, 0, 0 }, { 0.1, 0.1, 0.05 });
        Deliver<BrepBody> BallD  = BrepBody::Sphere({ 0.05, 0.05, 0.05 }, 0.03);
        if (!BlockD || !BallD) { std::printf("  %-22s  (primitive refused)\n", "Box+Sphere(union)"); }
        else {
            Deliver<BrepBody> Joined = IntersectionSolver::Combine(BlockD.Payload, BallD.Payload, BodyOperation::Union);
            if (Joined) Probe("Box+Sphere(union)", Joined.Payload, Size, Chamfers, Fillets);
            else std::printf("  %-22s  (boolean refused: %s)\n", "Box+Sphere(union)", Joined.Denial.Detail);
        }
    }

    // Free-form loft: Plane + Loft, and Loft + Loft.
    {
        std::vector<NurbsCurve> Sections;
        for (int I = 0; I < 4; ++I)
        {
            const double Z = 0.02 * I, R = 0.03 + 0.008 * I;
            std::vector<Vec3> Ring;
            for (int K = 0; K < 12; ++K)
            {
                const double A = 6.283185307179586 * K / 12.0;
                Ring.push_back(Vec3{ R * std::cos(A), R * std::sin(A), Z });
            }
            Deliver<NurbsCurve> C = NurbsCurve::Interpolate(Ring, 3);
            if (C) Sections.push_back(C.Payload);
        }
        if (Sections.size() == 4)
        {
            Deliver<NurbsSurface> Skin = NurbsSurface::Loft(Sections, 3);
            if (Skin)
            {
                std::vector<NurbsSurface> Walls{ Skin.Payload };
                Deliver<BrepBody> Body = BrepBody::Sew(Walls, ScalarCriteria::MergeTolerance, true);
                if (Body) Probe("Loft(capped)", Body.Payload, Size, Chamfers, Fillets);
            }
        }
    }

#endif
    Report("CHAMFER by adjacent surface pair", Chamfers);
    Report("FILLET by adjacent surface pair", Fillets);
    return 0;
}
