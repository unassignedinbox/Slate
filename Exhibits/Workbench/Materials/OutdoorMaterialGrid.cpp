//============================================================================================================================================
//                                                       OUTDOORMATERIALGRID.CPP
//============================================================================================================================================
// 🧩 M9 — the outdoor material grid: Project-Zero's open-air scene (sun + sky + scattered casters) with a grid of
//    balls, one UNIQUE material per ball, and a unique material on every scattered object, rendered on the CPU.
//
//    Scene (mirrors RayTracingSolver::ConstructOutdoorScene's layout: 400 m ground, the seven casters at their
//    coordinates, sun-only sky through the PackSkyConstants seam) plus an 18-ball grid — the full archetype set:
//    plastic, clearcoat plastic, glossy glass, clear glass (foil), frosted glass, brushed aluminium, polished
//    steel, chrome, gold, copper, rubber, velvet, felt, wax, jade, soap film, emission, and the plain Lambert
//    reference. The scattered casters get unique materials of their own (clearcoat white sphere, chrome steel
//    sphere, terracotta cone, brushed-gold torus, solid-glass slab, cast-iron crate).
//
//    Shading is the kernel's structure, CPU-traced (the SkyGlassProof §E renderer generalised): sun NEE with the
//    disc sampler, the K5 below arm at W_L, one BSDF-sampled GI bounce with escape → SkyAlong at weight 1, the
//    K4 solid walk (Beer over the true interior segment, dead-end exit backface), the M9 pure-SSS virtual
//    see-through, endpoint emission (kernel :1459), and the 1:1 AtrousDenoise tone map.
//
//    Gates: the 18 materials are pairwise distinct; the emission ball dominates; the foil ball transmits the dome
//    the solid glass ball cannot; the metal balls read their tint; each panel is alive. The renders are the
//    deliverable — Exhibits/Gallery/Materials/OutdoorGrid_{Field,Balls,Original}.png (+ this log's legend).
//
//    Build: g++ -std=c++20 -O2 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation
//        -I Engine/Shaders -I Exhibits/Workbench/Editor OutdoorMaterialGrid.cpp
//        Engine/DisplayPresentation/ShadingTableCodec.cpp -o /tmp/OutdoorGrid -pthread
//    GPU render-verification stays user-side (no GPU in the sandbox), as everywhere since K0.

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"
#include "SkyConstantRecord.h"   // the host packer (PackSkyConstants) + AtmosphereModel

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

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

struct StarEntry
{
    vec4 DirLum;   // xyz = unit, equatorial J2000; w = luminance
    vec4 ColPad;   // rgb = linear colour; w = padding
};
uvec2 StarCells[1024];
StarEntry StarStars[1];   // unsized on the GPU; zeroed cells mean this is never indexed

vec4 PostStar, PostFlare, PostFlare2, PostFlareUv, PostBow, PostBow2, PostSpare0, PostSpare1;

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

// The host side of the same block (SkyGlassProof's proven packer copy — row-for-row, static_assert-pinned).
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
    // Broad daylight, no moons, no rain, no flare — the proven day-sky flags.
    PostStar  = vec4(0.0f, 0.0f, 1.0f, 0.0f);
    PostFlare = vec4(0.0f, 4.0f, 1.0f, 0.3f);
    PostFlare2 = vec4(1.0f, 1.0f, 8.0f, 0.0f);
    PostFlareUv = vec4(0.5f, 0.5f, 0.0f, 0.0f);
    PostBow  = vec4(0.6f, 0.4f, 0.3f, 0.0f);
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

// The kernel's sun-solid-angle / disc sampler / emission — verbatim algebra from ReSTIRViewport.slang.
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
//                                   MATERIALS (the furnace's own helpers + the archetypes)
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
//                                        FRAME + THE KERNEL'S WALKS
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

//------------------------------------------------------------------------------------------------------------------------
//                                   §C/§E À-Trous TONE MAP (the file, 1:1)
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

//------------------------------------------------------------------------------------------------------------------------
//                                        THE OUTDOOR SCENE (analytic, z-up)
//------------------------------------------------------------------------------------------------------------------------

struct Ball { vec3 C; float R; };

const Ball  g_Ball_Sphere1{ vec3(-3.20f, 6.00f, 1.20f), 1.20f };   // ConstructOutdoorScene's "White Sphere"
const Ball  g_Ball_Sphere2{ vec3( 4.60f, 11.00f, 0.70f), 0.70f };  // "Steel Sphere"
const vec3  g_ConeC(1.80f, 5.20f, 0.0f);  const float g_ConeR = 0.90f, g_ConeH = 2.60f;
const vec3  g_TorusC(-1.40f, 9.50f, 1.60f); const float g_TorusR = 1.10f, g_Torusr = 0.30f;
const vec3  g_SlabC(6.50f, 4.00f, 2.00f);  const vec3 g_SlabHalf(0.25f, 1.60f, 2.00f);  const float g_SlabYaw = 18.0f * 3.14159265358979323846f / 180.0f;
const vec3  g_CrateC(-6.00f, 3.20f, 0.60f); const vec3 g_CrateHalf(1.00f, 1.00f, 0.60f); const float g_CrateYaw = -12.0f * 3.14159265358979323846f / 180.0f;

// The ball grid: 9 columns × 2 rows, 18 unique materials (the archetype set). Row A (north, y = −4.5) is the
//    dielectrics-and-metals row; row B (south, y = −7.5) the fabric/SSS/special row. r = 0.5, sitting on the ground.
constexpr int   kGridCols = 9, kGridRows = 2, kBallCount = kGridCols * kGridRows;
constexpr float kGridX0 = -12.0f, kGridDx = 3.0f, kRowAy = 0.5f, kRowBy = -2.0f, kBallR = 0.5f;

Ball GridBall(int I) { return Ball{ vec3(kGridX0 + float(I % kGridCols) * kGridDx,
                                         I < kGridCols ? kRowAy : kRowBy, kBallR), kBallR }; }

enum ObjId
{
    ObjGround = 0, ObjSphere1, ObjSphere2, ObjCone, ObjTorus, ObjSlab, ObjCrate,
    ObjBall0 = 7, ObjLast = ObjBall0 + kBallCount - 1
};

ShadingRecord g_Mat[ObjLast + 1];

void BuildMaterials()
{
    g_Mat[ObjGround] = StandardMaterial(vec3(0.32f, 0.32f, 0.30f), 0.6f);   // ConstructOutdoorScene's ground, kept

    // The scattered casters — each its OWN material now (the scene shared three).
    g_Mat[ObjSphere1] = StandardMaterial(vec3(0.82f, 0.82f, 0.84f), 0.30f);                       // clearcoat white
    g_Mat[ObjSphere1].CoatWeight = 1.0f; g_Mat[ObjSphere1].CoatRoughness = 0.05f;
    g_Mat[ObjSphere2] = StandardMaterial(vec3(0.95f, 0.96f, 0.97f), 0.05f);                       // chrome
    g_Mat[ObjSphere2].Metalness = 1.0f;
    g_Mat[ObjCone]    = StandardMaterial(vec3(0.70f, 0.45f, 0.28f), 0.80f);                       // terracotta (the clay, kept)
    g_Mat[ObjTorus]   = StandardMaterial(vec3(1.00f, 0.77f, 0.34f), 0.35f);                       // brushed gold
    g_Mat[ObjTorus].Metalness = 1.0f;
    g_Mat[ObjSlab]    = GlassMaterial(0.0f, 1.5f, 0.35f);                                          // solid glass slab
    g_Mat[ObjSlab].TransmissionColor = vec3(0.94f, 0.97f, 0.95f); g_Mat[ObjSlab].TransmissionDepth = 4.0f;
    g_Mat[ObjCrate]   = StandardMaterial(vec3(0.25f, 0.24f, 0.26f), 0.55f);                       // cast iron
    g_Mat[ObjCrate].Metalness = 1.0f;

    // The 18-archetype ball grid. Row A: dielectrics + metals. Row B: fabric/SSS/specials + reference.
    const int B = ObjBall0;
    g_Mat[B + 0]  = StandardMaterial(vec3(0.72f, 0.08f, 0.10f), 0.30f);                            // plastic crimson
    g_Mat[B + 1]  = StandardMaterial(vec3(0.10f, 0.30f, 0.75f), 0.35f);                            // clearcoat azure
    g_Mat[B + 1].CoatWeight = 1.0f; g_Mat[B + 1].CoatRoughness = 0.05f;
    g_Mat[B + 2]  = GlassMaterial(0.05f, 1.5f, 0.5f);                                              // glossy glass (solid)
    g_Mat[B + 2].TransmissionColor = vec3(0.96f, 0.98f, 0.97f); g_Mat[B + 2].TransmissionDepth = 6.0f;
    g_Mat[B + 3]  = GlassMaterial(0.0f, 1.5f, 0.0f);                                               // clear glass (foil)
    g_Mat[B + 4]  = GlassMaterial(0.30f, 1.5f, 0.5f);                                              // frosted glass (solid)
    g_Mat[B + 4].TransmissionColor = vec3(0.95f, 0.97f, 0.96f); g_Mat[B + 4].TransmissionDepth = 2.5f;
    g_Mat[B + 5]  = StandardMaterial(vec3(0.92f, 0.93f, 0.95f), 0.42f);                            // brushed aluminium
    g_Mat[B + 5].Metalness = 1.0f;
    g_Mat[B + 6]  = StandardMaterial(vec3(0.88f, 0.89f, 0.92f), 0.12f);                            // polished steel
    g_Mat[B + 6].Metalness = 1.0f;
    g_Mat[B + 7]  = StandardMaterial(vec3(1.00f, 0.77f, 0.34f), 0.10f);                            // gold
    g_Mat[B + 7].Metalness = 1.0f;
    g_Mat[B + 8]  = StandardMaterial(vec3(0.96f, 0.56f, 0.38f), 0.18f);                            // copper
    g_Mat[B + 8].Metalness = 1.0f;
    g_Mat[B + 9]  = StandardMaterial(vec3(0.05f, 0.05f, 0.06f), 0.92f);                            // rubber
    g_Mat[B + 10] = StandardMaterial(vec3(0.35f, 0.02f, 0.08f), 1.0f);                             // velvet (sheen-primary)
    g_Mat[B + 10].FuzzWeight = 1.0f; g_Mat[B + 10].FuzzColor = vec3(0.62f, 0.05f, 0.14f); g_Mat[B + 10].FuzzRoughness = 0.9f;
    g_Mat[B + 10].SpecularWeight = 0.25f; g_Mat[B + 10].Selection = kReflectanceCloth;
    g_Mat[B + 11] = StandardMaterial(vec3(0.12f, 0.14f, 0.38f), 0.85f);                            // felt indigo
    g_Mat[B + 11].FuzzWeight = 0.55f; g_Mat[B + 11].FuzzColor = vec3(0.20f, 0.22f, 0.50f); g_Mat[B + 11].FuzzRoughness = 0.7f;
    g_Mat[B + 11].Selection = kReflectanceCloth;
    g_Mat[B + 12] = SssMaterial(vec3(0.80f, 0.55f, 0.25f), vec3(0.90f, 0.60f, 0.35f), 0.02f,       // wax amber
                                vec3(1.0f, 0.5f, 0.25f), 0.05f);
    g_Mat[B + 13] = SssMaterial(vec3(0.30f, 0.65f, 0.45f), vec3(0.45f, 0.80f, 0.55f), 0.015f,      // jade
                                vec3(0.5f, 1.0f, 0.6f), 0.08f);
    g_Mat[B + 14] = GlassMaterial(0.0f, 1.5f, 0.0f);                                               // soap film
    g_Mat[B + 14].ThinFilmWeight = 1.0f; g_Mat[B + 14].ThinFilmThickness = 0.5f;
    g_Mat[B + 15] = StandardMaterial(vec3(0.10f, 0.05f, 0.02f), 0.5f);                             // emission ember
    g_Mat[B + 15].Emission = vec3(16.0f, 6.0f, 1.8f);
    g_Mat[B + 16] = StandardMaterial(vec3(0.85f, 0.83f, 0.80f), 0.25f);                            // hazy plastic
    g_Mat[B + 16].HazinessWeight = 0.8f; g_Mat[B + 16].HazinessRoughness = 0.55f;
    g_Mat[B + 17] = StandardMaterial(vec3(0.50f, 0.50f, 0.50f), 1.0f);                             // Lambert reference
    g_Mat[B + 17].SpecularWeight = 0.0f;
}

const char* MaterialName(int I)
{
    static const char* N[kBallCount] = {
        "plastic crimson", "clearcoat azure", "glossy glass (solid)", "clear glass (foil)",
        "frosted glass (solid)", "brushed aluminium", "polished steel", "gold", "copper",
        "rubber", "velvet (sheen-primary)", "felt indigo", "wax amber", "jade",
        "soap film (thin-film)", "emission ember", "hazy plastic", "Lambert reference"
    };
    return N[I];
}

// ---- intersectors (analytic; the scattered shapes mirror ConstructOutdoorScene's primitives) ----

bool HitGround(vec3 O, vec3 D, float& T)
{
    if (D.z >= -1e-7f) return false;
    T = -O.z / D.z;
    return T > 1e-4f;
}

bool HitBall(const Ball& S, vec3 O, vec3 D, float& T, bool Far = false)
{
    vec3 L = O - S.C;
    float B = dot(L, D), C = dot(L, L) - S.R * S.R;
    float Disc = B * B - C;
    if (Disc < 0.0f) return false;
    float Sq = sqrt(Disc);
    float T1 = -B - Sq, T2 = -B + Sq;
    if (!Far && T1 > 1e-4f) { T = T1; return true; }
    if (T2 > 1e-4f) { T = T2; return true; }   // inside: the far shell (the solid walk's exit)
    return false;
}

bool HitCone(vec3 O, vec3 D, float& T, vec3& N)
{
    // Side wall: g(t) = wx^2+wy^2 - r^2(1 - (wz+t*dz)/h)^2 over u = w + t*d (w = O - C):
    //   A = dx^2+dy^2 - (r/h)^2*dz^2   B = 2[wx*dx + wy*dy + (r^2/h)(1 - wz/h)*dz]
    //   C = wx^2+wy^2 - r^2(1 - wz/h)^2
    vec3 w = O - g_ConeC;
    float rH = g_ConeR / g_ConeH;
    float A = D.x * D.x + D.y * D.y - rH * rH * D.z * D.z;
    float B = 2.0f * (w.x * D.x + w.y * D.y + (g_ConeR * g_ConeR / g_ConeH) * (1.0f - w.z / g_ConeH) * D.z);
    float C = w.x * w.x + w.y * w.y - g_ConeR * g_ConeR * (1.0f - w.z / g_ConeH) * (1.0f - w.z / g_ConeH);
    float Disc = B * B - 4.0f * A * C;
    float Ts = 1e30f;
    bool Side = false, Got = false;
    if (fabs(A) > 1e-9f && Disc >= 0.0f)
    {
        float Sq = sqrt(Disc);
        for (float Cand : { (-B - Sq) / (2.0f * A), (-B + Sq) / (2.0f * A) })
        {
            if (Cand <= 1e-4f || Cand >= Ts) continue;
            float Z = w.z + Cand * D.z;
            if (Z < 0.0f || Z > g_ConeH) continue;
            Ts = Cand; Got = true; Side = true;
        }
    }
    // base disk z = 0
    if (D.z < -1e-7f)
    {
        float Tb = -w.z / D.z;
        if (Tb > 1e-4f && Tb < Ts)
        {
            vec3 Q = w + Tb * D;
            if (Q.x * Q.x + Q.y * Q.y <= g_ConeR * g_ConeR) { Ts = Tb; Got = true; Side = false; }
        }
    }
    if (!Got) return false;
    T = Ts;
    if (Side)
    {
        vec3 Q = w + T * D;
        N = normalize(vec3(Q.x, Q.y, (g_ConeR * g_ConeR / g_ConeH) * (Q.z / g_ConeH - 1.0f)));
    }
    else N = vec3(0.0f, 0.0f, 1.0f);
    return true;
}

// Ring torus: f(p) = (|p|^2 + R^2 - r^2)^2 - 4R^2(px^2 + py^2) in the torus frame. Bounding-sphere pre-test,
//    then a sign-change scan + bisection - no quartic-solver edge cases to get wrong, and pixels cannot tell.
float TorusF(vec3 p)
{
    float Q = dot(p, p) + g_TorusR * g_TorusR - g_Torusr * g_Torusr;
    return Q * Q - 4.0f * g_TorusR * g_TorusR * (p.x * p.x + p.y * p.y);
}

bool HitTorus(vec3 O, vec3 D, float& T, vec3& N)
{
    vec3 w = O - g_TorusC;
    float Bound = g_TorusR + g_Torusr + 1e-3f;
    // coarse: ray vs bounding sphere
    float Bc = dot(w, D), Cc = dot(w, w) - Bound * Bound;
    float Disc = Bc * Bc - Cc;
    if (Disc < 0.0f) return false;
    float T0 = max(-Bc - sqrt(Disc), 0.0f), T1 = -Bc + sqrt(Disc);
    if (T1 <= 1e-4f) return false;
    float Prev = TorusF(w + D * T0), Step = (T1 - T0) / 96.0f;
    if (fabs(T1 - T0) < 1e-6f) return false;
    for (float Tc = T0 + Step; Tc <= T1 + Step; Tc += Step)
    {
        float Fc = TorusF(w + D * Tc);
        if (Prev * Fc <= 0.0f)
        {
            float A = Tc - Step, Bb = Tc;
            for (int It = 0; It < 24; ++It)
            {
                float M = 0.5f * (A + Bb);
                if (TorusF(w + D * M) * Prev <= 0.0f) Bb = M; else { A = M; Prev = TorusF(w + D * M); }
            }
            float Tm = 0.5f * (A + Bb);
            if (Tm > 1e-4f)
            {
                vec3 P = w + D * Tm;
                float Q = dot(P, P) + g_TorusR * g_TorusR - g_Torusr * g_Torusr;
                N = normalize(vec3(4.0f * Q * P.x, 4.0f * Q * P.y, 4.0f * Q * P.z));
                if (dot(N, D) > 0.0f) N = N * -1.0f;
                T = Tm;
                return true;
            }
        }
        Prev = Fc;
    }
    return false;
}

vec3 RotZ(vec3 V, float A) { float C = cos(A), S = sin(A); return vec3(C * V.x - S * V.y, S * V.x + C * V.y, V.z); }

bool HitBox(vec3 Ctr, vec3 Half, float Yaw, vec3 O, vec3 D, float& T, vec3& N, bool Far = false)
{
    vec3 w = RotZ(O - Ctr, -Yaw), Dl = RotZ(D, -Yaw);
    float Tn = -1e30f, Tf = 1e30f;
    int Ax = 0;
    for (int A = 0; A < 3; ++A)
    {
        float Oa = A == 0 ? w.x : A == 1 ? w.y : w.z;
        float Da = A == 0 ? Dl.x : A == 1 ? Dl.y : Dl.z;
        float Ha = A == 0 ? Half.x : A == 1 ? Half.y : Half.z;
        if (fabs(Da) < 1e-9f) { if (fabs(Oa) > Ha) return false; continue; }
        float T1 = (-Ha - Oa) / Da, T2 = (Ha - Oa) / Da;
        if (T1 > T2) { float Tt = T1; T1 = T2; T2 = Tt; }
        if (T1 > Tn) { Tn = T1; Ax = A; }
        if (T2 < Tf) Tf = T2;
        if (Tn > Tf) return false;
    }
    float Tm = Tn > 1e-4f ? Tn : Tf;
    if (Tm <= 1e-4f) return false;
    if (!Far && Tn <= 1e-4f && Tf > 1e-4f) { /* inside: Far path below */ }
    if (!Far && Tn > 1e-4f) Tm = Tn; else Tm = Tf;
    if (Tm <= 1e-4f) return false;
    T = Tm;
    vec3 Q = w + Dl * Tm;
    vec3 Ln(0.0f);
    float E = 1e-4f;
    if (fabs(Q.x - Half.x) < E) Ln = vec3(1, 0, 0);
    else if (fabs(Q.x + Half.x) < E) Ln = vec3(-1, 0, 0);
    else if (fabs(Q.y - Half.y) < E) Ln = vec3(0, 1, 0);
    else if (fabs(Q.y + Half.y) < E) Ln = vec3(0, -1, 0);
    else if (fabs(Q.z - Half.z) < E) Ln = vec3(0, 0, 1);
    else Ln = vec3(0, 0, Far ? -1 : 1);   // interior far face
    N = RotZ(Ln, Yaw);
    if (dot(N, D) > 0.0f && !Far) N = N * -1.0f;
    return true;
}

// The scene trace: nearest hit over ground + 6 casters + 18 balls, optionally skipping one id (the thin-wall /
//    virtual see-through's own-surface step-past).
bool TraceScene(vec3 O, vec3 D, int& Which, float& T, vec3& P, vec3& N, int SkipId = -1)
{
    T = 1e30f; Which = -1;
    float Ts; vec3 Ns;
    if (SkipId != ObjGround && HitGround(O, D, Ts) && Ts < T) { T = Ts; Which = ObjGround; }
    if (SkipId != ObjSphere1 && HitBall(g_Ball_Sphere1, O, D, Ts) && Ts < T) { T = Ts; Which = ObjSphere1; }
    if (SkipId != ObjSphere2 && HitBall(g_Ball_Sphere2, O, D, Ts) && Ts < T) { T = Ts; Which = ObjSphere2; }
    if (SkipId != ObjCone && HitCone(O, D, Ts, Ns) && Ts < T) { T = Ts; Which = ObjCone; N = Ns; }
    if (SkipId != ObjTorus && HitTorus(O, D, Ts, Ns) && Ts < T) { T = Ts; Which = ObjTorus; N = Ns; }
    if (SkipId != ObjSlab && HitBox(g_SlabC, g_SlabHalf, g_SlabYaw, O, D, Ts, Ns) && Ts < T) { T = Ts; Which = ObjSlab; N = Ns; }
    if (SkipId != ObjCrate && HitBox(g_CrateC, g_CrateHalf, g_CrateYaw, O, D, Ts, Ns) && Ts < T) { T = Ts; Which = ObjCrate; N = Ns; }
    for (int I = 0; I < kBallCount; ++I)
        if (SkipId != ObjBall0 + I && HitBall(GridBall(I), O, D, Ts) && Ts < T) { T = Ts; Which = ObjBall0 + I; }
    if (Which < 0) return false;
    P = O + D * T;
    if (Which == ObjGround) N = vec3(0.0f, 0.0f, 1.0f);
    else if (Which == ObjSphere1) N = (P - g_Ball_Sphere1.C) / g_Ball_Sphere1.R;
    else if (Which == ObjSphere2) N = (P - g_Ball_Sphere2.C) / g_Ball_Sphere2.R;
    else if (Which == ObjCone || Which == ObjTorus || Which == ObjSlab || Which == ObjCrate) { /* HitX wrote N */ }
    else N = (P - GridBall(Which - ObjBall0).C) / GridBall(Which - ObjBall0).R;
    return true;
}

bool Occluded(vec3 P, vec3 D, float MaxT)
{
    int W; float T; vec3 Hp, Hn;
    return TraceScene(P, D, W, T, Hp, Hn) && T < MaxT;
}

// The solid walk's exit: the SAME object's far root + the chord length (the K4 Beer segment).
bool SolidExit(int Obj, vec3 P, vec3 D, float& Chord)
{
    float Tf;
    if (Obj == ObjSlab) { vec3 Ns; if (!HitBox(g_SlabC, g_SlabHalf, g_SlabYaw, P + D * 1e-4f, D, Tf, Ns, /*Far=*/true)) return false; }
    else { const Ball& S = GridBall(Obj - ObjBall0); if (!HitBall(S, P + D * 1e-4f, D, Tf, /*Far=*/true)) return false; }
    Chord = Tf;
    return true;
}

// Direct sun with the kernel's split: above-horizon = the plain DI candidate; below = the K5 stratum at W_L
//    (only when the material owns a below stratum at all).
vec3 DirectSun(vec3 P, const SurfFrame& F, vec3 wo, ShadingRecord m, ResolvedLayers L)
{
    vec3 sDir = SampleSunDirection(SkySunDirection.xyz, Rand01(), Rand01());
    vec3 wi = ToLocalFrame(F, sDir);
    if (wi.z > 0.0f)
    {
        if (Occluded(P, sDir, 1.0e4f)) return vec3(0.0f);
        return EvaluateBsdf(m, L, wo, wi) * (wi.z * SunEmission() * SunSolidAngle());
    }
    if (L.SssMix <= 0.0f) return vec3(0.0f);
    vec3 Fv = EvaluateBsdf(m, L, wo, wi);
    if (Fv.x == 0.0f && Fv.y == 0.0f && Fv.z == 0.0f) return vec3(0.0f);
    float Pl = 1.0f / SunSolidAngle();
    float Pb = PdfBsdf(m, L, wo, wi);
    float W = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    return Fv * ((-wi.z) * W / max(Pl, 1e-12f)) * SunEmission();
}

vec3 ShadeAt(vec3 P, vec3 N, vec3 ViewDir, int Which);

// One GI bounce: SampleBsdf → escape (SkyAlong at weight 1) / endpoint (emission, or the ground's own sun NEE —
//    the kernel's "plain path tracing with NEE" one-bounce structure). The K4 solid walk enters the medium on a
//    below draw from a solid primary; the M9 virtual see-through collects the dome a pure-SSS below draw faces.
vec3 GiBounce(vec3 P, vec3 GeomN, const SurfFrame& F, vec3 wo, ShadingRecord m, ResolvedLayers L, int Which)
{
    vec4 B = SampleBsdf(m, L, wo, vec4(Rand01(), Rand01(), Rand01(), Rand01()));
    if (B.w <= 0.0f) return vec3(0.0f);
    vec3 Through = EvaluateBsdf(m, L, wo, B.xyz) * (abs(B.z) / max(B.w, 1e-12f));
    Through = min(Through, vec3(8.0f));   // the kernel's firefly clamp (K4 mirror)
    vec3 Dir = FromLocalFrame(F, B.xyz);

    bool Solid = m.TransmissionWeight > 0.0f && m.TransmissionThickness > 0.0f;
    bool Foil = m.TransmissionWeight > 0.0f && m.TransmissionThickness <= 0.0f;
    bool EnteredSolid = Solid && B.z < 0.0f;
    vec3 Org = EnteredSolid ? P + Dir * 3e-4f
                            : P + GeomN * (dot(Dir, GeomN) > 0.0f ? 3e-4f : -3e-4f);

    if (EnteredSolid)
    {
        // K4: Beer over the true interior segment to the EXIT BACKFACE, and there the path dies (the kernel's
        //    bounce endpoint skips NEE from inside, has no emission, and the one-bounce cap ends the walk).
        float Chord;
        if (!SolidExit(Which, P, Dir, Chord)) return vec3(0.0f);
        Through = Through * exp(-L.TransmissionSigma * Chord);
        return vec3(0.0f);   // the exit backface contributes nothing (the kernel's structure)
    }

    // The M9 pure-SSS virtual: a below draw from a pure-SSS mat is a backlight direction, not a transport
    //    vertex — step past the own surface (translucent see-through, the walk bound 4) and collect what it
    //    faces at the K5-complementary weight W_B (light stratum absent here: no mesh lights, so sky keeps
    //    weight 1 and emitter hits keep weight 1 — the exhibit's closure lives in MaterialReuseProof §B).
    int Skip = Which;
    if (B.z < 0.0f && L.TransmitMix <= 0.0f && L.SssMix > 0.0f)
    {
        bool Found = false;
        for (int Step = 0; Step < 4 && !Found; ++Step)
        {
            int W2; float T2; vec3 P2, N2;
            if (!TraceScene(Org, Dir, W2, T2, P2, N2, Skip)) break;   // escaped between steps: fall through to sky
            ShadingRecord& M2 = g_Mat[W2];
            if (dot(M2.Emission, M2.Emission) > 0.0f) return Through * M2.Emission;   // emitter: weight 1
            if (M2.TransmissionWeight > 0.0f)   // a transmissive occluder is stepped past (the walk's rule)
            {
                Org = P2 + Dir * 3e-4f; Skip = W2;
                continue;
            }
            if (W2 == ObjGround)
            {
                SurfFrame FG = BuildFrame(N2);
                vec3 WoG = ToLocalFrame(FG, Dir * -1.0f);
                ResolvedLayers LG = ResolveLayers(M2, WoG);
                return Through * DirectSun(P2, FG, WoG, M2, LG);   // the ground endpoint's own sun NEE
            }
            return vec3(0.0f);   // a plain occluder behind the shell: the walk's dead end
        }
        return Through * SkyAlong(Dir);   // stepped through everything: the dome, weight 1
    }

    int W; float T; vec3 HP, HN;
    if (!TraceScene(Org, Dir, W, T, HP, HN, Foil ? Which : -1))
        return Through * (SkyAlong(Dir) + RainbowAlong(Dir, SkySunDirection.xyz, 1.0e6f));
    ShadingRecord& Mh = g_Mat[W];
    if (dot(Mh.Emission, Mh.Emission) > 0.0f) return Through * Mh.Emission;   // kernel :1459 endpoint emission
    if (W == ObjGround)
    {
        SurfFrame FG = BuildFrame(HN);
        vec3 WoG = ToLocalFrame(FG, Dir * -1.0f);
        ResolvedLayers LG = ResolveLayers(Mh, WoG);
        return Through * DirectSun(HP, FG, WoG, Mh, LG);
    }
    return vec3(0.0f);   // endpoint on another object: no emission, 1-bounce cap (the kernel's structure)
}

vec3 ShadeAt(vec3 P, vec3 N, vec3 ViewDir, int Which)
{
    SurfFrame F = BuildFrame(N);
    vec3 wo = ToLocalFrame(F, ViewDir);
    if (wo.z <= 0.0f) wo = vec3(wo.x, wo.y, 1e-3f);

    ShadingRecord m = g_Mat[Which];
    ResolvedLayers L = ResolveLayers(m, wo);
    // The kernel's solid-primary opt-in: a solid transmissive resolves the BARE single interface; foil keeps
    //    the double-refraction default.
    if (m.TransmissionWeight > 0.0f && m.TransmissionThickness > 0.0f) L.SolidInterface = true;
    // The tracer-side chord at this hit (K5 mirror): scale the thickness by the view's obliquity like a shell.
    if (m.SssWeight > 0.0f) m.SssThickness = max(m.SssThickness * (0.35f + 0.65f * wo.z), 0.012f);

    vec3 Col = DirectSun(P, F, wo, m, L);
    Col = Col + GiBounce(P, N, F, wo, m, L, Which);
    Col = Col + m.Emission;   // the shade term's own emission (kernel adds it at the hit, not inside f)
    return Col;
}

struct PanelOut { std::vector<vec4> Hdr; int W, H; };

void RenderPanel(std::vector<vec4>& Out, int W, int H, int Spp,
                 vec3 CamPos, vec3 Fwd, float TanHalf, uint64_t Seed)
{
    const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Fwd);
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
                    if (!TraceScene(CamPos, Dir, Wch, T, HP, HN))
                        Col = SkyAlong(Dir) + RainbowAlong(Dir, SkySunDirection.xyz, 1.0e6f);
                    else Col = ShadeAt(HP, HN, Dir * -1.0f, Wch);
                    Acc = Acc + vec4(Col, 1.0f);
                }
                float Nn = float(Spp);
                Out[size_t(y) * W + x] = vec4(Acc.x / Nn, Acc.y / Nn, Acc.z / Nn, 1.0f);
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

// Mean luma over a ball's projected disk in a rendered panel (the gates' probe).
double BallDiskLuma(const std::vector<vec4>& Hdr, int W, int H, vec3 CamPos, vec3 Fwd, float TanHalf, const Ball& S)
{
    const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Fwd);
    const float Aspect = float(W) / float(H);
    vec3 Lc = S.C - CamPos;
    float Along = dot(Lc, Fwd);
    if (Along <= 0.0f) return 0.0;
    vec2 Sx(dot(Lc, Right) / Along, dot(Lc, Up) / (Along * -1.0f));
    // NDC: x right, y up — the panel's y grows downward.
    float Nx = Sx.x / (TanHalf * Aspect), Ny = Sx.y / TanHalf;
    int Cx = int((Nx * 0.5f + 0.5f) * W), Cy = int((Ny * 0.5f + 0.5f) * H);
    int Rp = int(S.R / (Along * TanHalf) * (H * 0.5f));
    if (Rp < 2) Rp = 2;
    double Sum = 0.0; int Count = 0;
    for (int dy = -Rp; dy <= Rp; ++dy)
        for (int dx = -Rp; dx <= Rp; ++dx)
        {
            if (dx * dx + dy * dy > Rp * Rp) continue;
            int X = Cx + dx, Y = Cy + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            Sum += dot(vec3(Hdr[size_t(Y) * W + X].x, Hdr[size_t(Y) * W + X].y, Hdr[size_t(Y) * W + X].z),
                       vec3(0.2126f, 0.7152f, 0.0722f));
            ++Count;
        }
    return Count ? Sum / Count : 0.0;
}

vec3 BallDiskRgb(const std::vector<vec4>& Hdr, int W, int H, vec3 CamPos, vec3 Fwd, float TanHalf, const Ball& S)
{
    const vec3 Right = normalize(cross(Fwd, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Fwd);
    const float Aspect = float(W) / float(H);
    vec3 Lc = S.C - CamPos;
    float Along = dot(Lc, Fwd);
    if (Along <= 0.0f) return vec3(0.0f);
    float Nx = (dot(Lc, Right) / Along) / (TanHalf * Aspect), Ny = (dot(Lc, Up) / (Along * -1.0f)) / TanHalf;
    int Cx = int((Nx * 0.5f + 0.5f) * W), Cy = int((Ny * 0.5f + 0.5f) * H);
    int Rp = int(S.R / (Along * TanHalf) * (H * 0.5f));
    if (Rp < 2) Rp = 2;
    vec3 Sum(0.0f); int Count = 0;
    for (int dy = -Rp / 2; dy <= Rp / 2; ++dy)
        for (int dx = -Rp / 2; dx <= Rp / 2; ++dx)
        {
            int X = Cx + dx, Y = Cy + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            Sum = Sum + vec3(Hdr[size_t(Y) * W + X].x, Hdr[size_t(Y) * W + X].y, Hdr[size_t(Y) * W + X].z);
            ++Count;
        }
    return Count ? Sum * (1.0f / float(Count)) : vec3(0.0f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE PROOFS + SHEET
//------------------------------------------------------------------------------------------------------------------------

void ProofGrid()
{
    std::printf("[grid] materials + panels\n");

    // ① All 24 materials pairwise distinct (a material hash over the fields that drive shading).
    {
        auto Hash = [](const ShadingRecord& M)
        {
            uint64_t H = 1469598103934665603ull;
            auto Mix = [&](float F) { uint32_t Q; std::memcpy(&Q, &F, 4); H = (H ^ Q) * 1099511628211ull; };
            Mix(M.BaseColor.x); Mix(M.BaseColor.y); Mix(M.BaseColor.z); Mix(M.Metalness);
            Mix(M.SpecularWeight); Mix(M.SpecularRoughness); Mix(M.CoatWeight); Mix(M.FuzzWeight);
            Mix(M.FuzzColor.x); Mix(M.FuzzColor.y); Mix(M.FuzzColor.z);
            Mix(M.ThinFilmWeight); Mix(M.ThinFilmThickness); Mix(M.HazinessWeight);
            Mix(M.Emission.x); Mix(M.Emission.y); Mix(M.Emission.z);
            Mix(M.TransmissionWeight); Mix(M.TransmissionThickness); Mix(M.SssWeight); Mix(M.SssThickness);
            Mix(float(M.Selection));
            return H;
        };
        bool Distinct = true;
        for (int A = 0; A <= ObjLast; ++A)
            for (int Bx = A + 1; Bx <= ObjLast; ++Bx)
                if (Hash(g_Mat[A]) == Hash(g_Mat[Bx])) Distinct = false;
        CHECK(Distinct, "all 25 materials pairwise distinct (ground + 6 casters + 18 archetypes, hash over the shading fields)");
    }

    // ② The three panels.
    const uint64_t Seed = 0xC0FFEE11u;
    std::vector<vec4> Field(size_t(960) * 540), Balls(size_t(1024) * 460), Original(size_t(520) * 300);

    // The establishing view: the whole field — grid rows in the foreground, the casters with their unique
    //    materials behind, sun + sky over all of it.
    {
        vec3 CamPos(2.0f, -21.0f, 8.0f);
        vec3 Fwd = normalize(vec3(-0.15f, 1.0f, -0.22f));
        RenderPanel(Field, 960, 540, 64, CamPos, Fwd, 0.4663f, Seed);
        WritePanel("Exhibits/Gallery/Materials/OutdoorGrid_Field.png", Field, 960, 540);
    }
    // The grid close-up: the two archetype rows fill the frame.
    vec3 BallsCam(0.0f, -10.0f, 2.5f), BallsFwd = normalize(vec3(0.0f, 1.0f, -0.085f));
    const float BallsTan = 0.767f;   // 75 degrees vertical - the 18-ball spread needs it
    {
        RenderPanel(Balls, 1024, 460, 96, BallsCam, BallsFwd, BallsTan, Seed + 1u);
        WritePanel("Exhibits/Gallery/Materials/OutdoorGrid_Balls.png", Balls, 1024, 460);
    }
    // The original Project-Zero camera (GameExecution's Outdoor framing) — the current scene, materials re-cast.
    vec3 OrigCam(0.0f, -6.0f, 1.70f), OrigFwd = normalize(vec3(0.0f, 1.0f, std::sin(8.0f * 3.14159265358979323846f / 180.0f)));
    {
        RenderPanel(Original, 520, 300, 96, OrigCam, OrigFwd, 0.4145f, Seed + 2u);   // 55° vertical ≈ 0.4145
        WritePanel("Exhibits/Gallery/Materials/OutdoorGrid_Original.png", Original, 520, 300);
    }

    // ③ The panels are alive.
    {
        double FL = 0.0, BL = 0.0, OL = 0.0;
        for (size_t i = 0; i < Field.size(); ++i) FL += dot(vec3(Field[i].x, Field[i].y, Field[i].z), vec3(0.2126f, 0.7152f, 0.0722f));
        for (size_t i = 0; i < Balls.size(); ++i) BL += dot(vec3(Balls[i].x, Balls[i].y, Balls[i].z), vec3(0.2126f, 0.7152f, 0.0722f));
        for (size_t i = 0; i < Original.size(); ++i) OL += dot(vec3(Original[i].x, Original[i].y, Original[i].z), vec3(0.2126f, 0.7152f, 0.0722f));
        FL /= Field.size(); BL /= Balls.size(); OL /= Original.size();
        CHECK(FL > 0.02 && BL > 0.02 && OL > 0.02,
              "all three panels are alive (mean luma field %.4f, balls %.4f, original %.4f)", FL, BL, OL);
    }

    // ④ The emission ball dominates every other ball's disk (it is the only light in the grid).
    {
        double Emission = BallDiskLuma(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(15));
        double Worst = 0.0; int WorstI = -1;
        for (int I = 0; I < kBallCount; ++I)
        {
            if (I == 15) continue;
            double L = BallDiskLuma(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(I));
            if (L > Worst) { Worst = L; WorstI = I; }
        }
        CHECK(Emission > Worst * 1.5,
              "the emission ball dominates (%.4f vs next-best %s %.4f)", Emission, MaterialName(WorstI), Worst);
    }

    // ⑤ The foil ball transmits the dome the solid glass ball cannot (the SkyGlassProof contrast, grid edition).
    {
        double Foil = BallDiskLuma(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(3));
        double Solid = BallDiskLuma(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(2));
        CHECK(Foil > Solid * 1.5,
              "the foil ball transmits the dome the solid glass ball cannot (%.4f vs %.4f)", Foil, Solid);
    }

    // ⑥ The metals read their tint; the SSS balls read theirs.
    {
        vec3 Gold = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(7));
                vec3 Copper = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(8));
        vec3 Jade = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(13));
        vec3 Azure = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(1));
        vec3 Velvet = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(10));
        vec3 Felt = BallDiskRgb(Balls, 1024, 460, BallsCam, BallsFwd, BallsTan, GridBall(11));
        CHECK(Gold.x > Gold.z * 1.3f && Gold.x > Gold.y * 1.15f,
              "gold reads warm (gold %.3f/%.3f/%.3f)", Gold.x, Gold.y, Gold.z);
        CHECK(Velvet.x > Velvet.z * 1.5f && Felt.z > Felt.x * 1.5f,
              "the fuzz primaries read their tint (velvet %.3f/%.3f/%.3f, felt %.3f/%.3f/%.3f)",
              Velvet.x, Velvet.y, Velvet.z, Felt.x, Felt.y, Felt.z);
        CHECK(Jade.y > Jade.x * 1.2f, "jade reads green (%.3f/%.3f/%.3f)", Jade.x, Jade.y, Jade.z);
        CHECK(Azure.z > Azure.x * 1.3f, "the clearcoat ball reads its azure base (%.3f/%.3f/%.3f)", Azure.x, Azure.y, Azure.z);
    }

    // ⑦ The legend (what each grid position is).
    std::printf("  ..  ball legend — row A (north, y = +0.5), row B (south, y = -2.0); columns x = -12 ... +12 step 3\n");
    for (int Row = 0; Row < kGridRows; ++Row)
        for (int C = 0; C < kGridCols; ++C)
            std::printf("  ..  %s %s at x = %+d\n", Row == 0 ? "A" : "B", MaterialName(Row * kGridCols + C),
                        int(kGridX0 + C * kGridDx));
    std::printf("  ..  casters: white sphere → clearcoat white, steel sphere → chrome, clay cone → terracotta, "
                "steel torus -> brushed gold, slab -> solid glass, crate -> cast iron\n");
    std::printf("  ..  panels: Exhibits/Gallery/Materials/OutdoorGrid_{Field,Balls,Original}.png\n");
}

} // namespace

int main()
{
    std::setlocale(LC_ALL, "C");
    std::printf("OUTDOOR MATERIAL GRID (M9): the open-air scene + the 18-archetype ball grid, CPU-rendered\n");

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);   // production bakes 4096; 1024 proves the maths
    g_Tables = &Tables;

    LoadSky(25.0f, 35.0f, true);
    Exposure = 1.05f; ColourSaturation = 1.0f;   // the kernel tone map's constants (MaterialReuseProof §C pins them)

    BuildMaterials();
    ProofGrid();

    std::printf("OUTDOOR GRID: %s (%d ok, %d FAIL)\n", g_Fail == 0 ? "PASS" : "FAIL", g_Pass, g_Fail);
    return g_Fail == 0 ? 0 : 1;
}
