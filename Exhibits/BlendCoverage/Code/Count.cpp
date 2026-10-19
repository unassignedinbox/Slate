#include "Kernel/BlendSolver.h"
#include "Kernel/TopologySpecification.h"
#include <chrono>
#include <cstdio>
extern unsigned long long SolidArcCutterTries;
using namespace Frontier;
int main() noexcept {
    const double Size = 0.004;
    Deliver<BrepBody> BoxD = BrepBody::Box({ 0, 0, 0 }, { 0.1, 0.08, 0.06 });
    const BrepBody& Box = BoxD.Payload;
    std::printf("%-28s %12s %10s %8s  %s\n", "case", "cutter-tries", "ms", "result", "detail");
    for (int E = 0; E < 3; ++E) {
        if (Box.Edges[E].Coedges.size() != 2) continue;
        SolidArcCutterTries = 0;
        auto T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> C = BlendSolver::ChamferEdge(Box, E, Size);
        double Ms = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-T0).count();
        std::printf("%-28s %12llu %10.1f %8s  %s\n", "box edge chamfer", SolidArcCutterTries, Ms,
                    C ? "accept" : "refuse", C ? "" : C.Denial.Detail);
        SolidArcCutterTries = 0;
        T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> F = BlendSolver::FilletEdge(Box, E, Size);
        Ms = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-T0).count();
        std::printf("%-28s %12llu %10.1f %8s  %s\n", "box edge fillet", SolidArcCutterTries, Ms,
                    F ? "accept" : "refuse", F ? "" : F.Denial.Detail);
    }
    // A large setback near the geometric limit should exercise more of the ladder.
    for (double S : { 0.02, 0.029 }) {
        SolidArcCutterTries = 0;
        auto T0 = std::chrono::steady_clock::now();
        Deliver<BrepBody> C = BlendSolver::ChamferEdge(Box, 0, S);
        double Ms = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-T0).count();
        std::printf("%-28s %12llu %10.1f %8s  %s\n", ("box chamfer s=" + std::to_string(S)).c_str(),
                    SolidArcCutterTries, Ms, C ? "accept" : "refuse", C ? "" : C.Denial.Detail);
    }
    std::printf("\nladder worst case = 7 half-widths x 23 margins = 161 full NURBS booleans per edge\n");
    return 0;
}
