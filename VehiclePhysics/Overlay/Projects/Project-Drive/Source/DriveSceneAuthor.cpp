//============================================================================================================================================
// 📦 Projects/Project-Drive/Source/DriveSceneAuthor.cpp — builds the `--scene drive` level: course, ControlVehicle, wheels
//============================================================================================================================================
#include "DriveSceneAuthor.h"
#include "../../../Engine/ContentInterchange/AutomotiveShowcasePresets.h"
#include "../../../Engine/ContentInterchange/SceneCodec.h"
#include "DriveCourse.h"
#include "ControlVehicleMesh.inl"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>

namespace Frontier {
namespace Drive {

namespace {
constexpr float kPi = 3.14159265358979f;

Vector3 Sub(const Vector3& a, const Vector3& b) noexcept { return { a.x-b.x, a.y-b.y, a.z-b.z }; }
Vector3 Cross(const Vector3& a, const Vector3& b) noexcept
{ return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x }; }
Vector3 Normalize(const Vector3& v) noexcept
{ const float l = std::sqrt(v.x*v.x + v.y*v.y + v.z*v.z); return l > 0.0f ? Vector3{ v.x/l, v.y/l, v.z/l } : Vector3{0,0,1}; }

// One OpenPBR slab wrapped in a named material.
MaterialDescriptor MakeMaterial(const char* Name, const MaterialSlabDescriptor& Slab) noexcept
{ MaterialDescriptor m; m.Name = Name; m.Slabs.push_back(Slab); return m; }

void SetColor(float* Target, float R, float G, float B) noexcept
{
    Target[0] = R;
    Target[1] = G;
    Target[2] = B;
}

void HueColor(float Hue, float Saturation, float Brightness, float* Target) noexcept
{
    const float WrappedHue = (Hue - std::floor(Hue)) * 6.0f;
    const int Arc = static_cast<int>(WrappedHue) % 6;
    const float Fraction = WrappedHue - std::floor(WrappedHue);
    float R = 0.0f;
    float G = 0.0f;
    float B = 0.0f;
    switch (Arc)
    {
    case 0: R = 1.0f;            G = Fraction;       B = 0.0f;            break;
    case 1: R = 1.0f - Fraction; G = 1.0f;           B = 0.0f;            break;
    case 2: R = 0.0f;            G = 1.0f;           B = Fraction;       break;
    case 3: R = 0.0f;            G = 1.0f - Fraction;B = 1.0f;           break;
    case 4: R = Fraction;        G = 0.0f;           B = 1.0f;           break;
    default:R = 1.0f;            G = 0.0f;           B = 1.0f - Fraction;break;
    }
    Target[0] = Brightness * (1.0f - Saturation * (1.0f - R));
    Target[1] = Brightness * (1.0f - Saturation * (1.0f - G));
    Target[2] = Brightness * (1.0f - Saturation * (1.0f - B));
}

// The original ControlVehicle .blend owns four named appearance families: MAGlass, MAMetalicCoat,
// MAPlastic/MAPlastic2 and MARubber.  The dependency-free body extraction deliberately flattened the mesh to
// positions and triangles (there is no Blender material-index stream in ControlVehicleMesh.inl), so recover the
// authored families from their unambiguous source-space regions.  This is intentionally a small, documented mapping
// rather than an all-body paint fallback: the cabin glazing, lower trim/splitter/grille and painted shell stay
// separate material batches in every exported DriveCourse scene.
uint32_t ClassifyControlVehicleFace(const Vector3& A, const Vector3& B, const Vector3& C) noexcept
{
    const Vector3 P{ (A.x + B.x + C.x) / 3.0f, (A.y + B.y + C.y) / 3.0f, (A.z + B.z + C.z) / 3.0f };
    const Vector3 N = Normalize(Cross(Sub(B, A), Sub(C, A)));
    const float Side = std::fabs(P.y);

    // Dark, slightly blue cockpit glazing: side windows plus the forward/back sloped screen surfaces.
    const bool CockpitEnvelope = P.z > 0.62f && P.z < 1.31f && P.x > -2.05f && P.x < 1.62f;
    const bool GlazingFacing = Side > 0.47f || std::fabs(N.x) > 0.48f;
    if (CockpitEnvelope && GlazingFacing)
        return MatVehicleGlass;

    // Plastic undertray/side-skirt, lower fascia and the two bumper/grille end regions.
    const bool LowerTrim = P.z < 0.16f || (Side > 0.98f && P.z < 0.46f);
    const bool EndFascia = (P.x > 2.72f && P.z < 0.50f) || (P.x < -2.72f && P.z < 0.57f);
    if (LowerTrim || EndFascia)
        return MatVehiclePlastic;

    return MatBodyPaint;
}
} // namespace

//------------------------------------------------------------------------------------------------------------------------ span bookkeeping (verbatim ShowcaseStructure pattern)
DriveSceneAuthor::SpanScope::~SpanScope() noexcept
{
    if (Spans == nullptr || Triangles == nullptr || Span >= Spans->size()) return;
    TriangleSpanRecord& S = (*Spans)[Span];
    const uint32_t Now = static_cast<uint32_t>(Triangles->size());
    S.TriangleCount = Now >= S.FirstTriangle ? Now - S.FirstTriangle : 0u;
}

DriveSceneAuthor::SpanScope DriveSceneAuthor::OpenSpan(const char* Name, bool Dynamic) noexcept
{
    TriangleSpanRecord S;
    S.FirstTriangle = static_cast<uint32_t>(Triangles.size());
    if (Name != nullptr) S.Name = Name;
    S.Dynamic = Dynamic;
    Spans.push_back(std::move(S));
    SpanScope Scope; Scope.Spans = &Spans; Scope.Triangles = &Triangles;
    Scope.Span = static_cast<uint32_t>(Spans.size()) - 1u;
    return Scope;
}

//------------------------------------------------------------------------------------------------------------------------ triangle emit
void DriveSceneAuthor::AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept
{
    TriangleIndex T{};
    T.VertexAlphaX = P[0].x; T.VertexAlphaY = P[0].y; T.VertexAlphaZ = P[0].z;
    T.VertexBetaX  = P[1].x; T.VertexBetaY  = P[1].y; T.VertexBetaZ  = P[1].z;
    T.VertexGammaX = P[2].x; T.VertexGammaY = P[2].y; T.VertexGammaZ = P[2].z;
    std::memcpy(&T.MaterialSlot, &Material, sizeof(Material));
    T.TextureAlphaU = Uv[0][0]; T.TextureAlphaV = Uv[0][1];
    T.TextureBetaU  = Uv[1][0]; T.TextureBetaV  = Uv[1][1];
    T.TextureGammaU = Uv[2][0]; T.TextureGammaV = Uv[2][1];
    Triangles.push_back(T);
    CornerNormals.push_back(N[0]); CornerNormals.push_back(N[1]); CornerNormals.push_back(N[2]);
}

void DriveSceneAuthor::AppendFace(const Vector3& A, const Vector3& B, const Vector3& C, uint32_t Material) noexcept
{
    const Vector3 N = Normalize(Cross(Sub(B, A), Sub(C, A)));
    const Vector3 P[3] = { A, B, C }; const Vector3 Ns[3] = { N, N, N };
    const float Uv[3][2] = { { 0.0f, 0.0f }, { 1.0f, 0.0f }, { 0.0f, 1.0f } };
    AppendTriangle(P, Ns, Uv, Material);
}

//------------------------------------------------------------------------------------------------------------------------ vehicle body (ControlVehicleMesh, shifted so local origin = centre of mass)
void DriveSceneAuthor::AppendVehicleBody(float ComHeight, uint32_t Material) noexcept
{
    (void)Material; // retained in the declaration for source compatibility; per-face family assignment is authoritative.
    using namespace Frontier::Drive::ControlVehicleMesh;
    auto Raw = [&](uint32_t i)
    { return Vector3{ kPositions[i*3+0], kPositions[i*3+1], kPositions[i*3+2] }; };
    auto Local = [&](const Vector3& P) { return Vector3{P.x, P.y, P.z - ComHeight}; };
    for (uint32_t t = 0; t < kTriangleCount; ++t)
    {
        const Vector3 A = Raw(kTriangles[t*3+0]);
        const Vector3 B = Raw(kTriangles[t*3+1]);
        const Vector3 C = Raw(kTriangles[t*3+2]);
        AppendFace(Local(A), Local(B), Local(C), ClassifyControlVehicleFace(A, B, C));
    }
}

//------------------------------------------------------------------------------------------------------------------------ procedural wheel (axle along +Y) with material-separated rubber, rim/hub and disc
void DriveSceneAuthor::AppendWheel(const Vector3& C, float Radius, float HalfWidth, uint32_t Segments, uint32_t Material) noexcept
{
    (void)Material;
    const float RimRadius = Radius * 0.57f;
    const float DiscRadius = Radius * 0.39f;
    const float CapRadius = Radius * 0.15f;
    auto Point = [&](const Vector3& D, float RadiusAt, float Y)
    { return Vector3{C.x + D.x * RadiusAt, C.y + Y, C.z + D.z * RadiusAt}; };
    auto Quad = [&](const Vector3& A, const Vector3& B, const Vector3& D, const Vector3& E, uint32_t Slot)
    {
        const Vector3 P0[3] = {A,B,D}; const Vector3 P1[3] = {A,D,E};
        const Vector3 N0 = Normalize(Cross(Sub(B,A),Sub(D,A)));
        const Vector3 N1 = Normalize(Cross(Sub(D,A),Sub(E,A)));
        const Vector3 Ns0[3] = {N0,N0,N0}; const Vector3 Ns1[3] = {N1,N1,N1};
        const float U0[3][2]={{0,0},{1,0},{1,1}}, U1[3][2]={{0,0},{1,1},{0,1}};
        AppendTriangle(P0,Ns0,U0,Slot); AppendTriangle(P1,Ns1,U1,Slot);
    };

    for (uint32_t i = 0; i < Segments; ++i)
    {
        const float a0 = 2.0f * kPi * float(i)      / float(Segments);
        const float a1 = 2.0f * kPi * float(i + 1u) / float(Segments);
        const Vector3 d0{ std::cos(a0), 0.0f, std::sin(a0) }, d1{ std::cos(a1), 0.0f, std::sin(a1) };
        const Vector3 outerL0 = Point(d0, Radius,    HalfWidth), outerL1 = Point(d1, Radius,    HalfWidth);
        const Vector3 outerR0 = Point(d0, Radius,   -HalfWidth), outerR1 = Point(d1, Radius,   -HalfWidth);
        const Vector3 rimL0   = Point(d0, RimRadius, HalfWidth), rimL1   = Point(d1, RimRadius, HalfWidth);
        const Vector3 rimR0   = Point(d0, RimRadius,-HalfWidth), rimR1   = Point(d1, RimRadius,-HalfWidth);
        const Vector3 discL0  = Point(d0, DiscRadius,HalfWidth + 0.002f), discL1 = Point(d1, DiscRadius,HalfWidth + 0.002f);
        const Vector3 discR0  = Point(d0, DiscRadius,-HalfWidth - 0.002f),discR1 = Point(d1, DiscRadius,-HalfWidth - 0.002f);
        const Vector3 capL0   = Point(d0, CapRadius, HalfWidth + 0.004f), capL1  = Point(d1, CapRadius, HalfWidth + 0.004f);
        const Vector3 capR0   = Point(d0, CapRadius,-HalfWidth - 0.004f), capR1  = Point(d1, CapRadius,-HalfWidth - 0.004f);

        Quad(outerR0, outerR1, outerL1, outerL0, MatTyre);      // dense tread band
        Quad(outerL0, outerL1, rimL1, rimL0, MatTyre);          // tyre sidewall
        Quad(rimR1, rimR0, outerR0, outerR1, MatTyre);
        Quad(rimL0, rimL1, discL1, discL0, MatHub);              // machined rim face
        Quad(discR1, discR0, rimR0, rimR1, MatHub);
        Quad(discL0, discL1, capL1, capL0, MatBrake);            // brake disc / caliper field
        Quad(capR1, capR0, discR0, discR1, MatBrake);
    }
}

//------------------------------------------------------------------------------------------------------------------------ material showcase
void DriveSceneAuthor::AppendMaterialSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept
{
    for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
    {
        const float V0 = static_cast<float>(Ring) / static_cast<float>(Rings);
        const float V1 = static_cast<float>(Ring + 1u) / static_cast<float>(Rings);
        const float Theta0 = kPi * V0;
        const float Theta1 = kPi * V1;
        for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
        {
            const float U0 = static_cast<float>(Segment) / static_cast<float>(Segments);
            const float U1 = static_cast<float>(Segment + 1u) / static_cast<float>(Segments);
            const float Phi0 = 2.0f * kPi * U0;
            const float Phi1 = 2.0f * kPi * U1;
            const Vector3 Unit[4] =
            {
                { std::sin(Theta0) * std::cos(Phi0), std::sin(Theta0) * std::sin(Phi0), std::cos(Theta0) },
                { std::sin(Theta0) * std::cos(Phi1), std::sin(Theta0) * std::sin(Phi1), std::cos(Theta0) },
                { std::sin(Theta1) * std::cos(Phi1), std::sin(Theta1) * std::sin(Phi1), std::cos(Theta1) },
                { std::sin(Theta1) * std::cos(Phi0), std::sin(Theta1) * std::sin(Phi0), std::cos(Theta1) },
            };
            const Vector3 P[4] =
            {
                { Centre.x + Unit[0].x * Radius, Centre.y + Unit[0].y * Radius, Centre.z + Unit[0].z * Radius },
                { Centre.x + Unit[1].x * Radius, Centre.y + Unit[1].y * Radius, Centre.z + Unit[1].z * Radius },
                { Centre.x + Unit[2].x * Radius, Centre.y + Unit[2].y * Radius, Centre.z + Unit[2].z * Radius },
                { Centre.x + Unit[3].x * Radius, Centre.y + Unit[3].y * Radius, Centre.z + Unit[3].z * Radius },
            };
            const Vector3 N[4] = { Unit[0], Unit[1], Unit[2], Unit[3] };
            const float Uv0[3][2] = { { U0, V0 }, { U1, V0 }, { U1, V1 } };
            const float Uv1[3][2] = { { U0, V0 }, { U1, V1 }, { U0, V1 } };
            const Vector3 P0[3] = { P[0], P[1], P[2] };
            const Vector3 P1[3] = { P[0], P[2], P[3] };
            const Vector3 N0[3] = { N[0], N[1], N[2] };
            const Vector3 N1[3] = { N[0], N[2], N[3] };
            AppendTriangle(P0, N0, Uv0, Material);
            AppendTriangle(P1, N1, Uv1, Material);
        }
    }
}

void DriveSceneAuthor::AppendMaterialShowcase() noexcept
{
    constexpr float Radius = 0.30f;
    constexpr float Pitch = 0.86f;
    constexpr float OriginX = -8.2f;
    constexpr float OriginY = 11.0f;
    constexpr uint32_t FirstMaterial = MatBrake + 1u;
    for (uint32_t Row = 0u; Row < kDriveMaterialShowcaseSide; ++Row)
    {
        for (uint32_t Column = 0u; Column < kDriveMaterialShowcaseSide; ++Column)
        {
            const uint32_t Slot = Row * kDriveMaterialShowcaseSide + Column;
            const Vector3 Centre
            {
                OriginX + Pitch * static_cast<float>(Column),
                OriginY + Pitch * static_cast<float>(Row),
                Radius + 0.05f
            };
            AppendMaterialSphere(Centre, Radius, FirstMaterial + Slot, 8u, 16u);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------ static course (world space; reuses the shared DriveCourse geometry)
void DriveSceneAuthor::AppendCourse() noexcept
{
    EmitCourseTriangles([&](float ax,float ay,float az, float bx,float by,float bz,
                            float cx,float cy,float cz, uint32_t m)
    { AppendFace(Vector3{ax,ay,az}, Vector3{bx,by,bz}, Vector3{cx,cy,cz}, m); });
}

//------------------------------------------------------------------------------------------------------------------------ materials (index-aligned with DriveCourse.h Materials enum)
void DriveSceneAuthor::AuthorMaterials() noexcept
{
    Materials.clear();
    auto Dielectric = [](float r, float g, float b, float rough) {
        MaterialSlabDescriptor s; s.BaseColor[0]=r; s.BaseColor[1]=g; s.BaseColor[2]=b;
        s.BaseMetalness=0.0f; s.SpecularRoughness=rough; s.SpecularIor=1.5f; return s; };

    Materials.push_back(MakeMaterial("Checker light", Dielectric(0.82f,0.82f,0.84f, 0.35f))); // 0
    Materials.push_back(MakeMaterial("Checker dark",  Dielectric(0.05f,0.05f,0.06f, 0.35f))); // 1
    Materials.push_back(MakeMaterial("Surround",      Dielectric(0.35f,0.36f,0.38f, 0.55f))); // 2
    Materials.push_back(MakeMaterial("Ramp",          Dielectric(0.42f,0.43f,0.45f, 0.40f))); // 3
    Materials.push_back(MakeMaterial("Speed bump",    Dielectric(0.90f,0.72f,0.08f, 0.45f))); // 4
    Materials.push_back(MakeMaterial("Cone",          Dielectric(0.95f,0.35f,0.05f, 0.40f))); // 5

    // 6 — System-B cobalt automotive paint.  Use a deliberately high finite-flake population (not a sparse
    // glint accent): each painted panel has 6.0 density, 1 mm-scale UV placement and a distinct low-roughness
    // dielectric clearcoat.  The settings are the same OpenPBR fields used by the ReSTIR material evaluator.
    MaterialSlabDescriptor paint = Dielectric(0.018f, 0.045f, 0.28f, 0.28f);
    paint.SlateAutomotiveProfile = 1.0f;
    paint.SlateAutomotiveSweep   = 0.0f;
    paint.SlateGlintDensity      = 6.0f;
    paint.SlateGlintUvScale      = 1.0f;
    paint.CoatWeight             = 1.0f;
    paint.CoatColor[0] = 1.0f; paint.CoatColor[1] = 1.0f; paint.CoatColor[2] = 1.0f;
    paint.CoatRoughness = 0.055f;
    paint.CoatIor       = 1.5f;
    Materials.push_back(MakeMaterial("MAMetalicCoat — dense cobalt finite-flake clearcoat", paint)); // 6

    // 7 — the source's MAGlass family: tinted, high-IOR glazing with a clear reflected lobe.
    MaterialSlabDescriptor glass = Dielectric(0.018f,0.050f,0.085f,0.055f);
    glass.SpecularIor = 1.52f;
    glass.CoatWeight = 1.0f; glass.CoatRoughness = 0.025f; glass.CoatIor = 1.52f;
    Materials.push_back(MakeMaterial("MAGlass — smoked cockpit glazing", glass));                   // 7

    // 8 — MAPlastic / MAPlastic2.  It is non-metallic and visibly rougher than paint; no accidental body-wide coat.
    MaterialSlabDescriptor plastic = Dielectric(0.012f,0.014f,0.018f,0.46f);
    plastic.CoatWeight = 0.0f;
    Materials.push_back(MakeMaterial("MAPlastic — lower trim, splitter and grille", plastic));       // 8

    // 9 — MARubber / MAStandardRubber.002 tyre sidewall and tread.
    MaterialSlabDescriptor tyre = Dielectric(0.012f,0.013f,0.015f,0.82f);
    tyre.CoatWeight = 0.0f;
    Materials.push_back(MakeMaterial("MARubber — XPBD tyre carcass", tyre));                           // 9

    // 10 / 11 — wheel and brake treatments stay physically distinct from the rubber.
    MaterialSlabDescriptor hub; hub.BaseColor[0]=0.42f; hub.BaseColor[1]=0.44f; hub.BaseColor[2]=0.49f;
    hub.BaseMetalness=1.0f; hub.SpecularRoughness=0.16f;
    Materials.push_back(MakeMaterial("Wheel hub — machined alloy", hub));                              // 10
    MaterialSlabDescriptor brake; brake.BaseColor[0]=0.30f; brake.BaseColor[1]=0.075f; brake.BaseColor[2]=0.025f;
    brake.BaseMetalness=0.82f; brake.SpecularRoughness=0.29f;
    Materials.push_back(MakeMaterial("Brake disc and caliper", brake));                               // 11

    for (uint32_t Row = 0u; Row < kDriveMaterialShowcaseSide; ++Row)
    {
        for (uint32_t Column = 0u; Column < kDriveMaterialShowcaseSide; ++Column)
        {
            const float T = static_cast<float>(Column) / static_cast<float>(kDriveMaterialShowcaseSide - 1u);
            const float Hue = static_cast<float>(Column) / static_cast<float>(kDriveMaterialShowcaseSide);
            char Name[96];
            std::snprintf(Name, sizeof(Name), "Drive material showcase r%02u c%02u", Row, Column);
            MaterialSlabDescriptor Sample = Dielectric(0.18f, 0.18f, 0.18f, 0.35f);
            switch (Row)
            {
            case 0:
                HueColor(Hue, 0.55f, 0.92f, Sample.BaseColor);
                Sample.BaseMetalness = 1.0f;
                Sample.SpecularRoughness = 0.05f + 0.45f * T;
                Sample.SpecularRoughnessAnisotropy = 0.2f + 0.75f * T;
                break;
            case 1:
                SetColor(Sample.BaseColor, 1.0f, 1.0f, 1.0f);
                Sample.TransmissionWeight = 1.0f;
                Sample.SpecularIor = 1.30f + 1.10f * T;
                Sample.SpecularRoughness = 0.01f + 0.18f * T;
                HueColor(Hue, 0.16f, 1.0f, Sample.TransmissionColor);
                break;
            case 2:
                HueColor(Hue, 0.30f, 0.88f, Sample.BaseColor);
                Sample.SubsurfaceWeight = 1.0f;
                HueColor(Hue, 0.35f, 0.90f, Sample.SubsurfaceColor);
                Sample.SubsurfaceRadius = 0.012f + 0.068f * T;
                break;
            case 3:
                SetColor(Sample.BaseColor, 0.03f + 0.25f * T, 0.03f, 0.04f + 0.18f * T);
                Sample.ThinFilmWeight = 1.0f;
                Sample.ThinFilmThickness = 0.15f + 1.15f * T;
                Sample.ThinFilmIor = 1.33f + 0.25f * T;
                break;
            case 4:
                HueColor(Hue, 0.75f, 0.46f, Sample.BaseColor);
                Sample.FuzzWeight = 0.4f + 0.6f * T;
                Sample.FuzzRoughness = 0.5f + 0.45f * T;
                break;
            case 5:
                HueColor(Hue, 0.85f, 0.50f, Sample.BaseColor);
                Sample.CoatWeight = 1.0f;
                Sample.CoatRoughness = 0.02f + 0.30f * T;
                Sample.CoatIor = 1.6f;
                break;
            case 6:
                HueColor(Hue, 0.45f, 0.22f, Sample.BaseColor);
                Sample.SlateHazinessWeight = 0.95f * T;
                Sample.SlateHazinessRoughness = 0.50f + 0.35f * T;
                break;
            case 7:
                HueColor(Hue, 0.80f, 0.75f, Sample.BaseColor);
                Sample.SpecularWeight = 0.0f;
                Sample.BaseDiffuseRoughness = T;
                break;
            case 8:
                SetColor(Sample.BaseColor, 0.0f, 0.0f, 0.0f);
                Sample.SpecularWeight = 0.0f;
                Sample.EmissionLuminance = 2.0f + 8.0f * T;
                HueColor(Hue, 0.85f, 1.0f, Sample.EmissionColor);
                break;
            case 9:
                HueColor(Hue, 0.40f, 0.85f, Sample.BaseColor);
                Sample.BaseMetalness = 1.0f;
                Sample.SpecularRoughness = 0.05f + 0.85f * T;
                break;
            case 10:
                HueColor(Hue, 0.70f, 0.65f, Sample.BaseColor);
                Sample.BaseMetalness = T;
                Sample.SpecularRoughness = 0.22f;
                break;
            case 11:
                if ((Column & 1u) == 0u)
                    HueColor(Hue, 0.30f, 0.90f, Sample.BaseColor);
                else
                    HueColor(Hue, 0.55f, 0.10f, Sample.BaseColor);
                Sample.SpecularRoughness = 0.55f + 0.30f * static_cast<float>(Column & 1u);
                break;
            case 12:
                HueColor(Hue, 0.50f, 0.30f, Sample.BaseColor);
                Sample.BaseMetalness = 0.8f;
                Sample.SlateGlintDensity = 1.0f + 7.0f * T;
                Sample.SlateGlintUvScale = 4.0f + 8.0f * T;
                Sample.CoatWeight = 1.0f;
                Sample.CoatRoughness = 0.06f;
                break;
            case 13:
                SetColor(Sample.BaseColor, 1.0f, 1.0f, 1.0f);
                Sample.TransmissionWeight = 1.0f;
                Sample.TransmissionDepth = 0.10f + 0.50f * T;
                Sample.SpecularIor = 1.52f;
                HueColor(Hue, 0.70f, 0.85f, Sample.TransmissionColor);
                break;
            case 14:
                HueColor(Hue, 0.15f + 0.70f * T, 0.95f, Sample.BaseColor);
                Sample.CoatWeight = 1.0f;
                Sample.ThinFilmWeight = (Column % 3u) == 0u ? 0.5f : 0.0f;
                Sample.SubsurfaceWeight = (Column % 3u) == 1u ? 0.4f : 0.0f;
                Sample.BaseMetalness = (Column % 3u) == 2u ? 1.0f : 0.0f;
                break;
            default:
                AuthorAutomotiveShowcase(Sample, Row - 14u, T);
                break;
            }
            Materials.push_back(MakeMaterial(Name, Sample));
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------ Construct + Export
void DriveSceneAuthor::Construct() noexcept
{
    Triangles.clear(); CornerNormals.clear(); Spans.clear();
    AuthorMaterials();

    Frontier::Vehicle::VehicleGeometry geo;   // real ControlVehicle socket data (dims, CoM height, wheel layout)
    const float comH   = geo.CoMHeight;        // shift the body so local origin = CoM
    const float radius = geo.TyreRadius;
    const float halfW  = 0.1175f;              // matches the physics wheel half-width

    // span 0 — body (dynamic) -> instance 0.  Its faces are partitioned into MAMetalicCoat, MAGlass and MAPlastic.
    { auto s = OpenSpan("ControlVehicle — paint / glass / plastic", /*Dynamic=*/true); (void)s;
      AppendVehicleBody(comH, MatBodyPaint); }

    // spans 1..4 — wheels (dynamic) -> instances 1..4 (FL, FR, RL, RR).  Every wheel emits MARubber + hub + brake.
    const char* wheelNames[4] = { "XPBD Tyre FL", "XPBD Tyre FR", "XPBD Tyre RL", "XPBD Tyre RR" };
    for (int w = 0; w < 4; ++w)
    { auto s = OpenSpan(wheelNames[w], /*Dynamic=*/true); (void)s;
      AppendWheel(Vector3{0,0,0}, radius, halfW, /*Segments=*/48u, MatTyre); }

    // span 5 — project-owned material showcase, so Drive opens with the same material-matrix proof scene family as Project-Zero.
    { auto s = OpenSpan("Drive material showcase", /*Dynamic=*/false); (void)s;
      AppendMaterialShowcase(); }

    // span 6 — course (static) -> instances 6.. (one per material used)
    { auto s = OpenSpan("Course", /*Dynamic=*/false); (void)s;
      AppendCourse(); }
}

bool DriveSceneAuthor::Export(const std::string& Path, std::string* Error) const noexcept
{
    SceneEncodeConfiguration Configuration;
    Configuration.Name           = "DriveCourse.r" + std::to_string(kDriveSceneRevision);
    Configuration.CornerNormals  = &CornerNormals;
    Configuration.WriteTexcoords = true;
    Configuration.Spans          = &Spans;
    return SceneCodec::Encode(Path, Triangles, Materials, Error, Configuration);
}

//------------------------------------------------------------------------------------------------------------------------ revision check (cheap header scan for the stamped scene name)
bool DriveSceneMatchesRevision(const std::string& Path) noexcept
{
    std::ifstream f(Path, std::ios::binary);
    if (!f) return false;
    std::string head(4096, '\0');
    f.read(&head[0], static_cast<std::streamsize>(head.size()));
    head.resize(static_cast<size_t>(f.gcount()));
    const std::string marker = "DriveCourse.r" + std::to_string(kDriveSceneRevision);
    return head.find(marker) != std::string::npos;
}

} // namespace Drive
} // namespace Frontier
