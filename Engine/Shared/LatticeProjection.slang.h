//============================================================================================================================================
//                                                         LATTICEPROJECTION.SLANG.H
//============================================================================================================================================
// 🧩 Periodic plane symmetry — the cell one domain position falls in, and where inside that cell it lands.

#pragma once

#include "Shared/Prelude.slang.h"

// 📐 `02` §5 places this at Tier A and `54` §2 gives the reason from the consuming side: `82` classifies a
//    position on the host and `70` classifies it on the device, and a cell boundary the two disagree about
//    produces a pattern that does not meet itself across a tile edge. One boundary, one implementation.
//
// 🔴 The classification is in two halves and they are separated deliberately. Which cell a position falls in is
//    integer flooring over an unskewed coordinate and is Exact. Where inside that cell it lands after the
//    declared reflections and turns reads the cell ordinals but no transcendental, and is Exact as well — the
//    Bounded part of `54` is the content resolution `70` performs afterwards, not this.

// 📝 The reflections are named as constants rather than as an enumeration because an enumeration declared on the
//    host has no spelling the shader toolchain shares without a second declaration that must be kept identical.
#define SlateReflectAlong  (1u)   // [-] - the first axis mirrors on alternate cells along it
#define SlateReflectAcross (2u)   // [-] - the second axis mirrors on alternate cells across it

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE CELL ORDINAL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The greatest ordinal not above a coordinate.
/// in    Coordinate  [-]  a continuous cell coordinate, of either sign
/// out   Ordinal     [-]  floored, never truncated toward zero
/// note  🔴 Truncation and flooring agree above the origin and disagree below it, so a lattice that truncated
///        would repeat its first cell twice across the origin and shift every negative cell by one. The artist
///        meets that as a pattern whose repeat breaks along exactly one row and one column of the domain.
/// cost  ✔️
/// note  Exact — a comparison and an integer decrement; identical on the host and on the device.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Signed32 FlooredOrdinal(Real64 Coordinate)
{
    const Signed32 Truncated = Signed32(Coordinate);

    return Coordinate < Real64(Truncated) ? Truncated - 1 : Truncated;
}

/// 🧩 Classifies one domain position into its lattice cell and its position within that cell.
/// in    PositionAlong            [-]  the domain's first axis
/// in    PositionAcross           [-]  its second
/// in    CellExtentAlong          [-]  the repeating unit, strictly positive — `54` §2
/// in    CellExtentAcross         [-]  likewise
/// in    OffsetProgressionAlong   [-]  row-to-row displacement, as a fraction of a cell
/// in    OffsetProgressionAcross  [-]  column-to-column; never declared beside the above
/// in    SkewAlong                [-]  shear for a diagonal repeat
/// in    SkewAcross               [-]  likewise
/// out   CellAlong                [-]  the cell ordinal along, signed
/// out   CellAcross               [-]  the cell ordinal across, signed
/// out   WithinAlong              [-]  in the half-open unit interval, before reflection and turning
/// out   WithinAcross             [-]  likewise
/// pre   the lattice validated — a vanishing extent or a unit skew product is refused at declaration
/// note  🔴 The two offset progressions are resolved in opposite orders and never both at once. A row
///        displacement depending on the column ordinal needs the column resolved first and a column displacement
///        depending on the row needs the row; declaring both leaves each waiting on the other, which is why
///        `LatticeSpecification::Validate` refuses the pair rather than picking an order here.
/// cost  ✔️
/// note  Exact — the unskewing is one correctly-rounded division per axis and the flooring is integral.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED void ClassifyLatticeCell(Real64 PositionAlong,
                                      Real64 PositionAcross,
                                      Real64 CellExtentAlong,
                                      Real64 CellExtentAcross,
                                      Real64 OffsetProgressionAlong,
                                      Real64 OffsetProgressionAcross,
                                      Real64 SkewAlong,
                                      Real64 SkewAcross,
                                      SLATE_OUT(Signed32) CellAlong,
                                      SLATE_OUT(Signed32) CellAcross,
                                      SLATE_OUT(Real64)   WithinAlong,
                                      SLATE_OUT(Real64)   WithinAcross)
{
    // 📐 The shear is inverted rather than applied. A position arrives in the domain and the lattice is what is
    //    sheared, so classifying it means carrying the position back through the shear the lattice declares.
    const Real64 Determinant    = 1.0 - SkewAlong * SkewAcross;
    const Real64 UnskewedAlong  = (PositionAlong  - SkewAlong  * PositionAcross) / Determinant;
    const Real64 UnskewedAcross = (PositionAcross - SkewAcross * PositionAlong)  / Determinant;

    const Real64 CoordinateAlong  = UnskewedAlong  / CellExtentAlong;
    const Real64 CoordinateAcross = UnskewedAcross / CellExtentAcross;

    if (OffsetProgressionAcross != 0.0)
    {
        CellAlong   = FlooredOrdinal(CoordinateAlong);
        WithinAlong = CoordinateAlong - Real64(CellAlong);

        const Real64 DisplacedAcross = CoordinateAcross - OffsetProgressionAcross * Real64(CellAlong);

        CellAcross   = FlooredOrdinal(DisplacedAcross);
        WithinAcross = DisplacedAcross - Real64(CellAcross);

        return;
    }

    CellAcross   = FlooredOrdinal(CoordinateAcross);
    WithinAcross = CoordinateAcross - Real64(CellAcross);

    const Real64 DisplacedAlong = CoordinateAlong - OffsetProgressionAlong * Real64(CellAcross);

    CellAlong   = FlooredOrdinal(DisplacedAlong);
    WithinAlong = DisplacedAlong - Real64(CellAlong);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 WITHIN ONE CELL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Applies the declared reflections and quarter turns to a position within its cell.
/// in    CellAlong          [-]  the cell ordinal along; its parity selects the reflection
/// in    CellAcross         [-]  the cell ordinal across; likewise
/// in    WithinAlong        [-]  in the unit interval, as classified
/// in    WithinAcross       [-]  likewise
/// in    ReflectionMask     [-]  SlateReflectAlong and SlateReflectAcross, composed
/// in    RotationIncrement  [-]  quarter turns per step of the cell schedule
/// out   ProjectedAlong     [-]  in the unit interval, after reflection and turning
/// out   ProjectedAcross    [-]  likewise
/// note  🔴 `54` §2: the five symmetries **compose** and none of them is a named pattern. Herringbone is one
///        reflection with a rotation increment and an offset progression, and twill is a skew with an offset
///        progression. A form that enumerated named patterns could express exactly the patterns already listed.
/// note  📝 The turn count is taken modulo four over the sum of the two ordinals, in unsigned arithmetic, so a
///        cell at a negative ordinal turns the same way as the positive cell four steps from it rather than
///        turning by a negative count that has no meaning.
/// cost  ✔️
/// note  Exact — reflection is one subtraction from unity and a quarter turn exchanges two coordinates.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED void ProjectWithinCell(Signed32   CellAlong,
                                    Signed32   CellAcross,
                                    Real64     WithinAlong,
                                    Real64     WithinAcross,
                                    Unsigned32 ReflectionMask,
                                    Unsigned32 RotationIncrement,
                                    SLATE_OUT(Real64) ProjectedAlong,
                                    SLATE_OUT(Real64) ProjectedAcross)
{
    Real64 Along  = WithinAlong;
    Real64 Across = WithinAcross;

    if ((ReflectionMask & SlateReflectAlong) != 0u && (Unsigned32(CellAlong) & 1u) != 0u)
    {
        Along = 1.0 - Along;
    }

    if ((ReflectionMask & SlateReflectAcross) != 0u && (Unsigned32(CellAcross) & 1u) != 0u)
    {
        Across = 1.0 - Across;
    }

    const Unsigned32 Turns = (RotationIncrement * (Unsigned32(CellAlong) + Unsigned32(CellAcross))) & 3u;

    for (Unsigned32 TurnOrdinal = 0u; TurnOrdinal < Turns; ++TurnOrdinal)
    {
        const Real64 Turned = Along;

        Along  = Across;
        Across = 1.0 - Turned;
    }

    ProjectedAlong  = Along;
    ProjectedAcross = Across;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ONE CELL ORDINAL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Carries one signed ordinal onto the unsigned ordinals, order-preserving about the origin.
/// in    Ordinal   [-]  a cell ordinal, of either sign
/// out   Folded    [-]  a non-negative ordinal; zero maps to zero and −1 to one
/// note  📝 The negative branch is written against `Ordinal + 1` rather than against `Ordinal`, because the most
///        negative representable ordinal has no representable negation and negating it directly is undefined.
/// cost  ✔️
/// note  Exact — integer arithmetic; a bijection onto the unsigned ordinals.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Unsigned32 ZigzagOrdinal(Signed32 Ordinal)
{
    return Ordinal < 0 ? ((Unsigned32(-(Ordinal + 1)) << 1) | 1u) : (Unsigned32(Ordinal) << 1);
}

/// 🧩 Folds a cell's two ordinals into the one ordinal its variation is indexed by.
/// in    CellAlong   [-]  the cell ordinal along, signed
/// in    CellAcross  [-]  the cell ordinal across, signed
/// out   Folded      [-]  the ordinal `54` §1's variation is a function of
/// note  🔴 Variation is a function of **this ordinal and nothing else** — `54` §1. That is what makes a pattern
///        survive a reopen, agree between a coarse reduction level and the finer one that replaces it, and agree
///        between `82`'s host preview and `70`'s device resolution.
/// note  ⚠️ Two cell ordinals carry more information than one, so the fold cannot be injective and two distant
///        cells will eventually share a variation. That is a repeat at a period far beyond any declared lattice,
///        not a collision worth resolving — resolving it would need an ordinal wider than the sequence consuming
///        it accepts.
/// cost  ✔️
/// note  Exact — two products and one sum, all wrapping in 32 bits by construction.
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Unsigned32 FoldedCellOrdinal(Signed32 CellAlong, Signed32 CellAcross)
{
    return ZigzagOrdinal(CellAlong) * 0x9E3779B9u + ZigzagOrdinal(CellAcross) * 0x85EBCA6Bu;
}

}   // namespace Slate
