//============================================================================================================================================
//                                                    ATMOSPHERESCATTERING.SLANG
//============================================================================================================================================
// 🧩 Analytic single-scattering sky, after Hillaire 2020's atmosphere parameterisation.
//
//    A3 — FIRST LIGHT. This is the ray-miss path: a camera ray that hits nothing used to return pure black, and
//    now returns the radiance of the sky in that direction. The oculus stops being a hole into nothing.
//
//    🔴 Single scattering only, ray-marched per pixel. The LUT chain (transmittance, multi-scattering, sky-view,
//    aerial perspective) is A2 and is NOT here. That ordering is deliberate: this establishes the ray-miss
//    plumbing and the physical parameterisation against something visible, and the LUTs then replace the march
//    with a texture fetch WITHOUT changing the model. If the LUTs had come first there would have been two
//    unverified layers stacked with nothing to compare against.
//
//    What single scattering costs, so nobody mistakes it for a bug later:
//      · a slightly dark sky away from the sun, because light scattered twice never arrives;
//      · a night that is properly black rather than faintly blue;
//      · no earth-shine and no glow on the underside of the horizon.
//    All three are fixed by the multi-scattering LUT in A2, and none of them make the sunset wrong.
//
//    Everything below is in METRES and works at planetary scale in floats. The camera sits at
//    PlanetRadius + CameraAltitude, so a ray from the ground toward the horizon travels ~300 km — which is why
//    every intersection is written in the numerically stable form rather than the textbook one.

#ifndef ATMOSPHERE_SCATTERING_SLANG
#define ATMOSPHERE_SCATTERING_SLANG

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARAMETERISATION
//------------------------------------------------------------------------------------------------------------------------
// Earth's values. These are the same set the previous project used and the same set Hillaire's paper states, so
//    the sky can be checked against published figures rather than against taste.

const float kPlanetRadius        = 6360000.0;    // [m]   to the surface
const float kAtmosphereThickness =  100000.0;    // [m]   above it
const float kAtmosphereRadius    = kPlanetRadius + kAtmosphereThickness;

const float kRayleighScaleHeight = 8000.0;       // [m]   density falls by e over this height
const float kMieScaleHeight      = 1200.0;       // [m]   aerosols hug the ground far more closely

// Rayleigh scattering at sea level, per metre, per channel. The λ⁻⁴ dependence is why the sky is blue and why
//    the sun reddens at a grazing angle: blue is removed from the direct beam first.
const vec3  kRayleighScattering  = vec3(5.802e-6, 13.558e-6, 33.1e-6);

// Mie is wavelength-neutral — aerosols are large compared with visible light — which is why haze is grey/white.
const float kMieScattering       = 3.996e-6;     // [1/m]
const float kMieExtinction       = 4.440e-6;     // [1/m] scattering plus absorption
const float kMieAsymmetry        = 0.80;         // [-]   forward-biased; this is the glow AROUND the sun

// Ozone. It scatters nothing and only absorbs, but it is what keeps a twilight sky blue instead of turning it
//    muddy brown once the direct sunlight has been reddened away.
const vec3  kOzoneAbsorption     = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float kOzoneCentre         = 25000.0;      // [m]   the tent's peak
const float kOzoneWidth          = 15000.0;      // [m]   half-width; density falls to zero this far from centre

const float kSunAngularRadius    = 0.004675;     // [rad] 0.268° — the disc, not a point

//------------------------------------------------------------------------------------------------------------------------
//                                                  DENSITY AND GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

// Densities relative to sea level: x Rayleigh, y Mie, z ozone.
vec3 AtmosphereDensity(float Altitude)
{
    const float Rayleigh = exp(-max(Altitude, 0.0) / kRayleighScaleHeight);
    const float Mie      = exp(-max(Altitude, 0.0) / kMieScaleHeight);
    // A linear tent, as Hillaire uses. Ozone is a layer, not an exponential fall-off, so an exponential here
    //    would put absorption at the ground where there is almost none.
    const float Ozone    = max(0.0, 1.0 - abs(Altitude - kOzoneCentre) / kOzoneWidth);
    return vec3(Rayleigh, Mie, Ozone);
}

// Distance to a sphere of the given radius, or −1 for a miss. Written in the numerically stable form: the
//    textbook (-b ± √d)/2a catastrophically cancels when the ray starts near the surface of a 6360 km sphere,
//    which is the normal case here, and the error shows as a shimmering horizon.
float RaySphereNearest(vec3 Origin, vec3 Direction, float Radius)
{
    const float b = dot(Origin, Direction);
    const float c = dot(Origin, Origin) - Radius * Radius;
    const float Discriminant = b * b - c;
    if (Discriminant < 0.0) return -1.0;
    const float Root = sqrt(Discriminant);
    const float Near = -b - Root;
    const float Far  = -b + Root;
    if (Far < 0.0) return -1.0;              // sphere entirely behind
    return Near >= 0.0 ? Near : Far;         // inside the sphere: the exit is the useful root
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PHASE FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

// Rayleigh: gently forward/backward symmetric. This is the broad brightening of the whole sky.
float RayleighPhase(float CosAngle)
{
    return 3.0 / (16.0 * 3.14159265) * (1.0 + CosAngle * CosAngle);
}

// Cornette–Shanks rather than raw Henyey–Greenstein: it stays finite and correctly shaped at g → 0, and it is
//    what produces the tight bright halo hugging the sun.
float MiePhase(float CosAngle, float g)
{
    const float g2 = g * g;
    const float Numerator   = 3.0 * (1.0 - g2) * (1.0 + CosAngle * CosAngle);
    const float Denominator = 8.0 * 3.14159265 * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * CosAngle, 1.5);
    return Numerator / max(Denominator, 1e-9);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     TRANSMITTANCE
//------------------------------------------------------------------------------------------------------------------------

// Optical depth along a ray, integrated by marching. A2 replaces this with the transmittance LUT — this is the
//    expensive part, and the reason the LUT exists at all.
vec3 OpticalDepth(vec3 Origin, vec3 Direction, float Distance, int Steps)
{
    const float Step = Distance / float(Steps);
    vec3 Sum = vec3(0.0);
    for (int i = 0; i < Steps; ++i)
    {
        const vec3  Position = Origin + Direction * (float(i) + 0.5) * Step;
        const float Altitude = length(Position) - kPlanetRadius;
        const vec3  Density  = AtmosphereDensity(Altitude);
        Sum += (kRayleighScattering * Density.x
              + vec3(kMieExtinction) * Density.y
              + kOzoneAbsorption    * Density.z) * Step;
    }
    return Sum;
}

// Fraction of sunlight surviving from a point to the top of the atmosphere. A point in the planet's shadow gets
//    zero — without that test the ground glows at midnight because the sun is still "visible" through the rock.
vec3 SunTransmittance(vec3 Position, vec3 SunDirection, int Steps)
{
    if (RaySphereNearest(Position, SunDirection, kPlanetRadius) > 0.0) return vec3(0.0);
    const float ToSpace = RaySphereNearest(Position, SunDirection, kAtmosphereRadius);
    if (ToSpace < 0.0) return vec3(1.0);
    return exp(-OpticalDepth(Position, SunDirection, ToSpace, Steps));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       SKY RADIANCE
//------------------------------------------------------------------------------------------------------------------------

// Radiance arriving along ViewDirection from an observer at CameraAltitude above the surface.
//    SunIlluminance is the illuminance of the direct beam outside the atmosphere.
//
//    Quality tiers select the two step counts. The view march dominates the cost — the light march runs inside
//    it — so the tiers spend their budget mostly on the view.
vec3 SkyRadiance(float CameraAltitude, vec3 ViewDirection, vec3 SunDirection,
                 vec3 SunIlluminance, int ViewSteps, int LightSteps)
{
    const vec3 Origin = vec3(0.0, 0.0, kPlanetRadius + max(CameraAltitude, 1.0));

    // How far the ray travels before it leaves the air — or hits the ground, which is nearer and stops it.
    float Distance = RaySphereNearest(Origin, ViewDirection, kAtmosphereRadius);
    if (Distance < 0.0) return vec3(0.0);                       // outside the atmosphere looking away
    const float Ground = RaySphereNearest(Origin, ViewDirection, kPlanetRadius);
    if (Ground > 0.0) Distance = min(Distance, Ground);

    const float CosTheta      = dot(ViewDirection, SunDirection);
    const float PhaseRayleigh = RayleighPhase(CosTheta);
    const float PhaseMie      = MiePhase(CosTheta, kMieAsymmetry);

    const float Step = Distance / float(ViewSteps);
    vec3 Radiance     = vec3(0.0);
    vec3 Transmittance = vec3(1.0);   // camera → current sample, carried forward rather than re-integrated

    for (int i = 0; i < ViewSteps; ++i)
    {
        const vec3  Position = Origin + ViewDirection * (float(i) + 0.5) * Step;
        const float Altitude = length(Position) - kPlanetRadius;
        const vec3  Density  = AtmosphereDensity(Altitude);

        const vec3 Extinction = kRayleighScattering * Density.x
                              + vec3(kMieExtinction) * Density.y
                              + kOzoneAbsorption    * Density.z;
        const vec3 StepTransmittance = exp(-Extinction * Step);

        const vec3 ScatteringHere = kRayleighScattering * Density.x * PhaseRayleigh
                                  + vec3(kMieScattering) * Density.y * PhaseMie;

        const vec3 SunArriving = SunTransmittance(Position, SunDirection, LightSteps);

        // Analytic integration of the scattering across the step rather than a midpoint sample. With few steps
        //    the midpoint form visibly banks the horizon into bands; this costs one extra divide and removes them.
        const vec3 Integrated = (ScatteringHere - ScatteringHere * StepTransmittance) / max(Extinction, vec3(1e-9));

        Radiance      += Transmittance * SunArriving * Integrated * SunIlluminance;
        Transmittance *= StepTransmittance;
    }

    return Radiance;
}

// The solar disc itself, for a ray that looks straight at it. Limb darkening is deliberately omitted: at 0.268°
//    it is well under a pixel of variation, and the disc is almost always clipped by exposure anyway.
vec3 SunDisc(float CameraAltitude, vec3 ViewDirection, vec3 SunDirection, vec3 SunIlluminance, int LightSteps)
{
    const float CosAngle = dot(ViewDirection, SunDirection);
    if (CosAngle < cos(kSunAngularRadius)) return vec3(0.0);

    const vec3 Origin = vec3(0.0, 0.0, kPlanetRadius + max(CameraAltitude, 1.0));
    // Divided by the solid angle so this is a RADIANCE, matching the sky it is added to. Adding an illuminance
    //    directly would make the disc's brightness depend on the render resolution.
    const float SolidAngle = 6.28318530 * (1.0 - cos(kSunAngularRadius));
    return SunTransmittance(Origin, SunDirection, LightSteps) * SunIlluminance / SolidAngle;
}

#endif // ATMOSPHERE_SCATTERING_SLANG
