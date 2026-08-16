//============================================================================================================================================
//                                                        APPEARANCESPECIFICATION.H
//============================================================================================================================================
// 🧩 Every ink and every measured extent the interface draws with — resolved once against the display scale, then read.

#pragma once

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                          INK
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One display-referred ink, packed at eight bits per component.
/// note  ⚠️ Display-referred. `08` §3.1 places the interface after the tone projection, so nothing declared
///       here is ever tone-mapped a second time.
/// tag   contract, nonallocating, nonthrowing
struct InkOrdinate
{
    std::uint8_t  Red     = 0u;     // [-] - sRGB-encoded, never linear
    std::uint8_t  Green   = 0u;     // [-]
    std::uint8_t  Blue    = 0u;     // [-]
    std::uint8_t  Opacity = 255u;   // [-] - 255 is fully covering
};

/// 🧩 Constructs a fully covering ink from a packed 0xRRGGBB literal.
/// cost  ✔️
constexpr InkOrdinate Covering(std::uint32_t Packed)
{
    return InkOrdinate{ static_cast<std::uint8_t>((Packed >> 16) & 0xFFu),
                        static_cast<std::uint8_t>((Packed >>  8) & 0xFFu),
                        static_cast<std::uint8_t>( Packed        & 0xFFu),
                        255u };
}

/// 🧩 Constructs an ink at a declared coverage, matching CSS `color-mix(… n%, transparent)`.
/// in    Packed    [-]  0xRRGGBB
/// in    Coverage  [-]  zero is invisible, one is fully covering
/// cost  ✔️
constexpr InkOrdinate Partial(std::uint32_t Packed, double Coverage)
{
    InkOrdinate Constructed = Covering(Packed);
    Constructed.Opacity     = static_cast<std::uint8_t>(Coverage * 255.0 + 0.5);
    return Constructed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE NEUTRAL LADDER
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 The source declares its greys as `oklch(L 0 none)` — chroma exactly zero. For a neutral, the Oklab
//    coefficients sum to 0.9999999935, so L = Y^(1/3) to within a part in 10⁸ and Y = L³ exactly enough. The
//    sRGB transfer then gives the ordinates below. Nine of the ten agree with the hex table everyone recalls;
//    `NeutralFourHundred` does **not** — it resolves to 0xA1A1A1 and not to 0xA3A3A3, because the source is
//    Tailwind v4, whose palette was re-declared in Oklch rather than converted from the earlier hexes.
// ⚠️ Transcribing that one value from memory is precisely the sixteenth-place seam `ToleranceContract.h`
//    exists to prevent — two panels disagreeing by two ordinates with nothing in the build comparing them.
inline constexpr std::uint32_t NeutralOneHundred    = 0xF5F5F5u;   // [-] - oklch(97%   0 none)
inline constexpr std::uint32_t NeutralTwoHundred    = 0xE5E5E5u;   // [-] - oklch(92.2% 0 none)
inline constexpr std::uint32_t NeutralThreeHundred  = 0xD4D4D4u;   // [-] - oklch(87%   0 none)
inline constexpr std::uint32_t NeutralFourHundred   = 0xA1A1A1u;   // [-] - oklch(70.8% 0 none)  🔴 not A3A3A3
inline constexpr std::uint32_t NeutralFiveHundred   = 0x737373u;   // [-] - oklch(55.6% 0 none)
inline constexpr std::uint32_t NeutralSixHundred    = 0x525252u;   // [-] - oklch(43.9% 0 none)
inline constexpr std::uint32_t NeutralSevenHundred  = 0x404040u;   // [-] - oklch(37.1% 0 none)
inline constexpr std::uint32_t NeutralEightHundred  = 0x262626u;   // [-] - oklch(26.9% 0 none)
inline constexpr std::uint32_t NeutralNineHundred   = 0x171717u;   // [-] - oklch(20.5% 0 none)
inline constexpr std::uint32_t NeutralNineFifty     = 0x0A0A0Au;   // [-] - oklch(14.5% 0 none)
inline constexpr std::uint32_t AbsoluteBlack        = 0x000000u;   // [-] - --color-black

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RESOLVED INKS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every ink the interface draws with, named by the responsibility it carries rather than by its ladder rung.
/// note  A second appearance is a second filled instance of this record and nothing else — no call site names
///       a ladder rung directly, so no call site has to be revisited to add one.
/// tag   contract, nonallocating, nonthrowing
struct SurfaceInk
{
    InkOrdinate  SurfaceGround       = Covering(NeutralNineFifty);        // [-] - workspace ground, preview rail
    InkOrdinate  SurfaceStanding     = Covering(NeutralNineHundred);      // [-] - drawer body, preview box
    InkOrdinate  SurfaceSunken       = Covering(AbsoluteBlack);           // [-] - library rail, tab tongue
    InkOrdinate  SurfaceRaised       = Covering(NeutralEightHundred);     // [-] - text entry, active toggle, bar
    InkOrdinate  SurfaceLifted       = Covering(NeutralFiveHundred);      // [-] - roused medallion

    InkOrdinate  CardGround          = Partial(NeutralEightHundred, 0.40);// [-] - bg-neutral-800/40
    InkOrdinate  CardGroundRoused    = Partial(NeutralSevenHundred, 0.60);// [-] - hover:bg-neutral-700/60
    InkOrdinate  CardEdge            = Partial(NeutralSevenHundred, 0.50);// [-] - border-neutral-700/50
    InkOrdinate  CardEdgeRoused      = Covering(NeutralFiveHundred);      // [-] - hover:border-neutral-500
    InkOrdinate  MedallionGround     = Partial(NeutralSevenHundred, 0.50);// [-] - the 32 px and 40 px discs
    InkOrdinate  MedallionRoused     = Covering(NeutralFiveHundred);      // [-] - group-hover:bg-neutral-500

    InkOrdinate  GroupGroundTaken    = Partial(NeutralNineHundred, 0.40); // [-] - bg-neutral-900/40
    InkOrdinate  GroupGroundRoused   = Partial(NeutralNineHundred, 0.20); // [-] - hover:bg-neutral-900/20
    InkOrdinate  SubjectGroundTint   = Partial(NeutralNineHundred, 0.10); // [-] - bg-neutral-900/10
    InkOrdinate  SubjectGroundTaken  = Partial(NeutralNineHundred, 0.60); // [-] - bg-neutral-900/60

    InkOrdinate  EdgeQuiet           = Covering(NeutralEightHundred);     // [-] - every 1 px divider
    InkOrdinate  EdgeFaint           = Partial(NeutralEightHundred, 0.50);// [-] - border-neutral-800/50
    InkOrdinate  GripPill            = Covering(NeutralSixHundred);       // [-] - the 48 × 6 pill
    InkOrdinate  MeterDot            = Covering(NeutralSevenHundred);     // [-] - the 4 px meta separator

    InkOrdinate  InkPrimary          = Covering(NeutralOneHundred);       // [-] - titles, taken rows
    InkOrdinate  InkRoused           = Covering(NeutralTwoHundred);       // [-] - hovered group row
    InkOrdinate  InkTertiary         = Covering(NeutralThreeHundred);     // [-] - card caption, hovered subject
    InkOrdinate  InkMuted            = Covering(NeutralFourHundred);      // [-] - quiet group row, quiet toggle
    InkOrdinate  InkFaint            = Covering(NeutralFiveHundred);      // [-] - quiet subject, meta, captions
    InkOrdinate  InkGhost            = Covering(NeutralSixHundred);       // [-] - the LIBRARY caption

    InkOrdinate  RailTaken           = Covering(NeutralOneHundred);       // [-] - the 3 px selection rail
    InkOrdinate  RailQuiet           = Partial(AbsoluteBlack, 0.00);      // [-] - bg-transparent

    InkOrdinate  ScrimTop            = Partial(NeutralNineHundred, 0.80); // [-] - from-neutral-900/80
    InkOrdinate  ScrimBottom         = Partial(NeutralNineHundred, 0.00); // [-] - to-transparent
    InkOrdinate  FocusRing           = Covering(NeutralFiveHundred);      // [-] - focus:ring-1 ring-neutral-500
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CONTROL LADDER
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 `References/Controls.html` declares its greys as raw hexadecimal and **not** as Tailwind's Oklch
//    palette. Not one of the eleven below coincides with a rung of the neutral ladder above: the source's
//    card is 0x121212 where the nearest rung is 0x171717, and its taken row is 0x2A2A2A where the nearest is
//    0x262626. Snapping them onto the ladder would recolour every control by two to four ordinates against a
//    reference that states them exactly, so the two ladders stand side by side and neither is derived from
//    the other.
// ⚠️ These are the control sheet's own figures. A panel that wants a workspace grey reads the neutral ladder;
//    a panel that wants a control grey reads this one. Mixing them within one control is the seam that makes
//    two adjacent fields disagree by an ordinate nothing in the build compares.
inline constexpr std::uint32_t ControlPageGround    = 0x050505u;   // [-] - body, bg-[#050505]
inline constexpr std::uint32_t ControlCardGround    = 0x121212u;   // [-] - the six panel cards
inline constexpr std::uint32_t ControlWellGround    = 0x1A1A1Au;   // [-] - unit cell, group well, chevron cell
inline constexpr std::uint32_t ControlWellRoused    = 0x222222u;   // [-] - hover:bg-[#222222], and the ruler ground
inline constexpr std::uint32_t ControlRowTaken      = 0x2A2A2Au;   // [-] - the taken multi-select row
inline constexpr std::uint32_t ControlStopQuiet     = 0x333333u;   // [-] - the 16 px unselected stop
inline constexpr std::uint32_t ControlTickMinor     = 0x444444u;   // [-] - the minor tick, and the quiet toggle ring
inline constexpr std::uint32_t ControlStopRoused    = 0x555555u;   // [-] - hover:bg-[#555555]
inline constexpr std::uint32_t ControlUnitInk       = 0x666666u;   // [-] - the unit glyph, and the tick caption
inline constexpr std::uint32_t ControlTrackTaken    = 0x7A7A7Au;   // [-] - the slider track below the fraction
inline constexpr std::uint32_t ControlQuietInk      = 0x888888u;   // [-] - every quiet label and the dark tooltip body
inline constexpr std::uint32_t ControlRousedInk     = 0xAAAAAAu;   // [-] - group-hover:text-[#aaaaaa]
inline constexpr std::uint32_t ControlPrimaryInk    = 0xF0F0F0u;   // [-] - every taken label, ring, dot and rail
inline constexpr std::uint32_t ControlThumbGround   = 0xE0E0E0u;   // [-] - the 44 px slider thumb
inline constexpr std::uint32_t ControlStopTaken     = 0xE8E8E8u;   // [-] - the 52 px selected stop
inline constexpr std::uint32_t ControlLightGround   = 0xFFFFFFu;   // [-] - the light tooltip and its trigger
inline constexpr std::uint32_t ControlDarkGround    = 0x151515u;   // [-] - the dark tooltip and its trigger
inline constexpr std::uint32_t ControlDarkInk       = 0x111111u;   // [-] - ink on a light ground
inline constexpr std::uint32_t ControlTooltipBody   = 0x777777u;   // [-] - the light tooltip's body run
inline constexpr std::uint32_t ControlPointerInk    = 0x6C77FFu;   // [-] - the ruler's centre line and dot

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE CONTROL INKS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every ink the eight declared controls draw with, named by the responsibility it carries.
/// note  🔴 No recording site names a hexadecimal literal. A second control appearance is a second filled
///       instance of this record, which is why the sheet's twenty figures resolve into named members here and
///       are never transcribed at a call site.
/// note  The source's shadows are absent by declaration and not by omission — no halo, glow, inner shadow or
///       shadow ordinate is named anywhere in this record. Depth is carried by ground and edge alone.
/// tag   contract, nonallocating, nonthrowing
struct ControlInk
{
    InkOrdinate  PageGround         = Covering(ControlPageGround);        // [-] - behind every card
    InkOrdinate  CardGround         = Covering(ControlCardGround);        // [-] - the panel card
    InkOrdinate  CardEdge           = Partial(ControlLightGround, 0.05);  // [-] - border-white/5
    InkOrdinate  WellGround         = Covering(ControlWellGround);        // [-] - the toggle and subset wells

    InkOrdinate  FieldGround        = Covering(AbsoluteBlack);            // [-] - the selection field, the readout
    InkOrdinate  FieldInk           = Covering(ControlPrimaryInk);        // [-] - the run inside it
    InkOrdinate  CellGround         = Covering(ControlWellGround);        // [-] - the chevron cell, the unit cell
    InkOrdinate  CellGroundRoused   = Covering(ControlWellRoused);        // [-] - hover:bg-[#222222]
    InkOrdinate  CellInk            = Covering(ControlQuietInk);          // [-] - the chevron
    InkOrdinate  UnitInk            = Covering(ControlUnitInk);           // [-] - the degree, percent and pixel glyphs

    InkOrdinate  MenuGround         = Covering(AbsoluteBlack);            // [-] - the open selection menu
    InkOrdinate  MenuEdge           = Covering(ControlWellRoused);        // [-] - border-[#222222]
    InkOrdinate  OptionInk          = Covering(ControlQuietInk);          // [-] - a quiet option
    InkOrdinate  OptionGroundRoused = Covering(0x111111u);                // [-] - hover:bg-[#111111]
    InkOrdinate  OptionInkRoused    = Covering(ControlPrimaryInk);        // [-] - hover:text-[#f0f0f0]

    InkOrdinate  TrackQuiet         = Covering(ControlWellRoused);        // [-] - the track beyond the fraction
    InkOrdinate  TrackTaken         = Covering(ControlTrackTaken);        // [-] - the track below the fraction
    InkOrdinate  TrackEdge          = Partial(AbsoluteBlack, 0.20);       // [-] - border-black/20
    InkOrdinate  ThumbGround        = Covering(ControlThumbGround);       // [-] - the 44 px disc

    InkOrdinate  RulerGround        = Covering(ControlWellRoused);        // [-] - the tick strip's ground
    InkOrdinate  TickMajor          = Covering(ControlPrimaryInk);        // [-] - every tenth tick
    InkOrdinate  TickMedium         = Covering(ControlQuietInk);          // [-] - every fifth tick
    InkOrdinate  TickMinor          = Covering(ControlTickMinor);         // [-] - every other tick
    InkOrdinate  TickCaption        = Covering(ControlUnitInk);           // [-] - the degree run under a major tick
    InkOrdinate  RulerPointer       = Covering(ControlPointerInk);        // [-] - the centre line and its dot

    InkOrdinate  RingTaken          = Covering(ControlPrimaryInk);        // [-] - border-[#f0f0f0]
    InkOrdinate  RingQuiet          = Covering(ControlTickMinor);         // [-] - border-[#444444]
    InkOrdinate  RingRoused         = Covering(ControlUnitInk);           // [-] - group-hover:border-[#666666]
    InkOrdinate  RingDot            = Covering(ControlPrimaryInk);        // [-] - the 16 px dot

    InkOrdinate  LabelTaken         = Covering(ControlPrimaryInk);        // [-] - text-[#f0f0f0]
    InkOrdinate  LabelQuiet         = Covering(ControlQuietInk);          // [-] - text-[#888888]
    InkOrdinate  LabelRoused        = Covering(ControlRousedInk);         // [-] - group-hover:text-[#aaaaaa]

    InkOrdinate  RowGroundTaken     = Covering(ControlRowTaken);          // [-] - bg-[#2a2a2a]
    InkOrdinate  RowGroundRoused    = Covering(ControlWellRoused);        // [-] - hover:bg-[#222222]
    InkOrdinate  RowGroundQuiet     = Partial(AbsoluteBlack, 0.00);       // [-] - bg-transparent
    InkOrdinate  RowRailTaken       = Covering(ControlPrimaryInk);        // [-] - the 4 px rail
    InkOrdinate  RowRailQuiet       = Partial(AbsoluteBlack, 0.00);       // [-] - bg-transparent

    InkOrdinate  StopQuiet          = Covering(ControlStopQuiet);         // [-] - bg-[#333333]
    InkOrdinate  StopRoused         = Covering(ControlStopRoused);        // [-] - hover:bg-[#555555]
    InkOrdinate  StopTaken          = Covering(ControlStopTaken);         // [-] - bg-[#e8e8e8]
    InkOrdinate  StopTakenInk       = Covering(ControlDarkInk);           // [-] - the letter inside it

    InkOrdinate  TooltipLightGround = Covering(ControlLightGround);       // [-] - bg-[#ffffff]
    InkOrdinate  TooltipLightTitle  = Covering(ControlDarkInk);           // [-] - text-[#111111]
    InkOrdinate  TooltipLightBody   = Covering(ControlTooltipBody);       // [-] - text-[#777777]
    InkOrdinate  TooltipDarkGround  = Covering(ControlDarkGround);        // [-] - bg-[#151515]
    InkOrdinate  TooltipDarkTitle   = Covering(ControlLightGround);       // [-] - text-white
    InkOrdinate  TooltipDarkBody    = Covering(ControlQuietInk);          // [-] - text-[#888888]
    InkOrdinate  TriggerLightGround = Covering(ControlLightGround);       // [-] - the light 64 px trigger
    InkOrdinate  TriggerLightInk    = Covering(ControlDarkInk);           // [-] - the figure inside it
    InkOrdinate  TriggerDarkGround  = Covering(ControlDarkGround);        // [-] - the dark 64 px trigger
    InkOrdinate  TriggerDarkInk     = Covering(ControlLightGround);       // [-] - the figure inside it
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MEASURED SCALE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every extent the source states, already multiplied by the display scale.
/// note  🔴 Multiplied **once**, at resolve. A call site that scales again produces a panel correct at exactly
///       one display scale, and the defect only appears on a second machine.
/// tag   contract, nonallocating, nonthrowing
struct MetricScale
{
    float  SpacingUnit          =   4.0f;   // [px] - --spacing, 0.25rem; every padding is a multiple

    float  RadiusFine           =   4.0f;   // [px] - rounded
    float  RadiusSmall          =   8.0f;   // [px] - rounded-lg
    float  RadiusMedium         =  12.0f;   // [px] - rounded-xl
    float  RadiusGrand          =  16.0f;   // [px] - rounded-2xl

    float  TextFine             =  10.0f;   // [px] - text-[10px]
    float  TextSmall            =  12.0f;   // [px] - text-xs
    float  TextBody             =  14.0f;   // [px] - text-sm
    float  TextTitle            =  24.0f;   // [px] - text-2xl

    // 📐 The sheet's own line heights. `html` declares 1.5, and three size utilities override it:
    //    text-xs is calc(1 / .75), text-sm is calc(1.25 / .875), text-2xl is calc(2 / 1.5). text-[10px]
    //    is arbitrary and therefore inherits the 1.5. A row height derived from the point size alone is
    //    short by four pixels on every group row, and fourteen groups accumulate that into a visible drift.
    float  LeadingFine          =  15.0f;   // [px] - text-[10px] at the inherited 1.5
    float  LeadingSmall         =  16.0f;   // [px] - text-xs
    float  LeadingBody          =  20.0f;   // [px] - text-sm
    float  LeadingTitle         =  32.0f;   // [px] - text-2xl

    float  WheelTravel          = 100.0f;   // [px] - one wheel notch, as the host reports it

    float  TrackingTight        =  -0.025f; // [em] - tracking-tight
    float  TrackingWide         =   0.025f; // [em] - tracking-wide
    float  TrackingWider        =   0.05f;  // [em] - tracking-wider
    float  TrackingWidest       =   0.20f;  // [em] - tracking-[0.2em]

    float  TongueAlong          = 220.0f;   // [px] - the drawer tab
    float  TongueAcross         =  36.0f;   // [px]
    float  TongueClipFraction   =   0.08f;  // [-]  - polygon inset, 8 % of TongueAlong per side
    float  TongueGapAlong       =  10.0f;   // [px] - gap-2.5 between symbol and caption
    float  TonguePadAlong       =  24.0f;   // [px] - px-6

    float  GripAlong            =  48.0f;   // [px] - w-12
    float  GripAcross           =   6.0f;   // [px] - h-1.5
    float  GripStripAcross      =  40.0f;   // [px] - h-10, the south drawer's grip strip
    float  GripLiftNorth        =  24.0f;   // [px] - bottom-6, the north drawer's grip

    float  RailAcross           =   3.0f;   // [px] - w-[3px]

    float  SymbolChevron        =  16.0f;   // [px] - w-4 h-4
    float  SymbolTongue         =  16.0f;   // [px] - w-4 h-4, stroked at 2.5
    float  SymbolToggle         =  20.0f;   // [px] - w-5 h-5
    float  SymbolVacant         =  32.0f;   // [px] - w-8 h-8, the empty-result magnifier

    float  MedallionLattice     =  32.0f;   // [px] - w-8 h-8
    float  MedallionColumn      =  40.0f;   // [px] - w-10 h-10
    float  MedallionPreview     =  48.0f;   // [px] - w-12 h-12

    float  LibraryAlongMedium   = 224.0f;   // [px] - md:w-56
    float  LibraryAlongLarge    = 256.0f;   // [px] - lg:w-64
    float  PreviewAlongMedium   = 192.0f;   // [px] - w-48
    float  PreviewAlongLarge    = 256.0f;   // [px] - lg:w-64

    float  LibraryPadAlong      =  24.0f;   // [px] - px-6
    float  LibraryCaptionAcross =  24.0f;   // [px] - py-6
    float  GroupPadAcross       =  10.0f;   // [px] - py-2.5
    float  GroupGapAcross       =   4.0f;   // [px] - gap-1
    float  SubjectIndentAlong   =  40.0f;   // [px] - pl-10
    float  SubjectPadTrailing   =  24.0f;   // [px] - pr-6
    float  SubjectStripPad      =   6.0f;   // [px] - py-1.5

    float  ContentPad           =  24.0f;   // [px] - p-6
    float  ContentPadLeading    =  16.0f;   // [px] - pt-4
    float  ContentHeadAcross    =  40.0f;   // [px] - h-10
    float  ContentHeadPadAlong  =   8.0f;   // [px] - px-2
    float  ContentHeadGap       =  24.0f;   // [px] - mb-6
    float  ContentTrailingPad   =  48.0f;   // [px] - pb-12
    float  ContentScrollPad     =   8.0f;   // [px] - pr-2

    float  EntryAlongCeiling    = 320.0f;   // [px] - max-w-xs, 20rem
    float  EntryPadAlong        =  16.0f;   // [px] - px-4
    float  EntryPadAcross       =   6.0f;   // [px] - py-1.5
    float  TogglePad            =   8.0f;   // [px] - p-2
    float  ToggleGap            =   8.0f;   // [px] - gap-2

    float  CardGapLattice       =  16.0f;   // [px] - gap-4
    float  CardGapColumn        =   8.0f;   // [px] - gap-2
    float  CardPadColumn        =  12.0f;   // [px] - p-3
    float  CardGapColumnInner   =  16.0f;   // [px] - gap-4
    float  CardScrimAcross      =  36.0f;   // [px] - p-3 above and below a 12 px caption
    float  CardMetaGap          =   8.0f;   // [px] - gap-2
    float  CardMetaLift         =   2.0f;   // [px] - mt-0.5
    float  CardMetaDot          =   4.0f;   // [px] - w-1 h-1

    float  PreviewGap           =  24.0f;   // [px] - gap-6
    float  PreviewPad           =  24.0f;   // [px] - p-6
    float  PreviewBoxFloor      =  80.0f;   // [px] - min-h-[80px]
    float  PreviewBoxCeiling    = 240.0f;   // [px] - max-h-[240px]
    float  SkeletonGapUpper     =  12.0f;   // [px] - space-y-3
    float  SkeletonGapLower     =   8.0f;   // [px] - space-y-2
    float  SkeletonLeading      =  16.0f;   // [px] - pt-4 above the lower group

    float  BreakpointSmall      = 640.0f;   // [px] - 40rem
    float  BreakpointMedium     = 768.0f;   // [px] - 48rem
    float  BreakpointLarge      = 1024.0f;  // [px] - 64rem

    float  DisplayScale         =   1.0f;   // [-]  - what every extent above was multiplied by
};

// 📝 The five preview bars, as the source states them: two in the upper group at 16 px and 12 px, three in the
//    lower at 8 px. The fractions are of the rail's inner extent. Declared here rather than at the recording
//    site because `AssetPanel` records them and the next appearance will re-measure them.
inline constexpr float SkeletonBarAcross[5]   = { 16.0f, 12.0f,  8.0f,  8.0f,  8.0f };   // [px]
inline constexpr float SkeletonBarFraction[5] = {  0.75f, 0.50f, 1.00f, 1.00f, 0.80f };  // [-]

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE AUTHORED DENSITY
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 `References/Controls.html` is authored at twice the density the engine draws at. Halving every figure
//    it states lands ten of its thirteen distinct extents exactly on a rung `MetricScale` already declares —
//    its 32 px card radius on `RadiusGrand`, its 24 px menu radius on `RadiusMedium`, its 24 px row run on
//    `TextSmall`, its 32 px toggle ring on `SymbolChevron`. Ten coincidences are the arithmetic reporting that
//    the sheet was drawn at 2×, not a factor chosen because the result looked agreeable.
// ⚠️ The sheet additionally declares `scale-110` on its own column. That is a property of the reference page
//    and not of the controls, so it is **not** folded in here; a host that wants it passes it as ArtistScale.
inline constexpr float AuthoredReduction = 0.5f;   // [-] - the sheet's authored density, divided out once

// 📐 Halving puts the tooltip body at 7.5 px and the ruler's degree captions at 6 px, and neither is legible
//    at any display scale. The floor applies to point sizes only — never to an extent, because a row that
//    refused to shrink while its run did would break the arrangement the run sits in.
inline constexpr float TextLegibilityFloor = 11.0f;   // [px] - no run is ever recorded below this

/// 🧩 How generous the arrangement is, classified from the extent the display actually offers.
/// note  🔴 A classification of extent and never of pixel density. A dense laptop panel and a dense phone
///       report the same display scale and want different arrangements; what separates them is how much
///       room there is, which is what this reads.
/// tag   contract
enum class ComfortDensity : std::uint32_t
{
    Compact      = 0u,   // [-] - below 1024 px; the laptop panel, tightened
    Regular      = 1u,   // [-] - below 1920 px; what the sheet was drawn for
    Spacious     = 2u,   // [-] - below 2560 px
    Expansive    = 3u,   // [-] - at and above 2560 px; the 4K panel, opened out
    DensityCount = 4u    // [-] - the closed count, never a density
};

/// 🧩 The factor one classified density multiplies every extent by.
/// in    Classified  [-]  a density outside the closed set resolves at Regular
/// out   Factor      [-]  0.90, 1.00, 1.10 or 1.20
/// cost  ✔️
constexpr float DensityFactor(ComfortDensity Classified)
{
    switch (Classified)
    {
        case ComfortDensity::Compact:   return 0.90f;
        case ComfortDensity::Regular:   return 1.00f;
        case ComfortDensity::Spacious:  return 1.10f;
        case ComfortDensity::Expansive: return 1.20f;
        default:                        return 1.00f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CONTROL MEASURE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every extent the eight declared controls occupy, stated at the sheet's authored density.
/// note  🔴 Stated **authored**, resolved **reduced**. Every member below is the figure `Controls.html` states,
///       transcribed verbatim so the two can be compared line by line; `Resolve` multiplies each of them by
///       AuthoredReduction and by the three scale factors exactly once. A member transcribed pre-divided
///       cannot be checked against the sheet, which is the whole reason the sheet is quoted in the comment.
/// tag   contract, nonallocating, nonthrowing
struct ControlMetric
{
    // The column and its cards -------------------------------------------------------------------------------
    float  ColumnAlong          = 800.0f;   // [px] - max-w-[800px]
    float  CardGapAcross        =  24.0f;   // [px] - gap-6 between cards
    float  CardPad              =  32.0f;   // [px] - p-8
    float  CardRowGap           =  32.0f;   // [px] - gap-8 between rows inside a card
    float  CardRadius           =  32.0f;   // [px] - rounded-[32px]
    float  CardEdgeWeight       =   1.0f;   // [px] - border
    float  PagePad              =  48.0f;   // [px] - p-12
    float  PagePadAcross        = 128.0f;   // [px] - py-32

    // Runs ---------------------------------------------------------------------------------------------------
    float  LabelText            =  30.0f;   // [px] - text-3xl, the leading label of every row
    float  RowText              =  24.0f;   // [px] - text-2xl, options, toggles, subset rows, the taken stop
    float  ReadoutText          =  30.0f;   // [px] - text-3xl font-semibold, the numeric readout
    float  UnitText             =  24.0f;   // [px] - text-2xl, the unit cell's glyph
    float  TickCaptionText      =  12.0f;   // [px] - text-xs font-semibold, the degree run under a major tick
    float  TooltipTitleText     =  18.0f;   // [px] - text-lg font-bold
    float  TooltipBodyText      =  15.0f;   // [px] - text-[15px]
    float  TooltipBodyLeading   =  24.0f;   // [px] - leading-[1.6] at 15 px
    float  ReadoutTracking      =   0.025f; // [em] - tracking-wide; dimensionless, never scaled

    // The leading label column -------------------------------------------------------------------------------
    float  LabelAlong           = 160.0f;   // [px] - w-40
    float  RowGapAlong          =  32.0f;   // [px] - gap-8 between a row's parts

    // The selection field ------------------------------------------------------------------------------------
    float  FieldAcross          =  52.0f;   // [px] - h-[52px]
    float  FieldPadAlong        =  24.0f;   // [px] - px-6
    float  ChevronCellAlong     =  60.0f;   // [px] - w-[60px]
    float  ChevronSymbol        =  32.0f;   // [px] - w-8 h-8
    float  MenuLift             =   8.0f;   // [px] - top-[calc(100%+8px)]
    float  MenuRadius           =  24.0f;   // [px] - rounded-[24px]
    float  MenuPad              =   8.0f;   // [px] - p-2
    float  MenuGapAcross        =   4.0f;   // [px] - gap-1
    float  OptionPadAlong       =  24.0f;   // [px] - px-6
    float  OptionPadAcross      =  12.0f;   // [px] - py-3

    // The magnitude row --------------------------------------------------------------------------------------
    float  ReadoutAlong         = 192.0f;   // [px] - w-48
    float  UnitCellAlong        =  72.0f;   // [px] - w-[72px]
    float  SliderAlong          = 224.0f;   // [px] - w-56
    float  SliderAcross         =  44.0f;   // [px] - h-[44px]
    float  ThumbExtent          =  44.0f;   // [px] - the thumb's diameter
    float  MagnitudeCeiling     = 255.0f;   // [-]  - max="255"; a domain bound, never a length

    // The rotation ruler -------------------------------------------------------------------------------------
    float  RulerAcross          = 100.0f;   // [px] - h-[100px]
    float  RulerRadius          =  32.0f;   // [px] - rounded-[32px]
    float  TickSpacing          =  10.0f;   // [px] - TICK_SPACING
    float  TickWeight           =   2.0f;   // [px] - w-[2px]
    float  TickMajorAcross      =  20.0f;   // [px] - h-[20px]
    float  TickMediumAcross     =  16.0f;   // [px] - h-[16px]
    float  TickMinorAcross      =  12.0f;   // [px] - h-[12px]
    float  TickCaptionLift      =  24.0f;   // [px] - top-[24px]
    float  PointerWeight        =   3.0f;   // [px] - w-[3px]
    float  PointerAcross        =  40.0f;   // [px] - h-[40px]
    float  PointerDot           =   8.0f;   // [px] - w-[8px] h-[8px]
    float  PointerDotLift       =  16.0f;   // [px] - top-[16px]
    float  RulerDegreesPerPixel =   0.1f;   // [deg/px] - deltaX / 10; a rate, never a length
    std::uint32_t TickReach     =  60u;     // [-]  - ticks drawn each side of centre

    // The toggle row -----------------------------------------------------------------------------------------
    float  WellPad              =  16.0f;   // [px] - p-4
    float  WellRadius           =  24.0f;   // [px] - rounded-[24px]
    float  WellGapAcross        =   8.0f;   // [px] - gap-2
    float  ToggleRowAcross      =  52.0f;   // [px] - h-[52px]
    float  ToggleRowPadAlong    =   8.0f;   // [px] - px-2
    float  ToggleGapAlong       =  24.0f;   // [px] - gap-6
    float  RingExtent           =  32.0f;   // [px] - w-[32px] h-[32px]
    float  RingWeight           =   2.0f;   // [px] - border-[2px]
    float  RingDotExtent        =  16.0f;   // [px] - w-[16px] h-[16px]

    // The multi-select row -----------------------------------------------------------------------------------
    float  SubsetRowAcross      =  52.0f;   // [px] - h-[52px]
    float  SubsetRowPadAlong    =  24.0f;   // [px] - px-6
    float  SubsetRailAlong      =   4.0f;   // [px] - w-[4px]

    // The magnitude stops ------------------------------------------------------------------------------------
    float  StopStripAcross      =  60.0f;   // [px] - h-[60px]
    float  StopStripPadLeading  =  32.0f;   // [px] - pl-8
    float  StopStripPadTrailing =  16.0f;   // [px] - pr-4
    float  StopQuietExtent      =  16.0f;   // [px] - w-4 h-4
    float  StopTakenExtent      =  52.0f;   // [px] - w-[52px] h-[52px]

    // The tooltips -------------------------------------------------------------------------------------------
    float  TooltipAlong         = 360.0f;   // [px] - w-[360px]
    float  TooltipPad           =  24.0f;   // [px] - p-6
    float  TooltipRadius        =  32.0f;   // [px] - rounded-[32px]
    float  TooltipLift          =  24.0f;   // [px] - bottom-[calc(100%+24px)]
    float  TooltipTitleGap      =   8.0f;   // [px] - mb-2
    float  TooltipArrowExtent   =  32.0f;   // [px] - w-8 h-8, rotated a quarter turn
    float  TooltipArrowRadius   =   6.0f;   // [px] - rounded-[6px]
    float  TooltipArrowAlong    =  48.0f;   // [px] - left-[48px]
    float  TooltipArrowSink     =   8.0f;   // [px] - -bottom-[8px]
    float  TriggerExtent        =  64.0f;   // [px] - w-16 h-16
    float  TriggerRadius        =  24.0f;   // [px] - rounded-[24px]
    float  TriggerLeadAlong     =  32.0f;   // [px] - ml-8
    float  TriggerSymbol        =  28.0f;   // [px] - the 28 px figure inside it
    float  TooltipWellPad       =  48.0f;   // [px] - p-12
    float  TooltipWellRadius    =  32.0f;   // [px] - rounded-[32px]
    float  TooltipWellFloor     = 340.0f;   // [px] - min-h-[340px]
    float  TooltipWellGap       = 128.0f;   // [px] - gap-32

    // What the record was resolved against ---------------------------------------------------------------------
    ComfortDensity  Density        = ComfortDensity::Regular;   // [-] - classified from the drawable extent
    float           AppliedFactor  = AuthoredReduction;         // [-] - the whole product, applied once
    float           ArtistFactor   = 1.0f;                      // [-] - the artist's own preference
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE WORKSPACE TABS
//------------------------------------------------------------------------------------------------------------------------

// 📐 `References/DockWorkspace.html` states its tab strip in raw hexadecimal, like the control sheet and
//    unlike the neutral ladder. The seven below are its own figures, named once here so no recording site
//    and no style seat transcribes a literal.
inline constexpr std::uint32_t WorkspaceStrip        = 0x18181Cu;   // [-] - --strip, and --panel-footer-bg
inline constexpr std::uint32_t WorkspaceTabQuiet     = 0x26262Cu;   // [-] - --tab-inactive
inline constexpr std::uint32_t WorkspaceTabRoused    = 0x32323Au;   // [-] - --tab-hover
inline constexpr std::uint32_t WorkspaceTabTaken     = 0x000000u;   // [-] - --tab-active
inline constexpr std::uint32_t WorkspaceTabInkQuiet  = 0x9BA1ADu;   // [-] - --tab-inactive-text
inline constexpr std::uint32_t WorkspaceTabInkTaken  = 0xFFFFFFu;   // [-] - --tab-active-text
inline constexpr std::uint32_t WorkspaceFooterEdge   = 0x222228u;   // [-] - --panel-footer-border, --border

/// 🧩 Every extent and ink the workspace tab strip is drawn with, stated at the sheet's authored density.
/// note  🔴 These are read by whatever seats the interface library's style, and by the footer strip Slate
///       records itself. The tab geometry is the vendor's — `Patches/` states how — but the figures it is
///       driven by are declared here so the sheet can be compared against them line by line.
/// note  ⚠️ TabPadAlong and TabOverlap are coupled. The sheet's 38 px horizontal padding exists to clear the
///       slant plus the overlap; raising the overlap without raising the padding runs adjacent runs together.
/// tag   contract, nonallocating, nonthrowing
struct WorkspaceMetric
{
    float  TabAcross        =  24.0f;   // [px] - .tab height
    float  TabSlant         =  14.0f;   // [px] - slant = min(14, w * 0.16)
    float  TabOverlap       =  24.0f;   // [px] - .tab margin-right: -24px
    float  TabPadAlong      =  38.0f;   // [px] - .tab padding: 0 38px
    float  TabAlongFloor    = 170.0f;   // [px] - .tab min-width
    float  TabAlongCeiling  = 320.0f;   // [px] - .tab max-width
    float  TabRadius        =   0.0f;   // [px] - roundCorners is off; 5.0f turns it on
    float  TabEdgeWeight    =   0.0f;   // [px] - no border requested; the sheet's stroke is 1.0f
    float  StripAcross      =  28.0f;   // [px] - .tabstrip height
    float  StripPadTop      =   4.0f;   // [px] - 28 px strip carrying a 24 px tab at flex-end
    float  FooterAcross     =  22.0f;   // [px] - .panelfooter height
    float  FooterEdgeWeight =   1.0f;   // [px] - .panelfooter border-top
    float  TabText          =  10.0f;   // [px] - .tab .lbl font-size
};

/// 🧩 The inks the workspace tab strip and its footer are drawn with.
/// tag   contract, nonallocating, nonthrowing
struct WorkspaceInk
{
    InkOrdinate  StripGround   = Covering(WorkspaceStrip);         // [-] - behind the tabs
    InkOrdinate  TabQuiet      = Covering(WorkspaceTabQuiet);      // [-] - an unselected tab
    InkOrdinate  TabRoused     = Covering(WorkspaceTabRoused);     // [-] - hovered
    InkOrdinate  TabTaken      = Covering(WorkspaceTabTaken);      // [-] - selected
    InkOrdinate  TabInkQuiet   = Covering(WorkspaceTabInkQuiet);   // [-] - an unselected run
    InkOrdinate  TabInkTaken   = Covering(WorkspaceTabInkTaken);   // [-] - the selected run
    InkOrdinate  TabEdge       = Partial(AbsoluteBlack, 0.45);     // [-] - stroke rgba(0,0,0,.45)
    InkOrdinate  TabEdgeRoused = Partial(0xFFFFFFu, 0.08);         // [-] - stroke rgba(255,255,255,.08)
    InkOrdinate  FooterGround  = Covering(WorkspaceStrip);         // [-] - --panel-footer-bg
    InkOrdinate  FooterEdge    = Covering(WorkspaceFooterEdge);    // [-] - --panel-footer-border
    InkOrdinate  WorkspaceVoid = Covering(AbsoluteBlack);          // [-] - the OLED ground behind everything
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE MOTION SCALE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every duration and every spring coefficient the source declares.
/// note  📐 ζ = 35 / (2√350) ≈ 0.9354, so every drawer transition overshoots slightly before settling. A
///       linear ease at the same duration reads as a different product, which is why the coefficients travel
///       rather than a duration.
/// tag   contract, nonallocating, nonthrowing
struct MotionScale
{
    double  DrawerStiffness      = 350.0;   // [-]  - spring, mass one
    double  DrawerDamping        =  35.0;   // [-]
    double  DragElasticity       =   0.05;  // [-]  - travel admitted beyond a constraint
    double  DiscloseDuration     = 150.0;   // [ms] - accordion height, colour fade
    double  RouseDuration        = 200.0;   // [ms] - whileHover
    double  CardArrivalDuration  = 400.0;   // [ms] - the entry motion
    double  CardArrivalStagger   =  30.0;   // [ms] - multiplied by (ordinal mod 10)
    double  CardArrivalLift      =  10.0;   // [px] - y: 10 → 0
    double  CardArrivalScale     =   0.95;  // [-]  - scale: 0.95 → 1
    double  CardRouseScale       =   1.05;  // [-]  - lattice hover
    double  CardRouseTravel      =   4.0;   // [px] - column hover, x: 4
    double  ArrivalMargin        =  50.0;   // [px] - viewport margin the entry motion fires at

    // 📐 🔴 The arbitration's own figures, transcribed literally. Three rates and two fractions, and the
    //    three rates are **not** one rate scaled: the source states 300 for the north drawer and for the
    //    south drawer's half pose, 500 for the outer gate of closed and full, and 1000 for their inner
    //    gate. A single rate with multipliers agrees with the source at exactly one of the five sites.
    double  SnapRateSoft         = 300.0;   // [px/s] - north; south half, both directions
    double  SnapRateFirm         = 500.0;   // [px/s] - south closed and full, outer gate
    double  SnapRateHard         = 1000.0;  // [px/s] - south closed and full, inner gate
    double  SnapFractionNear     =   0.25;  // [-]    - h/4, and h*.25
    double  SnapFractionFar      =   0.75;  // [-]    - h*.75
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE RESOLVED RECORD
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The one record every panel reads. Resolved at bring-up and again only when the display scale changes.
/// tag   contract, nonallocating, nonthrowing
struct AppearanceSpecification
{
    SurfaceInk     Ink            = {};
    MetricScale    Measure        = {};
    MotionScale    Motion         = {};
    ControlInk       Control          = {};
    ControlMetric    ControlMeasure   = {};
    WorkspaceInk     Workspace        = {};
    WorkspaceMetric  WorkspaceMeasure = {};
};

/// 🧩 The bounds the artist's own preference is admitted within.
/// note  🔴 Clamped rather than refused. A preference read back from a corrupted or hand-edited settings file
///       must not be able to resolve a zero-extent interface the artist can no longer reach a control in to
///       correct it — the one defect from which there is no recovery inside the application.
inline constexpr double ArtistScaleFloor   = 0.75;   // [-] - the tightest arrangement admitted
inline constexpr double ArtistScaleCeiling = 2.00;   // [-] - the most generous

/// 🧩 Classifies how generous the arrangement should be from the extent the display offers.
/// in    Measure       [-]  the breakpoints are read from here, already at the display scale
/// in    ExtentAlong   [px] the drawable extent; at or below zero classifies Regular
/// out   Classified    [-]  Compact below BreakpointLarge, then Regular, Spacious and Expansive
/// note  The four thresholds are `MetricScale`'s own breakpoints, doubled for the upper two, so a density
///       boundary and a lattice boundary never fall a few pixels apart and re-solve twice on one drag.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
ComfortDensity ClassifyDensity(const MetricScale& Measure, float ExtentAlong);

/// 🧩 Resolves the appearance against the display, the artist's preference, and the extent on offer.
/// in    DisplayScale  [-]  what the window system reports; values at or below zero resolve at one
/// in    ArtistScale   [-]  the artist's own preference; clamped into [0.75 … 2.00]
/// in    ExtentAlong   [px] the drawable extent the density is classified from; zero classifies Regular
/// out   Appearance    [-]  every extent already multiplied; nothing downstream multiplies again
/// note  🔴 The control measure is multiplied by AuthoredReduction × DensityFactor × DisplayScale × ArtistScale,
///       and the neutral measure by DisplayScale alone. The two ladders resolve differently because only one
///       of them was authored at 2×; multiplying the neutral measure by the reduction would halve the drawer
///       arrangement that four existing panels are already drawn against.
/// note  ⚠️ Every point size is floored at TextLegibilityFloor **after** the product, so a 0.75 preference on
///       a compact display cannot resolve a six-pixel run.
/// post  Measure.DisplayScale, ControlMeasure.AppliedFactor and ControlMeasure.Density record what was applied
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
AppearanceSpecification Resolve(double DisplayScale, double ArtistScale = 1.0, float ExtentAlong = 0.0f);

/// 🧩 How many lattice columns the content extent admits, from the source's four breakpoints.
/// in    ContentAlong  [px] the extent the lattice is arranged inside
/// out   Columns       [-]  two below 640 px, then three, four, and five at and above 1024 px
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
std::uint32_t LatticeColumns(const MetricScale& Measure, float ContentAlong);

}   // namespace Slate
