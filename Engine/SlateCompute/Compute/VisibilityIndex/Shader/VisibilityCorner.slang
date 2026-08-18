//============================================================================================================================================
//                                                           VISIBILITYCORNER.SLANG
//============================================================================================================================================
// 🧩 The vertex half of `16` §3's hardware raster — one triangle corner resolved from the declared spans and projected.

#include "SlateCompute/Compute/VisibilityIndex/Shader/VisibilityUniform.slang"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

// 📝 🔴 No vertex input declaration and none may be — `16` §4's raster reads positions and ordinals from declared
//    spans by the vertex ordinal. One program then serves every partitioning without a per-topology input
//    declaration, and the attribute set stays out of a document that writes no attribute.
//
// ⚠️ The four are declared in the set order `ProgramIndex::ReachLayout` resolves — position in the run is the set
//    ordinal the host declares, so a span moved here without its declaration moving with it is read as another.
//
// 🔴 The corner ordinal reaches the triangle through `SurvivingTriangles` and never directly. `16` §2 records the
//    draw from the device, so the corners an indirect draw issues are contiguous from nought over whatever
//    survived the cull — and the triangle standing at that position is the one the compaction wrote there. Reading
//    `DrawnTriangles` by the corner ordinal instead would draw the first N triangles of the run whatever was
//    culled, which is an image that is correct only while nothing is occluded.
ConstantBuffer<VisibilityUniform>  Projecting          ;
StructuredBuffer<ObjectPosition>   ObjectPositions     ;
StructuredBuffer<DrawnTriangle>    DrawnTriangles      ;
StructuredBuffer<Unsigned32>       SurvivingTriangles  ;

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Resolves one triangle corner from the declared spans and projects it.
/// in    VertexOrdinal   [-]  the running corner ordinal; three per drawn triangle
/// out   ResolvedCorner  [-]  the clip position and the two ordinals the fragment writes
/// note  🔴 The corner is reached by division and remainder rather than through an index span, because the host
///         has already fanned every n-gon into the triangle run. `10` admits faces of any corner count and `16`
///         §1 partitions them by the fan count, so a triangle here is a triangle and never a face — the two agree
///         only because `PartitionStructure` counts the fan triangles the spanned faces amount to.
/// note  ⚠️ The vendor supplies no bound on either span read. A drawn count exceeding what the spans carry is
///         refused by the host at the recording rather than clamped here, because a clamp resolves the wrong
///         triangle at every invocation past the end and reads as geometry rather than as the refusal it is.
/// note  🔴 The **indirection** through the surviving run is what makes one program serve both the direct draw
///         and the indirect one. `16` §2's cull compacts the survivors and the host writes the whole run through
///         where no cull ran, so the direct case is the identity permutation rather than a second entry point —
///         and a second entry point is the copy that eventually disagrees about the corner arithmetic.
/// cost  ✔️
/// tag   nonallocating, nonthrowing
[shader("vertex")]
ResolvedCorner ResolveVisibilityCorner(Unsigned32 VertexOrdinal : SV_VertexID)
{
    const Unsigned32 SurvivingEntry = VertexOrdinal / 3u;
    const Unsigned32 CornerEntry    = VertexOrdinal % 3u;

    const DrawnTriangle Drawn = DrawnTriangles[SurvivingTriangles[SurvivingEntry]];

    Unsigned32 VertexEntry = Drawn.CornerVertex0;

    if (CornerEntry == 1u)
        VertexEntry = Drawn.CornerVertex1;
    else if (CornerEntry == 2u)
        VertexEntry = Drawn.CornerVertex2;

    ResolvedCorner Resolved;

    Resolved.ClipPosition     = ProjectObjectPosition(Projecting, ObjectPositions[VertexEntry]);
    Resolved.PartitionOrdinal = Drawn.PartitionOrdinal;
    Resolved.TriangleOrdinal  = Drawn.TriangleOrdinal;

    return Resolved;
}

}   // namespace Slate
