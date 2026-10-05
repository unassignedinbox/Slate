//============================================================================================================================================
//                                                            INTERCHANGEHOST.CPP
//============================================================================================================================================
// 📦 Loads the real Drive DLL and opening glTF; verifies host deformation, native SDF geometry and edit-mode restore.

#include "../../Frontier/Engine/Host/GeometrySequence.h"
#include "../../Frontier/Engine/ContentInterchange/SceneCodec.h"
#include "../../Frontier/Engine/GeometricRaster/DistanceFieldStructure.h"
#include "../../Frontier/Projects/Project-Drive/Source/TyreSequence.h"
#include "../../Frontier/Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include <iostream>
#include <fstream>
#include <cstring>
#include <stdexcept>

namespace
{
void Require(bool Accepted, const std::string& Message)
{
    if (!Accepted) throw std::runtime_error(Message);
}
struct PoseRecord { std::string Name; float World[16]; };
void FRONTIER_CODE_IMAGE_CALL Receive(const FrontierProjectSceneMutation* Mutation, void* Address)
{
    auto& Poses = *static_cast<std::vector<PoseRecord>*>(Address);
    PoseRecord Record;
    Record.Name = Mutation->SubjectName;
    std::copy_n(Mutation->Transform, 16u, Record.World);
    Poses.push_back(Record);
}
}

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        Require(ArgumentCount == 4, "usage: InterchangeHost code-image opening-scene output-folder");
        Frontier::CodeInterchange Project;
        Frontier::ProjectSpecification Specification;
        Specification.ProjectName = "Project Drive";
        Specification.CodeImageLocation = std::filesystem::absolute(Arguments[1]);
        std::string Refusal;
        Require(Project.Construct(Specification, Refusal), Refusal);
        Require(Project.HasGeometry(), "Drive geometry export not found");
        FrontierProjectGeometryReading Invalid{sizeof(Invalid), 99u, "XPBD Tyre FL", nullptr, nullptr, 0u, 0u, nullptr};
        Require(Project.ProjectGeometry(Invalid) == 2u, "incompatible geometry extension was accepted");
        Invalid.InterchangeNumber = 1u; Invalid.SubjectName = "unrelated static object";
        Require(Project.ProjectGeometry(Invalid) == 0u, "unrelated subject was captured");
        Frontier::SceneStructure Scene;
        Frontier::TextureIndex Textures;
        Require(Frontier::SceneCodec::Decode(Arguments[2], Scene, &Textures, {}, &Refusal), Refusal);
        Frontier::HostRuntime::GeometrySequence Geometry;
        Geometry.Construct(Scene, Project);
        Require(Geometry.Active(), "no deformable subjects in Drive glTF");
        const auto RestVertices = Scene.QueryVertices();
        auto Rows = Scene.QueryInstances();
        const auto RestRows = Rows;
        Geometry.CaptureRest(Scene, Rows);
        Frontier::DistanceFieldStructure NativeField;
        Require(NativeField.Construct(Scene), "rest native SDF geometry build failed");
        const uint64_t RestRevision = NativeField.QueryRevision();
        const auto RestFacets = NativeField.QueryFacets();
        std::vector<PoseRecord> Poses;
        FrontierProjectHostInterchange Host{};
        Host.StructureSize = sizeof(Host); Host.ReceiveSceneMutation = &Receive; Host.ProjectReception = &Poses;
        Require(Project.ConstructProject(Specification, Host, Refusal), Refusal);
        FrontierProjectInputReading Input{};
        Input.StructureSize = sizeof(Input); Input.TransportNumber = 2u;
        for (uint32_t Frame = 0u; Frame < 120u; ++Frame)
        {
            Poses.clear();
            Require(Project.AdvanceProject(Frame / 240.0f, 1.0f / 240.0f, &Input, Refusal), Refusal);
        }
        for (const auto& Pose : Poses)
            for (const auto& Placement : Scene.QueryPlacements())
                if (Placement.Name == Pose.Name)
                    for (uint32_t Offset = 0u; Offset < Placement.InstanceCount; ++Offset)
                    {
                        const uint32_t Slot = Placement.FirstInstance + Offset;
                        for (uint32_t Column = 0u; Column < 4u; ++Column)
                            for (uint32_t Row = 0u; Row < 4u; ++Row)
                            {
                                float Sum = 0.0f;
                                for (uint32_t Index = 0u; Index < 4u; ++Index)
                                    Sum += Pose.World[Index * 4u + Row] * RestRows[Slot].World[Column * 4u + Index];
                                Rows[Slot].World[Column * 4u + Row] = Sum;
                            }
                    }
        bool Changed = false;
        Require(Geometry.Advance(Scene, Rows, Project, Changed, Refusal), Refusal);
        Require(Changed, "real Drive simulation did not publish deformed vertices");
        uint32_t Moved = 0u;
        float Maximum = 0.0f;
        for (size_t Index = 0u; Index < RestVertices.size(); ++Index)
        {
            const float Distance = (Scene.QueryVertices()[Index].SpatialLocation - RestVertices[Index].SpatialLocation).Length();
            if (Distance > 1.0e-6f) ++Moved;
            Maximum = std::max(Maximum, Distance);
        }
        Require(Moved > 1000u, "tyre vertices did not move");
        float NonRigidDisplacement = 0.0f;
        for (const auto& Placement : Scene.QueryPlacements())
            for (const auto& Pose : Poses)
                if (Placement.Name == Pose.Name && Placement.Name.find("XPBD Tyre") == 0u)
                    for (uint32_t Offset = 0u; Offset < Placement.InstanceCount; ++Offset)
                    {
                        const auto& Instance = RestRows[Placement.FirstInstance + Offset];
                        if (Scene.QueryMaterials().QueryDescriptors()[Instance.MaterialIndex].Name.find("StandardRubber") != 0u) continue;
                        for (uint32_t Corner = 0u; Corner < Instance.TriangleCount * 3u; ++Corner)
                        {
                            const uint32_t Index = Instance.VertexOffset + Scene.QueryIndices()[Instance.FirstIndex + Corner];
                            const auto Local = RestVertices[Index].SpatialLocation;
                            const auto Transform = [](const float* Matrix, Frontier::Vector3 Point)
                            {
                                return Frontier::Vector3{Matrix[0] * Point.x + Matrix[4] * Point.y + Matrix[8] * Point.z + Matrix[12],
                                    Matrix[1] * Point.x + Matrix[5] * Point.y + Matrix[9] * Point.z + Matrix[13],
                                    Matrix[2] * Point.x + Matrix[6] * Point.y + Matrix[10] * Point.z + Matrix[14]};
                            };
                            const auto Rigid = Transform(Pose.World, Transform(Instance.World, Local));
                            NonRigidDisplacement = std::max(NonRigidDisplacement, (Scene.QueryVertices()[Index].SpatialLocation - Rigid).Length());
                        }
                    }
        Require(NonRigidDisplacement > 0.001f, "Drive geometry is only rigidly transformed, not deformed");
        std::cout << "PASS real Drive non-rigid displacement beyond pose-only wheel: " << NonRigidDisplacement << " m\n";
        Scene.RefreshGeometry(Rows);
        Require(NativeField.Construct(Scene) && NativeField.QueryRevision() > RestRevision, "native field revision stayed stale");
        Require(NativeField.QueryFacets().size() == RestFacets.size(), "fixed topology changed triangle count");
        Require(std::memcmp(RestFacets.data(), NativeField.QueryFacets().data(), RestFacets.size() * sizeof(RestFacets[0])) != 0,
                "native SDF still contains rest geometry");
        for (const auto& Cluster : Scene.QueryClusters())
        {
            const auto& Instance = Scene.QueryInstances()[Cluster.InstanceIndex];
            for (uint32_t Corner = 0u; Corner < Cluster.TriangleCount * 3u; ++Corner)
            {
                const auto& Point = Scene.QueryVertices()[Instance.VertexOffset + Scene.QueryIndices()[Cluster.FirstIndex + Corner]].SpatialLocation;
                Require((Point - Frontier::Vector3{Cluster.CenterX, Cluster.CenterY, Cluster.CenterZ}).Length() <= Cluster.Radius + 1.0e-5f,
                        "deformed culling bound excludes a vertex");
            }
            Require(Cluster.CoarseTriangleCount == 0u, "rest-only coarse error remained active");
        }
        Require(Geometry.Advance(Scene, Rows, Project, Changed, Refusal) && !Changed, "same revision republished");
        Scene.AccessVertices().push_back({});
        Require(!Geometry.Advance(Scene, Rows, Project, Changed, Refusal), "changed topology accepted during playback");
        Scene.AccessVertices().pop_back();
        // Renderable closed envelope from the SAME real DLL callback used to publish raster/SDF vertices above.
        const std::filesystem::path Output = Arguments[3];
        std::filesystem::create_directories(Output);
        const Frontier::Vehicle::VehicleGeometry Dimensions;
        Frontier::Vehicle::SoftTyreParameters Parameters;
        Parameters.Radius = Dimensions.TyreRadius; Parameters.RimRadius = Dimensions.TyreRimRadius; Parameters.Width = Dimensions.TyreWidth;
        Frontier::Vehicle::XPBDSoftTyre RestTyre;
        RestTyre.Build(Parameters, {}, {});
        Frontier::Drive::TyreSequence TyreSurface;
        TyreSurface.Capture(RestTyre, {}, {});
        std::vector<Frontier::Vector3> RestEnvelope;
        std::vector<Frontier::DeformationSpace::Face> EnvelopeFaces;
        TyreSurface.Envelope(RestEnvelope, EnvelopeFaces, true);
        auto Origin = Dimensions.AxleMountLocal(0u);
        Origin.z += Dimensions.CoMHeight + 0.02f;
        float RestHub[3] = {Origin.x, Origin.y, Origin.z}, CurrentHub[3]{};
        FrontierProjectGeometryReading Reading{sizeof(Reading), 1u, "XPBD Tyre FL", RestHub, CurrentHub, 1u, 0u, "Hub"};
        Require(Project.ProjectGeometry(Reading) == 1u, "live hub projection refused");
        std::vector<float> RestPositions, CurrentPositions;
        for (const auto& Position : RestEnvelope)
            RestPositions.insert(RestPositions.end(), {Position.x + Origin.x, Position.y + Origin.y, Position.z + Origin.z});
        CurrentPositions.resize(RestPositions.size());
        Reading.RestPositions = RestPositions.data(); Reading.CurrentPositions = CurrentPositions.data();
        Reading.VertexCount = static_cast<uint32_t>(RestEnvelope.size()); Reading.MaterialName = "StandardRubber";
        Require(Project.ProjectGeometry(Reading) == 1u, "live envelope projection refused");
        std::vector<Frontier::Vector3> Envelope;
        for (size_t Index = 0u; Index < CurrentPositions.size(); Index += 3u)
            Envelope.push_back({CurrentPositions[Index] - CurrentHub[0], CurrentPositions[Index + 1u] - CurrentHub[1],
                                CurrentPositions[Index + 2u] - CurrentHub[2]});
        Frontier::DeformationSpace LiveTyreField;
        Require(LiveTyreField.Update(Envelope, EnvelopeFaces, 64u, 0.06f, Refusal), Refusal);
        Require(LiveTyreField.QueryField().SaveToFile((Output / "ProjectDrive.sdf").string()), "live field save failed");
        std::ofstream(Output / "ProjectDrive.json") << "{\"hub\":[" << CurrentHub[0] << "," << CurrentHub[1] << "," << CurrentHub[2]
            << "],\"geometryRevision\":" << Reading.Revision << ",\"triangles\":" << EnvelopeFaces.size()
            << ",\"source\":\"ProjectDrive DLL, real VehicleInstanceSequence, Simulate 120 frames at 240 Hz\"}\n";
        Input.Paused = 1u;
        Require(Project.AdvanceProject(1.0f, 1.0f / 60.0f, &Input, Refusal), Refusal);
        Require(Geometry.Advance(Scene, Rows, Project, Changed, Refusal) && !Changed, "paused geometry advanced");
        Input.TransportNumber = 0u;
        Require(Project.AdvanceProject(1.0f, 1.0f / 60.0f, &Input, Refusal), Refusal);
        Require(Geometry.Restore(Scene), "restoration absent");
        Rows = RestRows;
        Scene.RefreshGeometry(Rows);
        Require(std::memcmp(RestVertices.data(), Scene.QueryVertices().data(), RestVertices.size() * sizeof(RestVertices[0])) == 0,
                "Stop did not restore authored vertices exactly");
        Require(NativeField.Construct(Scene), "restored field refused");
        Require(std::memcmp(RestFacets.data(), NativeField.QueryFacets().data(), RestFacets.size() * sizeof(RestFacets[0])) == 0,
                "restored native SDF facets differ");
        Project.Retire();
        Require(!Project.HasGeometry(), "geometry callback survived DLL retirement");
        std::cout << "PASS actual Drive DLL + opening glTF: " << Moved << " rewritten vertices; maximum local-to-world coordinate change " << Maximum << " m\n"
                  << "PASS native SDF geometry revision, fixed topology, culling bounds, coarse refusal, unchanged revision, pause, exact Stop restore\n";
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << Error.what() << "\n";
        return 1;
    }
}
