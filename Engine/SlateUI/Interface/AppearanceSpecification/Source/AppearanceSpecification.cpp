//============================================================================================================================================
//                                                       APPEARANCESPECIFICATION.CPP
//============================================================================================================================================
// 🧩 Multiplies every declared extent by the display scale exactly once.

#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE RESOLVE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 Scales only members measured in display pixels.
/// note  Tracking is measured in em, TongueClipFraction is dimensionless, and DisplayScale records the factor.
///       Every newly declared metric must therefore choose explicitly whether it enters this function.
/// cost  ✔️
void ScaleLengths(MetricScale& Measure, float AppliedScale)
{
    Measure.SpacingUnit             *= AppliedScale;
    Measure.RadiusFine              *= AppliedScale;
    Measure.RadiusSmall             *= AppliedScale;
    Measure.RadiusMedium            *= AppliedScale;
    Measure.RadiusGrand             *= AppliedScale;
    Measure.TextFine                *= AppliedScale;
    Measure.TextSmall               *= AppliedScale;
    Measure.TextBody                *= AppliedScale;
    Measure.TextTitle               *= AppliedScale;
    Measure.LeadingFine             *= AppliedScale;
    Measure.LeadingSmall            *= AppliedScale;
    Measure.LeadingBody             *= AppliedScale;
    Measure.LeadingTitle            *= AppliedScale;
    Measure.WheelTravel             *= AppliedScale;
    Measure.TongueAlong             *= AppliedScale;
    Measure.TongueAcross            *= AppliedScale;
    Measure.TongueGapAlong          *= AppliedScale;
    Measure.TonguePadAlong          *= AppliedScale;
    Measure.GripAlong               *= AppliedScale;
    Measure.GripAcross              *= AppliedScale;
    Measure.GripStripAcross         *= AppliedScale;
    Measure.GripLiftNorth           *= AppliedScale;
    Measure.RailAcross              *= AppliedScale;
    Measure.SymbolChevron           *= AppliedScale;
    Measure.SymbolTongue            *= AppliedScale;
    Measure.SymbolToggle            *= AppliedScale;
    Measure.SymbolVacant            *= AppliedScale;
    Measure.MedallionLattice        *= AppliedScale;
    Measure.MedallionColumn         *= AppliedScale;
    Measure.MedallionPreview        *= AppliedScale;
    Measure.LibraryAlongMedium      *= AppliedScale;
    Measure.LibraryAlongLarge       *= AppliedScale;
    Measure.PreviewAlongMedium      *= AppliedScale;
    Measure.PreviewAlongLarge       *= AppliedScale;
    Measure.LibraryPadAlong         *= AppliedScale;
    Measure.LibraryCaptionAcross    *= AppliedScale;
    Measure.GroupPadAcross          *= AppliedScale;
    Measure.GroupGapAcross          *= AppliedScale;
    Measure.SubjectIndentAlong      *= AppliedScale;
    Measure.SubjectPadTrailing      *= AppliedScale;
    Measure.SubjectStripPad         *= AppliedScale;
    Measure.ContentPad              *= AppliedScale;
    Measure.ContentPadLeading       *= AppliedScale;
    Measure.ContentHeadAcross       *= AppliedScale;
    Measure.ContentHeadPadAlong     *= AppliedScale;
    Measure.ContentHeadGap          *= AppliedScale;
    Measure.ContentTrailingPad      *= AppliedScale;
    Measure.ContentScrollPad        *= AppliedScale;
    Measure.EntryAlongCeiling       *= AppliedScale;
    Measure.EntryPadAlong           *= AppliedScale;
    Measure.EntryPadAcross          *= AppliedScale;
    Measure.TogglePad               *= AppliedScale;
    Measure.ToggleGap               *= AppliedScale;
    Measure.CardGapLattice          *= AppliedScale;
    Measure.CardGapColumn           *= AppliedScale;
    Measure.CardPadColumn           *= AppliedScale;
    Measure.CardGapColumnInner      *= AppliedScale;
    Measure.CardScrimAcross         *= AppliedScale;
    Measure.CardMetaGap             *= AppliedScale;
    Measure.CardMetaLift            *= AppliedScale;
    Measure.CardMetaDot             *= AppliedScale;
    Measure.PreviewGap              *= AppliedScale;
    Measure.PreviewPad              *= AppliedScale;
    Measure.PreviewBoxFloor         *= AppliedScale;
    Measure.PreviewBoxCeiling       *= AppliedScale;
    Measure.SkeletonGapUpper        *= AppliedScale;
    Measure.SkeletonGapLower        *= AppliedScale;
    Measure.SkeletonLeading         *= AppliedScale;
    Measure.BreakpointSmall         *= AppliedScale;
    Measure.BreakpointMedium        *= AppliedScale;
    Measure.BreakpointLarge         *= AppliedScale;
}

/// 🧩 Scales only the control members measured in display pixels.
/// note  🔴 Four members are deliberately absent — ReadoutTracking is em, MagnitudeCeiling is a domain bound,
///       RulerDegreesPerPixel is a rate, and TickReach is a count. Multiplying the domain bound would move the
///       slider's own maximum with the display, and multiplying the rate would make the ruler turn at a
///       different speed on a second monitor.
/// note  Point sizes are scaled here and floored afterwards, never floored here — the floor must be applied
///       once, against the finished product, and not once per member per factor.
/// cost  ✔️
void ScaleControlLengths(ControlMetric& Measure, float AppliedScale)
{
    Measure.ColumnAlong          *= AppliedScale;
    Measure.CardGapAcross        *= AppliedScale;
    Measure.CardPad              *= AppliedScale;
    Measure.CardRowGap           *= AppliedScale;
    Measure.CardRadius           *= AppliedScale;
    Measure.CardEdgeWeight       *= AppliedScale;
    Measure.PagePad              *= AppliedScale;
    Measure.PagePadAcross        *= AppliedScale;

    Measure.LabelText            *= AppliedScale;
    Measure.RowText              *= AppliedScale;
    Measure.ReadoutText          *= AppliedScale;
    Measure.UnitText             *= AppliedScale;
    Measure.TickCaptionText      *= AppliedScale;
    Measure.TooltipTitleText     *= AppliedScale;
    Measure.TooltipBodyText      *= AppliedScale;
    Measure.TooltipBodyLeading   *= AppliedScale;

    Measure.LabelAlong           *= AppliedScale;
    Measure.RowGapAlong          *= AppliedScale;

    Measure.FieldAcross          *= AppliedScale;
    Measure.FieldPadAlong        *= AppliedScale;
    Measure.ChevronCellAlong     *= AppliedScale;
    Measure.ChevronSymbol        *= AppliedScale;
    Measure.MenuLift             *= AppliedScale;
    Measure.MenuRadius           *= AppliedScale;
    Measure.MenuPad              *= AppliedScale;
    Measure.MenuGapAcross        *= AppliedScale;
    Measure.OptionPadAlong       *= AppliedScale;
    Measure.OptionPadAcross      *= AppliedScale;

    Measure.ReadoutAlong         *= AppliedScale;
    Measure.UnitCellAlong        *= AppliedScale;
    Measure.SliderAlong          *= AppliedScale;
    Measure.SliderAcross         *= AppliedScale;
    Measure.ThumbExtent          *= AppliedScale;

    Measure.RulerAcross          *= AppliedScale;
    Measure.RulerRadius          *= AppliedScale;
    Measure.TickSpacing          *= AppliedScale;
    Measure.TickWeight           *= AppliedScale;
    Measure.TickMajorAcross      *= AppliedScale;
    Measure.TickMediumAcross     *= AppliedScale;
    Measure.TickMinorAcross      *= AppliedScale;
    Measure.TickCaptionLift      *= AppliedScale;
    Measure.PointerWeight        *= AppliedScale;
    Measure.PointerAcross        *= AppliedScale;
    Measure.PointerDot           *= AppliedScale;
    Measure.PointerDotLift       *= AppliedScale;

    Measure.WellPad              *= AppliedScale;
    Measure.WellRadius           *= AppliedScale;
    Measure.WellGapAcross        *= AppliedScale;
    Measure.ToggleRowAcross      *= AppliedScale;
    Measure.ToggleRowPadAlong    *= AppliedScale;
    Measure.ToggleGapAlong       *= AppliedScale;
    Measure.RingExtent           *= AppliedScale;
    Measure.RingWeight           *= AppliedScale;
    Measure.RingDotExtent        *= AppliedScale;

    Measure.SubsetRowAcross      *= AppliedScale;
    Measure.SubsetRowPadAlong    *= AppliedScale;
    Measure.SubsetRailAlong      *= AppliedScale;

    Measure.StopStripAcross      *= AppliedScale;
    Measure.StopStripPadLeading  *= AppliedScale;
    Measure.StopStripPadTrailing *= AppliedScale;
    Measure.StopQuietExtent      *= AppliedScale;
    Measure.StopTakenExtent      *= AppliedScale;

    Measure.TooltipAlong         *= AppliedScale;
    Measure.TooltipPad           *= AppliedScale;
    Measure.TooltipRadius        *= AppliedScale;
    Measure.TooltipLift          *= AppliedScale;
    Measure.TooltipTitleGap      *= AppliedScale;
    Measure.TooltipArrowExtent   *= AppliedScale;
    Measure.TooltipArrowRadius   *= AppliedScale;
    Measure.TooltipArrowAlong    *= AppliedScale;
    Measure.TooltipArrowSink     *= AppliedScale;
    Measure.TriggerExtent        *= AppliedScale;
    Measure.TriggerRadius        *= AppliedScale;
    Measure.TriggerLeadAlong     *= AppliedScale;
    Measure.TriggerSymbol        *= AppliedScale;
    Measure.TooltipWellPad       *= AppliedScale;
    Measure.TooltipWellRadius    *= AppliedScale;
    Measure.TooltipWellFloor     *= AppliedScale;
    Measure.TooltipWellGap       *= AppliedScale;
}

/// 🧩 Raises every recorded point size to the legibility floor, after the whole product has been applied.
/// note  📐 The floor is applied to the eight point sizes and to the one leading that follows a point size.
///       TooltipBodyLeading is raised in the same proportion its run was, so a floored run keeps the line
///       spacing the sheet declared rather than overlapping the line beneath it.
/// cost  ✔️
void FloorRuns(ControlMetric& Measure)
{
    const float BodyBeforeFloor = Measure.TooltipBodyText;

    if (Measure.LabelText        < TextLegibilityFloor) Measure.LabelText        = TextLegibilityFloor;
    if (Measure.RowText          < TextLegibilityFloor) Measure.RowText          = TextLegibilityFloor;
    if (Measure.ReadoutText      < TextLegibilityFloor) Measure.ReadoutText      = TextLegibilityFloor;
    if (Measure.UnitText         < TextLegibilityFloor) Measure.UnitText         = TextLegibilityFloor;
    if (Measure.TickCaptionText  < TextLegibilityFloor) Measure.TickCaptionText  = TextLegibilityFloor;
    if (Measure.TooltipTitleText < TextLegibilityFloor) Measure.TooltipTitleText = TextLegibilityFloor;
    if (Measure.TooltipBodyText  < TextLegibilityFloor) Measure.TooltipBodyText  = TextLegibilityFloor;

    if (BodyBeforeFloor > 0.0f && Measure.TooltipBodyText > BodyBeforeFloor)
    {
        Measure.TooltipBodyLeading *= Measure.TooltipBodyText / BodyBeforeFloor;
    }
}

}   // namespace

ComfortDensity ClassifyDensity(const MetricScale& Measure, float ExtentAlong)
{
    if (ExtentAlong <= 0.0f)
        return ComfortDensity::Regular;

    if (ExtentAlong >= Measure.BreakpointLarge * 2.5f)
        return ComfortDensity::Expansive;

    if (ExtentAlong >= Measure.BreakpointLarge * 1.875f)
        return ComfortDensity::Spacious;

    if (ExtentAlong >= Measure.BreakpointLarge)
        return ComfortDensity::Regular;

    return ComfortDensity::Compact;
}

AppearanceSpecification Resolve(double DisplayScale, double ArtistScale, float ExtentAlong)
{
    AppearanceSpecification Resolved;

    const float AppliedScale = (DisplayScale > 0.0) ? static_cast<float>(DisplayScale) : 1.0f;

    // 📝 The preference is clamped and never refused — a preference outside the bounds is a settings file to
    //    survive, not a reason to bring the interface up at an extent nothing can be read at.
    const double Preferred    = (ArtistScale < ArtistScaleFloor)   ? ArtistScaleFloor
                              : (ArtistScale > ArtistScaleCeiling) ? ArtistScaleCeiling
                                                                   : ArtistScale;
    const float  ArtistFactor = static_cast<float>(Preferred);

    ScaleLengths(Resolved.Measure, AppliedScale);
    Resolved.Measure.DisplayScale = AppliedScale;

    // 🔴 The density is classified against breakpoints that have already been scaled, so the extent it reads
    //    and the thresholds it compares against are in the same units. Classifying first would compare a
    //    display-pixel extent against declared-pixel thresholds and step a density early on every dense panel.
    const ComfortDensity Classified   = ClassifyDensity(Resolved.Measure, ExtentAlong);
    const float          ControlScale = AuthoredReduction * DensityFactor(Classified) * AppliedScale * ArtistFactor;

    ScaleControlLengths(Resolved.ControlMeasure, ControlScale);
    FloorRuns(Resolved.ControlMeasure);

    Resolved.ControlMeasure.Density       = Classified;
    Resolved.ControlMeasure.AppliedFactor = ControlScale;
    Resolved.ControlMeasure.ArtistFactor  = ArtistFactor;

    // 📝 🔴 The three snap rates are the only figures outside `MetricScale` carrying a length, and they are
    //    scaled explicitly here rather than enrolled with its pixel measurements. Scaling the whole motion
    //    declaration would also multiply its fractions and elasticity, changing drawer arbitration.
    Resolved.Motion.SnapRateSoft *= static_cast<double>(AppliedScale);
    Resolved.Motion.SnapRateFirm *= static_cast<double>(AppliedScale);
    Resolved.Motion.SnapRateHard *= static_cast<double>(AppliedScale);

    return Resolved;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RESPONSIVE ARRANGEMENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 🔴 The source's breakpoints are evaluated against the **viewport**, not against the content column. Slate
//    has no viewport media query, so they are evaluated against the extent the lattice actually occupies. At
//    the source's own proportions the two agree; a panel torn off into its own window is where they part, and
//    the content-relative reading is the one that stays correct there.
std::uint32_t LatticeColumns(const MetricScale& Measure, float ContentAlong)
{
    if (ContentAlong >= Measure.BreakpointLarge)
        return 5u;

    if (ContentAlong >= Measure.BreakpointMedium)
        return 4u;

    if (ContentAlong >= Measure.BreakpointSmall)
        return 3u;

    return 2u;
}

}   // namespace Slate
