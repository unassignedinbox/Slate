//============================================================================================================================================
//                                                          ASSETPATH.H
//============================================================================================================================================
// Where a repository-relative asset actually lives at run time.
//
//    The engine's content is addressed the way the repository is laid out — "EngineContent/CelestialTextures/luna_2k.jpg",
//    "Engine/Shaders/ReSTIRViewport.spv", "EngineContent/StarCatalogue/BrightStars.bin" — and the product binary does NOT
//    run from the repository root: the Windows build puts Project-Zero.exe in
//    Projects/Project-Zero/Build/Output/Windows/Release/Binary/ and mirrors it to Build/, and a double-clicked .exe
//    starts with its own directory as the working directory. Any loader that just opens the relative path therefore
//    works when the app is launched from a shell sitting at the repository root and silently degrades otherwise —
//    which is exactly the class of bug the 2026-09-18 Windows run reported: 6 celestial textures "can't fopen -> 1x1
//    placeholder" (the moon rendered textureless) and "Catalogue empty or missing — the night sky renders starless",
//    from a binary the user launched as Build\Project-Zero.exe.
//
//    Search order, first hit wins:
//      ① the path as given (working directory — running from the repository root or in the sandbox)
//      ② next to the executable, then walking UP its parent chain (12 levels: …\Binary, …\Release, …\Windows, …)
//      ③ the target's own parent chain as a further fallback, so an absolute-ish caller still resolves
//
//    This was two private copies (SwapchainExchange's, used for SPIR-V; VisibilityExchange's, used for its own shaders)
//    before it became one function: the content loaders — textures, the star catalogue, the typeface archives — never
//    went through either, which is why only the shaders survived being launched from the wrong directory.

#pragma once

#include <filesystem>
#include <string>

namespace Frontier
{
// The directory the running executable lives in. Empty when the platform query fails.
[[nodiscard]] std::filesystem::path QueryExecutableDirectory();

// Resolve a repository-relative asset path to something that can be opened, searching as described above. Never fails:
// returns the input unchanged when nothing exists, so the caller's own error message names the path it was given.
[[nodiscard]] std::filesystem::path ResolveAssetPath(const std::string& RelativePath);

// Same, for a directory (asset archives: "EngineContent/FontArchives"). Exists separately so the intent is legible at
// the call site; the search is identical.
[[nodiscard]] std::filesystem::path ResolveAssetDirectory(const std::string& RelativePath);
}   // namespace Frontier
