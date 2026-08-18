//============================================================================================================================================
//                                                          ASSETINTERCHANGE.CPP
//============================================================================================================================================
// 🧩 Faithful enrolment, unit scale applied once, and the emission validated before anything is resolved.

#include "SlateDocument/Document/AssetInterchange/Api/AssetInterchange.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  EMISSION VALIDATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr std::size_t ComponentSpan = static_cast<std::size_t>(ComponentSlot::ComponentCount);
constexpr std::size_t ChannelSpan   = static_cast<std::size_t>(ChannelSubject::ChannelCount);

}   // namespace

Deliver<bool> EmissionSpecification::Validate(const MaterialIndex& Materials) const
{
    if (Images.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the emission produces no image" });

    // 🔴 A channel emitted into two components anywhere in the specification is two answers to one question, and
    //    the consumer reads whichever image it loaded second. Tracked across the whole emission rather than per
    //    image, because the duplication that actually happens is one channel appearing in two different images.
    bool ChannelEmitted[ChannelSpan] = {};

    for (const EmittedImage& Held : Images)
    {
        if (Held.ExtentTexels == 0u)
            return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an image of no extent" });

        bool AnyOccupied = false;

        for (std::size_t Slot = 0u; Slot < ComponentSpan; ++Slot)
        {
            if (!Held.ComponentOccupied[Slot])
                continue;

            AnyOccupied = true;

            const std::size_t ChannelOrdinal = static_cast<std::size_t>(Held.Occupying[Slot]);

            if (ChannelOrdinal >= ChannelSpan)
                return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such channel" });

            if (ChannelEmitted[ChannelOrdinal])
                return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a channel is emitted twice" });

            ChannelEmitted[ChannelOrdinal] = true;

            // 🔴 A colour-carrying channel needs a declared space in the image that carries it — `36` §1 and
            //    `50` §5. An image written with no space is one the consumer decodes by guessing, and the guess
            //    that renders plausibly is the one that ships.
            bool ColourCarried = false;

            for (std::uint32_t MaterialOrdinal = 0u;
                 MaterialOrdinal < Materials.DeclaredCount() && !ColourCarried;
                 ++MaterialOrdinal)
            {
                const Deliver<const MaterialSpecification*> Resolved = Materials.Resolve(MaterialOrdinal);

                if (!Resolved.ContentPresent)
                    continue;

                ColourCarried = Resolved.Resolve()->ChannelConverted(Held.Occupying[Slot]);
            }

            if (ColourCarried && Held.SpaceIdentity == 0u)
            {
                return Deliver<bool>::Refuse(
                    { RefusalReason::ContentUnsupported, "a colour-carrying channel in an image declaring no space" });
            }
        }

        if (!AnyOccupied)
            return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an image with no occupied component" });
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE NAMING
//------------------------------------------------------------------------------------------------------------------------

std::string ResolveName(const std::string& Pattern,
                        const std::string& OccupantName,
                        const std::string& MaterialName,
                        const std::string& ChannelName,
                        std::uint32_t      ExtentTexels)
{
    std::string Extent;

    for (std::uint32_t Remaining = ExtentTexels; Remaining != 0u; Remaining /= 10u)
        Extent.insert(Extent.begin(), static_cast<char>('0' + (Remaining % 10u)));

    if (Extent.empty())
        Extent = "0";

    std::string Resolved;
    Resolved.reserve(Pattern.size());

    for (std::size_t Ordinal = 0u; Ordinal < Pattern.size(); ++Ordinal)
    {
        if (Pattern[Ordinal] != '{')
        {
            Resolved.push_back(Pattern[Ordinal]);
            continue;
        }

        const std::size_t Closing = Pattern.find('}', Ordinal);

        if (Closing == std::string::npos)
        {
            Resolved.push_back(Pattern[Ordinal]);
            continue;
        }

        const std::string Named = Pattern.substr(Ordinal + 1u, Closing - Ordinal - 1u);

        if (Named == "Occupant")
            Resolved += OccupantName;
        else if (Named == "Material")
            Resolved += MaterialName;
        else if (Named == "Channel")
            Resolved += ChannelName;
        else if (Named == "Extent")
            Resolved += Extent;
        else
        {
            // 📝 Left verbatim rather than emptied. A name that silently lost a field collides with every other
            //    name that lost the same one, and the export then overwrites itself one image at a time.
            Resolved += Pattern.substr(Ordinal, Closing - Ordinal + 1u);
        }

        Ordinal = Closing;
    }

    return Resolved;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOPOLOGY INTAKE
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> AssetInterchange::IntakeTopology(const DecodedTopology& Decoded,
                                               TopologyStructure&     Into,
                                               IntakeIndex&           Recorded)
{
    // 🔴 `50` §3: positions and face indexing are refused when absent. There is no default for either — a
    //    topology with no positions is not a topology at a smaller scale, it is not a topology.
    if (Decoded.Positions.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the source declared no position" });

    if (Decoded.Faces.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the source declared no face indexing" });

    // 📝 🔴 Validated in full before anything is enrolled. `50` §8: a partially failed intake enrols nothing,
    //    because half a topology enrolled as an occupant is an occupant the artist will paint on and export.
    for (const std::vector<std::uint32_t>& Face : Decoded.Faces)
    {
        if (Face.size() < 3u)
            return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a run of fewer than three corners" });

        for (const std::uint32_t VertexOrdinal : Face)
        {
            if (VertexOrdinal >= Decoded.Positions.size())
            {
                return Deliver<bool>::Refuse(
                    { RefusalReason::ContentUnsupported, "a corner addresses a position the source did not declare" });
            }
        }
    }

    std::uint32_t CornerSpan = 0u;

    for (const std::vector<std::uint32_t>& Face : Decoded.Faces)
        CornerSpan += static_cast<std::uint32_t>(Face.size());

    if (!Decoded.CornerCoordinates.empty() && Decoded.CornerCoordinates.size() != CornerSpan)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "one coordinate per corner is required" });

    if (!Decoded.Perpendiculars.empty() && Decoded.Perpendiculars.size() != Decoded.Positions.size())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "one perpendicular per vertex is required" });

    if (!Decoded.TangentBases.empty() && Decoded.TangentBases.size() != Decoded.Positions.size())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "one basis per vertex is required" });

    if (!Decoded.MaterialEnrollment.empty() && Decoded.MaterialEnrollment.size() != Decoded.Faces.size())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "one enrollment per face is required" });

    // 🔴 Unit scale applied **once**, here, at 64-bit and before anything narrows. Carried as a per-occupant
    //    multiplier instead, `02` §3.2's rebasing would still be correct and the geometry would still not line up.
    const double Scale = Decoded.UnitScaleDeclared ? Decoded.UnitScale : AssumedUnitScale;

    std::vector<DocumentPosition> Scaled = Decoded.Positions;

    if (Scale != 1.0)
    {
        for (DocumentPosition& Held : Scaled)
        {
            Held.PositionX *= Scale;
            Held.PositionY *= Scale;
            Held.PositionZ *= Scale;
        }
    }

    const Deliver<bool> PositionsDeclared = Into.DeclarePositions(Scaled);

    if (!PositionsDeclared.ContentPresent)
        return PositionsDeclared;

    for (const std::vector<std::uint32_t>& Face : Decoded.Faces)
    {
        const Deliver<bool> Enrolled = Into.DeclareFace(Face);

        if (!Enrolled.ContentPresent)
            return Enrolled;
    }

    if (!Decoded.CornerCoordinates.empty())
        Disregard(Into.DeclareCoordinates(Decoded.CornerCoordinates));

    if (!Decoded.Perpendiculars.empty())
        Disregard(Into.DeclarePerpendiculars(Decoded.Perpendiculars));

    if (!Decoded.TangentBases.empty())
        Disregard(Into.DeclareTangentBases(Decoded.TangentBases));

    if (!Decoded.MaterialEnrollment.empty())
        Disregard(Into.DeclareMaterialEnrollment(Decoded.MaterialEnrollment));

    const Deliver<bool> Sealed = Into.Seal();

    if (!Sealed.ContentPresent)
        return Sealed;

    IntakeRecord Recording;
    Recording.OriginPath = Decoded.OriginPath;
    Recording.Subject    = "Topology";

    if (!Decoded.UnitScaleDeclared)
    {
        Recording.Assumed          = AssumedSubject::UnitScale;
        Recording.AssumedMagnitude = AssumedUnitScale;
        Recording.AssumptionMade   = true;
    }

    Recorded.Record(Recording);

    // 🔴 `50` §6: constructs that will not survive are named **at intake**, not at export. Named at export they
    //    are named after the artist has already built on them, and the loss is attributed to the export rather
    //    than to the file.
    for (const std::string& Named : Decoded.UnsupportedNamed)
        UnsupportedNamed.push_back(Named);

    ++TopologyCount;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     IMAGE INTAKE
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> AssetInterchange::IntakeImage(const DecodedImage& Decoded, IntakeIndex& Recorded)
{
    if (Decoded.Width == 0u || Decoded.Height == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an image of no extent" });

    if (Decoded.ComponentCount == 0u || Decoded.BitDepth == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an image of no component" });

    if (Decoded.Original.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the original was not retained" });

    IntakeRecord Recording;
    Recording.OriginPath = Decoded.OriginPath;
    Recording.Subject    = "Imagery";

    // 🔴 `36` §3: content that declares nothing produces a recorded assumption and an `86` report. The working
    //    space is the assumption, because an image assumed linear and painted with is at least consistent — and
    //    the record is what lets the artist correct it from the retained original rather than from the result.
    if (!Decoded.SpaceDeclared)
    {
        Recording.Assumed        = AssumedSubject::ContentSpace;
        Recording.AssumedOrdinal = WorkingSpaceIdentity;
        Recording.AssumptionMade = true;
    }
    else
    {
        Recording.AssumedOrdinal = Decoded.SpaceIdentity;
    }

    Recorded.Record(Recording);

    ++ImageCount;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE EMISSION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> AssetInterchange::DeclareEmission(const EmissionSpecification& Declaring,
                                                const MaterialIndex&         Materials)
{
    const Deliver<bool> Validated = Declaring.Validate(Materials);

    if (!Validated.ContentPresent)
        return Validated;

    Declared = Declaring;

    return Deliver<bool>::Deliver(true);
}

const EmissionSpecification&     AssetInterchange::Emission() const    { return Declared;         }
const std::vector<std::string>&  AssetInterchange::Unsupported() const { return UnsupportedNamed; }

void AssetInterchange::Report(ReportSequence& Reporting, TickPoint Sampled)
{
    while (UnsupportedReported < UnsupportedNamed.size())
    {
        ReportSpecification Refused;
        Refused.Origin         = "50 §6 AssetInterchange";
        Refused.Subject        = "UnsupportedConstruct";
        Refused.Detail         = "the source carries a construct that will not survive an emission";
        Refused.SubjectOrdinal = UnsupportedReported;
        Refused.Disposition    = ReportDisposition::Refused;
        Refused.Arrival        = Sampled;

        Reporting.Append(Refused);

        ++UnsupportedReported;
    }
}

std::uint32_t AssetInterchange::IntakenTopologyCount() const { return TopologyCount; }
std::uint32_t AssetInterchange::IntakenImageCount() const    { return ImageCount;    }

}   // namespace Slate
