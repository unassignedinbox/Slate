// ShadowProbeRecord — the host ↔ kernel contract of the shadow/traversal diagnostic at compute binding 31.
//
// WHY THIS EXISTS (the 2026-09 shadow hunt). Every shadow proof this engine ships runs in the CPU mirror
//    (Projects/Project-Zero/Host/MaterialLevelViewport.cpp) or in the C++ harness — never against the SPIR-V
//    the user's GPU actually executes. The live app can therefore lose shadows while every gate stays green:
//    a store-side bug (a descriptor pointing at freed memory, a struct-stride drift, a push-constant offset
//    shift, a traversal that exits early on one driver's NaN rules) leaves the raster-fed primary image
//    untouched and the mirror has no way to see it. This buffer lets the GPU answer, with its own traversal,
//    questions whose answers the CPU already knows:
//
//      ① known rays — host-composed world-space rays whose occlusion the CPU structures (TraversalIndex /
//         InstanceAcceleration) have already decided; the kernel re-answers them through the SAME TraceShadow()
//         the lighting uses, and the host compares. A disagreement here IS the no-shadow bug, located.
//      ② blob echo — the first words of the CWBVH node/leaf blobs, the TLAS root and instance row 0 as the
//         KERNEL sees them, compared byte-for-byte against the host's copies. Catches upload/descriptor/stride
//         corruption even on a scene where every probe ray happens to pass.
//      ③ push echo — the push constants exactly as the kernel reads them (feature flags, TlasInstanceCount,
//         luminaire count, viewport). Catches a push-block offset drift in one number instead of a week.
//      ④ counters — per-type tallies (candidates drawn / selected / shadow rays traced / rays blocked),
//         atomicAdded by the lighting path while armed. "Rays traced: 4.7 M, blocked: 0" and "rays traced: 0"
//         are different bugs with different fixes; this tells them apart on the user's machine.
//
// The cost when disarmed (the shipped state) is one magic-word comparison at one invocation.
//
// LAYOUT — one uint32 word array, offsets mirrored by the constants in ReSTIRViewport.slang. Both sides must
//    change together; nothing here is packed or aligned beyond the 4-byte word, so std430 and C++ agree by
//    construction. The buffer is host-visible + coherent: the host writes the input page before arming the
//    feature bit, the kernel writes results once and flips the magic word, the host reads after the armed
//    frame's fence has been waited (GameExecution polls two frames later).
#pragma once

#include <cstdint>

namespace Frontier
{
    // ── Page geometry ────────────────────────────────────────────────────────────────────────────────────
    inline constexpr uint32_t kShadowProbeRayCapacity = 8u;      // [cnt] input rays the page holds
    inline constexpr uint32_t kShadowProbeWords       = 256u;    // [u32] whole page (1 KiB)
    inline constexpr uint32_t kShadowProbeBytes       = kShadowProbeWords * 4u;

    // ── Header words ─────────────────────────────────────────────────────────────────────────────────────
    inline constexpr uint32_t kShadowProbeWordMagic     = 0u;    // armed → kernel fills → done (host reads)
    inline constexpr uint32_t kShadowProbeWordRayCount  = 1u;    // [cnt] valid input rays (≤ capacity)
    inline constexpr uint32_t kShadowProbeWordExpectMask= 2u;    // [bit] bit r = CPU expects ray r occluded
    inline constexpr uint32_t kShadowProbeWordNodeWords = 4u;    // [u32] echo words available in CwbvhNodes (≤20)
    inline constexpr uint32_t kShadowProbeWordLeafWords = 5u;    // [u32] echo words available in CwbvhTris  (≤12)
    inline constexpr uint32_t kShadowProbeWordTlasWords = 6u;    // [u32] echo words available in TlasNodes  (≤8)
    inline constexpr uint32_t kShadowProbeWordInstWords = 7u;    // [u32] echo words available in instance row 0 (≤28)

    inline constexpr uint32_t kShadowProbeMagicArmed = 0x5AFE0001u;   // host → kernel: please answer the page
    inline constexpr uint32_t kShadowProbeMagicDone  = 0x5AFE0002u;   // kernel → host: answers are complete
    inline constexpr uint32_t kShadowProbeMagicIdle  = 0u;

    // ── Input rays: 8 × 8 words = {origin.xyz, 0, target.xyz, expectedOccluded} at words 8..71 ────────────
    inline constexpr uint32_t kShadowProbeWordRayIn    = 8u;
    inline constexpr uint32_t kShadowProbeRayInStride  = 8u;

    // ── Per-ray answers: 8 × 4 words = {blocked, closestT bits (0xFFFFFFFF if none), closest primitive, hitValid}
    //       at words 72..103 ───────────────────────────────────────────────────────────────────────────────
    inline constexpr uint32_t kShadowProbeWordRayOut   = 72u;
    inline constexpr uint32_t kShadowProbeRayOutStride = 4u;

    // ── Push-constant echo: 16 words at 104..119 (what the kernel ACTUALLY sees) ─────────────────────────
    inline constexpr uint32_t kShadowProbeWordPushEcho = 104u;
    //   +0 FeatureFlags · +1 TlasInstanceCount · +2 LightTriangleCount · +3 AlphaMaskedMaterialCount
    //   +4 ViewportWidth · +5 ViewportHeight · +6 FrameIndex · +7 SpatialTapCount · +8 SamplesPerPixel
    //   +9..15 reserved (0)

    // ── Blob echoes at 120..187 (node 20 · leaf 12 · TLAS root 8 · instance row 0 — 28 words = 112 B) ─────
    inline constexpr uint32_t kShadowProbeWordNodeEcho = 120u;   // 20 words: CwbvhNodes[0..4]
    inline constexpr uint32_t kShadowProbeWordLeafEcho = 140u;   // 12 words: CwbvhTris[0..2]
    inline constexpr uint32_t kShadowProbeWordTlasEcho = 152u;   //  8 words: TlasNodes[0]
    inline constexpr uint32_t kShadowProbeWordInstEcho = 160u;   // 28 words: TlasInstances[0] (112 B record)

    // ── Counters: 32 words at 188..219, atomicAdd'ed by the lighting path while the counter bit is set ─────
    inline constexpr uint32_t kShadowProbeWordCounters = 188u;
    inline constexpr uint32_t kShadowProbeCounterCandSun      = 0u;   // direct candidates drawn: sun
    inline constexpr uint32_t kShadowProbeCounterCandMesh     = 1u;   // direct candidates drawn: emissive mesh
    inline constexpr uint32_t kShadowProbeCounterSelectedSun  = 2u;   // RIS selections: sun
    inline constexpr uint32_t kShadowProbeCounterSelectedMesh = 3u;   // RIS selections: mesh
    inline constexpr uint32_t kShadowProbeCounterRaysSun      = 4u;   // shadow rays traced toward a sun sample
    inline constexpr uint32_t kShadowProbeCounterRaysMesh     = 5u;   // shadow rays traced toward a mesh sample
    inline constexpr uint32_t kShadowProbeCounterBlockedSun   = 6u;   // …of which the occluder was found
    inline constexpr uint32_t kShadowProbeCounterBlockedMesh  = 7u;
    inline constexpr uint32_t kShadowProbeCounterSpatialLate  = 8u;   // spatial winners the late current-pixel
                                                                      //    visibility recheck rejected (R11)
    inline constexpr uint32_t kShadowProbeCounterWords        = 32u;

    // ── Feature bits (mirror kFeatureShadow* in ReSTIRViewport.slang and DispatchFeature in SwapchainExchange.h) ──
    inline constexpr uint32_t kShadowProbeFeatureProbe    = 1u << 10;   // run the probe block at invocation (0,0)
    inline constexpr uint32_t kShadowProbeFeatureCounters = 1u << 11;   // per-pixel atomic tallies while armed
}
