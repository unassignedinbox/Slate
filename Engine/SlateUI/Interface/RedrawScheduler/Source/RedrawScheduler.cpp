//============================================================================================================================================
//                                                            REDRAWSCHEDULER.CPP
//============================================================================================================================================
// 🧩 A flat enrolment of marks, and the three-operand wake rule read from it.

#include "SlateUI/Interface/RedrawScheduler/Api/RedrawScheduler.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> RedrawScheduler::Enrol(const char* Naming)
{
    if (Enrolled >= PanelCapacity)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "no panel slot remains" });

    Marks[Enrolled]   = RedrawMark::Rearrange;
    Namings[Enrolled] = (Naming != nullptr) ? Naming : "";

    return Deliver<std::uint32_t>::Deliver(Enrolled++);
}

void RedrawScheduler::Mark(std::uint32_t PanelOrdinal, RedrawMark Declared)
{
    if (PanelOrdinal >= Enrolled)
        return;

    Marks[PanelOrdinal] = Dearer(Marks[PanelOrdinal], Declared);
}

void RedrawScheduler::MarkEvery(RedrawMark Declared)
{
    for (std::uint32_t PanelOrdinal = 0u; PanelOrdinal < Enrolled; ++PanelOrdinal)
        Marks[PanelOrdinal] = Dearer(Marks[PanelOrdinal], Declared);
}

RedrawMark RedrawScheduler::Standing(std::uint32_t PanelOrdinal) const
{
    return (PanelOrdinal < Enrolled) ? Marks[PanelOrdinal] : RedrawMark::Quiet;
}

bool RedrawScheduler::Marked() const
{
    for (std::uint32_t PanelOrdinal = 0u; PanelOrdinal < Enrolled; ++PanelOrdinal)
    {
        if (Marks[PanelOrdinal] != RedrawMark::Quiet)
            return true;
    }

    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE WAKE RULE
//------------------------------------------------------------------------------------------------------------------------

// 📝 🔴 Written as one disjunction rather than as three early returns, because the three operands are one
//    rule and a reader must be able to see that none of them is missing. The three-line form is where a
//    fourth condition eventually gets added to only two of the branches.
bool RedrawScheduler::Waking(bool AnythingMoving, bool ArrivalHeld) const
{
    return Marked() || AnythingMoving || ArrivalHeld;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RETIREMENT
//------------------------------------------------------------------------------------------------------------------------

void RedrawScheduler::Retire()
{
    if (Marked())
        ++RecordedCount;
    else
        ++QuietCount;

    for (std::uint32_t PanelOrdinal = 0u; PanelOrdinal < Enrolled; ++PanelOrdinal)
        Marks[PanelOrdinal] = RedrawMark::Quiet;
}

void RedrawScheduler::Retire(std::uint32_t PanelOrdinal)
{
    if (PanelOrdinal < Enrolled)
        Marks[PanelOrdinal] = RedrawMark::Quiet;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE READS
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t RedrawScheduler::EnrolledCount() const
{
    return Enrolled;
}

const char* RedrawScheduler::Naming(std::uint32_t PanelOrdinal) const
{
    return (PanelOrdinal < Enrolled) ? Namings[PanelOrdinal] : "";
}

std::uint64_t RedrawScheduler::QuietTicks() const
{
    return QuietCount;
}

std::uint64_t RedrawScheduler::RecordedTicks() const
{
    return RecordedCount;
}

}   // namespace Slate
