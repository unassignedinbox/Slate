//=============================================================================================================================================
// IconPresentationStub.cpp
//=============================================================================================================================================
// Lightweight icon presentation for headless editor proofs. The shipping/runtime build links the real ThorVG-backed
// IconPresentation.cpp; CPU editor proofs only need a stable fallback path so the outliner can draw its vector glyphs
// while tab chrome and the Control Centre notch are validated without pulling in ThorVG.

#include "IconPresentation.h"

namespace Frontier {

void IconPresentation::Attach(const std::filesystem::path&) {}

bool IconPresentation::Draw(ImDrawList*, IconSymbol, ImVec2, float, float)
{
    return false;
}

IconResult IconPresentation::Result(IconSymbol)
{
    return IconResult::InvalidRequest;
}

const char* IconPresentation::Diagnostic(IconSymbol)
{
    return "Icon atlas is disabled in the headless editor proof; vector glyph fallback is expected.";
}

const char* IconArt::Filename(IconSymbol) noexcept
{
    return "";
}

const char* IconArt::Name(IconSymbol) noexcept
{
    return "Icon";
}

const char* IconArt::ResultName(IconResult Result) noexcept
{
    switch (Result)
    {
    case IconResult::Ready:          return "ready";
    case IconResult::Unsupported:    return "unsupported";
    case IconResult::Missing:        return "missing";
    case IconResult::DecodeFailure:  return "decode-failure";
    case IconResult::InvalidRequest: return "invalid-request";
    case IconResult::RuntimeFailure: return "runtime-failure";
    default:                         return "unknown";
    }
}

} // namespace Frontier
