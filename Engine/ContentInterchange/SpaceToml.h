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
    inline constexpr uint32_t    kSpaceTomlRevision = 1u;

    struct SpaceTomlLevel
    {
        std::string Name;
    };

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

    struct SpaceTomlProject
    {
        std::string Name;
        std::string DefaultLevel;
        std::vector<SpaceTomlLevel>    Levels;
        std::vector<SpaceTomlInstance> Instances;
    };

    // Strict TOML-profile readers. They intentionally accept the TOML constructs used by the family (quoted strings,
    // booleans, numbers, one-line arrays, [tables] and [[array tables]]) and reject malformed values with a file/line
    // diagnostic. Unknown keys are retained as forward-compatible data and ignored by this schema revision.
    [[nodiscard]] bool SpaceTomlReadProjectFile(const std::string& Path, SpaceTomlProject& Out, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlReadMaterialFile(const std::string& Path, MaterialDescriptor& Out, std::string& OutError) noexcept;

    // Deterministic writers used by the editor/build tools. A written file is valid input to the corresponding reader.
    [[nodiscard]] bool SpaceTomlWriteProjectFile(const std::string& Path, const SpaceTomlProject& Project, std::string& OutError) noexcept;
    [[nodiscard]] bool SpaceTomlWriteMaterialFile(const std::string& Path, const MaterialDescriptor& Material, std::string& OutError) noexcept;
}
