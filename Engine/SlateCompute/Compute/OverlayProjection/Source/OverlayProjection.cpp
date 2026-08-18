//============================================================================================================================================
//                                                        OVERLAYPROJECTION.CPP
//============================================================================================================================================
// 🧩 Two declarations that differ in exactly one behaviour, presence read straight out of `76`, and nothing that could ever be picked.

#include "SlateCompute/Compute/OverlayProjection/Api/OverlayProjection.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE DECLARATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

const char* const DepthTestedIdentity = "80-OverlayProjection-DepthTested";
const char* const DepthFreeIdentity   = "80-OverlayProjection-DepthFree";
const char* const OverlayOrigin       = "80 §3 OverlayProjection";

constexpr bool OverlayDeclarable(OverlaySubject Presented)
{
    return static_cast<std::uint32_t>(Presented) < static_cast<std::uint32_t>(OverlaySubject::OverlayCount);
}

}   // namespace

Deliver<bool> OverlayProjection::Declare(OverlaySubject Presented, const OverlaySpecification& Declaring)
{
    if (!OverlayDeclarable(Presented))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the closed count is not an overlay" });
    }

    if (!Declaring.OverlayColour.ColourDeclared())
    {
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an overlay colour declares no space" });
    }

    // 🔴 `80` §2: both recordings run after `66` and nothing between here and the display surface compresses. A
    //    colour arriving in the working space would be presented as display code without ever crossing `36`, and it
    //    reads as an overlay in a plausible but wrong hue rather than as a mistake.
    if (Declaring.OverlayColour.SpaceIdentity != DisplaySpaceIdentity)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "an overlay colour is not a coordinate in the display space" });
    }

    if (!(Declaring.LineExtent > 0.0))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a line extent of nothing draws the overlay at no pixel" });
    }

    // 🔴 Refused rather than ignored. A depth-free recording tests nothing, so an offset declared against it has no
    //    comparison to displace; ignored silently, the caller reads it as an offset that was too small and raises it
    //    until something the offset does reach breaks instead.
    if (DepthOfOverlay(Presented) == DepthSubject::DepthFree && Declaring.DepthOffset != 0.0)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a depth-free overlay tests no depth to offset — `80` §1" });
    }

    const std::size_t Ordinal = static_cast<std::size_t>(Presented);

    Declared[Ordinal]            = Declaring;
    DeclarationStanding[Ordinal] = true;
    OverlayDeclared              = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE RECORDINGS
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OverlayProjection::Contribute(RenderSchedule& Schedule) const
{
    if (!OverlayDeclared)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "no overlay was declared to record" });
    }

    // ① `08` §3 ⑩ — depth-tested. It amends `DepthSurface` as well as `DisplaySurface`, because depth-tested
    //    overlays occlude one another and a guide behind the ground lattice must be drawn behind it.
    DeclaredRecording Tested;
    Tested.Identity = DepthTestedIdentity;
    Tested.Reads    = { SharedTarget::DepthSurface };
    Tested.Produces = {};
    Tested.Amends   = { SharedTarget::DepthSurface, SharedTarget::DisplaySurface };

    // 🔴 `80` §4: neither recording writes `VisibilityIndex`, `OccupancySurface` or `MotionSurface`. Written there,
    //    the ground lattice would be picked by `74`, outlined by `26` when the artist selected it, and shaded by
    //    `18` as though it were a surface — three defects from one line.
    Tested.Command            = RecordingCommand::GraphicsRecording;
    Tested.CapabilityRequired = false;
    Tested.Substitution       = "";
    Tested.DisplayReferred    = true;
    Tested.AmendmentOrdinal   = DepthTestedOrdinal;

    const Deliver<bool> TestedContributed = Schedule.Contribute(Tested);

    if (!TestedContributed.ContentPresent)
    {
        return TestedContributed;
    }

    // ② `08` §3 ⑪ — depth-free. It reads no depth and amends none: a manipulator that respected depth would
    //    disappear inside the object it manipulates, which is `80` §1's second half.
    DeclaredRecording Free;
    Free.Identity = DepthFreeIdentity;
    Free.Reads    = {};
    Free.Produces = {};
    Free.Amends   = { SharedTarget::DisplaySurface };

    Free.Command            = RecordingCommand::GraphicsRecording;
    Free.CapabilityRequired = false;
    Free.Substitution       = "";
    Free.DisplayReferred    = true;
    Free.AmendmentOrdinal   = DepthFreeOrdinal;

    return Schedule.Contribute(Free);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE PRESENCE
//------------------------------------------------------------------------------------------------------------------------

bool OverlayProjection::OverlayStanding(const ToolSequence& Tooling, OverlaySubject Presented) const
{
    if (!OverlayDeclarable(Presented))
    {
        return false;
    }

    // 🔴 `80` §3's closing line: which overlays are present is held in `76` and is read here on the rotation it is
    //    read on. Nothing is copied — a held copy disagrees with the toggle the artist has just used, and the overlay
    //    then appears in one recording and not the other for as long as the copies differ.
    return DeclarationStanding[static_cast<std::size_t>(Presented)]
        && Tooling.OverlayStanding(Presented);
}

bool OverlayProjection::RecordingOccupied(const ToolSequence& Tooling, DepthSubject Behaviour) const
{
    for (std::uint32_t Ordinal = 0u;
         Ordinal < static_cast<std::uint32_t>(OverlaySubject::OverlayCount);
         ++Ordinal)
    {
        const OverlaySubject Presented = static_cast<OverlaySubject>(Ordinal);

        if (DepthOfOverlay(Presented) == Behaviour && OverlayStanding(Tooling, Presented))
        {
            return true;
        }
    }

    return false;
}

Deliver<const OverlaySpecification*> OverlayProjection::Specification(OverlaySubject Presented) const
{
    if (!OverlayDeclarable(Presented))
    {
        return Deliver<const OverlaySpecification*>::Refuse(
            { RefusalReason::ContentUnsupported, "the closed count is not an overlay" });
    }

    const std::size_t Ordinal = static_cast<std::size_t>(Presented);

    if (!DeclarationStanding[Ordinal])
    {
        return Deliver<const OverlaySpecification*>::Refuse(
            { RefusalReason::ContentUnsupported, "that overlay was never declared" });
    }

    return Deliver<const OverlaySpecification*>::Deliver(&Declared[Ordinal]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REPORTING
//------------------------------------------------------------------------------------------------------------------------

void OverlayProjection::Report(const ToolSequence& Tooling, MeasureIndex& Measured, TickPoint Sampled) const
{
    std::uint64_t TestedCount = 0u;
    std::uint64_t FreeCount   = 0u;

    for (std::uint32_t Ordinal = 0u;
         Ordinal < static_cast<std::uint32_t>(OverlaySubject::OverlayCount);
         ++Ordinal)
    {
        const OverlaySubject Presented = static_cast<OverlaySubject>(Ordinal);

        if (!OverlayStanding(Tooling, Presented))
        {
            continue;
        }

        if (DepthOfOverlay(Presented) == DepthSubject::DepthTested)
        {
            ++TestedCount;
        }
        else
        {
            ++FreeCount;
        }
    }

    // 📝 The counts overwrite and nothing is appended. An overlay that is drawn is the component working, and a
    //    report each rotation would bury the one obligation the artist did not expect — `86` §2.
    Measured.DeclareCount(OverlayOrigin, "DepthTestedOverlays", TestedCount, Sampled);
    Measured.DeclareCount(OverlayOrigin, "DepthFreeOverlays",   FreeCount,   Sampled);
}

}   // namespace Slate
