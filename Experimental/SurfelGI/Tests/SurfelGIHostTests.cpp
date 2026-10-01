#include "SurfelGI.h"

#include <cassert>
#include <cstdint>
#include <iostream>

using namespace Frontier::Experimental::SurfelGI;

int main()
{
    const Settings Reference = Settings::Reference();
    assert(Reference.IsValid());
    assert(Reference.SurfelLimit == 150'000u);
    assert(Reference.RayBudget == 9'600'000u);
    assert(Reference.CellDimension == 250u);
    assert(Reference.CellCount() == 15'625'000u);
    assert(Reference.CellToSurfelEntryCount() == 18'750'000u);
    assert(Reference.MaximumPathSteps == 6u);

    const MemoryEstimate Memory = Runtime::EstimateMemory(Reference);
    assert(Memory.SurfelBytes == 19'200'000u);
    assert(Memory.CellInfoBytes == 125'000'000u);
    assert(Memory.CellToSurfelBytes == 75'000'000u);
    assert(Memory.RayResultBytes == 460'800'000u);
    assert(Memory.TotalBytes() > 800ull * 1024ull * 1024ull);

    // The prepare pass moves the current live list to the dirty list, then resets transient counters.
    Runtime RuntimeState{ Reference };
    assert(RuntimeState.QueryCounters().FreeSurfel == Reference.SurfelLimit);
    RuntimeState.PublishUpdatedSurfels(100u, Reference.SurfelLimit - 100u, 200u, 900u);
    RuntimeState.RecordMissBounces(5u);
    RuntimeState.BeginFrame();
    assert(RuntimeState.QueryCounters().DirtySurfel == 100u);
    assert(RuntimeState.QueryCounters().ValidSurfel == 0u);
    assert(RuntimeState.QueryCounters().Cell == 0u);
    assert(RuntimeState.QueryCounters().RequestedRay == 0u);
    assert(RuntimeState.QueryCounters().MissBounce == 0u);

    assert(Runtime::AllocateAdaptiveRayCount(0.0f, false, Reference) == 16u);
    assert(Runtime::AllocateAdaptiveRayCount(1.0f, false, Reference) == 64u);
    assert(Runtime::AllocateAdaptiveRayCount(0.0f, true, Reference) == 1u);
    assert(Runtime::AllocateAdaptiveRayCount(1.0f, true, Reference) == 4u);

    RuntimeState.AdvanceFrame();
    assert(RuntimeState.QueryFrameIndex() == 1u);
    std::cout << "SurfelGI host contract passed; reference GPU working set: "
              << Memory.TotalMiB() << " MiB before scene and driver allocations.\n";
    return 0;
}
