//============================================================================================================================================
//                                        CPUMATERIALSHADING.H
//============================================================================================================================================
// Project-Zero CPU counterpart for authored materials. MaterialEvaluation.slang is included here as C++ through the
// same Slang CPU shim used by the material exhibits; the Showcase CPU renderer therefore does not collapse the grid
// back to its legacy Lambert analytical materials.
#pragma once

#include "../../../Engine/ContentInterchange/MaterialDescriptor.h"
#include "../../../Engine/ContentInterchange/MaterialIndex.h"
#include "../../../Engine/DeviceExchange/OrientationClassifier.h"
#include "../../../Engine/DisplayPresentation/ShadingTableCodec.h"
#include <algorithm>
#include <cmath>

#ifndef FRONTIER_CPU_PORT
#define FRONTIER_CPU_PORT 1
#define FRONTIER_CPU_PORT_LOCAL_DEFINE 1
#endif

namespace Frontier::ProjectZero::CpuMaterial
{
#include "../../../Exhibits/Workbench/Materials/SlangCpuShim.h"

inline const Frontier::ShadingTableSet& Tables() noexcept
{
    static const Frontier::ShadingTableSet Value = Frontier::ShadingTableCodec::Bake(1024u);
    return Value;
}

inline vec3 FetchEnergy(float Mu, float Alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleEnergy(Tables(), Mu, Alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec3 FetchSheen(float Mu, float Alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheen(Tables(), Mu, Alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec4 FetchSheenFull(float Mu, float Alpha)
{
    float Out[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheenFull(Tables(), Mu, Alpha, Out);
    return vec4(Out[0], Out[1], Out[2], Out[3]);
}

#include "../../../Engine/Shaders/MaterialEvaluation.slang"

inline MaterialReflectance DeriveSelection(const Frontier::MaterialDescriptor& D,
                                           const Frontier::MaterialSlabDescriptor& S) noexcept
{
    if ((D.Flags & Frontier::MaterialFlagUnlit) != 0u) return MaterialReflectance::Unlit;
    const bool Reflects = S.BaseWeight > 0.0f || S.SpecularWeight > 0.0f || S.CoatWeight > 0.0f ||
                          S.FuzzWeight > 0.0f || S.TransmissionWeight > 0.0f || S.SubsurfaceWeight > 0.0f ||
                          S.ThinFilmWeight > 0.0f;
    if (S.EmissionLuminance > 0.0f && !Reflects) return MaterialReflectance::EmissiveOnly;
    if (S.TransmissionWeight > 0.0f) return MaterialReflectance::Transmissive;
    if (S.SubsurfaceWeight > 0.0f) return MaterialReflectance::Subsurface;
    if (S.FuzzWeight > 0.0f && S.SpecularWeight == 0.0f && S.CoatWeight == 0.0f && S.BaseMetalness == 0.0f &&
        S.SlateHazinessWeight == 0.0f)
        return MaterialReflectance::Cloth;
    if (S.CoatWeight > 0.0f) return MaterialReflectance::ClearCoated;
    if (S.SpecularRoughnessAnisotropy != 0.0f) return MaterialReflectance::Anisotropic;
    return MaterialReflectance::Standard;
}

inline ShadingRecord BuildRecord(const Frontier::MaterialDescriptor& D)
{
    const Frontier::MaterialSlabDescriptor& S = D.Slabs.front();
    ShadingRecord M;
    M.BaseColor = vec3(S.BaseWeight * S.BaseColor[0], S.BaseWeight * S.BaseColor[1], S.BaseWeight * S.BaseColor[2]);
    M.Metalness = S.BaseMetalness;
    M.DiffuseRoughness = S.BaseDiffuseRoughness;
    M.SpecularWeight = S.SpecularWeight;
    M.SpecularColor = vec3(S.SpecularColor[0], S.SpecularColor[1], S.SpecularColor[2]);
    M.SpecularRoughness = S.SpecularRoughness;
    M.SpecularAnisotropy = S.SpecularRoughnessAnisotropy;
    M.AnisotropyAngle = S.SlateAnisotropyRotation;
    M.SpecularIor = S.SpecularIor;
    M.ThinFilmWeight = S.ThinFilmWeight;
    M.ThinFilmThickness = S.ThinFilmThickness;
    M.ThinFilmIor = S.ThinFilmIor;
    M.HazinessWeight = S.SlateHazinessWeight;
    M.HazinessRoughness = S.SlateHazinessRoughness;
    M.CoatWeight = S.CoatWeight;
    M.CoatColor = vec3(S.CoatColor[0], S.CoatColor[1], S.CoatColor[2]);
    M.CoatRoughness = S.CoatRoughness;
    M.CoatAnisotropy = S.CoatRoughnessAnisotropy;
    M.CoatIor = S.CoatIor;
    M.CoatDarkening = S.CoatDarkening;
    M.FuzzWeight = S.FuzzWeight;
    M.FuzzColor = vec3(S.FuzzColor[0], S.FuzzColor[1], S.FuzzColor[2]);
    M.FuzzRoughness = S.FuzzRoughness;
    M.Emission = vec3(S.EmissionLuminance * S.EmissionColor[0], S.EmissionLuminance * S.EmissionColor[1],
                      S.EmissionLuminance * S.EmissionColor[2]);
    M.TransmissionWeight = S.TransmissionWeight;
    M.TransmissionColor = vec3(S.TransmissionColor[0], S.TransmissionColor[1], S.TransmissionColor[2]);
    M.TransmissionDepth = S.TransmissionDepth;
    M.TransmissionThickness = D.VolumeThickness > 0.0f ? D.VolumeThickness : S.TransmissionDepth;
    M.Selection = static_cast<uint>(DeriveSelection(D, S));
    M.SssWeight = S.SubsurfaceWeight;
    M.SssColor = vec3(S.SubsurfaceColor[0], S.SubsurfaceColor[1], S.SubsurfaceColor[2]);
    M.SssRadius = S.SubsurfaceRadius;
    M.SssRadiusScale = vec3(S.SubsurfaceRadiusScale[0], S.SubsurfaceRadiusScale[1], S.SubsurfaceRadiusScale[2]);
    // The CPU visibility renderer has no per-hit exit-distance buffer. A short chord is the honest local counterpart
    // for the grid's translucent balls; it keeps SSS visible without pretending to be volumetric random walk.
    M.SssThickness = std::max(0.0f, 2.0f * S.SubsurfaceRadius);
    return M;
}

inline void Frame(const vec3& N, vec3& T, vec3& B)
{
    const vec3 Helper = abs(N.z) < 0.9f ? vec3(0.0f, 0.0f, 1.0f) : vec3(1.0f, 0.0f, 0.0f);
    T = normalize(cross(Helper, N));
    B = cross(N, T);
}

inline Frontier::Vector3 ToEngine(vec3 V) noexcept { return Frontier::Vector3{ V.x, V.y, V.z }; }
inline vec3 ToShader(const Frontier::Vector3& V) noexcept { return vec3(V.x, V.y, V.z); }

// Evaluates the exact shared shader f*cosθ for an incoming direction. Above-surface direct sun/moon, below-surface
// environment transmission, and the M5 subsurface arm all use this same entry point.
inline Frontier::Vector3 Evaluate(const ShadingRecord& Material,
                                  const Frontier::Vector3& Normal,
                                  const Frontier::Vector3& ViewDirection,
                                  const Frontier::Vector3& LightDirection) noexcept
{
    const vec3 N = normalize(ToShader(Normal));
    vec3 T, B;
    Frame(N, T, B);
    const vec3 WoWorld = normalize(ToShader(ViewDirection));
    const vec3 WiWorld = normalize(ToShader(LightDirection));
    const vec3 Wo(dot(WoWorld, T), dot(WoWorld, B), dot(WoWorld, N));
    const vec3 Wi(dot(WiWorld, T), dot(WiWorld, B), dot(WiWorld, N));
    if (Wo.z <= 0.0f) return Frontier::Vector3{ 0.0f, 0.0f, 0.0f };
    const ResolvedLayers Layers = ResolveLayers(Material, Wo);
    const vec3 F = EvaluateBsdf(Material, Layers, Wo, Wi);
    const float Cosine = Wi.z >= 0.0f ? Wi.z : -Wi.z;
    return ToEngine(F * Cosine);
}

inline Frontier::Vector3 IndirectAlbedo(const ShadingRecord& Material) noexcept
{
    const vec3 Base = (1.0f - Material.Metalness) * (1.0f - Material.TransmissionWeight) *
                      (1.0f - Material.SssWeight) * Material.BaseColor + Material.SssWeight * Material.SssColor;
    return ToEngine(Base);
}

inline bool IsUnlit(const Frontier::MaterialDescriptor& D) noexcept
{
    return (D.Flags & Frontier::MaterialFlagUnlit) != 0u;
}

inline bool IsEmissive(const ShadingRecord& M) noexcept
{
    return M.Emission.x > 0.0f || M.Emission.y > 0.0f || M.Emission.z > 0.0f;
}

} // namespace Frontier::ProjectZero::CpuMaterial

#ifdef FRONTIER_CPU_PORT_LOCAL_DEFINE
#undef FRONTIER_CPU_PORT_LOCAL_DEFINE
#undef FRONTIER_CPU_PORT
#endif
