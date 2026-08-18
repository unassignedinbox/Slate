//============================================================================================================================================
//                                                         VECTORINTERCHANGE.CPP
//============================================================================================================================================
// 🧩 Declaration by either route, flattening at a supplied tolerance, and classification per declared rule.

#include "SlateDocument/Document/VectorInterchange/Api/VectorInterchange.h"

#include "Shared/PlanarClassifier.slang.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> VectorInterchange::DeclareFromFile(const OutlineSpecification& Arriving, const std::string& OriginPath)
{
    if (Arriving.Paths.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the source declared no path" });

    DeclaredOutline            = Arriving;
    DeclaredOutline.OriginPath = OriginPath;
    DeclaredOutline.SourceText.clear();
    TextSourceDeclared         = false;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> VectorInterchange::DeclareFromText(const OutlineSpecification& Arriving, const std::string& SourceText)
{
    if (Arriving.Paths.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the source declared no path" });

    DeclaredOutline            = Arriving;
    DeclaredOutline.SourceText = SourceText;
    DeclaredOutline.OriginPath.clear();
    TextSourceDeclared         = true;

    return Deliver<bool>::Deliver(true);
}

void VectorInterchange::Refuse(const std::string& Construct, std::uint32_t SourceOrdinal, const Refusal& Declining)
{
    RefusedConstruct Refusing;
    Refusing.Construct     = Construct;
    Refusing.SourceOrdinal = SourceOrdinal;
    Refusing.Declining     = Declining;

    RefusedConstructs.push_back(Refusing);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     FLATTENING
//------------------------------------------------------------------------------------------------------------------------

std::vector<std::vector<PlanarPosition>> VectorInterchange::Flatten(double Tolerance) const
{
    std::vector<std::vector<PlanarPosition>> Flattened;
    Flattened.reserve(DeclaredOutline.Paths.size());

    for (const OutlinePath& Path : DeclaredOutline.Paths)
    {
        std::vector<PlanarPosition> Traversed = Slate::Flatten(Path.Origin, Path.Segments, Tolerance);

        // 📝 An open path is closed **for classification only** and is not closed in the specification. A fill
        //    rule needs a closed polyline to accumulate over, and leaving the run open would leak the winding
        //    across the gap — but recording the closure would change what the artist authored.
        if (!Traversed.empty())
        {
            const PlanarPosition& Last = Traversed.back();

            if (Last.PositionX != Path.Origin.PositionX || Last.PositionY != Path.Origin.PositionY)
                Traversed.push_back(Path.Origin);
        }

        Flattened.push_back(Traversed);
    }

    return Flattened;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

std::int32_t VectorInterchange::Classify(const std::vector<std::vector<PlanarPosition>>& Flattened,
                                        double                                         PointX,
                                        double                                         PointY) const
{
    std::int32_t Resolved = -1;

    for (std::size_t PathOrdinal = 0u; PathOrdinal < Flattened.size(); ++PathOrdinal)
    {
        const std::vector<PlanarPosition>& Traversed = Flattened[PathOrdinal];

        if (Traversed.size() < 3u)
            continue;

        const FillRule Rule = PathOrdinal < DeclaredOutline.Paths.size()
                            ? DeclaredOutline.Paths[PathOrdinal].Rule
                            : FillRule::NonZero;

        Signed32 WindingCount    = 0;
        Signed32 CrossingCount   = 0;
        Signed32 BoundaryTouched = 0;

        for (std::size_t Ordinal = 0u; Ordinal + 1u < Traversed.size(); ++Ordinal)
        {
            AccumulateWinding(Traversed[Ordinal].PositionX,      Traversed[Ordinal].PositionY,
                              Traversed[Ordinal + 1u].PositionX, Traversed[Ordinal + 1u].PositionY,
                              PointX, PointY,
                              WindingCount, CrossingCount, BoundaryTouched);
        }

        const Signed32 Containment = ResolveContainment(WindingCount,
                                                       CrossingCount,
                                                       BoundaryTouched,
                                                       Rule == FillRule::EvenOdd ? 1 : 0);

        // 🔴 A boundary anywhere wins outright. A position that is exactly on one path's edge and inside another
        //    is on the boundary of the outline, and reporting it interior gives that edge a one-texel bias.
        if (Containment == 0)
            return 0;

        if (Containment > 0)
            Resolved = 1;
    }

    return Resolved;
}

const OutlineSpecification&          VectorInterchange::Declared() const     { return DeclaredOutline;    }
const std::vector<RefusedConstruct>& VectorInterchange::Refusals() const     { return RefusedConstructs;  }
bool                                 VectorInterchange::TextRetained() const { return TextSourceDeclared; }

//------------------------------------------------------------------------------------------------------------------------
//                                                     TYPEFACES
//------------------------------------------------------------------------------------------------------------------------

void TypefaceInterchange::DeclareTypeface(std::uint32_t TypefaceIdentity_, double UnitsPerEm_)
{
    DeclaredIdentity = TypefaceIdentity_;
    DeclaredUnits    = UnitsPerEm_ > 0.0 ? UnitsPerEm_ : 1000.0;
}

Deliver<bool> TypefaceInterchange::DeclareGlyph(const GlyphSpecification& Declaring)
{
    for (const GlyphSpecification& Held : DeclaredGlyphs)
    {
        if (Held.GlyphIdentity == Declaring.GlyphIdentity)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "the typeface already declares that glyph" });
        }
    }

    DeclaredGlyphs.push_back(Declaring);

    return Deliver<bool>::Deliver(true);
}

void TypefaceInterchange::DeclareAdjustment(std::uint32_t EarlierGlyph,
                                            std::uint32_t LaterGlyph,
                                            double        Adjustment_)
{
    for (PairAdjustment& Held : DeclaredAdjustments)
    {
        if (Held.EarlierGlyph == EarlierGlyph && Held.LaterGlyph == LaterGlyph)
        {
            Held.Adjustment = Adjustment_;
            return;
        }
    }

    PairAdjustment Declaring;
    Declaring.EarlierGlyph = EarlierGlyph;
    Declaring.LaterGlyph   = LaterGlyph;
    Declaring.Adjustment   = Adjustment_;

    DeclaredAdjustments.push_back(Declaring);
}

Deliver<const GlyphSpecification*> TypefaceInterchange::ResolveGlyph(std::uint32_t GlyphIdentity) const
{
    for (const GlyphSpecification& Held : DeclaredGlyphs)
    {
        if (Held.GlyphIdentity == GlyphIdentity)
            return Deliver<const GlyphSpecification*>::Deliver(&Held);
    }

    return Deliver<const GlyphSpecification*>::Refuse(
        { RefusalReason::ContentUnsupported, "the typeface declares no such glyph" });
}

double TypefaceInterchange::Adjustment(std::uint32_t EarlierGlyph, std::uint32_t LaterGlyph) const
{
    for (const PairAdjustment& Held : DeclaredAdjustments)
    {
        if (Held.EarlierGlyph == EarlierGlyph && Held.LaterGlyph == LaterGlyph)
            return Held.Adjustment;
    }

    return 0.0;
}

std::uint32_t TypefaceInterchange::TypefaceIdentity() const { return DeclaredIdentity; }
double        TypefaceInterchange::UnitsPerEm() const       { return DeclaredUnits;    }

std::uint32_t TypefaceInterchange::GlyphCount() const
{
    return static_cast<std::uint32_t>(DeclaredGlyphs.size());
}

}   // namespace Slate
