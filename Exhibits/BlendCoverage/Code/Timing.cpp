// Cost probe: how long does one chamfer / fillet take, and how many candidate
// cutter placements does the generic path evaluate?
#include "Kernel/BlendSolver.h"
#include "Kernel/IntersectionSolver.h"
#include "Kernel/TopologySpecification.h"

#include <chrono>
#include <cstdio>
#include <vector>

using namespace Frontier;

namespace
{
    double MillisecondsSince(std::chrono::steady_clock::time_point T0) noexcept
    {
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - T0).count();
    }
}

int main() noexcept
{
    const double Size = 0.004;
    Deliver<BrepBody> BoxD = BrepBody::Box({ 0, 0, 0 }, { 0.1, 0.08, 0.06 });
    if (!BoxD) { std::printf("box refused: %s\n", BoxD.Denial.Detail); return 1; }
    const BrepBody& Box = BoxD.Payload;
    std::printf("Box: %d edges, volume %.9f m^3, solid=%d\n", (int)Box.Edges.size(),
                Box.Validate().Volume, (int)Box.Validate().Solid());

    // Time a chamfer and a fillet on the first few edges.
    for (int E = 0; E < (int)Box.Edges.size() && E < 6; ++E)
    {
        if (Box.Edges[E].Coedges.size() != 2) continue;
        auto T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> C = BlendSolver::ChamferEdge(Box, E, Size);
        const double ChamferMs = MillisecondsSince(T0);

        T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> F = BlendSolver::FilletEdge(Box, E, Size);
        const double FilletMs = MillisecondsSince(T0);

        std::printf("edge %2d  chamfer %9.1f ms  %-8s | fillet %9.1f ms  %-8s\n",
                    E, ChamferMs, C ? "accept" : "refuse", FilletMs, F ? "accept" : "refuse");
        if (!C) std::printf("          chamfer refusal: %s\n", C.Denial.Detail);
        if (!F) std::printf("          fillet  refusal: %s\n", F.Denial.Detail);
        std::fflush(stdout);
    }

    // Same question on a cylinder: the native cap route should be fast.
    Deliver<BrepBody> CylD = BrepBody::Cylinder({ 0, 0, 0 }, Vec3::UnitZ(), 0.04, 0.1);
    if (CylD)
    {
        const BrepBody& Cyl = CylD.Payload;
        std::printf("\nCylinder: %d edges\n", (int)Cyl.Edges.size());
        for (int E = 0; E < (int)Cyl.Edges.size() && E < 4; ++E)
        {
            if (Cyl.Edges[E].Coedges.size() != 2) continue;
            auto T0 = std::chrono::steady_clock::now();
            Deliver<BrepBody> C = BlendSolver::ChamferEdge(Cyl, E, Size);
            const double Ms = MillisecondsSince(T0);
            std::printf("edge %2d  chamfer %9.1f ms  %-8s %s\n", E, Ms, C ? "accept" : "refuse",
                        C ? "" : C.Denial.Detail);
            std::fflush(stdout);
        }
    }

    // Baseline: how long is ONE boolean subtraction on this geometry?
    {
        BrepBody Bore = BrepBody::Cylinder({ 0.05, 0.04, -0.01 }, Vec3::UnitZ(), 0.015, 0.08).Payload;
        auto T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> Cut = IntersectionSolver::Combine(Box, Bore, BodyOperation::Subtract);
        std::printf("\none boolean subtract (box - cylinder): %.1f ms, %s\n",
                    MillisecondsSince(T0), Cut ? "accept" : "refuse");
    }
    return 0;
}
