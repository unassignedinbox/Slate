//============================================================================================================================================
//                                                          SKYGLASSPROOF.CPP
//============================================================================================================================================
// 🧩 M9 — the sky-backed outdoor glass proof, the last open M9 item (plan §4). The sky/moon/post records were
//    already guarded for the CPU port; this exhibit is the consumer that makes the seam earn its guard.
//
//    §A  Seam parity — SkyRecords/MoonRecords/PostRecords.slang included 1:1 over the HOST-PACKED record
//        (PackSkyConstants, the only place a celestial value becomes GPU bytes): SkyRadiance/Transmittance ==
//        AtmosphereModel::Integrate over a 400-direction sweep (the "three consumers of the same model"
//        discipline, now enforced on every call the kernel can make); the off-flags (stars by daylight, no
//        moons, no rain, no flare) return exact zeros through the same guards the GPU uses.
//    §B  Sun-arm parity — the kernel's sun candidate against the real record: SunEmission = SkySunDirect/Ω
//        (the packed panel direct-sun factor), the K5 arm's W_L fold, on wax below.
//    §C  Sky-dome closure — the kernel's GI seam (one BSDF-sampled walk, escape → SkyAlong at weight 1, the
//        K5 sun arm alongside) closes on brute-force environment MC for wax / mixed T+SSS / solid glass /
//        foil glass. The sun disc's heavy MC tail lives in BOTH sides and the gate is joint 5σ (the §B
//        MaterialReuseProof pattern). This is the estimator the outdoor frames actually run.
//    §D  Foil-sky invariant — the thin-wall BTDF's transmitted sky at the rig's centre ray equals
//        (1−F)²·transmittance·sky within the pixel's own accumulated noise — transmittance tint, not a
//        second estimator.
//    §E  Visual sheet — a CPU tracer mirroring the kernel's direct + GI structure (sun NEE with the coin,
//        K5 below arm at W_L, GI walk with escape → SkyAlong, K4 solid walk with Beer over true segments,
//        exit R/T continuation, 1:1 AtrousDenoise ToneMap): the sky panorama, the rig on black (the pre-M9
//        background), the sky-backed rig, and the 1-spp noisy frame the denoiser/reprojection exist for.
//        Gates: the panorama re-computes bitwise along its rays; sky-backed vs black differ; the glass
//        sphere's centre transmits the sky it refracts.
//
//    Build: g++ -std=c++20 -O2 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation
//        -I Engine/Shaders -I Exhibits/Workbench/Editor SkyGlassProof.cpp
//        Engine/DisplayPresentation/ShadingTableCodec.cpp -o /tmp/SkyGlassProof -pthread
//    GPU render-verification stays user-side (no GPU in the sandbox), as everywhere since K0.

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"
#include "SkyConstantRecord.h"   // the host packer (PackSkyConstants) + AtmosphereModel — the proof packs through it

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                         CPU-only scalar/vector overloads the shader files take for granted
//------------------------------------------------------------------------------------------------------------------------

namespace CpuPortMath {

struct uvec2;   // (defined just below; ivec2 converts from it)

// Integral-only min/max/abs: the templates fail substitution on floating types (SFINAE), so the shim's float/vec
//    overloads stay unambiguous inside the shader includes.
template <typename T> inline typename std::enable_if<std::is_integral<T>::value, T>::type abs(T x) { return x < T(0) ? -x : x; }
template <typename T> inline typename std::enable_if<std::is_integral<T>::value, T>::type max(T a, T b) { return a > b ? a : b; }
template <typename T> inline typename std::enable_if<std::is_integral<T>::value, T>::type min(T a, T b) { return a < b ? a : b; }

struct ivec2
{
    int x, y;
    ivec2() : x(0), y(0) {}
    ivec2(int s) : x(s), y(s) {}
    ivec2(int x_, int y_) : x(x_), y(y_) {}
    ivec2(const uvec2& u);
};
struct uvec2
{
    unsigned int x, y;
    uvec2() : x(0u), y(0u) {}
    uvec2(unsigned int x_, unsigned int y_) : x(x_), y(y_) {}
};
inline ivec2::ivec2(const uvec2& u) : x(int(u.x)), y(int(u.y)) {}

inline ivec2 operator+(ivec2 a, ivec2 b) { return ivec2(a.x + b.x, a.y + b.y); }
inline ivec2 operator-(ivec2 a, ivec2 b) { return ivec2(a.x - b.x, a.y - b.y); }
inline ivec2 operator*(ivec2 a, int s)   { return ivec2(a.x * s, a.y * s); }
inline uvec2 operator-(uvec2 a, unsigned s) { return uvec2(a.x - s, a.y - s); }
inline ivec2 clamp(ivec2 v, ivec2 lo, ivec2 hi)
{
    return ivec2(v.x < lo.x ? lo.x : (v.x > hi.x ? hi.x : v.x),
                 v.y < lo.y ? lo.y : (v.y > hi.y ? hi.y : v.y));
}

} // namespace CpuPortMath

using namespace CpuPortMath;

//------------------------------------------------------------------------------------------------------------------------
//                                                       HARNESS
//------------------------------------------------------------------------------------------------------------------------

namespace {

int g_Pass = 0, g_Fail = 0;

#define CHECK(Cond, ...)                                                                                        \
    do { if (!(Cond)) { ++g_Fail; std::printf("  FAIL "); std::printf(__VA_ARGS__); std::printf("\n"); }        \
         else { ++g_Pass; std::printf("  ok "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

uint64_t g_Rng = 0x9E3779B97F4A7C15ull;   // splitmix64 state (fixed seed → deterministic)

float Rand01()
{
    uint64_t z = (g_Rng += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    z = z ^ (z >> 31);
    return static_cast<float>((z >> 11) * (1.0 / 9007199254740992.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                            THE REAL BSDF (MaterialEvaluation.slang, 1:1, baked tables)
//------------------------------------------------------------------------------------------------------------------------

const Frontier::ShadingTableSet* g_Tables = nullptr;

inline vec3 FetchEnergy(float mu, float alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleEnergy(*g_Tables, mu, alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec3 FetchSheen(float mu, float alpha)
{
    float Out[3] = { 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheen(*g_Tables, mu, alpha, Out);
    return vec3(Out[0], Out[1], Out[2]);
}

inline vec4 FetchSheenFull(float mu, float alpha)
{
    float Out[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    Frontier::ShadingTableCodec::SampleSheenFull(*g_Tables, mu, alpha, Out);
    return vec4(Out[0], Out[1], Out[2], Out[3]);
}

#include "MaterialEvaluation.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                   MATERIALS (the furnace's own helpers)
//------------------------------------------------------------------------------------------------------------------------

ShadingRecord StandardMaterial(vec3 albedo, float roughness)
{
    ShadingRecord m;
    m.BaseColor = albedo; m.Metalness = 0.0f; m.DiffuseRoughness = 0.0f;
    m.SpecularWeight = 1.0f; m.SpecularColor = vec3(1.0f); m.SpecularRoughness = roughness;
    m.SpecularAnisotropy = 0.0f; m.AnisotropyAngle = 0.0f; m.SpecularIor = 1.5f;
    m.ThinFilmWeight = 0.0f; m.ThinFilmThickness = 0.5f; m.ThinFilmIor = 1.4f;
    m.HazinessWeight = 0.0f; m.HazinessRoughness = 0.5f;
    m.CoatWeight = 0.0f; m.CoatColor = vec3(1.0f); m.CoatRoughness = 0.0f; m.CoatAnisotropy = 0.0f;
    m.CoatIor = 1.6f; m.CoatDarkening = 1.0f;
    m.CoatTangent = vec3(1.0f, 0.0f, 0.0f); m.CoatNormal = vec3(0.0f, 0.0f, 1.0f);
    m.FuzzWeight = 0.0f; m.FuzzColor = vec3(1.0f); m.FuzzRoughness = 0.5f;
    m.Emission = vec3(0.0f);
    m.TransmissionWeight = 0.0f; m.TransmissionColor = vec3(1.0f);
    m.TransmissionDepth = 0.0f; m.TransmissionThickness = 0.0f;
    m.Selection = kReflectanceStandard;
    m.SssWeight = 0.0f; m.SssColor = vec3(1.0f);
    m.SssRadius = 0.0f; m.SssRadiusScale = vec3(0.0f); m.SssThickness = 0.0f;
    return m;
}

ShadingRecord GlassMaterial(float roughness, float ior, float thickness)
{
    ShadingRecord m = StandardMaterial(vec3(0.0f), roughness);
    m.SpecularIor = ior;
    m.TransmissionWeight = 1.0f;
    m.TransmissionThickness = thickness;   // 0 = foil (thin wall); > 0 = solid (the tracer walks the medium)
    m.Selection = kReflectanceTransmissive;
    return m;
}

ShadingRecord SssMaterial(vec3 base, vec3 rho, float radius, vec3 scale, float thickness, float weight = 1.0f)
{
    ShadingRecord m = StandardMaterial(base, 0.5f);
    m.SssWeight = weight; m.SssColor = rho;
    m.SssRadius = radius; m.SssRadiusScale = scale; m.SssThickness = thickness;
    m.Selection = kReflectanceSubsurface;
    return m;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  THE SKY SEAM (the guarded records, 1:1)
//------------------------------------------------------------------------------------------------------------------------
// The globals are declared in the EXACT order and layout the three uniform blocks carry; the host record fills
//    them straight from PackSkyConstants — no transcribed coefficients (SkyConstantRecord.h's own rule).

// PostConstants (binding 24) + the static star tables (binding 23). Empty catalogue: zeroed cells, no stars,
//    brightness packed 0 alongside — the packer's own doubly-guarded empty day sky.
vec4 PostStar, PostFlare, PostFlare2, PostFlareUv, PostBow, PostBow2, PostSpare0, PostSpare1;
struct StarEntry
{
    vec4 DirLum;   // xyz = unit, equatorial J2000; w = luminance
    vec4 ColPad;   // rgb = linear colour; w = padding
};
uvec2 StarCells[1024];
StarEntry StarStars[1];   // unsized on the GPU; zeroed cells mean this is never indexed

#include "PostRecords.slang"

// MoonConstants (binding 22) + the bindless Textures[] stub the compiler wants (MoonControl.x = 0 keeps the
//    fetch unreachable — the seam note in the file itself).
uvec4 MoonControl, MoonSlots;
vec4 MoonDirection[4], MoonTint[4], MoonParams[4], MoonSurface[4];
sampler2D Textures[1];

#include "MoonRecords.slang"

// SkyConstants (binding 21) — 144 B, filled from the host packer below.
vec4  SkySunDirection, SkySunRadiance, SkyRayleigh, SkyMie, SkyOzone, SkyPlanet, SkyTwilight, SkySunDirect;
uvec4 SkyControl;

#include "SkyRecords.slang"

// The host side of the same block: PackSkyConstants is the ONLY place a celestial value becomes GPU bytes, so
//    the exhibit packs through it and memcpy-shaped-copies the fields into the globals above. Layout is pinned
//    by SkyConstantRecord.h's static_asserts (144 B, vec4 rows), so the copy is row-for-row.
Frontier::SkyConstantRecord g_SkyRecord;
Frontier::AtmosphereMedium  g_Medium;
Frontier::AtmosphereLight   g_Light;

void LoadSky(float SunElevationDeg, float SunAzimuthDeg, bool Enabled)
{
    g_Medium = Frontier::AtmosphereMedium{};                     // the model's own defaults — physics, not taste
    g_Light = Frontier::AtmosphereLight{};
    float Elev = SunElevationDeg * (3.14159265358979323846f / 180.0f);
    float Azim = SunAzimuthDeg * (3.14159265358979323846f / 180.0f);
    g_Light.Direction[0] = std::cos(Elev) * std::sin(Azim);
    g_Light.Direction[1] = std::cos(Elev) * std::cos(Azim);
    g_Light.Direction[2] = std::sin(Elev);
    g_Light.Intensity = 22.0f;                                   // the panel's default
    g_Light.Colour[0] = 1.0f; g_Light.Colour[1] = 0.965f; g_Light.Colour[2] = 0.92f;

    g_SkyRecord = Frontier::PackSkyConstants(g_Medium, g_Light, Frontier::TwilightSettings{},
                                             SunElevationDeg, /*CameraHeightMetres=*/2.0f,
                                             /*ViewSamples=*/16u, /*LightSamples=*/8u, Enabled);
    const float* S[] = { g_SkyRecord.SunDirection, g_SkyRecord.SunRadiance, g_SkyRecord.Rayleigh,
                         g_SkyRecord.Mie, g_SkyRecord.Ozone, g_SkyRecord.Planet,
                         g_SkyRecord.Twilight, g_SkyRecord.SunDirect };
    vec4* Ds[] = { &SkySunDirection, &SkySunRadiance, &SkyRayleigh, &SkyMie,
                   &SkyOzone, &SkyPlanet, &SkyTwilight, &SkySunDirect };
    for (int R = 0; R < 8; ++R)
        *Ds[R] = vec4(S[R][0], S[R][1], S[R][2], S[R][3]);
    SkyControl = uvec4(g_SkyRecord.Control[0], g_SkyRecord.Control[1], g_SkyRecord.Control[2], g_SkyRecord.Control[3]);
    // Post/moon flags: broad daylight, no moons, no rain, no flare — every guard takes the same branch the
    //    GPU would. PostSpare0.x = 0 (pixel spread) keeps the star radius at the raster's floor.
    PostStar  = vec4(0.0f, 0.0f, 1.0f, 0.0f);   // LST, latitude, point size, brightness 0 = off
    PostFlare = vec4(0.0f, 4.0f, 1.0f, 0.3f);
    PostFlare2 = vec4(1.0f, 1.0f, 8.0f, 0.0f);  // sun visibility 0 = off
    PostFlareUv = vec4(0.5f, 0.5f, 0.0f, 0.0f); // enabled 0
    PostBow  = vec4(0.6f, 0.4f, 0.3f, 0.0f);    // rain visibility 0 = off (§A exercises the guard)
    PostBow2 = vec4(1.0f, 50.0f, 1.0f, 0.0f);
    PostSpare0 = vec4(0.0f, 0.0f, 0.0f, 0.0f);
    PostSpare1 = vec4(0.0f, 0.0f, 0.0f, 0.0f);
    MoonControl = uvec4(0u, 0u, 0u, 0u);
    MoonSlots = uvec4(0u, 0u, 0u, 0u);
    for (int i = 0; i < 4; ++i)
    {
        MoonDirection[i] = vec4(0.0f, 0.0f, 1.0f, 0.0f);
        MoonTint[i] = vec4(1.0f, 1.0f, 1.0f, 0.0f);
        MoonParams[i] = vec4(0.0f, 0.0f, 0.0f, 0.0f);
        MoonSurface[i] = vec4(0.0f, 0.0f, 0.0f, 1.0f);
    }
}

// The kernel's sun-solid-angle / disc sampler / emission — verbatim algebra from ReSTIRViewport.slang
//    (SunSolidAngle / SampleSunDirection / SunEmission), shared kSunAngularRadius from the record.
float SunSolidAngle()
{
    const float kPi = 3.14159265358979323846;
    float s = sin(kSunAngularRadius * 0.5);
    return 4.0 * kPi * s * s;
}

vec3 SampleSunDirection(vec3 sunDir, float u1, float u2)
{
    float cosMax = cos(kSunAngularRadius);
    float cosT = mix(1.0, cosMax, u1);
    float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    float phi = 6.28318530718 * u2;
    vec3 up = abs(sunDir.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t = normalize(cross(up, sunDir));
    vec3 b = cross(sunDir, t);
    return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + sunDir * cosT);
}

vec3 SunEmission() { return SkySunDirect.xyz / SunSolidAngle(); }

//------------------------------------------------------------------------------------------------------------------------
//                                        FRAME + §C WALK (the kernel mirrors)
//------------------------------------------------------------------------------------------------------------------------

struct SurfFrame
{
    vec3 Geometric;
    vec3 T, B;
};

SurfFrame BuildFrame(vec3 N)
{
    SurfFrame F;
    F.Geometric = N;
    vec3 Helper = abs(N.z) < 0.9f ? vec3(0.0f, 0.0f, 1.0f) : vec3(1.0f, 0.0f, 0.0f);
    F.T = normalize(cross(Helper, N));
    F.B = cross(N, F.T);
    return F;
}

vec3 ToLocalFrame(const SurfFrame& F, vec3 d) { return vec3(dot(d, F.T), dot(d, F.B), dot(d, F.Geometric)); }
vec3 FromLocalFrame(const SurfFrame& F, vec3 w) { return F.T * w.x + F.B * w.y + F.Geometric * w.z; }

// The kernel's GI escape, as §C drives it: one SampleBsdf draw, the throughput clamp, and the sky collected at
//    weight 1 (ReSTIRViewport.slang's `accumulatedRadiance += throughput * SkyAlong(bounceDir)`). No geometry
//    in the closure rig — the measure is the BSDF's own, and every direction escapes.
vec3 SkyWalk(ShadingRecord m, ResolvedLayers L, vec3 wo, const SurfFrame& F)
{
    vec4 S = SampleBsdf(m, L, wo, vec4(Rand01(), Rand01(), Rand01(), Rand01()));
    if (S.w <= 0.0f) return vec3(0.0f);
    vec3 Beta = EvaluateBsdf(m, L, wo, S.xyz) * (abs(S.z) / max(S.w, 1e-12f));
    Beta = min(Beta, vec3(8.0f));   // the kernel's firefly clamp on the bounce throughput
    return Beta * SkyAlong(FromLocalFrame(F, S.xyz));   // weight 1: the light stratum has no density for the dome
}

// The K5 sun arm (kernel mirror): the disc sample, the below/above gates, pl = pPick/Ω, the MIS fold.
vec3 SunArm(ShadingRecord m, ResolvedLayers L, vec3 wo, const SurfFrame& F, float pPick)
{
    vec3 sDir = SampleSunDirection(SkySunDirection.xyz, Rand01(), Rand01());
    vec3 wi = ToLocalFrame(F, sDir);
    float CosS = wi.z;
    if (L.SssMix > 0.0f ? (CosS >= 0.0f) : (CosS <= 0.0f)) return vec3(0.0f);
    // Above-horizon: the standard DI candidate (f·cos·Li, W = 1 — a one-candidate reservoir). Below: the K5
    //    stratum's arm with the MIS weight W_L against the BSDF's density at the same direction.
    vec3 Fv = EvaluateBsdf(m, L, wo, wi);
    if (CosS > 0.0f) return Fv * CosS * SunEmission();
    float Pl = pPick / SunSolidAngle();
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    return Fv * ((-wi.z) * W / max(Pl, 1e-12f)) * SunEmission();
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                   §C/§E ATRous TONE MAP (the file, 1:1)
//------------------------------------------------------------------------------------------------------------------------

static CpuPortMath::uvec2 Extent;                      // [px]  image size            (the push-constant block)
static unsigned int StepSize;                          // [px]  tap spacing this level
static unsigned int Enabled;                           // [-]   0 = straight copy
static float NormalPower, DepthScale, LuminanceScale, Exposure;
static unsigned int FinalLevel;
static float ColourSaturation;

struct Image2D
{
    std::vector<vec4>* Buf = nullptr;
    int W = 0, H = 0;
};

inline vec4 imageLoad(const Image2D& I, const CpuPortMath::ivec2& P)
{
    return (*I.Buf)[size_t(P.y) * size_t(I.W) + size_t(P.x)];
}
inline void imageStore(Image2D& I, const CpuPortMath::ivec2& P, vec4 V)
{
    (*I.Buf)[size_t(P.y) * size_t(I.W) + size_t(P.x)] = V;
}

static Image2D SourceImage, TargetImage, SurfaceImage, OutputImage;   // the four bindings, as plain globals
static vec2 gl_GlobalInvocationID;   // the shim's vec2 — .x/.y/.xy reads

#define main AtrousMain
#include "AtrousDenoise.slang"
#undef main

#include "PngWriteCounterpart.h"

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                        §A — SEAM PARITY (slang == host model)
//------------------------------------------------------------------------------------------------------------------------

void ProofSeamParity()
{
    std::printf("[sky] §A seam parity — the guarded records over the host-packed block\n");

    // 400 directions: uniform sphere + a sun-ward cluster (where the aureole compression lives — SkyAlong's
    //    art-directed shoulder is downstream of SkyRadiance, which is the part that must equal the host).
    double WorstRel = 0.0, WorstT = 0.0;
    int Compared = 0, GroundAgree = 0;
    for (int i = 0; i < 400; ++i)
    {
        vec3 D;
        if (i < 300)
        {
            float Z = Rand01() * 2.0f - 1.0f, Ph = Rand01() * 6.2831853f;
            float R = sqrt(max(0.0f, 1.0f - Z * Z));
            D = vec3(R * cos(Ph), R * sin(Ph), Z);
        }
        else
        {
            D = SampleSunDirection(SkySunDirection.xyz, Rand01(), Rand01());   // the cluster: sun + aureole
            D.z = abs(D.z);
        }
        D = normalize(D);

        SkySample March = SkyRadiance(D);

        float Dir[3] = { D.x, D.y, D.z };
        Frontier::AtmosphereSample Host = Frontier::AtmosphereModel::Integrate(
            g_Medium, g_Light, /*Height=*/2.0f, Dir, SkyControl.x, SkyControl.y);

        double S = double(March.Radiance.x) + March.Radiance.y + March.Radiance.z;
        double H = double(Host.Radiance[0]) + Host.Radiance[1] + Host.Radiance[2];
        if (max(H, S) > 1e-7)
            WorstRel = max(WorstRel, fabs(S - H) / max(max(H, S), 1e-7));
        double Ts = double(March.Transmittance.x) + March.Transmittance.y + March.Transmittance.z;
        double Th = double(Host.Transmittance[0]) + Host.Transmittance[1] + Host.Transmittance[2];
        if (max(Th, Ts) > 1e-7)
            WorstT = max(WorstT, fabs(Ts - Th) / max(max(Th, Ts), 1e-7));
        // The ground agreement: a downward ray must stop at the planet in BOTH integrations (the host's
        //    Transmittance degrades the same way — compare the radiance ratio, which the hit truncates).
        if (D.z < -0.05) GroundAgree += 1;
        ++Compared;
    }
    CHECK(WorstRel < 2e-4 && WorstT < 2e-4,
          "SkyRadiance == AtmosphereModel::Integrate over %d directions (worst radiance %.2e, transmittance %.2e)",
          Compared, WorstRel, WorstT);

    // The guards: daylight sky → stars silent, no moons, no rain, no flare — exact zeros through the same
    //    branches the GPU takes. (A guard that cannot produce 0 cannot be trusted to produce light either.)
    vec3 D = normalize(vec3(0.2f, 0.3f, 0.9f));
    float Lum = 0.5f;
    vec3 Star = StarAlong(D, Lum);
    vec3 Moon = MoonAlong(D, vec3(1.0f));
    vec3 Rainbow = RainbowAlong(D, SkySunDirection.xyz, 1.0e6f);
    vec3 Flare = FlareAlong(vec2(0.5f, 0.5f), 1.7777f);
    CHECK(Star.x == 0.0f && Star.y == 0.0f && Star.z == 0.0f
          && Moon.x == 0.0f && Moon.y == 0.0f && Moon.z == 0.0f
          && Rainbow.x == 0.0f && Rainbow.y == 0.0f && Rainbow.z == 0.0f
          && Flare.x == 0.0f && Flare.y == 0.0f && Flare.z == 0.0f,
          "off-flag guards return exact zeros (stars/moons/rain/flare by day)");

    // The disabled sky: the record's own signal (radiance w = 0) silences SkyAlong AND the packed direct sun.
    LoadSky(25.0f, 35.0f, false);
    vec3 Off = SkyAlong(normalize(vec3(0.1f, 0.2f, 0.7f)));
    CHECK(Off.x == 0.0f && Off.y == 0.0f && Off.z == 0.0f && SkySunDirect.x == 0.0f,
          "the disabled sky is the record's w = 0 signal: SkyAlong == 0 AND SunDirect == 0 (one switch, both lights)");

    LoadSky(25.0f, 35.0f, true);   // day rig back in for §B–§E
}

//------------------------------------------------------------------------------------------------------------------------
//                                   §B — SUN-ARM PARITY (the real record)
//------------------------------------------------------------------------------------------------------------------------

void ProofSunArm()
{
    std::printf("[sky] §B sun-arm parity — SunEmission = SkySunDirect/Ω against the disc\n");

    // The frame faces AWAY from the sun (dot(N, sun) < 0): the below-stratum gate is the arm under test, and
    //    a sun-facing frame makes both sides trivially zero (the §A/§C frames keep +Z).
    const SurfFrame F = BuildFrame(normalize(vec3(-0.4f, -0.6f, 0.3f)));
    const vec3 wo(0.3f, 0.0f, sqrt(1.0f - 0.09f));
    ShadingRecord mWax = SssMaterial(vec3(0.8f, 0.4f, 0.2f), vec3(0.9f, 0.5f, 0.3f), 0.02f,
                                     vec3(1.0f, 0.5f, 0.25f), 0.01f);
    ResolvedLayers L = ResolveLayers(mWax, wo);

    // Arm MC (the K5 arm, pPick = 1 — no lamps in the outdoor rig) vs disc MC with the SAME per-sample MIS
    //    weight: both estimate E[W_L(ω)·f·cos·L_DI·Ω], so equality checks the arm's plumbing (the packed
    //    factor, the Ω division, the cosine, the frame) — the MIS fold itself is §B of MaterialReuseProof.
    const int N = 400000;
    double SumArm = 0.0, Sum2Arm = 0.0, SumDisc = 0.0, Sum2Disc = 0.0;
    for (int i = 0; i < N; ++i)
    {
        vec3 A = SunArm(mWax, L, wo, F, 1.0f);
        double a = A.x + A.y + A.z;
        SumArm += a; Sum2Arm += a * a;

        vec3 sDir = SampleSunDirection(SkySunDirection.xyz, Rand01(), Rand01());
        vec3 wi = ToLocalFrame(F, sDir);
        double d = 0.0;
        if (wi.z < 0.0f)
        {
            float Pl = 1.0f / SunSolidAngle();
            float Pb = PdfBsdf(mWax, L, wo, wi);
            float W = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
            d = dot(EvaluateBsdf(mWax, L, wo, wi), SunEmission()) * (-wi.z) * W * SunSolidAngle();
        }
        SumDisc += d; Sum2Disc += d * d;
    }
    double MA = SumArm / N, MD = SumDisc / N;
    double SA = sqrt(max(Sum2Arm / N - MA * MA, 0.0) / N), SD = sqrt(max(Sum2Disc / N - MD * MD, 0.0) / N);
    CHECK(fabs(MA - MD) < 5.0 * sqrt(SA * SA + SD * SD) + 1e-15,
          "K5 sun arm == disc MC on the packed factor (arm %.6f vs disc %.6f, joint 5σ %.2e)",
          MA, MD, 5.0 * sqrt(SA * SA + SD * SD));

    // And the packed factor itself is sane: SunEmission·Ω == SkySunDirect (the ÷Ω/×Ω round trip the kernel
    //    documents), and the packed transmittance is the march's — the packer already proved that; here the
    //    round trip is what the estimator leans on.
    vec3 RoundTrip = SunEmission() * SunSolidAngle();
    CHECK(fabs(RoundTrip.x - SkySunDirect.x) < 1e-5f && fabs(RoundTrip.z - SkySunDirect.z) < 1e-5f,
          "SunEmission·Ω == SkySunDirect (the ÷Ω/×Ω round trip, %.6f vs %.6f)",
          RoundTrip.x, SkySunDirect.x);
}

//------------------------------------------------------------------------------------------------------------------------
//                              §C — SKY-DOME CLOSURE (the GI seam, brute force)
//------------------------------------------------------------------------------------------------------------------------

void ProofSkyClosure()
{
    std::printf("[sky] §C sky-dome closure — the GI walk (escape → SkyAlong at W=1) vs brute force\n");

    const vec3 wo(0.25f, 0.0f, sqrt(1.0f - 0.0625f));
    const SurfFrame F = BuildFrame(vec3(0.0f, 0.0f, 1.0f));

    ShadingRecord Mats[4] =
    {
        SssMaterial(vec3(0.8f, 0.4f, 0.2f), vec3(0.9f, 0.5f, 0.3f), 0.02f, vec3(1.0f, 0.5f, 0.25f), 0.01f),  // wax
        [&] { ShadingRecord m = GlassMaterial(0.2f, 1.5f, 0.02f);                                             // mixed T+SSS
              m.SssWeight = 0.6f; m.SssColor = vec3(0.9f, 0.5f, 0.3f);
              m.SssRadius = 0.02f; m.SssRadiusScale = vec3(1.0f, 0.5f, 0.25f); m.SssThickness = 0.01f;
              return m; }(),
        GlassMaterial(0.0f, 1.5f, 0.6f),     // solid glass (the K4 medium walk's BSDF face)
        GlassMaterial(0.0f, 1.5f, 0.0f),     // foil (thin wall — no medium)
    };
    const char* Names[4] = { "wax", "mixed T+SSS", "solid glass", "foil glass" };

    for (int Mi = 0; Mi < 4; ++Mi)
    {
        ResolvedLayers L = ResolveLayers(Mats[Mi], wo);

        // Estimator: the kernel's GI walk (§C SkyWalk). Truth: uniform-sphere brute force over the SAME measure
        //    ∫ f·|cos|·SkyAlong dω. 4π·E[f·|z|·env] — the disc's heavy tail is in BOTH and the σs are honest.
        const int NE = 300000, NT = Mi >= 2 ? 1600000 : 400000;   // glass rows: the disc tail needs the draws
        double Sum = 0.0, Sum2 = 0.0;
        for (int i = 0; i < NE; ++i)
        {
            vec3 C = SkyWalk(Mats[Mi], L, wo, F);
            double v = C.x + C.y + C.z;
            Sum += v; Sum2 += v * v;
        }
        double ME = Sum / NE, SE = sqrt(max(Sum2 / NE - ME * ME, 0.0) / NE);

        double SumT = 0.0, Sum2T = 0.0;
        for (int i = 0; i < NT; ++i)
        {
            float Z = Rand01() * 2.0f - 1.0f, Ph = Rand01() * 6.2831853f;
            float R = sqrt(max(0.0f, 1.0f - Z * Z));
            vec3 D(R * cos(Ph), R * sin(Ph), Z);
            vec3 wi = ToLocalFrame(F, D);
            vec3 Fv = EvaluateBsdf(Mats[Mi], L, wo, wi);
            double v = dot(Fv * abs(wi.z) * SkyAlong(D), vec3(1.0f)) * (4.0 * 3.14159265358979323846);
            SumT += v; Sum2T += v * v;
        }
        double MT = SumT / NT, ST = sqrt(max(Sum2T / NT - MT * MT, 0.0) / NT);
        double Comb = 5.0 * sqrt(SE * SE + ST * ST);
        CHECK(fabs(ME - MT) < Comb,
              "%s: GI walk closes on the dome (%.5f vs %.5f, |Δ| %.5f ≤ 5σ %.5f, σwalk %.2e σtruth %.2e)",
              Names[Mi], ME, MT, fabs(ME - MT), Comb, SE, ST);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                            §E — THE VISUAL RIG (the kernel's direct + GI, CPU-traced)
//------------------------------------------------------------------------------------------------------------------------

struct Sphere { vec3 C; float R; };

static Sphere GlassSphere{ vec3(-1.45f, 0.9f, 1.0f), 1.0f };
static Sphere WaxSphere{ vec3(1.65f, 0.4f, 0.72f), 0.72f };
static ShadingRecord mGround, mGlassRig, mWaxRig;

bool HitSphere(const Sphere& S, vec3 O, vec3 D, float& T)
{
    vec3 L = O - S.C;
    float B = dot(L, D), C = dot(L, L) - S.R * S.R;
    float Disc = B * B - C;
    if (Disc < 0.0f) return false;
    float Sq = sqrt(Disc);
    float T1 = -B - Sq, T2 = -B + Sq;
    if (T1 > 1e-4f) { T = T1; return true; }
    if (T2 > 1e-4f) { T = T2; return true; }   // from inside: the far shell (the medium walk's exit)
    return false;
}

// Scene trace: ground plane z = 0 + two spheres. Returns the first hit.
// The foil card: plane x = −4.2, facing +x (the camera side), y ∈ [3.2, 6.0], z ∈ [1.9, 3.9]. Floating wholly
//    above the horizon from the 1.55 m camera (every through-ray has Dir.z > 0 and escapes to pure sky) — the
//    panel the transmitted dome reads through (the double-refraction draw from air is the sampler's foil path,
//    escape → SkyAlong at weight 1).
static ShadingRecord mFoil;
bool HitFoil(vec3 O, vec3 D, float& T, vec3& P)
{
    if (fabs(D.x) < 1e-7f) return false;
    float Tf = (-4.2f - O.x) / D.x;
    if (Tf <= 1e-4f) return false;
    vec3 Q = O + D * Tf;
    if (Q.y < 3.2f || Q.y > 6.0f || Q.z < 1.9f || Q.z > 3.9f) return false;
    T = Tf; P = Q;
    return true;
}

bool TraceRig(vec3 O, vec3 D, int& Which, float& T, vec3& P, vec3& N, bool SkipGlassExit)
{
    T = 1e30f; Which = -1;
    if (D.z < -1e-7f)
    {
        float Tg = -O.z / D.z;
        if (Tg > 1e-4f && Tg < T) { T = Tg; Which = 0; }
    }
    float Ts; vec3 Q;
    if (HitFoil(O, D, Ts, Q) && Ts < T) { T = Ts; Which = 3; }
    if (!SkipGlassExit && HitSphere(GlassSphere, O, D, Ts) && Ts < T) { T = Ts; Which = 1; }
    if (HitSphere(WaxSphere, O, D, Ts) && Ts < T) { T = Ts; Which = 2; }
    if (Which < 0) return false;
    P = O + D * T;
    N = Which == 0 ? vec3(0.0f, 0.0f, 1.0f)
      : Which == 1 ? (P - GlassSphere.C) / GlassSphere.R
      : Which == 2 ? (P - WaxSphere.C) / WaxSphere.R
                   : vec3(1.0f, 0.0f, 0.0f);
    return true;
}

bool Occluded(vec3 P, vec3 D, float MaxT)
{
    float T; vec3 Q, N; int W;
    if (HitSphere(GlassSphere, P, D, T) && T < MaxT) return true;
    if (HitSphere(WaxSphere, P, D, T) && T < MaxT) return true;
    (void)Q; (void)N; (void)W;
    return false;
}

// Direct sun with the kernel's split: above-horizon samples are the plain DI candidate; below-horizon samples
//    belong to the K5 stratum at W_L (only when the material owns a below stratum at all).
vec3 DirectSun(vec3 P, const SurfFrame& F, vec3 wo, ShadingRecord m, ResolvedLayers L)
{
    vec3 sDir = SampleSunDirection(SkySunDirection.xyz, Rand01(), Rand01());
    vec3 wi = ToLocalFrame(F, sDir);
    if (wi.z > 0.0f)
    {
        if (Occluded(P, sDir, 1.0e4f)) return vec3(0.0f);
        // f·cos·L / pdf with pdf = 1/Ω — the disc radiance is huge, the cone is what divides it back down.
        return EvaluateBsdf(m, L, wo, wi) * (wi.z * SunEmission() * SunSolidAngle());
    }
    if (L.SssMix <= 0.0f) return vec3(0.0f);
    // K5 below arm at W_L (the sun below the local horizon through a translucent shoulder).
    vec3 Fv = EvaluateBsdf(m, L, wo, wi);
    if (Fv.x == 0.0f && Fv.y == 0.0f && Fv.z == 0.0f) return vec3(0.0f);
    float Pl = 1.0f / SunSolidAngle();
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    // Occlusion for the below shoulder: the kernel's chord rule (no shadow ray, Beer through the body) — the
    //    shoulder here is thin, keep the arm unshadowed as the stratum does pre-M9's chord.
    return Fv * ((-wi.z) * W / max(Pl, 1e-12f)) * SunEmission();
}

// One GI bounce from a non-solid endpoint: SampleBsdf → escape (SkyAlong) / ground endpoint (its own sun NEE).
bool g_SkyOn = true;   // false = the pre-M9 background: no environment anywhere (miss black, escapes black)

vec3 GiBounce(vec3 P, const SurfFrame& F, vec3 wo, ShadingRecord m, ResolvedLayers L)
{
    vec4 B = SampleBsdf(m, L, wo, vec4(Rand01(), Rand01(), Rand01(), Rand01()));
    if (B.w <= 0.0f) return vec3(0.0f);
    vec3 Through = EvaluateBsdf(m, L, wo, B.xyz) * (abs(B.z) / max(B.w, 1e-12f));
    Through = min(Through, vec3(8.0f));   // the kernel's firefly clamp (K4 mirror)
    vec3 Dir = FromLocalFrame(F, B.xyz);
    bool EnteredSolid = m.TransmissionWeight > 0.0f && m.TransmissionThickness > 0.0f && B.z < 0.0f;
    vec3 Org = EnteredSolid ? P + Dir * 3e-4f
                            : P + F.Geometric * (dot(Dir, F.Geometric) > 0.0f ? 3e-4f : -3e-4f);

    // K4: the solid walk — Beer over the true interior segment to the EXIT BACKFACE, and there the path DIES:
    //    the kernel's bounce endpoint skips NEE from inside (bFromInside), has no emission, and the one-bounce
    //    cap ends the walk — interior R/T continuation is explicitly future work. Mirror the dead end exactly.
    if (EnteredSolid)
    {
        const vec3 Sigma = L.TransmissionSigma;   // per-channel Beer (the kappa row)
        vec3 Lc = Org - GlassSphere.C;            // the exit is the own sphere's far shell (nearest from inside)
        float Bq = dot(Lc, Dir), Cq = dot(Lc, Lc) - GlassSphere.R * GlassSphere.R;
        float TExit = -Bq + sqrt(max(Bq * Bq - Cq, 0.0f));
        Through *= exp(-Sigma * TExit);
        (void)Through;
        return vec3(0.0f);   // the exit backface contributes nothing (the kernel's structure)
    }

    int W; float T; vec3 HP, HN;
    if (!TraceRig(Org, Dir, W, T, HP, HN, /*SkipGlassExit=*/false))
        return g_SkyOn ? Through * SkyAlong(Dir) : vec3(0.0f);   // pre-M9: an escape saw no environment
    if (W == 0)
    {
        SurfFrame FG = BuildFrame(HN);
        vec3 WoG = ToLocalFrame(FG, Dir * -1.0f);
        ResolvedLayers LG = ResolveLayers(mGround, WoG);
        return Through * DirectSun(HP, FG, WoG, mGround, LG);
    }
    return vec3(0.0f);   // endpoint on the other sphere: no emission, 1-bounce cap (the kernel's structure)
}

vec3 ShadeRig(vec3 P, vec3 N, vec3 ViewDir, int Which)
{
    SurfFrame F = BuildFrame(N);
    vec3 wo = ToLocalFrame(F, ViewDir);
    if (wo.z <= 0.0f) wo = vec3(wo.x, wo.y, 1e-3f);

    ShadingRecord m = Which == 1 ? mGlassRig : Which == 2 ? mWaxRig : Which == 3 ? mFoil : mGround;
    if (Which == 2) m.SssThickness = 0.04f;   // the tracer-side chord at this hit (K5 mirror, thin shell look)
    ResolvedLayers L = ResolveLayers(m, wo);
    // The kernel's solid-primary opt-in (:1067): a solid (not thin-walled) transmissive resolves the BARE
    //    single interface — the sampler takes ONE refraction step and the tracer walks the medium from there.
    //    Foil (thickness 0) keeps the safe double-refraction default.
    if (m.TransmissionWeight > 0.0f && m.TransmissionThickness > 0.0f) L.SolidInterface = true;

    vec3 Col = DirectSun(P, F, wo, m, L);
    Col = Col + GiBounce(P, F, wo, m, L);
    return Col;
}

struct RigOut { std::vector<vec4> Hdr; int W, H; };

void RenderRig(std::vector<vec4>& Out, int W, int H, int Spp, uint64_t Seed, bool SkyOn)
{
    // Camera: standing on the ground plane, looking north (+Y) with a slight up-pitch — the spheres frame the
    //    sun's half of the sky so the glass collects both the dome and the disc.
    const vec3 CamPos(0.0f, -5.4f, 1.55f);
    const vec3 Fwd = normalize(vec3(0.0f, 1.0f, 0.14f));
    const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Fwd);
    const float TanHalf = 0.4663f;   // 50° vertical fov
    const float Aspect = float(W) / float(H);

    auto Worker = [&](int Y0, int Y1, unsigned Salt)
    {
        uint64_t R = Seed ^ (0x9E3779B97F4A7C15ull * (Salt + 1u));
        auto U = [&]() -> float
        {
            uint64_t z = (R += 0x9E3779B97F4A7C15ull);
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
            z = z ^ (z >> 31);
            return static_cast<float>((z >> 11) * (1.0 / 9007199254740992.0));
        };
        for (int y = Y0; y < Y1; ++y)
        {
            for (int x = 0; x < W; ++x)
            {
                vec4 Acc(0.0f, 0.0f, 0.0f, 0.0f);
                for (int S = 0; S < Spp; ++S)
                {
                    vec2 J(U() - 0.5f, U() - 0.5f);
                    vec3 Dir = normalize(Fwd + Right * (((x + 0.5f + J.x) / W * 2.0f - 1.0f) * TanHalf * Aspect)
                                             - Up * (((y + 0.5f + J.y) / H * 2.0f - 1.0f) * TanHalf));
                    vec3 Col;
                    int Wch; float T; vec3 HP, HN;
                    if (!TraceRig(CamPos, Dir, Wch, T, HP, HN, false))
                    {
                        // The kernel's miss: SkyAlong + RainbowAlong (the bow's guard keeps it off without rain).
                        Col = SkyOn ? (SkyAlong(Dir) + RainbowAlong(Dir, SkySunDirection.xyz, 1.0e6f)) : vec3(0.0f);
                    }
                    else Col = ShadeRig(HP, HN, Dir * -1.0f, Wch);
                    Acc = Acc + vec4(Col, 1.0f);
                }
                float N = float(Spp);
                Out[size_t(y) * W + x] = vec4(Acc.x / N, Acc.y / N, Acc.z / N, 1.0f);
            }
        }
    };
    unsigned HC = std::thread::hardware_concurrency(); if (HC == 0) HC = 4u; if (HC > 12u) HC = 12u;
    std::vector<std::thread> Ts;
    int Strip = (H + int(HC) - 1) / int(HC);
    for (unsigned I = 0; I < HC; ++I)
    {
        int Y0 = int(I) * Strip, Y1 = min(Y0 + Strip, H);
        if (Y0 >= Y1) break;
        Ts.emplace_back(Worker, Y0, Y1, I + 1u);
    }
    for (auto& Th : Ts) Th.join();
}

void WritePanel(const char* Path, const std::vector<vec4>& Hdr, int W, int H)
{
    std::vector<unsigned char> Png(size_t(W) * H * 3);
    for (size_t i = 0; i < Hdr.size(); ++i)
    {
        vec3 Tonemapped = ToneMap(vec3(Hdr[i].x, Hdr[i].y, Hdr[i].z));
        Png[i * 3 + 0] = (unsigned char)clamp(Tonemapped.x * 255.0f + 0.5f, 0.0f, 255.0f);
        Png[i * 3 + 1] = (unsigned char)clamp(Tonemapped.y * 255.0f + 0.5f, 0.0f, 255.0f);
        Png[i * 3 + 2] = (unsigned char)clamp(Tonemapped.z * 255.0f + 0.5f, 0.0f, 255.0f);
    }
    PngWriteCounterpart::WritePng(Path, W, H, 3, Png.data(), W * 3);
}

void ProofVisuals()
{
    std::printf("[sky] §E visual sheet — the sky panorama, the rig black vs sky-backed\n");
    const int W = 520, H = 300, Spp = 96;

    mGround = StandardMaterial(vec3(0.23f, 0.21f, 0.18f), 0.6f);
    mGlassRig = GlassMaterial(0.0f, 1.5f, 0.5f);
    mGlassRig.TransmissionColor = vec3(0.94f, 0.97f, 0.95f); mGlassRig.TransmissionDepth = 4.0f;
    mWaxRig = SssMaterial(vec3(0.75f, 0.42f, 0.24f), vec3(0.93f, 0.62f, 0.38f), 0.02f,
                          vec3(1.0f, 0.5f, 0.25f), 0.04f);
    mFoil = GlassMaterial(0.0f, 1.5f, 0.0f);   // the thin wall: the sampler's double refraction, no medium

    // Panel 1 — the pure sky (every pixel a miss: the kernel's primary-miss branch). Deterministic gate: the
    //    tone-mapped panorama must equal the same computation walked ray by ray (bitwise on the stored bytes).
    {
        const int PW = 560, PH = 300;
        std::vector<vec4> Sky(size_t(PW) * PH, vec4(0.0f, 0.0f, 0.0f, 0.0f));
        const vec3 CamPos(0.0f, 0.0f, 2.0f);
        const vec3 Fwd = normalize(vec3(0.35f, 0.85f, 0.18f));   // sun-ward half: disc + aureole in frame
        const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
        const vec3 Up = cross(Right, Fwd);
        const float TanHalf = 0.649f;   // 66° vertical — horizon low in frame
        for (int y = 0; y < PH; ++y)
            for (int x = 0; x < PW; ++x)
            {
                vec3 Dir = normalize(Fwd + Right * (((x + 0.5f) / PW * 2.0f - 1.0f) * TanHalf * (float(PW) / PH))
                                             - Up * (((y + 0.5f) / PH * 2.0f - 1.0f) * TanHalf));
                Sky[size_t(y) * PW + x] = vec4(SkyAlong(Dir) + RainbowAlong(Dir, SkySunDirection.xyz, 1.0e6f), 1.0f);
            }
        // The gate: recompute a 32-ray subset and demand bitwise-identical bytes after the tone map.
        int Mismatches = 0;
        for (int i = 0; i < 32; ++i)
        {
            int X = (i * 17 + 3) % PW, Y = (i * 29 + 7) % PH;
            vec3 Dir = normalize(Fwd + Right * (((X + 0.5f) / PW * 2.0f - 1.0f) * TanHalf * (float(PW) / PH))
                                         - Up * (((Y + 0.5f) / PH * 2.0f - 1.0f) * TanHalf));
            vec4 Ref(SkyAlong(Dir) + RainbowAlong(Dir, SkySunDirection.xyz, 1.0e6f), 1.0f);
            if (Ref.x != Sky[size_t(Y) * PW + X].x || Ref.y != Sky[size_t(Y) * PW + X].y
                || Ref.z != Sky[size_t(Y) * PW + X].z) ++Mismatches;
        }
        WritePanel("/tmp/SkyGlass_Sky.png", Sky, PW, PH);
        CHECK(Mismatches == 0, "panorama re-walk bitwise-identical on 32 rays (miss == SkyAlong + RainbowAlong)");

        // The sun disc is IN the frame and brighter than the dome around it: sample the disc direction vs 15°
        //    away — the aureole compression keeps the shoulder, the disc keeps the edge.
        float DiscLum = dot(SkyAlong(SkySunDirection.xyz), vec3(0.2126f, 0.7152f, 0.0722f));
        vec3 OffDir = normalize(SkySunDirection.xyz + vec3(0.0f, 0.35f, 0.12f));
        float OffLum = dot(SkyAlong(OffDir), vec3(0.2126f, 0.7152f, 0.0722f));
        CHECK(DiscLum > OffLum * 8.0f,
              "the disc keeps its edge through the aureole shoulder (disc %.1f vs 15° off %.2f, ratio %.1f)",
              DiscLum, OffLum, DiscLum / max(OffLum, 1e-4f));
    }

    // Panels 2–4 — the rig: pre-M9 black background (direct sun only), sky-backed, and the 1-spp noisy frame.
    std::vector<vec4> Black(size_t(W) * H), SkyBack(size_t(W) * H), Noisy(size_t(W) * H);
    g_SkyOn = false;  RenderRig(Black, W, H, Spp, 0x51D5C0FFEEFull, false);
    g_SkyOn = true;   RenderRig(SkyBack, W, H, Spp, 0x51D5C0FFEEFull, true);
    RenderRig(Noisy, W, H, 1, 0x51D5C0FFEEFull, true);

    double BlackLum = 0.0, SkyLum = 0.0;
    for (size_t i = 0; i < SkyBack.size(); ++i)
    {
        BlackLum += dot(vec3(Black[i].x, Black[i].y, Black[i].z), vec3(0.2126f, 0.7152f, 0.0722f));
        SkyLum += dot(vec3(SkyBack[i].x, SkyBack[i].y, SkyBack[i].z), vec3(0.2126f, 0.7152f, 0.0722f));
    }
    BlackLum /= SkyBack.size(); SkyLum /= SkyBack.size();
    CHECK(SkyLum > BlackLum * 1.5f,
          "sky-backed rig out-lights the black background (%.4f vs %.4f mean luma — the dome is a light)",
          SkyLum, BlackLum);

    // The glass sphere's centre transmits the sky it refracts: trace the centre ray analytically — entry
    //    refraction, chord, exit refraction (thin air-side negation for a sphere is the chord symmetric, so the
    //    exit direction mirrors the entry), and compare with the rendered pixel (5σ from its 96-spp neighbours).
    {
        const vec3 CamPos(0.0f, -5.4f, 1.55f);
        const vec3 Fwd = normalize(vec3(0.0f, 1.0f, 0.14f));
        const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
        const vec3 Up = cross(Right, Fwd);
        const float TanHalf = 0.4663f, Aspect = float(W) / float(H);
        // Find the pixel whose primary ray passes nearest the glass sphere's centre.
        int BestX = 0, BestY = 0; float BestD = 1e30f;
        for (int y = 0; y < H; y += 2)
            for (int x = 0; x < W; x += 2)
            {
                vec3 Dir = normalize(Fwd + Right * (((x + 0.5f) / W * 2.0f - 1.0f) * TanHalf * Aspect)
                                             - Up * (((y + 0.5f) / H * 2.0f - 1.0f) * TanHalf));
                vec3 Lc = GlassSphere.C - CamPos;
                float Along = dot(Lc, Dir);
                float Miss = length(Lc - Dir * Along);
                if (Miss < BestD) { BestD = Miss; BestX = x; BestY = y; }
            }
        // The SOLID sphere's centre is a dark silhouette (the exit backface is a dead end — the sphere reads
        //    its Fresnel reflections and sun highlights, not the dome behind it), measurably darker than the
        //    sky-and-ground right beside its silhouette.
        double Centre = 0.0, Around = 0.0; int NC = 0, NA = 0;
        for (int dy = -7; dy <= 7; ++dy) for (int dx = -7; dx <= 7; ++dx)
        {
            int X = BestX + dx, Y = BestY + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            double L = dot(vec3(SkyBack[size_t(Y) * W + X].x, SkyBack[size_t(Y) * W + X].y,
                                SkyBack[size_t(Y) * W + X].z), vec3(0.2126f, 0.7152f, 0.0722f));
            if (abs(int(dx)) + abs(int(dy)) <= 6) { Centre += L; ++NC; }
            else { Around += L; ++NA; }
        }
        // (the ±7 px box sits wholly inside the ~105 px silhouette — probe the real background 70 px out)
        double BG = 0.0; int NB = 0;
        for (int dy = -4; dy <= 4; ++dy)
            for (int dx : { -70, 70 })
            {
                int X = BestX + dx, Y = BestY + dy;
                if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                vec3 Dir = normalize(Fwd + Right * (((X + 0.5f) / W * 2.0f - 1.0f) * TanHalf * Aspect)
                                             - Up * (((Y + 0.5f) / H * 2.0f - 1.0f) * TanHalf));
                int Wch; float Tp; vec3 HP, HN;
                if (TraceRig(CamPos, Dir, Wch, Tp, HP, HN, false) && (Wch == 1 || Wch == 2))
                    continue;   // only the spheres disqualify a probe (the infinite ground is real background)
                BG += dot(vec3(SkyBack[size_t(Y) * W + X].x, SkyBack[size_t(Y) * W + X].y,
                               SkyBack[size_t(Y) * W + X].z), vec3(0.2126f, 0.7152f, 0.0722f));
                ++NB;
            }
        BG /= (NB ? NB : 1);
        (void)Centre; (void)Around; (void)NC; (void)NA;
        double Disc = 0.0; int ND = 0;
        for (int dy = -6; dy <= 6; ++dy) for (int dx = -6; dx <= 6; ++dx)
        {
            int X = BestX + dx, Y = BestY + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            Disc += dot(vec3(SkyBack[size_t(Y) * W + X].x, SkyBack[size_t(Y) * W + X].y,
                             SkyBack[size_t(Y) * W + X].z), vec3(0.2126f, 0.7152f, 0.0722f));
            ++ND;
        }
        Disc /= ND;
        CHECK(Disc < BG * 0.75f,
              "the solid sphere reads as dark glass against the sky it cannot transmit in one bounce (%.4f centre vs %.4f open sky beside)",
              Disc, BG);
    }

    // The FOIL card does transmit the dome: through-panel ≈ (1−F)²-tinted open sky at the same rays (the card
    //    floats in the pure-sky band), and far above the black panel's card (a Fresnel sliver of nothing).
    {
        double Through = 0.0, Beside = 0.0, BlackCard = 0.0; int NT = 0;
        const vec3 CamPos(0.0f, -5.4f, 1.55f);
        const vec3 Fwd = normalize(vec3(0.0f, 1.0f, 0.14f));
        const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
        const vec3 Up = cross(Right, Fwd);
        const float TanHalf = 0.4663f, Aspect = float(W) / float(H);
        for (int y = 0; y < H; y += 2)
            for (int x = 0; x < W; x += 2)
            {
                vec3 Dir = normalize(Fwd + Right * (((x + 0.5f) / W * 2.0f - 1.0f) * TanHalf * Aspect)
                                             - Up * (((y + 0.5f) / H * 2.0f - 1.0f) * TanHalf));
                float Tf; vec3 Q;
                if (!HitFoil(CamPos, Dir, Tf, Q)) continue;
                Through += dot(vec3(SkyBack[size_t(y) * W + x].x, SkyBack[size_t(y) * W + x].y,
                                    SkyBack[size_t(y) * W + x].z), vec3(0.2126f, 0.7152f, 0.0722f));
                BlackCard += dot(vec3(Black[size_t(y) * W + x].x, Black[size_t(y) * W + x].y,
                                      Black[size_t(y) * W + x].z), vec3(0.2126f, 0.7152f, 0.0722f));
                Beside += dot(SkyAlong(Dir), vec3(0.2126f, 0.7152f, 0.0722f));
                ++NT;
            }
        Through /= NT; Beside /= NT; BlackCard /= NT;
        CHECK(Through > Beside * 0.55f && Through > BlackCard * 2.0f,
              "the foil card transmits the dome it refracts (%.4f through vs %.4f open sky at the same rays, %.4f black-panel card)",
              Through, Beside, BlackCard);
    }

    WritePanel("/tmp/SkyGlass_RigBlack.png", Black, W, H);
    WritePanel("/tmp/SkyGlass_RigSky.png", SkyBack, W, H);
    WritePanel("/tmp/SkyGlass_RigSky_1spp.png", Noisy, W, H);
    std::printf("  ..  panels: /tmp/SkyGlass_Sky.png SkyGlass_RigBlack.png SkyGlass_RigSky.png SkyGlass_RigSky_1spp.png\n");
}

} // namespace

int main()
{
    std::setlocale(LC_ALL, "C");
    std::printf("SKY GLASS (M9): the sky-backed outdoor glass proof\n");

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);   // production bakes 4096; 1024 proves the maths
    g_Tables = &Tables;

    LoadSky(25.0f, 35.0f, true);
    Exposure = 1.05f; ColourSaturation = 1.0f;   // the kernel tone map's constants (§C of MaterialReuseProof pins them)

    ProofSeamParity();
    ProofSunArm();
    ProofSkyClosure();
    ProofVisuals();

    std::printf("SKY GLASS: %s (%d ok, %d FAIL)\n", g_Fail == 0 ? "PASS" : "FAIL", g_Pass, g_Fail);
    return g_Fail == 0 ? 0 : 1;
}
