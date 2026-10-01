// CPU-only counterpart for the optional ThorVG-backed icon adapter. The SolidArc
// visual proof validates editor chrome and has no ThorVG dependency; production
// builds continue to link IconArt.cpp/IconPresentation.cpp.
#include "IconPresentation.h"
namespace Frontier {
void IconPresentation::Attach(const std::filesystem::path&) {}
bool IconPresentation::Draw(ImDrawList*, IconSymbol, ImVec2, float, float) { return false; }
IconResult IconPresentation::Result(IconSymbol) { return IconResult::Missing; }
const char* IconPresentation::Diagnostic(IconSymbol) { return "CPU proof: icon raster disabled"; }
const char* IconArt::Filename(IconSymbol) noexcept { return ""; }
const char* IconArt::Name(IconSymbol) noexcept { return "icon"; }
const char* IconArt::ResultName(IconResult) noexcept { return "missing"; }
}
