//============================================================================================================================================
//                                                            REPORTSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Coalescing, the bounded cyclic retention, and the overwriting measure index beside it.

#include "SlateMath/Numeric/ReportSequence/Api/ReportSequence.h"

#include <cstring>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     COALESCING
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 Static text compared by content rather than by pointer. Two origins spelled identically in two translation
//    units are two pointers and one fact, and comparing pointers would present the same report twice.
bool TextAgrees(const char* Left, const char* Right)
{
    if (Left == Right)
        return true;

    if (Left == nullptr || Right == nullptr)
        return false;

    return std::strcmp(Left, Right) == 0;
}

// 🔴 `86` §6: coalescing is by origin, disposition and subject together, never by origin alone. Coalescing by
//    origin would present twelve distinct refused constructs from one intake as one entry with a count of
//    twelve, and `52` §2 promises the artist the construct and its position — which the count destroys.
bool Coalesces(const ReportSpecification& Held, const ReportSpecification& Arriving)
{
    if (Held.Disposition != Arriving.Disposition)
        return false;

    if (Held.SubjectOrdinal != Arriving.SubjectOrdinal)
        return false;

    return TextAgrees(Held.Origin, Arriving.Origin) && TextAgrees(Held.Subject, Arriving.Subject);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      APPENDING
//------------------------------------------------------------------------------------------------------------------------

void ReportSequence::Append(const ReportSpecification& Arriving)
{
    std::lock_guard<std::mutex> Holding(ReportGuard);

    if (RetainedOrder.empty())
        RetainedOrder.resize(RetainedCeiling);

    ++AppendedReports;

    // 📝 Searched newest first. A recurrence is overwhelmingly the report that just happened, so the scan
    //    terminates on its first comparison for the case that recurs.
    for (std::uint32_t Passed = OccupiedCount; Passed-- > 0u;)
    {
        const std::uint32_t Ordinal = (OldestOrdinal + Passed) % RetainedCeiling;

        if (!Coalesces(RetainedOrder[Ordinal], Arriving))
            continue;

        ++RetainedOrder[Ordinal].OccurrenceCount;
        RetainedOrder[Ordinal].Arrival = Arriving.Arrival;
        RetainedOrder[Ordinal].Detail  = Arriving.Detail;

        return;
    }

    const std::uint32_t WriteOrdinal = (OldestOrdinal + OccupiedCount) % RetainedCeiling;

    RetainedOrder[WriteOrdinal]                 = Arriving;
    RetainedOrder[WriteOrdinal].OccurrenceCount = 1u;

    if (OccupiedCount == RetainedCeiling)
    {
        // 📝 The write above overwrote the oldest retained report. Advancing the oldest ordinal is what makes
        //    that a discard rather than a corruption of the retention order, exactly as `04`'s arrivals do.
        OldestOrdinal = (OldestOrdinal + 1u) % RetainedCeiling;
        ++DiscardedReports;
    }
    else
    {
        ++OccupiedCount;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

std::vector<ReportSpecification> ReportSequence::Retained() const
{
    std::lock_guard<std::mutex> Holding(ReportGuard);

    std::vector<ReportSpecification> Presented;
    Presented.reserve(OccupiedCount);

    for (std::uint32_t Passed = 0u; Passed < OccupiedCount; ++Passed)
        Presented.push_back(RetainedOrder[(OldestOrdinal + Passed) % RetainedCeiling]);

    return Presented;
}

std::uint32_t ReportSequence::RetainedCount() const
{
    std::lock_guard<std::mutex> Holding(ReportGuard);
    return OccupiedCount;
}

std::uint64_t ReportSequence::AppendedCount() const
{
    std::lock_guard<std::mutex> Holding(ReportGuard);
    return AppendedReports;
}

std::uint64_t ReportSequence::DiscardedCount() const
{
    std::lock_guard<std::mutex> Holding(ReportGuard);
    return DiscardedReports;
}

void ReportSequence::Reclaim()
{
    std::lock_guard<std::mutex> Holding(ReportGuard);

    RetainedOrder.clear();
    OldestOrdinal    = 0u;
    OccupiedCount    = 0u;
    AppendedReports  = 0u;
    DiscardedReports = 0u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MEASURES
//------------------------------------------------------------------------------------------------------------------------

std::size_t MeasureIndex::Located(const char* Origin, const char* Measured) const
{
    for (std::size_t Ordinal = 0u; Ordinal < SampledMeasures.size(); ++Ordinal)
    {
        if (TextAgrees(SampledMeasures[Ordinal].Origin, Origin)
         && TextAgrees(SampledMeasures[Ordinal].Measured, Measured))
        {
            return Ordinal;
        }
    }

    return SampledMeasures.size();
}

void MeasureIndex::DeclareCount(const char*   Origin,
                                const char*   Measured,
                                std::uint64_t Counted,
                                TickPoint     Sampled)
{
    const std::size_t Located_ = Located(Origin, Measured);

    SampledMeasure Declaring;
    Declaring.Origin       = Origin;
    Declaring.Measured     = Measured;
    Declaring.Counted      = Counted;
    Declaring.RealDeclared = false;
    Declaring.Sampled      = Sampled;

    if (Located_ == SampledMeasures.size())
        SampledMeasures.push_back(Declaring);
    else
        SampledMeasures[Located_] = Declaring;
}

void MeasureIndex::DeclareMagnitude(const char* Origin,
                                    const char* Measured,
                                    double      Magnitude,
                                    TickPoint   Sampled)
{
    const std::size_t Located_ = Located(Origin, Measured);

    SampledMeasure Declaring;
    Declaring.Origin       = Origin;
    Declaring.Measured     = Measured;
    Declaring.Magnitude    = Magnitude;
    Declaring.RealDeclared = true;
    Declaring.Sampled      = Sampled;

    if (Located_ == SampledMeasures.size())
        SampledMeasures.push_back(Declaring);
    else
        SampledMeasures[Located_] = Declaring;
}

const std::vector<SampledMeasure>& MeasureIndex::Measures() const
{
    return SampledMeasures;
}

Deliver<SampledMeasure> MeasureIndex::Resolve(const char* Origin, const char* Measured) const
{
    const std::size_t Located_ = Located(Origin, Measured);

    if (Located_ == SampledMeasures.size())
    {
        return Deliver<SampledMeasure>::Refuse(
            { RefusalReason::ExtentExhausted, "nothing has declared that measure this session" });
    }

    return Deliver<SampledMeasure>::Deliver(SampledMeasures[Located_]);
}

void MeasureIndex::Reclaim()
{
    SampledMeasures.clear();
}

}   // namespace Slate
