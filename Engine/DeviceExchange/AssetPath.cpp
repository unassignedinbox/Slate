#include "AssetPath.h"

#include <system_error>

#if defined(_WIN32)
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <windows.h>
#elif defined(__APPLE__)
    #include <mach-o/dyld.h>
#else
    #include <unistd.h>
#endif

namespace Frontier
{
std::filesystem::path QueryExecutableDirectory()
{
#if defined(_WIN32)
    wchar_t Buffer[MAX_PATH]{};
    const DWORD Length = GetModuleFileNameW(nullptr, Buffer, MAX_PATH);
    if (Length == 0u) return {};
    return std::filesystem::path(Buffer).parent_path();
#elif defined(__APPLE__)
    char     Buffer[4096]{};
    uint32_t Size = sizeof(Buffer);
    if (_NSGetExecutablePath(Buffer, &Size) != 0) return {};
    return std::filesystem::path(Buffer).parent_path();
#else
    char Buffer[4096]{};
    const ssize_t Length = readlink("/proc/self/exe", Buffer, sizeof(Buffer) - 1u);
    if (Length <= 0) return {};
    return std::filesystem::path(std::string(Buffer, static_cast<size_t>(Length))).parent_path();
#endif
}

namespace
{
// Walk `Start` and its parents looking for `Relative`. Root stops the walk on every platform (parent_path of the root
//    is itself), and the depth cap is a second belt: a malformed relative path must not spin.
std::filesystem::path SearchUpwards(const std::filesystem::path& Start, const std::string& Relative)
{
    std::error_code Error;
    std::filesystem::path Probe = Start;
    for (int Depth = 0; Depth < 12 && !Probe.empty(); ++Depth)
    {
        const std::filesystem::path Candidate = Probe / Relative;
        if (std::filesystem::exists(Candidate, Error)) return Candidate;
        const std::filesystem::path Parent = Probe.parent_path();
        if (Parent == Probe) break;
        Probe = Parent;
    }
    return {};
}

std::filesystem::path Resolve(const std::string& Relative)
{
    if (Relative.empty()) return Relative;

    std::error_code Error;
    // ① as given — the sandbox and any shell started in the repository root take this branch.
    if (std::filesystem::exists(Relative, Error)) return Relative;

    // ② next to the executable and up its parents — the double-clicked / launcher-started case.
    if (const std::filesystem::path Found = SearchUpwards(QueryExecutableDirectory(), Relative); !Found.empty())
        return Found;

    // ③ the target's own parents — covers a caller that passed something already partly qualified (useful when the
    //    executable directory query fails, which the platform branches report as an empty path).
    if (const std::filesystem::path Found = SearchUpwards(std::filesystem::path(Relative).parent_path(), Relative);
        !Found.empty())
        return Found;

    return Relative;   // unchanged: the caller's message will name what it asked for
}
}   // namespace

std::filesystem::path ResolveAssetPath(const std::string& RelativePath) { return Resolve(RelativePath); }
std::filesystem::path ResolveAssetDirectory(const std::string& RelativePath) { return Resolve(RelativePath); }
}   // namespace Frontier
