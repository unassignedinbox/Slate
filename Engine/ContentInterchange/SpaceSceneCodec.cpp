//============================================================================================================================================
//                                       📦 Engine/ContentInterchange/SpaceSceneCodec.cpp
//============================================================================================================================================
#include "SpaceSceneCodec.h"

#include "SpaceCodec.h"
#include "SpaceToml.h"
#include "../GeometricRaster/GeometryStructure.h"

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <utility>
#include <vector>

namespace Frontier
{
namespace
{
    constexpr uint32_t kNoIndex = 0xFFFFFFFFu;

    struct CachedMaterial
    {
        uint32_t Index = 0u;
        uint32_t Flags = 0u;
    };

    bool ReadWholeFile(const std::filesystem::path& Path, std::vector<uint8_t>& Out, std::string& Error)
    {
        std::ifstream Stream(Path, std::ios::binary | std::ios::ate);
        if (!Stream) { Error = "cannot open " + Path.string(); return false; }
        const std::streamoff Size = Stream.tellg();
        if (Size <= 0) { Error = Path.string() + " is empty"; return false; }
        Out.resize(static_cast<size_t>(Size));
        Stream.seekg(0);
        Stream.read(reinterpret_cast<char*>(Out.data()), Size);
        if (!Stream) { Error = "cannot read " + Path.string(); return false; }
        return true;
    }

    bool IsContainer(const std::vector<uint8_t>& Bytes)
    {
        return Bytes.size() >= sizeof(kSpaceSignature) && std::memcmp(Bytes.data(), kSpaceSignature, sizeof(kSpaceSignature)) == 0;
    }

    bool CheckContentHash(const std::vector<uint8_t>& Bytes, uint64_t Expected, const std::string& What, std::string& Error)
    {
        if (Expected == 0u || SpaceHash64(Bytes.data(), Bytes.size()) == Expected) return true;
        Error = What + " does not match the content hash recorded by its project";
        return false;
    }

    bool DecodeGeometry(const std::vector<uint8_t>& Bytes, const std::string& Name, GeometryStructure& Out, std::string& Error)
    {
        SpaceReader Reader;
        if (!Reader.Open(Bytes, Error)) { Error = Name + ": " + Error; return false; }
        if (!Reader.Type() || Reader.Type()->Tag != SpaceTag("GEOM"))
        {
            Error = Name + " is not a .geometry Frontier Space container";
            return false;
        }
        const SpaceTableRecord* Mesh = Reader.Find(kTagMesh);
        if (!Mesh) { Error = Name + " has no MESH table"; return false; }
        const std::vector<uint8_t> Payload = Reader.Payload(*Mesh);
        if (Payload.size() < 8u) { Error = Name + " has a short MESH header"; return false; }
        uint32_t VertexCount = 0u, IndexCount = 0u;
        std::memcpy(&VertexCount, Payload.data(), sizeof(VertexCount));
        std::memcpy(&IndexCount, Payload.data() + sizeof(VertexCount), sizeof(IndexCount));
        const size_t VertexBytes = size_t(VertexCount) * sizeof(VertexRecord);
        const size_t IndexBytes = size_t(IndexCount) * sizeof(uint32_t);
        if (VertexCount == 0u || IndexCount == 0u || IndexCount % 3u != 0u || 8u + VertexBytes + IndexBytes != Payload.size())
        {
            Error = Name + " has an invalid MESH count or payload length";
            return false;
        }
        // A FSPC payload is byte-aligned. Materialise typed scratch arrays before inspecting/appending it: casting
        // Payload.data()+8 to VertexRecord* would be misaligned for VertexRecord's 16-byte layout on a strict CPU.
        std::vector<VertexRecord> Vertices(VertexCount);
        std::vector<uint32_t> Indices(IndexCount);
        std::memcpy(Vertices.data(), Payload.data() + 8u, VertexBytes);
        std::memcpy(Indices.data(), Payload.data() + 8u + VertexBytes, IndexBytes);
        for (uint32_t I = 0u; I < IndexCount; ++I)
        {
            if (Indices[I] >= VertexCount)
            {
                Error = Name + " index " + std::to_string(I) + " references vertex " + std::to_string(Indices[I]) +
                        " of " + std::to_string(VertexCount);
                return false;
            }
        }
        Out.AppendVertices(Vertices.data(), VertexCount);
        Out.AppendIndices(Indices.data(), IndexCount);
        return true;
    }

    bool DecodeBinaryMaterial(const std::vector<uint8_t>& Bytes, const std::string& Name, MaterialDescriptor& Out, std::string& Error)
    {
        SpaceReader Reader;
        if (!Reader.Open(Bytes, Error)) { Error = Name + ": " + Error; return false; }
        if (!Reader.Type() || Reader.Type()->Tag != SpaceTag("MATL"))
        {
            Error = Name + " is not a .material Frontier Space container";
            return false;
        }
        const SpaceTableRecord* Table = Reader.Find(kTagMatl);
        if (!Table) { Error = Name + " has no MATL table"; return false; }
        const std::vector<uint8_t> Payload = Reader.Payload(*Table);
        if (Payload.size() < sizeof(MaterialRecord) + sizeof(uint32_t)) { Error = Name + " has a short MATL table"; return false; }
        MaterialRecord Record{};
        uint32_t SlabCount = 0u;
        std::memcpy(&Record, Payload.data(), sizeof(Record));
        std::memcpy(&SlabCount, Payload.data() + sizeof(Record), sizeof(SlabCount));
        if (SlabCount == 0u || sizeof(Record) + sizeof(SlabCount) + size_t(SlabCount) * sizeof(MaterialSlabRecord) != Payload.size())
        {
            Error = Name + " has an invalid MATL slab range";
            return false;
        }

        Out = MaterialDescriptor{};
        std::string MetaError;
        Out.Name = Reader.MetaName(MetaError);
        if (Out.Name.empty()) Out.Name = std::filesystem::path(Name).stem().string();
        Out.Flags = Record.Flags & (MaterialFlagDoubleSided | MaterialFlagAlphaMask | MaterialFlagAlphaTranslucent | MaterialFlagUnlit | MaterialFlagThinWalled);
        Out.AlphaCutoff = Record.AlphaCutoff;
        constexpr size_t FloatPrefix = offsetof(MaterialSlabRecord, SlabFlags);
        static_assert(FloatPrefix == offsetof(MaterialSlabDescriptor, GeometryThinWalled), "resident and authored material float prefixes must match");
        for (uint32_t I = 0u; I < SlabCount; ++I)
        {
            MaterialSlabRecord Stored{};
            std::memcpy(&Stored, Payload.data() + sizeof(Record) + sizeof(SlabCount) + size_t(I) * sizeof(Stored), sizeof(Stored));
            MaterialSlabDescriptor Slab{};
            // Both records deliberately begin with the same 58 float OpenPBR values. Copy float-by-float rather
            // than byte-copying a non-trivial descriptor (it owns texture-reference value members after this prefix).
            const float* StoredFloats = reinterpret_cast<const float*>(&Stored);
            float* AuthoredFloats = &Slab.BaseWeight;
            for (size_t F = 0u; F < FloatPrefix / sizeof(float); ++F) AuthoredFloats[F] = StoredFloats[F];
            Slab.GeometryThinWalled = (Stored.SlabFlags & 1u) != 0u;
            Slab.SlateAnisotropyRotation = Stored.AnisotropyRotation;
            Slab.SlateDirectF0Weight = Stored.DirectF0Weight;
            Out.Slabs.push_back(Slab);
        }
        return true;
    }

    bool LoadMaterialFile(const std::filesystem::path& Path, MaterialDescriptor& Out,
                          std::vector<SpaceTomlTexture>& OutTextures, std::string& Error)
    {
        OutTextures.clear();
        std::vector<uint8_t> Bytes;
        if (!ReadWholeFile(Path, Bytes, Error)) return false;
        if (IsContainer(Bytes)) return DecodeBinaryMaterial(Bytes, Path.string(), Out, Error);
        SpaceTomlMaterial Material;
        if (!SpaceTomlReadMaterialDocumentFile(Path.string(), Material, Error)) return false;
        Out = std::move(Material.Descriptor);
        OutTextures = std::move(Material.Textures);
        return true;
    }

    bool BindTomlTextures(MaterialDescriptor& Material, const std::vector<SpaceTomlTexture>& References,
                          const std::filesystem::path& MaterialPath, TextureIndex* Textures, std::string& Error)
    {
        if (References.empty()) return true;
        if (!Textures)
        {
            Error = MaterialPath.string() + " has authored texture references but no TextureIndex was supplied";
            return false;
        }
        for (const SpaceTomlTexture& Reference : References)
        {
            if (Reference.Slab >= Material.Slabs.size())
            {
                Error = MaterialPath.string() + " has a texture reference outside its slab range";
                return false;
            }
            const std::filesystem::path TexturePath = (MaterialPath.parent_path() / Reference.Path).lexically_normal();
            TextureReference& Target = Material.Slabs[Reference.Slab].Texture(Reference.Channel);
            Target.Texture = Textures->RegisterPath(TexturePath.string(), Reference.Linear);
            Target.UvSet = Reference.UvSet;
            Target.Channel = Reference.Component;
            Target.OffsetU = Reference.OffsetU;
            Target.OffsetV = Reference.OffsetV;
            Target.ScaleU = Reference.ScaleU;
            Target.ScaleV = Reference.ScaleV;
            Target.Rotation = Reference.Rotation;
            Target.Scalar = Reference.Scalar;
        }
        return true;
    }

    bool ResolveEnvironment(const std::filesystem::path& Path, SceneStructure& Out, TextureIndex* Textures, std::string& Error)
    {
        SpaceTomlEnvironment Authored;
        if (!SpaceTomlReadEnvironmentFile(Path.string(), Authored, Error)) return false;
        SceneEnvironmentRecord Resident;
        Resident.Name = Authored.Name;
        Resident.SunHour = Authored.SunHour;
        Resident.FogDensity = Authored.FogDensity;
        Resident.AtmosphereScale = Authored.AtmosphereScale;
        Resident.MoonPhase = Authored.MoonPhase;
        Resident.SkyProbeLevels = Authored.SkyProbeLevels;
        if (!Authored.Terrain.empty())
        {
            const std::filesystem::path Terrain = (Path.parent_path() / Authored.Terrain).lexically_normal();
            std::vector<uint8_t> Bytes;
            if (!ReadWholeFile(Terrain, Bytes, Error)) return false;
            SpaceReader Reader;
            if (!Reader.Open(Bytes, Error) || !Reader.Type() || Reader.Type()->Tag != SpaceTag("GEOM"))
            {
                Error = Terrain.string() + " is not the .geometry terrain named by " + Path.string();
                return false;
            }
            Resident.TerrainPath = Terrain.string();
        }
        if (!Authored.SkyProbe.empty())
        {
            const std::filesystem::path Probe = (Path.parent_path() / Authored.SkyProbe).lexically_normal();
            Resident.SkyProbePath = Probe.string();
            if (Textures) Resident.SkyProbeTexture = Textures->RegisterPath(Probe.string(), /*Linear=*/false);
        }
        Out.AssignEnvironment(std::move(Resident));
        return true;
    }

    Matrix4x4 MatrixFrom(const float Source[16], float UniformScale)
    {
        Matrix4x4 Out{};
        std::memcpy(Out.Columns, Source, sizeof(float) * 16u);
        // SceneCodec applies a uniform scale to its imported scene. Do the same here for both the basis and translation,
        // preserving the authoring transform while allowing the compatibility --scale flag to keep its meaning.
        if (UniformScale != 1.0f)
            for (uint32_t Column = 0u; Column < 4u; ++Column)
                for (uint32_t Row = 0u; Row < 3u; ++Row) Out.Columns[Column][Row] *= UniformScale;
        return Out;
    }

    bool AddInstance(SceneStructure& Out, const std::string& Name, const std::vector<uint8_t>& GeometryBytes,
                     MaterialDescriptor Material, uint64_t MaterialIdentity, const float Transform[16], uint32_t SpaceFlags,
                     const SceneDecodeConfiguration& Config, std::map<uint64_t, CachedMaterial>& Materials, std::string& Error)
    {
        GeometryStructure Geometry;
        if (!DecodeGeometry(GeometryBytes, Name, Geometry, Error)) return false;
        // The manifest path (or the FSPC content hash) is the identity. Material names are labels and are intentionally
        // not used as keys: two independently authored files may legitimately share a display name.
        auto Existing = Materials.find(MaterialIdentity);
        CachedMaterial Cached{};
        if (Existing == Materials.end())
        {
            Cached.Index = Out.RegisterMaterial(Material);
            Cached.Flags = Material.Flags;
            Materials.emplace(MaterialIdentity, Cached);
        }
        else Cached = Existing->second;

        uint32_t Flags = 0u;
        if (Cached.Flags & MaterialFlagDoubleSided) Flags |= InstanceFlagDoubleSided;
        if ((SpaceFlags & kSpaceInstanceHidden) != 0u) return true; // hidden content remains out of the runtime scene
        Out.RegisterInstance(Geometry, MatrixFrom(Transform, Config.UniformScale), Cached.Index, Flags);
        return true;
    }

    bool DecodeTomlProject(const std::filesystem::path& Path, SceneStructure& Out, TextureIndex* Textures,
                           const SceneDecodeConfiguration& Config, std::string& Error)
    {
        SpaceTomlProject Project;
        if (!SpaceTomlReadProjectFile(Path.string(), Project, Error)) return false;
        const std::string Selected = Config.LevelName.empty() ? Project.DefaultLevel : Config.LevelName;
        const auto HasLevel = [&](const std::string& Name)
        {
            return std::any_of(Project.Levels.begin(), Project.Levels.end(), [&](const SpaceTomlLevel& Level) { return Level.Name == Name; });
        };
        if (!HasLevel(Selected))
        {
            Error = Path.string() + ": no level named '" + Selected + "'";
            return false;
        }
        const std::filesystem::path ProjectBase = Path.parent_path();
        std::map<uint64_t, CachedMaterial> Materials;
        size_t Loaded = 0u;
        const auto LoadInstance = [&](const SpaceTomlInstance& Instance, const std::filesystem::path& Base) -> bool
        {
            if (!HasLevel(Instance.Level))
            {
                Error = Path.string() + ": instance '" + Instance.Name + "' names undeclared level '" + Instance.Level + "'";
                return false;
            }
            if (Instance.Level != Selected) return true;
            const std::filesystem::path GeometryPath = (Base / Instance.Geometry).lexically_normal();
            const std::filesystem::path MaterialPath = (Base / Instance.Material).lexically_normal();
            std::vector<uint8_t> Geometry;
            if (!ReadWholeFile(GeometryPath, Geometry, Error)) return false;
            MaterialDescriptor Material;
            std::vector<SpaceTomlTexture> MaterialTextures;
            if (!LoadMaterialFile(MaterialPath, Material, MaterialTextures, Error)) return false;
            if (!BindTomlTextures(Material, MaterialTextures, MaterialPath, Textures, Error)) return false;
            const std::string IdentityPath = MaterialPath.generic_string();
            const uint64_t MaterialIdentity = SpaceHash64(IdentityPath.data(), IdentityPath.size());
            if (!AddInstance(Out, Instance.Name, Geometry, std::move(Material), MaterialIdentity, Instance.Transform,
                             Instance.Flags, Config, Materials, Error)) return false;
            ++Loaded;
            return true;
        };

        for (const SpaceTomlInstance& Instance : Project.Instances)
            if (!LoadInstance(Instance, ProjectBase)) return false;
        for (const std::string& InstanceFile : Project.InstanceFiles)
        {
            const std::filesystem::path InstancePath = (ProjectBase / InstanceFile).lexically_normal();
            SpaceTomlInstance Instance;
            if (!SpaceTomlReadInstanceFile(InstancePath.string(), Instance, Error)) return false;
            if (!LoadInstance(Instance, InstancePath.parent_path())) return false;
        }
        if (Loaded == 0u) { Error = Path.string() + ": level '" + Selected + "' has no instances"; return false; }
        if (!Project.Environment.empty() && !ResolveEnvironment((ProjectBase / Project.Environment).lexically_normal(), Out, Textures, Error)) return false;
        Out.Finalise(std::max(1u, Config.SlabLimit));
        Out.AssignName(Selected);
        return true;
    }

    bool ReadSlotMaterial(const SpaceReader& Project, const SpaceMaterialSlot& Slot, const std::filesystem::path& Base,
                          TextureIndex* Textures, MaterialDescriptor& Out, std::string& Error)
    {
        std::vector<uint8_t> Bytes;
        if ((Slot.Mode == kSpaceMaterialCopied || Slot.Mode == kSpaceMaterialCopyOnWrite) && Slot.BlobIndex != kNoIndex)
        {
            if (!Project.BlobBytes(Slot.BlobIndex, Bytes, Error)) return false;
            if (!CheckContentHash(Bytes, Slot.MaterialHash, "embedded material", Error)) return false;
            return DecodeBinaryMaterial(Bytes, "embedded material", Out, Error);
        }
        std::string Path;
        if (!(Slot.Mode == kSpaceMaterialShared || Slot.Mode == kSpaceMaterialCopyOnWrite) ||
            (Path = Project.TableString(kTagMslT, Slot.PathOffset, Error)).empty())
        {
            if (Error.empty()) Error = "a material slot has no shared path or embedded payload";
            return false;
        }
        const std::filesystem::path MaterialPath = Base / Path;
        std::vector<SpaceTomlTexture> MaterialTextures;
        if (!LoadMaterialFile(MaterialPath, Out, MaterialTextures, Error) ||
            !BindTomlTextures(Out, MaterialTextures, MaterialPath, Textures, Error)) return false;
        if (Slot.MaterialHash != 0u)
        {
            if (!ReadWholeFile(MaterialPath, Bytes, Error) || !CheckContentHash(Bytes, Slot.MaterialHash, MaterialPath.string(), Error)) return false;
        }
        return true;
    }

    bool DecodeBinaryProject(const std::filesystem::path& Path, const std::vector<uint8_t>& Bytes,
                             SceneStructure& Out, TextureIndex* Textures, const SceneDecodeConfiguration& Config, std::string& Error)
    {
        SpaceReader Project;
        if (!Project.Open(Bytes, Error)) return false;
        if (!Project.Type() || Project.Type()->Tag != SpaceTag("PROJ"))
        {
            Error = Path.string() + " is not a .projectspace container";
            return false;
        }
        if (!Project.ReadBlobs(Error)) return false;
        const std::vector<SpaceLevelRow> Levels = Project.Levels(Error);
        if (!Error.empty() || Levels.empty()) { if (Error.empty()) Error = "project has no SCEN levels"; return false; }
        const std::string DefaultLevel = SpaceGetName(Levels.front().Name, sizeof(Levels.front().Name));
        const std::string Selected = Config.LevelName.empty() ? DefaultLevel : Config.LevelName;
        const auto Chosen = std::find_if(Levels.begin(), Levels.end(), [&](const SpaceLevelRow& L) { return SpaceGetName(L.Name, sizeof(L.Name)) == Selected; });
        if (Chosen == Levels.end()) { Error = Path.string() + ": no level named '" + Selected + "'"; return false; }
        const std::vector<SpaceInstanceRow> Instances = Project.Instances(Error);
        if (!Error.empty()) return false;
        const std::vector<SpaceReferenceRecord> References = Project.References(Error);
        if (!Error.empty()) return false;
        const std::vector<SpaceMaterialSlot> Slots = Project.MaterialSlots(Error);
        if (!Error.empty()) return false;
        if (size_t(Chosen->FirstInstance) + Chosen->InstanceCount > Instances.size())
        {
            Error = Path.string() + ": level '" + Selected + "' has an invalid instance range";
            return false;
        }

        const std::filesystem::path Base = Path.parent_path();
        std::map<uint64_t, CachedMaterial> Materials;
        for (uint32_t I = 0u; I < Chosen->InstanceCount; ++I)
        {
            const SpaceInstanceRow& Instance = Instances[Chosen->FirstInstance + I];
            if (Instance.GeometryRef >= References.size() || Instance.MaterialSlot >= Slots.size())
            {
                Error = Path.string() + ": instance '" + SpaceGetName(Instance.Name, sizeof(Instance.Name)) + "' has an invalid reference";
                return false;
            }
            const SpaceReferenceRecord& Reference = References[Instance.GeometryRef];
            if (Reference.Type != SpaceTag("GEOM")) { Error = "instance geometry reference is not GEOM"; return false; }
            std::vector<uint8_t> Geometry;
            if (!SpaceLoadReference(Project, Reference, Base.string(), {}, Geometry, Error)) return false;
            if (!CheckContentHash(Geometry, Reference.ContentHash, "geometry reference", Error)) return false;
            MaterialDescriptor Material;
            if (!ReadSlotMaterial(Project, Slots[Instance.MaterialSlot], Base, Textures, Material, Error)) return false;
            const uint64_t MaterialIdentity = Slots[Instance.MaterialSlot].MaterialHash != 0u
                                                ? Slots[Instance.MaterialSlot].MaterialHash
                                                : static_cast<uint64_t>(Instance.MaterialSlot) + 1u;
            if (!AddInstance(Out, SpaceGetName(Instance.Name, sizeof(Instance.Name)), Geometry, std::move(Material), MaterialIdentity,
                             Instance.Transform, Instance.Flags, Config, Materials, Error)) return false;
        }
        Out.Finalise(std::max(1u, Config.SlabLimit));
        Out.AssignName(Selected);
        return true;
    }
}

bool SpaceSceneCodec::Decode(const std::string& Path, SceneStructure& Out, TextureIndex* Textures,
                             const SceneDecodeConfiguration& Config, std::string* Error) noexcept
{
    std::string LocalError;
    Out.Clear();
    const std::filesystem::path File(Path);
    std::vector<uint8_t> Bytes;
    if (!ReadWholeFile(File, Bytes, LocalError))
    {
        if (Error) *Error = LocalError;
        return false;
    }
    const bool Loaded = IsContainer(Bytes) ? DecodeBinaryProject(File, Bytes, Out, Textures, Config, LocalError)
                                           : DecodeTomlProject(File, Out, Textures, Config, LocalError);
    if (!Loaded) Out.Clear();
    if (Error) *Error = LocalError;
    return Loaded;
}
} // namespace Frontier
