//============================================================================================================================================
//                                                             VECTORCODEC.CPP
//============================================================================================================================================
// 🧩 `10` §1 — vector streams translated into `52`'s accepted subset, with every refusal named and positioned.

#include "SlateDocument/Format/VectorCodec/Api/VectorCodec.h"

#include <cmath>
#include <cstdlib>
#include <cstring>

namespace Slate
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REFUSED SET
//------------------------------------------------------------------------------------------------------------------------

// 🔴 `00` §5.2's refused set, named element by element. Each is refused rather than approximated: a vector
//    source that silently loses content is worse than one that refuses it, because the artist attributes the
//    loss to their own file and goes looking for a mistake they did not make.
struct RefusedElement
{
    const char*    Spelling = "";                              // [-] - the element as the source spells it
    RefusalReason  Reason   = RefusalReason::ContentUnsupported; // [-] - what the refusal reports
    const char*    Detail   = "";                              // [-] - static text, never allocated
};

const RefusedElement RefusedElements[] =
{
    { "filter",        RefusalReason::ContentUnsupported, "effect operations are outside the accepted subset — `00` §5.2" },
    { "clipPath",      RefusalReason::ContentUnsupported, "clipping is outside the accepted subset — `00` §5.2"           },
    { "mask",          RefusalReason::ContentUnsupported, "masking is outside the accepted subset — `00` §5.2"            },
    { "script",        RefusalReason::ContentUnsupported, "script is outside the accepted subset — `00` §5.2"             },
    { "animate",       RefusalReason::ContentUnsupported, "animation is outside the accepted subset — `00` §5.2"          },
    { "animateMotion", RefusalReason::ContentUnsupported, "animation is outside the accepted subset — `00` §5.2"          },
    { "animateTransform", RefusalReason::ContentUnsupported, "animation is outside the accepted subset — `00` §5.2"       },
    { "image",         RefusalReason::ContentUnsupported, "embedded raster content is outside the accepted subset — `00` §5.2" },
    { "text",          RefusalReason::ContentUnsupported, "text is resolved through `TypefaceCodec`, never as an outline here" },
    { "use",           RefusalReason::ContentUnsupported, "an instanced reference is not resolved by a translation"       },
};

// 📝 A stroked element is named too. `52` §2 converts strokes at intake, and intake is above this line — so a
//    stroke reaching here is geometry the artist will not see unless they are told about it.
const char* const StrokedDetail = "a stroke is converted at intake, not translated — `52` §2";

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE SCANNING
//------------------------------------------------------------------------------------------------------------------------

bool Whitespace(char Carried)
{
    return Carried == ' ' || Carried == '\t' || Carried == '\r' || Carried == '\n' || Carried == ',';
}

/// 🧩 Advances past every separator, so a run of commands may be spaced however the source spaced it.
std::size_t SkipSeparators(const std::string& Reading, std::size_t Ordinal)
{
    while (Ordinal < Reading.size() && Whitespace(Reading[Ordinal])) { ++Ordinal; }

    return Ordinal;
}

/// 🧩 Reads one real from the path data, reporting whether one was there to read.
/// note  📝 Read here rather than through the standard conversions because a path's numbers run together
///        without separators — "1.5.5" is two numbers — and a conversion that consumed as much as it could
///        would take both. The scan below stops at the second decimal point, which is what the grammar means.
bool ReadOrdinate(const std::string& Reading, std::size_t& Ordinal, double& Produced)
{
    Ordinal = SkipSeparators(Reading, Ordinal);

    const std::size_t Beginning = Ordinal;

    if (Ordinal < Reading.size() && (Reading[Ordinal] == '+' || Reading[Ordinal] == '-')) { ++Ordinal; }

    bool PointSeen = false;
    bool DigitSeen = false;

    while (Ordinal < Reading.size())
    {
        const char Carried = Reading[Ordinal];

        if (Carried >= '0' && Carried <= '9')
        {
            DigitSeen = true;
            ++Ordinal;
        }
        else if (Carried == '.' && !PointSeen)
        {
            PointSeen = true;
            ++Ordinal;
        }
        else if ((Carried == 'e' || Carried == 'E') && DigitSeen)
        {
            ++Ordinal;

            if (Ordinal < Reading.size() && (Reading[Ordinal] == '+' || Reading[Ordinal] == '-')) { ++Ordinal; }
        }
        else
        {
            break;
        }
    }

    if (!DigitSeen)
    {
        Ordinal = Beginning;
        return false;
    }

    Produced = std::strtod(Reading.substr(Beginning, Ordinal - Beginning).c_str(), nullptr);

    return true;
}

/// 🧩 Reads one flag — a single digit, which the arc grammar writes without a separator after it.
bool ReadFlag(const std::string& Reading, std::size_t& Ordinal, bool& Produced)
{
    Ordinal = SkipSeparators(Reading, Ordinal);

    if (Ordinal >= Reading.size()) { return false; }

    const char Carried = Reading[Ordinal];

    if (Carried != '0' && Carried != '1') { return false; }

    Produced = Carried == '1';
    ++Ordinal;

    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ONE PATH RUN
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Holds the state one run of path data is translated against — where it is, and what it last curved with.
struct PathReading
{
    PlanarPosition  Position       = {};      // [-] - the current position, in the source's own space
    PlanarPosition  Beginning      = {};      // [-] - where the current subpath started, for a close
    PlanarPosition  LastControl    = {};      // [-] - reflected by a smooth continuation
    bool            CubicPreceding = false;   // [-] - the preceding segment was a cubic
    bool            QuadraticPreceding = false; // [-] - the preceding segment was a quadratic
};

/// 🧩 Translates one `d` attribute into the closed and open paths it declares.
/// note  🔴 A subpath that never closes stays open. `52` §1: closing it silently moves which side of it the
///        interior is on, and the artist reads that as the fill having moved rather than the path having been
///        altered by something they cannot see.
void TranslatePathData(const std::string& PathData, FillRule Rule, std::vector<OutlinePath>& Appending)
{
    PathReading  Reading;
    OutlinePath  Constructing;
    bool         PathOccupied = false;
    std::size_t  Ordinal      = 0u;
    char         Command      = '\0';

    const auto SealPath = [&]()
    {
        if (PathOccupied && !Constructing.Segments.empty())
        {
            Constructing.Rule = Rule;
            Appending.push_back(Constructing);
        }

        Constructing = OutlinePath{};
        PathOccupied = false;
    };

    while (Ordinal < PathData.size())
    {
        Ordinal = SkipSeparators(PathData, Ordinal);

        if (Ordinal >= PathData.size()) { break; }

        const char Carried = PathData[Ordinal];

        if ((Carried >= 'A' && Carried <= 'Z') || (Carried >= 'a' && Carried <= 'z'))
        {
            Command = Carried;
            ++Ordinal;
        }
        else if (Command == '\0')
        {
            break;
        }
        else if (Command == 'M')
        {
            Command = 'L';
        }
        else if (Command == 'm')
        {
            Command = 'l';
        }

        const bool  Relative = Command >= 'a' && Command <= 'z';
        const char  Absolute = Relative ? static_cast<char>(Command - 'a' + 'A') : Command;

        if (Absolute == 'Z')
        {
            if (PathOccupied && !Constructing.Segments.empty())
            {
                Constructing.ClosedRun = true;
                Constructing.Rule      = Rule;
                Appending.push_back(Constructing);
            }

            Constructing        = OutlinePath{};
            PathOccupied        = false;
            Reading.Position    = Reading.Beginning;
            Reading.CubicPreceding     = false;
            Reading.QuadraticPreceding = false;

            continue;
        }

        if (Absolute == 'M')
        {
            double AlongOrdinate  = 0.0;
            double AcrossOrdinate = 0.0;

            if (!ReadOrdinate(PathData, Ordinal, AlongOrdinate) || !ReadOrdinate(PathData, Ordinal, AcrossOrdinate))
            {
                break;
            }

            SealPath();

            Reading.Position.PositionX = Relative ? Reading.Position.PositionX + AlongOrdinate  : AlongOrdinate;
            Reading.Position.PositionY = Relative ? Reading.Position.PositionY + AcrossOrdinate : AcrossOrdinate;
            Reading.Beginning          = Reading.Position;

            Constructing        = OutlinePath{};
            Constructing.Origin = Reading.Position;
            PathOccupied        = true;

            Reading.CubicPreceding     = false;
            Reading.QuadraticPreceding = false;

            continue;
        }

        if (!PathOccupied)
        {
            // 📝 A run that curves before it moves has no origin to curve from. The source's own beginning is
            //    the origin in that case, which is what the grammar declares the current position to be.
            Constructing        = OutlinePath{};
            Constructing.Origin = Reading.Position;
            Reading.Beginning   = Reading.Position;
            PathOccupied        = true;
        }

        PathSegment  Placed;
        bool         SegmentRead = false;

        if (Absolute == 'L' || Absolute == 'H' || Absolute == 'V')
        {
            double AlongOrdinate  = Reading.Position.PositionX;
            double AcrossOrdinate = Reading.Position.PositionY;

            if (Absolute == 'L')
            {
                double ReadAlong  = 0.0;
                double ReadAcross = 0.0;

                if (ReadOrdinate(PathData, Ordinal, ReadAlong) && ReadOrdinate(PathData, Ordinal, ReadAcross))
                {
                    AlongOrdinate  = Relative ? Reading.Position.PositionX + ReadAlong  : ReadAlong;
                    AcrossOrdinate = Relative ? Reading.Position.PositionY + ReadAcross : ReadAcross;
                    SegmentRead    = true;
                }
            }
            else if (Absolute == 'H')
            {
                double ReadAlong = 0.0;

                if (ReadOrdinate(PathData, Ordinal, ReadAlong))
                {
                    AlongOrdinate = Relative ? Reading.Position.PositionX + ReadAlong : ReadAlong;
                    SegmentRead   = true;
                }
            }
            else
            {
                double ReadAcross = 0.0;

                if (ReadOrdinate(PathData, Ordinal, ReadAcross))
                {
                    AcrossOrdinate = Relative ? Reading.Position.PositionY + ReadAcross : ReadAcross;
                    SegmentRead    = true;
                }
            }

            if (SegmentRead)
            {
                Placed.Subject  = SegmentSubject::Line;
                Placed.Terminus = { AlongOrdinate, AcrossOrdinate };

                Reading.CubicPreceding     = false;
                Reading.QuadraticPreceding = false;
            }
        }
        else if (Absolute == 'C' || Absolute == 'S')
        {
            PlanarPosition  FirstControl  = Reading.Position;
            PlanarPosition  SecondControl = {};
            PlanarPosition  Terminus      = {};

            bool Occupied = true;

            if (Absolute == 'C')
            {
                double FirstAlong = 0.0, FirstAcross = 0.0;

                Occupied = ReadOrdinate(PathData, Ordinal, FirstAlong) && ReadOrdinate(PathData, Ordinal, FirstAcross);

                FirstControl = { Relative ? Reading.Position.PositionX + FirstAlong  : FirstAlong,
                                 Relative ? Reading.Position.PositionY + FirstAcross : FirstAcross };
            }
            else
            {
                // 📝 A smooth continuation reflects the preceding control through the current position. Where
                //    nothing cubic preceded it, the grammar declares the current position itself — so a smooth
                //    curve opening a run is a straight departure rather than an invented curvature.
                FirstControl = Reading.CubicPreceding
                             ? PlanarPosition{ 2.0 * Reading.Position.PositionX - Reading.LastControl.PositionX,
                                               2.0 * Reading.Position.PositionY - Reading.LastControl.PositionY }
                             : Reading.Position;
            }

            double SecondAlong = 0.0, SecondAcross = 0.0, TerminusAlong = 0.0, TerminusAcross = 0.0;

            Occupied = Occupied
                    && ReadOrdinate(PathData, Ordinal, SecondAlong)   && ReadOrdinate(PathData, Ordinal, SecondAcross)
                    && ReadOrdinate(PathData, Ordinal, TerminusAlong) && ReadOrdinate(PathData, Ordinal, TerminusAcross);

            if (Occupied)
            {
                SecondControl = { Relative ? Reading.Position.PositionX + SecondAlong  : SecondAlong,
                                  Relative ? Reading.Position.PositionY + SecondAcross : SecondAcross };
                Terminus      = { Relative ? Reading.Position.PositionX + TerminusAlong  : TerminusAlong,
                                  Relative ? Reading.Position.PositionY + TerminusAcross : TerminusAcross };

                Placed.Subject       = SegmentSubject::Cubic;
                Placed.FirstControl  = FirstControl;
                Placed.SecondControl = SecondControl;
                Placed.Terminus      = Terminus;

                Reading.LastControl        = SecondControl;
                Reading.CubicPreceding     = true;
                Reading.QuadraticPreceding = false;

                SegmentRead = true;
            }
        }
        else if (Absolute == 'Q' || Absolute == 'T')
        {
            PlanarPosition  Control  = Reading.Position;
            PlanarPosition  Terminus = {};

            bool Occupied = true;

            if (Absolute == 'Q')
            {
                double ControlAlong = 0.0, ControlAcross = 0.0;

                Occupied = ReadOrdinate(PathData, Ordinal, ControlAlong) && ReadOrdinate(PathData, Ordinal, ControlAcross);

                Control = { Relative ? Reading.Position.PositionX + ControlAlong  : ControlAlong,
                            Relative ? Reading.Position.PositionY + ControlAcross : ControlAcross };
            }
            else
            {
                Control = Reading.QuadraticPreceding
                        ? PlanarPosition{ 2.0 * Reading.Position.PositionX - Reading.LastControl.PositionX,
                                          2.0 * Reading.Position.PositionY - Reading.LastControl.PositionY }
                        : Reading.Position;
            }

            double TerminusAlong = 0.0, TerminusAcross = 0.0;

            Occupied = Occupied && ReadOrdinate(PathData, Ordinal, TerminusAlong)
                                && ReadOrdinate(PathData, Ordinal, TerminusAcross);

            if (Occupied)
            {
                Terminus = { Relative ? Reading.Position.PositionX + TerminusAlong  : TerminusAlong,
                             Relative ? Reading.Position.PositionY + TerminusAcross : TerminusAcross };

                Placed.Subject      = SegmentSubject::Quadratic;
                Placed.FirstControl = Control;
                Placed.Terminus     = Terminus;

                Reading.LastControl        = Control;
                Reading.CubicPreceding     = false;
                Reading.QuadraticPreceding = true;

                SegmentRead = true;
            }
        }
        else if (Absolute == 'A')
        {
            double RadiusAlong = 0.0, RadiusAcross = 0.0, Rotation = 0.0;
            double TerminusAlong = 0.0, TerminusAcross = 0.0;
            bool   LargeArc = false, Sweep = false;

            const bool Occupied = ReadOrdinate(PathData, Ordinal, RadiusAlong)
                               && ReadOrdinate(PathData, Ordinal, RadiusAcross)
                               && ReadOrdinate(PathData, Ordinal, Rotation)
                               && ReadFlag(PathData, Ordinal, LargeArc)
                               && ReadFlag(PathData, Ordinal, Sweep)
                               && ReadOrdinate(PathData, Ordinal, TerminusAlong)
                               && ReadOrdinate(PathData, Ordinal, TerminusAcross);

            if (Occupied)
            {
                Placed.Subject         = SegmentSubject::Arc;
                Placed.RadiusAlong     = RadiusAlong;
                Placed.RadiusAcross    = RadiusAcross;
                Placed.Rotation        = Rotation;
                Placed.LargeArcEnabled = LargeArc;
                Placed.SweepEnabled    = Sweep;
                Placed.Terminus        = { Relative ? Reading.Position.PositionX + TerminusAlong  : TerminusAlong,
                                           Relative ? Reading.Position.PositionY + TerminusAcross : TerminusAcross };

                Reading.CubicPreceding     = false;
                Reading.QuadraticPreceding = false;

                SegmentRead = true;
            }
        }

        if (!SegmentRead)
        {
            break;
        }

        Constructing.Segments.push_back(Placed);
        Reading.Position = Placed.Terminus;
    }

    SealPath();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ELEMENTS AND ATTRIBUTES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Reads one attribute's value out of an element's own text, empty where the element declares none.
std::string AttributeValue(const std::string& Element, const char* Attribute)
{
    const std::string  Wanted   = std::string(Attribute) + "=";
    std::size_t        Ordinal  = Element.find(Wanted);

    while (Ordinal != std::string::npos)
    {
        // 📝 The preceding character must be a separator, so `fill` does not match inside `fill-rule`.
        const bool Delimited = Ordinal == 0u || Whitespace(Element[Ordinal - 1u]);

        if (Delimited)
        {
            std::size_t Beginning = Ordinal + Wanted.size();

            if (Beginning < Element.size() && (Element[Beginning] == '"' || Element[Beginning] == '\''))
            {
                const char        Quoting = Element[Beginning];
                const std::size_t Ending  = Element.find(Quoting, Beginning + 1u);

                if (Ending != std::string::npos)
                {
                    return Element.substr(Beginning + 1u, Ending - Beginning - 1u);
                }
            }
        }

        Ordinal = Element.find(Wanted, Ordinal + 1u);
    }

    return std::string();
}

/// 🧩 Whether an element's opening tag names one spelling.
bool ElementNamed(const std::string& Element, const char* Spelling)
{
    const std::size_t Spanned = std::strlen(Spelling);

    if (Element.size() < Spanned) { return false; }

    if (Element.compare(0u, Spanned, Spelling) != 0) { return false; }

    if (Element.size() == Spanned) { return true; }

    const char Following = Element[Spanned];

    return Whitespace(Following) || Following == '/' || Following == '>';
}

/// 🧩 Translates one whole vector source, whichever route it arrived by.
Deliver<DecodedOutline> TranslateSource(const std::string& Source)
{
    DecodedOutline Produced;

    std::size_t Ordinal = 0u;

    while (Ordinal < Source.size())
    {
        const std::size_t Opening = Source.find('<', Ordinal);

        if (Opening == std::string::npos) { break; }

        const std::size_t Closing = Source.find('>', Opening);

        if (Closing == std::string::npos) { break; }

        const std::string Element = Source.substr(Opening + 1u, Closing - Opening - 1u);

        Ordinal = Closing + 1u;

        if (Element.empty() || Element[0] == '/' || Element[0] == '?' || Element[0] == '!') { continue; }

        // 🔴 `52` §2: a refusal names the construct **and the position in the source**. "Unsupported" with no
        //    position sends the artist to search a file they did not write.
        bool Declined = false;

        for (const RefusedElement& Refusing : RefusedElements)
        {
            if (ElementNamed(Element, Refusing.Spelling))
            {
                RefusedConstruct Recording;
                Recording.Construct     = Refusing.Spelling;
                Recording.SourceOrdinal = static_cast<std::uint32_t>(Opening);
                Recording.Declining     = { Refusing.Reason, Refusing.Detail };

                Produced.Refused.push_back(Recording);

                Declined = true;
                break;
            }
        }

        if (Declined || !ElementNamed(Element, "path")) { continue; }

        const std::string PathData = AttributeValue(Element, "d");

        if (PathData.empty()) { continue; }

        const std::string  DeclaredRule = AttributeValue(Element, "fill-rule");
        const FillRule     Rule         = DeclaredRule == "evenodd" ? FillRule::EvenOdd : FillRule::NonZero;

        const std::string  Stroked = AttributeValue(Element, "stroke");

        if (!Stroked.empty() && Stroked != "none")
        {
            RefusedConstruct Recording;
            Recording.Construct     = "stroke";
            Recording.SourceOrdinal = static_cast<std::uint32_t>(Opening);
            Recording.Declining     = { RefusalReason::ContentUnsupported, StrokedDetail };

            Produced.Refused.push_back(Recording);
        }

        TranslatePathData(PathData, Rule, Produced.Declared.Paths);
    }

    if (Produced.Declared.Paths.empty())
    {
        return Deliver<DecodedOutline>::Refuse(
            { RefusalReason::ContentUnsupported, "the vector stream declares no path the accepted subset takes" });
    }

    // 🔴 `36` §1: no colour is declared here. A vector source's own fill is a presentation the artist may
    //    replace, and a colour without its space is a number three subsystems each interpret differently.
    Produced.Declared.ColourDeclared = false;

    return Deliver<DecodedOutline>::Deliver(Produced);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE TRANSLATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<DecodedOutline> Translate(const std::vector<std::uint8_t>& Stream, const std::string& OriginPath)
{
    if (Stream.empty())
    {
        return Deliver<DecodedOutline>::Refuse(
            { RefusalReason::ContentUnsupported, "a vector stream of no bytes carries no outline" });
    }

    const std::string Source(reinterpret_cast<const char*>(Stream.data()), Stream.size());

    Deliver<DecodedOutline> Produced = TranslateSource(Source);

    if (Produced.ContentPresent)
    {
        Produced.Delivered.Declared.OriginPath = OriginPath;
    }

    return Produced;
}

Deliver<DecodedOutline> TranslateText(const std::string& SourceText)
{
    if (SourceText.empty())
    {
        return Deliver<DecodedOutline>::Refuse(
            { RefusalReason::ContentUnsupported, "a supplied vector source of no text carries no outline" });
    }

    Deliver<DecodedOutline> Produced = TranslateSource(SourceText);

    // 🔴 `52` §1: the text is retained, because there is no file to re-read. A source whose only copy was a
    //    clipboard is unrecoverable after a reopen, and the artist reads that as the document having lost
    //    their work rather than as the source never having been storable in the first place.
    if (Produced.ContentPresent)
    {
        Produced.Delivered.Declared.SourceText = SourceText;
    }

    return Produced;
}

}   // namespace Slate
