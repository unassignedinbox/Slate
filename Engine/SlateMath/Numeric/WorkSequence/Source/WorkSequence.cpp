//============================================================================================================================================
//                                                             WORKSEQUENCE.CPP
//============================================================================================================================================
// 🧩 The reserved interactive worker, cooperative cancellation, and conclusions ordered by declaration.

#include "SlateMath/Numeric/WorkSequence/Api/WorkSequence.h"
#include "SlateMath/Platform/PlatformInterchange/Api/PlatformInterchange.h"

#include <algorithm>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     ONE RECORD
//------------------------------------------------------------------------------------------------------------------------

// 📝 Held behind a unique_ptr so that a record's address is stable while a worker resolves against it. Held
//    inline in a vector, a reallocation on the next declaration would move the progress a worker is writing.
struct WorkSequence::WorkRecord
{
    WorkDeclaration    Declared          = {};        // [-] - as the requester handed it over
    WorkProgress       Progressed        = {};        // [-] - written by the resolution, sampled by the tick
    std::atomic<bool>  WithdrawalPosed   { false };   // [-] - read at the resolution's declared points
    std::uint64_t      DeclaredOrdinal   = 0u;        // [-] - declaration order across the session
    std::uint32_t      SlotGeneration    = 0u;        // [-] - advanced at every conclusion
    bool               ResolutionOpen    = false;     // [-] - a worker holds it now
    bool               SupersessionPosed = false;     // [-] - the cancellation was a supersession
    bool               Occupied          = false;     // [-] - the slot carries a live declaration
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      ONE QUEUE
//------------------------------------------------------------------------------------------------------------------------

void WorkQueue::Admit(std::uint32_t RecordOrdinal)
{
    PendingOrder.push_back(RecordOrdinal);
    ++PendingHeld;
}

Deliver<std::uint32_t> WorkQueue::Claim()
{
    while (ClaimOrdinal < PendingOrder.size())
    {
        const std::uint32_t Claimed = PendingOrder[ClaimOrdinal];
        ++ClaimOrdinal;

        if (Claimed == AbsentWork)
            continue;

        --PendingHeld;

        // 📝 Emptied rather than shifted. The order is walked once and discarded, so compacting it at the end
        //    keeps a queue that has served a thousand declarations from carrying a thousand struck entries.
        if (ClaimOrdinal == PendingOrder.size())
        {
            PendingOrder.clear();
            ClaimOrdinal = 0u;
        }

        return Deliver<std::uint32_t>::Deliver(Claimed);
    }

    PendingOrder.clear();
    ClaimOrdinal = 0u;

    return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "nothing is pending at this priority" });
}

void WorkQueue::Withdraw(std::uint32_t RecordOrdinal)
{
    for (std::size_t Ordinal = ClaimOrdinal; Ordinal < PendingOrder.size(); ++Ordinal)
    {
        if (PendingOrder[Ordinal] != RecordOrdinal)
            continue;

        PendingOrder[Ordinal] = AbsentWork;

        if (PendingHeld != 0u)
            --PendingHeld;

        return;
    }
}

std::uint32_t WorkQueue::PendingCount() const
{
    return PendingHeld;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Defined here rather than defaulted in the header. MSVC instantiates ~unique_ptr<WorkRecord> inside the
//    default constructor's implicit exception-unwind path, which requires WorkRecord to be complete. The
//    header forward-declares it, so the constructor must be compiled where the definition is visible.
WorkSequence::WorkSequence() = default;

Deliver<bool> WorkSequence::Construct(std::uint32_t       RequestedWorkers,
                                      const TickSequence& HostTimeline,
                                      ReportSequence&     ReportingInto)
{
    {
        std::lock_guard<std::mutex> Holding(WorkGuard);

        if (SpannedWorkers != 0u)
            return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the workers are already constructed" });

        std::uint32_t Constructing = RequestedWorkers;

        if (Constructing == 0u)
        {
            // 📝 `04`'s `PlatformInterchange` owns the host report and is read here rather than queried
            //    directly, so the one reading `06`'s `HardwareMetrics` attributes its measurements to is the
            //    same one the worker count was fixed from.
            PlatformInterchange HostTranslation;

            const Deliver<bool> Reported = HostTranslation.Resolve();

            Constructing = Reported.ContentPresent ? HostTranslation.Report().ResolvingCount : 2u;

            if (Constructing == 0u)
                Constructing = 2u;
        }

        if (Constructing > WorkerCeiling)
            Constructing = WorkerCeiling;

        Timeline         = &HostTimeline;
        Reporting        = &ReportingInto;
        TeardownDeclared = false;
        SpannedWorkers   = Constructing;
    }

    for (std::uint32_t WorkerOrdinal = 0u; WorkerOrdinal < SpannedWorkers; ++WorkerOrdinal)
        Workers.emplace_back(&WorkSequence::Serve, this, WorkerOrdinal);

    return Deliver<bool>::Deliver(true);
}

WorkSequence::~WorkSequence()
{
    Reclaim();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE WORKERS
//------------------------------------------------------------------------------------------------------------------------

bool WorkSequence::Claimable(std::uint32_t WorkerOrdinal) const
{
    if (PendingByPriority[static_cast<std::size_t>(WorkPriority::Interactive)].PendingCount() != 0u)
        return true;

    // 🔴 `34` §4: one worker takes nothing but Interactive work while more than one stands. Without it a
    //    whole-document export occupies every worker and the promotion under the cursor waits behind it.
    if (WorkerOrdinal == InteractiveReservedOrdinal && SpannedWorkers > 1u)
        return false;

    for (std::size_t Priority = 1u; Priority < PrioritySpan; ++Priority)
    {
        if (PendingByPriority[Priority].PendingCount() != 0u)
            return true;
    }

    return false;
}

std::uint32_t WorkSequence::Claim(std::uint32_t WorkerOrdinal)
{
    const bool InteractiveOnly = WorkerOrdinal == InteractiveReservedOrdinal && SpannedWorkers > 1u;

    for (std::size_t Priority = 0u; Priority < PrioritySpan; ++Priority)
    {
        if (InteractiveOnly && Priority != static_cast<std::size_t>(WorkPriority::Interactive))
            break;

        const Deliver<std::uint32_t> Claimed = PendingByPriority[Priority].Claim();

        if (Claimed.ContentPresent)
            return Claimed.Resolve();
    }

    return AbsentWork;
}

void WorkSequence::Serve(std::uint32_t WorkerOrdinal)
{
    for (;;)
    {
        std::unique_lock<std::mutex> Holding(WorkGuard);

        ArrivalDeclared.wait(Holding, [this, WorkerOrdinal]
        {
            return TeardownDeclared || Claimable(WorkerOrdinal);
        });

        if (TeardownDeclared)
            return;

        const std::uint32_t RecordOrdinal = Claim(WorkerOrdinal);

        if (RecordOrdinal == AbsentWork)
            continue;

        WorkRecord& Serving = *Records[RecordOrdinal];

        Serving.ResolutionOpen = true;
        ++OccupiedWorkerCount;

        WorkCancellation Posed;
        Posed.WithdrawalSlot = &Serving.WithdrawalPosed;

        // 📝 The resolution runs with the guard released. It reads only what the requester captured — `34` §2 —
        //    so nothing it touches is guarded by anything here.
        Holding.unlock();

        Deliver<bool> Resolved = Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "the declared resolution produced no result" });

        if (Serving.Declared.Resolve)
            Resolved = Serving.Declared.Resolve(Posed, Serving.Progressed);

        Holding.lock();

        Serving.ResolutionOpen = false;

        if (OccupiedWorkerCount != 0u)
            --OccupiedWorkerCount;

        Seal(RecordOrdinal, Resolved);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<WorkIdentity> WorkSequence::Declare(const WorkDeclaration& Arriving)
{
    if (!Arriving.Resolve)
    {
        return Deliver<WorkIdentity>::Refuse(
            { RefusalReason::ContentUnsupported, "the declaration carries no resolution to run" });
    }

    if (static_cast<std::size_t>(Arriving.Priority) >= PrioritySpan)
        return Deliver<WorkIdentity>::Refuse({ RefusalReason::ContentUnsupported, "no such priority" });

    std::lock_guard<std::mutex> Holding(WorkGuard);

    if (SpannedWorkers == 0u || TeardownDeclared)
        return Deliver<WorkIdentity>::Refuse({ RefusalReason::HostDenied, "no worker stands to resolve it" });

    std::uint32_t RecordOrdinal = AbsentWork;

    if (!ReleasedOrdinals.empty())
    {
        // 📝 A released slot is reused with its generation already advanced by Seal, so the identity issued here
        //    can never equal one issued for the slot's previous declaration — `10` §2.1's scheme, unchanged.
        RecordOrdinal = ReleasedOrdinals.back();
        ReleasedOrdinals.pop_back();
        Records[RecordOrdinal]->Progressed.Reclaim();
    }
    else
    {
        RecordOrdinal = static_cast<std::uint32_t>(Records.size());
        Records.push_back(std::make_unique<WorkRecord>());
        Records[RecordOrdinal]->SlotGeneration = 1u;
    }

    WorkRecord& Arrived = *Records[RecordOrdinal];

    Arrived.Declared        = Arriving;
    Arrived.DeclaredOrdinal = ++DeclaredCount;
    Arrived.ResolutionOpen  = false;
    Arrived.SupersessionPosed = false;
    Arrived.Occupied        = true;
    Arrived.WithdrawalPosed.store(false, std::memory_order_relaxed);

    PendingByPriority[static_cast<std::size_t>(Arriving.Priority)].Admit(RecordOrdinal);

    WorkIdentity Issued;
    Issued.SlotOrdinal    = RecordOrdinal;
    Issued.SlotGeneration = Arrived.SlotGeneration;

    ArrivalDeclared.notify_all();

    return Deliver<WorkIdentity>::Deliver(Issued);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CANCELLATION
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t WorkSequence::Resolved(WorkIdentity Subject) const
{
    if (!Subject.IdentityDeclared() || Subject.SlotOrdinal >= Records.size())
        return AbsentWork;

    const WorkRecord& Held = *Records[Subject.SlotOrdinal];

    if (!Held.Occupied || Held.SlotGeneration != Subject.SlotGeneration)
        return AbsentWork;

    return Subject.SlotOrdinal;
}

Deliver<bool> WorkSequence::Cancel(WorkIdentity Subject, bool SupersessionPosed)
{
    std::lock_guard<std::mutex> Holding(WorkGuard);

    const std::uint32_t RecordOrdinal = Resolved(Subject);

    if (RecordOrdinal == AbsentWork)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the declaration has already concluded" });

    WorkRecord& Cancelling = *Records[RecordOrdinal];

    Cancelling.SupersessionPosed = SupersessionPosed;
    Cancelling.WithdrawalPosed.store(true, std::memory_order_relaxed);

    // 🔴 A declaration a worker already holds is **not** sealed here. `34` §5: cancellation is not abandonment —
    //    the resolution runs to its next declared point and releases what it holds, and Seal concludes it then.
    if (Cancelling.ResolutionOpen)
        return Deliver<bool>::Deliver(true);

    PendingByPriority[static_cast<std::size_t>(Cancelling.Declared.Priority)].Withdraw(RecordOrdinal);

    Seal(RecordOrdinal, Deliver<bool>::Refuse({ RefusalReason::HostDenied, "cancelled before it was claimed" }));

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> WorkSequence::Withdraw(WorkIdentity Subject)
{
    return Cancel(Subject, false);
}

Deliver<bool> WorkSequence::Supersede(WorkIdentity Subject)
{
    return Cancel(Subject, true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONCLUSION
//------------------------------------------------------------------------------------------------------------------------

void WorkSequence::Seal(std::uint32_t RecordOrdinal, const Deliver<bool>& Resolved_)
{
    WorkRecord& Sealing = *Records[RecordOrdinal];

    WorkCompletion Concluding;
    Concluding.Declared.SlotOrdinal    = RecordOrdinal;
    Concluding.Declared.SlotGeneration = Sealing.SlotGeneration;
    Concluding.Origin                  = Sealing.Declared.Origin;
    Concluding.DeclaredOrdinal         = Sealing.DeclaredOrdinal;
    Concluding.Sealed                  = Timeline != nullptr ? Timeline->Advance() : TickPoint{};

    if (Sealing.WithdrawalPosed.load(std::memory_order_relaxed))
    {
        Concluding.Concluded = Sealing.SupersessionPosed ? WorkConclusion::Superseded : WorkConclusion::Withdrawn;
    }
    else if (Resolved_.ContentPresent)
    {
        Concluding.Concluded = WorkConclusion::Delivered;
    }
    else
    {
        Concluding.Concluded = WorkConclusion::Refused;
        Concluding.Declining = Resolved_.Declined;

        // 🔴 `34` §5 and `86` §4: a failed declaration is reported with its origin. A cancellation is not —
        //    `86` §5 rules a superseded cancellation ordinary operation, and reporting it never leaves the
        //    register quiet.
        if (Reporting != nullptr)
        {
            ReportSpecification Reported;
            Reported.Origin         = "34 §5 WorkSequence";
            Reported.Subject        = Sealing.Declared.Origin;
            Reported.Detail         = Resolved_.Declined.Detail;
            Reported.SubjectOrdinal = Sealing.DeclaredOrdinal;
            Reported.Disposition    = ReportDisposition::Failed;
            Reported.Arrival        = Concluding.Sealed;

            Reporting->Append(Reported);
        }
    }

    SealedCompletions.push_back(Concluding);

    // 📝 The generation advances on conclusion, not on reuse, so every identity the requester still holds
    //    resolves to absent from this point whether or not the slot is ever declared into again.
    ++Sealing.SlotGeneration;
    Sealing.Occupied          = false;
    Sealing.ResolutionOpen    = false;
    Sealing.SupersessionPosed = false;
    Sealing.Declared.Resolve  = nullptr;

    ReleasedOrdinals.push_back(RecordOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       DRAINING
//------------------------------------------------------------------------------------------------------------------------

const std::vector<WorkCompletion>& WorkSequence::Drain()
{
    std::lock_guard<std::mutex> Holding(WorkGuard);

    DrainedCompletions.clear();
    DrainedCompletions.swap(SealedCompletions);

    // 🔴 `34` §6: ordered by declaration ordinal and never by finishing order. Applying results in the order
    //    workers happened to finish makes the same inputs produce two documents on two machines, and `02` §5's
    //    ordered recombination exists for the same reason one layer down.
    std::sort(DrainedCompletions.begin(),
              DrainedCompletions.end(),
              [](const WorkCompletion& Earlier, const WorkCompletion& Later)
              {
                  return Earlier.DeclaredOrdinal < Later.DeclaredOrdinal;
              });

    return DrainedCompletions;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

Deliver<double> WorkSequence::Progress(WorkIdentity Subject) const
{
    std::lock_guard<std::mutex> Holding(WorkGuard);

    const std::uint32_t RecordOrdinal = Resolved(Subject);

    if (RecordOrdinal == AbsentWork)
        return Deliver<double>::Refuse({ RefusalReason::IdentityStale, "the declaration has already concluded" });

    return Deliver<double>::Deliver(Records[RecordOrdinal]->Progressed.Fraction());
}

Deliver<std::uint64_t> WorkSequence::ProgressCount(WorkIdentity Subject) const
{
    std::lock_guard<std::mutex> Holding(WorkGuard);

    const std::uint32_t RecordOrdinal = Resolved(Subject);

    if (RecordOrdinal == AbsentWork)
    {
        return Deliver<std::uint64_t>::Refuse(
            { RefusalReason::IdentityStale, "the declaration has already concluded" });
    }

    return Deliver<std::uint64_t>::Deliver(Records[RecordOrdinal]->Progressed.ResolvedCount());
}

std::uint32_t WorkSequence::WorkerCount() const
{
    std::lock_guard<std::mutex> Holding(WorkGuard);
    return SpannedWorkers;
}

std::uint32_t WorkSequence::OccupiedWorkers() const
{
    std::lock_guard<std::mutex> Holding(WorkGuard);
    return OccupiedWorkerCount;
}

std::uint32_t WorkSequence::PendingCount() const
{
    std::lock_guard<std::mutex> Holding(WorkGuard);

    std::uint32_t Pending = 0u;

    for (std::size_t Priority = 0u; Priority < PrioritySpan; ++Priority)
        Pending += PendingByPriority[Priority].PendingCount();

    return Pending;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void WorkSequence::Reclaim()
{
    {
        std::lock_guard<std::mutex> Holding(WorkGuard);

        if (SpannedWorkers == 0u && Records.empty())
            return;

        // 📝 Every live declaration is posed as withdrawn before the workers are asked to return, so a
        //    resolution in flight observes the withdrawal at its next declared point rather than being joined
        //    while it still holds its inputs.
        for (std::unique_ptr<WorkRecord>& Held : Records)
        {
            if (Held->Occupied)
                Held->WithdrawalPosed.store(true, std::memory_order_relaxed);
        }

        TeardownDeclared = true;
        ArrivalDeclared.notify_all();
    }

    for (std::thread& Serving : Workers)
    {
        if (Serving.joinable())
            Serving.join();
    }

    Workers.clear();

    std::lock_guard<std::mutex> Holding(WorkGuard);

    // 📝 What no worker reached is concluded here, so a requester waiting on a drain is told the declaration
    //    was withdrawn rather than left waiting for a conclusion that will never arrive — `34` §5.
    for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < Records.size(); ++RecordOrdinal)
    {
        if (!Records[RecordOrdinal]->Occupied)
            continue;

        PendingByPriority[static_cast<std::size_t>(Records[RecordOrdinal]->Declared.Priority)]
            .Withdraw(RecordOrdinal);

        Seal(RecordOrdinal, Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the sequence was reclaimed" }));
    }

    SpannedWorkers      = 0u;
    OccupiedWorkerCount = 0u;
    TeardownDeclared    = false;
    Timeline            = nullptr;
    Reporting           = nullptr;
}

}   // namespace Slate
