//============================================================================================================================================
//                                           📦 Engine/ContentInterchange/SpaceToml.h
//============================================================================================================================================
// 🧩 Human-authored Frontier Space manifests. The raw scene payload remains binary FSPC (.geometry and packed blobs),
// while `.projectspace` and authored `.material` files are conventional TOML text. This header carries only authoring
// data and MaterialDescriptor: no Vulkan header, device object, or renderer dependency is allowed here.
#pragma once

#include "MaterialDescriptor.h"
#include "SpaceFormat.h"

#include <string>
#include <vector>

namespace Frontier
{
    inline constexpr const char* kSpaceTomlProjectFormat = "FrontierProjectSpace";
    inline constexpr const char* kSpaceTomlMaterialFormat = "FrontierMaterial";
    inline constexpr const char* kSpaceTomlInstanceFormat = "FrontierInstance";
    inline constexpr const char* kSpaceTomlEnvironmentFormat = "FrontierEnvironment";
    inline constexpr uint32_t    kSpaceTomlRevision = 1u;

    struct SpaceTomlLevel
    {
        std::string Name;
    };

    // One placed object. Project files may carry these inline or name a standalone `.instance` source file.
    struct SpaceTomlInstance
    {
        std::string Name;
        std::string Level;
        std::string Geometry;       // relative `.geometry` FSPC payload
        std::string Material;       // relative TOML or FSPC `.material` payload
        uint8_t     MaterialMode = kSpaceMaterialCopyOnWrite;
        uint32_t    Flags = kSpaceInstanceCastShadow;
        float       Transform[16] = { 1.0f, 0.0f, 0.0f, 0.0f,
                                      0.0f, 1.0f, 0.0f, 0.0f,
                                      0.0f, 0.0f, 1.0f, 0.0f,
                                      0.0f, 0.0f, 0.0f, 1.0f };
    };

    // A material map stays named by path in authored TOML until the runtime registers it in TextureIndex. `Slab` and
    // `Channel` select the MaterialDescriptor::Textures entry that receives the resident texture slot.
    struct SpaceTomlTexture
    {
        uint32_t               Slab = 0u;
        MaterialTextureChannel Channel = MaterialTextureChannel::BaseColor;
        std::string            Path;          // relative to the `.material` source
        bool                   Linear = false; // true for data maps (normal, roughness, masks…)
        uint8_t                UvSet = 0u;
        TextureChannelSelection Component = TextureChannelSelection::Rgb;
        float                  OffsetU = 0.0f, OffsetV = 0.0f;
        float                  ScaleU = 1.0f, ScaleV = 1.0f;
        float                  Rotation = 0.0f;
        float                  Scalar = 1.0f;
    };

    struct SpaceTomlMaterial
    {
        MaterialDescriptor            Descriptor;
        std::vector<SpaceTomlTexture> Textures;
    };

    // CPU-resident world staging. Paths are resolved relative to the `.environment` file. The sky probe is registered
    // with TextureIndex by the project loader, while terrain remains an explicit geometry reference for its owner.
    struct SpaceTomlEnvironment
    {
        std::string Name;
        float       SunHour = 12.0f;
        float       FogDensity = 0.0f;
        float       AtmosphereScale = 1.0f;
        float       MoonPhase = 0.0f;
        std::string Terrain;
        std::string SkyProbe;
        uint32_t    SkyProbeLevels = 0u;
    };

    struct SpaceTomlProject
    {
        std::string Name;
        std::string DefaultLevel;
        std::string Environment;              // optional relative `.environment` document
        std::vector<std::string>     InstanceFiles; // optional relative `.instance` documents
        std::vector<SpaceTomlLevel>    Levels;
        std::vector<SpaceTomlInstance> Instances;
    };

    // The product build defines FRONTIER_USE_TOMLPP and parses every authored file with the repository's toml++
    // dependency. The CPU proof deliberately keeps a narrow Space-profile fallback so it remains buildable before
    // third-party submodules are materialised; it is not a replacement for toml++'s full TOML grammar.
    [[nodiscard]] bool SpaceTomlReadProjectFile(const std::string& Path, SpaceTomlProject& Out, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlReadInstanceFile(const std::string& Path, SpaceTomlInstance& Out, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlReadEnvironmentFile(const std::string& Path, SpaceTomlEnvironment& Out, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlReadMaterialDocumentFile(const std::string& Path, SpaceTomlMaterial& Out, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlReadMaterialFile(const std::string& Path, MaterialDescriptor& Out, std::string& OutError) noexcept;

    // Deterministic writers used by the editor/build tools. A written file is valid input to the corresponding reader.
    [[nodiscard]] bool SpaceTomlWriteProjectFile(const std::string& Path, const SpaceTomlProject& Project, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlWriteInstanceFile(const std::string& Path, const SpaceTomlInstance& Instance, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlWriteEnvironmentFile(const std::string& Path, const SpaceTomlEnvironment& Environment, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlWriteMaterialFile(const std::string& Path, const MaterialDescriptor& Material, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlWriteMaterialDocumentFile(const std::string& Path, const SpaceTomlMaterial& Material, std::string& OutError) noexcept;
}
