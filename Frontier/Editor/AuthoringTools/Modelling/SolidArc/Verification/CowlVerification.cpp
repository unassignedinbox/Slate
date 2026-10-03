//============================================================================================================================================
//                                                           COWLVERIFICATION.CPP
//============================================================================================================================================
// 📦 Native Liger cowl replay, open-skin topology, orientation, sampling, persistence and presentation checks.

#include "Console/ConsoleHost.h"
#include "Document/UndoSequence.h"
#include "VerificationPanel.h"
#include <bit>
#include <filesystem>
#include <fstream>
#include <iostream>

using namespace Frontier;

int main(int Count, char** Arguments)
{
    if (Count < 2 || Count > 3)
    {
        std::cerr << "CowlVerification <cowl.arc> [samples.f64]\n";
        return 2;
    }
    VerificationPanel Panel("SolidArc · Liger cowl · native exterior geometry");
    const std::filesystem::path Directory = std::filesystem::path(SOLIDARC_PROOF_FOLDER) / "CowlVerification";
    std::filesystem::create_directories(Directory);
    ConsoleHost Host(Directory.string(), 1280, 800);
    Panel.Expect("native cowl opens", Host.Execute(std::string("open \"") + Arguments[1] + "\""));
    Panel.Expect("one sewn exterior body", Host.AllFigures().size() == 1);
    if (Host.AllFigures().size() != 1) return Panel.Conclude();
    const SceneFigure& Cowl = Host.AllFigures().front();
    Panel.Expect("cowl is editable B-rep, not display triangles", Cowl.Classification == FigureClassification::Body);
    const BodyReport Report = Cowl.Body.Validate();
    Panel.Expect("all source charts retained without caps", Report.Faces == 308);
    Panel.Expect("source edge count retained", Report.Edges == 656);
    Panel.Expect("intentional boundary count retained", Report.OpenEdges == 80);
    Panel.Expect("one connected exterior skin", Report.Hulls == 1);
    Panel.Expect("no non-manifold edges", Report.NonManifoldEdges == 0 && Report.Manifold);
    Panel.Expect("no misoriented edges", Report.MisorientedEdges == 0 && Report.Oriented);
    Panel.Expect("not a fabricated closed solid", !Report.Closed && !Report.Solid());
    Panel.Expect("measured area retained in square metres", Report.Area > 0.793 && Report.Area < 0.794);
    bool SourceOrientation = true;
    for (const BrepFace& Face : Cowl.Body.Faces) SourceOrientation = SourceOrientation && !Face.Reversed;
    Panel.Expect("source face orientations preserved", SourceOrientation);

    // 📝 Optional binary output is compared against separately extracted Blender samples by SurfaceMetrics.py.
    if (Count == 3)
    {
        static_assert(sizeof(double) == 8 && std::endian::native == std::endian::little);
        std::ofstream Samples(Arguments[2], std::ios::binary);
        for (const BrepFace& Face : Cowl.Body.Faces)
        {
            for (int U = 0; U <= 32; ++U)
            {
                for (int V = 0; V <= 32; ++V)
                {
                    const Vec3 Position = Face.Surface.Sample(U / 32.0, V / 32.0);
                    const double Coordinates[3] = { Position.X, Position.Y, Position.Z };
                    Samples.write(reinterpret_cast<const char*>(Coordinates), sizeof(Coordinates));
                }
            }
        }
        Samples.close();
        Panel.Expect("native samples written successfully", !Samples.fail());
    }

    const uint64_t Before = UndoSequence::Fingerprint(Host.Document());
    const std::string Saved = (Directory / "Cowl_RoundTrip.arc").generic_string();
    Panel.Expect("native cowl saves", Host.Execute("save \"" + Saved + "\""));
    Panel.Expect("clear saved cowl", Host.Execute("reset"));
    Panel.Expect("native cowl reopens", Host.Execute("open \"" + Saved + "\""));
    Panel.Expect("exact geometric fingerprint survives save/reopen", UndoSequence::Fingerprint(Host.Document()) == Before);
    for (const char* Command : { "show cages off", "show iso off", "show shading plastic", "view orbit 60 30", "view fit",
                                "render Liger_Cowl_Native --size=1600x1000" })
        Panel.Expect(Command, Host.Execute(Command));
    return Panel.Conclude();
}
