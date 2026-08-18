//============================================================================================================================================
//                                                        SURFACELAYERSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Ordering by position alone, amendments bounded by what they touched, and the one resampling that is reported.

#include "SlateDocument/Document/SurfaceLayerSequence/Api/SurfaceLayerSequence.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      LOCATION
//------------------------------------------------------------------------------------------------------------------------

std::size_t SurfaceLayerSequence::Located(LayerIdentity Subject) const
{
    if (!Subject.IdentityDeclared())
        return Sequenced.size();

    for (std::size_t Ordinal = 0u; Ordinal < Sequenced.size(); ++Ordinal)
    {
        if (Sequenced[Ordinal].Identity == Subject)
            return Ordinal;
    }

    return Sequenced.size();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<LayerIdentity> SurfaceLayerSequence::Append(const LayerSpecification& Declaring)
{
    if (Sequenced.size() >= EntryCeiling)
        return Deliver<LayerIdentity>::Refuse({ RefusalReason::ExtentExhausted, "the entry ceiling was reached" });

    if (Declaring.Source == LayerContentSource::NestedSequence
     && Declaring.NestedOrdinal >= NestedSequences.size())
    {
        return Deliver<LayerIdentity>::Refuse({ RefusalReason::ContentUnsupported, "no such nested sequence" });
    }

    // 📝 Painted content is validated against its own declared extent here rather than trusted. A span that does
    //    not match is a span every later sample reads past the end of, and the read is not detectable afterwards.
    if (Declaring.Source == LayerContentSource::PaintedImpressions)
    {
        const std::size_t Required = static_cast<std::size_t>(Declaring.Painted.ExtentTexels)
                                   * static_cast<std::size_t>(Declaring.Painted.ExtentTexels)
                                   * static_cast<std::size_t>(Declaring.Painted.ComponentCount);

        if (Declaring.Painted.ExtentTexels == 0u || Declaring.Painted.Texels.size() != Required)
        {
            return Deliver<LayerIdentity>::Refuse(
                { RefusalReason::ContentUnsupported, "the painted span does not match its declared extent" });
        }

        if (Declaring.Painted.ExtentTexels > MaximumWorkingEdge)
        {
            return Deliver<LayerIdentity>::Refuse(
                { RefusalReason::ExtentExhausted, "the working extent exceeds the declared maximum" });
        }
    }

    LayerSpecification Arriving = Declaring;

    Arriving.Identity.SlotOrdinal    = static_cast<std::uint32_t>(Sequenced.size());
    Arriving.Identity.SlotGeneration = IssuedGeneration;

    Sequenced.push_back(Arriving);

    return Deliver<LayerIdentity>::Deliver(Arriving.Identity);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     AMENDMENTS
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> SurfaceLayerSequence::Reorder(LayerIdentity Subject, std::uint32_t Position)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::IdentityStale, "the entry no longer resolves" });

    const std::uint32_t Prior   = static_cast<std::uint32_t>(Located_);
    const LayerSpecification Held = Sequenced[Located_];

    Sequenced.erase(Sequenced.begin() + static_cast<std::ptrdiff_t>(Located_));

    const std::size_t Arriving = Position >= Sequenced.size() ? Sequenced.size()
                                                              : static_cast<std::size_t>(Position);

    Sequenced.insert(Sequenced.begin() + static_cast<std::ptrdiff_t>(Arriving), Held);

    return Deliver<std::uint32_t>::Deliver(Prior);
}

Deliver<bool> SurfaceLayerSequence::DeclarePresence(LayerIdentity Subject, bool PresenceEnabled)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the entry no longer resolves" });

    const bool Prior = Sequenced[Located_].PresenceEnabled;

    Sequenced[Located_].PresenceEnabled = PresenceEnabled;

    return Deliver<bool>::Deliver(Prior);
}

Deliver<CombineSpecification> SurfaceLayerSequence::DeclareCombination(LayerIdentity        Subject,
                                                                       CombineSpecification Declaring)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
    {
        return Deliver<CombineSpecification>::Refuse(
            { RefusalReason::IdentityStale, "the entry no longer resolves" });
    }

    if (Declaring == CombineSpecification::CombineCount)
    {
        return Deliver<CombineSpecification>::Refuse(
            { RefusalReason::ContentUnsupported, "no such combination" });
    }

    const CombineSpecification Prior = Sequenced[Located_].Combination;

    Sequenced[Located_].Combination = Declaring;

    return Deliver<CombineSpecification>::Deliver(Prior);
}

Deliver<LayerSpecification> SurfaceLayerSequence::Withdraw(LayerIdentity Subject)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
    {
        return Deliver<LayerSpecification>::Refuse(
            { RefusalReason::IdentityStale, "the entry no longer resolves" });
    }

    LayerSpecification Departing = Sequenced[Located_];

    // 🔴 A reconstructible entry surrenders its resolved texels and keeps its description — `56` §6. Nothing in
    //    the inverse is a derivation, which is what keeps the inverse bounded by what the amendment touched.
    if (SourceReconstructible(Departing.Source))
    {
        Departing.Painted.Texels.clear();
        Departing.Coverage.Painted.Texels.clear();
    }

    Sequenced.erase(Sequenced.begin() + static_cast<std::ptrdiff_t>(Located_));

    // 📝 The generation advances on withdrawal, so an identity the caller still holds resolves to absent rather
    //    than to whichever entry later occupies the position — `10` §2.1's scheme, unchanged.
    ++IssuedGeneration;

    return Deliver<LayerSpecification>::Deliver(Departing);
}

Deliver<std::uint32_t> SurfaceLayerSequence::Nest()
{
    if (Depth + 1u > LayerNestingCeiling)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "the declared nesting ceiling was reached" });
    }

    const std::uint32_t NestedOrdinal = static_cast<std::uint32_t>(NestedSequences.size());

    NestedSequences.push_back(SurfaceLayerSequence{});
    NestedSequences.back().Depth = Depth + 1u;

    return Deliver<std::uint32_t>::Deliver(NestedOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RESAMPLING
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📐 Bilinear over the interleaved span, clamped at the edges. Nearest would preserve every texel exactly and
//    would also shear every diagonal the artist painted; bilinear softens uniformly, which is the failure mode
//    that reads as a resampling rather than as a defect.
float SampleBilinear(const PaintedContent& Held,
                     double                PositionAlong,
                     double                PositionAcross,
                     std::uint32_t         Component)
{
    const double Extent = static_cast<double>(Held.ExtentTexels);

    double AlongTexel  = PositionAlong  * Extent - 0.5;
    double AcrossTexel = PositionAcross * Extent - 0.5;

    AlongTexel  = AlongTexel  < 0.0 ? 0.0 : (AlongTexel  > Extent - 1.0 ? Extent - 1.0 : AlongTexel);
    AcrossTexel = AcrossTexel < 0.0 ? 0.0 : (AcrossTexel > Extent - 1.0 ? Extent - 1.0 : AcrossTexel);

    const std::uint32_t LeastAlong  = static_cast<std::uint32_t>(AlongTexel);
    const std::uint32_t LeastAcross = static_cast<std::uint32_t>(AcrossTexel);

    const std::uint32_t NextAlong  = LeastAlong  + 1u < Held.ExtentTexels ? LeastAlong  + 1u : LeastAlong;
    const std::uint32_t NextAcross = LeastAcross + 1u < Held.ExtentTexels ? LeastAcross + 1u : LeastAcross;

    const double FractionAlong  = AlongTexel  - static_cast<double>(LeastAlong);
    const double FractionAcross = AcrossTexel - static_cast<double>(LeastAcross);

    const std::size_t Stride = static_cast<std::size_t>(Held.ComponentCount);

    const std::size_t LowerLeft  = (static_cast<std::size_t>(LeastAcross) * Held.ExtentTexels + LeastAlong) * Stride;
    const std::size_t LowerRight = (static_cast<std::size_t>(LeastAcross) * Held.ExtentTexels + NextAlong)  * Stride;
    const std::size_t UpperLeft  = (static_cast<std::size_t>(NextAcross)  * Held.ExtentTexels + LeastAlong) * Stride;
    const std::size_t UpperRight = (static_cast<std::size_t>(NextAcross)  * Held.ExtentTexels + NextAlong)  * Stride;

    const double Lower = static_cast<double>(Held.Texels[LowerLeft + Component])  * (1.0 - FractionAlong)
                       + static_cast<double>(Held.Texels[LowerRight + Component]) * FractionAlong;

    const double Upper = static_cast<double>(Held.Texels[UpperLeft + Component])  * (1.0 - FractionAlong)
                       + static_cast<double>(Held.Texels[UpperRight + Component]) * FractionAlong;

    return static_cast<float>(Lower * (1.0 - FractionAcross) + Upper * FractionAcross);
}

void ResampleContent(PaintedContent&                                               Held,
                     const std::function<bool(double, double, double&, double&)>&  Remapping)
{
    if (Held.ExtentTexels == 0u || Held.Texels.empty())
        return;

    std::vector<float> Arriving(Held.Texels.size(), 0.0f);

    const double Extent = static_cast<double>(Held.ExtentTexels);

    for (std::uint32_t Across = 0u; Across < Held.ExtentTexels; ++Across)
    {
        for (std::uint32_t Along = 0u; Along < Held.ExtentTexels; ++Along)
        {
            const double PositionAlong  = (static_cast<double>(Along)  + 0.5) / Extent;
            const double PositionAcross = (static_cast<double>(Across) + 0.5) / Extent;

            double FormerAlong  = 0.0;
            double FormerAcross = 0.0;

            // 📝 A position the remapping cannot answer occupied no chart in the former domain, so it is left at
            //    zero rather than filled from the nearest thing. A fabricated value here is content the artist
            //    never painted, appearing exactly where a chart boundary moved.
            if (!Remapping(PositionAlong, PositionAcross, FormerAlong, FormerAcross))
                continue;

            const std::size_t Writing = (static_cast<std::size_t>(Across) * Held.ExtentTexels + Along)
                                      * static_cast<std::size_t>(Held.ComponentCount);

            for (std::uint32_t Component = 0u; Component < Held.ComponentCount; ++Component)
                Arriving[Writing + Component] = SampleBilinear(Held, FormerAlong, FormerAcross, Component);
        }
    }

    Held.Texels.swap(Arriving);
}

}   // namespace

Deliver<bool> SurfaceLayerSequence::Resample(
    std::uint64_t                                                 ArrivingRevision,
    const std::function<bool(double, double, double&, double&)>&  Remapping,
    ReportSequence&                                               Reporting,
    TickPoint                                                     Sampled)
{
    if (!Remapping)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no domain remapping was supplied" });

    if (ArrivingRevision == DescribedRevision)
        return Deliver<bool>::Deliver(true);

    std::uint32_t ResampledCount = 0u;

    for (LayerSpecification& Held : Sequenced)
    {
        if (Held.Source == LayerContentSource::PaintedImpressions)
        {
            ResampleContent(Held.Painted, Remapping);
            Held.ResampleOwed = false;
            ++ResampledCount;
        }

        if (Held.Coverage.CoverageDeclared
         && Held.Coverage.Source == LayerContentSource::PaintedImpressions)
        {
            ResampleContent(Held.Coverage.Painted, Remapping);
            ++ResampledCount;
        }
    }

    for (SurfaceLayerSequence& Nesting : NestedSequences)
    {
        const Deliver<bool> Nested = Nesting.Resample(ArrivingRevision, Remapping, Reporting, Sampled);

        if (!Nested.ContentPresent)
            return Nested;
    }

    DescribedRevision = ArrivingRevision;

    // 🔴 `86` §4's `56` §3.1 row, and the register's most consequential entry. It is the one operation in the
    //    engine that resamples authored content, and presenting it at the same weight as a residency total is a
    //    line the artist scrolls past before discovering their paint softened.
    if (ResampledCount != 0u)
    {
        ReportSpecification Amended;
        Amended.Origin         = "56 §3.1 SurfaceLayerSequence";
        Amended.Subject        = "PaintedResampling";
        Amended.Detail         = "a re-partition moved the domain; painted texels were resampled into it";
        Amended.SubjectOrdinal = ArrivingRevision;
        Amended.Disposition    = ReportDisposition::Amended;
        Amended.Arrival        = Sampled;

        Reporting.Append(Amended);
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

Deliver<const LayerSpecification*> SurfaceLayerSequence::Resolve(LayerIdentity Subject) const
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
    {
        return Deliver<const LayerSpecification*>::Refuse(
            { RefusalReason::IdentityStale, "the entry no longer resolves" });
    }

    return Deliver<const LayerSpecification*>::Deliver(&Sequenced[Located_]);
}

Deliver<PaintedContent*> SurfaceLayerSequence::AmendPainted(LayerIdentity Subject)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
    {
        return Deliver<PaintedContent*>::Refuse(
            { RefusalReason::IdentityStale, "the entry no longer resolves" });
    }

    // 🔴 §3's classification, enforced at the one door into authored content. A reconstructible entry stores a
    //    description and `70` resolves it; texels written into one would be a second place its content lived,
    //    and the two would diverge at the first re-resolution.
    if (SourceReconstructible(Sequenced[Located_].Source))
    {
        return Deliver<PaintedContent*>::Refuse(
            { RefusalReason::ContentUnsupported, "the entry stores a description, not texels" });
    }

    return Deliver<PaintedContent*>::Deliver(&Sequenced[Located_].Painted);
}

const std::vector<LayerSpecification>& SurfaceLayerSequence::Entries() const
{
    return Sequenced;
}

Deliver<const SurfaceLayerSequence*> SurfaceLayerSequence::Nested(std::uint32_t NestedOrdinal) const
{
    if (NestedOrdinal >= NestedSequences.size())
    {
        return Deliver<const SurfaceLayerSequence*>::Refuse(
            { RefusalReason::ContentUnsupported, "no such nested sequence" });
    }

    return Deliver<const SurfaceLayerSequence*>::Deliver(&NestedSequences[NestedOrdinal]);
}

Deliver<SurfaceLayerSequence*> SurfaceLayerSequence::AmendNested(std::uint32_t NestedOrdinal)
{
    if (NestedOrdinal >= NestedSequences.size())
    {
        return Deliver<SurfaceLayerSequence*>::Refuse(
            { RefusalReason::ContentUnsupported, "no such nested sequence" });
    }

    return Deliver<SurfaceLayerSequence*>::Deliver(&NestedSequences[NestedOrdinal]);
}

Deliver<std::uint32_t> SurfaceLayerSequence::PositionOf(LayerIdentity Subject) const
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Sequenced.size())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::IdentityStale, "the entry no longer resolves" });

    return Deliver<std::uint32_t>::Deliver(static_cast<std::uint32_t>(Located_));
}

std::uint32_t SurfaceLayerSequence::WrittenChannels() const
{
    std::uint32_t Written = 0u;

    for (const LayerSpecification& Held : Sequenced)
    {
        if (!Held.PresenceEnabled)
            continue;

        // 📝 §4.1: a nested entry writes the union of what its own entries write, restricted by its own set.
        if (Held.Source == LayerContentSource::NestedSequence && Held.NestedOrdinal < NestedSequences.size())
            Written |= NestedSequences[Held.NestedOrdinal].WrittenChannels() & Held.ChannelMask;
        else
            Written |= Held.ChannelMask;
    }

    return Written;
}

bool SurfaceLayerSequence::AuthoredContentHeld() const
{
    for (const LayerSpecification& Held : Sequenced)
    {
        if (!SourceReconstructible(Held.Source))
            return true;

        if (Held.Coverage.CoverageDeclared
         && !SourceReconstructible(Held.Coverage.Source))
        {
            return true;
        }
    }

    for (const SurfaceLayerSequence& Nesting : NestedSequences)
    {
        if (Nesting.AuthoredContentHeld())
            return true;
    }

    return false;
}

std::uint32_t SurfaceLayerSequence::NestingDepth() const      { return Depth;             }
std::uint64_t SurfaceLayerSequence::AddressedRevision() const { return DescribedRevision; }

std::uint32_t SurfaceLayerSequence::EntryCount() const
{
    return static_cast<std::uint32_t>(Sequenced.size());
}

std::uint32_t SurfaceLayerSequence::NestedCount() const
{
    return static_cast<std::uint32_t>(NestedSequences.size());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE ENTRIES
//------------------------------------------------------------------------------------------------------------------------

Deliver<const LayerSpecification*> LayerIndex::Locate(const SurfaceLayerSequence& Sequence, LayerIdentity Subject)
{
    const Deliver<const LayerSpecification*> Held = Sequence.Resolve(Subject);

    if (Held.ContentPresent)
        return Held;

    for (std::uint32_t Ordinal = 0u; Ordinal < Sequence.NestedCount(); ++Ordinal)
    {
        const Deliver<const SurfaceLayerSequence*> Nesting = Sequence.Nested(Ordinal);

        if (!Nesting.ContentPresent)
            continue;

        const Deliver<const LayerSpecification*> Deeper = Locate(*Nesting.Resolve(), Subject);

        if (Deeper.ContentPresent)
            return Deeper;
    }

    return Deliver<const LayerSpecification*>::Refuse(
        { RefusalReason::IdentityStale, "nothing in the nesting holds that entry" });
}

std::uint32_t LayerIndex::SpannedCount(const SurfaceLayerSequence& Sequence)
{
    std::uint32_t Spanned = Sequence.EntryCount();

    for (std::uint32_t Ordinal = 0u; Ordinal < Sequence.NestedCount(); ++Ordinal)
    {
        const Deliver<const SurfaceLayerSequence*> Nesting = Sequence.Nested(Ordinal);

        if (Nesting.ContentPresent)
            Spanned += SpannedCount(*Nesting.Resolve());
    }

    return Spanned;
}

}   // namespace Slate
