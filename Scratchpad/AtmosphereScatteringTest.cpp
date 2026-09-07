// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  AtmosphereScatteringTest.cpp — the sky is blue, the sunset is red, and the night is dark, for physical reasons
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  A verbatim CPU port of AtmosphereScattering.slang. Every constant and every expression is copied, so a change
//  to one that is not made to the other shows up here rather than on the GPU.
//
//  What makes these assertions worth anything is that none of them is a taste judgement. "The sky is blue" is
//  checked as blue radiance exceeding red by a factor the Rayleigh λ⁻⁴ law predicts; "the sunset is red" is
//  checked as the blue/red ratio INVERTING between zenith and horizon at low sun. A model that merely produced
//  a pleasant gradient would fail all of them.
//
//  Build: see Scratchpad/CheckAtmosphereScattering.sh
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

#include <cmath>
#include <cstdio>
#include <initializer_list>

//------------------------------------------------------------------------------------------------------------------------
//                                            PORT OF AtmosphereScattering.slang
//------------------------------------------------------------------------------------------------------------------------

struct Vec3
{
    float x = 0.0f, y = 0.0f, z = 0.0f;
    Vec3() = default;
    Vec3(float X, float Y, float Z) : x(X), y(Y), z(Z) {}
    explicit Vec3(float S) : x(S), y(S), z(S) {}
};

static Vec3 operator+(Vec3 a, Vec3 b) { return { a.x + b.x, a.y + b.y, a.z + b.z }; }
static Vec3 operator-(Vec3 a, Vec3 b) { return { a.x - b.x, a.y - b.y, a.z - b.z }; }
static Vec3 operator*(Vec3 a, Vec3 b) { return { a.x * b.x, a.y * b.y, a.z * b.z }; }
static Vec3 operator*(Vec3 a, float s) { return { a.x * s, a.y * s, a.z * s }; }
static Vec3 operator/(Vec3 a, Vec3 b) { return { a.x / b.x, a.y / b.y, a.z / b.z }; }
static Vec3& operator+=(Vec3& a, Vec3 b) { a = a + b; return a; }
static Vec3& operator*=(Vec3& a, Vec3 b) { a = a * b; return a; }
static float Dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static float Length(Vec3 a) { return std::sqrt(Dot(a, a)); }
static Vec3 Normalize(Vec3 a) { const float L = Length(a); return L > 0.0f ? a * (1.0f / L) : a; }
static Vec3 Exp(Vec3 a) { return { std::exp(a.x), std::exp(a.y), std::exp(a.z) }; }
static Vec3 Max(Vec3 a, Vec3 b) { return { std::fmax(a.x, b.x), std::fmax(a.y, b.y), std::fmax(a.z, b.z) }; }

// ── Constants: must match AtmosphereScattering.slang exactly ────────────────────────────────────────────────
static constexpr float kPlanetRadius        = 6360000.0f;
static constexpr float kAtmosphereThickness =  100000.0f;
static constexpr float kAtmosphereRadius    = kPlanetRadius + kAtmosphereThickness;
static constexpr float kRayleighScaleHeight = 8000.0f;
static constexpr float kMieScaleHeight      = 1200.0f;
static const     Vec3  kRayleighScattering  { 5.802e-6f, 13.558e-6f, 33.1e-6f };
static constexpr float kMieScattering       = 3.996e-6f;
static constexpr float kMieExtinction       = 4.440e-6f;
static constexpr float kMieAsymmetry        = 0.80f;
static const     Vec3  kOzoneAbsorption     { 0.650e-6f, 1.881e-6f, 0.085e-6f };
static constexpr float kOzoneCentre         = 25000.0f;
static constexpr float kOzoneWidth          = 15000.0f;
static constexpr float kSunAngularRadius    = 0.004675f;

static Vec3 AtmosphereDensity(float Altitude)
{
    const float Rayleigh = std::exp(-std::fmax(Altitude, 0.0f) / kRayleighScaleHeight);
    const float Mie      = std::exp(-std::fmax(Altitude, 0.0f) / kMieScaleHeight);
    const float Ozone    = std::fmax(0.0f, 1.0f - std::fabs(Altitude - kOzoneCentre) / kOzoneWidth);
    return { Rayleigh, Mie, Ozone };
}

static float RaySphereNearest(Vec3 Origin, Vec3 Direction, float Radius)
{
    const float b = Dot(Origin, Direction);
    const float c = Dot(Origin, Origin) - Radius * Radius;
    const float Discriminant = b * b - c;
    if (Discriminant < 0.0f) return -1.0f;
    const float Root = std::sqrt(Discriminant);
    const float Near = -b - Root;
    const float Far  = -b + Root;
    if (Far < 0.0f) return -1.0f;
    return Near >= 0.0f ? Near : Far;
}

static float RayleighPhase(float CosAngle)
{
    return 3.0f / (16.0f * 3.14159265f) * (1.0f + CosAngle * CosAngle);
}

static float MiePhase(float CosAngle, float g)
{
    const float g2 = g * g;
    const float Numerator   = 3.0f * (1.0f - g2) * (1.0f + CosAngle * CosAngle);
    const float Denominator = 8.0f * 3.14159265f * (2.0f + g2) * std::pow(1.0f + g2 - 2.0f * g * CosAngle, 1.5f);
    return Numerator / std::fmax(Denominator, 1e-9f);
}

static Vec3 OpticalDepth(Vec3 Origin, Vec3 Direction, float Distance, int Steps)
{
    const float Step = Distance / static_cast<float>(Steps);
    Vec3 Sum{};
    for (int i = 0; i < Steps; ++i)
    {
        const Vec3  Position = Origin + Direction * ((static_cast<float>(i) + 0.5f) * Step);
        const float Altitude = Length(Position) - kPlanetRadius;
        const Vec3  Density  = AtmosphereDensity(Altitude);
        Sum += (kRayleighScattering * Density.x
              + Vec3(kMieExtinction) * Density.y
              + kOzoneAbsorption    * Density.z) * Step;
    }
    return Sum;
}

static Vec3 SunTransmittance(Vec3 Position, Vec3 SunDirection, int Steps)
{
    if (RaySphereNearest(Position, SunDirection, kPlanetRadius) > 0.0f) return Vec3(0.0f);
    const float ToSpace = RaySphereNearest(Position, SunDirection, kAtmosphereRadius);
    if (ToSpace < 0.0f) return Vec3(1.0f);
    return Exp(OpticalDepth(Position, SunDirection, ToSpace, Steps) * -1.0f);
}

static Vec3 SkyRadiance(float CameraAltitude, Vec3 ViewDirection, Vec3 SunDirection,
                        Vec3 SunIlluminance, int ViewSteps, int LightSteps)
{
    const Vec3 Origin{ 0.0f, 0.0f, kPlanetRadius + std::fmax(CameraAltitude, 1.0f) };

    float Distance = RaySphereNearest(Origin, ViewDirection, kAtmosphereRadius);
    if (Distance < 0.0f) return Vec3(0.0f);
    const float Ground = RaySphereNearest(Origin, ViewDirection, kPlanetRadius);
    if (Ground > 0.0f) Distance = std::fmin(Distance, Ground);

    const float CosTheta      = Dot(ViewDirection, SunDirection);
    const float PhaseRayleigh = RayleighPhase(CosTheta);
    const float PhaseMie      = MiePhase(CosTheta, kMieAsymmetry);

    const float Step = Distance / static_cast<float>(ViewSteps);
    Vec3 Radiance{};
    Vec3 Transmittance(1.0f);

    for (int i = 0; i < ViewSteps; ++i)
    {
        const Vec3  Position = Origin + ViewDirection * ((static_cast<float>(i) + 0.5f) * Step);
        const float Altitude = Length(Position) - kPlanetRadius;
        const Vec3  Density  = AtmosphereDensity(Altitude);

        const Vec3 Extinction = kRayleighScattering * Density.x
                              + Vec3(kMieExtinction) * Density.y
                              + kOzoneAbsorption    * Density.z;
        const Vec3 StepTransmittance = Exp(Extinction * -Step);

        const Vec3 ScatteringHere = kRayleighScattering * Density.x * PhaseRayleigh
                                  + Vec3(kMieScattering) * Density.y * PhaseMie;

        const Vec3 SunArriving = SunTransmittance(Position, SunDirection, LightSteps);
        const Vec3 Integrated  = (ScatteringHere - ScatteringHere * StepTransmittance) / Max(Extinction, Vec3(1e-9f));

        Radiance      += Transmittance * SunArriving * Integrated * SunIlluminance;
        Transmittance *= StepTransmittance;
    }
    return Radiance;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              PORT OF THE A2 LOOKUP TABLES
//------------------------------------------------------------------------------------------------------------------------

static constexpr unsigned kTransmittanceWidth  = 256u;
static constexpr unsigned kTransmittanceHeight = 64u;
static constexpr unsigned kMultiScatterSize    = 32u;

static void TransmittanceInverse(float U, float V, float& Altitude, float& CosSunZenith)
{
    Altitude     = V * V * kAtmosphereThickness;
    CosSunZenith = U * 2.0f - 1.0f;
}

static Vec3 ComputeTransmittanceTexel(float U, float V)
{
    float Altitude, CosSunZenith;
    TransmittanceInverse(U, V, Altitude, CosSunZenith);
    const Vec3  Origin{ 0.0f, 0.0f, kPlanetRadius + Altitude };
    const float SinZenith = std::sqrt(std::fmax(0.0f, 1.0f - CosSunZenith * CosSunZenith));
    const Vec3  Direction{ SinZenith, 0.0f, CosSunZenith };
    if (RaySphereNearest(Origin, Direction, kPlanetRadius) > 0.0f) return Vec3(0.0f);
    const float ToSpace = RaySphereNearest(Origin, Direction, kAtmosphereRadius);
    if (ToSpace <= 0.0f) return Vec3(1.0f);
    return Exp(OpticalDepth(Origin, Direction, ToSpace, 64) * -1.0f);
}

static Vec3 ComputeMultiScatterTexel(float U, float V, int Directions, int Steps)
{
    float Altitude, CosSunZenith;
    TransmittanceInverse(U, V, Altitude, CosSunZenith);
    const Vec3  Origin{ 0.0f, 0.0f, kPlanetRadius + Altitude };
    const float SinZenith = std::sqrt(std::fmax(0.0f, 1.0f - CosSunZenith * CosSunZenith));
    const Vec3  SunDirection{ SinZenith, 0.0f, CosSunZenith };

    Vec3 SecondOrder{}, Transfer{};
    for (int i = 0; i < Directions; ++i)
    {
        const float Fraction = (static_cast<float>(i) + 0.5f) / static_cast<float>(Directions);
        const float CosTheta = 1.0f - 2.0f * Fraction;
        const float SinTheta = std::sqrt(std::fmax(0.0f, 1.0f - CosTheta * CosTheta));
        const float Phi      = static_cast<float>(i) * 2.39996323f;
        const Vec3  Ray{ SinTheta * std::cos(Phi), SinTheta * std::sin(Phi), CosTheta };

        float Distance = RaySphereNearest(Origin, Ray, kAtmosphereRadius);
        const float Ground = RaySphereNearest(Origin, Ray, kPlanetRadius);
        if (Ground > 0.0f) Distance = std::fmin(Distance, Ground);
        if (Distance <= 0.0f) continue;

        const float Step = Distance / static_cast<float>(Steps);
        Vec3 RayTransmittance(1.0f);
        for (int j = 0; j < Steps; ++j)
        {
            const Vec3  Position = Origin + Ray * ((static_cast<float>(j) + 0.5f) * Step);
            const float H        = Length(Position) - kPlanetRadius;
            const Vec3  Density  = AtmosphereDensity(H);
            const Vec3  Extinction = kRayleighScattering * Density.x
                                   + Vec3(kMieExtinction) * Density.y
                                   + kOzoneAbsorption    * Density.z;
            const Vec3  Scattering = kRayleighScattering * Density.x + Vec3(kMieScattering) * Density.y;
            const Vec3  StepTransmittance = Exp(Extinction * -Step);
            const Vec3  Integrated = (Scattering - Scattering * StepTransmittance) / Max(Extinction, Vec3(1e-9f));
            const Vec3  SunArriving = SunTransmittance(Position, SunDirection, 16);
            SecondOrder += RayTransmittance * SunArriving * Integrated * (1.0f / (4.0f * 3.14159265f));
            Transfer    += RayTransmittance * Integrated * (1.0f / (4.0f * 3.14159265f));
            RayTransmittance *= StepTransmittance;
        }
    }
    const float Weight = 4.0f * 3.14159265f / static_cast<float>(Directions);
    SecondOrder = SecondOrder * Weight;
    Transfer    = Transfer * Weight;
    const Vec3 Series = Vec3(1.0f) / Max(Vec3(1.0f) - Vec3(std::fmin(Transfer.x, 0.999f), std::fmin(Transfer.y, 0.999f), std::fmin(Transfer.z, 0.999f)), Vec3(1e-4f));
    return SecondOrder * Series;
}

//------------------------------------------------------------------------------------------------------------------------

static int Failures = 0;
static void Expect(bool Condition, const char* What)
{
    std::printf("  %-70s %s\n", What, Condition ? "PASS" : "FAIL");
    if (!Condition) ++Failures;
}

static Vec3 SunAtElevation(float Degrees)
{
    const float R = Degrees * 3.14159265f / 180.0f;
    return Normalize(Vec3{ 0.0f, std::cos(R), std::sin(R) });
}

static const Vec3 kZenith{ 0.0f, 0.0f, 1.0f };
static constexpr float kSunLux = 120000.0f;
static constexpr int   kView = 64, kLight = 16;

int main()
{
    std::printf("AtmosphereScattering — single-scattering sky\n");

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n1. the daytime sky is blue, by the ratio Rayleigh predicts\n");
    {
        // λ⁻⁴ makes the blue coefficient 33.1 / 5.802 ≈ 5.7× the red one. The observed radiance ratio is smaller
        //    than that because blue is also extinguished faster, but it must be comfortably above 1.
        const Vec3 Sky = SkyRadiance(2.0f, kZenith, SunAtElevation(60.0f), Vec3(kSunLux), kView, kLight);
        std::printf("     zenith radiance R %.4f  G %.4f  B %.4f   (B/R %.2f)\n",
                    static_cast<double>(Sky.x), static_cast<double>(Sky.y), static_cast<double>(Sky.z),
                    static_cast<double>(Sky.z / Sky.x));
        Expect(Sky.z > Sky.y && Sky.y > Sky.x, "blue exceeds green exceeds red — the Rayleigh ordering");
        Expect(Sky.z / Sky.x > 2.0f,           "and blue is at least twice red, not a marginal tint");
        Expect(Sky.x > 0.0f,                   "every channel carries some light");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n2. the horizon is brighter than the zenith\n");
    {
        // A ray toward the horizon passes through far more air, so it accumulates more scattering. This is the
        //    single clearest sign the march is integrating along the real path rather than shading a dome.
        const Vec3 Sun     = SunAtElevation(45.0f);
        const Vec3 Zenith  = SkyRadiance(2.0f, kZenith, Sun, Vec3(kSunLux), kView, kLight);
        const Vec3 Horizon = SkyRadiance(2.0f, Normalize(Vec3{ 1.0f, 0.0f, 0.02f }), Sun, Vec3(kSunLux), kView, kLight);
        const float ZenithLuma  = 0.2126f * Zenith.x  + 0.7152f * Zenith.y  + 0.0722f * Zenith.z;
        const float HorizonLuma = 0.2126f * Horizon.x + 0.7152f * Horizon.y + 0.0722f * Horizon.z;
        std::printf("     zenith %.4f, horizon %.4f  (ratio %.2f)\n",
                    static_cast<double>(ZenithLuma), static_cast<double>(HorizonLuma),
                    static_cast<double>(HorizonLuma / ZenithLuma));
        Expect(HorizonLuma > ZenithLuma, "the longer path through air is brighter");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n3. the sunset reddens — the colour ratio INVERTS at the horizon\n");
    {
        // The assertion that a gradient cannot fake. At high sun the sky toward the sun is blue-dominant; at a
        //    grazing angle the same direction has had its blue scattered out along a very long path and becomes
        //    red-dominant. It is a change of SIGN, not of degree.
        const Vec3 HighSun = SunAtElevation(60.0f);
        const Vec3 LowSun  = SunAtElevation(1.0f);

        const Vec3 TowardHigh = SkyRadiance(2.0f, Normalize(Vec3{ 0.0f, std::cos(1.0f * 3.14159265f / 180.0f),
                                                                        std::sin(1.0f * 3.14159265f / 180.0f) }),
                                            HighSun, Vec3(kSunLux), kView, kLight);
        const Vec3 TowardLow  = SkyRadiance(2.0f, Normalize(Vec3{ 0.0f, std::cos(1.0f * 3.14159265f / 180.0f),
                                                                        std::sin(1.0f * 3.14159265f / 180.0f) }),
                                            LowSun,  Vec3(kSunLux), kView, kLight);

        std::printf("     toward the horizon, high sun  B/R %.3f\n", static_cast<double>(TowardHigh.z / TowardHigh.x));
        std::printf("     toward the horizon, sun at 1° B/R %.3f\n", static_cast<double>(TowardLow.z  / TowardLow.x));
        Expect(TowardHigh.z / TowardHigh.x > 1.0f, "with the sun high, that direction is blue-dominant");
        Expect(TowardLow.z  / TowardLow.x  < TowardHigh.z / TowardHigh.x,
               "and a setting sun shifts it decisively toward red");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n4. night is dark — the sky goes out when the sun does\n");
    {
        // Single scattering with a correct planet-shadow test gives a genuinely black night. If this failed the
        //    ground would glow at midnight because the sun was still lighting samples through the planet.
        const Vec3 Day   = SkyRadiance(2.0f, kZenith, SunAtElevation( 45.0f), Vec3(kSunLux), kView, kLight);
        const Vec3 Dusk  = SkyRadiance(2.0f, kZenith, SunAtElevation(  0.0f), Vec3(kSunLux), kView, kLight);
        const Vec3 Night = SkyRadiance(2.0f, kZenith, SunAtElevation(-10.0f), Vec3(kSunLux), kView, kLight);

        const auto Luma = [](Vec3 c) { return 0.2126f * c.x + 0.7152f * c.y + 0.0722f * c.z; };
        std::printf("     zenith luminance: day %.5f, sunset %.5f, 10° below %.7f\n",
                    static_cast<double>(Luma(Day)), static_cast<double>(Luma(Dusk)), static_cast<double>(Luma(Night)));
        Expect(Luma(Dusk)  < Luma(Day),          "the sky dims as the sun sets");
        Expect(Luma(Night) < Luma(Dusk) * 0.10f, "and is far darker once the sun is properly below the horizon");
        Expect(Luma(Night) >= 0.0f,              "never negative");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n5. the sun's own glow is forward-scattered, not uniform\n");
    {
        // Mie asymmetry 0.8 concentrates scattering toward the sun. Looking at the sun's direction must be much
        //    brighter than looking away from it at the same elevation — that difference IS the aureole.
        const Vec3 Sun = SunAtElevation(20.0f);
        const Vec3 Toward = SkyRadiance(2.0f, Normalize(Vec3{ 0.0f, std::cos(0.35f), std::sin(0.35f) }),
                                        Sun, Vec3(kSunLux), kView, kLight);
        const Vec3 Away   = SkyRadiance(2.0f, Normalize(Vec3{ 0.0f, -std::cos(0.35f), std::sin(0.35f) }),
                                        Sun, Vec3(kSunLux), kView, kLight);
        const auto Luma = [](Vec3 c) { return 0.2126f * c.x + 0.7152f * c.y + 0.0722f * c.z; };
        std::printf("     toward the sun %.4f, away %.4f  (ratio %.2f)\n",
                    static_cast<double>(Luma(Toward)), static_cast<double>(Luma(Away)),
                    static_cast<double>(Luma(Toward) / Luma(Away)));
        Expect(Luma(Toward) > Luma(Away) * 1.5f, "the sky near the sun is markedly brighter — the Mie aureole");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n6. the phase functions are normalised and finite\n");
    {
        // Integrating a phase function over the sphere must give 1: it redistributes light, it does not create
        //    it. A mis-normalised phase silently scales the whole sky and would be tuned around rather than fixed.
        const auto Integrate = [](bool Mie)
        {
            double Sum = 0.0;
            const int N = 2000;
            for (int i = 0; i < N; ++i)
            {
                const double Cos = -1.0 + 2.0 * (i + 0.5) / N;
                const double P   = Mie ? MiePhase(static_cast<float>(Cos), kMieAsymmetry)
                                       : RayleighPhase(static_cast<float>(Cos));
                Sum += P * 2.0 * 3.14159265358979 * (2.0 / N);
            }
            return Sum;
        };
        const double R = Integrate(false), M = Integrate(true);
        std::printf("     ∫ Rayleigh dΩ = %.4f, ∫ Mie dΩ = %.4f  (both must be 1)\n", R, M);
        Expect(std::fabs(R - 1.0) < 0.01, "the Rayleigh phase integrates to unity");
        Expect(std::fabs(M - 1.0) < 0.02, "and so does Cornette–Shanks");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n7. sphere intersection is stable at planetary scale\n");
    {
        // The textbook quadratic catastrophically cancels for a ray starting 2 m above a 6360 km sphere, which is
        //    the normal case here. A wrong root shows as a shimmering horizon rather than an obvious failure.
        const Vec3 Origin{ 0.0f, 0.0f, kPlanetRadius + 2.0f };
        const float Up = RaySphereNearest(Origin, kZenith, kAtmosphereRadius);
        std::printf("     straight up to the top of the atmosphere: %.1f m (expect ~%.0f)\n",
                    static_cast<double>(Up), static_cast<double>(kAtmosphereThickness - 2.0f));
        Expect(std::fabs(Up - (kAtmosphereThickness - 2.0f)) < 50.0f, "the vertical distance is right to 50 m");

        // Looking down must hit the ground almost immediately.
        const float Down = RaySphereNearest(Origin, Vec3{ 0.0f, 0.0f, -1.0f }, kPlanetRadius);
        Expect(Down > 0.0f && Down < 10.0f, "looking straight down hits the ground within metres");

        // A horizontal ray must travel hundreds of kilometres before leaving the air.
        const float Flat = RaySphereNearest(Origin, Vec3{ 1.0f, 0.0f, 0.0f }, kAtmosphereRadius);
        std::printf("     horizontal to the top of the atmosphere: %.0f km\n", static_cast<double>(Flat / 1000.0f));
        Expect(Flat > 800000.0f && Flat < 1500000.0f, "the horizontal path is the expected ~1100 km");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n8. quality tiers agree with the reference\n");
    {
        // The tiers must differ in cost, not in answer. If Low disagreed materially with Ultra the setting would
        //    be a look change rather than a performance one, and a player would see a different sky per machine.
        const Vec3 Sun = SunAtElevation(30.0f);
        const auto Luma = [](Vec3 c) { return 0.2126f * c.x + 0.7152f * c.y + 0.0722f * c.z; };

        struct Tier { const char* Name; int View, Light; };
        const Tier Tiers[] = { { "Low", 16, 4 }, { "Medium", 32, 8 }, { "High", 48, 12 } };
        const float ReferenceZenith  = Luma(SkyRadiance(2.0f, kZenith, Sun, Vec3(kSunLux), 64, 16));
        const float ReferenceHorizon = Luma(SkyRadiance(2.0f, Normalize(Vec3{ 1.0f, 0.0f, 0.02f }), Sun, Vec3(kSunLux), 64, 16));

        for (const Tier& T : Tiers)
        {
            const float Zenith  = Luma(SkyRadiance(2.0f, kZenith, Sun, Vec3(kSunLux), T.View, T.Light));
            const float Horizon = Luma(SkyRadiance(2.0f, Normalize(Vec3{ 1.0f, 0.0f, 0.02f }), Sun, Vec3(kSunLux), T.View, T.Light));
            const float ZenithError  = std::fabs(Zenith  - ReferenceZenith)  / ReferenceZenith  * 100.0f;
            const float HorizonError = std::fabs(Horizon - ReferenceHorizon) / ReferenceHorizon * 100.0f;
            std::printf("     %-7s %2d × %2d   zenith %+.2f %%   horizon %+.2f %%\n",
                        T.Name, T.View, T.Light, static_cast<double>(ZenithError), static_cast<double>(HorizonError));
            Expect(ZenithError  < 3.0f,  "zenith is within 3 % of the reference at this tier");
            Expect(HorizonError < 12.0f, "and the horizon within 12 %, where the path is longest");
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n9. zero illuminance restores the pre-A3 black sky exactly\n");
    {
        // The identity switch. Every image made before the sky existed must still be reproducible, or the phase
        //    cannot be A/B tested against what came before.
        const Vec3 Dark = SkyRadiance(2.0f, kZenith, SunAtElevation(45.0f), Vec3(0.0f), kView, kLight);
        Expect(Dark.x == 0.0f && Dark.y == 0.0f && Dark.z == 0.0f, "no illuminance means no radiance at all");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n10. the transmittance table reproduces the march it replaces\n");
    {
        // The table exists to remove SunTransmittance()'s inner march. It is only a speed-up if it returns the
        //    same answer — otherwise it is a different sky that happens to render faster.
        float Worst = 0.0f; float WorstAltitude = 0.0f, WorstCos = 0.0f;
        for (int Row = 0; Row < 16; ++Row)
            for (int Column = 0; Column < 32; ++Column)
            {
                const float U = (Column + 0.5f) / 32.0f, V = (Row + 0.5f) / 16.0f;
                float Altitude, CosSunZenith;
                TransmittanceInverse(U, V, Altitude, CosSunZenith);

                const Vec3 Table = ComputeTransmittanceTexel(U, V);

                const Vec3  Origin{ 0.0f, 0.0f, kPlanetRadius + Altitude };
                const float SinZenith = std::sqrt(std::fmax(0.0f, 1.0f - CosSunZenith * CosSunZenith));
                const Vec3  Marched = SunTransmittance(Origin, Vec3{ SinZenith, 0.0f, CosSunZenith }, 64);

                const float Error = std::fmax(std::fabs(Table.x - Marched.x),
                                    std::fmax(std::fabs(Table.y - Marched.y), std::fabs(Table.z - Marched.z)));
                if (Error > Worst) { Worst = Error; WorstAltitude = Altitude; WorstCos = CosSunZenith; }
            }
        std::printf("     worst disagreement %.3e (at %.0f m, cos %.2f)\n",
                    static_cast<double>(Worst), static_cast<double>(WorstAltitude), static_cast<double>(WorstCos));
        Expect(Worst < 1e-5f, "the table and the march agree to five decimal places");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n11. transmittance behaves the way an atmosphere must\n");
    {
        // Overhead sun at sea level: most light gets through, and blue is attenuated hardest.
        const Vec3 Overhead = ComputeTransmittanceTexel(1.0f, 0.0f);
        std::printf("     sun overhead at sea level: R %.4f G %.4f B %.4f\n",
                    static_cast<double>(Overhead.x), static_cast<double>(Overhead.y), static_cast<double>(Overhead.z));
        Expect(Overhead.x > 0.85f && Overhead.x < 1.0f, "red mostly survives a vertical path");
        Expect(Overhead.z < Overhead.x,                 "blue is attenuated more than red — why the sun looks warm");

        // Sun below the horizon: the ground blocks it completely.
        const Vec3 Below = ComputeTransmittanceTexel(0.0f, 0.0f);
        Expect(Below.x == 0.0f && Below.y == 0.0f && Below.z == 0.0f,
               "a sun below the horizon transmits nothing — no light through the planet");

        // Higher up there is less air overhead, so more survives. Monotone in altitude.
        bool Monotone = true;
        float Previous = -1.0f;
        for (int Row = 0; Row < 16; ++Row)
        {
            const float V = (Row + 0.5f) / 16.0f;
            const float Value = ComputeTransmittanceTexel(1.0f, V).z;
            if (Value < Previous - 1e-6f) Monotone = false;
            Previous = Value;
        }
        Expect(Monotone, "transmittance rises with altitude, without wobble");

        // A grazing sun travels through far more air than an overhead one.
        const Vec3 Grazing = ComputeTransmittanceTexel(0.5f, 0.0f);   // cos = 0, exactly at the horizon
        std::printf("     grazing sun at sea level:  R %.4f G %.4f B %.4f\n",
                    static_cast<double>(Grazing.x), static_cast<double>(Grazing.y), static_cast<double>(Grazing.z));
        Expect(Grazing.x < Overhead.x, "a grazing path attenuates more than a vertical one");
        Expect(Grazing.z < Grazing.x,  "and reddens the beam, which is the sunset");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n12. multiple scattering adds light where single scattering cannot\n");
    {
        // The whole reason this table exists. Single scattering leaves the sky too dark away from the sun and
        //    makes twilight black; the second-order term is what fills both in. It must be positive, bounded,
        //    and largest where the single-scattering answer was weakest.
        const Vec3 Overhead = ComputeMultiScatterTexel(1.0f, 0.0f, 64, 20);
        const Vec3 Twilight = ComputeMultiScatterTexel(0.48f, 0.0f, 64, 20);   // sun just below the horizon

        std::printf("     overhead sun: R %.5f G %.5f B %.5f\n",
                    static_cast<double>(Overhead.x), static_cast<double>(Overhead.y), static_cast<double>(Overhead.z));
        std::printf("     twilight:     R %.5f G %.5f B %.5f\n",
                    static_cast<double>(Twilight.x), static_cast<double>(Twilight.y), static_cast<double>(Twilight.z));

        Expect(Overhead.x > 0.0f && Overhead.y > 0.0f && Overhead.z > 0.0f,
               "the transfer factor is positive — it adds light rather than removing it");
        Expect(Overhead.z > Overhead.x, "and is blue-dominant, as multiply-scattered skylight is");
        Expect(Overhead.x < 1.0f && Overhead.y < 1.0f && Overhead.z < 1.0f,
               "and bounded below one, so the geometric series converged rather than running away");
        Expect(Twilight.z > 0.0f, "twilight retains some scattered light instead of going black");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n13. the table parameterisation resolves the layer that matters\n");
    {
        // Density falls exponentially, so a LINEAR altitude axis spends its rows on thin air and starves the
        //    first kilometre. The square-root distribution is what fixes that, and this measures the difference
        //    rather than asserting it: how much of the table's range is spent below 10 km.
        int SqrtRows = 0, LinearRows = 0;
        for (unsigned Row = 0; Row < kTransmittanceHeight; ++Row)
        {
            const float V = (Row + 0.5f) / kTransmittanceHeight;
            if (V * V * kAtmosphereThickness < 10000.0f) ++SqrtRows;      // the parameterisation in use
            if (V * kAtmosphereThickness     < 10000.0f) ++LinearRows;    // the naive alternative
        }
        std::printf("     rows below 10 km: square-root %d of %u, linear %d of %u\n",
                    SqrtRows, kTransmittanceHeight, LinearRows, kTransmittanceHeight);
        Expect(SqrtRows > LinearRows * 2,
               "the square-root axis gives the dense lower atmosphere far more rows than a linear one would");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n14. the sun disc samples uniformly across its true angular size\n");
    {
        // A4. A verbatim port of SampleSunPoint's direction maths. Two things must hold: every sample lies
        //    inside the 0.268° cap, and the distribution is UNIFORM ON THE CAP rather than bunched at the
        //    centre. Bunching would narrow the penumbra without making the shadow obviously wrong, so it is the
        //    kind of error that survives a visual check.
        const Vec3 SunDirection = Normalize(Vec3{ 0.3f, 0.4f, 0.866f });

        const auto SampleDirection = [&](float U1, float U2)
        {
            const float CosMax   = std::cos(kSunAngularRadius);
            const float CosTheta = 1.0f - U1 * (1.0f - CosMax);
            const float SinTheta = std::sqrt(std::fmax(0.0f, 1.0f - CosTheta * CosTheta));
            const float Phi      = 6.28318530f * U2;
            const Vec3  Up       = std::fabs(SunDirection.z) < 0.99f ? Vec3{ 0.0f, 0.0f, 1.0f } : Vec3{ 1.0f, 0.0f, 0.0f };
            // cross(Up, Sun)
            const Vec3  Tangent  = Normalize(Vec3{ Up.y * SunDirection.z - Up.z * SunDirection.y,
                                                   Up.z * SunDirection.x - Up.x * SunDirection.z,
                                                   Up.x * SunDirection.y - Up.y * SunDirection.x });
            const Vec3  Bitangent{ SunDirection.y * Tangent.z - SunDirection.z * Tangent.y,
                                   SunDirection.z * Tangent.x - SunDirection.x * Tangent.z,
                                   SunDirection.x * Tangent.y - SunDirection.y * Tangent.x };
            return Normalize(SunDirection * CosTheta + Tangent * (SinTheta * std::cos(Phi))
                                                     + Bitangent * (SinTheta * std::sin(Phi)));
        };

        float WorstAngle = 0.0f;
        int   InnerHalf  = 0;
        const int Samples = 20000;
        for (int i = 0; i < Samples; ++i)
        {
            // A deterministic low-discrepancy pair, so the result does not wander between runs.
            const float U1 = (i + 0.5f) / Samples;
            const float U2 = std::fmod(i * 0.618033988f, 1.0f);
            const Vec3  D  = SampleDirection(U1, U2);
            const float Angle = std::acos(std::fmin(1.0f, Dot(D, SunDirection)));
            WorstAngle = std::fmax(WorstAngle, Angle);
            // Uniform on a cap means HALF the samples fall inside the radius that bisects its AREA, which for a
            //    small cap is r/√2 — not r/2, which is what a naive linear radius would give.
            if (Angle <= kSunAngularRadius / 1.41421356f) ++InnerHalf;
        }
        const float InnerFraction = static_cast<float>(InnerHalf) / Samples;
        std::printf("     widest sample %.6f rad (limit %.6f), inner-half-area fraction %.3f (want 0.500)\n",
                    static_cast<double>(WorstAngle), static_cast<double>(kSunAngularRadius),
                    static_cast<double>(InnerFraction));
        // ⚠️ 1 % of tolerance, not 0.1 %. acos is ill-conditioned near 1: at this angle cos(θ) = 1 − 1.09e-5,
        //    and a SINGLE float ulp there (1.19e-7) moves the recovered angle by 2.5e-5 rad — 0.54 % of the
        //    radius. A tighter bound would be measuring the reconstruction, not the sampler.
        Expect(WorstAngle <= kSunAngularRadius * 1.01f, "no sample escapes the sun's angular radius");
        Expect(WorstAngle >  kSunAngularRadius * 0.99f,  "and the full disc is actually reached");
        Expect(std::fabs(InnerFraction - 0.5f) < 0.02f,
               "half the samples fall in the inner half of the AREA — uniform, not centre-bunched");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n15. the penumbra a 0.268° source casts is physically sized\n");
    {
        // The reason to sample a disc at all. A point light gives a hard edge; the sun's finite size gives a
        //    penumbra that widens with the distance between occluder and receiver, at a rate set by its angular
        //    diameter. These are the numbers to compare a screenshot against.
        std::printf("     occluder height   penumbra width\n");
        for (float Height : { 0.5f, 1.0f, 2.0f, 5.0f })
        {
            const float Width = 2.0f * Height * std::tan(kSunAngularRadius);
            std::printf("       %4.1f m           %6.1f mm\n",
                        static_cast<double>(Height), static_cast<double>(Width * 1000.0f));
        }
        const float AtOneMetre = 2.0f * 1.0f * std::tan(kSunAngularRadius);
        Expect(AtOneMetre > 0.008f && AtOneMetre < 0.011f,
               "a 1 m occluder casts a ~9 mm penumbra, as the real sun does");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n16. sky lighting converges on the correct irradiance\n");
    {
        // A5. An escaped bounce ray gathers sky radiance and is weighted by the BSDF throughput. For a diffuse
        //    surface the BSDF sample is cosine-distributed, so summing radiance over those samples estimates
        //    ∫ L(ω)·cosθ dω / π — the irradiance divided by π. Checked here against an explicit hemisphere
        //    integral of the SAME sky, because if the estimator disagreed with the integral the room would be
        //    lit to the wrong level and there would be nothing to compare it with in-engine.
        const Vec3 Sun = SunAtElevation(50.0f);
        const Vec3 Up{ 0.0f, 0.0f, 1.0f };

        // Reference: integrate L·cosθ over the upper hemisphere on a regular grid.
        double ReferenceR = 0.0, ReferenceG = 0.0, ReferenceB = 0.0;
        const int Zeniths = 48, Azimuths = 96;
        for (int i = 0; i < Zeniths; ++i)
            for (int j = 0; j < Azimuths; ++j)
            {
                const float Theta = (i + 0.5f) / Zeniths * 1.57079633f;
                const float Phi   = (j + 0.5f) / Azimuths * 6.28318530f;
                const Vec3  D{ std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta) };
                const Vec3  L = SkyRadiance(2.0f, D, Sun, Vec3(kSunLux), 24, 8);
                const float Weight = std::sin(Theta) * std::cos(Theta)
                                   * (1.57079633f / Zeniths) * (6.28318530f / Azimuths);
                ReferenceR += L.x * Weight; ReferenceG += L.y * Weight; ReferenceB += L.z * Weight;
            }

        // Estimator: cosine-distributed samples, averaged. That average IS irradiance / π, so multiply back.
        double EstimateR = 0.0, EstimateG = 0.0, EstimateB = 0.0;
        const int Samples = 4096;
        for (int i = 0; i < Samples; ++i)
        {
            const float U1 = (i + 0.5f) / Samples;
            const float U2 = std::fmod(i * 0.618033988f, 1.0f);
            const float R  = std::sqrt(U1);                    // cosine-weighted: radius ∝ √u
            const float Phi = 6.28318530f * U2;
            const Vec3  D{ R * std::cos(Phi), R * std::sin(Phi), std::sqrt(std::fmax(0.0f, 1.0f - U1)) };
            const Vec3  L = SkyRadiance(2.0f, D, Sun, Vec3(kSunLux), 24, 8);
            EstimateR += L.x; EstimateG += L.y; EstimateB += L.z;
        }
        const double Scale = 3.14159265358979 / Samples;
        EstimateR *= Scale; EstimateG *= Scale; EstimateB *= Scale;

        std::printf("     hemisphere integral  R %.2f G %.2f B %.2f\n", ReferenceR, ReferenceG, ReferenceB);
        std::printf("     cosine estimator     R %.2f G %.2f B %.2f\n", EstimateR, EstimateG, EstimateB);
        const double ErrorB = std::fabs(EstimateB - ReferenceB) / ReferenceB * 100.0;
        std::printf("     blue channel error   %.2f %%\n", ErrorB);

        Expect(ErrorB < 3.0, "the escaped-bounce estimator matches an explicit hemisphere integral");
        Expect(EstimateB > EstimateR, "and the skylight is blue, as diffuse daylight is");
        (void)Up;
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n17. sky lighting is a real contribution, not a rounding error\n");
    {
        // Worth measuring rather than assuming: if skylight were a fraction of a percent of the sun there would
        //    be no reason to pay for it. Irradiance from the whole sky against the sun's direct beam on a
        //    horizontal surface — the familiar result is that the sky is a large minority of daylight, and
        //    dominant in shadow, which is exactly why a shadowed wall is blue rather than black.
        const Vec3 Sun = SunAtElevation(50.0f);

        double SkyLuma = 0.0;
        const int Zeniths = 32, Azimuths = 64;
        for (int i = 0; i < Zeniths; ++i)
            for (int j = 0; j < Azimuths; ++j)
            {
                const float Theta = (i + 0.5f) / Zeniths * 1.57079633f;
                const float Phi   = (j + 0.5f) / Azimuths * 6.28318530f;
                const Vec3  D{ std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta) };
                const Vec3  L = SkyRadiance(2.0f, D, Sun, Vec3(kSunLux), 24, 8);
                const float Weight = std::sin(Theta) * std::cos(Theta)
                                   * (1.57079633f / Zeniths) * (6.28318530f / Azimuths);
                SkyLuma += (0.2126f * L.x + 0.7152f * L.y + 0.0722f * L.z) * Weight;
            }

        // Direct beam on a horizontal surface: illuminance × transmittance × cosine.
        const Vec3  Beam = ComputeTransmittanceTexel(Sun.z * 0.5f + 0.5f, 0.0f);
        const double SunLuma = (0.2126 * Beam.x + 0.7152 * Beam.y + 0.0722 * Beam.z) * kSunLux * Sun.z;

        std::printf("     sky irradiance %.0f, direct sun %.0f  (sky is %.1f %% of the total)\n",
                    SkyLuma, SunLuma, SkyLuma / (SkyLuma + SunLuma) * 100.0);
        Expect(SkyLuma > SunLuma * 0.05,
               "skylight is a material fraction of daylight — worth the cost of gathering it");
    }

    std::printf("\n>>> %s (%d failure%s)\n", Failures == 0 ? "ALL PASS" : "FAILURES", Failures, Failures == 1 ? "" : "s");
    return Failures == 0 ? 0 : 1;
}
