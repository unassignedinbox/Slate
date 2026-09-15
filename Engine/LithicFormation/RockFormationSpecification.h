//============================================================================================================================================
//                                                      ROCKFORMATIONSPECIFICATION.H
//============================================================================================================================================
// 🧩 Hardcoded lithology presets — the single source of truth for every SDF, material, and physics constant.
//    Values are measured geology (see GeologicalRockSculpt/Research.md), not tunables. Derived coefficients are
//    computed, not eyeballed. Both the CPU SDF (RockFormationSpace) and the GPU twin (RockFormation.slang) include
//    this file via codegen — change one place, change all.
//
// Units: density [g/cm³], hardness [Mohs], porosity [%], grain [mm], strength [MPa], distances [m], erosionRate [-].

#pragma once

#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                   LITHOLOGY CATEGORY
//------------------------------------------------------------------------------------------------------------------------

enum class LithologyCategory : uint32_t
{
    GraniteCore     = 0u,   // intrusive phaneritic, massive
    GranitePorphyry = 1u,   // porphyritic 2-stage cooling
    BasaltColumnar  = 2u,   // extrusive columnar jointed
    SandstoneBuff   = 3u,   // aeolian quartz arenite
    SandstoneRed    = 4u,   // fluvial Fe-cemented
    LimestoneKarst  = 5u,   // soluble carbonate
    ShaleSlate      = 6u,   // fissile mudstone → slate
    GneissBanded    = 7u,   // high-grade banded
    Quartzite       = 8u,   // meta-quartz
    Count           = 9u
};

[[nodiscard]] inline const char* LithologyName(LithologyCategory C) noexcept
{
    switch (C)
    {
        case LithologyCategory::GraniteCore:     return "Granite — Core (Intrusive)";
        case LithologyCategory::GranitePorphyry: return "Granite — Porphyry";
        case LithologyCategory::BasaltColumnar:  return "Basalt — Columnar";
        case LithologyCategory::SandstoneBuff:   return "Sandstone — Buff (Aeolian)";
        case LithologyCategory::SandstoneRed:    return "Sandstone — Red (Fluvial)";
        case LithologyCategory::LimestoneKarst:  return "Limestone — Karst";
        case LithologyCategory::ShaleSlate:      return "Shale → Slate (Fissile)";
        case LithologyCategory::GneissBanded:    return "Gneiss — Banded (Foliated)";
        case LithologyCategory::Quartzite:       return "Quartzite (Meta)";
        default:                                 return "Unknown";
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 LITHOLOGY PRESET
//------------------------------------------------------------------------------------------------------------------------

struct LithologyPreset
{
    LithologyCategory   Category;               // [-]   identity
    float               Density;                // [g/cm³] bulk
    float               HardnessMohs;           // [-]   Mohs (scratch)
    float               Porosity;               // [%]   void fraction
    float               GrainSizeMillimetres;   // [mm]  characteristic crystal / grain
    float               CompressiveStrength;    // [MPa]
    float               ErosionRate;            // [-]   normalised to limestone = 1.35
    float               ExfoliationSpacing;     // [m]   sheet-joint spacing (0 = none)
    float               BeddingFrequency;       // [1/m] layers per metre (0 = massive)
    float               ColumnDiameter;         // [m]   hex prism diameter (0 = none)
    float               VesicleDensity;         // [1/m³] sparse voids (0 = none)
    float               PorosityWaterAbsorption;// [%]   W.A. ~ porosity * 0.35 (calcite) vs 0.05 (quartzite)
    // SDF shaping (derived from above, but locked for determinism)
    float               BaseRoundRadius;        // [m]   spheroidal rounding radius
    float               BeddingDipDegrees;      // [deg] cross-bed foreset dip
    float               HardnessDifferential;   // [-]   interlayer hardness contrast 0..1
    // Palette anchors (linear Rec.709, for procedural mineral assignment)
    float               PaletteA[3];            // primary mineral colour
    float               PaletteB[3];            // secondary
    float               PaletteC[3];            // mafic/dark or cement
};

// Measured lithologies — see Research.md §7. Do not tune by eye.
inline constexpr LithologyPreset kLithologyPresets[9] =
{
    // GraniteCore
    {
        LithologyCategory::GraniteCore, 2.65f, 6.5f, 0.8f, 6.0f, 180.0f, 0.22f, 0.14f, 0.0f, 0.0f, 0.0f, 0.35f,
        0.022f, 0.0f, 0.18f,
        { 0.84f, 0.83f, 0.80f }, { 0.90f, 0.76f, 0.66f }, { 0.10f, 0.10f, 0.12f }
    },
    // GranitePorphyry
    {
        LithologyCategory::GranitePorphyry, 2.67f, 6.5f, 0.9f, 18.0f, 160.0f, 0.25f, 0.16f, 0.0f, 0.0f, 0.0f, 0.38f,
        0.024f, 0.0f, 0.18f,
        { 0.84f, 0.83f, 0.80f }, { 0.90f, 0.76f, 0.66f }, { 0.10f, 0.10f, 0.12f }
    },
    // BasaltColumnar
    {
        LithologyCategory::BasaltColumnar, 2.91f, 6.0f, 0.5f, 0.2f, 220.0f, 0.32f, 0.0f, 0.0f, 0.18f, 0.85f, 0.20f,
        0.014f, 0.0f, 0.08f,
        { 0.12f, 0.13f, 0.15f }, { 0.54f, 0.55f, 0.58f }, { 0.06f, 0.07f, 0.08f }
    },
    // SandstoneBuff
    {
        LithologyCategory::SandstoneBuff, 2.32f, 6.5f, 14.0f, 0.4f, 65.0f, 0.92f, 0.0f, 9.0f, 0.0f, 0.0f, 4.2f,
        0.018f, 24.0f, 0.32f,
        { 0.84f, 0.77f, 0.65f }, { 0.62f, 0.29f, 0.18f }, { 0.79f, 0.66f, 0.54f }
    },
    // SandstoneRed
    {
        LithologyCategory::SandstoneRed, 2.45f, 6.5f, 9.0f, 0.6f, 85.0f, 0.74f, 0.0f, 8.2f, 0.0f, 0.0f, 2.8f,
        0.016f, 26.0f, 0.38f,
        { 0.66f, 0.36f, 0.24f }, { 0.79f, 0.66f, 0.54f }, { 0.41f, 0.22f, 0.14f }
    },
    // LimestoneKarst
    {
        LithologyCategory::LimestoneKarst, 2.42f, 3.5f, 11.0f, 0.15f, 75.0f, 1.35f, 0.0f, 3.2f, 0.0f, 0.0f, 3.8f,
        0.026f, 0.0f, 0.45f,
        { 0.91f, 0.88f, 0.82f }, { 0.23f, 0.18f, 0.15f }, { 0.73f, 0.71f, 0.68f }
    },
    // ShaleSlate
    {
        LithologyCategory::ShaleSlate, 2.68f, 5.5f, 0.4f, 0.006f, 140.0f, 0.48f, 0.02f, 45.0f, 0.0f, 0.0f, 0.22f,
        0.009f, 0.0f, 0.28f,
        { 0.23f, 0.24f, 0.27f }, { 0.17f, 0.18f, 0.20f }, { 0.62f, 0.56f, 0.35f }
    },
    // GneissBanded
    {
        LithologyCategory::GneissBanded, 2.82f, 6.5f, 0.7f, 4.0f, 170.0f, 0.41f, 0.0f, 6.0f, 0.0f, 0.0f, 0.30f,
        0.019f, 0.0f, 0.55f,
        { 0.89f, 0.85f, 0.82f }, { 0.12f, 0.14f, 0.16f }, { 0.90f, 0.71f, 0.66f }
    },
    // Quartzite
    {
        LithologyCategory::Quartzite, 2.65f, 7.5f, 0.3f, 0.8f, 240.0f, 0.15f, 0.10f, 0.0f, 0.0f, 0.0f, 0.10f,
        0.012f, 0.0f, 0.12f,
        { 0.93f, 0.91f, 0.90f }, { 0.88f, 0.88f, 0.89f }, { 0.76f, 0.77f, 0.78f }
    },
};

[[nodiscard]] inline const LithologyPreset& QueryLithologyPreset(LithologyCategory C) noexcept
{
    return kLithologyPresets[static_cast<uint32_t>(C)];
}

// Convenience getters that mirror shader uniforms (keep CPU/GPU in sync)
[[nodiscard]] inline float LithologyErosionRate(LithologyCategory C) noexcept { return QueryLithologyPreset(C).ErosionRate; }
[[nodiscard]] inline float LithologyHardness(LithologyCategory C) noexcept     { return QueryLithologyPreset(C).HardnessMohs; }
[[nodiscard]] inline float LithologyPorosity(LithologyCategory C) noexcept     { return QueryLithologyPreset(C).Porosity; }

} // namespace Frontier
