//============================================================================================================================================
//                                                          FEATUREVERIFICATION.CPP
//============================================================================================================================================
// 📦 Feature-curve semantics, independent edge copies, exact arc guides, persistence and native colour rendering.

#include "Console/ConsoleHost.h"
#include "Document/UndoSequence.h"
#include "VerificationPanel.h"
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>

using namespace Frontier;

int main(int Count, char** Arguments)
{
    const std::filesystem::path Destination = std::filesystem::path(SOLIDARC_PROOF_FOLDER) / "FeatureVerification";
    std::filesystem::create_directories(Destination);
    ConsoleHost Host(Destination.string(), 1600, 1000);
    if (Count == 3 || Count == 4)
    {
        if (!Host.Execute(std::string("open \"") + Arguments[1] + "\"")) return 2;
        if (Count == 4)
        {
            if (std::string(Arguments[3]) != "--roundtrip") return 2;
            const uint64_t Before = UndoSequence::Fingerprint(Host.Document());
            const auto Saved = (Destination / "FeatureReview.arc").generic_string();
            if (!Host.Execute("save \"" + Saved + "\"") || !Host.Execute("open \"" + Saved + "\"") ||
                Before != UndoSequence::Fingerprint(Host.Document())) return 2;
            std::cout << "PASS feature-review roundtrip: geometry, purposes and colours retained\n";
            size_t Arcs = 0;
            double RadiusError = 0;
            for (const auto& CurveFigure : Host.AllFigures())
            {
                if (CurveFigure.Feature != FeaturePurpose::CircularGuide) continue;
                ++Arcs;
                const auto& Curve = CurveFigure.Curve;
                for (int Sample = 0; Sample <= 1000; ++Sample)
                {
                    const auto Point = Curve.Sample(Curve.DomainStart() + (Curve.DomainEnd() - Curve.DomainStart()) * Sample / 1000.0);
                    const double Error = std::fabs((Point - Curve.Centre).Length() - Curve.RadiusMajor);
                    if (!std::isfinite(Error)) return 2;
                    RadiusError = std::max(RadiusError, Error);
                }
            }
            if (Arcs != 4 || RadiusError > 1e-11) return 2;
            std::cout << "PASS circular guide radii: arcs=" << Arcs << " maximum_error_metres=" << RadiusError << "\n";
            const char* LeftNames[] = {"Design_Rail_1", "Design_Rail_2", "Design_Rail_3_Left", "Rear_Opening_Circle_Left", "Front_Opening_Circle_Left"};
            const char* RightNames[] = {"Design_Rail_1", "Design_Rail_2", "Design_Rail_3_Right", "Rear_Opening_Circle_Right", "Front_Opening_Circle_Right"};
            double MirrorError = 0;
            for (size_t Pair = 0; Pair < 5; ++Pair)
            {
                const auto* Left = Host.Document().Find(LeftNames[Pair]);
                const auto* Right = Host.Document().Find(RightNames[Pair]);
                if (!Left || !Right) return 2;
                for (int Sample = 0; Sample <= 1000; ++Sample)
                {
                    const double Along = Sample / 1000.0, Opposite = Pair < 2 ? 1.0 - Along : Along;
                    Vec3 A = Left->Curve.Sample(Left->Curve.DomainStart() + (Left->Curve.DomainEnd() - Left->Curve.DomainStart()) * Along);
                    const Vec3 B = Right->Curve.Sample(Right->Curve.DomainStart() + (Right->Curve.DomainEnd() - Right->Curve.DomainStart()) * Opposite);
                    A.Y = -A.Y;
                    const double Error = (A - B).Length();
                    if (!std::isfinite(Error)) return 2;
                    MirrorError = std::max(MirrorError, Error);
                }
            }
            if (MirrorError > 1e-8) return 2;
            std::cout << "PASS mirrored design and circular guides: maximum_error_metres=" << MirrorError << "\n";

        }
        const SceneFigure* Figure = Host.Document().Find("Liger_Main_Body");
        if (!Figure || Figure->Classification != FigureClassification::Body) return 2;
        Host.Execute("view top; view fit; view dolly 1.5");
        const CameraProjection Top = Host.Camera();
        Host.Execute("view front; view fit; view dolly 1.5");
        const CameraProjection Side = Host.Camera();
        std::ofstream Out(Arguments[2]);
        Out << std::setprecision(17) << "[\n";
        for (size_t Index = 0; Index < Figure->Body.Edges.size(); ++Index)
        {
            const BrepEdge& Edge = Figure->Body.Edges[Index];
            Out << (Index ? ",\n" : "") << "{\"edge\":" << Index << ",\"start\":" << Edge.VertexStart << ",\"end\":" << Edge.VertexEnd << ",\"open\":" << (Edge.Coedges.size() == 1 ? "true" : "false") << ",\"points\":[";
            for (int Sample = 0; Sample <= 16; ++Sample)
            {
                const Vec3 Point = Edge.Curve.Sample(Edge.Curve.DomainStart() +
                    (Edge.Curve.DomainEnd() - Edge.Curve.DomainStart()) * Sample / 16.0);
                double X = 0, Y = 0, SideX = 0, SideY = 0;
                (void)Top.WorldToPixel(Point, 1600, 1000, X, Y);
                (void)Side.WorldToPixel(Point, 1600, 1000, SideX, SideY);
                Out << (Sample ? "," : "") << "[" << Point.X << "," << Point.Y << "," << Point.Z << "," << X << "," << Y << "," << SideX << "," << SideY << "]";
            }
            Out << "]}";
        }
        Out << "\n]\n";
        auto FacetPath = std::filesystem::path(Arguments[2]);
        FacetPath.replace_extension(".triangles.f64");
        std::ofstream Facets(FacetPath, std::ios::binary);
        for (size_t Face = 0; Face < Figure->Body.Faces.size(); ++Face)
        {
            const auto Triangles = Figure->Body.TessellateFace(static_cast<int>(Face), 2e-3);
            for (auto Index : Triangles.Triangles)
            {
                const Vec3 Point = Triangles.Positions[Index];
                const double Coordinates[3] = {Point.X, Point.Y, Point.Z};
                Facets.write(reinterpret_cast<const char*>(Coordinates), sizeof(Coordinates));
            }
        }
        return Out.good() && Facets.good() ? 0 : 2;
    }
    if (Count != 1) return 2;
    VerificationPanel Panel("SolidArc feature curves");
    Panel.Expect("capability declared", Host.Execute("require feature-curves"));
    Panel.Expect("source body", Host.Execute("box (-1,-1,-.2) (1,1,0) --name=Support"));
    const auto Before = Host.Document().Find("Support")->Body.Validate();
    Panel.Expect("independent design edge copies", Host.Execute("feature-copy Support design --edges=0,1 --name=Design"));
    Panel.Expect("purpose attached to copied curve", Host.Document().Find("Design.e0")->Feature == FeaturePurpose::Design);
    Panel.Expect("source topology unchanged", Host.Document().Find("Support")->Body.Validate().Edges == Before.Edges);
    Panel.Expect("editable spline", Host.Execute("spline (-1,0,.2) (-.3,.4,.4) (.3,.4,.4) (1,0,.2) --name=Repair"));
    Panel.Expect("repair purpose", Host.Execute("feature repair Repair"));
    const uint64_t Tagged = UndoSequence::Fingerprint(Host.Document());
    Panel.Expect("undo feature assignment", Host.Execute("undo"));
    Panel.Expect("undo restores ordinary curve", Host.Document().Find("Repair")->Feature == FeaturePurpose::None);
    Panel.Expect("redo feature assignment", Host.Execute("redo"));
    Panel.Expect("redo restores purpose and colour", Tagged == UndoSequence::Fingerprint(Host.Document()));
    Panel.Expect("unknown target refuses transactionally", !Host.Execute("feature design Repair Missing"));
    Panel.Expect("unknown target leaves metadata intact", Tagged == UndoSequence::Fingerprint(Host.Document()));
    Panel.Expect("invalid edge list refuses transactionally", !Host.Execute("feature-copy Support design --edges=0,-1"));
    Panel.Expect("invalid list creates no partial curves", Tagged == UndoSequence::Fingerprint(Host.Document()));
    Panel.Expect("freeform cannot masquerade as circular", !Host.Execute("feature circular Repair"));
    Panel.Expect("invalid purpose does not mutate", Tagged == UndoSequence::Fingerprint(Host.Document()));
    Panel.Expect("exact rational arc", Host.Execute("arc (0,0,.3) .7 10 160 --name=Arch"));
    Panel.Expect("circular purpose", Host.Execute("feature circular Arch"));
    const NurbsCurve& Arc = Host.Document().Find("Arch")->Curve;
    double Maximum = 0;
    for (int Index = 0; Index <= 1000; ++Index)
    {
        const Vec3 Point = Arc.Sample(Arc.DomainStart() + (Arc.DomainEnd() - Arc.DomainStart()) * Index / 1000.0);
        Maximum = std::max(Maximum, std::fabs((Point - Vec3{0, 0, .3}).Length() - .7));
    }
    Panel.Expect("circular radius verified, not a polygon approximation", Maximum < 1e-12);
    Panel.Expect("closed guide construction", Host.Execute("circle (2,0) .3 --name=ClosedGuide"));
    Panel.Expect("closed guide purpose", Host.Execute("feature design ClosedGuide"));
    Panel.Expect("feature guides do not create sketch fill areas", Host.Document().Areas().empty());
    Panel.Expect("custom feature colour", Host.Execute("tint Repair 1 .55 .1"));
    Panel.Expect("invalid custom colour refused", !Host.Execute("tint Repair 2 .5 0"));
    Panel.Expect("ordinary boundaries independently hidden", Host.Execute("show edges off; show cages off; show iso off; view top; view fit"));
    auto ColouredPixels = [&Host]()
    {
        Host.Render();
        const auto Image = Host.Raster().Readback();
        size_t Pixels = 0;
        for (size_t Index = 0; Index < Image.Pixels.size(); Index += 4)
        {
            const int R = Image.Pixels[Index], G = Image.Pixels[Index + 1], B = Image.Pixels[Index + 2];
            if ((R > 180 && R > B + 60 && G > B + 30) || (B > 180 && G > 160 && B > R + 60 && G > R + 50)) ++Pixels;
        }
        return Pixels;
    };
    const size_t Visible = ColouredPixels();
    Panel.Expect("feature colours reach native pixels", Visible > 300);
    Panel.Expect("feature visibility toggle", Host.Execute("show features off"));
    Panel.Expect("visibility removes feature strokes", ColouredPixels() < Visible / 2);
    Panel.Expect("feature display restores", Host.Execute("show features on"));
    Panel.Expect("invalid visibility refuses", !Host.Execute("show features maybe"));
    Panel.Expect("hide before saving", Host.Execute("show features off"));
    const uint64_t BeforeSave = UndoSequence::Fingerprint(Host.Document());
    const std::string Saved = (Destination / "Features.arc").generic_string();
    Panel.Expect("native save", Host.Execute("save \"" + Saved + "\""));
    Panel.Expect("native reopen", Host.Execute("open \"" + Saved + "\""));
    Panel.Expect("purpose, colours and geometry survive replay", BeforeSave == UndoSequence::Fingerprint(Host.Document()));
    Panel.Expect("hidden feature display survives open", ColouredPixels() < Visible / 2);
    Panel.Expect("restore feature display for proof", Host.Execute("show features on"));
    Panel.Expect("native visual proof", Host.Execute("render FeatureCurves --size=1600x1000"));
    return Panel.Conclude();
}
