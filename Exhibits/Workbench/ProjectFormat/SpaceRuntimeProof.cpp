//============================================================================================================================================
//                 📦 Exhibits/Workbench/ProjectFormat/SpaceRuntimeProof.cpp — CPU-only startup proof
//============================================================================================================================================
// Exercises the runtime-facing half of the Slate-owned content path with no graphics API: TOML .projectspace + TOML
// .material + binary FSPC .geometry -> SceneStructure. The fixture contains no glTF file; a passing run proves startup
// content can be resolved and made resident entirely on CPU.
#include "SpaceExport.h"
#include "SpaceSceneCodec.h"
#include "SpaceToml.h"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{
    int Failures = 0;
    void Pass(const char* Message) { std::printf("  PASS  %s\n", Message); }
    void Fail(const std::string& Message) { ++Failures; std::printf("  FAIL  %s\n", Message.c_str()); }

    bool WriteBinary(const std::filesystem::path& Path, const std::vector<uint8_t>& Bytes)
    {
        std::error_code Ec;
        std::filesystem::create_directories(Path.parent_path(), Ec);
        if (Ec) return false;
        std::ofstream Out(Path, std::ios::binary | std::ios::trunc);
        Out.write(reinterpret_cast<const char*>(Bytes.data()), static_cast<std::streamsize>(Bytes.size()));
        return Out.good();
    }
}

int main()
{
    const std::filesystem::path Root = std::filesystem::temp_directory_path() / "FrontierSpaceRuntimeProof";
    std::error_code Ec;
    std::filesystem::remove_all(Root, Ec);
    std::filesystem::create_directories(Root / "Content" / "Geometry", Ec);
    std::filesystem::create_directories(Root / "Content" / "Materials", Ec);
    if (Ec) { Fail("cannot create CPU proof directory"); return 1; }

    MaterialDescriptor Gold;
    Gold.Name = "Proof Gold";
    Gold.Slabs.emplace_back();
    Gold.Slabs[0].BaseColor[0] = 0.93f;
    Gold.Slabs[0].BaseColor[1] = 0.68f;
    Gold.Slabs[0].BaseColor[2] = 0.24f;
    Gold.Slabs[0].BaseMetalness = 1.0f;
    Gold.Slabs[0].SpecularRoughness = 0.18f;
    std::string Error;
    const std::filesystem::path MaterialPath = Root / "Content" / "Materials" / "ProofGold.material";
    if (!SpaceTomlWriteMaterialFile(MaterialPath.string(), Gold, Error)) Fail(Error);

    VertexRecord Vertices[3]{};
    Vertices[0].SpatialLocation = Vector3{ -1.0f, 0.0f, 0.0f };
    Vertices[1].SpatialLocation = Vector3{  1.0f, 0.0f, 0.0f };
    Vertices[2].SpatialLocation = Vector3{  0.0f, 1.0f, 0.0f };
    for (VertexRecord& Vertex : Vertices)
    {
        Vertex.NormalDirection = Vector3{ 0.0f, 0.0f, 1.0f };
        Vertex.TangentDirection = Vector4{ 1.0f, 0.0f, 0.0f, 1.0f };
    }
    Vertices[1].TextureCoordinateU = 1.0f;
    Vertices[2].TextureCoordinateV = 1.0f;
    const uint32_t Indices[] = { 0u, 1u, 2u };
    std::vector<uint8_t> Geometry;
    SpaceExportContext Context;
    Context.Exporter = "SpaceRuntimeProof";
    if (!SpaceExportGeometry(Context, "ProofTriangle", Vertices, 3u, Indices, 3u, nullptr, 0u, Geometry, Error)) Fail(Error);
    const std::filesystem::path GeometryPath = Root / "Content" / "Geometry" / "ProofTriangle.geometry";
    if (Failures == 0 && !WriteBinary(GeometryPath, Geometry)) Fail("cannot write FSPC .geometry fixture");

    SpaceTomlProject Project;
    Project.Name = "CPU Runtime Proof";
    Project.DefaultLevel = "First";
    Project.Levels.push_back({ "First" });
    Project.Levels.push_back({ "Second" });
    for (uint32_t I = 0u; I < 2u; ++I)
    {
        SpaceTomlInstance Instance;
        Instance.Name = I == 0u ? "First triangle" : "Second triangle";
        Instance.Level = I == 0u ? "First" : "Second";
        Instance.Geometry = "Content/Geometry/ProofTriangle.geometry";
        Instance.Material = "Content/Materials/ProofGold.material";
        Instance.Flags = kSpaceInstanceCastShadow;
        Instance.Transform[12] = I == 0u ? 2.0f : -2.0f;
        Project.Instances.push_back(Instance);
    }
    const std::filesystem::path ProjectPath = Root / "CPU.projectspace";
    if (Failures == 0 && !SpaceTomlWriteProjectFile(ProjectPath.string(), Project, Error)) Fail(Error);

    SpaceTomlProject ReadProject;
    MaterialDescriptor ReadMaterial;
    if (Failures == 0 && (!SpaceTomlReadProjectFile(ProjectPath.string(), ReadProject, Error) ||
                          !SpaceTomlReadMaterialFile(MaterialPath.string(), ReadMaterial, Error))) Fail(Error);
    else if (Failures == 0 && (ReadProject.Levels.size() != 2u || ReadProject.Instances.size() != 2u ||
                               ReadMaterial.Name != Gold.Name || ReadMaterial.Slabs.size() != 1u ||
                               ReadMaterial.Slabs[0].BaseMetalness != 1.0f))
        Fail("TOML project/material did not round-trip their authored values");
    else if (Failures == 0) Pass("TOML .projectspace and .material round-trip with declared levels, references, and OpenPBR values");

    SceneStructure Scene;
    SceneDecodeConfiguration Decode;
    Decode.SlabLimit = 4u;
    Decode.LevelName = "Second";
    if (Failures == 0 && !SpaceSceneCodec::Decode(ProjectPath.string(), Scene, nullptr, Decode, &Error)) Fail(Error);
    else if (Failures == 0 && (Scene.QueryName() != "Second" || Scene.QueryTriangleCount() != 1u ||
                               Scene.QueryInstances().size() != 1u || Scene.QueryMaterials().QueryCount() != 1u ||
                               Scene.QueryVertices().empty() || Scene.QueryInstances()[0].World[12] != -2.0f))
        Fail("the runtime loader did not select and make the named Space level resident");
    else if (Failures == 0) Pass("CPU runtime loads selected .projectspace level from FSPC geometry and TOML material without glTF");

    std::filesystem::remove_all(Root, Ec);
    if (Failures == 0) std::printf("[space-runtime] GREEN — no Vulkan header, driver, device, or glTF input was used\n");
    return Failures == 0 ? 0 : 1;
}
