// Rim generator bring-up harness: synthesises every preset, audits the topology (one shell, watertight, outward) and
//    dumps an OBJ per preset for visual inspection. Standalone — WheelRimSpecification has no engine dependencies.
//    g++ -std=c++20 -O2 Scratchpad/WheelRimGeneratorTest.cpp Engine/ContentInterchange/WheelRimSpecification.cpp -o /tmp/rimtest
#include "../Engine/ContentInterchange/WheelRimSpecification.h"
#include <cstdio>
#include <string>

using namespace Frontier;

int main(int argc, char** argv)
{
    const std::string Folder = argc > 1 ? argv[1] : "/tmp/rims";
    const struct { RimPresetCategory Preset; const char* Name; } Presets[] = {
        { RimPresetCategory::ForgedFiveSpoke,   "ForgedFiveSpoke"   },
        { RimPresetCategory::SplitTenSpoke,     "SplitTenSpoke"     },
        { RimPresetCategory::TwentySpokeWeave,  "TwentySpokeWeave"  },
        { RimPresetCategory::TurbineAero,       "TurbineAero"       },
        { RimPresetCategory::DeepDishConcave,   "DeepDishConcave"   },
        { RimPresetCategory::HeavyDutySixSpoke, "HeavyDutySixSpoke" } };

    int Failures = 0;
    for (const auto& Entry : Presets)
    {
        WheelRimParameters P = WheelRimParameters::FromPreset(Entry.Preset);
        if (argc > 2) { P.AngularSegments = 256u; P.RadialSegments = 64u; }   // fast mode
        const std::string Note = P.Normalise();
        const RimSurface Surface = WheelRimSpecification::Synthesise(P);
        const RimSurfaceAudit Whole = Surface.Audit();
        const RimSurfaceAudit Body  = Surface.Audit(Surface.Parts[0].FirstTriangle, Surface.Parts[0].TriangleCount);

        std::printf("%-18s tris %7u  verts %7u  parts %2zu | BODY shells %u  boundary %u  nonmanifold %u  flipped %u  vol %.6f m3 %s%s\n",
                    Entry.Name, Whole.TriangleCount, Whole.VertexCount, Surface.Parts.size(),
                    Body.ShellCount, Body.BoundaryEdges, Body.NonManifoldEdges, Body.FlippedEdges, Body.SignedVolume,
                    (Body.ShellCount == 1u && Body.Watertight() && Body.SignedVolume > 0.0) ? "OK" : "**FAIL**",
                    Note.empty() ? "" : ("  [" + Note + "]").c_str());
        if (!(Body.ShellCount == 1u && Body.Watertight() && Body.SignedVolume > 0.0)) ++Failures;

        for (size_t Part = 1u; Part < Surface.Parts.size(); ++Part)
        {
            const RimSurfaceAudit A = Surface.Audit(Surface.Parts[Part].FirstTriangle, Surface.Parts[Part].TriangleCount);
            if (A.ShellCount != 1u || !A.Watertight() || A.SignedVolume <= 0.0)
            {
                std::printf("    part %-12s shells %u boundary %u nonmanifold %u flipped %u vol %.8f **FAIL**\n",
                            Surface.Parts[Part].Name.c_str(), A.ShellCount, A.BoundaryEdges, A.NonManifoldEdges, A.FlippedEdges, A.SignedVolume);
                ++Failures;
            }
        }

        std::string Error;
        if (!Surface.WriteWavefront(Folder + "/" + Entry.Name + ".obj", &Error))
            std::printf("    obj write failed: %s\n", Error.c_str());
    }
    std::printf("%s\n", Failures == 0 ? "all presets manifold" : "FAILURES PRESENT");
    return Failures == 0 ? 0 : 1;
}
