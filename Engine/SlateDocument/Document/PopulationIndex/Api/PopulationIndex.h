//============================================================================================================================================
//                                                            POPULATIONINDEX.H
//============================================================================================================================================
// 🧩 Generationally versioned slot ledger — the population every occupant of the document sits inside.

#pragma once

#include "Contract/IdentityContract.h"
#include "Contract/DeliveryContract.h"

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      OCCUPANCY
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which slots are occupied. The free set is the complement and is never stored separately.
/// note  Two representations of one fact diverge, and the divergence is discovered by whichever reader
///       trusted the stale one.
/// tag   owning
class OccupancyIndex
{
public:

    /// 🧩 Declares a slot occupied.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Occupy(std::uint32_t SlotOrdinal);

    /// 🧩 Declares a slot free.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Release(std::uint32_t SlotOrdinal);

    /// 🧩 Whether a slot is occupied.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Occupied(std::uint32_t SlotOrdinal) const;

    /// 🧩 How many slots the ledger spans, occupied or not.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t SpannedCount() const;

private:

    std::vector<std::uint64_t>  OccupancyWords;   // [-] - one bit per slot, least significant first
    std::uint32_t               SpannedSlots = 0u; // [-] - slots the ledger currently spans
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE POPULATION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The slot ledger with generational identity. Every occupant in the document is one slot here.
/// note  🔴 A reference held across a deletion resolves to absent rather than to whatever later took the
///       slot. That is what makes references safe without reference counting.
/// tag   owning
class PopulationIndex
{
public:

    /// 🧩 Enrols one occupant and issues its identity.
    /// out   OccupantIdentity [-]  slot ordinal paired with the generation now held
    /// err   refuses with ExtentExhausted when the population reaches its declared ceiling
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<OccupantIdentity> Enrol();

    /// 🧩 Withdraws one occupant and advances the slot's generation.
    /// in    Subject  [-]  the identity to withdraw
    /// out   Deliver  [-]  refuses with IdentityStale when the identity no longer resolves
    /// post  every reference carrying the prior generation resolves to absent
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Withdraw(OccupantIdentity Subject);

    /// 🧩 Whether an identity still names the occupant it was issued for.
    /// in    Subject  [-]  the identity to resolve
    /// out   Resolved [-]  false for a stale generation and for an unoccupied slot alike
    /// note  Comparison is an integer test, at Exact. An identity that collides is not an identity.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Resolve(OccupantIdentity Subject) const;

    /// 🧩 How many occupants are enrolled.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t EnrolledCount() const;

private:

    static constexpr std::uint32_t PopulationCeiling = 1048576u;   // [-] - slots the population may span

    std::vector<std::uint32_t>  SlotGenerations;      // [-] - current generation per slot; one-based
    std::vector<std::uint32_t>  ReleasedOrdinals;     // [-] - slots free for reuse, most recent first
    OccupancyIndex              Occupancy;            // [-] - which of them are occupied
    std::uint32_t               OccupiedCount = 0u;   // [-] - enrolled occupants
};

}   // namespace Slate
