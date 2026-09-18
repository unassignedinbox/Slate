//============================================================================================================================================
//                                       📦 Engine/ContentInterchange/SpaceSceneCodec.h
//============================================================================================================================================
// 🧩 Runtime Frontier Space scene loader. `.projectspace` may be the original binary FSPC project container or the
// human-authored TOML project manifest; both resolve binary `.geometry` payloads and TOML/FSPC `.material` payloads into
// SceneStructure without routing through a glTF decoder.
#pragma once

#include "SceneCodec.h"

namespace Frontier
{
    class SpaceSceneCodec
    {
    public:
        [[nodiscard]] static bool Decode(const std::string& Path, SceneStructure& Out, TextureIndex* Textures,
                                         const SceneDecodeConfiguration& Config, std::string* Error) noexcept;
    };
}
