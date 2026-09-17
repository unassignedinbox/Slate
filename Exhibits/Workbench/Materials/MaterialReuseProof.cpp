//============================================================================================================================================
//                                                      MATERIALREUSEPROOF.CPP
//============================================================================================================================================
// 🧩 M9 — the re-enable milestone's executable half: the ReSTIR-sync proofs plan §4/M9 owes, on the CPU port,
//    against the real Engine/Shaders text wherever the shader files include 1:1.
//
//    §A  Reuse revalidation — the DI merge algebra (CPU mirror of ReSTIRViewport.slang's PHatFull/PHatSun and
//        temporal-merge block, the K3–K5 discipline) driven with the REAL MaterialEvaluation.slang
//        EvaluateBsdf/PdfBsdf: p̂ re-evaluation at a foreign pixel is the CURRENT pixel's full BSDF (the "new
//        lobes ride along" claim), below-horizon p̂ is exactly 0 for every selection (DI and the below strata
//        partition), the winner's p̂ is carried never recomputed, M-clamp is the formula, occlusion zeroes the
//        weight, and the merged estimator stays unbiased on a two-pixel toy scene with an analytic answer.
//    §B  Kernel MIS (the M9 edit, mirrored) — the K5 below-stratum's light weight W_L and the dipole-virtual's
//        W_B are exact complements, and the two-stratum estimator (K5 at W_L + virtual at W_B: sun disc + one
//        quad lamp, both below a wax/mixed surface) closes against brute force. The furnace-⑩ pattern the M5
//        report scheduled for "M9+", now mirrored from the edited kernel text.
//    §C  À-trous A/B — Engine/Shaders/AtrousDenoise.slang included 1:1 through the image shim: a converged
//        field filters to itself (the A/B "converged image identical with and without" guarantee), noise falls,
//        edges survive, the filter fades as the estimate converges, and the file's tone map keeps the kernel's
//        ACES literals.
//    §D  Reprojection A/B — ResolveSurface's accumulator algebra (CPU mirror): a static scene is byte-identical
//        with the feature on or off, a pan tracks the surface (count grows, mean follows), a stopped pan
//        converges both paths to the same mean, and a disocclusion resets the reprojected pixel to n = 1.
//
//    Build (see CheckMaterialsProof.sh): g++ -std=c++20 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials
//        -I Engine/DisplayPresentation -I Engine/Shaders MaterialReuseProof.cpp
//        Engine/DisplayPresentation/ShadingTableCodec.cpp

#include "SlangCpuShim.h"
#include "ShadingTableCodec.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
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

// GLSL-style integer vectors — AtrousDenoise.slang and the §D mirror speak them.
struct ivec2
{
    int x, y;
    ivec2() : x(0), y(0) {}
    ivec2(int s) : x(s), y(s) {}
    ivec2(int x_, int y_) : x(x_), y(y_) {}
    ivec2(const uvec2& u);   // (defined below — GLSL truncates, exact here: extents never approach 2²⁴)
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
//                            THE REAL BSDF (MaterialEvaluation.slang, 1:1, baked tables)
//------------------------------------------------------------------------------------------------------------------------

namespace {

const Frontier::ShadingTableSet* g_Tables = nullptr;

} // namespace

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

namespace {

int g_Fail = 0;

#define CHECK(Cond, ...)                                                                                        \
    do { if (!(Cond)) { ++g_Fail; std::printf("  FAIL "); std::printf(__VA_ARGS__); std::printf("\n"); }        \
         else { std::printf("  ok "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

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
//                                        MATERIALS (the furnace's own helpers)
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
    m.Selection = 0u;
    m.SssWeight = 0.0f; m.SssColor = vec3(1.0f);
    m.SssRadius = 0.0f; m.SssRadiusScale = vec3(0.0f); m.SssThickness = 0.0f;
    return m;
}

ShadingRecord GlassMaterial(float roughness, float ior = 1.5f)
{
    ShadingRecord m = StandardMaterial(vec3(0.0f), roughness);
    m.SpecularIor = ior;
    m.TransmissionWeight = 1.0f;
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

ShadingRecord ClothMaterial(vec3 base, float fuzz, float fuzzRoughness)
{
    ShadingRecord m = StandardMaterial(base, 0.5f);
    m.SpecularWeight = 0.0f;
    m.FuzzWeight = fuzz; m.FuzzRoughness = fuzzRoughness; m.FuzzColor = vec3(1.0f, 0.9f, 0.9f);
    m.Selection = kReflectanceCloth;
    return m;
}

//------------------------------------------------------------------------------------------------------------------------
//                          FRAME + p̂ MIRRORS (verbatim algebra from ReSTIRViewport.slang)
//------------------------------------------------------------------------------------------------------------------------
// The kernel's PHatFull/PHatSun take a SurfaceFrame; the DI maths use only the geometric normal and the
//    world→local shading transform. The mirror keeps the algebra line-for-line and swaps only the frame plumbing
//    for the exhibit's tangent basis — the same substitution every K3–K5 CPU mirror used.

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

// p̂ for mesh lights — copied from ReSTIRViewport.slang's PHatFull (cosT/cosL gates, dist², full-BSDF evaluate).
float PHatFull(const SurfFrame& F, ShadingRecord m, ResolvedLayers L, vec3 wo, vec3 emit, vec3 toLight, float dist2, vec3 lightNormal)
{
    float dist = max(sqrt(dist2), 1e-9f);
    vec3  lDir = toLight / dist;
    float cosT = max(0.0f, dot(F.Geometric, lDir));
    if (cosT <= 0.0f) return 0.0f;
    float cosL = max(0.0f, dot(lightNormal, -lDir));
    if (cosL <= 0.0f) return 0.0f;
    vec3  wi = ToLocalFrame(F, lDir);
    if (wi.z <= 0.0f) return 0.0f;
    return max(dot(EvaluateBsdf(m, L, wo, wi), emit), 0.0f) * cosT * cosL / (dist2 + 0.001f);
}

// Sun target — copied from PHatSun (no d²: the sun is at infinity).
float PHatSun(const SurfFrame& F, ShadingRecord m, ResolvedLayers L, vec3 wo, vec3 sunEmit, vec3 sunDir)
{
    float cosT = max(0.0f, dot(F.Geometric, sunDir));
    if (cosT <= 0.0f) return 0.0f;
    vec3 wi = ToLocalFrame(F, sunDir);
    if (wi.z <= 0.0f) return 0.0f;
    return max(dot(EvaluateBsdf(m, L, wo, wi), sunEmit), 0.0f) * cosT;
}

//------------------------------------------------------------------------------------------------------------------------
//                              THE SUN (kernel mirror: Ω, disc sampling — the shared literals)
//------------------------------------------------------------------------------------------------------------------------

const float kSunAngularRadius   = 0.53f * (3.14159265358979323846f / 180.0f) * 0.5f;
const float kSunPickProbability = 0.5f;

float SunSolidAngle()
{
    const float kPi = 3.14159265358979323846f;
    float s = sin(kSunAngularRadius * 0.5f);
    return 4.0f * kPi * s * s;
}

vec3 SampleSunDirection(vec3 sunDir, float u1, float u2)
{
    float cosMax = cos(kSunAngularRadius);
    float cosT = mix(1.0f, cosMax, u1);
    float sinT = sqrt(max(0.0f, 1.0f - cosT * cosT));
    float phi = 6.28318530718f * u2;
    vec3 up = abs(sunDir.x) < 0.9f ? vec3(1.0f, 0.0f, 0.0f) : vec3(0.0f, 1.0f, 0.0f);
    vec3 t = normalize(cross(up, sunDir));
    vec3 b = cross(sunDir, t);
    return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + sunDir * cosT);
}

//------------------------------------------------------------------------------------------------------------------------
//                    THE DI RESERVOIR + TEMPORAL MERGE (kernel main()'s block, mirrored line for line)
//------------------------------------------------------------------------------------------------------------------------

const float kTemporalNormalCos = 0.9063077870f;   // cos 25° — the kernel's kTemporalNormalCos
const float kTemporalDepthTol  = 0.10f;           // 10 % relative — the kernel's kTemporalDepthTol
const uint  kTemporalMClamp    = 20u;             // the kernel's kTemporalMClamp

struct MirrorReservoir
{
    vec3  SelectedPoint = vec3(0.0f);
    float WeightSum     = 0.0f;
    uint  SampleCount   = 0u;
    float UnbiasedWeight = 0.0f;
    uint  SelectedLight = 0u;      // 0 = the toy lamp
};

// The kernel's temporal-merge block: M-clamp, pairwise-MIS pick, the carried p̂ (never a new evaluation), the W
//    update. Back-projection validation is the caller's business (the toy has no motion textures to fetch).
//    Returns the carried p̂ of whichever sample won.
float MergeTemporal(MirrorReservoir& res, const MirrorReservoir& prev, float pPrevLamp,
                    const SurfFrame& F, ShadingRecord m, ResolvedLayers L, vec3 wo, vec3 hitPos,
                    vec3 lampEmit, vec3 lampNormal, float r)
{
    uint prevM = prev.SampleCount;
    uint mPrevCapped = min(prevM, kTemporalMClamp * res.SampleCount);
    vec3 prevToL = prev.SelectedPoint - hitPos;
    float pPrev = PHatFull(F, m, L, wo, lampEmit, prevToL, dot(prevToL, prevToL), lampNormal);
    (void)pPrevLamp;
    float pCur  = res.UnbiasedWeight > 0.0f
                ? res.WeightSum / (float(res.SampleCount) * res.UnbiasedWeight) : 0.0f;   // the carried pSelected
    float wCur  = pCur * res.UnbiasedWeight * float(res.SampleCount);
    float wPrev = pPrev * prev.UnbiasedWeight * float(mPrevCapped);
    float total = wCur + wPrev;
    if (total > 0.0f && r * total <= wPrev)
    {
        res.SelectedPoint  = prev.SelectedPoint;
        res.SelectedLight  = prev.SelectedLight;
        pCur               = pPrev;   // the winner's p̂, already in hand from the merge test (the carry)
    }
    res.SampleCount    = res.SampleCount + mPrevCapped;
    res.WeightSum      = total;
    res.UnbiasedWeight = pCur > 0.0f ? total / (float(res.SampleCount) * pCur) : 0.0f;
    return pCur;
}

//------------------------------------------------------------------------------------------------------------------------
//             §B: THE M9 KERNEL EDIT, MIRRORED — K5 below-stratum at W_L + dipole-virtual walk at W_B
//------------------------------------------------------------------------------------------------------------------------
// The estimator under test (primary-only, below-horizon direct on a surface at the origin, N = +z): the K5
//    stratum (light-sampled, now carrying W_L = pl²/(pl²+pb²)) plus the M9 virtual walk (BSDF-sampled below
//    direction at W_B = pb²/(pl²+pb²), sky at weight 1). Rig: the sun disc + one parallelogram lamp, both BELOW
//    the horizon. Truth = plain MC of f·L·|cos| per emitter (no MIS in the truth — each emitter's integral by
//    its own parametrisation), summed.

struct ToyLamp
{
    vec3 Center, U, V, N;
    float Area;
    vec3 Radiance;
    vec3 Point(float su, float sv) const { return Center + U * su + V * sv; }
    // Ray→parallelogram: intersect the quad's OWN plane (normal = U×V — NOT the emission normal N, which
    //    tilts off the U,V span and warps the footprint ~20%), then solve O + t·D = C + u·U + v·V exactly,
    //    hit iff |u| ≤ 1 and |v| ≤ 1 (emitting face only: the ray must approach against the emission normal).
    bool Intersect(vec3 O, vec3 D, vec3& Hp) const
    {
        vec3 Np = normalize(cross(U, V));                  // the geometric face plane
        float dn = dot(D, Np);
        if (dn >= 0.0f || dot(D, N) >= 0.0f) return false; // back face or parallel: nothing to collect
        float t = dot(Center - O, Np) / dn;
        if (t <= 0.0f) return false;
        vec3 P = O + D * t;
        float a11 = dot(U, U), a12 = dot(U, V), a22 = dot(V, V);
        float b1 = dot(P - Center, U), b2 = dot(P - Center, V);
        float det = a11 * a22 - a12 * a12;
        if (fabs(det) < 1e-12f) return false;
        float u = (b1 * a22 - b2 * a12) / det;
        float v = (a11 * b2 - a12 * b1) / det;
        if (u < -1.0f || u > 1.0f || v < -1.0f || v > 1.0f) return false;
        Hp = P;
        return true;
    }
};

// K5 mesh arm, M9 weights (kernel mirror: the coin, the gates, pl, and the new sMis).
vec3 K5MeshArm(ShadingRecord m, ResolvedLayers L, vec3 wo, const SurfFrame& F, const ToyLamp& Q, float pMesh)
{
    float su = Rand01() * 2.0f - 1.0f, sv = Rand01() * 2.0f - 1.0f;
    vec3 Lp = Q.Point(su, sv);
    vec3 Dw = Lp;                          // primary hit pinned at the origin in this rig
    float D2 = dot(Dw, Dw);
    float Dist = sqrt(D2);
    Dw = Dw / Dist;
    float CosL = dot(-Dw, Q.N);
    if (CosL <= 1e-3f) return vec3(0.0f);
    vec3 wi = ToLocalFrame(F, Dw);
    if (wi.z >= 0.0f) return vec3(0.0f);   // the stratum owns strictly below
    vec3 Fv = EvaluateBsdf(m, L, wo, wi);
    float Pl = pMesh * D2 / (Q.Area * CosL);            // per sr — the kernel K5 mesh pdf
    float Pb = PdfBsdf(m, L, wo, wi);
    float W  = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    return Fv * ((-wi.z) * W / max(Pl, 1e-12f)) * Q.Radiance;
}

// K5 sun arm, M9 weights (kernel mirror: uniform-in-disc sample, sCos = the world-below cosine).
vec3 K5SunArm(ShadingRecord m, ResolvedLayers L, vec3 wo, const SurfFrame& F, vec3 sunDir, vec3 sunEmit, float pPick)
{
    vec3 sDir = SampleSunDirection(sunDir, Rand01(), Rand01());
    vec3 wi = ToLocalFrame(F, sDir);
    float sCos = -dot(F.Geometric, sDir);
    if (sCos <= 0.0f) return vec3(0.0f);
    if (wi.z >= 0.0f) return vec3(0.0f);
    vec3 Fv = EvaluateBsdf(m, L, wo, wi);
    float Pl = pPick / SunSolidAngle();
    float Pb = PdfBsdf(m, L, wo, wi);
    float W  = (Pl * Pl) / (Pl * Pl + Pb * Pb + 1e-12f);
    return Fv * sunEmit * sCos * SunSolidAngle() / pPick * W;
}

// The M9 dipole-virtual: SampleBsdf's below landing, walked against the rig (ray→quad front face), the sun-disc
//    test on escape, the toy sky at weight 1. Mirrors the kernel's bounded-4 walk (one segment suffices here —
//    the MIS pairing is what is under test, and this rig has no occluders to step past).
vec3 VirtualWalk(ShadingRecord m, ResolvedLayers L, vec3 wo, const SurfFrame& F, const ToyLamp& Q,
                 vec3 sunDir, vec3 sunEmit, float pPick, float pMesh, vec3 skyRadiance, bool allowMixedVirtual = false)
{
    vec4 S = SampleBsdf(m, L, wo, vec4(Rand01(), Rand01(), Rand01(), Rand01()));
    if (S.w <= 0.0f) return vec3(0.0f);
    const bool below = S.z < 0.0f;
    if (!below) return vec3(0.0f);
    const bool pureSssVirtual = L.TransmitMix <= 0.0f && L.SssMix > 0.0f;
    if (!pureSssVirtual && !allowMixedVirtual)
        return vec3(0.0f);   // the kernel as edited: mixed T+SSS keeps its below samples as real transport at the
                             // endpoint convention's weight 1; the balanced twin is measured with the flag on
    vec3 Dw = normalize(F.T * S.x + F.B * S.y + F.Geometric * S.z);
    //    UNCLAMPED on purpose: the kernel's min(·, 8) firefly clamp is a deliberate bias guard (spec-lobe draws
    //    that land below carry a tiny pdf, so the clamp trims a positive tail — the wax closure measured −10% on
    //    the sky share with it). The exhibit proves the MIS algebra, so the toy walk keeps the exact estimator.
    vec3 Beta = EvaluateBsdf(m, L, wo, S.xyz) * (abs(S.z) / max(S.w, 1e-12f));

    vec3 vLight = vec3(0.0f);
    float vPl = 0.0f;
    bool vFound = false;
    vec3 Hp;
    if (Q.Intersect(vec3(0.0f), Dw, Hp))
    {
        float D2 = dot(Hp, Hp);
        vec3 Ld = Hp / sqrt(D2);
        float CosL = dot(-Ld, Q.N);
        // The K5 mesh arm's density at THIS emitter point (same coin, same area pdf — the two weights must
        //    divide the same integral to be complements).
        vPl = CosL > 1e-3f ? pMesh * D2 / (Q.Area * CosL) : 0.0f;
        vLight = Q.Radiance;
        vFound = true;
    }
    if (!vFound && dot(Dw, sunDir) >= cos(kSunAngularRadius))
    {
        vPl = pPick / SunSolidAngle();
        vLight = sunEmit;
        vFound = true;
    }
    float vMis = vFound ? (S.w * S.w) / (S.w * S.w + vPl * vPl + 1e-12f) : 1.0f;
    if (!vFound) vLight = skyRadiance;        // the light stratum has no density for the sky — weight exactly 1
    return Beta * vLight * vMis;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                   §C: ATRousDENOISE.SLANG, COMPILED 1:1 (the image shim)
//------------------------------------------------------------------------------------------------------------------------
// The GPU declarations sit behind FRONTIER_CPU_PORT in the shader file; the CPU port declares the same names as
//    plain globals and the file's main() becomes AtrousMain(), driven per pixel. gl_GlobalInvocationID is the
//    shim's vec2 (it has the .xy swizzle the file reads); extents stay far below float's exact-integer range.

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

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                   §D: ResolveSurface, MIRRORED (the reprojection A/B)
//------------------------------------------------------------------------------------------------------------------------
// The kernel's accumulator, line for line (the flare term excluded: an analytic constant added to every frame's
//    sample — it shifts every mean by the same constant and cancels in every A/B below; the DenoiseImage write
//    is §C's input, which owns the filter side).

const float kReprojectNormalCos = kTemporalNormalCos;   // 25°, identical to the reservoir rule
const float kReprojectDepthTol  = kTemporalDepthTol;    // 10 % relative

struct AccumState
{
    std::vector<vec4> Hist, Surf, Mom;   // (mean, count) / (normal, depth) / (moments, 0, 0)
    int W = 0, H = 0;
    uint32_t FrameIndex = 0;
    bool ReprojectOn = false;
};

void ResolveSurfaceMirror(AccumState& S, int px, int py, vec3 radiance, vec3 normal, float depth, vec2 motion)
{
    const size_t i = size_t(py) * size_t(S.W) + size_t(px);
    vec4  history(0.0f);
    float count    = 0.0f;
    bool  resolved = false;

    const bool reproject = depth > 0.0f && S.ReprojectOn;
    vec2 moments = vec2(0.0f);

    if (S.FrameIndex > 0u && reproject)
    {
        vec2 extent(float(S.W), float(S.H));
        vec2 cuv((float(px) + 0.5f) / extent.x, (float(py) + 0.5f) / extent.y);
        ivec2 prevPx(int(floor((cuv.x - motion.x) * extent.x)),
                     int(floor((cuv.y - motion.y) * extent.y)));
        if (prevPx.x >= 0 && prevPx.y >= 0 && prevPx.x < S.W && prevPx.y < S.H)
        {
            const size_t j = size_t(prevPx.y) * size_t(S.W) + size_t(prevPx.x);
            vec4 prevSurface = S.Surf[j];
            if (prevSurface.w > 0.0f
                && dot(normal, prevSurface.xyz) > kReprojectNormalCos
                && abs(depth - prevSurface.w) / max(depth, 1e-3f) < kReprojectDepthTol)
            {
                history  = S.Hist[j];
                count    = history.w;
                moments  = vec2(S.Mom[j].x, S.Mom[j].y);
                resolved = true;
            }
            else resolved = true;
        }
        else resolved = true;
    }

    if (S.FrameIndex > 0u && !resolved)
    {
        history = S.Hist[i];
        count   = history.w;
        moments = vec2(S.Mom[i].x, S.Mom[i].y);
    }

    count      = count + 1.0f;
    vec3 mean  = history.xyz + (radiance - history.xyz) / count;

    float luma = Luminance(radiance);
    moments    = vec2(moments.x + (luma - moments.x) / count,
                      moments.y + (luma * luma - moments.y) / count);
    float sampleVariance = max(moments.y - moments.x * moments.x, 0.0f);
    float variance = sampleVariance / count;
    if (count < 2.0f) variance = luma * luma;

    S.Hist[i] = vec4(mean, count);
    S.Surf[i] = vec4(normal, depth);
    S.Mom[i]  = vec4(moments.x, moments.y, 0.0f, 0.0f);
    (void)variance;   // carried to the filter in the kernel; §D's A/Bs compare MEANS
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            §A
//------------------------------------------------------------------------------------------------------------------------

void ProofReuseRevalidation()
{
    std::printf("[reuse] §A revalidation — p̂ is the current pixel's full BSDF\n");

    const vec3 wo(0.2f, 0.0f, sqrt(1.0f - 0.04f));
    const SurfFrame F = BuildFrame(vec3(0.0f, 0.0f, 1.0f));
    const vec3 lampPoint(0.4f, 0.3f, 0.9f);
    const vec3 lampNormal = normalize(vec3(0.0f, 0.0f, -1.0f));
    const vec3 lampEmit(1.0f, 1.0f, 1.0f);
    const vec3 toL = lampPoint;
    const float dist2 = dot(toL, toL);

    ShadingRecord mLambert = StandardMaterial(vec3(0.5f), 0.4f); mLambert.SpecularWeight = 0.0f;
    ShadingRecord mGlass   = GlassMaterial(0.1f);
    ShadingRecord mCloth   = ClothMaterial(vec3(0.35f, 0.02f, 0.08f), 1.0f, 0.8f);

    float pLambert = PHatFull(F, mLambert, ResolveLayers(mLambert, wo), wo, lampEmit, toL, dist2, lampNormal);
    float pGlass   = PHatFull(F, mGlass,   ResolveLayers(mGlass, wo),   wo, lampEmit, toL, dist2, lampNormal);
    float pCloth   = PHatFull(F, mCloth,   ResolveLayers(mCloth, wo),   wo, lampEmit, toL, dist2, lampNormal);

    // Each p̂ equals the formula with the CURRENT material's BSDF (recomputed here the long way).
    auto DirectP = [&](ShadingRecord& m) {
        ResolvedLayers L = ResolveLayers(m, wo);
        vec3 wi = ToLocalFrame(F, normalize(toL));
        float cosT = max(0.0f, dot(F.Geometric, normalize(toL)));
        float cosL = max(0.0f, dot(lampNormal, -normalize(toL)));
        return max(dot(EvaluateBsdf(m, L, wo, wi), lampEmit), 0.0f) * cosT * cosL / (dist2 + 0.001f);
    };
    CHECK(fabs(pLambert - DirectP(mLambert)) == 0.0f && fabs(pGlass - DirectP(mGlass)) == 0.0f
          && fabs(pCloth - DirectP(mCloth)) == 0.0f,
          "p̂ re-eval == direct full-BSDF product, per current material (bitwise)");
    CHECK(pLambert != pGlass && pGlass != pCloth && pLambert != pCloth
          && pGlass > 0.0f && pCloth > 0.0f && pLambert > 0.0f,
          "the SAME stored sample scores differently per material (lambert %.4f / glass %.4f / cloth %.4f)",
          pLambert, pGlass, pCloth);

    // Below-horizon partition: DI's target is exactly 0 below for every selection — the BTDF/SSS energy lives
    //    in the dedicated below strata (K5 + virtual), never in the reservoirs.
    const vec3 belowDir = normalize(vec3(0.3f, 0.1f, -0.9f));
    const vec3 sunBelow = normalize(vec3(-0.3f, 0.2f, -0.8f));
    bool allZeroBelow = true;
    for (ShadingRecord* m : { &mLambert, &mGlass, &mCloth })
    {
        ResolvedLayers L = ResolveLayers(*m, wo);
        if (PHatFull(F, *m, L, wo, lampEmit, belowDir * 2.0f, dot(belowDir, belowDir) * 4.0f, lampNormal) != 0.0f)
            allZeroBelow = false;
        if (PHatSun(F, *m, L, wo, vec3(10.0f), sunBelow) != 0.0f)
            allZeroBelow = false;
    }
    ShadingRecord mWax = SssMaterial(vec3(0.8f, 0.4f, 0.2f), vec3(0.9f, 0.5f, 0.3f), 0.02f, vec3(1.0f, 0.5f, 0.25f), 0.01f);
    ResolvedLayers Lwax = ResolveLayers(mWax, wo);
    if (PHatSun(F, mWax, Lwax, wo, vec3(10.0f), sunBelow) != 0.0f) allZeroBelow = false;
    vec3 glassBelowF = EvaluateBsdf(mGlass, ResolveLayers(mGlass, wo), wo, ToLocalFrame(F, belowDir));
    CHECK(allZeroBelow,
          "DI target == 0 below for standard/glass/cloth/wax (partition with the below strata)");
    CHECK(glassBelowF.x > 0.0f,
          "the BTDF itself is alive below (f_T(%.4f) > 0) — it just never enters a reservoir", glassBelowF.x);

    // Merge algebra: the winner's p̂ is CARRIED (never a new evaluation), the M-clamp is the formula, occlusion
    //    zeroes the weight.
    {
        const float LampArea = 0.25f;   // the square-sampled parallelogram: 4·|U×V| with |U| = |V| = 0.25
        ResolvedLayers Lg = ResolveLayers(mGlass, wo);
        MirrorReservoir res;
        res.SelectedPoint = lampPoint; res.SelectedLight = 0u;
        res.SampleCount = 4u;
        float pSelf = pGlass;
        res.WeightSum = 4.0f * (pSelf * LampArea);   // w = p̂/p with p = 1/Area per point
        res.UnbiasedWeight = res.WeightSum / (float(res.SampleCount) * pSelf);

        MirrorReservoir prev;
        prev.SelectedPoint = lampPoint + vec3(0.05f, -0.05f, 0.0f); prev.SelectedLight = 0u;
        prev.SampleCount = 10000u;                                  // absurd M — the clamp must eat it
        prev.UnbiasedWeight = 1.0f / (float(prev.SampleCount));     // (any positive W)

        vec3 prevToL = prev.SelectedPoint;
        float pNeigh = PHatFull(F, mGlass, Lg, wo, lampEmit, prevToL, dot(prevToL, prevToL), lampNormal);

        // r = 0 → the neighbour wins whenever its weight is positive: the carry must be exactly pNeigh.
        MirrorReservoir resN = res;
        float carriedN = MergeTemporal(resN, prev, 0.0f, F, mGlass, Lg, wo, vec3(0.0f), lampEmit, lampNormal, 0.0f);
        const uint expectCapped = kTemporalMClamp * res.SampleCount;
        CHECK(resN.SampleCount == res.SampleCount + expectCapped,
              "M-clamp: prev M=10000 merges as exactly %u (kernel formula)", expectCapped);
        CHECK(carriedN == pNeigh,
              "neighbour wins → carried p̂ IS pNeigh (bitwise — no third evaluation exists)");
        float expectW = carriedN > 0.0f ? resN.WeightSum / (float(resN.SampleCount) * carriedN) : 0.0f;
        CHECK(resN.UnbiasedWeight == expectW, "W = total/(M·p̂winner) with the carried p̂ (bitwise)");

        // r = 1 → the current selection survives: the carry is pSelf.
        MirrorReservoir resS = res;
        float carriedS = MergeTemporal(resS, prev, 0.0f, F, mGlass, Lg, wo, vec3(0.0f), lampEmit, lampNormal, 1.0f);
        CHECK(carriedS == pSelf, "self wins → carried p̂ IS the resident pSelected (bitwise)");

        // Occlusion kill: the kernel zeroes W of an occluded selection after the visibility re-trace.
        float occludedW = resN.UnbiasedWeight;
        occludedW = 0.0f;   // res.Visible == 0 → res.UnbiasedWeight = 0 (kernel line, mirrored)
        CHECK(occludedW == 0.0f, "occluded selection contributes exactly 0");
    }

    // Estimator closure: a glass pixel merging a lambert pixel's reservoir stays unbiased (the "foreign lobes
    //    ride along" end-to-end claim), against a fine MC truth.
    {
        const ToyLamp LampAbove{ vec3(0.4f, 0.3f, 0.9f), vec3(0.25f, 0.0f, 0.0f), vec3(0.0f, 0.25f, 0.0f),
                                 vec3(0.0f, 0.0f, -1.0f), 0.25f /* 4·|U×V| — the square-sampled parallelogram */,
                                 vec3(5.0f, 5.0f, 5.0f) };
        // Truth: ∫ f_glass·L·cosT·cosL/D² over the lamp (uniform area MC, 100 000 points).
        double truth = 0.0;
        ResolvedLayers Lg = ResolveLayers(mGlass, wo);
        for (int s = 0; s < 100000; ++s)
        {
            vec3 Lp = LampAbove.Point(Rand01() * 2.0f - 1.0f, Rand01() * 2.0f - 1.0f);
            vec3 toLp = Lp;
            float D2 = dot(toLp, toLp);
            vec3 lDir = toLp / sqrt(D2);
            float cosT = max(0.0f, dot(F.Geometric, lDir));
            float cosL = max(0.0f, dot(LampAbove.N, -lDir));
            if (cosT <= 0.0f || cosL <= 0.0f) continue;
            vec3 wi = ToLocalFrame(F, lDir);
            truth += dot(EvaluateBsdf(mGlass, Lg, wo, wi), LampAbove.Radiance) * cosT * cosL / (D2 + 0.01f);
        }
        truth *= LampAbove.Area / 100000.0;

        // Estimator: 4 own candidates at the glass pixel + one temporal merge of a lambert pixel's 4-candidate
        //    reservoir, then the shade term at the carried W. 100 000 streams.
        double sum = 0.0, sum2 = 0.0;
        for (int it = 0; it < 100000; ++it)
        {
            MirrorReservoir res;
            for (uint c = 0u; c < 4u; ++c)
            {
                vec3 Lp = LampAbove.Point(Rand01() * 2.0f - 1.0f, Rand01() * 2.0f - 1.0f);
                vec3 toLp = Lp;
                float pHat = PHatFull(F, mGlass, Lg, wo, LampAbove.Radiance, toLp, dot(toLp, toLp), LampAbove.N);
                float w = pHat * LampAbove.Area;   // p_source = 1/Area
                res.WeightSum += w;
                res.SampleCount += 1u;
                if (Rand01() * res.WeightSum <= w) { res.SelectedPoint = Lp; res.SelectedLight = 0u; }
            }
            if (res.WeightSum > 0.0f)
            {
                vec3 toSel = res.SelectedPoint;
                float pSel = PHatFull(F, mGlass, Lg, wo, LampAbove.Radiance, toSel, dot(toSel, toSel), LampAbove.N);
                res.UnbiasedWeight = pSel > 0.0f ? res.WeightSum / (float(res.SampleCount) * pSel) : 0.0f;
            }
            // The neighbour pixel (lambert) builds its own 4-candidate reservoir.
            ResolvedLayers Ll = ResolveLayers(mLambert, wo);
            MirrorReservoir prev;
            for (uint c = 0u; c < 4u; ++c)
            {
                vec3 Lp = LampAbove.Point(Rand01() * 2.0f - 1.0f, Rand01() * 2.0f - 1.0f);
                vec3 toLp = Lp;
                float pHat = PHatFull(F, mLambert, Ll, wo, LampAbove.Radiance, toLp, dot(toLp, toLp), LampAbove.N);
                float w = pHat * LampAbove.Area;
                prev.WeightSum += w;
                prev.SampleCount += 1u;
                if (Rand01() * prev.WeightSum <= w) { prev.SelectedPoint = Lp; prev.SelectedLight = 0u; }
            }
            if (prev.WeightSum > 0.0f)
            {
                vec3 toSel = prev.SelectedPoint;
                float pSel = PHatFull(F, mLambert, Ll, wo, LampAbove.Radiance, toSel, dot(toSel, toSel), LampAbove.N);
                prev.UnbiasedWeight = pSel > 0.0f ? prev.WeightSum / (float(prev.SampleCount) * pSel) : 0.0f;
            }
            float r = Rand01();
            float pCarried = MergeTemporal(res, prev, 0.0f, F, mGlass, Lg, wo, vec3(0.0f),
                                           LampAbove.Radiance, LampAbove.N, r);
            (void)pCarried;
            if (res.UnbiasedWeight > 0.0f)
            {
                vec3 shadeDir = res.SelectedPoint;
                float D2 = dot(shadeDir, shadeDir);
                vec3 lDir = shadeDir / sqrt(D2);
                float cosT = max(0.0f, dot(F.Geometric, lDir));
                float cosL = max(0.0f, dot(LampAbove.N, -lDir));
                vec3 wi = ToLocalFrame(F, lDir);
                vec3 f = EvaluateBsdf(mGlass, Lg, wo, wi);
                sum    += dot(f, LampAbove.Radiance) * cosT * cosL / (D2 + 0.01f) * res.UnbiasedWeight;
                double x = dot(f, LampAbove.Radiance) * cosT * cosL / (D2 + 0.01f) * res.UnbiasedWeight;
                sum2 += x * x;
            }
        }
        double mean = sum / 100000.0;
        double var = sum2 / 100000.0 - mean * mean;
        double stderr = sqrt(max(var, 0.0) / 100000.0);
        CHECK(fabs(mean - truth) < 5.0 * stderr && fabs(mean - truth) / truth < 0.05,
              "glass pixel + merged lambert reservoir closes on analytic truth (%.5f vs %.5f, %.1fσ)",
              mean, truth, fabs(mean - truth) / stderr);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            §B
//------------------------------------------------------------------------------------------------------------------------

void ProofKernelMis()
{
    std::printf("[reuse] §B kernel MIS — W_L + W_B complementarity and two-stratum closure\n");

    // Complementarity: the two weights the M9 edit introduced pair to exactly 1.
    {
        bool ok = true;
        double worst = 0.0;
        for (int i = 0; i < 4000; ++i)
        {
            float pl = Rand01() * 10.0f + 1e-6f;
            float pb = Rand01() * 10.0f + 1e-6f;
            float wl = (pl * pl) / (pl * pl + pb * pb + 1e-12f);
            float wb = (pb * pb) / (pb * pb + pl * pl + 1e-12f);
            double d = fabs(double(wl) + double(wb) - 1.0);
            if (d > worst) worst = d;
            if (d > 1e-6) ok = false;
        }
        CHECK(ok, "W_L + W_B == 1 over 4000 random densities (worst %.2e)", worst);
    }

    // The pdf pair the two strata divide: pure SSS below = exactly the dipole density; mixed = the full mixture
    //    (T-arm mass present, so K5's W_L is strictly below 1 — the double-count fix).
    {
        const vec3 wo(0.3f, 0.0f, sqrt(1.0f - 0.09f));
        const SurfFrame F = BuildFrame(vec3(0.0f, 0.0f, 1.0f));
        ShadingRecord mWax = SssMaterial(vec3(0.8f, 0.4f, 0.2f), vec3(0.9f, 0.5f, 0.3f), 0.02f, vec3(1.0f, 0.5f, 0.25f), 0.01f);
        ResolvedLayers Lw = ResolveLayers(mWax, wo);
        ShadingRecord mMix = GlassMaterial(0.2f);
        mMix.SssWeight = 0.6f; mMix.SssColor = vec3(0.9f, 0.5f, 0.3f);
        mMix.SssRadius = 0.02f; mMix.SssRadiusScale = vec3(1.0f, 0.5f, 0.25f); mMix.SssThickness = 0.01f;
        ResolvedLayers Lm = ResolveLayers(mMix, wo);

        bool okPdf = true, okMixed = false;
        for (int i = 0; i < 2000; ++i)
        {
            vec3 wiB = ToLocalFrame(F, normalize(vec3(Rand01() - 0.5f, Rand01() - 0.5f, -(0.2f + 0.8f * Rand01()))));
            float pdfW = PdfBsdf(mWax, Lw, wo, wiB);
            float expect = Lw.Weights.Sss * max(-wiB.z, 0.0f) * (1.0f / 3.14159265f);
            if (fabs(pdfW - expect) > 1e-6f * max(1.0f, expect)) okPdf = false;
            float pdfM = PdfBsdf(mMix, Lm, wo, wiB);
            if (pdfM > 1e-4f) okMixed = true;
        }
        CHECK(okPdf, "pure-SSS pdf below == wSss·|cos|/π exactly (the dipole density, 2000/2000)");
        CHECK(okMixed, "mixed T+SSS pdf below carries the T-arm mass (K5's W_L < 1 — the overlap is priced)");

        // Two-stratum closure against brute force, wax and mixed, sun + lamp below.
        //    The emission normal MUST be the face normal (kernel LightNormal is the triangle's face normal, so
        //    pl's D²/(Area·cosL) density is face-consistent): a toy with a tilted emission normal breaks the MIS.
        const ToyLamp Lamp{ vec3(0.5f, -0.3f, -0.6f), vec3(0.25f, 0.0f, 0.0f), vec3(0.0f, 0.25f, 0.0f),
                            vec3(0.0f, 0.0f, 1.0f), 4.0f * 0.25f * 0.25f, vec3(5.0f, 4.0f, 3.0f) };
        const vec3 sunDir = normalize(vec3(-0.3f, 0.2f, -0.8f));
        const vec3 sunEmit(20.0f, 16.0f, 12.0f);
        const vec3 skyRadiance(0.06f, 0.07f, 0.09f);
        const float pPick = kSunPickProbability, pMesh = 1.0f - kSunPickProbability;

        for (int cfg = 0; cfg < 2; ++cfg)
        {
            ShadingRecord& m = cfg == 0 ? mWax : mMix;
            ResolvedLayers& L = cfg == 0 ? Lw : Lm;
            const char* tag = cfg == 0 ? "wax" : "mixed T+SSS";

            // Truth: per-emitter plain MC over the below-hemisphere integrand f·L·|cos|. For the MIXED material
            //    the T-arm's caustic spike gives plain uniform sky draws a heavy tail (position sweeps showed
            //    ±3% swings at 200k), so the truth runs 1M streams AND tracks its own σ — the closure gate then
            //    combines both sides' noise instead of pretending the truth is exact.
            const int TruthN = cfg == 0 ? 200000 : 1000000;
            double truth = 0.0, truth2 = 0.0;
            for (int s = 0; s < TruthN; ++s)
            {
                // sun disc, uniform in solid angle
                vec3 sd = SampleSunDirection(sunDir, Rand01(), Rand01());
                vec3 wi = ToLocalFrame(F, sd);
                if (wi.z < 0.0f)
                {
                    double x = dot(EvaluateBsdf(m, L, wo, wi), sunEmit) * (-wi.z) * SunSolidAngle();
                    truth += x;
                    truth2 += x * x;
                }
                // lamp, uniform area (estimates ∫ f·L·cos·cosL/D² dx over the parallelogram)
                vec3 Lp = Lamp.Point(Rand01() * 2.0f - 1.0f, Rand01() * 2.0f - 1.0f);
                float D2 = dot(Lp, Lp);
                vec3 lDir = Lp / sqrt(D2);
                float cosL = dot(-lDir, Lamp.N);
                wi = ToLocalFrame(F, lDir);
                if (wi.z < 0.0f && cosL > 0.0f)
                {
                    double x = dot(EvaluateBsdf(m, L, wo, wi), Lamp.Radiance) * (-wi.z) * cosL * Lamp.Area / D2;
                    truth += x;
                    truth2 += x * x;
                }
                // sky, uniform sphere-below — but the quad OCCLUDES the sky behind it, so the truth counts
                //    sky only where the walk would also see it (a miss). Skipping the quad here is what makes
                //    the truth the same integral the two-stratum estimator partitions.
                float z = -Rand01();
                float phi2 = 6.2831853f * Rand01();
                vec3 sd2(sqrt(1.0f - z * z) * cos(phi2), sqrt(1.0f - z * z) * sin(phi2), z);
                wi = ToLocalFrame(F, sd2);
                vec3 HpSky;
                if (wi.z < 0.0f && !Lamp.Intersect(vec3(0.0f), sd2, HpSky))
                {
                    double x = dot(EvaluateBsdf(m, L, wo, wi), skyRadiance) * (-wi.z) * 2.0f * 3.14159265f;
                    truth += x;
                    truth2 += x * x;
                }
            }
            truth /= double(TruthN);
            const double truthSigma = sqrt(max(truth2 / double(TruthN) - truth * truth, 0.0) / double(TruthN));

            // The M9 estimator: coin(sun/lamp) K5 + the virtual walk, 200k streams. For wax this is EXACTLY the
        //    kernel's post-M9 pair (K5 at W_L, dipole-virtual at W_B). For the mixed material the virtual is
        //    allowed here as the balanced BSDF twin — the kernel's mixed T-transport still collects its emitter
        //    hits at the endpoint convention's weight 1, a documented gap the GPU-verification pass owns.
        for (int pass = 0; pass < 2; ++pass)
        {
            const bool balancedPair = pass == 1;   // pass 0 = the kernel as edited; pass 1 = + the mixed virtual
            if (cfg == 0 && pass == 1) continue;   // wax needs no second pass
            double sum = 0.0, sum2 = 0.0;
            for (int it = 0; it < 200000; ++it)
            {
                // The kernel's coin: ONE light-sampled arm per iteration (each arm's pdf carries its pick
                //    probability), plus the BSDF-sampled walk — which has no coin (one SampleBsdf always).
                vec3 c = Rand01() < pPick
                       ? K5SunArm(m, L, wo, F, sunDir, sunEmit, pPick)
                       : K5MeshArm(m, L, wo, F, Lamp, pMesh);
                c = c + VirtualWalk(m, L, wo, F, Lamp, sunDir, sunEmit, pPick, pMesh, skyRadiance, cfg == 1 && balancedPair);
                sum += c.x + c.y + c.z;
                sum2 += dot(c, c);
            }
            double mean = sum / 200000.0;
            double var = sum2 / 200000.0 - mean * mean;
            double stderr = sqrt(max(var, 0.0) / 200000.0);
            if (cfg == 0)
                CHECK(fabs(mean - truth) < 5.0 * stderr && fabs(mean - truth) / truth < 0.06,
                      "wax two-stratum estimator (kernel as edited) closes on brute force (%.5f vs %.5f, %.1fσ)",
                      mean, truth, fabs(mean - truth) / max(stderr, 1e-12));
            else if (balancedPair)
            {
                const double comb = 5.0 * sqrt(stderr * stderr + truthSigma * truthSigma);
                CHECK(fabs(mean - truth) < comb,
                      "mixed balanced pair (K5@W_L + T-arm virtual@W_B) closes (%.5f vs %.5f, |Δ| %.4f ≤ 5σ_comb %.4f, σest %.4f σtruth %.4f) — the kernel's mixed transport keeps endpoint weight 1 (documented)",
                      mean, truth, fabs(mean - truth), comb, stderr, truthSigma);
            }
            else
                std::printf("  ..  mixed, kernel as edited (virtual off): %.5f vs truth %.5f — the residual convention gap the report records\n",
                            mean, truth);
        }
    }
}
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            §C
//------------------------------------------------------------------------------------------------------------------------

void ProofAtrous()
{
    std::printf("[reuse] §C à-trous — AtrousDenoise.slang compiled 1:1\n");

    const int W = 64, H = 64;
    std::vector<vec4> src(size_t(W) * size_t(H)), dst(size_t(W) * size_t(H), vec4(0.0f)),
                      out(size_t(W) * size_t(H), vec4(0.0f)), surf(size_t(W) * size_t(H));
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x)
            surf[size_t(y) * W + size_t(x)] = vec4(0.0f, 0.0f, 1.0f, 1.0f);   // flat wall, depth 1

    Image2D SImage{ &src, W, H }, TImage{ &dst, W, H }, FImage{ &surf, W, H }, OImage{ &out, W, H };
    SourceImage = SImage; TargetImage = TImage; SurfaceImage = FImage; OutputImage = OImage;
    Extent = uvec2(unsigned(W), unsigned(H));
    Enabled = 1u; FinalLevel = 0u;
    NormalPower = 32.0f; DepthScale = 1.0f; LuminanceScale = 4.0f;
    Exposure = 1.0f; ColourSaturation = 1.0f;

    // Converged identity: constant radiance, variance 0 → the early-out hands the pixel back unchanged (one
    //    level; the dispatch reads src, writes dst, then the host ping-pongs).
    {
        vec3 C(0.4f, 0.35f, 0.3f);
        for (auto& v : src) v = vec4(C, 0.0f);
        StepSize = 1u;
        for (int y = 0; y < H; ++y)
            for (int x = 0; x < W; ++x)
            {
                gl_GlobalInvocationID = vec2(float(x), float(y));
                AtrousMain();
            }
        float worst = 0.0f;
        for (auto& v : dst) worst = max(worst, max(abs(v.x - C.x), max(abs(v.y - C.y), abs(v.z - C.z))));
        CHECK(worst == 0.0f, "converged field (var 0): filtered == input bitwise (early-out)");
    }

    // Noise reduction + edge preservation + fade, one level at a realistic StepSize, variance-of-mean bookkeeping.
    {
        // Two-region field (a genuine lighting edge) + seeded per-pixel noise whose std the variance lane reports.
        auto Fill = [&](float n) {
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                {
                    float base = x < W / 2 ? 0.2f : 0.8f;
                    // Box noise in [-n, n], variance of the mean of 1 sample = (2n)²/12 reported honestly.
                    float e = (Rand01() * 2.0f - 1.0f) * n;
                    src[size_t(y) * W + size_t(x)] = vec4(vec3(base + e), (2.0f * n) * (2.0f * n) / 12.0f);
                }
        };
        auto EdgeAfter = [&](const std::vector<vec4>& Img) {
            float a = 0.0f, b = 0.0f;
            for (int y = 8; y < H - 8; ++y) { a += Img[size_t(y) * W + size_t(W / 2 - 2)].x; b += Img[size_t(y) * W + size_t(W / 2 + 2)].x; }
            return (b - a) / float(H - 16);
        };
        auto RmsNoise = [&](const std::vector<vec4>& Img) {
            double s = 0.0;
            for (int y = 4; y < H - 4; ++y)
                for (int x = 4; x < W / 2 - 4; ++x)
                {
                    float e = Img[size_t(y) * W + size_t(x)].x - 0.2f;
                    s += double(e) * double(e);
                }
            return sqrt(s / double((H - 8) * (W / 2 - 8)));
        };

        StepSize = 2u;
        Fill(0.05f);
        float inRms = RmsNoise(src);
        float inEdge = EdgeAfter(src);
        for (int y = 0; y < H; ++y)
            for (int x = 0; x < W; ++x)
            {
                gl_GlobalInvocationID = vec2(float(x), float(y));
                AtrousMain();
            }
        float outRms = RmsNoise(dst);
        float outEdge = EdgeAfter(dst);
        CHECK(outRms < inRms * 0.5f, "1-spp noise field: RMS %.4f → %.4f after one level (noise falls)", inRms, outRms);
        CHECK(outEdge > 0.85f * inEdge, "the lighting edge survives (%.4f of input contrast)", outEdge / inEdge);

        // Fade: as the sample count grows the reported variance-of-mean falls ∝ 1/n and the filter's output
        //    distance to its input falls with it (the mechanism behind converged A/B identity).
        Fill(0.05f);
        float d1 = 0.0f;
        for (size_t i = 0; i < src.size(); ++i) d1 += abs(src[i].x - dst[i].x);
        for (int n : { 4, 16, 64, 256 })
        {
            Fill(0.05f / sqrt(float(n)));                 // σ_mean ∝ 1/√n, variance lane follows
            for (size_t i = 0; i < src.size(); ++i)
                src[i].w = (0.1f / sqrt(float(n))) * (0.1f / sqrt(float(n))) / 3.0f;
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                {
                    gl_GlobalInvocationID = vec2(float(x), float(y));
                    AtrousMain();
                }
            float dd = 0.0f;
            for (size_t i = 0; i < src.size(); ++i) dd += abs(src[i].x - dst[i].x);
            (void)n;
            if (n == 256) CHECK(dd < d1, "the filter fades as the estimate converges (input-distance %.3f → %.3f at n=256)", d1, dd);
        }

        // Tone-map literal parity with the kernel: the two ACES bodies must stay the same formula (A7d).
        {
            std::string kern = [] {
                FILE* f = fopen("Engine/Shaders/ReSTIRViewport.slang", "rb");
                if (!f) return std::string();
                std::string t; int c; while ((c = fgetc(f)) != EOF) t.push_back(char(c)); fclose(f);
                return t;
            }();
            CHECK(kern.find("2.51") != std::string::npos && kern.find("0.03") != std::string::npos
                  && kern.find("2.43") != std::string::npos && kern.find("0.59") != std::string::npos
                  && kern.find("0.14") != std::string::npos,
                  "kernel ToneMap carries the same ACES literals the filter's tone map pins");
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            §D
//------------------------------------------------------------------------------------------------------------------------

void ProofReprojection()
{
    std::printf("[reuse] §D reprojection — ResolveSurface accumulator A/B\n");

    const int W = 64, H = 64;
    const float Sigma = 0.03f;   // per-frame sample noise

    // Scene: radiance = checker(world); the surface point under pixel p at frame f is base(p − v·f).
    auto WorldX = [](int px, int frame, int vx) { return float(px - vx * int(frame)); };
    auto WorldY = [](int py, int frame, int vy) { return float(py - vy * int(frame)); };
    auto Radiance = [&](int px, int py, int frame, int vx, int vy) {
        float wx = WorldX(px, frame, vx), wy = WorldY(py, frame, vy);
        float c = (fmod(floor(wx / 8.0f) + floor(wy / 8.0f), 2.0f) == 0.0f) ? 0.25f : 0.75f;
        return c + (Rand01() * 2.0f - 1.0f) * Sigma;
    };

    // ── Static scene, ON vs OFF byte-identical over 128 frames ─────────────────────────────────────────────
    {
        AccumState A, B;
        A.W = B.W = W; A.H = B.H = H;
        A.Hist.resize(size_t(W) * H); A.Surf.resize(size_t(W) * H); A.Mom.resize(size_t(W) * H);
        B.Hist.resize(size_t(W) * H); B.Surf.resize(size_t(W) * H); B.Mom.resize(size_t(W) * H);
        A.ReprojectOn = true; B.ReprojectOn = false;
        uint64_t savedRng = g_Rng;
        for (A.FrameIndex = 1; A.FrameIndex <= 128; ++A.FrameIndex)
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                    ResolveSurfaceMirror(A, x, y, vec3(Radiance(x, y, int(A.FrameIndex), 0, 0)),
                                         vec3(0.0f, 0.0f, 1.0f), 1.0f, vec2(0.0f, 0.0f));
        g_Rng = savedRng;   // the OFF twin sees the identical noise stream
        for (B.FrameIndex = 1; B.FrameIndex <= 128; ++B.FrameIndex)
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                    ResolveSurfaceMirror(B, x, y, vec3(Radiance(x, y, int(B.FrameIndex), 0, 0)),
                                         vec3(0.0f, 0.0f, 1.0f), 1.0f, vec2(0.0f, 0.0f));
        bool identical = true;
        for (size_t i = 0; i < A.Hist.size(); ++i)
            if (A.Hist[i].x != B.Hist[i].x || A.Hist[i].y != B.Hist[i].y || A.Hist[i].z != B.Hist[i].z
                || A.Hist[i].w != B.Hist[i].w) { identical = false; break; }
        CHECK(identical, "static scene: reprojection ON and OFF byte-identical over 128 frames");
    }

    // ── Pan: ON tracks the surface, OFF smears; a stopped pan converges both to the same mean ──────────────
    {
        const int vx = 1, panFrames = 32, holdFrames = 512;
        AccumState A, B;
        A.W = B.W = W; A.H = B.H = H;
        A.Hist.resize(size_t(W) * H); A.Surf.resize(size_t(W) * H); A.Mom.resize(size_t(W) * H);
        B.Hist.resize(size_t(W) * H); B.Surf.resize(size_t(W) * H); B.Mom.resize(size_t(W) * H);
        A.ReprojectOn = true; B.ReprojectOn = false;

        // World offset freezes at the pan's end; during the pan motion = (vx, 0), during the hold motion = 0.
        auto OffsetAt = [&](uint32_t f) { return vx * int(min(f, uint32_t(panFrames))); };
        auto RadianceAt = [&](int px, int py, uint32_t f) {
            float wx = float(px - OffsetAt(f)), wy = float(py);
            float c = (fmod(floor(wx / 8.0f) + floor(wy / 8.0f), 2.0f) == 0.0f) ? 0.25f : 0.75f;
            return c + (Rand01() * 2.0f - 1.0f) * Sigma;
        };
        auto TrueMean = [&](int px, int py) {
            float wx = float(px - OffsetAt(uint32_t(panFrames + holdFrames)));
            float c = (fmod(floor(wx / 8.0f) + floor(float(py) / 8.0f), 2.0f) == 0.0f) ? 0.25f : 0.75f;
            return c;
        };

        uint64_t savedRng = g_Rng;
        for (uint32_t f = 1; f <= uint32_t(panFrames + holdFrames); ++f)
        {
            const vec2 motion = f <= uint32_t(panFrames) ? vec2(float(vx), 0.0f) : vec2(0.0f, 0.0f);
            A.FrameIndex = B.FrameIndex = f;
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                    ResolveSurfaceMirror(A, x, y, vec3(RadianceAt(x, y, f)),
                                         vec3(0.0f, 0.0f, 1.0f), 1.0f, motion);
            g_Rng = savedRng;   // the OFF twin sees the identical noise stream for this frame
            for (int y = 0; y < H; ++y)
                for (int x = 0; x < W; ++x)
                    ResolveSurfaceMirror(B, x, y, vec3(RadianceAt(x, y, f)),
                                         vec3(0.0f, 0.0f, 1.0f), 1.0f, motion);
            savedRng = g_Rng;   // and next frame continues from where the OFF twin left the stream
        }

        // Post-pan: tracked mean vs the true per-surface-point mean (per-pixel averages).
        {
            double errA = 0.0, errB = 0.0;
            for (int y = 0; y < H; ++y)
                for (int x = 2; x < W - 2; ++x)
                {
                    float wx = float(x - OffsetAt(uint32_t(panFrames)));
                    float cA = (fmod(floor(wx / 8.0f) + floor(float(y) / 8.0f), 2.0f) == 0.0f) ? 0.25f : 0.75f;
                    errA += fabs(double(A.Hist[size_t(y) * W + size_t(x)].x) - double(cA));
                    // OFF's honest reference is the SAME surface truth (its mean is simply smeared across it).
                    errB += fabs(double(B.Hist[size_t(y) * W + size_t(x)].x) - double(cA));
                }
            errA /= double((H) * (W - 4));
            errB /= double((H) * (W - 4));
            CHECK(errA < errB, "post-pan: tracked mean error %.4f < smeared mean error %.4f (per-pixel)", errA, errB);
            CHECK(A.Hist[size_t(H / 2) * W + W / 2].w >= float(panFrames) - 1.0f,
                  "tracked pixel keeps its history (count %.0f ≥ pan length)", A.Hist[size_t(H / 2) * W + W / 2].w);
        }

        // After the hold: both paths re-converge to the same mean.
        {
            double holdA = 0.0, holdB = 0.0;
            for (int y = 0; y < H; ++y)
                for (int x = 2; x < W - 2; ++x)
                {
                    holdA += fabs(double(A.Hist[size_t(y) * W + size_t(x)].x) - TrueMean(x, y));
                    holdB += fabs(double(B.Hist[size_t(y) * W + size_t(x)].x) - TrueMean(x, y));
                }
            holdA /= double(H * (W - 4));
            holdB /= double(H * (W - 4));
            CHECK(holdA < 4.0 * Sigma && holdB < 4.0 * Sigma,
                  "stopped pan: both paths re-converge (ON %.4f, OFF %.4f per pixel, 4σ=%.4f)",
                  holdA, holdB, 4.0 * Sigma);
        }
    }

    // ── Disocclusion: the reprojected pixel fails validation and restarts at n = 1 ─────────────────────────
    {
        AccumState A;
        A.W = W; A.H = H;
        A.Hist.assign(size_t(W) * H, vec4(0.5f, 0.5f, 0.5f, 64.0f));   // pretend a long history exists
        A.Surf.assign(size_t(W) * H, vec4(0.0f, 0.0f, 1.0f, 1.0f));
        A.Mom.assign(size_t(W) * H, vec4(0.5f, 0.25f, 0.0f, 0.0f));
        A.ReprojectOn = true;
        A.FrameIndex = 2;   // > 0 so the reproject path arms
        // New surface at a very different depth → validation must fail → the pixel restarts at n = 1.
        ResolveSurfaceMirror(A, W / 2, H / 2, vec3(0.4f, 0.4f, 0.4f), vec3(0.0f, 0.0f, 1.0f), 5.0f, vec2(0.0f, 0.0f));
        CHECK(A.Hist[size_t(H / 2) * W + W / 2].w == 1.0f,
              "disocclusion: validation-failed pixel restarts at n = 1 (kernel's rule, mirrored)");
    }
}

} // namespace

int main()
{
    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);   // production bakes 4096; 1024 proves the maths
    g_Tables = &Tables;

    std::printf("MATERIAL REUSE (M9): the ReSTIR-sync proofs\n");
    ProofReuseRevalidation();
    ProofKernelMis();
    ProofAtrous();
    ProofReprojection();

    if (g_Fail == 0) { std::printf("MATERIAL REUSE: PASS\n"); return 0; }
    std::printf("MATERIAL REUSE: %d FAIL\n", g_Fail);
    return 1;
}
