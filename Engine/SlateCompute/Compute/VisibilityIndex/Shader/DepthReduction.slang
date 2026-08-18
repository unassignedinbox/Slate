//============================================================================================================================================
//                                                          DEPTHREDUCTION.SLANG
//============================================================================================================================================
// 🧩 `16` §2 ② — one dispatch per level, reducing the depth target and then the chain into its own coarser levels.

#include "SlateCompute/Compute/VisibilityIndex/Shader/OcclusionUniform.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                      WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

[[vk::binding(0, 0)]] ConstantBuffer<ReductionUniform>  Reducing;
[[vk::binding(1, 0)]] Texture2D<float>                  DepthTarget;
[[vk::binding(2, 0)]] RWStructuredBuffer<float>         Chain;

// 📝 The depth target is bound at every level and read only at the finest. The entry point names it statically,
//    so the vendor requires it present regardless of which level is dispatching.

//------------------------------------------------------------------------------------------------------------------------
//                                                    ONE SOURCE TEXEL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One ordinate of the level above, or of the depth target at the finest level.
/// note  📝 The two sources are read through one routine so the reduction body is written once. Branching per
///        texel costs nothing measurable — the condition is uniform across the whole dispatch.
float SourceAt(uint Along, uint Across)
{
    if (Reducing.SourceFromTarget != 0u)
    {
        return DepthTarget.Load(int3(int(Along), int(Across), 0)).x;
    }

    return Chain[Reducing.SourceOffset + Across * Reducing.SourceAlong + Along];
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REDUCTION
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 Two by two and no more, which is exactly sufficient because the halving rounds **up**. A source of extent
//    five reduces to three: target nought reads {0,1}, one reads {2,3}, two reads {4} alone. Every source texel
//    is covered by exactly one target texel, so no third tap is needed and none is taken.
//
// 🔴 The reduction is the **minimum**, because depth is reversed. The least ordinate across a region is its
//    furthest point, and a partition whose nearest ordinate is below it cannot reach past anything recorded
//    there. Reducing by maximum instead is correct wherever the surface is flat and rejects visible geometry at
//    every silhouette — which the artist meets as an object flickering along its own edge.

[shader("compute")]
[numthreads(8, 8, 1)]
void main(uint3 Dispatched : SV_DispatchThreadID)
{
    const uint WrittenAlong  = Dispatched.x;
    const uint WrittenAcross = Dispatched.y;

    // 📝 The dispatch extent is rounded up, so the tail invocations of the last group address texels the level
    //    does not carry. Discarding them here is what lets one workgroup extent serve a level of one texel and a
    //    level of thousands.
    if (WrittenAlong >= Reducing.WrittenAlong || WrittenAcross >= Reducing.WrittenAcross)
    {
        return;
    }

    const uint FirstAlong  = WrittenAlong  * 2u;
    const uint FirstAcross = WrittenAcross * 2u;

    float Reduced = SourceAt(FirstAlong, FirstAcross);

    if (FirstAlong + 1u < Reducing.SourceAlong)
    {
        Reduced = min(Reduced, SourceAt(FirstAlong + 1u, FirstAcross));
    }

    if (FirstAcross + 1u < Reducing.SourceAcross)
    {
        Reduced = min(Reduced, SourceAt(FirstAlong, FirstAcross + 1u));

        if (FirstAlong + 1u < Reducing.SourceAlong)
        {
            Reduced = min(Reduced, SourceAt(FirstAlong + 1u, FirstAcross + 1u));
        }
    }

    Chain[Reducing.WrittenOffset + WrittenAcross * Reducing.WrittenAlong + WrittenAlong] = Reduced;
}
