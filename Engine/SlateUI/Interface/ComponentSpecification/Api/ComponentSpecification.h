//============================================================================================================================================
//                                                          COMPONENTSPECIFICATION.H
//============================================================================================================================================
// 🧩 The eight declared controls — one contact arbitrated across them, one appearance read, and not one datum owned.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/PrecisionContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/SymbolSpecification/Api/SymbolSpecification.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT A CARD ARRANGES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One panel card — the rounded ground the sheet groups its rows inside.
/// note  The card is arranged from its row count rather than measured from its content, because the sheet
///       states a fixed padding and a fixed inter-row gap and every row it holds is one of eight known
///       extents. A card that measured its content would disagree with the sheet the moment a run wrapped.
/// tag   contract, nonallocating, nonthrowing
struct CardArrangement
{
    PlaneExtent  Enclosure = {};     // [px] - the card's own extent, ground and edge
    PlaneExtent  Interior  = {};     // [px] - inside the padding; the first row begins here
    float        RowGap    = 0.0f;   // [px] - what a caller advances by between rows
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    WHAT EACH CONTROL TAKES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What one selection field presents — its label, its options, and how many there are.
/// note  🔴 The options are borrowed, never copied. `14` §1 forbids a panel storing what it presents, and an
///       array of captions copied into the panel is exactly that defect at its smallest.
/// tag   contract, nonallocating, nonthrowing
struct SelectionDeclaration
{
    const char*         Caption     = "";        // [-] - the leading label
    const char* const*  Options     = nullptr;   // [-] - borrowed; outlives the tick
    std::uint32_t       OptionCount = 0u;        // [-] - zero records the field and no menu
};

/// 🧩 What one magnitude row presents — its label, its unit glyph, and the domain it spans.
/// note  📐 The domain is stated rather than assumed. The sheet declares 0 … 255 for all three of its rows,
///        but a percentage that ran to 255 would be a defect the sheet cannot report and a caller can.
/// tag   contract, nonallocating, nonthrowing
struct MagnitudeDeclaration
{
    const char*  Caption      = "";      // [-] - the leading label
    const char*  UnitGlyph    = "";      // [-] - the trailing cell's run — the degree sign, percent, or px
    double       LeastOrdinal = 0.0;     // [-] - the domain's floor
    double       MostOrdinal  = 255.0;   // [-] - the domain's ceiling; max="255"
};

/// 🧩 What the rotation ruler presents — its label and the unit its captions carry.
/// tag   contract, nonallocating, nonthrowing
struct RulerDeclaration
{
    const char*  Caption   = "";   // [-] - the leading label
    const char*  UnitGlyph = "";   // [-] - the readout's trailing cell
};

/// 🧩 What one toggle row presents.
/// tag   contract, nonallocating, nonthrowing
struct ToggleDeclaration
{
    const char*  Caption = "";   // [-] - the run right of the ring
};

/// 🧩 What one multi-select row presents.
/// tag   contract, nonallocating, nonthrowing
struct SubsetDeclaration
{
    const char*  Caption = "";   // [-] - the run inside the row
};

/// 🧩 What the magnitude stops present — the four captions, of which the taken one is drawn.
/// note  ⚠️ Exactly `StopCeiling` captions are read. The sheet declares four; a caller declaring more is
///        refused rather than silently truncated, because a fifth stop the artist can see and cannot reach
///        is worse than a refusal at bring-up.
/// tag   contract, nonallocating, nonthrowing
struct StopDeclaration
{
    const char*         Caption   = "";        // [-] - the leading label
    const char* const*  Stops     = nullptr;   // [-] - borrowed; the letter each stop carries
    std::uint32_t       StopCount = 0u;        // [-] - two to StopCeiling
};

/// 🧩 Which of the sheet's two tooltip appearances one trigger carries.
/// tag   contract
enum class TooltipAppearance : std::uint32_t
{
    Light           = 0u,   // [-] - the white card and the white trigger
    Dark            = 1u,   // [-] - the near-black card and the near-black trigger
    AppearanceCount = 2u    // [-] - the closed count, never an appearance
};

/// 🧩 What one tooltip trigger presents — its figure, and the card that discloses above it.
/// note  The body is borrowed and wrapped at record time against the card's stated extent. Nothing is
///       measured into storage, so a caller may change the run between two ticks.
/// tag   contract, nonallocating, nonthrowing
struct TooltipDeclaration
{
    const char*        Title      = "";                            // [-] - the card's heading
    const char*        Body       = "";                            // [-] - wrapped inside the card
    SymbolSubject      Figure     = SymbolSubject::BulbFilament;   // [-] - the trigger's own figure
    TooltipAppearance  Appearance = TooltipAppearance::Light;      // [-]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                          THE PANEL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Records the eight controls `References/Controls.html` declares, and arbitrates one contact across them.
/// note  🔴 Stores **no** artist-visible datum. Every value arrives by reference and is written back through
///        that same reference in the same call, so `14` §1's "a panel presents state owned elsewhere and
///        stores none of it" is a property of the signatures rather than a discipline. What is stored —
///        which control is seized, which menu stands open, what is fading — lives in `InteractionIndex`,
///        which is `14` §4.1's sanctioned home for it.
/// note  🔴 Two phases, never interleaved. `Advance` arbitrates and records nothing; the eight recording
///        methods draw and mutate no interaction. The separation is what lets every popup be recorded in a
///        second sweep after every row, which is how the sheet's z-20 and z-50 stacking is reproduced
///        without a layering mechanism nobody asked for.
/// note  ⚠️ `RecordDeferred` must be called once per tick, after the last control and before the seal.
///        A menu left undeferred is a menu recorded beneath the row below it.
/// tag   owning
class ComponentSpecification
{
public:

    static constexpr std::uint32_t StopCeiling     = 8u;    // [-] - stops one row may carry; the sheet declares four
    static constexpr std::uint32_t DeferredCeiling = 16u;   // [-] - popups and tooltips deferred within one tick
    static constexpr std::uint32_t WrapCeiling     = 8u;    // [-] - lines one tooltip body may wrap to

    ComponentSpecification()                               = default;
    ComponentSpecification(const ComponentSpecification&)            = delete;
    ComponentSpecification& operator=(const ComponentSpecification&) = delete;
    ~ComponentSpecification()                              = default;

    /// 🧩 Borrows the ledger, the surface and the appearance every control reads.
    /// in    Ledger      [-]  the interaction ledger; borrowed and outlives this component
    /// in    Surface     [-]  the recording surface; borrowed and outlives this component
    /// in    Appearance  [-]  already resolved against the display scale; borrowed and outlives this
    /// out   Deliver     [-]  refuses with ContentUnsupported when a construction already stands
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Construct(InteractionIndex&              Ledger,
                            RecordingSurface&              Surface,
                            const AppearanceSpecification& Appearance);

    /// 🧩 Advances one tick of arbitration — samples the contact and clears the deferred sweep.
    /// in    Arrived  [-]   what `RecordingSurface::Pointer` sampled this tick
    /// in    Elapsed  [ms]  what the same tick's display condition measured
    /// note  🔴 Advances the ledger too. A caller that advances both is advancing the ledger twice, which
    ///        retires a release before the control that seized it has run.
    /// post  the deferred sweep is empty; every recording method is valid until RecordDeferred
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Advance(const PointerCondition& Arrived, double Elapsed);

    /// 🧩 Samples a pointer after the shared interaction index was advanced by the owning panel.
    /// note  🔴 This does not advance the index; two advances erase the release before controls observe it.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Sample(const PointerCondition& Arrived);

    /// 🧩 Arranges one card around a stated number of rows of stated extents.
    /// in    Along        [px] the card's leading edge
    /// in    Across       [px] the card's upper edge
    /// in    ExtentAlong  [px] the column's extent; the sheet states 800 before reduction
    /// in    RowExtents   [px] each row's own extent across; borrowed for the duration of the call
    /// in    RowCount     [-]  how many rows; zero arranges an empty card of padding alone
    /// out   Arranged     [-]  the enclosure to record and the interior the first row begins at
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    CardArrangement ArrangeCard(float Along, float Across, float ExtentAlong,
                                const float* RowExtents, std::uint32_t RowCount) const;

    /// 🧩 Records one card's ground and edge.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void RecordCard(const CardArrangement& Arranged);

    //--------------------------------------------------------------------------------------------------------
    //                                            THE EIGHT CONTROLS
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 The selection field — a black field, a chevron cell, and a menu that discloses beneath it.
    /// in    Claimed       [-]  the identity this field was enrolled under
    /// in    Row           [px] the extent the whole row occupies
    /// in    Declared      [-]  what it presents; borrowed
    /// in    TakenOrdinal  [-]  which option stands taken; written when the artist takes another
    /// out   Verdict       [-]  OrdinateAltered when TakenOrdinal was written this tick
    /// note  The menu is not recorded here. It is deferred, so that it draws above every row below it.
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict SelectionField(ControlIdentity Claimed, const PlaneExtent& Row,
                                  const SelectionDeclaration& Declared, std::uint32_t& TakenOrdinal);

    /// 🧩 One magnitude row — a numeric readout, a unit cell, and a slider spanning the declared domain.
    /// in    Ordinate         [-]  the presented magnitude; written while the thumb or track is held
    /// in    ReadoutTrailing  [-]  places the slider first and the number/unit pill at the trailing edge
    /// out   Verdict          [-]  OrdinateAltered on every tick the drag moved it
    /// note  📐 The drag reads the pointer's absolute position against the track, not an accumulated delta.
    ///        An accumulated delta drifts by a pixel for every tick the pointer left the track's extent.
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict MagnitudeRow(ControlIdentity Claimed, const PlaneExtent& Row,
                                const MagnitudeDeclaration& Declared, double& Ordinate,
                                bool ReadoutTrailing = false);

    /// 🧩 The rotation ruler — a readout and a draggable tick strip that fades at both ends.
    /// in    Degrees  [deg] the presented rotation; written while the strip is dragged
    /// note  📐 The sheet's law is `Value = ValueAtArrival − ΔAlong / 10`, and the strip is translated by
    ///        `−Value × TickSpacing`. Dragging leftward therefore raises the reading, which is what a
    ///        physical dial does and is the opposite of what an accumulated pointer delta would give.
    /// cost  🔴
    /// tag   api, nonthrowing
    ControlVerdict RotationRuler(ControlIdentity Claimed, const PlaneExtent& Row,
                                 const RulerDeclaration& Declared, double& Degrees);

    /// 🧩 One toggle row — a ring, a dot that scales in, and a label.
    /// in    Taken  [-]  written on the tick the row resolves a tap
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict ToggleRow(ControlIdentity Claimed, const PlaneExtent& Row,
                             const ToggleDeclaration& Declared, bool& Taken);

    /// 🧩 One multi-select row — a leading rail, a ground, and a label.
    /// in    Enrolled  [-]  written on the tick the row resolves a tap
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict SubsetRow(ControlIdentity Claimed, const PlaneExtent& Row,
                             const SubsetDeclaration& Declared, bool& Enrolled);

    /// 🧩 The magnitude stops — small discs, of which the taken one grows and carries its letter.
    /// in    TakenOrdinal  [-]  which stop stands taken; written when another is tapped
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict MagnitudeStops(ControlIdentity Claimed, const PlaneExtent& Row,
                                  const StopDeclaration& Declared, std::uint32_t& TakenOrdinal);

    /// 🧩 One tooltip trigger — a rounded button whose card discloses above it while the pointer rests on it.
    /// note  The card is deferred, so it draws above every control recorded after this one.
    /// cost  🚩
    /// tag   api, nonthrowing
    ControlVerdict TooltipTrigger(ControlIdentity Claimed, const PlaneExtent& Trigger,
                                  const TooltipDeclaration& Declared);

    //--------------------------------------------------------------------------------------------------------
    //                                             THE DEFERRED SWEEP
    //--------------------------------------------------------------------------------------------------------

    /// 🧩 Records every menu and tooltip deferred this tick, in the order they were declared.
    /// note  🔴 Once per tick, after the last control. The sheet stacks its menu at z-20 and its tooltips at
    ///        z-50 over content that is written after them in document order; recording order is how a
    ///        command list expresses that, and this is the call that supplies it.
    /// post  the deferred sweep is empty
    /// cost  🚩
    /// tag   api, nonthrowing
    void RecordDeferred();

    /// 🧩 Whether any control holds the contact — what a host tests before treating it as a canvas stroke.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool ContactTaken() const;

    /// 🧩 The dearest mark any control raised since the last Advance.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    RedrawMark StandingMark() const;

    /// 🧩 Returns the panel to its constructed condition, forgetting every borrowed reference.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

private:

    /// 🧩 What one deferred popup will record, retained only until RecordDeferred runs.
    /// note  Every member is either a borrowed pointer into the caller's own storage or a resolved extent.
    ///       Nothing here is a copy of a datum the artist edits.
    struct DeferredRecording
    {
        ControlIdentity     Claimed     = {};                            // [-] - whose popup this is
        PlaneExtent         Anchor      = {};                            // [px] - the extent it hangs from
        const char* const*  Options     = nullptr;                       // [-] - borrowed, for a menu
        std::uint32_t       OptionCount = 0u;                            // [-]
        std::uint32_t       TakenOption = 0u;                            // [-] - which option stands taken
        const char*         Title       = nullptr;                       // [-] - borrowed, for a tooltip
        const char*         Body        = nullptr;                       // [-] - borrowed, for a tooltip
        TooltipAppearance   Appearance  = TooltipAppearance::Light;      // [-]
        bool                Menu        = false;                         // [-] - a menu, or else a tooltip
    };

    void RecordMenu(const DeferredRecording& Deferred);
    void RecordTooltip(const DeferredRecording& Deferred);
    void FoldMark(RedrawMark Arriving);

    /// 🧩 The extent an open menu occupies beneath its field.
    /// note  Derived from the field rather than retained, so the menu the pointer is tested against this tick
    ///       is the one that was recorded last tick by construction, not by two computations agreeing.
    PlaneExtent MenuEnclosure(const PlaneExtent& Field, std::uint32_t OptionCount) const;

    /// 🧩 Which option the pointer stands over, or OptionCount when it stands over none.
    std::uint32_t OptionUnder(const PlaneExtent& Field, std::uint32_t OptionCount) const;

    InteractionIndex*               Ledger                          = nullptr;   // [-] - borrowed
    RecordingSurface*               Surface                         = nullptr;   // [-] - borrowed
    const AppearanceSpecification*  Appearance                      = nullptr;   // [-] - borrowed
    PointerCondition                Arrived                         = {};        // [-] - this tick's pointer
    DeferredRecording               Deferred[DeferredCeiling]       = {};        // [-] - never allocated
    std::uint32_t                   DeferredCount                   = 0u;        // [-]
    RedrawMark                      Standing                        = RedrawMark::Quiet;   // [-]
    bool                            ContactHeldByPanel              = false;     // [-]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE TWO PROJECTIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Projects a magnitude onto the fraction of its domain it occupies.
/// in    Ordinate  [-]  the magnitude; outside the domain it clamps rather than extrapolating
/// in    Least     [-]  the domain's floor
/// in    Most      [-]  the domain's ceiling; a domain of zero extent projects to zero
/// out   Fraction  [-]  zero at the floor, one at the ceiling
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
double MagnitudeFraction(double Ordinate, double Least, double Most);
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded);

/// 🧩 Projects a rotation drag onto the degrees it turned through.
/// in    Departed      [deg]   the reading when the contact arrived
/// in    TravelAlong   [px]    how far the contact has travelled since
/// in    DegreesPerPixel [deg/px] what the sheet states as `deltaX / 10`
/// out   Degrees       [deg]   the new reading
/// note  📐 Subtractive, per the sheet: `startVal - (deltaX / 10)`.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
double RotationDegrees(double Departed, double TravelAlong, double DegreesPerPixel);
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded);

}   // namespace Slate
