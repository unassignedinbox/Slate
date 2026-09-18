//============================================================================================================================================
//                                                        CONTENTCODEC.H
//============================================================================================================================================
// 🧩 Format dispatcher (ContentInterchange): picks Slate's Space project loader (.projectspace) or an interchange
//    importer (glTF/GLB, FBX, OBJ) from the file extension so callers hold one entry point. glTF is retained for
//    authoring import and compatibility; Project-Zero starts from its Slate-owned project manifest.

#pragma once

#include "SceneCodec.h"

namespace Frontier {

enum class ContentFormatCategory : uint8_t { Unknown = 0, FrontierSpace, Gltf, Fbx, Obj };

class ContentCodec
{
public:
    [[nodiscard]] static ContentFormatCategory Classify(const std::string& Path) noexcept;
    [[nodiscard]] static const char*           NameOf(ContentFormatCategory Format) noexcept;
    // Decodes by extension. Unknown extensions fail with an explanatory `Error`.
    [[nodiscard]] static bool Decode(const std::string& Path, SceneStructure& Out, TextureIndex* Textures, const SceneDecodeConfiguration& Config, std::string* Error) noexcept;
};

} // namespace Frontier
