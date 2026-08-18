//============================================================================================================================================
//                                                             INTAKEINDEX.CPP
//============================================================================================================================================
// 🧩 Arrival-ordered records, and the once-only report of every assumption among them.

#include "SlateDocument/Document/IntakeIndex/Api/IntakeIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      RECORDING
//------------------------------------------------------------------------------------------------------------------------

void IntakeIndex::Record(const IntakeRecord& Arriving)
{
    Recorded.push_back(Arriving);
    AssumptionReported.push_back(false);

    if (Arriving.AssumptionMade)
        ++AssumedTotal;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REPORT
//------------------------------------------------------------------------------------------------------------------------

void IntakeIndex::Report(ReportSequence& Reporting, TickPoint Sampled)
{
    for (std::size_t Ordinal = 0u; Ordinal < Recorded.size(); ++Ordinal)
    {
        if (!Recorded[Ordinal].AssumptionMade || AssumptionReported[Ordinal])
            continue;

        ReportSpecification Assumed;
        Assumed.Origin         = "50 §3 AssetInterchange";
        Assumed.Disposition    = ReportDisposition::Assumed;
        Assumed.SubjectOrdinal = static_cast<std::uint64_t>(Ordinal);
        Assumed.Arrival        = Sampled;

        // 📝 Static text only — `86` §3.1 admits an append from any thread and a report that owned an allocation
        //    would allocate while the tick presents the register. The origin path lives in the record beside the
        //    report and the presenter reads it from there.
        if (Recorded[Ordinal].Assumed == AssumedSubject::UnitScale)
        {
            Assumed.Subject = "UnitScale";
            Assumed.Detail  = "the source declared no unit convention; one was chosen and applied at intake";
        }
        else
        {
            Assumed.Subject = "ContentSpace";
            Assumed.Detail  = "the imagery declared no colour space; one was chosen — `36` §3";
        }

        Reporting.Append(Assumed);

        AssumptionReported[Ordinal] = true;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const std::vector<IntakeRecord>& IntakeIndex::Records() const { return Recorded; }

Deliver<IntakeRecord> IntakeIndex::Resolve(const std::string& OriginPath) const
{
    for (std::size_t Ordinal = Recorded.size(); Ordinal-- > 0u;)
    {
        if (Recorded[Ordinal].OriginPath == OriginPath)
            return Deliver<IntakeRecord>::Deliver(Recorded[Ordinal]);
    }

    return Deliver<IntakeRecord>::Refuse({ RefusalReason::ExtentExhausted, "nothing arrived from that origin" });
}

std::uint32_t IntakeIndex::AssumptionCount() const { return AssumedTotal; }
std::uint32_t IntakeIndex::RecordedCount() const   { return static_cast<std::uint32_t>(Recorded.size()); }

}   // namespace Slate
