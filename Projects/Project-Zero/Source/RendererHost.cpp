//============================================================================================================================================
// 📦 Project-Zero/Source/RendererHost.cpp — ReSTIR DI & GI Frame Execution and Image Export Implementation
//============================================================================================================================================

#include "RendererHost.h"
#include "CpuMaterialShading.h"
#include <fstream>
#include <cmath>
#include <algorithm>
#include <random>
#include <iostream>
#include "../Shaders/SlangInterchange.h"
#include "../Shaders/FlareSpecification.slang"
// The flare core is compiled ONLY in this translation unit (its routines
// are non-inline, like the sky/fog core in SkyFogIntegrator.cpp). Undefine
// the prelude keyword macros so nothing below can be macro-rewritten.
#undef in
#undef uniform

namespace Frontier::ProjectZero
{
namespace
{

// M9 CPU reference transport. The previous Showcase CPU path evaluated authored materials only at the primary hit and
// then multiplied a diffuse proxy into the ReSTIR GI buffer. That is a valid source-contract check, but it cannot show
// metal reflections or glass transmission. This small path continuation uses the exact MaterialEvaluation.slang
// EvaluateBsdf/SampleBsdf pair for authored secondary rays while keeping the existing sun, moon, sky and cloud queries.
struct ShowcasePathRng
{
    uint32_t State;
    explicit ShowcasePathRng(uint32_t Seed) noexcept : State(Seed * 747796405u + 2891336453u) {}
    float Next() noexcept
    {
        State = State * 747796405u + 2891336453u;
        uint32_t Word = ((State >> ((State >> 28u) + 4u)) ^ State) * 277803737u;
        Word = (Word >> 22u) ^ Word;
        return static_cast<float>(Word) * (1.0f / 4294967296.0f);
    }
};

Vector3 CpuWorldFromLocal(const CpuMaterial::vec3& Local, const Vector3& N) noexcept
{
    CpuMaterial::vec3 T, B;
    CpuMaterial::Frame(CpuMaterial::normalize(CpuMaterial::ToShader(N)), T, B);
    return CpuMaterial::ToEngine(T * Local.x + B * Local.y + CpuMaterial::normalize(CpuMaterial::ToShader(N)) * Local.z);
}

Vector3 AuthoredEnvironmentBounce(const CpuMaterial::ShadingRecord& Material,
                                  const Vector3& Normal,
                                  const Vector3& View,
                                  const SkyFogIntegrator& SkyFog) noexcept
{
    Vector3 N = Normal;
    if (OrientationClassifier::DotProduct(N, View) < 0.0f) N = Vector3{ -N.x, -N.y, -N.z };
    const Vector3 Reflection = N * (2.0f * OrientationClassifier::DotProduct(N, View)) - View;
    Vector3 Result = CpuMaterial::Evaluate(Material, N, View, Reflection) *
                     SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(Reflection));

    return Result;
}

Vector3 AuthoredTransmissionBounce(const RayTracingSolver& Scene,
                                   const std::vector<AnalyticalMaterial>& Materials,
                                   const std::vector<CpuMaterial::ShadingRecord>& Records,
                                   const std::vector<uint8_t>& HasAuthoredMaterial,
                                   const CpuMaterial::ShadingRecord& Material,
                                   const Vector3& Point, const Vector3& Normal, const Vector3& View,
                                   const SkyFogIntegrator& SkyFog,
                                   const Vector3& SunWorld, const Vector3& SunRadiance) noexcept
{
    if (Material.TransmissionWeight <= 0.0f) return Vector3{ 0.0f, 0.0f, 0.0f };
    Vector3 N = Normal;
    if (OrientationClassifier::DotProduct(N, View) < 0.0f) N = Vector3{ -N.x, -N.y, -N.z };
    const CpuMaterial::vec3 Ns = CpuMaterial::normalize(CpuMaterial::ToShader(N));
    CpuMaterial::vec3 T, B;
    CpuMaterial::Frame(Ns, T, B);
    const CpuMaterial::vec3 Wo(CpuMaterial::dot(CpuMaterial::ToShader(View), T),
                               CpuMaterial::dot(CpuMaterial::ToShader(View), B),
                               CpuMaterial::dot(CpuMaterial::ToShader(View), Ns));
    if (Wo.z <= 0.0f) return Vector3{ 0.0f, 0.0f, 0.0f };
    const CpuMaterial::ResolvedLayers Layers = CpuMaterial::ResolveLayers(Material, Wo);
    const CpuMaterial::vec4 Sample = CpuMaterial::SampleBsdf(Material, Layers, Wo,
                                                               CpuMaterial::vec4(0.37f, 0.61f, 0.83f, 0.19f));
    if (Sample.w <= 1e-8f || Sample.z >= 0.0f) return Vector3{ 0.0f, 0.0f, 0.0f };

    const Vector3 Direction = CpuWorldFromLocal(Sample.xyz, N);
    const HitIntersection Behind = Scene.EvaluateIntersection(RayStructure{ Point + Direction * 0.002f, Direction,
                                                                              0.002f, 1000.0f });
    Vector3 Background = SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(Direction));
    if (!Behind.ValidCondition)
    {
        Background = SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(Direction));
    }
    else if (Behind.MaterialIndex < Materials.size() && Behind.MaterialIndex < Records.size() &&
             Behind.MaterialIndex < HasAuthoredMaterial.size() && HasAuthoredMaterial[Behind.MaterialIndex] != 0u)
    {
        const auto& BehindRecord = Records[Behind.MaterialIndex];
        Background = SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(Direction)) * 0.65f +
                     CpuMaterial::ToEngine(BehindRecord.BaseColor) * 0.35f;
    }
    else if (Behind.MaterialIndex < Materials.size())
    {
        const auto& BehindMaterial = Materials[Behind.MaterialIndex];
        const float SunCos = std::max(0.0f, OrientationClassifier::DotProduct(Behind.SurfaceNormal, SunWorld));
        const bool Visible = !Scene.EvaluateOcclusion(Behind.HitLocation + Behind.SurfaceNormal * 0.001f,
                                                       Behind.HitLocation + SunWorld * 1000.0f);
        Background = BehindMaterial.AlbedoColor * (SunRadiance * SunCos * (Visible ? 1.0f : 0.0f));
    }
    const CpuMaterial::vec3 F = CpuMaterial::EvaluateBsdf(Material, Layers, Wo, Sample.xyz);
    return CpuMaterial::ToEngine(F * (std::fabs(Sample.z) / Sample.w)) * Background;
}

Vector3 TraceAuthoredIndirect(const RayTracingSolver& Scene,
                              const std::vector<AnalyticalMaterial>& Materials,
                              const std::vector<CpuMaterial::ShadingRecord>& Records,
                              const std::vector<uint8_t>& HasAuthoredMaterial,
                              const SkyFogIntegrator& SkyFog,
                              const Vector3& SunWorld, const Vector3& SunRadiance,
                              const Vector3& MoonWorld, const Vector3& MoonRadiance,
                              const Vector3& PrimaryPoint, const Vector3& PrimaryNormal,
                              const Vector3& PrimaryView, uint32_t PrimaryMaterial,
                              uint32_t SampleCount, uint32_t MaxDepth, uint32_t Seed) noexcept
{
    if (PrimaryMaterial >= HasAuthoredMaterial.size() || HasAuthoredMaterial[PrimaryMaterial] == 0u ||
        PrimaryMaterial >= Records.size() || SampleCount == 0u)
        return Vector3{ 0.0f, 0.0f, 0.0f };

    const CpuMaterial::ShadingRecord& PrimaryRecord = Records[PrimaryMaterial];
    Vector3 Sum{ 0.0f, 0.0f, 0.0f };
    ShowcasePathRng Rng(Seed);
    for (uint32_t Sample = 0u; Sample < SampleCount; ++Sample)
    {
        Vector3 NWorld = PrimaryNormal;
        if (OrientationClassifier::DotProduct(NWorld, PrimaryView) < 0.0f) NWorld = Vector3{ -NWorld.x, -NWorld.y, -NWorld.z };
        CpuMaterial::vec3 T, B;
        const CpuMaterial::vec3 N = CpuMaterial::normalize(CpuMaterial::ToShader(NWorld));
        CpuMaterial::Frame(N, T, B);
        const CpuMaterial::vec3 Wo(CpuMaterial::dot(CpuMaterial::ToShader(PrimaryView), T),
                                   CpuMaterial::dot(CpuMaterial::ToShader(PrimaryView), B),
                                   CpuMaterial::dot(CpuMaterial::ToShader(PrimaryView), N));
        if (Wo.z <= 0.0f) continue;
        const CpuMaterial::ResolvedLayers PrimaryLayers = CpuMaterial::ResolveLayers(PrimaryRecord, Wo);
        const CpuMaterial::vec4 BsdfSample( Rng.Next(), Rng.Next(), Rng.Next(), Rng.Next() );
        const CpuMaterial::vec4 Sampled = CpuMaterial::SampleBsdf(PrimaryRecord, PrimaryLayers, Wo, BsdfSample);
        if (Sampled.w <= 1e-8f) continue;
        const CpuMaterial::vec3 PrimaryF = CpuMaterial::EvaluateBsdf(PrimaryRecord, PrimaryLayers, Wo, Sampled.xyz);
        CpuMaterial::vec3 Throughput = PrimaryF * (std::fabs(Sampled.z) / Sampled.w);
        Vector3 Direction = CpuWorldFromLocal(Sampled.xyz, NWorld);
        Vector3 Origin = PrimaryPoint + Direction * 0.001f;
        Vector3 Radiance{ 0.0f, 0.0f, 0.0f };

        for (uint32_t Depth = 1u; Depth <= MaxDepth; ++Depth)
        {
            const RayStructure Ray{ Origin, Direction, 0.001f, 1000.0f };
            const HitIntersection Hit = Scene.EvaluateIntersection(Ray);
            if (!Hit.ValidCondition)
            {
                const Vector3 SkyDirection = SkyFogIntegrator::RenderFromWorld(Direction);
                Radiance += CpuMaterial::ToEngine(Throughput) * SkyFog.ComputeSkyRadiance(SkyDirection);
                break;
            }
            if (Hit.MaterialIndex >= Materials.size()) break;

            const bool Authored = Hit.MaterialIndex < HasAuthoredMaterial.size() && HasAuthoredMaterial[Hit.MaterialIndex] != 0u;
            const AnalyticalMaterial& HitMaterial = Materials[Hit.MaterialIndex];
            if (!Authored)
            {
                const float SunCos = std::max(0.0f, OrientationClassifier::DotProduct(Hit.SurfaceNormal, SunWorld));
                const float MoonCos = std::max(0.0f, OrientationClassifier::DotProduct(Hit.SurfaceNormal, MoonWorld));
                const bool SunVisible = !Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 0.001f,
                                                                  Hit.HitLocation + SunWorld * 1000.0f);
                const bool MoonVisible = !Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 0.001f,
                                                                   Hit.HitLocation + MoonWorld * 1000.0f);
                const float Cloud = SkyFog.QueryCloudShadow(Hit.HitLocation, SunWorld);
                Radiance += CpuMaterial::ToEngine(Throughput) * HitMaterial.AlbedoColor *
                            (SunRadiance * (SunCos * (SunVisible ? 1.0f : 0.0f) * Cloud) +
                             MoonRadiance * (MoonCos * (MoonVisible ? 1.0f : 0.0f)));
                break;
            }

            const CpuMaterial::ShadingRecord& Material = Records[Hit.MaterialIndex];
            if (CpuMaterial::IsEmissive(Material))
            {
                Radiance += CpuMaterial::ToEngine(Throughput) * CpuMaterial::ToEngine(Material.Emission);
                break;
            }

            Vector3 NHit = Hit.SurfaceNormal;
            const Vector3 View{ -Direction.x, -Direction.y, -Direction.z };
            if (OrientationClassifier::DotProduct(NHit, View) < 0.0f) NHit = Vector3{ -NHit.x, -NHit.y, -NHit.z };
            const Vector3 SunF = CpuMaterial::Evaluate(Material, NHit, View, SunWorld);
            const Vector3 MoonF = CpuMaterial::Evaluate(Material, NHit, View, MoonWorld);
            const float Cloud = SkyFog.QueryCloudShadow(Hit.HitLocation, SunWorld);
            const bool SunVisible = !Scene.EvaluateOcclusion(Hit.HitLocation + NHit * 0.001f,
                                                              Hit.HitLocation + SunWorld * 1000.0f);
            const bool MoonVisible = !Scene.EvaluateOcclusion(Hit.HitLocation + NHit * 0.001f,
                                                               Hit.HitLocation + MoonWorld * 1000.0f);
            Radiance += CpuMaterial::ToEngine(Throughput) * (SunF * SunRadiance * (SunVisible ? Cloud : 0.0f) +
                                     MoonF * MoonRadiance * (MoonVisible ? 1.0f : 0.0f));

            CpuMaterial::vec3 HitT, HitB;
            const CpuMaterial::vec3 HitN = CpuMaterial::normalize(CpuMaterial::ToShader(NHit));
            CpuMaterial::Frame(HitN, HitT, HitB);
            const CpuMaterial::vec3 HitWo(CpuMaterial::dot(CpuMaterial::ToShader(View), HitT),
                                          CpuMaterial::dot(CpuMaterial::ToShader(View), HitB),
                                          CpuMaterial::dot(CpuMaterial::ToShader(View), HitN));
            if (HitWo.z <= 0.0f) break;
            const CpuMaterial::ResolvedLayers Layers = CpuMaterial::ResolveLayers(Material, HitWo);
            const CpuMaterial::vec4 NextSample(Rng.Next(), Rng.Next(), Rng.Next(), Rng.Next());
            const CpuMaterial::vec4 Next = CpuMaterial::SampleBsdf(Material, Layers, HitWo, NextSample);
            if (Next.w <= 1e-8f) break;
            const CpuMaterial::vec3 F = CpuMaterial::EvaluateBsdf(Material, Layers, HitWo, Next.xyz);
            Throughput *= F * (std::fabs(Next.z) / Next.w);
            Throughput = CpuMaterial::min(Throughput, CpuMaterial::vec3(16.0f));
            Direction = CpuWorldFromLocal(Next.xyz, NHit);
            Origin = Hit.HitLocation + Direction * 0.001f;

            if (Depth >= 3u)
            {
                const float Continue = std::clamp(0.2126f * Throughput.x + 0.7152f * Throughput.y + 0.0722f * Throughput.z,
                                                  0.05f, 0.95f);
                if (Rng.Next() > Continue) break;
                Throughput *= 1.0f / Continue;
            }
        }
        Sum += Radiance;
    }
    return Sum * (1.0f / static_cast<float>(SampleCount));
}

std::vector<Vector3> AtrousAuthoredIndirect(const std::vector<Vector3>& Input,
                                             const std::vector<HitIntersection>& Hits,
                                             const std::vector<uint8_t>& HasAuthoredMaterial,
                                             uint32_t Width, uint32_t Height) noexcept
{
    std::vector<Vector3> A = Input;
    std::vector<Vector3> B(Input.size(), Vector3{ 0.0f, 0.0f, 0.0f });
    // CPU counterpart of the enabled M9 presentation filter: five à-trous levels, with normal/depth rejection so
    // glossy reflections are averaged without bleeding across the scattered-field silhouettes or the grid cells.
    for (uint32_t Level = 0u; Level < 5u; ++Level)
    {
        const int Step = 1 << Level;
        for (uint32_t Y = 0u; Y < Height; ++Y)
            for (uint32_t X = 0u; X < Width; ++X)
            {
                const size_t CenterIndex = static_cast<size_t>(Y) * Width + X;
                const HitIntersection& CenterHit = Hits[CenterIndex];
                if (!CenterHit.ValidCondition || CenterHit.MaterialIndex >= HasAuthoredMaterial.size() ||
                    HasAuthoredMaterial[CenterHit.MaterialIndex] == 0u)
                {
                    B[CenterIndex] = Vector3{ 0.0f, 0.0f, 0.0f };
                    continue;
                }
                Vector3 Sum = A[CenterIndex];
                float Weight = 1.0f;
                const int OffsetX[4] = { -Step, Step, 0, 0 };
                const int OffsetY[4] = { 0, 0, -Step, Step };
                for (uint32_t Tap = 0u; Tap < 4u; ++Tap)
                {
                    const int NX = static_cast<int>(X) + OffsetX[Tap];
                    const int NY = static_cast<int>(Y) + OffsetY[Tap];
                    if (NX < 0 || NY < 0 || NX >= static_cast<int>(Width) || NY >= static_cast<int>(Height)) continue;
                    const size_t NeighborIndex = static_cast<size_t>(NY) * Width + static_cast<size_t>(NX);
                    const HitIntersection& NeighborHit = Hits[NeighborIndex];
                    if (!NeighborHit.ValidCondition || NeighborHit.MaterialIndex >= HasAuthoredMaterial.size() ||
                        HasAuthoredMaterial[NeighborHit.MaterialIndex] == 0u)
                        continue;
                    const float NormalWeight = std::pow(std::max(0.0f,
                        OrientationClassifier::DotProduct(CenterHit.SurfaceNormal, NeighborHit.SurfaceNormal)), 24.0f);
                    const float DepthWeight = std::exp(-std::abs(CenterHit.RayDistance - NeighborHit.RayDistance) * 5.0f);
                    const float TapWeight = NormalWeight * DepthWeight;
                    Sum += A[NeighborIndex] * TapWeight;
                    Weight += TapWeight;
                }
                B[CenterIndex] = Sum / std::max(Weight, 1e-6f);
            }
        A.swap(B);
    }
    return A;
}

std::vector<Vector3> AtrousFrame(const std::vector<Vector3>& Input,
                                 const std::vector<HitIntersection>& Hits,
                                 uint32_t Width, uint32_t Height) noexcept
{
    std::vector<Vector3> A = Input;
    std::vector<Vector3> B(Input.size(), Vector3{ 0.0f, 0.0f, 0.0f });
    // M9 CPU presentation counterpart: the same five-level à-trous shape used by the shader, applied to the composed
    // Showcase frame as well as the authored continuation. Normal/depth gates stop the filter bleeding sky through
    // spheres, glass silhouettes, and the grid plinth.
    for (uint32_t Level = 0u; Level < 5u; ++Level)
    {
        const int Step = 1 << Level;
        for (uint32_t Y = 0u; Y < Height; ++Y)
            for (uint32_t X = 0u; X < Width; ++X)
            {
                const size_t Center = static_cast<size_t>(Y) * Width + X;
                if (!Hits[Center].ValidCondition)
                {
                    B[Center] = A[Center];
                    continue;
                }
                Vector3 Sum = A[Center];
                float Weight = 1.0f;
                const int DX[4] = { -Step, Step, 0, 0 };
                const int DY[4] = { 0, 0, -Step, Step };
                for (uint32_t Tap = 0u; Tap < 4u; ++Tap)
                {
                    const int NX = static_cast<int>(X) + DX[Tap];
                    const int NY = static_cast<int>(Y) + DY[Tap];
                    if (NX < 0 || NY < 0 || NX >= static_cast<int>(Width) || NY >= static_cast<int>(Height)) continue;
                    const size_t Neighbor = static_cast<size_t>(NY) * Width + static_cast<size_t>(NX);
                    if (!Hits[Neighbor].ValidCondition) continue;
                    const float Normal = std::max(0.0f,
                        OrientationClassifier::DotProduct(Hits[Center].SurfaceNormal, Hits[Neighbor].SurfaceNormal));
                    const float Depth = std::exp(-std::abs(Hits[Center].RayDistance - Hits[Neighbor].RayDistance) *
                                                  (1.5f + 0.5f * static_cast<float>(Level)));
                    const float TapWeight = std::pow(Normal, 24.0f) * Depth;
                    Sum += A[Neighbor] * TapWeight;
                    Weight += TapWeight;
                }
                B[Center] = Sum / std::max(Weight, 1e-6f);
            }
        A.swap(B);
    }
    return A;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

RendererHost::RendererHost(uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept
    : Width(ViewportWidth)
    , Height(ViewportHeight)
    , Scene{}
    , PrimaryHits(ViewportWidth * ViewportHeight)
    , DirectReservoirs(ViewportWidth * ViewportHeight)
    , IndirectReservoirs(ViewportWidth * ViewportHeight)
    , AccumulatedBuffer(ViewportWidth * ViewportHeight, Vector3{ 0.0f, 0.0f, 0.0f })
{
}

//------------------------------------------------------------------------------------------------------------------------
//                                                RAY GENERATION & SAMPLING
//------------------------------------------------------------------------------------------------------------------------

RayStructure RendererHost::GeneratePrimaryRay(const Frontier::CameraProjection& ActiveCamera, uint32_t PixelX, uint32_t PixelY, float JitterX, float JitterY) const noexcept
{
    float u = (static_cast<float>(PixelX) + JitterX) / static_cast<float>(Width);
    float v = (static_cast<float>(PixelY) + JitterY) / static_cast<float>(Height);
    Frontier::ViewRay Ray = ActiveCamera.ConstructRay(u, v);
    return RayStructure{ Ray.OriginLocation, Ray.UnitDirection, Ray.NearClippingDistance, Ray.FarClippingDistance };
}

Vector3 RendererHost::SampleCosineHemisphere(const Vector3& Normal, float u1, float u2) const noexcept
{
    float r = std::sqrt(u1);
    float theta = 2.0f * 3.14159265359f * u2;

    float x = r * std::cos(theta);
    float y = r * std::sin(theta);
    float z = std::sqrt(std::max(0.0f, 1.0f - u1));

    Vector3 Up = (std::abs(Normal.y) < 0.999f) ? Vector3{ 0.0f, 1.0f, 0.0f } : Vector3{ 1.0f, 0.0f, 0.0f };
    Vector3 Tangent = OrientationClassifier::CrossProduct(Up, Normal).Normalized();
    Vector3 Bitangent = OrientationClassifier::CrossProduct(Normal, Tangent);

    return (Tangent * x + Bitangent * y + Normal * z).Normalized();
}

float RendererHost::EvaluateJacobian(const Vector3& x1, const Vector3& x2, const Vector3& y, const Vector3& n_y) const noexcept
{
    Vector3 d1 = y - x1;
    Vector3 d2 = y - x2;
    float lenSq1 = d1.LengthSquared();
    float lenSq2 = d2.LengthSquared();

    if (lenSq1 <= 1e-6f || lenSq2 <= 1e-6f)
    {
        return 1.0f;
    }

    float len1 = std::sqrt(lenSq1);
    float len2 = std::sqrt(lenSq2);

    float cos1 = std::abs(OrientationClassifier::DotProduct(n_y, d1 / len1));
    float cos2 = std::abs(OrientationClassifier::DotProduct(n_y, d2 / len2));

    if (cos1 <= 1e-4f)
    {
        return 0.0f;
    }

    return std::min((cos2 * lenSq1) / (cos1 * lenSq2), 10.0f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           RESTIR DI & GI RENDER PIPELINE
//------------------------------------------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------------------------------------------
//                                     SHOWCASE SUN SKY FOG RENDER PIPELINE
//------------------------------------------------------------------------------------------------------------------------

void RendererHost::RenderShowcaseFrame(const Frontier::CameraProjection& ActiveCamera, double SunHour, SkyFogIntegrator::FogScenario Scenario, uint32_t SpatialPassCount, uint32_t BounceCount, bool FlareEnabled, float FlareVariety, bool CloudShadows, float CloudTime, uint32_t CloudType, float CloudCoverage, float CloudScale, float CloudBase, float CloudThickness, float CloudDensity, bool DenoiseEnabled, bool ReprojectionEnabled) noexcept
{
    std::mt19937 Rng(1337);
    std::uniform_real_distribution<float> Dist(0.0f, 1.0f);

    Scene.ConstructShowcaseScene();
    SkyFog.AssignSunHour(SunHour);
    SkyFog.AssignFogScenario(Scenario);
    SkyFog.AssignCloudShadow(CloudShadows, CloudTime, CloudType, CloudCoverage, CloudScale, CloudBase, CloudThickness, CloudDensity);

    const auto& Materials = Scene.QueryMaterials();
    // Authored showcase/grid records stay on the same OpenPBR/MaterialEvaluation.slang CPU path as the GPU
    // material descriptors. Legacy analytical objects retain their historical Lambert fallback below.
    std::vector<CpuMaterial::ShadingRecord> AuthoredRecords(Materials.size());
    std::vector<uint8_t> HasAuthoredMaterial(Materials.size(), 0u);
    std::vector<uint8_t> AuthoredUnlit(Materials.size(), 0u);
    uint32_t AuthoredCount = 0u;
    uint32_t TransmissionCount = 0u;
    uint32_t SubsurfaceCount = 0u;
    for (size_t MaterialIndex = 0u; MaterialIndex < Materials.size(); ++MaterialIndex)
    {
        if (!Materials[MaterialIndex].HasAuthoredDescriptor || Materials[MaterialIndex].AuthoredDescriptor.Slabs.empty()) continue;
        const auto& Descriptor = Materials[MaterialIndex].AuthoredDescriptor;
        AuthoredRecords[MaterialIndex] = CpuMaterial::BuildRecord(Descriptor);
        HasAuthoredMaterial[MaterialIndex] = 1u;
        AuthoredUnlit[MaterialIndex] = CpuMaterial::IsUnlit(Descriptor) ? 1u : 0u;
        ++AuthoredCount;
        const auto& Slab = Descriptor.Slabs.front();
        if (Slab.TransmissionWeight > 0.0f) ++TransmissionCount;
        if (Slab.SubsurfaceWeight > 0.0f) ++SubsurfaceCount;
    }
    std::printf("[Project-Zero CPU] authored materials=%u transmission=%u subsurface=%u; MaterialEvaluation.slang + ReSTIR DI/GI + M9 presentation active\n",
                AuthoredCount, TransmissionCount, SubsurfaceCount);
    const Vector3 SunWorld = SkyFog.QuerySunDirectionWorld();
    const Vector3 SunRadiance = SkyFog.QuerySunRadiance();
    const Vector3 MoonWorld = SkyFog.QueryMoonDirectionWorld();
    const Vector3 MoonRadiance = SkyFog.QueryMoonRadiance();
    const Vector3 FogLightWorld = SkyFogIntegrator::WorldFromRender(SkyFog.QueryFogLightDirection());
    const Vector3 SkyAmbient = SkyFog.QueryAmbientRadiance();
    const float FogFar = SkyFog.QueryFogFarDistance();
    std::printf("[Project-Zero CPU] sun=(%.2f,%.2f,%.2f) radiance=(%.2f,%.2f,%.2f) sky=%s\n",
                SunWorld.x, SunWorld.y, SunWorld.z, SunRadiance.x, SunRadiance.y, SunRadiance.z,
                SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(SunWorld)).x > 0.0f ? "on" : "off");

    // Phase 1: Visibility Buffer Primary Ray Trace from Active Camera
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            RayStructure PrimaryRay = GeneratePrimaryRay(ActiveCamera, x, y, 0.5f, 0.5f);
            PrimaryHits[idx] = Scene.EvaluateIntersection(PrimaryRay);
        }
    }

    // Phase 2: Direct Sun Illumination with Shadow Segment Test
    std::vector<Vector3> DirectLight(Width * Height, Vector3{ 0.0f, 0.0f, 0.0f });
    constexpr Vector3 GridLightCenter{ -10.1220f, -20.3625f, 5.6f };
    constexpr Vector3 GridLightRadiance{ 120.0f, 120.0f, 120.0f };
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            const auto& Hit = PrimaryHits[idx];
            const RayStructure PrimaryRay = GeneratePrimaryRay(ActiveCamera, x, y, 0.5f, 0.5f);

            if (!Hit.ValidCondition)
            {
                continue;
            }

            const auto& Mat = Materials[Hit.MaterialIndex];
            const float SunCos = std::max(0.0f, OrientationClassifier::DotProduct(Hit.SurfaceNormal, SunWorld));
            const float SunVisible = Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 0.001f, Hit.HitLocation + SunWorld * 1000.0f) ? 0.0f : 1.0f;
            const float MoonCos = std::max(0.0f, OrientationClassifier::DotProduct(Hit.SurfaceNormal, MoonWorld));
            const float MoonVisible = Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 0.001f, Hit.HitLocation + MoonWorld * 1000.0f) ? 0.0f : 1.0f;
            const float CloudShade = SkyFog.QueryCloudShadow(Hit.HitLocation, SunWorld);
            PhotometricReservoir DirectReservoir{};
            Vector3 SunCandidate{ 0.0f, 0.0f, 0.0f };
            Vector3 MoonCandidate{ 0.0f, 0.0f, 0.0f };
            Vector3 BackCandidate{ 0.0f, 0.0f, 0.0f };
            Vector3 GridLightCandidate{ 0.0f, 0.0f, 0.0f };
            const bool Authored = Hit.MaterialIndex < HasAuthoredMaterial.size() && HasAuthoredMaterial[Hit.MaterialIndex] != 0u;
            const bool Unlit = Authored && AuthoredUnlit[Hit.MaterialIndex] != 0u;
            if (Authored)
            {
                const auto& Record = AuthoredRecords[Hit.MaterialIndex];
                const Vector3 View = Vector3{ -PrimaryRay.RayDirection.x, -PrimaryRay.RayDirection.y, -PrimaryRay.RayDirection.z };
                if (Unlit)
                {
                    DirectLight[idx] = Mat.AlbedoColor + Mat.EmissiveRadiance;
                    DirectReservoirs[idx] = DirectReservoir;
                    continue;
                }
                const Vector3 SunF = CpuMaterial::Evaluate(Record, Hit.SurfaceNormal, View, SunWorld);
                const Vector3 MoonF = CpuMaterial::Evaluate(Record, Hit.SurfaceNormal, View, MoonWorld);
                SunCandidate = SunF * SunRadiance * (SunVisible * CloudShade);
                MoonCandidate = MoonF * MoonRadiance * MoonVisible;

                // Transmission and M5 SSS are below-surface arms of the same MaterialEvaluation.slang record. The
                // sky supplies the CPU reference's missing far-side visibility; this is not a flat base-colour path.
                const Vector3 Back = Vector3{ -Hit.SurfaceNormal.x, -Hit.SurfaceNormal.y, -Hit.SurfaceNormal.z };
                const Vector3 ThroughF = CpuMaterial::Evaluate(Record, Hit.SurfaceNormal, View, Back);
                const Vector3 BackSky = SkyFog.ComputeSkyRadiance(SkyFogIntegrator::RenderFromWorld(Back));
                BackCandidate = ThroughF * BackSky;
                // Add the authored environment/reflection arm to the same direct reservoir. Without this, a sun-only
                // candidate makes conductors depend on one tiny highlight and turns glass into a tinted sphere;
                // sky, moon and cloud lighting are part of the original Showcase and must illuminate the new grid.
                BackCandidate += AuthoredEnvironmentBounce(Record, Hit.SurfaceNormal, View, SkyFog);
                BackCandidate += AuthoredTransmissionBounce(Scene, Materials, AuthoredRecords, HasAuthoredMaterial,
                                                            Record, Hit.HitLocation, Hit.SurfaceNormal, View,
                                                            SkyFog, SunWorld, SunRadiance);

                // The combined default keeps the grid's emissive luminaire. Sample it explicitly for the CPU DI
                // reference; the Vulkan ReSTIR kernel discovers the same emissive triangles from the scene records.
                const Vector3 ToGridLight = GridLightCenter - Hit.HitLocation;
                const float GridDistance2 = std::max(0.01f, ToGridLight.LengthSquared());
                const Vector3 GridDirection = ToGridLight / std::sqrt(GridDistance2);
                const float GridVisible = Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 0.001f,
                                                                   GridLightCenter) ? 0.0f : 1.0f;
                const float EmitterCosine = std::max(0.0f, GridDirection.z);
                const Vector3 GridF = CpuMaterial::Evaluate(Record, Hit.SurfaceNormal, View, GridDirection);
                GridLightCandidate = GridF * GridLightRadiance * (GridVisible * EmitterCosine * 9.2f / GridDistance2);
            }
            else
            {
                // Legacy analytical shapes keep their original pinned Lambert material response, but still pass their
                // sun and moon candidates through the same CPU DI reservoir as the authored grid.
                SunCandidate = Mat.AlbedoColor * (SunRadiance * (SunCos * SunVisible * CloudShade));
                MoonCandidate = Mat.AlbedoColor * (MoonRadiance * (MoonCos * MoonVisible));
            }

            const auto Target = [](const Vector3& Value) noexcept
            {
                return std::max(0.0f, 0.2126f * Value.x + 0.7152f * Value.y + 0.0722f * Value.z);
            };
            const float SunTarget = Target(SunCandidate);
            const float MoonTarget = Target(MoonCandidate);
            const float BackTarget = Target(BackCandidate);
            const float GridLightTarget = Target(GridLightCandidate);
            DirectReservoir.ResampleCandidate(Hit.HitLocation + SunWorld * 1000.0f, SunCandidate, SunTarget, Dist(Rng));
            DirectReservoir.ResampleCandidate(Hit.HitLocation + MoonWorld * 1000.0f, MoonCandidate, MoonTarget, Dist(Rng));
            if (Authored) DirectReservoir.ResampleCandidate(Hit.HitLocation - Hit.SurfaceNormal, BackCandidate, BackTarget, Dist(Rng));
            if (Authored) DirectReservoir.ResampleCandidate(GridLightCenter, GridLightCandidate, GridLightTarget, Dist(Rng));
            if (DirectReservoir.SampleCount > 0u && DirectReservoir.SelectedTarget > 1e-7f)
            {
                DirectReservoir.UnbiasedWeight = DirectReservoir.WeightSum /
                                                  (static_cast<float>(DirectReservoir.SampleCount) * DirectReservoir.SelectedTarget);
                DirectLight[idx] = Mat.EmissiveRadiance + DirectReservoir.SampledRadiance * DirectReservoir.UnbiasedWeight;
            }
            else
            {
                DirectLight[idx] = Mat.EmissiveRadiance + SunCandidate + MoonCandidate + BackCandidate;
            }
            DirectReservoirs[idx] = DirectReservoir;
        }
    }

    // Authored transport continuation. ReSTIR DI above still owns the first-hit direct candidates; this companion
    // path supplies the reflected/refracted radiance that a Lambert-only composition cannot represent. It is kept
    // separate from FilteredIndirect so the legacy showcase field and its ReSTIR proof remain unchanged.
    std::vector<Vector3> AuthoredIndirect(Width * Height, Vector3{ 0.0f, 0.0f, 0.0f });
    // High-quality CPU reference: authored transmission/reflection is a Monte Carlo path, so four samples made the
    // grid plinth and glass look like striped flat textures. Match the M8 budget instead of hiding the variance with
    // a heuristic material multiplier: the default four spatial passes render 32 continuation samples per pixel.
    const uint32_t PathSamples = std::clamp(std::max(8u, SpatialPassCount * 8u), 8u, 32u);
    const uint32_t PathDepth = std::clamp(BounceCount, 2u, 8u);
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            const size_t idx = static_cast<size_t>(y) * Width + x;
            const HitIntersection& Hit = PrimaryHits[idx];
            if (!Hit.ValidCondition || Hit.MaterialIndex >= HasAuthoredMaterial.size() ||
                HasAuthoredMaterial[Hit.MaterialIndex] == 0u)
                continue;
            const RayStructure PrimaryRay = GeneratePrimaryRay(ActiveCamera, x, y, 0.5f, 0.5f);
            const Vector3 View{ -PrimaryRay.RayDirection.x, -PrimaryRay.RayDirection.y, -PrimaryRay.RayDirection.z };
            AuthoredIndirect[idx] = TraceAuthoredIndirect(Scene, Materials, AuthoredRecords, HasAuthoredMaterial, SkyFog,
                                                           SunWorld, SunRadiance, MoonWorld, MoonRadiance,
                                                           Hit.HitLocation, Hit.SurfaceNormal, View, Hit.MaterialIndex,
                                                           PathSamples, PathDepth,
                                                           static_cast<uint32_t>(idx * 2654435761u + 0x9E3779B9u));
        }
    }
    std::vector<Vector3> FilteredAuthoredIndirect = AtrousAuthoredIndirect(AuthoredIndirect, PrimaryHits,
                                                                            HasAuthoredMaterial, Width, Height);

    // Phase 3: ReSTIR GI Initial Candidate Bounce Ray Tracing (8 samples)
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            const auto& Hit = PrimaryHits[idx];
            IndirectGIReservoir GIReservoir{ Vector3{ 0.0f, 0.0f, 0.0f }, Vector3{ 0.0f, 0.0f, 1.0f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.0f, 0, 0.0f, 0.0f };

            if (!Hit.ValidCondition)
            {
                IndirectReservoirs[idx] = GIReservoir;
                continue;
            }

            for (uint32_t s = 0; s < BounceCount; ++s)
            {
                Vector3 BounceDir = SampleCosineHemisphere(Hit.SurfaceNormal, Dist(Rng), Dist(Rng));
                RayStructure BounceRay{ Hit.HitLocation + Hit.SurfaceNormal * 0.001f, BounceDir, 0.001f, 200.0f };

                HitIntersection BounceHit = Scene.EvaluateIntersection(BounceRay);
                Vector3 BounceRadiance{ 0.0f, 0.0f, 0.0f };
                Vector3 BouncePos = BounceRay.SpatialOrigin;
                Vector3 BounceNormal = BounceDir;
                if (BounceHit.ValidCondition)
                {
                    const auto& BounceMat = Materials[BounceHit.MaterialIndex];
                    float BounceSunCos = std::max(0.0f, OrientationClassifier::DotProduct(BounceHit.SurfaceNormal, SunWorld));
                    float BounceSunVis = Scene.EvaluateOcclusion(BounceHit.HitLocation + BounceHit.SurfaceNormal * 0.001f, BounceHit.HitLocation + SunWorld * 1000.0f) ? 0.0f : 1.0f;
                    float BounceMoonCos = std::max(0.0f, OrientationClassifier::DotProduct(BounceHit.SurfaceNormal, MoonWorld));
                    float BounceMoonVis = Scene.EvaluateOcclusion(BounceHit.HitLocation + BounceHit.SurfaceNormal * 0.001f, BounceHit.HitLocation + MoonWorld * 1000.0f) ? 0.0f : 1.0f;
                    float BounceCloudShade = SkyFog.QueryCloudShadow(BounceHit.HitLocation, SunWorld);
                    if (BounceHit.MaterialIndex < HasAuthoredMaterial.size() && HasAuthoredMaterial[BounceHit.MaterialIndex] != 0u &&
                        AuthoredUnlit[BounceHit.MaterialIndex] == 0u)
                    {
                        const auto& BounceRecord = AuthoredRecords[BounceHit.MaterialIndex];
                        const Vector3 BounceView = Vector3{ -BounceDir.x, -BounceDir.y, -BounceDir.z };
                        const Vector3 SunF = CpuMaterial::Evaluate(BounceRecord, BounceHit.SurfaceNormal, BounceView, SunWorld);
                        const Vector3 MoonF = CpuMaterial::Evaluate(BounceRecord, BounceHit.SurfaceNormal, BounceView, MoonWorld);
                        BounceRadiance = SunF * SunRadiance * (BounceSunVis * BounceCloudShade)
                                       + MoonF * MoonRadiance * BounceMoonVis
                                       + SkyAmbient;
                    }
                    else
                    {
                        BounceRadiance = BounceMat.AlbedoColor * (SunRadiance * (BounceSunCos * BounceSunVis * BounceCloudShade) + MoonRadiance * (BounceMoonCos * BounceMoonVis) + SkyAmbient);
                    }
                    BouncePos = BounceHit.HitLocation;
                    BounceNormal = BounceHit.SurfaceNormal;
                }
                else
                {
                    // Open sky above the bounce point: bare diffuse sky
                    // ambient (the primary albedo applies at composition).
                    BounceRadiance = SkyAmbient;
                }

                float Weight = (BounceRadiance.x + BounceRadiance.y + BounceRadiance.z) * 0.3333f;
                GIReservoir.ResampleIndirect(BouncePos, BounceNormal, BounceRadiance, Weight, Dist(Rng));
            }

            if (GIReservoir.WeightSum > 0.0f && GIReservoir.SampleCount > 0)
            {
                GIReservoir.UnbiasedWeight = GIReservoir.WeightSum / static_cast<float>(GIReservoir.SampleCount);
            }

            IndirectReservoirs[idx] = GIReservoir;
        }
    }

    // Phase 4: ReSTIR GI Spatial Resampling Pass with Jacobian Shift
    std::vector<IndirectGIReservoir> SpatialIndirectReservoirs = IndirectReservoirs;
    for (uint32_t pass = 0; pass < SpatialPassCount; ++pass)
    {
        for (uint32_t y = 0; y < Height; ++y)
        {
            for (uint32_t x = 0; x < Width; ++x)
            {
                size_t idx = y * Width + x;
                const auto& CenterHit = PrimaryHits[idx];
                if (!CenterHit.ValidCondition)
                {
                    continue;
                }

                IndirectGIReservoir SpatialGI = IndirectReservoirs[idx];

                for (uint32_t n = 0; n < 8; ++n)
                {
                    int nx = static_cast<int>(x) + (static_cast<int>(Rng() % 11) - 5);
                    int ny = static_cast<int>(y) + (static_cast<int>(Rng() % 11) - 5);

                    if (nx < 0 || nx >= static_cast<int>(Width) || ny < 0 || ny >= static_cast<int>(Height))
                    {
                        continue;
                    }

                    size_t nIdx = static_cast<size_t>(ny) * Width + static_cast<size_t>(nx);
                    const auto& NeighborHit = PrimaryHits[nIdx];

                    if (!NeighborHit.ValidCondition)
                    {
                        continue;
                    }
                    if (OrientationClassifier::DotProduct(CenterHit.SurfaceNormal, NeighborHit.SurfaceNormal) < 0.90f)
                    {
                        continue;
                    }
                    if (std::abs(CenterHit.RayDistance - NeighborHit.RayDistance) > 1.00f)
                    {
                        continue;
                    }

                    const auto& NeighborGI = IndirectReservoirs[nIdx];
                    if (NeighborGI.WeightSum <= 0.0f)
                    {
                        continue;
                    }

                    float Jacobian = EvaluateJacobian(NeighborHit.HitLocation, CenterHit.HitLocation, NeighborGI.BounceHitPosition, NeighborGI.BounceHitNormal);
                    float ShiftedWeight = (NeighborGI.IndirectRadiance.x + NeighborGI.IndirectRadiance.y + NeighborGI.IndirectRadiance.z) * 0.3333f * NeighborGI.UnbiasedWeight * Jacobian;

                    SpatialGI.ResampleIndirect(NeighborGI.BounceHitPosition, NeighborGI.BounceHitNormal, NeighborGI.IndirectRadiance, ShiftedWeight, Dist(Rng));
                }

                const uint32_t MCap = 20u * (BounceCount > 0u ? BounceCount : 1u);
                if (SpatialGI.SampleCount > MCap)
                {
                    SpatialGI.WeightSum *= static_cast<float>(MCap) / static_cast<float>(SpatialGI.SampleCount);
                    SpatialGI.SampleCount = MCap;
                }

                if (SpatialGI.WeightSum > 0.0f && SpatialGI.SampleCount > 0)
                {
                    SpatialGI.UnbiasedWeight = SpatialGI.WeightSum / static_cast<float>(SpatialGI.SampleCount);
                }

                SpatialIndirectReservoirs[idx] = SpatialGI;
            }
        }
        IndirectReservoirs = SpatialIndirectReservoirs;
    }

    // Phase 5: Indirect Radiosity Bilateral Spatial Filtering
    std::vector<Vector3> FilteredIndirect(Width * Height, Vector3{ 0.0f, 0.0f, 0.0f });
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            const auto& CenterHit = PrimaryHits[idx];

            if (!CenterHit.ValidCondition)
            {
                continue;
            }

            Vector3 IndirectAcc{ 0.0f, 0.0f, 0.0f };
            float   WeightTotal = 0.0f;

            for (int dy = -3; dy <= 3; ++dy)
            {
                for (int dx = -3; dx <= 3; ++dx)
                {
                    int qx = static_cast<int>(x) + dx;
                    int qy = static_cast<int>(y) + dy;

                    if (qx < 0 || qx >= static_cast<int>(Width) || qy < 0 || qy >= static_cast<int>(Height))
                    {
                        continue;
                    }

                    size_t qIdx = static_cast<size_t>(qy) * Width + static_cast<size_t>(qx);
                    const auto& NeighborHit = PrimaryHits[qIdx];

                    if (!NeighborHit.ValidCondition)
                    {
                        continue;
                    }

                    float SpatialDistSq = static_cast<float>(dx * dx + dy * dy);
                    float SpatialW = std::exp(-SpatialDistSq / 9.0f);

                    float NormalDot = std::max(0.0f, OrientationClassifier::DotProduct(CenterHit.SurfaceNormal, NeighborHit.SurfaceNormal));
                    float NormalW = std::pow(NormalDot, 16.0f);

                    float DepthDiff = std::abs(CenterHit.RayDistance - NeighborHit.RayDistance);
                    float DepthW = std::exp(-DepthDiff * 3.0f);

                    float TotalW = SpatialW * NormalW * DepthW;
                    const auto& GIRes = IndirectReservoirs[qIdx];
                    if (GIRes.WeightSum > 0.0f && GIRes.KeptWeight > 1e-6f)
                    {
                        // Each neighbor shades its own unbiased RIS estimate
                        // (kept radiance times W over kept target weight); the
                        // bilateral kernel averages estimates, not raw samples.
                        float NormRatio = std::min(GIRes.UnbiasedWeight / GIRes.KeptWeight, 8.0f);
                        Vector3 Estimate = GIRes.IndirectRadiance * NormRatio;
                        IndirectAcc += Estimate * TotalW;
                        WeightTotal += TotalW;
                    }
                }
            }

            if (WeightTotal > 0.0f)
            {
                FilteredIndirect[idx] = IndirectAcc * (1.0f / WeightTotal);
            }
        }
    }

    // Phase 6: Radiance Composition with Aerial Perspective and Fog March
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            const auto& Hit = PrimaryHits[idx];
            RayStructure PrimaryRay = GeneratePrimaryRay(ActiveCamera, x, y, 0.5f, 0.5f);
            const Vector3 RenderOrigin = SkyFogIntegrator::RenderFromWorld(PrimaryRay.SpatialOrigin);
            const Vector3 RenderDir = SkyFogIntegrator::RenderFromWorld(PrimaryRay.RayDirection);

            if (!Hit.ValidCondition)
            {
                const Vector3 MidPoint = PrimaryRay.SpatialOrigin + PrimaryRay.RayDirection * (FogFar * 0.5f);
                float FogVisible = Scene.EvaluateOcclusion(MidPoint, MidPoint + FogLightWorld * 1000.0f) ? 0.0f : 1.0f;
                float Transmittance = 1.0f;
                Vector3 Scatter = SkyFog.MarchFog(RenderOrigin, RenderDir, 0.0f, FogFar, FogVisible, Transmittance);
                // Below-horizon misses sample the horizon zenith instead of
                // the panel underground: distant haze, not a black seam.
                Vector3 SkyDir = RenderDir;
                if (SkyDir.y < 0.0f)
                {
                    SkyDir.y = 0.0f;
                    float SkyLenSq = SkyDir.x * SkyDir.x + SkyDir.z * SkyDir.z;
                    SkyDir = (SkyLenSq > 1e-12f) ? SkyDir / std::sqrt(SkyLenSq) : RenderDir;
                }
                Vector3 Sky = SkyFog.ComputeSkyRadiance(SkyDir);
                AccumulatedBuffer[idx] = Scatter + Sky * Transmittance;
                continue;
            }

            const auto& HitMat = Materials[Hit.MaterialIndex];
            Vector3 Surface;
            if (Hit.MaterialIndex < HasAuthoredMaterial.size() && HasAuthoredMaterial[Hit.MaterialIndex] != 0u &&
                AuthoredUnlit[Hit.MaterialIndex] == 0u)
            {
                const CpuMaterial::ShadingRecord& Record = AuthoredRecords[Hit.MaterialIndex];
                // ReSTIR GI remains the low-noise diffuse base. The exact BSDF continuation supplies reflected and
                // refracted transport for the non-Lambert arms, so metal, coat, thin-film and glass cannot collapse
                // to a flat albedo when the GPU/CPU showcase is rendered without a Vulkan device.
                // The authored continuation already contains the BSDF throughput for every selection. Do not gate it
                // by a heuristic "transport" factor: that silently erased rough-plastic diffuse bounce, coat energy,
                // and most thin-film/glass contribution, leaving exactly the flat-looking albedo image this CPU path
                // used to produce. The shared record and M8/M9 filter own the weighting.
                Surface = DirectLight[idx] + CpuMaterial::IndirectAlbedo(Record) * FilteredIndirect[idx]
                        + FilteredAuthoredIndirect[idx];
            }
            else if (Hit.MaterialIndex < HasAuthoredMaterial.size() && AuthoredUnlit[Hit.MaterialIndex] != 0u)
                Surface = DirectLight[idx];
            else
                Surface = DirectLight[idx] + HitMat.AlbedoColor * FilteredIndirect[idx];
            Vector3 Aerial = SkyFog.ApplyAerialPerspective(Surface, RenderOrigin, RenderDir, Hit.RayDistance);
            const Vector3 MidPoint = PrimaryRay.SpatialOrigin + PrimaryRay.RayDirection * (Hit.RayDistance * 0.5f);
            float FogVisible = Scene.EvaluateOcclusion(MidPoint, MidPoint + FogLightWorld * 1000.0f) ? 0.0f : 1.0f;
            float Transmittance = 1.0f;
            Vector3 Scatter = SkyFog.MarchFog(RenderOrigin, RenderDir, 0.0f, Hit.RayDistance, FogVisible, Transmittance);
            AccumulatedBuffer[idx] = Scatter + Aerial * Transmittance;
        }
    }

    // Phase 7: M9 presentation. Reprojection is a GPU history operation; the one-shot CPU reference has no prior
    // frame, so it records the default-on state but keeps the first-frame accumulation unchanged. The denoiser is
    // fully exercised here over the composed pixel buffer, after authored BSDF transport and before lens flare.
    (void)ReprojectionEnabled;
    if (DenoiseEnabled)
        AccumulatedBuffer = AtrousFrame(AccumulatedBuffer, PrimaryHits, Width, Height);

    // Lens flare is a post effect and must remain sharp, so it is composited after the à-trous presentation pass.
    if (FlareEnabled)
    {
        float SunElevDeg = std::asin(std::clamp(SunWorld.z, -1.0f, 1.0f)) * 57.295779513f;
        ApplyLensFlare(ActiveCamera, SunWorld, SunElevDeg, SkyFog.QuerySunFlareTint(), FlareVariety);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  IMAGE EXPORT
//------------------------------------------------------------------------------------------------------------------------

void RendererHost::ApplyLensFlare(const Frontier::CameraProjection& ActiveCamera, const Vector3& SunWorld,
    float SunElevationDeg, const Vector3& SunFlareTint, float FlareVariety) noexcept
{
    FlarePostConfig FlareCfg = FlarePostDefaults();
    FlareCfg.variety = FlareVariety;

    const float TanHalf = std::tan(ActiveCamera.QueryFieldOfViewRadians() * 0.5f);
    const float Aspect = ActiveCamera.QueryAspectRatio();
    const Vector3& Fwd = ActiveCamera.QueryForwardVector();
    const Vector3& Rgt = ActiveCamera.QueryRightVector();
    const Vector3& Up = ActiveCamera.QueryUpwardVector();

    // Reference `AddLensFlare` projection: the panel flares the sun only, so
    // the showcase does the same — moon and stars never carry flare, and a
    // sun behind the camera (or below the horizon ramp) contributes nothing.
    const float SunCx = OrientationClassifier::DotProduct(SunWorld, Rgt);
    const float SunCy = OrientationClassifier::DotProduct(SunWorld, Up);
    const float SunCz = OrientationClassifier::DotProduct(SunWorld, Fwd);
    const bool SunFront = SunCz > 0.02f;
    const float SunU = SunFront ? SunCx / SunCz / TanHalf : 99.0f;
    const float SunV = SunFront ? SunCy / SunCz / TanHalf : 99.0f;
    const float SunVis = FlareSourceVisibility(SunCz, SunElevationDeg, SunU, SunV);

    if (SunVis <= 0.0f)
    {
        return;
    }

    for (uint32_t y = 0; y < Height; ++y)
    {
        float v = 1.0f - (static_cast<float>(y) + 0.5f) / static_cast<float>(Height) * 2.0f;
        for (uint32_t x = 0; x < Width; ++x)
        {
            float u = ((static_cast<float>(x) + 0.5f) / static_cast<float>(Width) * 2.0f - 1.0f) * Aspect;
            size_t idx = static_cast<size_t>(y) * Width + x;
            float3 sunF = FlareLensKernel(u, v, SunU, SunV, SunVis, FlareCfg);
            AccumulatedBuffer[idx].x += sunF.x * SunFlareTint.x;
            AccumulatedBuffer[idx].y += sunF.y * SunFlareTint.y;
            AccumulatedBuffer[idx].z += sunF.z * SunFlareTint.z;
        }
    }
}

bool RendererHost::ExportPpmImage(const std::string& OutputPath) const noexcept
{
    std::ofstream Out(OutputPath, std::ios::binary);
    if (!Out.is_open())
    {
        return false;
    }

    Out << "P6\n" << Width << " " << Height << "\n255\n";

    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = y * Width + x;
            Vector3 Radiance = AccumulatedBuffer[idx];

            // ACES Film Tone Mapping Curve
            auto AcesFilm = [](float x) -> float
            {
                float a = 2.51f;
                float b = 0.03f;
                float c = 2.43f;
                float d = 0.59f;
                float e = 0.14f;
                return std::clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0f, 1.0f);
            };

            float r = AcesFilm(Radiance.x * ToneExposure);
            float g = AcesFilm(Radiance.y * ToneExposure);
            float b = AcesFilm(Radiance.z * ToneExposure);

            // Gamma 2.2 correction
            constexpr float InvGamma = 1.0f / 2.2f;
            r = std::pow(r, InvGamma);
            g = std::pow(g, InvGamma);
            b = std::pow(b, InvGamma);

            uint8_t R8 = static_cast<uint8_t>(std::clamp(r * 255.0f, 0.0f, 255.0f));
            uint8_t G8 = static_cast<uint8_t>(std::clamp(g * 255.0f, 0.0f, 255.0f));
            uint8_t B8 = static_cast<uint8_t>(std::clamp(b * 255.0f, 0.0f, 255.0f));

            Out.put(static_cast<char>(R8));
            Out.put(static_cast<char>(G8));
            Out.put(static_cast<char>(B8));
        }
    }

    return true;
}

// The gated panel post chain (exposure, tonemap, vignette) so the
// showcase matches the harness proof frames pixel-structure. Single
// shared LDR core: both the PPM file export and the live window feed
// on these exact bytes, so the window shows what the proofs show.
void RendererHost::ExportLdrPixels(std::vector<uint8_t>& OutRgba) const noexcept
{
    OutRgba.resize(static_cast<size_t>(Width) * static_cast<size_t>(Height) * 4U);
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            size_t idx = static_cast<size_t>(y) * Width + x;
            Vector3 Display = SkyFog.ApplyPanelPost(AccumulatedBuffer[idx], x, y, Width, Height);

            size_t o = idx * 4U;
            OutRgba[o + 0U] = static_cast<uint8_t>(std::clamp(Display.x * 255.0f, 0.0f, 255.0f));
            OutRgba[o + 1U] = static_cast<uint8_t>(std::clamp(Display.y * 255.0f, 0.0f, 255.0f));
            OutRgba[o + 2U] = static_cast<uint8_t>(std::clamp(Display.z * 255.0f, 0.0f, 255.0f));
            OutRgba[o + 3U] = 255U;
        }
    }
}

bool RendererHost::ExportShowcaseImage(const std::string& OutputPath) const noexcept
{
    std::ofstream Out(OutputPath, std::ios::binary);
    if (!Out.is_open())
    {
        return false;
    }

    Out << "P6\n" << Width << " " << Height << "\n255\n";

    std::vector<uint8_t> LdrRgba;
    ExportLdrPixels(LdrRgba);
    for (size_t i = 0; i < LdrRgba.size(); i += 4U)
    {
        Out.put(static_cast<char>(LdrRgba[i + 0U]));
        Out.put(static_cast<char>(LdrRgba[i + 1U]));
        Out.put(static_cast<char>(LdrRgba[i + 2U]));
    }

    return true;
}

} // namespace Frontier::ProjectZero
