//============================================================================================================================================
//                                                   SURFELMATERIALEVALUATION.SLANG
//============================================================================================================================================
// 📦 Shared OpenPBR material decode and BSDF evaluation for both non-raytraced Surfel passes.

// The records and payload map are the same records consumed by ReSTIRViewport.slang. Keeping the Surfel path on these
// tables is the important contract: a render-mode change may replace transport, but it may never replace the material.
struct SurfelMaterialRecord
{
    vec4  Albedo;
    vec4  Emissive;
    uvec4 Slabs;
    uvec2 Textures;
    float AlphaCutoff;
    float NormalScale;
};

struct SurfelMaterialSlab
{
    vec4  Payload[15];
    uvec4 TextureSlots0;
    uvec4 TextureSlots1;
    uvec4 Runtime;
    vec4  Slate2;
};

struct SurfelTriangle
{
    vec4 V0;
    vec4 V1;
    vec4 V2;
    vec4 Uv;
};

layout(std430, binding = FRONTIER_SURFEL_TRIANGLE_BINDING) readonly buffer SurfelTriangleExtent
{ SurfelTriangle MaterialTriangles[]; };
layout(std430, binding = FRONTIER_SURFEL_MATERIAL_BINDING) readonly buffer SurfelMaterialExtent
{ SurfelMaterialRecord MaterialRecords[]; };
layout(std430, binding = FRONTIER_SURFEL_SLAB_BINDING) readonly buffer SurfelMaterialSlabExtent
{ SurfelMaterialSlab MaterialSlabRecords[]; };

#define FRONTIER_AUTOMOTIVE_SHOWCASE 1
#include "MaterialEvaluation.slang"

uint SurfelMaterialSelection(SurfelMaterialRecord Material)
{
    return (Material.Slabs.z >> 8u) & 0xFu;
}

ShadingRecord ResolveSurfelMaterial(uint MaterialIndex)
{
    SurfelMaterialRecord Material = MaterialRecords[MaterialIndex];
    ShadingRecord Shading;
    Shading.AutomotiveData       = vec4(0.0);
    Shading.AutomotiveDensity    = 0.0;
    Shading.AutomotiveFootprint  = 0.0;
    Shading.BaseColor            = Material.Albedo.xyz;
    Shading.Metalness            = Material.Emissive.w;
    Shading.DiffuseRoughness     = 0.0;
    Shading.SpecularWeight       = 1.0;
    Shading.SpecularColor        = vec3(1.0);
    Shading.SpecularRoughness    = Material.Albedo.w;
    Shading.SpecularAnisotropy   = 0.0;
    Shading.AnisotropyAngle      = 0.0;
    Shading.SpecularIor          = 1.5;
    Shading.ThinFilmWeight       = 0.0;
    Shading.ThinFilmThickness    = 0.5;
    Shading.ThinFilmIor          = 1.4;
    Shading.HazinessWeight       = 0.0;
    Shading.HazinessRoughness    = 0.5;
    Shading.CoatWeight           = 0.0;
    Shading.CoatColor            = vec3(1.0);
    Shading.CoatRoughness        = 0.0;
    Shading.CoatAnisotropy       = 0.0;
    Shading.CoatIor              = 1.6;
    Shading.CoatDarkening        = 1.0;
    Shading.CoatTangent          = vec3(1.0, 0.0, 0.0);
    Shading.CoatNormal           = vec3(0.0, 0.0, 1.0);
    Shading.FuzzWeight           = 0.0;
    Shading.FuzzColor            = vec3(1.0);
    Shading.FuzzRoughness        = 0.5;
    Shading.Emission             = Material.Emissive.xyz;
    Shading.TransmissionWeight   = 0.0;
    Shading.TransmissionColor    = vec3(1.0);
    Shading.TransmissionDepth    = 0.0;
    Shading.TransmissionThickness = 0.0;
    Shading.Selection            = SurfelMaterialSelection(Material);
    Shading.SssWeight            = 0.0;
    Shading.SssColor             = vec3(1.0);
    Shading.SssRadius            = 0.0;
    Shading.SssRadiusScale       = vec3(0.0);
    Shading.SssThickness         = 0.0;

    if (Material.Slabs.y == 0u) return Shading;

    SurfelMaterialSlab Slab = MaterialSlabRecords[Material.Slabs.x];
    vec4 P0  = Slab.Payload[0];
    vec4 P1  = Slab.Payload[1];
    vec4 P2  = Slab.Payload[2];
    vec4 P3  = Slab.Payload[3];
    vec4 P4  = Slab.Payload[4];
    vec4 P6  = Slab.Payload[6];
    vec4 P7  = Slab.Payload[7];
    vec4 P8  = Slab.Payload[8];
    vec4 P9  = Slab.Payload[9];
    vec4 P10 = Slab.Payload[10];
    vec4 P11 = Slab.Payload[11];
    vec4 P12 = Slab.Payload[12];
    vec4 P13 = Slab.Payload[13];
    vec4 P14 = Slab.Payload[14];

    Shading.BaseColor           = P0.x * P0.yzw;
    Shading.Metalness           = P1.x;
    Shading.DiffuseRoughness    = P1.y;
    Shading.SpecularWeight      = P1.z;
    Shading.SpecularColor       = vec3(P1.w, P2.xy);
    Shading.SpecularRoughness   = P2.z;
    Shading.SpecularAnisotropy  = P2.w;
    Shading.AnisotropyAngle     = Slab.Slate2.x;
    Shading.SpecularIor         = P3.x;
    Shading.TransmissionWeight  = P3.y;
    Shading.TransmissionColor   = vec3(P3.z, P3.w, P4.x);
    Shading.TransmissionDepth   = P4.y;
    Shading.SssWeight           = P6.x;
    Shading.SssColor            = P6.yzw;
    Shading.SssRadius           = P7.x;
    Shading.SssRadiusScale      = P7.yzw;
    Shading.CoatWeight          = P8.y;
    Shading.CoatColor           = vec3(P8.zw, P9.x);
    Shading.CoatRoughness       = P9.y;
    Shading.CoatAnisotropy      = P9.z;
    Shading.CoatIor             = P9.w;
    Shading.CoatDarkening       = P10.x;
    Shading.FuzzWeight          = P10.y;
    Shading.FuzzColor           = vec3(P10.zw, P11.x);
    Shading.FuzzRoughness       = P11.y;
    Shading.Emission            = P11.z * vec3(P11.w, P12.xy);
    Shading.ThinFilmWeight      = P12.z;
    Shading.ThinFilmThickness   = P12.w;
    Shading.ThinFilmIor         = P13.x;
    Shading.HazinessWeight      = P13.z;
    Shading.HazinessRoughness   = P13.w;
    Shading.AutomotiveData      = vec4(Slab.Slate2.zw, 0.0, 0.0);
    Shading.AutomotiveDensity   = P14.x;
    return Shading;
}

void SurfelShadingFrame(vec3 Normal, out vec3 Tangent, out vec3 Bitangent)
{
    float Sign = Normal.z >= 0.0 ? 1.0 : -1.0;
    float Scale = -1.0 / (Sign + Normal.z);
    float Product = Normal.x * Normal.y * Scale;
    Tangent   = vec3(1.0 + Sign * Normal.x * Normal.x * Scale, Sign * Product, -Sign * Normal.x);
    Bitangent = vec3(Product, Sign + Normal.y * Normal.y * Scale, -Normal.y);
}

vec3 SurfelLocalDirection(vec3 Direction, vec3 Tangent, vec3 Bitangent, vec3 Normal)
{
    return vec3(dot(Direction, Tangent), dot(Direction, Bitangent), dot(Direction, Normal));
}

vec3 EvaluateSurfelMaterial(ShadingRecord Shading, vec3 Normal, vec3 OutgoingWorld, vec3 IncomingWorld)
{
    vec3 Tangent;
    vec3 Bitangent;
    SurfelShadingFrame(Normal, Tangent, Bitangent);
    vec3 Outgoing = SurfelLocalDirection(OutgoingWorld, Tangent, Bitangent, Normal);
    vec3 Incoming = SurfelLocalDirection(IncomingWorld, Tangent, Bitangent, Normal);
    if (Outgoing.z <= 0.0 || Incoming.z <= 0.0) return vec3(0.0);
    ResolvedLayers Layers = ResolveLayers(Shading, Outgoing);
    return EvaluateBsdf(Shading, Layers, Outgoing, Incoming);
}
