//============================================================================================================================================
//                                                           RECORDINGSURFACE.H
//============================================================================================================================================
// 🧩 Primitives in, recorded commands out — the drawing half of the interface seam, with no ImGui spelling anywhere.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/SymbolSpecification/Api/SymbolSpecification.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE PLANE EXTENT
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One axis-aligned extent in display pixels, stated as its two corners.
/// note  The ordinate increases **downward**, as the display does. Nothing in the interface uses the
///       upward convention `ToleranceContract.h` declares for clip space; the two never meet.
/// tag   contract, nonallocating, nonthrowing
struct PlaneExtent
{
    float  LeastAlong  = 0.0f;   // [px] - leading edge
    float  LeastAcross = 0.0f;   // [px] - upper edge
    float  MostAlong   = 0.0f;   // [px] - trailing edge
    float  MostAcross  = 0.0f;   // [px] - lower edge

    constexpr float SpanAlong() const  { return MostAlong  - LeastAlong;  }
    constexpr float SpanAcross() const { return MostAcross - LeastAcross; }

    constexpr bool Encloses(float Along, float Across) const
    {
        return Along >= LeastAlong && Along < MostAlong && Across >= LeastAcross && Across < MostAcross;
    }
};

/// 🧩 Constructs an extent from an origin and a span.
/// cost  ✔️
constexpr PlaneExtent Spanning(float Along, float Across, float ExtentAlong, float ExtentAcross)
{
    return PlaneExtent{ Along, Across, Along + ExtentAlong, Across + ExtentAcross };
}

/// 🧩 Which axis a scrim's ink varies along.
/// note  The ordinate axis is declared first and carries the ordinal zero, so the enumeration's default and
///       the scrim's default are the same statement rather than two that must be kept agreeing.
/// tag   contract
enum class ScrimAxis : std::uint32_t
{
    Across    = 0u,   // [-] - varies from LeastAcross to MostAcross; the card's caption scrim
    Along     = 1u,   // [-] - varies from LeastAlong to MostAlong; the ruler's leading and trailing fade
    AxisCount = 2u    // [-] - the closed count, never an axis
};

/// 🧩 Which corners of a rounded primitive are rounded. Absent bits are square.
/// note  The source's card is rounded on four; its drawer body on none; its tongue on none but is clipped
///       instead. A single mask covers all three rather than three primitives that drift apart.
inline constexpr std::uint32_t CornerNone         = 0u;
inline constexpr std::uint32_t CornerLeadingUpper = 1u << 0;
inline constexpr std::uint32_t CornerTrailingUpper= 1u << 1;
inline constexpr std::uint32_t CornerTrailingLower= 1u << 2;
inline constexpr std::uint32_t CornerLeadingLower = 1u << 3;
inline constexpr std::uint32_t CornerAll          = 0x0Fu;

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE ARRIVED CONDITION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What the pointer did between the previous tick and this one.
/// note  🔴 Read from the interface library's accumulated window condition and **not** from `04`'s
///        `InputExchange`. The two observe the same device through two surfaces that never merge: the stroke
///        path needs arrival stamps at device rate, the interface needs one resolved position per tick, and
///        merging them would give the canvas the interface's rate.
/// tag   contract, nonallocating, nonthrowing
struct PointerCondition
{
    float   PositionAlong   = 0.0f;    // [px] - in the display's drawable extent
    float   PositionAcross  = 0.0f;    // [px]
    float   TravelAlong     = 0.0f;    // [px] - since the previous tick
    float   TravelAcross    = 0.0f;    // [px]
    float   WheelAcross     = 0.0f;    // [-]  - notches; positive is away from the artist
    bool    ContactHeld     = false;   // [-]  - the primary contact is down now
    bool    ContactArrived  = false;   // [-]  - it went down during this tick
    bool    ContactReleased = false;   // [-]  - it came up during this tick
    double  HeldDuration    = 0.0;     // [ms] - how long it has been down; zero while it is not
};

/// 🧩 What the display reported for this tick.
/// tag   contract, nonallocating, nonthrowing
struct DisplayCondition
{
    float   ExtentAlong  = 0.0f;   // [px] - the drawable extent
    float   ExtentAcross = 0.0f;   // [px]
    double  Elapsed      = 0.0;    // [ms] - since the previous tick; what every interpolant is advanced by
    double  DisplayScale = 1.0;    // [-]  - what AppearanceSpecification was resolved against
};

//------------------------------------------------------------------------------------------------------------------------
//                                                          THE SEAM
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Records the interface's own primitives into the open interface tick.
/// note  🔴 The second and last translation unit in the engine that names ImGui, and it names it only in its
///        source file. `00` §2.2 makes a **host** including `imgui.h` a defect; it does not forbid a second
///        unit inside `SlateUI`, which already owns the one copy. The alternative was recording panels through
///        built-in widgets, and no built-in widget produces a clipped tongue, a scrim or tracked small capitals
///        — the three things the source is mostly made of.
/// note  ⚠️ Every method is valid only between `InterfaceExchange::Advance` and `Seal`. Recording outside that
///        window writes into content nothing will assemble.
/// tag   owning
class RecordingSurface
{
public:

    RecordingSurface()                                   = default;
    RecordingSurface(const RecordingSurface&)            = delete;
    RecordingSurface& operator=(const RecordingSurface&) = delete;
    ~RecordingSurface()                                  = default;

    /// 🧩 Binds this surface to the open interface tick and samples the arrived condition.
    /// out   Deliver  [-]  refuses with CapabilityAbsent when no interface context is current
    /// post  Pointer and Display report this tick; every recording method is valid until Seal
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Adopt();

    /// 🧩 What the pointer did this tick.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const PointerCondition& Pointer() const;

    /// 🧩 What the display reported this tick.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const DisplayCondition& Display() const;

    //--------------------------------------------------------------------------------------------------------
    //                                             GROUNDS AND EDGES
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 Fills an extent, optionally rounding the named corners.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Ground(const PlaneExtent& Extent, InkOrdinate Ink, float Radius = 0.0f, std::uint32_t Corners = CornerAll);

    /// 🧩 Strokes an extent's edge inward from its stated corners.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Edge(const PlaneExtent& Extent, InkOrdinate Ink, float Weight = 1.0f,
              float Radius = 0.0f, std::uint32_t Corners = CornerAll);

    /// 🧩 Fills an extent with a linearly varying ink — the card's caption scrim, and the ruler's fade.
    /// in    UpperInk  [-]  at LeastAcross, or at LeastAlong when the axis is Along
    /// in    LowerInk  [-]  at MostAcross, or at MostAlong when the axis is Along
    /// in    Axis      [-]  which axis the ink varies along; the default is what every existing caller means
    /// note  📐 A four-stop ramp is two of these. `Controls.html` masks its ruler with
    ///       `linear-gradient(to right, transparent, black 20%, black 80%, transparent)`, which records as one
    ///       Along scrim over the leading fifth and a second, reversed, over the trailing fifth. Declaring a
    ///       four-stop primitive to serve one call site would put the stop fractions inside this component,
    ///       where the sheet that states them could never be compared against them.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Scrim(const PlaneExtent& Extent, InkOrdinate UpperInk, InkOrdinate LowerInk,
               ScrimAxis Axis = ScrimAxis::Across);

    /// 🧩 Fills a disc — every medallion and the meta separator.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Medallion(float CentreAlong, float CentreAcross, float Radius, InkOrdinate Ink);

    /// 🧩 Fills a convex outline of up to eight corners — the drawer tongue's clip polygon.
    /// in    Corners      [px] alternating along and across ordinates, in winding order
    /// in    CornerCount  [-]  three to eight; anything else records nothing
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Tongue(const float* Corners, std::uint32_t CornerCount, InkOrdinate Ink);

    //--------------------------------------------------------------------------------------------------------
    //                                                 SYMBOLS
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 Strokes one declared figure inside a square extent.
    /// in    Subject       [-]  an unresolved subject strokes the placeholder mark at the same extent
    /// in    SquareExtent  [px] the figure's 24-unit square is scaled onto this
    /// cost  🚩
    /// tag   api, nonthrowing
    void Stroke(SymbolSubject Subject, const PlaneExtent& SquareExtent, InkOrdinate Ink);

    //--------------------------------------------------------------------------------------------------------
    //                                                  TEXT
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 Records a run of text at a declared size and tracking.
    /// in    Tracking  [em] added to every advance; zero records the run in one command
    /// in    Emphatic  [-]  approximates a heavier weight by recording the run twice, offset by a third pixel
    /// note  🚧 The default interface typeface carries one weight. The source declares 500, 600 and 700, so
    ///        `Emphatic` stands in for all three until a typeface with real weights is intaken.
    /// cost  🚩
    /// tag   api, nonthrowing
    void TextRun(float Along, float Across, InkOrdinate Ink, const char* Text,
                 float PointSize, float Tracking = 0.0f, bool Emphatic = false);

    /// 🧩 Records a run in capitals, for the two small-capital captions the source declares.
    /// note  ⚠️ ASCII only. A capital of a codepoint outside ASCII is a locale question, not a formatting one.
    /// cost  🚩
    /// tag   api, nonthrowing
    void TextRunCapitalised(float Along, float Across, InkOrdinate Ink, const char* Text,
                            float PointSize, float Tracking = 0.0f, bool Emphatic = false);

    /// 🧩 Records a run truncated to a stated extent, with a trailing ellipsis when it did not fit.
    /// note  The ellipsis is three full stops rather than U+2026, which the default typeface does not carry.
    /// cost  🚩
    /// tag   api, nonthrowing
    void TextRunTruncated(float Along, float Across, float CeilingAlong, InkOrdinate Ink,
                          const char* Text, float PointSize, bool Emphatic = false);

    /// 🧩 The extent a run would occupy, without recording it.
    /// out   ExtentAlong  [px] zero for empty text
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    float MeasureRun(const char* Text, float PointSize, float Tracking = 0.0f) const;

    /// 🧩 The baseline-to-baseline extent at one point size.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    float RunAcross(float PointSize) const;

    //--------------------------------------------------------------------------------------------------------
    //                                                CLIPPING
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 Intersects the recording extent with the supplied one, until the matching Release.
    /// note  ⚠️ Every Confine must be matched. Sixteen may nest; a seventeenth records nothing and is ignored.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Confine(const PlaneExtent& Extent);

    /// 🧩 Restores the recording extent the matching Confine replaced.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Release();

    /// 🧩 Whether an extent is wholly outside the standing recording extent — what a scroll extent culls with.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Excluded(const PlaneExtent& Extent) const;

    /// 🧩 Returns the surface to its constructed condition, releasing every unmatched Confine.
    /// note  🔴 Called instead of placement-new over a live object. Re-constructing over storage without
    ///       first destroying what sits in it is a defect the compiler will never report.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

private:

    void*             CommandSlot   = nullptr;   // [-] - opaque; the ImGui spelling stays in the source file
    PointerCondition  ArrivedPointer = {};       // [-] - sampled once, at Adopt
    DisplayCondition  ArrivedDisplay = {};       // [-] - sampled once, at Adopt
    std::uint32_t     ConfineDepth   = 0u;       // [-] - how many Confines stand unmatched
};

}   // namespace Slate
