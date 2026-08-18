//============================================================================================================================================
//                                                           WORKSPACEPANEL.CPP
//============================================================================================================================================
// 🧩 The strip ground, the body, the footer and the vacant run — the parts the vendor's tab bar does not draw.

#include "SlateUI/Interface/WorkspacePanel/Api/WorkspacePanel.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> WorkspacePanel::Construct(RecordingSurface& Recording, const AppearanceSpecification& Declared)
{
    if (Surface != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a construction already stands" });

    Surface    = &Recording;
    Appearance = &Declared;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> WorkspacePanel::Record(const PlaneExtent& Extent, const char* Titled)
{
    if (Surface == nullptr || Appearance == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no construction stands" });

    const WorkspaceMetric& Measure = Appearance->WorkspaceMeasure;
    const WorkspaceInk&    Ink     = Appearance->Workspace;

    // 🔴 With NO workspace open the shell is plain black: no strip, no footer, one invitation in the
    //    middle. A grey strip and footer framing an empty panel present chrome for content that is not
    //    there, which reads as a broken workspace rather than as a fresh one.
    if (Titled == nullptr)
    {
        Surface->Ground(Extent, Ink.BodyGround);

        BodyExtent  = Extent;
        StripExtent = {};

        const float VacantTracking = Measure.VacantText * Measure.VacantTracking;

        Surface->TextRunCapitalised(Extent.LeastAlong  + Extent.SpanAlong()  * 0.5f,
                                    Extent.LeastAcross + Extent.SpanAcross() * 0.5f,
                                    Ink.VacantInk,
                                    "CREATE PANEL",
                                    Measure.VacantText,
                                    VacantTracking,
                                    true);

        return Deliver<bool>::Deliver(true);
    }

    // 🔴 The whole panel is the sheet's OLED ground and NOTHING else. The strip band and the footer
    //    were both retired: the dock node draws its own strip behind the tabs it lays out, so a band
    //    recorded here stood proud of it wherever the node did not reach — across the full window width
    //    while the node spanned only its own tabs — and read as a grey bar with tabs floating on it.
    // 📝 `WorkspaceMetric::FooterAcross`, `FooterEdgeWeight` and the two footer inks stay declared.
    //    They transcribe `.panelfooter` from the sheet and nothing here is authorised to delete a
    //    transcription; they are simply not recorded, because the artist asked for the band gone.
    Surface->Ground(Extent, Ink.BodyGround);

    // ⚠️ The strip extent is still reported, because the `+` and the dock space are seated against it.
    //    It measures where the node's own tab bar stands; it is no longer painted.
    StripExtent = { Extent.LeastAlong,
                    Extent.LeastAcross,
                    Extent.MostAlong,
                    Extent.LeastAcross + Measure.StripAcross };

    BodyExtent = { Extent.LeastAlong,
                   Extent.LeastAcross + Measure.StripAcross,
                   Extent.MostAlong,
                   Extent.MostAcross };

    if (BodyExtent.MostAcross < BodyExtent.LeastAcross)
        BodyExtent.MostAcross = BodyExtent.LeastAcross;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE READINGS
//------------------------------------------------------------------------------------------------------------------------

PlaneExtent WorkspacePanel::Body() const
{
    return BodyExtent;
}

PlaneExtent WorkspacePanel::Strip() const
{
    return StripExtent;
}

void WorkspacePanel::Reset()
{
    Surface    = nullptr;
    Appearance = nullptr;
    BodyExtent  = {};
    StripExtent = {};
}

}   // namespace Slate
