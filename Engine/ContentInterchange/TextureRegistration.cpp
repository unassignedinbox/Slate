//============================================================================================================================================
//                                         📦 Engine/ContentInterchange/TextureRegistration.cpp
//============================================================================================================================================
// 🧩 Texture path and byte registration, kept separate from stb_image decoding so content codecs and CPU format proofs
// can make material maps resident by slot without requiring an image decoder or graphics SDK.
#include "TextureIndex.h"

#include <cstring>
#include <utility>

namespace Frontier {

uint32_t TextureIndex::RegisterPath(const std::string& Path, bool Linear) noexcept
{
    for (uint32_t I = 0u; I < Textures.size(); ++I)
        if (!Textures[I].Path.empty() && Textures[I].Path == Path && Textures[I].Linear == Linear) return I;
    TextureDescriptor T;
    T.Name = Path; T.Path = Path; T.Linear = Linear;
    T.Encoding = Linear ? TextureEncoding::Linear8 : TextureEncoding::Srgb8;
    Textures.push_back(std::move(T));
    Sources.emplace_back();
    return static_cast<uint32_t>(Textures.size() - 1u);
}

uint32_t TextureIndex::RegisterEncoded(const std::string& Name, const uint8_t* Bytes, size_t ByteCount, bool Linear) noexcept
{
    for (uint32_t I = 0u; I < Textures.size(); ++I)
        if (Textures[I].Path.empty() && Textures[I].Name == Name && Textures[I].Linear == Linear && Sources[I].Encoded.size() == ByteCount
            && std::memcmp(Sources[I].Encoded.data(), Bytes, ByteCount) == 0) return I;
    TextureDescriptor T;
    T.Name = Name; T.Linear = Linear;
    T.Encoding = Linear ? TextureEncoding::Linear8 : TextureEncoding::Srgb8;
    Textures.push_back(std::move(T));
    Pending P; P.Encoded.assign(Bytes, Bytes + ByteCount);
    Sources.push_back(std::move(P));
    return static_cast<uint32_t>(Textures.size() - 1u);
}

void TextureIndex::Clear() noexcept
{
    Textures.clear();
    Sources.clear();
    Metrics = TextureIndexMetrics{};
}

} // namespace Frontier
