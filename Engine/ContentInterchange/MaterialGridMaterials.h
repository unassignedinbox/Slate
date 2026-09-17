//============================================================================================================================================
//                                      MATERIALGRIDMATERIALS.H
//============================================================================================================================================
// Vulkan-free source of truth for the Project-Zero material-grid descriptors. Both the GPU scene exporter and the
// CPU Slang renderer consume these records so material identity and authored values cannot drift between paths.
#pragma once

#include "MaterialDescriptor.h"
#include <vector>

namespace Frontier {

inline MaterialDescriptor MakeMaterialGridMaterial(const char* Name)
{
    MaterialDescriptor D;
    D.Name = Name;
    D.Slabs.emplace_back();
    return D;
}

inline void SetMaterialGridColor(float* Target, float R, float G, float B) noexcept
{
    Target[0] = R; Target[1] = G; Target[2] = B;
}

inline std::vector<MaterialDescriptor> ConstructMaterialGridMaterials()
{
    std::vector<MaterialDescriptor> Materials;
    Materials.reserve(22u);
    // Material 0 is the neutral floor. Balls start at material 1 and remain one-to-one with the 20 grid cells below.
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("grid_floor");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.16f, 0.17f, 0.19f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].BaseDiffuseRoughness = 0.75f;
        Materials.push_back(D);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // One descriptor per cell. The names are deliberately stable: they are the material inspector's selection names
    // and the scene census' identity keys. Values exercise the resolved channels, not a palette-only colour swap.
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("plastic");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.035f, 0.18f, 0.72f);
        D.Slabs[0].SpecularRoughness = 0.28f;
        D.Slabs[0].SpecularIor = 1.46f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("bone");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.72f, 0.52f, 0.34f);
        D.Slabs[0].SpecularWeight = 0.35f;
        D.Slabs[0].SpecularRoughness = 0.42f;
        D.Slabs[0].SubsurfaceWeight = 0.72f;
        SetMaterialGridColor(D.Slabs[0].SubsurfaceColor, 0.95f, 0.66f, 0.46f);
        D.Slabs[0].SubsurfaceRadius = 0.018f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 0.58f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.32f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("clearcoat");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.62f, 0.025f, 0.018f);
        D.Slabs[0].SpecularRoughness = 0.34f;
        D.Slabs[0].CoatWeight = 1.0f;
        D.Slabs[0].CoatColor[0] = 1.0f; D.Slabs[0].CoatColor[1] = 0.96f; D.Slabs[0].CoatColor[2] = 0.90f;
        D.Slabs[0].CoatRoughness = 0.045f;
        D.Slabs[0].CoatIor = 1.50f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("glass_glossy");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.86f, 0.94f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.12f;
        D.Slabs[0].SpecularIor = 1.52f;
        D.Slabs[0].TransmissionWeight = 1.0f;
        SetMaterialGridColor(D.Slabs[0].TransmissionColor, 0.82f, 0.94f, 1.0f);
        D.Slabs[0].TransmissionDepth = 0.10f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("glass_clear");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.96f, 0.98f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.015f;
        D.Slabs[0].SpecularIor = 1.50f;
        D.Slabs[0].TransmissionWeight = 1.0f;
        SetMaterialGridColor(D.Slabs[0].TransmissionColor, 1.0f, 1.0f, 1.0f);
        D.Slabs[0].GeometryThinWalled = true;
        D.Flags |= MaterialFlagThinWalled;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("metal_gold");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 1.00f, 0.71f, 0.20f);
        SetMaterialGridColor(D.Slabs[0].SpecularColor, 1.00f, 0.93f, 0.72f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.20f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("metal_silver");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.88f, 0.90f, 0.94f);
        SetMaterialGridColor(D.Slabs[0].SpecularColor, 1.00f, 1.00f, 1.00f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.16f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("metal_copper");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.82f, 0.24f, 0.10f);
        SetMaterialGridColor(D.Slabs[0].SpecularColor, 1.00f, 0.72f, 0.56f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.27f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("metal_iron");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.36f, 0.39f, 0.43f);
        SetMaterialGridColor(D.Slabs[0].SpecularColor, 0.58f, 0.60f, 0.63f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.42f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("metal_brushed");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.52f, 0.56f, 0.60f);
        SetMaterialGridColor(D.Slabs[0].SpecularColor, 0.82f, 0.86f, 0.90f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.24f;
        D.Slabs[0].SpecularRoughnessAnisotropy = -0.82f;
        D.Slabs[0].SlateAnisotropyRotation = 0.55f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("clearcoat_rough");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.04f, 0.22f, 0.12f);
        D.Slabs[0].SpecularRoughness = 0.48f;
        D.Slabs[0].CoatWeight = 0.85f;
        D.Slabs[0].CoatRoughness = 0.30f;
        D.Slabs[0].CoatIor = 1.62f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("velvet");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.32f, 0.012f, 0.075f);
        SetMaterialGridColor(D.Slabs[0].FuzzColor, 1.0f, 0.82f, 0.86f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 1.0f;
        D.Slabs[0].FuzzRoughness = 0.72f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("felt");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.16f, 0.20f, 0.24f);
        SetMaterialGridColor(D.Slabs[0].FuzzColor, 0.42f, 0.56f, 0.72f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 0.86f;
        D.Slabs[0].FuzzRoughness = 0.92f;
        D.Slabs[0].BaseDiffuseRoughness = 0.82f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("wax");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.66f, 0.10f, 0.045f);
        SetMaterialGridColor(D.Slabs[0].SubsurfaceColor, 1.0f, 0.22f, 0.08f);
        D.Slabs[0].SpecularWeight = 0.25f;
        D.Slabs[0].SpecularRoughness = 0.36f;
        D.Slabs[0].SubsurfaceWeight = 0.88f;
        D.Slabs[0].SubsurfaceRadius = 0.030f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 0.22f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.08f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("jade");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.08f, 0.50f, 0.24f);
        SetMaterialGridColor(D.Slabs[0].SubsurfaceColor, 0.12f, 0.82f, 0.30f);
        D.Slabs[0].SpecularWeight = 0.28f;
        D.Slabs[0].SpecularRoughness = 0.30f;
        D.Slabs[0].SubsurfaceWeight = 0.70f;
        D.Slabs[0].SubsurfaceRadius = 0.022f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 0.22f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.34f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("soap_film");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.035f, 0.04f, 0.05f);
        D.Slabs[0].SpecularRoughness = 0.08f;
        D.Slabs[0].ThinFilmWeight = 1.0f;
        D.Slabs[0].ThinFilmThickness = 0.34f;
        D.Slabs[0].ThinFilmIor = 1.42f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("emissive");
        D.Slabs[0].BaseWeight = 0.0f;
        D.Slabs[0].BaseColor[0] = 0.0f; D.Slabs[0].BaseColor[1] = 0.0f; D.Slabs[0].BaseColor[2] = 0.0f;
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 8.0f;
        SetMaterialGridColor(D.Slabs[0].EmissionColor, 1.0f, 0.30f, 0.035f);
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("unlit");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.04f, 0.68f, 0.95f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Flags |= MaterialFlagUnlit;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("hazy_clear");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.18f, 0.20f, 0.23f);
        D.Slabs[0].SpecularRoughness = 0.08f;
        D.Slabs[0].SlateHazinessWeight = 0.78f;
        D.Slabs[0].SlateHazinessRoughness = 0.76f;
        D.Slabs[0].CoatWeight = 0.25f;
        D.Slabs[0].CoatRoughness = 0.20f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("matte_eon");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 0.72f, 0.46f, 0.12f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].BaseDiffuseRoughness = 1.0f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterialGridMaterial("grid_luminaire");
        SetMaterialGridColor(D.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f);
        D.Slabs[0].BaseWeight = 0.0f;
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 120.0f;
        Materials.push_back(D);
    }

    return Materials;
}

} // namespace Frontier
