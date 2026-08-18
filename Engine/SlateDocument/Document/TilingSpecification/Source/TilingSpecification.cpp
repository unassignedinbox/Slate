//============================================================================================================================================
//                                                         TILINGSPECIFICATION.CPP
//============================================================================================================================================
// 🧩 Lattice validation, the per-cell variation that is a permutation rather than a sample, and the nesting bound.

#include "SlateDocument/Document/TilingSpecification/Api/TilingSpecification.h"

#include "Shared/SampleProjection.slang.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   LATTICE VALIDATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> LatticeSpecification::Validate() const
{
    if (CellExtentAlong <= 0.0 || CellExtentAcross <= 0.0)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a cell of no extent repeats nothing" });

    // 📝 A cell finer than one texel of the maximum working extent can never be resolved distinctly at any level
    //    `20` will promote, so it is refused where it is declared rather than discovered as a grey smear.
    const double FinestExtent = 1.0 / static_cast<double>(MaximumWorkingEdge);

    if (CellExtentAlong < FinestExtent || CellExtentAcross < FinestExtent)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a cell finer than one texel of the maximum working extent" });
    }

    // 🔴 `54` §2: the two progressions have no consistent inverse together. Refused rather than resolved in some
    //    declared order, because whichever order was chosen would be invisible in the declaration and decisive
    //    in the result.
    if (OffsetProgressionAlong != 0.0 && OffsetProgressionAcross != 0.0)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "two offset progressions at once cannot be inverted" });
    }

    // 📐 A skew product reaching unity collapses the lattice onto a line, and the unskewing above then divides
    //    by a vanishing determinant.
    if (SkewAlong * SkewAcross >= 1.0 || SkewAlong * SkewAcross <= -1.0)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the declared skew collapses the lattice" });

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> TilingSpecification::DeclareLattice(const LatticeSpecification& Declaring)
{
    const Deliver<bool> Validated = Declaring.Validate();

    if (!Validated.ContentPresent)
        return Validated;

    DeclaredLattice = Declaring;
    LatticeHeld     = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> TilingSpecification::DeclareContent(const CellContent& Declaring)
{
    if (Declaring.PlacedScale <= 0.0)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a content element of no scale" });

    if (Declaring.Source == CellContentSource::DeclaredColour && !Declaring.DeclaredColour.ColourDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a declared colour carries no space" });

    // 🔴 A tiling already nested may not nest another — `54` §3's one level, enforced at the element rather than
    //    at the reference, so a tiling that is nested afterwards still refuses.
    if (Declaring.Source == CellContentSource::NestedTiling && Depth >= TilingNestingCeiling)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "nesting is bounded at one level — `54` §3" });
    }

    DeclaredContent.push_back(Declaring);

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> TilingSpecification::DeclareVariation(const VariationSpecification& Declaring)
{
    if (Declaring.Declared == VariationSubject::Permuted && Declaring.DeclaredSpan == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a permutation into an empty set" });

    if (Declaring.UpperScale < Declaring.LowerScale)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the variation interval is inverted" });

    DeclaredVariation = Declaring;

    return Deliver<bool>::Deliver(true);
}

void TilingSpecification::DeclareNestingDepth(std::uint32_t ArrivingDepth)
{
    Depth = ArrivingDepth;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<ClassifiedCell> TilingSpecification::Classify(double PositionAlong, double PositionAcross) const
{
    if (!LatticeHeld)
        return Deliver<ClassifiedCell>::Refuse({ RefusalReason::ContentUnsupported, "no lattice is declared" });

    ClassifiedCell Classified;

    std::int32_t CellAlong    = 0;
    std::int32_t CellAcross   = 0;
    double       WithinAlong  = 0.0;
    double       WithinAcross = 0.0;

    ClassifyLatticeCell(PositionAlong,                    PositionAcross,
                        DeclaredLattice.CellExtentAlong,  DeclaredLattice.CellExtentAcross,
                        DeclaredLattice.OffsetProgressionAlong,
                        DeclaredLattice.OffsetProgressionAcross,
                        DeclaredLattice.SkewAlong,        DeclaredLattice.SkewAcross,
                        CellAlong, CellAcross, WithinAlong, WithinAcross);

    ProjectWithinCell(CellAlong, CellAcross, WithinAlong, WithinAcross,
                      DeclaredLattice.ReflectionMask, DeclaredLattice.RotationIncrement,
                      Classified.WithinAlong, Classified.WithinAcross);

    Classified.CellAlong  = CellAlong;
    Classified.CellAcross = CellAcross;

    // 🔴 The variation is a **function of the cell ordinal** and of nothing else. That is what makes it survive a
    //    reopen, agree between a coarse level and the finer one that replaces it, and agree between `82`'s host
    //    preview and `70`'s device resolution — `54` §1.
    if (DeclaredVariation.Declared == VariationSubject::Permuted)
    {
        const std::uint32_t Folded = FoldedCellOrdinal(CellAlong, CellAcross);

        Classified.VariationOrdinal =
            ProjectPermutedOrdinal(Folded, DeclaredVariation.PatternSeed) % DeclaredVariation.DeclaredSpan;

        const double Fraction = DeclaredVariation.DeclaredSpan <= 1u
                              ? 0.0
                              : static_cast<double>(Classified.VariationOrdinal)
                              / static_cast<double>(DeclaredVariation.DeclaredSpan - 1u);

        Classified.VariationScale = DeclaredVariation.LowerScale
                                  + (DeclaredVariation.UpperScale - DeclaredVariation.LowerScale) * Fraction;
    }
    else if (DeclaredVariation.Declared == VariationSubject::Progressive)
    {
        // 📝 A progression is indexed by position rather than permuted, so a gradient across a bolt of cloth is
        //    expressible without a permutation pretending to be one.
        const double Fraction = ProjectVariation(FoldedCellOrdinal(CellAlong, 0), DeclaredVariation.PatternSeed);

        Classified.VariationOrdinal = static_cast<std::uint32_t>(CellAlong + CellAcross);
        Classified.VariationScale   = DeclaredVariation.LowerScale
                                    + (DeclaredVariation.UpperScale - DeclaredVariation.LowerScale) * Fraction;
    }

    return Deliver<ClassifiedCell>::Deliver(Classified);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const LatticeSpecification&     TilingSpecification::Lattice() const   { return DeclaredLattice;   }
const std::vector<CellContent>& TilingSpecification::Content() const   { return DeclaredContent;   }
const VariationSpecification&   TilingSpecification::Variation() const { return DeclaredVariation; }
std::uint32_t                   TilingSpecification::NestingDepth() const { return Depth;          }
bool                            TilingSpecification::LatticeDeclared() const { return LatticeHeld; }

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE TILINGS
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> TilingIndex::Declare()
{
    if (Declared.size() >= TilingCeiling)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "the tiling ceiling was reached" });

    const std::uint32_t TilingOrdinal = static_cast<std::uint32_t>(Declared.size());

    Declared.push_back(TilingSpecification{});

    return Deliver<std::uint32_t>::Deliver(TilingOrdinal);
}

Deliver<const TilingSpecification*> TilingIndex::Resolve(std::uint32_t TilingOrdinal) const
{
    if (TilingOrdinal >= Declared.size())
        return Deliver<const TilingSpecification*>::Refuse({ RefusalReason::ContentUnsupported, "no such tiling" });

    return Deliver<const TilingSpecification*>::Deliver(&Declared[TilingOrdinal]);
}

Deliver<TilingSpecification*> TilingIndex::Amend(std::uint32_t TilingOrdinal)
{
    if (TilingOrdinal >= Declared.size())
        return Deliver<TilingSpecification*>::Refuse({ RefusalReason::ContentUnsupported, "no such tiling" });

    return Deliver<TilingSpecification*>::Deliver(&Declared[TilingOrdinal]);
}

Deliver<bool> TilingIndex::Nest(std::uint32_t EnclosingOrdinal, std::uint32_t NestedOrdinal)
{
    if (EnclosingOrdinal >= Declared.size() || NestedOrdinal >= Declared.size())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such tiling" });

    if (EnclosingOrdinal == NestedOrdinal)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a tiling cannot nest itself" });

    const std::uint32_t Arriving = Declared[EnclosingOrdinal].NestingDepth() + 1u;

    if (Arriving > TilingNestingCeiling)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "nesting is bounded at one level — `54` §3" });
    }

    // 📝 A tiling already carrying a nested element cannot itself become nested, because that would place a
    //    nested element two levels down without either declaration having said so.
    for (const CellContent& Held : Declared[NestedOrdinal].Content())
    {
        if (Held.Source == CellContentSource::NestedTiling)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "the nested tiling already carries a nested element" });
        }
    }

    Declared[NestedOrdinal].DeclareNestingDepth(Arriving);

    return Deliver<bool>::Deliver(true);
}

std::uint32_t TilingIndex::DeclaredCount() const
{
    return static_cast<std::uint32_t>(Declared.size());
}

}   // namespace Slate
