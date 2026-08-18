//============================================================================================================================================
//                                                            TOPOLOGYCODEC.CPP
//============================================================================================================================================
// 🧩 `10` §1 — polygon streams translated exactly as the file wrote them, n-gons and degeneracies included.

#include "SlateDocument/Format/TopologyCodec/Api/TopologyCodec.h"

#include <cstddef>
#include <cstring>

#pragma warning(push, 0)
#define FAST_OBJ_IMPLEMENTATION
#include "fast_obj/fast_obj.h"
#pragma warning(pop)

namespace Slate
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE STREAM READ
//------------------------------------------------------------------------------------------------------------------------

// 📝 🔴 The vendored parser reads through callbacks it invokes with a path, and the stream has already been
//    drained by `04`'s `StorageExchange`. Rather than write the bytes back out to a file for it to reopen, the
//    callbacks are satisfied from the drained stream directly: the open reports the one stream this codec holds
//    and every other path — a material library the file references — reports absent. That is deliberate. `10`
//    §1's codec translates the stream it was handed and does not go and read further files on the artist's
//    behalf; a codec that opened whatever a stream named would follow a path out of the document's own folder.
struct StreamReading
{
    const std::vector<std::uint8_t>*  Stream   = nullptr;   // [-] - the drained stream, never owned here
    std::size_t                       Consumed = 0u;        // [B] - how far the parser has read
    bool                              Occupied = false;     // [-] - the one open stream is already taken
};

void* StreamOpen(const char* Path, void* Reading)
{
    (void)Path;

    StreamReading* const Held = static_cast<StreamReading*>(Reading);

    if (Held == nullptr || Held->Occupied) { return nullptr; }

    Held->Occupied = true;
    Held->Consumed = 0u;

    return Held;
}

void StreamClose(void* Stream, void* Reading)
{
    (void)Stream;

    StreamReading* const Held = static_cast<StreamReading*>(Reading);

    if (Held != nullptr) { Held->Occupied = false; }
}

std::size_t StreamRead(void* Stream, void* Landing, std::size_t Wanted, void* Reading)
{
    (void)Stream;

    StreamReading* const Held = static_cast<StreamReading*>(Reading);

    if (Held == nullptr || Held->Stream == nullptr) { return 0u; }

    const std::size_t Remaining = Held->Stream->size() - Held->Consumed;
    const std::size_t Delivered = Wanted < Remaining ? Wanted : Remaining;

    if (Delivered > 0u)
    {
        std::memcpy(Landing, Held->Stream->data() + Held->Consumed, Delivered);
        Held->Consumed += Delivered;
    }

    return Delivered;
}

unsigned long StreamSpanned(void* Stream, void* Reading)
{
    (void)Stream;

    const StreamReading* const Held = static_cast<const StreamReading*>(Reading);

    if (Held == nullptr || Held->Stream == nullptr) { return 0ul; }

    return static_cast<unsigned long>(Held->Stream->size());
}

/// 🧩 Whether an origin's suffix matches one declared spelling, compared without regard to case.
bool SuffixMatches(const std::string& OriginPath, const char* Suffix)
{
    const std::size_t Spanned = std::strlen(Suffix);

    if (OriginPath.size() < Spanned) { return false; }

    const std::size_t Beginning = OriginPath.size() - Spanned;

    for (std::size_t Ordinal = 0u; Ordinal < Spanned; ++Ordinal)
    {
        char Carried = OriginPath[Beginning + Ordinal];

        if (Carried >= 'A' && Carried <= 'Z')
        {
            Carried = static_cast<char>(Carried - 'A' + 'a');
        }

        if (Carried != Suffix[Ordinal]) { return false; }
    }

    return true;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

TopologyContentSubject ClassifyContent(const std::string& OriginPath)
{
    if (SuffixMatches(OriginPath, ".obj")) { return TopologyContentSubject::Wavefront; }

    return TopologyContentSubject::Unrecognised;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE TRANSLATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<DecodedTopology> Translate(const std::vector<std::uint8_t>& Stream, const std::string& OriginPath)
{
    if (ClassifyContent(OriginPath) == TopologyContentSubject::Unrecognised)
    {
        return Deliver<DecodedTopology>::Refuse(
            { RefusalReason::ContentUnsupported, "the origin names no accepted polygon layout — `10` §1" });
    }

    if (Stream.empty())
    {
        return Deliver<DecodedTopology>::Refuse(
            { RefusalReason::ContentUnsupported, "a polygon stream of no bytes carries no topology" });
    }

    StreamReading Reading;
    Reading.Stream = &Stream;

    fastObjCallbacks Reaching;
    Reaching.file_open  = StreamOpen;
    Reaching.file_close = StreamClose;
    Reaching.file_read  = StreamRead;
    Reaching.file_size  = StreamSpanned;

    fastObjMesh* const Parsed = fast_obj_read_with_callbacks(OriginPath.c_str(), &Reaching, &Reading);

    if (Parsed == nullptr)
    {
        return Deliver<DecodedTopology>::Refuse(
            { RefusalReason::ContentUnsupported, "the parser declined the polygon stream" });
    }

    if (Parsed->face_count == 0u)
    {
        fast_obj_destroy(Parsed);

        return Deliver<DecodedTopology>::Refuse(
            { RefusalReason::ExtentExhausted, "the polygon stream declares no face — `10` §1" });
    }

    DecodedTopology Produced;

    // 📝 The parser reserves ordinal zero of every attribute array as a sentinel meaning "absent", so the
    //    positions below begin at one and every index read from a corner is compared against zero first.
    Produced.Positions.reserve(Parsed->position_count > 0u ? Parsed->position_count - 1u : 0u);

    for (unsigned int Ordinal = 1u; Ordinal < Parsed->position_count; ++Ordinal)
    {
        DocumentPosition Placed;
        Placed.PositionX = static_cast<double>(Parsed->positions[Ordinal * 3u + 0u]);
        Placed.PositionY = static_cast<double>(Parsed->positions[Ordinal * 3u + 1u]);
        Placed.PositionZ = static_cast<double>(Parsed->positions[Ordinal * 3u + 2u]);

        Produced.Positions.push_back(Placed);
    }

    // 🔴 `50` §2 ①: every face is carried over as the run of corners the file wrote, in the file's own winding
    //    and at whatever corner count it used. A run of fewer than three corners is handed over intact and
    //    refused by `TopologyStructure::DeclareFace`, which is where that refusal is declared to happen —
    //    dropping it here would produce a topology that no longer describes the file the artist supplied.
    Produced.Faces.reserve(Parsed->face_count);
    Produced.CornerCoordinates.reserve(Parsed->index_count);
    Produced.MaterialEnrollment.reserve(Parsed->face_count);

    bool CoordinatesComplete   = Parsed->texcoord_count > 1u;
    bool PerpendicularsPerFace = false;

    std::vector<SurfaceDirection>  PerVertexPerpendiculars;
    std::vector<bool>              PerpendicularOccupied;

    if (Parsed->normal_count > 1u)
    {
        PerVertexPerpendiculars.resize(Produced.Positions.size());
        PerpendicularOccupied.resize(Produced.Positions.size(), false);
    }

    unsigned int CornerOrdinal = 0u;

    for (unsigned int FaceOrdinal = 0u; FaceOrdinal < Parsed->face_count; ++FaceOrdinal)
    {
        const unsigned int CornerCount = Parsed->face_vertices[FaceOrdinal];

        std::vector<std::uint32_t> CornerVertices;
        CornerVertices.reserve(CornerCount);

        for (unsigned int Within = 0u; Within < CornerCount; ++Within)
        {
            const fastObjIndex Addressed = Parsed->indices[CornerOrdinal + Within];

            CornerVertices.push_back(Addressed.p > 0u ? static_cast<std::uint32_t>(Addressed.p - 1u) : 0u);

            DomainCoordinate Placed;

            if (Addressed.t > 0u && Addressed.t < Parsed->texcoord_count)
            {
                Placed.CoordinateAlong  = Parsed->texcoords[Addressed.t * 2u + 0u];
                Placed.CoordinateAcross = Parsed->texcoords[Addressed.t * 2u + 1u];
            }
            else
            {
                CoordinatesComplete = false;
            }

            Produced.CornerCoordinates.push_back(Placed);

            // 🔴 A perpendicular is retained only where every corner addressing a vertex agrees on which one it
            //    is. `TopologyStructure` holds them per vertex, so a stream splitting them per corner has more
            //    of them than there is storage for — and averaging or picking one is a repair. Where they
            //    disagree, none survives and the construct is named for `86` to report.
            if (Addressed.n > 0u && Addressed.n < Parsed->normal_count && !PerVertexPerpendiculars.empty())
            {
                const std::uint32_t  VertexOrdinal = CornerVertices.back();

                if (VertexOrdinal < PerVertexPerpendiculars.size())
                {
                    SurfaceDirection Arriving;
                    Arriving.DirectionX = Parsed->normals[Addressed.n * 3u + 0u];
                    Arriving.DirectionY = Parsed->normals[Addressed.n * 3u + 1u];
                    Arriving.DirectionZ = Parsed->normals[Addressed.n * 3u + 2u];

                    if (!PerpendicularOccupied[VertexOrdinal])
                    {
                        PerVertexPerpendiculars[VertexOrdinal] = Arriving;
                        PerpendicularOccupied[VertexOrdinal]   = true;
                    }
                    else
                    {
                        const SurfaceDirection Held = PerVertexPerpendiculars[VertexOrdinal];

                        if (Held.DirectionX != Arriving.DirectionX
                         || Held.DirectionY != Arriving.DirectionY
                         || Held.DirectionZ != Arriving.DirectionZ)
                        {
                            PerpendicularsPerFace = true;
                        }
                    }
                }
            }
        }

        Produced.Faces.push_back(CornerVertices);
        Produced.MaterialEnrollment.push_back(static_cast<std::uint32_t>(Parsed->face_materials[FaceOrdinal]));

        CornerOrdinal += CornerCount;
    }

    if (!CoordinatesComplete)
    {
        Produced.CornerCoordinates.clear();
    }

    if (PerpendicularsPerFace)
    {
        Produced.UnsupportedNamed.push_back("per-corner surface perpendiculars");
    }
    else
    {
        for (std::size_t Ordinal = 0u; Ordinal < PerVertexPerpendiculars.size(); ++Ordinal)
        {
            if (!PerpendicularOccupied[Ordinal])
            {
                PerVertexPerpendiculars.clear();
                break;
            }
        }

        Produced.Perpendiculars = PerVertexPerpendiculars;
    }

    // 📝 A tangent basis is never derived here. `38` §4 derives one where the source supplied none, and a
    //    derived basis arriving through a codec would be indistinguishable from an authored one — which is
    //    precisely the distinction `TopologyStructure::DeclareTangentBases` exists to keep.

    Produced.OriginPath        = OriginPath;
    Produced.UnitScale         = 1.0;
    Produced.UnitScaleDeclared = false;

    fast_obj_destroy(Parsed);

    return Deliver<DecodedTopology>::Deliver(Produced);
}

}   // namespace Slate
