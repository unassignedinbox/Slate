// Lightweight icon provider for the software-only editor proof. The production
// IconArt implementation remains backed by ThorVG; this proof only needs stable
// dimensions so ImGui layout and pointer targets match the real editor.
#include "DisplayPresentation/IconArt.h"

#include <algorithm>
#include <cmath>

namespace Frontier {

struct IconArt::Details {};

IconArt::IconArt(std::filesystem::path, size_t) : Details_(std::make_unique<Details>()) {}
IconArt::~IconArt() = default;

std::shared_ptr<const IconRaster> IconArt::Rasterize(IconSymbol, float LogicalWidth,
    float LogicalHeight, float DisplayScale, IconPolicy) {
    auto Raster = std::make_shared<IconRaster>();
    Raster->Width = static_cast<uint32_t>(std::max(1.0f, std::round(LogicalWidth * DisplayScale)));
    Raster->Height = static_cast<uint32_t>(std::max(1.0f, std::round(LogicalHeight * DisplayScale)));
    Raster->Rgba.assign(static_cast<size_t>(Raster->Width) * Raster->Height * 4u, 0u);
    Raster->Result = IconResult::Ready;
    return Raster;
}

void IconArt::Clear() {}
IconStatistics IconArt::Statistics() const { return {}; }

const char* IconArt::Filename(IconSymbol) noexcept { return "proof.svg"; }
const char* IconArt::Name(IconSymbol) noexcept { return "Proof icon"; }
const char* IconArt::ResultName(IconResult Result) noexcept {
    switch (Result) {
        case IconResult::Ready: return "Ready";
        case IconResult::Unsupported: return "Unsupported";
        case IconResult::Missing: return "Missing";
        case IconResult::DecodeFailure: return "Decode failure";
        case IconResult::InvalidRequest: return "Invalid request";
        case IconResult::RuntimeFailure: return "Runtime failure";
    }
    return "Unknown";
}

} // namespace Frontier
