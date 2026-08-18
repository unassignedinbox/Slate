//============================================================================================================================================
//                                                           WORKSPACEINDEX.CPP
//============================================================================================================================================
// 🧩 Enrolment, withdrawal, the active ordinal, and the title composed exactly once per workspace.

#include "SlateUI/Interface/WorkspacePanel/Api/WorkspaceIndex.h"

#include <cstdio>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE SUBJECTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Defined beside the ledger and not beside the panel. The stem is a property of the SUBJECT, which
//    this component owns; the panel merely draws whatever title it is handed.
const char* WorkspaceStem(WorkspaceSubject Subject)
{
    switch (Subject)
    {
        case WorkspaceSubject::Painting:  return "Canvas";
        case WorkspaceSubject::Modelling: return "Sketch";
        case WorkspaceSubject::Vacant:    return "Workspace";
        default:                          return "Workspace";
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> WorkspaceIndex::Enrol(WorkspaceSubject Subject)
{
    if (OpenOccupancy >= WorkspaceCeiling)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "no more workspaces may be opened at once" });
    }

    const std::uint32_t SubjectOrdinal = static_cast<std::uint32_t>(Subject);

    if (SubjectOrdinal >= static_cast<std::uint32_t>(WorkspaceSubject::SubjectCount))
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such workspace subject" });

    WorkspaceEntry& Enrolled = Open[OpenOccupancy];

    Enrolled.Subject = Subject;

    // 🔴 Never reused. Closing the second canvas and opening another yields a third, because two tabs that
    //    had carried one title within a session make an artist's account of what they were doing ambiguous.
    Enrolled.SubjectOrdinal = ++EnrolledPerSubject[SubjectOrdinal];

    // 🔴 Composed HERE and never again. The sheet titles a tab by stem and ordinal, and composing that per
    //    tick would write into storage the recording is still reading, sixty times a second.
    // 📝 The truncation is not checked: the stems are three known literals and the ordinal is bounded by
    //    the ceiling, so the longest run this can compose is well inside the extent.
    std::snprintf(Enrolled.Titled, sizeof(Enrolled.Titled), "%s %u",
                  WorkspaceStem(Subject), Enrolled.SubjectOrdinal);

    Active = OpenOccupancy;
    ++OpenOccupancy;

    return Deliver<std::uint32_t>::Deliver(Active);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE WITHDRAWAL
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> WorkspaceIndex::Withdraw(std::uint32_t Ordinal)
{
    if (Ordinal >= OpenOccupancy)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no open workspace" });

    // 📝 The order is preserved rather than the last entry being swapped in. The sheet presents its tabs in
    //    the order they were opened, and a swap would move an unrelated tab under the artist's pointer.
    for (std::uint32_t Moving = Ordinal; Moving + 1u < OpenOccupancy; ++Moving)
        Open[Moving] = Open[Moving + 1u];

    --OpenOccupancy;
    Open[OpenOccupancy] = WorkspaceEntry{};

    // ⚠️ The active ordinal follows the withdrawal rather than staying where it was. Left alone it would
    //    name whichever workspace slid into the closed one's place, which is not a choice anybody made.
    if (OpenOccupancy == 0u)
    {
        Active = AbsentWorkspace;
    }
    else if (Active > Ordinal || Active >= OpenOccupancy)
    {
        Active = (Active == 0u) ? 0u : Active - 1u;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> WorkspaceIndex::Present(std::uint32_t Ordinal)
{
    if (Ordinal >= OpenOccupancy)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no open workspace" });

    Active = Ordinal;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE READINGS
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t WorkspaceIndex::OpenCount() const
{
    return OpenOccupancy;
}

Deliver<WorkspaceEntry> WorkspaceIndex::Standing(std::uint32_t Ordinal) const
{
    if (Ordinal >= OpenOccupancy)
    {
        return Deliver<WorkspaceEntry>::Refuse(
            { RefusalReason::IdentityStale, "that ordinal names no open workspace" });
    }

    return Deliver<WorkspaceEntry>::Deliver(Open[Ordinal]);
}

bool WorkspaceIndex::Seated(std::uint32_t Ordinal) const
{
    return (Ordinal < OpenOccupancy) && Open[Ordinal].DockSeated;
}

void WorkspaceIndex::Seat(std::uint32_t Ordinal)
{
    if (Ordinal < OpenOccupancy)
        Open[Ordinal].DockSeated = true;
}

const char* WorkspaceIndex::Titled(std::uint32_t Ordinal) const
{
    if (Ordinal >= OpenOccupancy)
        return nullptr;

    // 📝 Points into the ledger's own storage, which outlives the tick. The delivered form cannot: it
    //    copies the entry, and a pointer taken from that copy dies with the temporary.
    return Open[Ordinal].Titled;
}

std::uint32_t WorkspaceIndex::ActiveOrdinal() const
{
    return Active;
}

const char* WorkspaceIndex::ActiveTitle() const
{
    if (Active >= OpenOccupancy)
        return nullptr;

    return Open[Active].Titled;
}

void WorkspaceIndex::Reset()
{
    for (std::uint32_t Ordinal = 0u; Ordinal < WorkspaceCeiling; ++Ordinal)
        Open[Ordinal] = WorkspaceEntry{};

    OpenOccupancy = 0u;
    Active        = AbsentWorkspace;

    for (std::uint32_t Subject = 0u;
         Subject < static_cast<std::uint32_t>(WorkspaceSubject::SubjectCount);
         ++Subject)
    {
        EnrolledPerSubject[Subject] = 0u;
    }
}

}   // namespace Slate
