//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/OutlinerPanel.h — Dockable World Outliner, Hierarchy Traversal and Immediate Mode Presentation
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "OutlinerStructure.h"
#include "GlyphSpace.h"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include <set>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER PANEL
//------------------------------------------------------------------------------------------------------------------------

class OutlinerPanel
{
public:
    OutlinerPanel() noexcept;
    ~OutlinerPanel() noexcept = default;

    OutlinerPanel(const OutlinerPanel&)            = delete;
    OutlinerPanel& operator=(const OutlinerPanel&) = delete;

    void                    RegisterRecord(const OutlinerRecord& Record) noexcept;
    void                    UnregisterRecord(std::string_view Identifier) noexcept;
    void                    ClearRecords() noexcept;
    void                    ResetDefaultWorld() noexcept;

    [[nodiscard]] const OutlinerRecord* QueryRecord(std::string_view Identifier) const noexcept;
    [[nodiscard]] OutlinerRecord*       QueryRecord(std::string_view Identifier) noexcept;

    void                    AssignVisibility(std::string_view Identifier, bool Visible) noexcept;
    void                    AssignScope(std::string_view Identifier, std::string_view ScopeIdentifier) noexcept;
    void                    AssignSummary(std::string_view Identifier, std::string_view Summary) noexcept;
    void                    AssignStatus(std::string_view Identifier, OutlinerStatusTone Tone, std::string_view Description) noexcept;

    [[nodiscard]] OutlinerStatRecord QueryStats() const noexcept;
    [[nodiscard]] uint32_t           QueryTotalCount() const noexcept;
    [[nodiscard]] uint32_t           QueryVisibleCount() const noexcept;
    [[nodiscard]] uint32_t           QueryHiddenCount() const noexcept;

    [[nodiscard]] std::string_view   QuerySelectedIdentifier() const noexcept { return SelectedIdentifier; }
    void                             AssignSelectedIdentifier(std::string_view Identifier) noexcept;

    [[nodiscard]] bool               IsCompact() const noexcept { return CompactCondition; }
    void                             AssignCompact(bool Compact) noexcept { CompactCondition = Compact; }

    void                             AssignTelemetry(const OutlinerTelemetryRecord& Telemetry) noexcept { CurrentTelemetry = Telemetry; }
    [[nodiscard]] const OutlinerTelemetryRecord& QueryTelemetry() const noexcept { return CurrentTelemetry; }

    // Renders the dockable ImGui outliner window
    void                    Present(bool* OpenCondition = nullptr) noexcept;

    // Single unified conversion operator
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    void                    RenderHeader() noexcept;
    void                    RenderSceneStats() noexcept;
    void                    RenderSearchBar() noexcept;
    void                    RenderDomainFilters() noexcept;
    void                    RenderHierarchyTree() noexcept;
    void                    RenderTreeBranch(std::string_view ScopeId, uint32_t Depth) noexcept;
    void                    RenderRow(OutlinerRecord& Record, uint32_t Depth, bool HasSubordinates) noexcept;
    void                    RenderFooter() noexcept;

    [[nodiscard]] bool      PassesFilter(const OutlinerRecord& Record) const noexcept;
    [[nodiscard]] bool      HasVisibleDescendant(const OutlinerRecord& Record) const noexcept;
    [[nodiscard]] bool      HasCycle(std::string_view SourceIdentifier, std::string_view TargetIdentifier) const noexcept;

    void                    RenderVectorIcon(void* DrawListOpaque, OutlinerIconCategory Icon, float ScreenX, float ScreenY, float BoxSize, uint32_t ColorRgba, float StrokeThickness = 1.6f) const noexcept;

    std::vector<OutlinerRecord>     Records;
    std::string                     SelectedIdentifier;
    std::set<OutlinerDomainCategory> ActiveDomains;
    char                            SearchBuffer[128];
    bool                            CompactCondition;
    OutlinerTelemetryRecord         CurrentTelemetry;
    bool                            InitializedCondition;
};

template<>
inline OutlinerStatRecord OutlinerPanel::Convert<OutlinerStatRecord>() const noexcept
{
    return QueryStats();
}

template<>
inline uint32_t OutlinerPanel::Convert<uint32_t>() const noexcept
{
    return QueryTotalCount();
}

template<>
inline std::string_view OutlinerPanel::Convert<std::string_view>() const noexcept
{
    return QuerySelectedIdentifier();
}

template<>
inline bool OutlinerPanel::Convert<bool>() const noexcept
{
    return IsCompact();
}

} // namespace Frontier
