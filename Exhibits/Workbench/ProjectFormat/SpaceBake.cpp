//============================================================================================================================================
//                       📦 Exhibits/Workbench/ProjectFormat/SpaceBake.cpp — Slate project-content baker
//============================================================================================================================================
// Builds the checked-in Project-Zero default from its procedural Showcase authoring source without producing or reading a
// glTF file. The output is a human-authored TOML `.projectspace`, TOML `.material` files, and checksummed binary FSPC
// `.geometry` payloads. This is a content-build tool, never a runtime fallback.
#include "SpaceExport.h"
#include "SpaceToml.h"
#include "ShowcaseStructure.h"
#include "GeometryStructure.h"
#include "TriangleIndex.h"
#include "OrientationClassifier.h"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace Frontier;

namespace
{
    struct BakedObject
    {
        std::string Name;
        std::vector<VertexRecord> Vertices;
        std::vector<uint32_t> Indices;
        uint32_t Material = 0u;
        bool Dynamic = false;
    };

    std::string Sanitise(const std::string& Name)
    {
        std::string Out;
        for (char C : Name)
        {
            const bool Valid = (C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') || (C >= '0' && C <= '9') || C == '_' || C == '-';
            Out.push_back(Valid ? C : '_');
        }
        return Out.empty() ? "unnamed" : Out;
    }

    bool WriteBinary(const std::filesystem::path& Path, const std::vector<uint8_t>& Bytes, std::string& Error)
    {
        std::error_code Ec;
        std::filesystem::create_directories(Path.parent_path(), Ec);
        if (Ec) { Error = "cannot create " + Path.parent_path().string() + ": " + Ec.message(); return false; }
        std::ofstream Stream(Path, std::ios::binary | std::ios::trunc);
        if (!Stream) { Error = "cannot write " + Path.string(); return false; }
        Stream.write(reinterpret_cast<const char*>(Bytes.data()), static_cast<std::streamsize>(Bytes.size()));
        if (!Stream.good()) { Error = "cannot finish " + Path.string(); return false; }
        return true;
    }

    uint32_t MaterialOf(const TriangleIndex& Triangle)
    {
        uint32_t Material = 0u;
        std::memcpy(&Material, &Triangle.MaterialSlot, sizeof(Material));
        return Material;
    }

    uint32_t AddVertex(BakedObject& Object, const Vector3& Position, const Vector3& Normal, float U, float V,
                       std::unordered_map<std::string, uint32_t>& Dedup)
    {
        VertexRecord Vertex{};
        Vertex.SpatialLocation = Position;
        Vertex.NormalDirection = Normal;
        Vertex.TangentDirection = Vector4{ 1.0f, 0.0f, 0.0f, 1.0f };
        Vertex.TextureCoordinateU = U;
        Vertex.TextureCoordinateV = V;
        const std::string Key(reinterpret_cast<const char*>(&Vertex), sizeof(Vertex));
        const auto Existing = Dedup.find(Key);
        if (Existing != Dedup.end()) return Existing->second;
        const uint32_t Index = static_cast<uint32_t>(Object.Vertices.size());
        Object.Vertices.push_back(Vertex);
        Dedup.emplace(Key, Index);
        return Index;
    }

    bool BakeObject(const std::vector<TriangleIndex>& Triangles, const std::vector<Vector3>& Normals,
                    const TriangleSpanRecord& Span, BakedObject& Out, std::string& Error)
    {
        Out = BakedObject{};
        Out.Name = Span.Name;
        Out.Dynamic = Span.Dynamic;
        if (Span.TriangleCount == 0u || size_t(Span.FirstTriangle) + Span.TriangleCount > Triangles.size())
        {
            Error = "span '" + Span.Name + "' has no valid triangle range";
            return false;
        }
        std::unordered_map<std::string, uint32_t> Dedup;
        for (uint32_t T = 0u; T < Span.TriangleCount; ++T)
        {
            const size_t TriangleAt = size_t(Span.FirstTriangle) + T;
            const TriangleIndex& Triangle = Triangles[TriangleAt];
            const uint32_t Material = MaterialOf(Triangle);
            if (T == 0u) Out.Material = Material;
            else if (Material != Out.Material)
            {
                Error = "span '" + Span.Name + "' uses more than one material; split it before baking";
                return false;
            }
            const Vector3 Positions[3] = {
                { Triangle.VertexAlphaX, Triangle.VertexAlphaY, Triangle.VertexAlphaZ },
                { Triangle.VertexBetaX, Triangle.VertexBetaY, Triangle.VertexBetaZ },
                { Triangle.VertexGammaX, Triangle.VertexGammaY, Triangle.VertexGammaZ }
            };
            const float Uvs[3][2] = {
                { Triangle.TextureAlphaU, Triangle.TextureAlphaV },
                { Triangle.TextureBetaU, Triangle.TextureBetaV },
                { Triangle.TextureGammaU, Triangle.TextureGammaV }
            };
            const Vector3 Face = OrientationClassifier::CrossProduct(Positions[1] - Positions[0], Positions[2] - Positions[0]).Normalized();
            for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
            {
                const Vector3 Normal = Normals.size() == Triangles.size() * 3u ? Normals[TriangleAt * 3u + Corner] : Face;
                Out.Indices.push_back(AddVertex(Out, Positions[Corner], Normal, Uvs[Corner][0], Uvs[Corner][1], Dedup));
            }
        }
        return true;
    }
}

int main(int argc, char** argv)
{
    std::filesystem::path ProjectRoot = "Projects/Project-Zero";
    for (int I = 1; I < argc; ++I)
    {
        const std::string Argument = argv[I];
        constexpr const char Prefix[] = "-Out=";
        if (Argument.rfind(Prefix, 0u) == 0u) ProjectRoot = Argument.substr(sizeof(Prefix) - 1u);
        else if (Argument == "-h" || Argument == "--help")
        {
            std::printf("usage: SpaceBake [-Out=Projects/Project-Zero]\n");
            return 0;
        }
        else { std::fprintf(stderr, "[space-bake] unknown argument: %s\n", Argument.c_str()); return 2; }
    }

    ShowcaseStructure Showcase;
    Showcase.Construct();
    const std::vector<TriangleIndex>& Triangles = Showcase.QueryTriangles();
    const std::vector<Vector3>& Normals = Showcase.QueryCornerNormals();
    const std::vector<MaterialDescriptor>& Materials = Showcase.QueryMaterials();
    const std::vector<TriangleSpanRecord>& Spans = Showcase.QuerySpans();
    if (Triangles.empty() || Materials.empty() || Spans.empty())
    {
        std::fprintf(stderr, "[space-bake] Showcase construction returned no content\n");
        return 1;
    }

    const std::filesystem::path Content = ProjectRoot / "Content" / "Space" / "Showcase";
    SpaceExportContext Context;
    Context.BaseDirectory = ProjectRoot.string();
    Context.Exporter = "SpaceBake";
    Context.BuildConfig = "Development";

    std::vector<std::string> MaterialPaths(Materials.size());
    std::vector<bool> MaterialUsed(Materials.size(), false);
    std::vector<BakedObject> Objects;
    Objects.reserve(Spans.size());
    for (const TriangleSpanRecord& Span : Spans)
    {
        BakedObject Object;
        std::string Error;
        if (!BakeObject(Triangles, Normals, Span, Object, Error))
        {
            std::fprintf(stderr, "[space-bake] %s\n", Error.c_str());
            return 1;
        }
        if (Object.Material >= Materials.size())
        {
            std::fprintf(stderr, "[space-bake] %s refers to material %u of %zu\n", Object.Name.c_str(), Object.Material, Materials.size());
            return 1;
        }
        MaterialUsed[Object.Material] = true;
        Objects.push_back(std::move(Object));
    }

    for (uint32_t I = 0u; I < Materials.size(); ++I)
    {
        if (!MaterialUsed[I]) continue;
        const std::string FileName = Sanitise(Materials[I].Name) + ".material";
        const std::filesystem::path Path = Content / "Materials" / FileName;
        std::string Error;
        if (!SpaceTomlWriteMaterialFile(Path.string(), Materials[I], Error))
        {
            std::fprintf(stderr, "[space-bake] %s\n", Error.c_str());
            return 1;
        }
        MaterialPaths[I] = (std::filesystem::path("Content") / "Space" / "Showcase" / "Materials" / FileName).generic_string();
    }

    SpaceTomlProject Project;
    Project.Name = "Project-Zero";
    Project.DefaultLevel = "Showcase";
    Project.Levels.push_back({ "Showcase" });
    for (uint32_t I = 0u; I < Objects.size(); ++I)
    {
        const BakedObject& Object = Objects[I];
        const std::string FileName = std::to_string(I) + "_" + Sanitise(Object.Name) + ".geometry";
        std::vector<uint8_t> Bytes;
        std::string Error;
        if (!SpaceExportGeometry(Context, Object.Name, Object.Vertices.data(), static_cast<uint32_t>(Object.Vertices.size()),
                                 Object.Indices.data(), static_cast<uint32_t>(Object.Indices.size()), nullptr, 0u, Bytes, Error) ||
            !WriteBinary(Content / "Geometry" / FileName, Bytes, Error))
        {
            std::fprintf(stderr, "[space-bake] %s\n", Error.c_str());
            return 1;
        }
        SpaceTomlInstance Instance;
        Instance.Name = Object.Name;
        Instance.Level = "Showcase";
        Instance.Geometry = (std::filesystem::path("Content") / "Space" / "Showcase" / "Geometry" / FileName).generic_string();
        Instance.Material = MaterialPaths[Object.Material];
        Instance.MaterialMode = kSpaceMaterialCopyOnWrite;
        Instance.Flags = kSpaceInstanceCastShadow | (Object.Dynamic ? kSpaceInstanceDynamic : 0u);
        Project.Instances.push_back(std::move(Instance));
    }

    std::string Error;
    const std::filesystem::path Manifest = ProjectRoot / "Project-Zero.projectspace";
    if (!SpaceTomlWriteProjectFile(Manifest.string(), Project, Error))
    {
        std::fprintf(stderr, "[space-bake] %s\n", Error.c_str());
        return 1;
    }
    std::printf("[space-bake] %s — %zu instances, %zu materials, %zu triangles; no glTF was read or written\n",
                Manifest.string().c_str(), Project.Instances.size(), MaterialPaths.size(), Triangles.size());
    return 0;
}
