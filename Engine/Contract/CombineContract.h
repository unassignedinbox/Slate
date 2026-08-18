//============================================================================================================================================
//                                                           COMBINECONTRACT.H
//============================================================================================================================================
// 🧩 The five combination behaviours `22` §3 declares — read by impressions, by layer entries and by cell content alike.

#pragma once

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                              THE FIVE COMBINATIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 How arriving content reads against what already stands.
/// note  🔴 Declared here rather than inside any one of `22`, `54` or `56`, because all three apply it and none of
///        them may include another — they are peers in `00` §9.1's stratum 5. `00` §2's rule is written for a
///        constant and the reasoning is the same for a declaration: three copies of one behaviour are three that
///        must agree, and the tick on which they stop agreeing produces a surface whose result depends on whether
///        content arrived as a stroke, as a layer or as a cell — a difference the artist cannot see and cannot
///        correct.
/// note  ⚠️ `22` §3 spells the mechanism `CombineSpecification` and that spelling is kept verbatim. `Composition`
///        is banned by `00` §8, which is why the prose around it reads awkwardly and the identifier does not.
/// tag   contract
enum class CombineSpecification : std::uint32_t
{
    Over         = 0u,   // [-] - source-over with the arriving coverage
    Additive     = 1u,   // [-] - accumulates without coverage limiting
    Multiply     = 2u,   // [-] - attenuates what stands
    Replace      = 3u,   // [-] - overwrites within coverage, coverage included
    Erase        = 4u,   // [-] - reduces coverage and leaves the value alone
    CombineCount = 5u    // [-] - the closed count, never a combination
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE ARITHMETIC
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Combines one arriving channel value into what stands.
/// in    Declared          [-]  which of the five
/// in    Standing          [-]  the value already resolved at this position
/// in    Arriving          [-]  the value the arriving content declares
/// in    ArrivingCoverage  [-]  how strongly it applies here, in the closed unit interval
/// out   Combined          [-]  the resolved value
/// note  🔴 Nothing is clamped. `18` §2's emission channel is unbounded above, and clamping here would compress a
///        radiance before `66` had the chance to project it.
/// note  📐 Over and Replace produce the **same value** and differ only in what `CombineCoverage` does beside
///        them. That is the whole distinction between the two: Over accumulates coverage and Replace overwrites
///        it, which is invisible on an opaque surface and decisive on a partly covered one.
/// note  📝 A colour is three of these, applied per component. Contract/ depends on nothing, so it cannot name
///        `ColourSpecification`; the caller applies the scalar form componentwise and keeps the space it carries.
/// cost  ✔️
/// tag   api, contract, nonallocating, nonthrowing
constexpr double CombineValue(CombineSpecification Declared,
                              double               Standing,
                              double               Arriving,
                              double               ArrivingCoverage)
{
    return Declared == CombineSpecification::Over
         ? Standing * (1.0 - ArrivingCoverage) + Arriving * ArrivingCoverage
         : Declared == CombineSpecification::Additive
         ? Standing + Arriving * ArrivingCoverage
         : Declared == CombineSpecification::Multiply
         ? Standing * (1.0 - ArrivingCoverage + Arriving * ArrivingCoverage)
         : Declared == CombineSpecification::Replace
         ? Standing * (1.0 - ArrivingCoverage) + Arriving * ArrivingCoverage
         : Standing;
}

/// 🧩 Combines one arriving coverage into the coverage that stands.
/// in    Declared          [-]  which of the five
/// in    StandingCoverage  [-]  coverage already resolved here
/// in    ArrivingCoverage  [-]  coverage the arriving content declares
/// out   Combined          [-]  the resolved coverage, in the closed unit interval
/// note  🔴 Erase is the one combination that reduces coverage, and it leaves the value untouched. An eraser that
///        wrote a value would leave the artist's colour underneath whatever they erased with, visible the moment
///        anything painted over it again.
/// cost  ✔️
/// tag   api, contract, nonallocating, nonthrowing
constexpr double CombineCoverage(CombineSpecification Declared,
                                 double               StandingCoverage,
                                 double               ArrivingCoverage)
{
    return Declared == CombineSpecification::Erase
         ? StandingCoverage * (1.0 - ArrivingCoverage)
         : Declared == CombineSpecification::Replace
         ? ArrivingCoverage
         : StandingCoverage + ArrivingCoverage * (1.0 - StandingCoverage);
}

}   // namespace Slate
