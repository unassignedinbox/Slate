//============================================================================================================================================
//                                                 ICONPRESENTATIONCOUNTERPART.CPP
//============================================================================================================================================
// 📦 Dependency-free icon presentation seam for headless editor visual proofs.

#include "DisplayPresentation/IconPresentation.h"

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
    return "Icon presentation is intentionally absent in the CPU proof";
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
        case IconResult::DecodeFailure:  return "decode failure";
        case IconResult::InvalidRequest: return "invalid request";
        case IconResult::RuntimeFailure: return "runtime failure";
    }
    return "invalid request";
}

} // namespace Frontier
