//============================================================================================================================================
//                                                          PANELSTRUCTURE.H
//============================================================================================================================================
// 🧩 A bounded binary partition of one workspace into viewport, UV, outliner, property and vacant panels.

#pragma once

#include "Contract/DeliveryContract.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   PARTITION DECLARATIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What one leaf panel presents.
/// tag   contract
enum class PanelSubject : std::uint32_t
{
    Viewport     = 0u,   // [-] - three-dimensional scene presentation
    Uv           = 1u,   // [-] - selected geometry's UV presentation
    Outliner     = 2u,   // [-] - editor scene outline
    Properties   = 3u,   // [-] - selected record's properties
    Vacant       = 4u,   // [-] - panel chooser
    SubjectCount = 5u    // [-] - closed count, never a subject
};

/// 🧩 Which display axis a division partitions.
/// tag   contract
enum class PanelDivisionAxis : std::uint32_t
{
    Along     = 0u,   // [-] - left and right leaves
    Across    = 1u,   // [-] - upper and lower leaves
    AxisCount = 2u    // [-] - closed count, never an axis
};

/// 🧩 Which side of a division receives a newly created vacant panel.
/// tag   contract
enum class PanelDivisionSide : std::uint32_t
{
    Least     = 0u,   // [-] - left or upper side
    Most      = 1u,   // [-] - right or lower side
    SideCount = 2u    // [-] - closed count, never a side
};

/// 🧩 One occupied slot in the binary workspace partition.
/// tag   contract, nonallocating, nonthrowing
struct PanelRecord
{
    bool               Occupied       = false;                      // [-] - this slot participates in the partition
    bool               Divided        = false;                      // [-] - false is a leaf carrying Subject
    PanelSubject       Subject        = PanelSubject::Vacant;       // [-] - what a leaf presents
    PanelDivisionAxis  Axis           = PanelDivisionAxis::Along;   // [-] - how a divided slot separates descendants
    float              LeastFraction  = 0.5f;                       // [-] - fraction assigned to LeastOrdinal
    std::uint32_t      LeastOrdinal   = 0u;                         // [-] - first side of a divided slot
    std::uint32_t      MostOrdinal    = 0u;                         // [-] - second side of a divided slot
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARTITION OWNERSHIP
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Owns the artist's bounded panel partition while `EditorPanel` only presents and edits it.
/// tag   owning, nonallocating, nonthrowing
class PanelStructure
{
public:

    static constexpr std::uint32_t RecordCeiling = 11u;   // [-] - five simultaneous divisions; never allocated
    static constexpr std::uint32_t RootOrdinal   = 0u;    // [-] - stable root slot

    /// 🧩 Returns the partition to one leaf carrying the declared subject.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Construct(PanelSubject InitialSubject = PanelSubject::Viewport);

    /// 🧩 Replaces one leaf by an equal binary division and seats a vacant leaf on the requested side.
    /// out   Deliver  [-]  refuses for a stale or divided ordinal, or when two slots are unavailable
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Divide(std::uint32_t LeafOrdinal,
                         PanelDivisionAxis Axis,
                         PanelDivisionSide VacantSide);

    /// 🧩 Removes one leaf and promotes the opposite side into its enclosing slot.
    /// out   Deliver  [-]  refuses for a stale ordinal and for the sole root leaf
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Withdraw(std::uint32_t LeafOrdinal);

    /// 🧩 Changes what one leaf presents.
    /// out   Deliver  [-]  refuses for a stale or divided ordinal and an unsupported subject
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Assign(std::uint32_t LeafOrdinal, PanelSubject Subject);

    /// 🧩 Changes one division's least-side fraction, clamped to the reference's five-percent limits.
    /// out   Deliver  [-]  refuses for a stale leaf ordinal
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Proportion(std::uint32_t DivisionOrdinal, float LeastFraction);

    /// 🧩 Reads one occupied record; an unoccupied ordinal refuses as stale.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<PanelRecord> Standing(std::uint32_t Ordinal) const;

    /// 🧩 Whether the partition contains more than its sole root leaf.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool WithdrawalAdmitted() const;

    /// 🧩 Returns every slot to its default condition.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

private:

    bool Encloses(std::uint32_t BranchOrdinal,
                  std::uint32_t SeekingOrdinal,
                  std::uint32_t& EnclosingOrdinal,
                  bool& LeastSide) const;
    std::uint32_t ClaimVacant();

    PanelRecord Records[RecordCeiling] = {};   // [-] - bounded partition storage
};

}   // namespace Slate
