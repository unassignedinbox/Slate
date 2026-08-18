//============================================================================================================================================
//                                                            RENDERSCHEDULE.CPP
//============================================================================================================================================
// 🧩 Contribution gating and the ordering derived from declared reads and writes.

#include "SlateVulkan/Device/RenderSchedule/Api/RenderSchedule.h"

#include "Contract/ToleranceContract.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  TARGET DECLARATION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Extent relation per target, declared here once. A resize recreates every display-relative and
//    fraction-of-display target and no absolute one — `06` §4.1 ④ depends on this table being total.
namespace
{
    constexpr ExtentRelation RelationOf[static_cast<std::size_t>(SharedTarget::TargetCount)] =
    {
        ExtentRelation::DisplayRelative,    // DepthSurface
        ExtentRelation::DisplayRelative,    // VisibilityIndex
        ExtentRelation::DisplayRelative,    // OccupancySurface
        ExtentRelation::DisplayRelative,    // MotionSurface
        ExtentRelation::FractionOfDisplay,  // OcclusionSurface
        ExtentRelation::DisplayRelative,    // DirectOcclusionSurface
        ExtentRelation::DisplayRelative,    // TransmissionIndex
        ExtentRelation::DisplayRelative,    // RadianceSurface
        ExtentRelation::FractionOfDisplay,  // ReflectionSurface
        ExtentRelation::DisplayRelative,    // AccumulationSurface
        ExtentRelation::DisplayRelative,    // DisplaySurface
        ExtentRelation::DisplayRelative,    // OutlineSurface
        ExtentRelation::Absolute,           // TransmittanceSurface
        ExtentRelation::Absolute,           // MultiScatterSurface
        ExtentRelation::Absolute            // SkyViewSurface
    };

    constexpr std::size_t TargetSpan = static_cast<std::size_t>(SharedTarget::TargetCount);

    // 📝 Format per target, in the same order and read from `08` §2's table verbatim. The display surface's
    //    own format is the one exception — it is what the vendor's presentation surface declared and is
    //    therefore passed in rather than declared here.
    constexpr VkFormat FormatOf[TargetSpan] =
    {
        VK_FORMAT_D32_SFLOAT,             // DepthSurface
        VK_FORMAT_R32G32_UINT,            // VisibilityIndex — occupant ordinal and primitive ordinal
        VK_FORMAT_R8_UNORM,               // OccupancySurface
        VK_FORMAT_R16G16_SFLOAT,          // MotionSurface
        VK_FORMAT_R8_UNORM,               // OcclusionSurface
        VK_FORMAT_R8G8B8A8_UNORM,         // DirectOcclusionSurface — DirectOcclusionCapacity illuminants
        VK_FORMAT_R32G32_UINT,            // TransmissionIndex — TransmissionDepth layers of it
        VK_FORMAT_R16G16B16A16_SFLOAT,    // RadianceSurface
        VK_FORMAT_R16G16B16A16_SFLOAT,    // ReflectionSurface
        VK_FORMAT_R16G16B16A16_SFLOAT,    // AccumulationSurface
        VK_FORMAT_UNDEFINED,              // DisplaySurface — the presentation surface's own, passed in
        VK_FORMAT_R8_UNORM,               // OutlineSurface
        VK_FORMAT_R16G16B16A16_SFLOAT,    // TransmittanceSurface
        VK_FORMAT_R16G16B16A16_SFLOAT,    // MultiScatterSurface
        VK_FORMAT_R16G16B16A16_SFLOAT     // SkyViewSurface
    };

    // 📝 Intent per target. `08` §2's producer column decides it: what writes a target is what its usage must
    //    admit, and the depth attachment is the one target the vendor spells differently from every other.
    constexpr ImageIntent IntentOf[TargetSpan] =
    {
        ImageIntent::DepthTarget,       // DepthSurface
        ImageIntent::ColourTarget,      // VisibilityIndex — the hardware raster writes it as an attachment
        ImageIntent::ColourTarget,      // OccupancySurface
        ImageIntent::ColourTarget,      // MotionSurface
        ImageIntent::ComputeWritable,   // OcclusionSurface
        ImageIntent::ComputeWritable,   // DirectOcclusionSurface
        ImageIntent::ComputeWritable,   // TransmissionIndex
        ImageIntent::ComputeWritable,   // RadianceSurface
        ImageIntent::ComputeWritable,   // ReflectionSurface
        ImageIntent::ComputeWritable,   // AccumulationSurface
        ImageIntent::ColourTarget,      // DisplaySurface
        ImageIntent::ComputeWritable,   // OutlineSurface
        ImageIntent::ComputeWritable,   // TransmittanceSurface
        ImageIntent::ComputeWritable,   // MultiScatterSurface
        ImageIntent::ComputeWritable    // SkyViewSurface
    };

    // 📝 The absolute extents come from `Contract/ToleranceContract.h` because `28` reads them too — one set
    //    of numbers, two units, which is where `00` §2 places them. A zero here means the target is not
    //    absolute and its extent is derived from the display instead.
    constexpr std::uint32_t AbsoluteAlong[TargetSpan] =
    {
        0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
        TransmittanceExtentAlong,
        MultiScatterExtentAlong,
        SkyViewExtentAlong
    };

    constexpr std::uint32_t AbsoluteAcross[TargetSpan] =
    {
        0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
        TransmittanceExtentAcross,
        MultiScatterExtentAcross,
        SkyViewExtentAcross
    };

    // 📝 🔴 `TransmissionIndex` is `TransmissionDepth` sorted pairs per pixel and is claimed as that many
    //    array layers rather than as that many separate targets. One target, one claim, one view — which is
    //    what makes the depth a constant the shader reads rather than a count of descriptor slots.
    constexpr std::uint32_t LayersOf[TargetSpan] =
    {
        1u, 1u, 1u, 1u, 1u, 1u,
        TransmissionDepth,
        1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u
    };
}

ExtentRelation RelationOfTarget(SharedTarget Target)
{
    const std::size_t TargetOrdinal = static_cast<std::size_t>(Target);

    // 📝 A target outside the closed enumeration reads as absolute, which is the relation that touches
    //    nothing on a resize. The refusal for such a target is raised where it is claimed, not here.
    return TargetOrdinal < TargetSpan ? RelationOf[TargetOrdinal] : ExtentRelation::Absolute;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE SHAPES
//------------------------------------------------------------------------------------------------------------------------

Deliver<ImageShape> TargetSpace::ShapeOf(SharedTarget Target) const
{
    const std::size_t TargetOrdinal = static_cast<std::size_t>(Target);

    if (TargetOrdinal >= TargetSpan)
        return Deliver<ImageShape>::Refuse({ RefusalReason::ContentUnsupported, "no such shared target" });

    ImageShape Declared;
    Declared.Format     = TargetOrdinal == static_cast<std::size_t>(SharedTarget::DisplaySurface)
                            ? DisplayCarries
                            : FormatOf[TargetOrdinal];
    Declared.Intent     = IntentOf[TargetOrdinal];
    Declared.LayerCount = LayersOf[TargetOrdinal];
    Declared.LevelCount = 1u;

    switch (RelationOf[TargetOrdinal])
    {
        case ExtentRelation::DisplayRelative:
        {
            Declared.Width  = StandingWidth;
            Declared.Height = StandingHeight;
            break;
        }

        case ExtentRelation::FractionOfDisplay:
        {
            // 📝 Half per edge, rounded up. Rounding down leaves the last column of the display with no
            //    coarse texel over it, and `60` then samples outside its own target along one edge.
            Declared.Width  = (StandingWidth  + 1u) / 2u;
            Declared.Height = (StandingHeight + 1u) / 2u;
            break;
        }

        case ExtentRelation::Absolute:
        default:
        {
            Declared.Width  = AbsoluteAlong[TargetOrdinal];
            Declared.Height = AbsoluteAcross[TargetOrdinal];
            break;
        }
    }

    if (Declared.Width == 0u || Declared.Height == 0u)
        return Deliver<ImageShape>::Refuse({ RefusalReason::ContentUnsupported, "the target resolves to a zero extent" });

    if (Declared.Width > DisplayExtentCeiling || Declared.Height > DisplayExtentCeiling)
    {
        return Deliver<ImageShape>::Refuse(
            { RefusalReason::ContentUnsupported, "the target resolves above the declared display extent ceiling" });
    }

    if (Declared.Format == VK_FORMAT_UNDEFINED)
        return Deliver<ImageShape>::Refuse({ RefusalReason::ContentUnsupported, "the target resolves to no format" });

    return Deliver<ImageShape>::Deliver(Declared);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE CLAIM
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> TargetSpace::Claim(ImageSpace&    Images,
                                 std::uint32_t  DisplayWidth,
                                 std::uint32_t  DisplayHeight,
                                 VkFormat       DisplayFormat)
{
    if (DisplayWidth == 0u || DisplayHeight == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a display extent of zero" });

    if (DisplayWidth > DisplayExtentCeiling || DisplayHeight > DisplayExtentCeiling)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a display extent above the declared ceiling" });
    }

    if (DisplayFormat == VK_FORMAT_UNDEFINED)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the display surface declares no format" });

    // 📝 A second claim over a standing one surrenders first rather than claiming twice. The alternative
    //    leaks fifteen images per call and reports as memory growth attributable to nothing in particular.
    if (ImageEdge != nullptr)
        Surrender();

    ImageEdge      = &Images;
    StandingWidth  = DisplayWidth;
    StandingHeight = DisplayHeight;
    DisplayCarries = DisplayFormat;

    for (std::size_t TargetOrdinal = 0u; TargetOrdinal < TargetSpan; ++TargetOrdinal)
    {
        const Deliver<ImageShape> Declared = ShapeOf(static_cast<SharedTarget>(TargetOrdinal));

        if (!Declared.ContentPresent)
        {
            Surrender();
            return Deliver<bool>::Refuse(Declared.Declined);
        }

        const Deliver<ImageClaim> Claimed = Images.Claim(Declared.Resolve());

        // 🔴 Refused in full. Every target claimed so far is surrendered, so the caller is left with nothing
        //    rather than with a set that is complete up to whichever target the device declined.
        if (!Claimed.ContentPresent)
        {
            Surrender();
            return Deliver<bool>::Refuse(Claimed.Declined);
        }

        ClaimedFor[TargetOrdinal]    = Claimed.Resolve().ImageOrdinal;
        TargetClaimed[TargetOrdinal] = true;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> TargetSpace::Reclaim(std::uint32_t DisplayWidth, std::uint32_t DisplayHeight)
{
    if (ImageEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no target set stands to be reclaimed" });

    if (DisplayWidth == 0u || DisplayHeight == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a display extent of zero" });

    if (DisplayWidth > DisplayExtentCeiling || DisplayHeight > DisplayExtentCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a display extent above the declared ceiling" });

    StandingWidth  = DisplayWidth;
    StandingHeight = DisplayHeight;

    // 🔴 `06` §7: **every** display-relative and fraction-of-display target, and no absolute one. The two
    //    passes are separate — every affected target is released before any is re-claimed — so that the peak
    //    residency of a resize is one target set and not two.
    for (std::size_t TargetOrdinal = 0u; TargetOrdinal < TargetSpan; ++TargetOrdinal)
    {
        if (RelationOf[TargetOrdinal] == ExtentRelation::Absolute || !TargetClaimed[TargetOrdinal])
            continue;

        ImageEdge->Release(ClaimedFor[TargetOrdinal]);

        ClaimedFor[TargetOrdinal]    = AbsentImage;
        TargetClaimed[TargetOrdinal] = false;
    }

    for (std::size_t TargetOrdinal = 0u; TargetOrdinal < TargetSpan; ++TargetOrdinal)
    {
        if (RelationOf[TargetOrdinal] == ExtentRelation::Absolute)
            continue;

        const Deliver<ImageShape> Declared = ShapeOf(static_cast<SharedTarget>(TargetOrdinal));

        if (!Declared.ContentPresent)
        {
            Surrender();
            return Deliver<bool>::Refuse(Declared.Declined);
        }

        const Deliver<ImageClaim> Claimed = ImageEdge->Claim(Declared.Resolve());

        if (!Claimed.ContentPresent)
        {
            Surrender();
            return Deliver<bool>::Refuse(Claimed.Declined);
        }

        ClaimedFor[TargetOrdinal]    = Claimed.Resolve().ImageOrdinal;
        TargetClaimed[TargetOrdinal] = true;
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   WHAT IS CLAIMED
//------------------------------------------------------------------------------------------------------------------------

Deliver<ImageClaim> TargetSpace::Resolve(SharedTarget Target) const
{
    const Deliver<std::uint32_t> Ordinal = OrdinalOf(Target);

    if (!Ordinal.ContentPresent)
        return Deliver<ImageClaim>::Refuse(Ordinal.Declined);

    return ImageEdge->Standing(Ordinal.Resolve());
}

Deliver<std::uint32_t> TargetSpace::OrdinalOf(SharedTarget Target) const
{
    const std::size_t TargetOrdinal = static_cast<std::size_t>(Target);

    if (TargetOrdinal >= TargetSpan)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such shared target" });

    if (ImageEdge == nullptr || !TargetClaimed[TargetOrdinal])
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "the target is not claimed" });

    return Deliver<std::uint32_t>::Deliver(ClaimedFor[TargetOrdinal]);
}

void TargetSpace::Surrender()
{
    if (ImageEdge != nullptr)
    {
        for (std::size_t TargetOrdinal = 0u; TargetOrdinal < TargetSpan; ++TargetOrdinal)
        {
            if (TargetClaimed[TargetOrdinal])
                ImageEdge->Release(ClaimedFor[TargetOrdinal]);
        }
    }

    for (std::size_t TargetOrdinal = 0u; TargetOrdinal < TargetSpan; ++TargetOrdinal)
    {
        ClaimedFor[TargetOrdinal]    = AbsentImage;
        TargetClaimed[TargetOrdinal] = false;
    }

    // 📝 🔴 `06` §7: no persistent extent is carried across a change. The standing extent is forgotten with
    //    the images, so a re-claim that refuses cannot leave a later reader deriving a shape from the extent
    //    the surrendered set was claimed at.
    ImageEdge      = nullptr;
    StandingWidth  = 0u;
    StandingHeight = 0u;
    DisplayCarries = VK_FORMAT_UNDEFINED;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONTRIBUTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> RenderSchedule::Contribute(const DeclaredRecording& Arriving)
{
    if (OrderingFixed)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the ordering is already fixed" });

    // 📝 🔴 A capability requirement with no substitution is rejected here rather than discovered at the
    //    recording site. The substitution is a design decision belonging to the contributing document.
    if (Arriving.CapabilityRequired && (Arriving.Substitution == nullptr || Arriving.Substitution[0] == '\0'))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::CapabilityAbsent, "a capability is required with no declared substitution" });
    }

    for (const SharedTarget Produced : Arriving.Produces)
    {
        const std::size_t TargetOrdinal = static_cast<std::size_t>(Produced);

        if (TargetOrdinal >= TargetSpan)
            return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such shared target" });

        // 📝 One producing recording per target. An amender declares itself in Amends and takes its place
        //    in the ordered amendment list instead — `08` §2's Amended by column.
        if (ProducerOf[TargetOrdinal].IdentityDeclared())
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::HostDenied, "the target already declares a producing recording" });
        }

        ProducerOf[TargetOrdinal].SlotOrdinal    = static_cast<std::uint32_t>(ContributedOrder.size());
        ProducerOf[TargetOrdinal].SlotGeneration = 1u;
    }

    ContributedOrder.push_back(Arriving);
    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       ORDERING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> RenderSchedule::Fix()
{
    if (OrderingFixed)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the ordering is already fixed" });

    OrderedRecordings.clear();
    OrderedRecordings.reserve(ContributedOrder.size());

    std::vector<bool> Placed(ContributedOrder.size(), false);
    std::vector<bool> Available(TargetSpan, false);

    // 📝 The order is derived rather than authored: a recording is placed once every target it reads is
    //    either produced already or produced by nothing at all. Scene-referred recordings are exhausted
    //    before any display-referred one is placed, which is the tone line in `08` §3.1.
    for (int DisplayPhase = 0; DisplayPhase < 2; ++DisplayPhase)
    {
        const bool PlacingDisplayReferred = DisplayPhase == 1;
        bool       Advanced               = true;

        while (Advanced)
        {
            Advanced = false;

            // 📝 The placeable candidate with the least amendment ordinal is taken, rather than the first one
            //    found. Every recording that declares no ordinal carries nought, so a schedule of recordings
            //    that predate the field is placed in exactly the order it was before.
            std::size_t   Preferred        = ContributedOrder.size();
            std::uint32_t PreferredOrdinal = 0u;

            for (std::size_t Ordinal = 0u; Ordinal < ContributedOrder.size(); ++Ordinal)
            {
                if (Placed[Ordinal])
                    continue;

                const DeclaredRecording& Candidate = ContributedOrder[Ordinal];

                if (Candidate.DisplayReferred != PlacingDisplayReferred)
                    continue;

                bool ReadsSatisfied = true;

                for (const SharedTarget Consumed : Candidate.Reads)
                {
                    const std::size_t TargetOrdinal = static_cast<std::size_t>(Consumed);

                    if (ProducerOf[TargetOrdinal].IdentityDeclared() && !Available[TargetOrdinal])
                    {
                        ReadsSatisfied = false;
                        break;
                    }
                }

                if (!ReadsSatisfied)
                    continue;

                if (Preferred == ContributedOrder.size() || Candidate.AmendmentOrdinal < PreferredOrdinal)
                {
                    Preferred        = Ordinal;
                    PreferredOrdinal = Candidate.AmendmentOrdinal;
                }
            }

            if (Preferred == ContributedOrder.size())
                continue;

            const DeclaredRecording& Placing = ContributedOrder[Preferred];

            OrderedRecordings.push_back(Placing);
            Placed[Preferred] = true;
            Advanced          = true;

            for (const SharedTarget Produced : Placing.Produces)
                Available[static_cast<std::size_t>(Produced)] = true;
        }
    }

    if (OrderedRecordings.size() != ContributedOrder.size())
    {
        // 📝 A recording that never became placeable reads a target whose producer reads it back. The
        //    orderer reports it here rather than emitting an ordering that silently drops the recording.
        OrderedRecordings.clear();
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "a recording reads a target no ordering makes available" });
    }

    OrderingFixed = true;
    return Deliver<bool>::Deliver(true);
}

const std::vector<DeclaredRecording>& RenderSchedule::Ordered() const
{
    return OrderedRecordings;
}

}   // namespace Slate
