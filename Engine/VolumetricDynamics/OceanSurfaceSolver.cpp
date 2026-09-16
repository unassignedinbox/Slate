//============================================================================================================================================
// Frontier/VolumetricDynamics/OceanSurfaceSolver.cpp — Explicit crest trains, compact wave packets, and particle breaking
//============================================================================================================================================

#include "OceanSurfaceSolver.h"

#include <cmath>
#include <chrono>
#include <limits>

namespace Frontier {
namespace {

constexpr float kTau = 6.28318530717958647692f;
constexpr float kHalfPi = 1.57079632679489661923f;
constexpr uint32_t kImpulseLimit = 32u;

[[nodiscard]] float Dot2(const OceanVector2& A, const OceanVector2& B) noexcept
{
    return A.x * B.x + A.y * B.y;
}

[[nodiscard]] float Dot3(const OceanVector3& A, const OceanVector3& B) noexcept
{
    return A.x * B.x + A.y * B.y + A.z * B.z;
}

[[nodiscard]] float Length2(const OceanVector2& A) noexcept
{
    return std::sqrt(Dot2(A, A));
}

[[nodiscard]] float Length3(const OceanVector3& A) noexcept
{
    return std::sqrt(Dot3(A, A));
}

[[nodiscard]] OceanVector2 Normalize2(const OceanVector2& A) noexcept
{
    const float Length = Length2(A);
    return Length > 1.0e-6f ? OceanVector2{ A.x / Length, A.y / Length } : OceanVector2{ 1.0f, 0.0f };
}

[[nodiscard]] OceanVector3 Normalize3(const OceanVector3& A) noexcept
{
    const float Length = Length3(A);
    return Length > 1.0e-6f ? A / Length : OceanVector3{ 0.0f, 0.0f, 1.0f };
}

[[nodiscard]] OceanVector2 Perpendicular(const OceanVector2& A) noexcept
{
    return OceanVector2{ -A.y, A.x };
}

[[nodiscard]] float Saturate(float X) noexcept
{
    return std::clamp(X, 0.0f, 1.0f);
}

[[nodiscard]] float SmoothStep(float X) noexcept
{
    X = Saturate(X);
    return X * X * (3.0f - 2.0f * X);
}

} // namespace

OceanSurfaceConfiguration OceanSurfaceSolver::ConstructGTXConfiguration() noexcept
{
    OceanSurfaceConfiguration Configuration;
    Configuration.MeanLevel = 0.0f;
    Configuration.WindDirection = OceanVector2{ 0.93f, 0.37f };
    Configuration.WindSpeed = 18.0f;
    Configuration.Gravity = 9.80665f;
    Configuration.WaterDensity = 1025.0f;
    Configuration.MaximumParticleCount = 32768u;
    Configuration.CrestTrainCount = 9u;
    Configuration.FixedStep = 1.0f / 60.0f;
    Configuration.MaximumCatchupSteps = 4u;
    Configuration.InterestRadius = 140.0f;
    Configuration.BreakingSteepness = 0.78f;
    Configuration.FoamLifetime = 4.0f;
    Configuration.SprayLifetime = 1.65f;
    Configuration.RandomSeed = 0x6E624EB7u;
    return Configuration;
}

OceanSurfaceSolver::OceanSurfaceSolver() noexcept
    : OceanSurfaceSolver(ConstructGTXConfiguration())
{
}

OceanSurfaceSolver::OceanSurfaceSolver(const OceanSurfaceConfiguration& InitialConfiguration) noexcept
    : Configuration(InitialConfiguration)
    , WaveTrains()
    , Particles()
    , Impulses()
    , Telemetry()
    , InterestOrigin()
    , SimulationTime(0.0f)
    , RemainderSeconds(0.0f)
    , ActiveParticleCount(0u)
    , RandomCursor(InitialConfiguration.RandomSeed)
{
    Configuration.MaximumParticleCount = std::clamp(Configuration.MaximumParticleCount, 1024u, 65536u);
    Configuration.CrestTrainCount = std::clamp(Configuration.CrestTrainCount, 1u, 9u);
    Configuration.FixedStep = std::clamp(Configuration.FixedStep, 1.0f / 240.0f, 1.0f / 20.0f);
    Configuration.MaximumCatchupSteps = std::clamp(Configuration.MaximumCatchupSteps, 1u, 8u);
    Configuration.InterestRadius = std::clamp(Configuration.InterestRadius, 24.0f, 240.0f);
    Configuration.BreakingSteepness = std::clamp(Configuration.BreakingSteepness, 0.35f, 0.98f);
    Configuration.FoamLifetime = std::clamp(Configuration.FoamLifetime, 0.25f, 12.0f);
    Configuration.SprayLifetime = std::clamp(Configuration.SprayLifetime, 0.15f, 6.0f);
    Configuration.WindDirection = NormalizedDirection(Configuration.WindDirection);

    WaveTrains.reserve(9u);
    Particles.resize(Configuration.MaximumParticleCount);
    Impulses.reserve(kImpulseLimit);
    ConstructWaveTrains();
    Reset();
}

void OceanSurfaceSolver::Reset() noexcept
{
    SimulationTime = 0.0f;
    RemainderSeconds = 0.0f;
    ActiveParticleCount = 0u;
    Impulses.clear();
    Telemetry = OceanSurfaceTelemetry{};
    RandomCursor = Configuration.RandomSeed;
}

void OceanSurfaceSolver::AssignInterestOrigin(const OceanVector3& Location) noexcept
{
    InterestOrigin = Location;
}

void OceanSurfaceSolver::AssignInterestRadius(float RadiusMeters) noexcept
{
    Configuration.InterestRadius = std::clamp(RadiusMeters, 24.0f, 240.0f);
}

OceanVector2 OceanSurfaceSolver::NormalizedDirection(const OceanVector2& Direction) const noexcept
{
    return Normalize2(Direction);
}

void OceanSurfaceSolver::ConstructWaveTrains() noexcept
{
    WaveTrains.clear();
    const OceanVector2 Wind = Configuration.WindDirection;
    const float WindAngle = std::atan2(Wind.y, Wind.x);
    const float WindFactor = std::clamp(Configuration.WindSpeed / 18.0f, 0.55f, 1.8f);

    for (uint32_t Index = 0u; Index < 9u; ++Index)
    {
        const float I = static_cast<float>(Index);
        const float Wavelength = 118.0f / std::pow(1.48f, I);
        const float Amplitude = 3.45f * std::pow(Wavelength / 118.0f, 0.72f) * (0.90f + 0.10f * WindFactor);
        const float HeadingOffset = (static_cast<float>(static_cast<int>(Index % 3u)) - 1.0f) * 0.16f
                                  + 0.18f * std::sin(I * 2.173f + 0.7f);
        const float Heading = WindAngle + HeadingOffset;
        const float WaveNumber = kTau / Wavelength;
        const float PhaseSpeed = std::sqrt(std::max(0.01f, Configuration.Gravity / WaveNumber)) * (0.82f + 0.08f * WindFactor);
        OceanWaveTrain Train;
        Train.Direction = OceanVector2{ std::cos(Heading), std::sin(Heading) };
        Train.Wavelength = Wavelength;
        Train.Amplitude = Amplitude;
        Train.Steepness = std::clamp(0.34f + 0.073f * I + 0.025f * std::sin(I * 1.91f), 0.30f, 0.94f);
        Train.Phase = kTau * NextRandom();
        Train.PhaseSpeed = PhaseSpeed;
        WaveTrains.push_back(Train);
    }
}

void OceanSurfaceSolver::Advance(float ElapsedSeconds) noexcept
{
    if (!(ElapsedSeconds > 0.0f)) return;

    const auto Begin = std::chrono::steady_clock::now();
    const float ClampedElapsed = std::min(ElapsedSeconds, 0.20f);
    RemainderSeconds += ClampedElapsed;
    uint32_t StepCount = 0u;
    while (RemainderSeconds >= Configuration.FixedStep && StepCount < Configuration.MaximumCatchupSteps)
    {
        AdvanceFixedStep(Configuration.FixedStep);
        RemainderSeconds -= Configuration.FixedStep;
        ++StepCount;
    }
    if (StepCount == Configuration.MaximumCatchupSteps && RemainderSeconds >= Configuration.FixedStep)
    {
        RemainderSeconds = std::fmod(RemainderSeconds, Configuration.FixedStep);
    }

    Telemetry.ActiveParticleCount = ActiveParticleCount;
    Telemetry.FixedStepCount += StepCount;
    Telemetry.ImpulseCount = static_cast<uint32_t>(Impulses.size());
    Telemetry.SimulatedSeconds = SimulationTime;
    const auto End = std::chrono::steady_clock::now();
    Telemetry.LastAdvanceMilliseconds = std::chrono::duration<float, std::milli>(End - Begin).count();
}

void OceanSurfaceSolver::AdvanceFixedStep(float Δτ) noexcept
{
    SimulationTime += Δτ;
    UpdateImpulses();
    UpdateParticles(Δτ);
    EmitBreakingParticles();
}

void OceanSurfaceSolver::UpdateImpulses() noexcept
{
    uint32_t Index = 0u;
    while (Index < Impulses.size())
    {
        const OceanImpulseRecord& Impulse = Impulses[Index];
        if (SimulationTime - Impulse.BirthTime <= Impulse.Lifetime)
        {
            ++Index;
            continue;
        }
        Impulses[Index] = Impulses.back();
        Impulses.pop_back();
    }
}

OceanSurfaceSample OceanSurfaceSolver::SampleSurface(float X, float Y) const noexcept
{
    return SampleSurface(X, Y, SimulationTime);
}

OceanSurfaceSample OceanSurfaceSolver::SampleSurface(float X, float Y, float TimeSeconds) const noexcept
{
    OceanSurfaceSample Result;
    Result.Position = OceanVector3{ X, Y, Configuration.MeanLevel };

    float Height = 0.0f;
    float SlopeX = 0.0f;
    float SlopeY = 0.0f;
    float HorizontalVelocityX = 0.0f;
    float HorizontalVelocityY = 0.0f;
    float VerticalVelocity = 0.0f;
    float CrestCompression = 0.0f;

    const OceanVector2 Point{ X, Y };
    const uint32_t WaveCount = std::min(Configuration.CrestTrainCount, static_cast<uint32_t>(WaveTrains.size()));
    for (uint32_t Index = 0u; Index < WaveCount; ++Index)
    {
        const OceanWaveTrain& Wave = WaveTrains[Index];
        const float WaveNumber = kTau / std::max(0.5f, Wave.Wavelength);
        const float Phase = WaveNumber * (Dot2(Wave.Direction, Point) - Wave.PhaseSpeed * TimeSeconds) + Wave.Phase;
        const float Sine = std::sin(Phase);
        const float Cosine = std::cos(Phase);
        const float ShapedSine = Sine + 0.12f * Sine * std::abs(Sine);
        const float ShapedDerivative = 1.0f + 0.24f * std::abs(Sine);
        const float AngularSpeed = WaveNumber * Wave.PhaseSpeed;

        Height += Wave.Amplitude * ShapedSine;
        SlopeX += Wave.Amplitude * ShapedDerivative * WaveNumber * Cosine * Wave.Direction.x;
        SlopeY += Wave.Amplitude * ShapedDerivative * WaveNumber * Cosine * Wave.Direction.y;
        HorizontalVelocityX += Wave.Direction.x * Wave.Steepness * Wave.Amplitude * AngularSpeed * Sine;
        HorizontalVelocityY += Wave.Direction.y * Wave.Steepness * Wave.Amplitude * AngularSpeed * Sine;
        VerticalVelocity += -Wave.Amplitude * ShapedDerivative * AngularSpeed * Cosine;

        const float LocalCompression = Wave.Steepness * std::abs(Sine)
                                     + 0.35f * Wave.Amplitude * WaveNumber * std::abs(Cosine);
        CrestCompression = std::max(CrestCompression, LocalCompression);
    }

    for (const OceanImpulseRecord& Impulse : Impulses)
    {
        const float Age = TimeSeconds - Impulse.BirthTime;
        if (Age < 0.0f || Age > Impulse.Lifetime) continue;

        const OceanVector2 Offset{ X - Impulse.Origin.x, Y - Impulse.Origin.y };
        const float Distance = std::max(0.001f, Length2(Offset));
        const OceanVector2 Radial = Offset / Distance;
        const float WaveNumber = kTau / std::max(0.75f, Impulse.Wavelength);
        const float Envelope = std::exp(-Distance / std::max(0.25f, Impulse.Radius))
                             * std::exp(-Age / std::max(0.25f, Impulse.Lifetime) * 0.55f);
        const float DirectionalWeight = 0.72f + 0.28f * std::max(0.0f, Dot2(Radial, Impulse.Direction));
        const float Phase = WaveNumber * (Distance - Impulse.TravelSpeed * Age);
        const float Sine = std::sin(Phase);
        const float Cosine = std::cos(Phase);
        const float WeightedEnergy = Impulse.Energy * Envelope * DirectionalWeight;
        const float EnvelopeDerivative = -Envelope / std::max(0.25f, Impulse.Radius);
        const float RadialHeightDerivative = Impulse.Energy * DirectionalWeight
                                            * (EnvelopeDerivative * Sine + Envelope * WaveNumber * Cosine);

        Height += WeightedEnergy * Sine;
        SlopeX += Radial.x * RadialHeightDerivative;
        SlopeY += Radial.y * RadialHeightDerivative;
        HorizontalVelocityX += Radial.x * WeightedEnergy * Impulse.TravelSpeed * WaveNumber * Cosine * 0.32f;
        HorizontalVelocityY += Radial.y * WeightedEnergy * Impulse.TravelSpeed * WaveNumber * Cosine * 0.32f;
        VerticalVelocity += -WeightedEnergy * Impulse.TravelSpeed * WaveNumber * Cosine;
        CrestCompression = std::max(CrestCompression, std::abs(Impulse.Energy) * Envelope / std::max(0.5f, Impulse.Radius) * 2.0f);
    }

    Result.Height = Configuration.MeanLevel + Height;
    Result.Position.z = Result.Height;
    Result.Normal = Normalize3(OceanVector3{ -SlopeX, -SlopeY, 1.0f });
    Result.Velocity = OceanVector3{ HorizontalVelocityX, HorizontalVelocityY, VerticalVelocity };
    Result.CrestCompression = CrestCompression;
    Result.BreakingPotential = Saturate(CrestCompression / std::max(0.01f, Configuration.BreakingSteepness));
    return Result;
}

void OceanSurfaceSolver::WriteParticleDrawRecords(OceanParticleDrawRecord* Destination, uint32_t Capacity) const noexcept
{
    if (Destination == nullptr || Capacity == 0u) return;
    const uint32_t Count = std::min(ActiveParticleCount, Capacity);
    for (uint32_t Index = 0u; Index < Count; ++Index)
    {
        const OceanParticleRecord& Particle = Particles[Index];
        Destination[Index].Position = Particle.Position;
        Destination[Index].Radius = Particle.Radius;
        Destination[Index].Tint = Particle.Tint;
        Destination[Index].Alpha = Particle.Alpha;
    }
}

void OceanSurfaceSolver::InjectImpact(const OceanVector3& Location, const OceanVector3& RelativeVelocity, float RadiusMeters) noexcept
{
    const float HorizontalSpeed = std::sqrt(RelativeVelocity.x * RelativeVelocity.x + RelativeVelocity.y * RelativeVelocity.y);
    const float TotalSpeed = Length3(RelativeVelocity);
    const float Radius = std::clamp(RadiusMeters, 0.25f, 16.0f);
    const OceanVector2 Direction = Normalize2(OceanVector2{ RelativeVelocity.x, RelativeVelocity.y });
    OceanImpulseRecord Impulse;
    Impulse.Origin = Location;
    Impulse.Direction = Direction;
    Impulse.Energy = std::clamp(0.08f * TotalSpeed + 0.018f * HorizontalSpeed * Radius, 0.08f, 2.8f);
    Impulse.Wavelength = std::clamp(Radius * 2.4f, 1.5f, 24.0f);
    Impulse.TravelSpeed = std::sqrt(Configuration.Gravity * Impulse.Wavelength / kTau);
    Impulse.Radius = std::clamp(Radius * 2.6f, 2.0f, 42.0f);
    Impulse.BirthTime = SimulationTime;
    Impulse.Lifetime = std::clamp(3.5f + Radius * 0.12f, 3.5f, 9.0f);
    PushImpulse(Impulse);

    const OceanSurfaceSample Surface = SampleSurface(Location.x, Location.y);
    const uint32_t FoamCount = std::min(18u, 2u + static_cast<uint32_t>(TotalSpeed * 0.55f));
    for (uint32_t Index = 0u; Index < FoamCount; ++Index) SpawnParticle(Surface, OceanParticleKind::SurfaceFoam, Impulse.Energy);
    const uint32_t SprayCount = std::min(24u, static_cast<uint32_t>(TotalSpeed * 0.70f));
    for (uint32_t Index = 0u; Index < SprayCount; ++Index) SpawnParticle(Surface, OceanParticleKind::AirborneSpray, Impulse.Energy);
}

void OceanSurfaceSolver::InjectWake(const OceanVector3& Location, const OceanVector3& Heading, float SpeedMetersPerSecond,
                                    float LengthMeters, float BeamMeters) noexcept
{
    const OceanVector2 Direction = Normalize2(OceanVector2{ Heading.x, Heading.y });
    const OceanVector2 Side = Perpendicular(Direction);
    const float Speed = std::clamp(SpeedMetersPerSecond, 0.0f, 80.0f);
    const float Length = std::clamp(LengthMeters, 4.0f, 180.0f);
    const float Beam = std::clamp(BeamMeters, 1.0f, 32.0f);

    for (uint32_t Branch = 0u; Branch < 3u; ++Branch)
    {
        const float BranchRatio = static_cast<float>(Branch) - 1.0f;
        OceanImpulseRecord Impulse;
        Impulse.Origin = Location + OceanVector3{ -Direction.x * Length * (0.10f + 0.17f * static_cast<float>(Branch)),
                                                  -Direction.y * Length * (0.10f + 0.17f * static_cast<float>(Branch)), 0.0f }
                       + OceanVector3{ Side.x * BranchRatio * Beam * 0.43f, Side.y * BranchRatio * Beam * 0.43f, 0.0f };
        Impulse.Direction = Direction;
        Impulse.Energy = std::clamp(0.08f + Speed * 0.018f, 0.08f, 1.8f) * (Branch == 1u ? 1.0f : 0.72f);
        Impulse.Wavelength = std::clamp(Beam * (1.1f + 0.25f * static_cast<float>(Branch)), 2.0f, 36.0f);
        Impulse.TravelSpeed = std::sqrt(Configuration.Gravity * Impulse.Wavelength / kTau);
        Impulse.Radius = std::clamp(Length * 0.36f, 5.0f, 58.0f);
        Impulse.BirthTime = SimulationTime;
        Impulse.Lifetime = std::clamp(3.0f + Length / 48.0f, 3.0f, 9.0f);
        PushImpulse(Impulse);
    }
}

void OceanSurfaceSolver::PushImpulse(const OceanImpulseRecord& Impulse) noexcept
{
    if (Impulses.size() < kImpulseLimit)
    {
        Impulses.push_back(Impulse);
        return;
    }

    uint32_t Weakest = 0u;
    for (uint32_t Index = 1u; Index < Impulses.size(); ++Index)
    {
        if (Impulses[Index].Energy < Impulses[Weakest].Energy) Weakest = Index;
    }
    if (Impulse.Energy > Impulses[Weakest].Energy) Impulses[Weakest] = Impulse;
}

void OceanSurfaceSolver::UpdateParticles(float Δτ) noexcept
{
    uint32_t Index = 0u;
    while (Index < ActiveParticleCount)
    {
        OceanParticleRecord& Particle = Particles[Index];
        Particle.Age += Δτ;
        bool Remove = Particle.Age >= Particle.Lifetime;

        if (!Remove && Particle.Kind == OceanParticleKind::AirborneSpray)
        {
            Particle.Velocity.z -= Configuration.Gravity * Δτ;
            Particle.Velocity = Particle.Velocity * std::exp(-1.35f * Δτ);
            Particle.Position += Particle.Velocity * Δτ;
            const OceanSurfaceSample Surface = SampleSurface(Particle.Position.x, Particle.Position.y);
            if (Particle.Position.z <= Surface.Height + 0.025f)
            {
                if (NextRandom() > 0.42f)
                {
                    Particle.Kind = OceanParticleKind::SurfaceFoam;
                    Particle.Position.z = Surface.Height + 0.018f;
                    Particle.Velocity = Surface.Velocity * 0.35f;
                    Particle.Lifetime = Configuration.FoamLifetime * (0.55f + 0.45f * NextRandom());
                    Particle.Age = 0.0f;
                    Particle.Radius *= 1.45f;
                }
                else
                {
                    Remove = true;
                }
            }
        }
        else if (!Remove)
        {
            const OceanSurfaceSample Surface = SampleSurface(Particle.Position.x, Particle.Position.y);
            const OceanVector3 AdvectedVelocity = Surface.Velocity * 0.58f + Particle.Velocity * 0.42f;
            Particle.Position.x += AdvectedVelocity.x * Δτ;
            Particle.Position.y += AdvectedVelocity.y * Δτ;
            const OceanSurfaceSample FollowSurface = SampleSurface(Particle.Position.x, Particle.Position.y);
            Particle.Position.z = FollowSurface.Height + 0.016f + Particle.Radius * 0.25f;
            Particle.Velocity = Particle.Velocity * std::exp(-0.95f * Δτ) + FollowSurface.Velocity * (1.0f - std::exp(-0.95f * Δτ));

            const float LifetimeRatio = Particle.Age / std::max(0.01f, Particle.Lifetime);
            const float FadeIn = SmoothStep(Particle.Age * 8.0f);
            const float FadeOut = 1.0f - SmoothStep((LifetimeRatio - 0.56f) / 0.44f);
            Particle.Alpha = Saturate(FadeIn * FadeOut);
        }

        const OceanVector2 Offset{ Particle.Position.x - InterestOrigin.x, Particle.Position.y - InterestOrigin.y };
        if (Dot2(Offset, Offset) > Configuration.InterestRadius * Configuration.InterestRadius * 2.25f) Remove = true;
        if (Remove)
        {
            RemoveParticle(Index);
            continue;
        }
        ++Index;
    }
}

void OceanSurfaceSolver::EmitBreakingParticles() noexcept
{
    const uint32_t WaveCount = std::min(Configuration.CrestTrainCount, static_cast<uint32_t>(WaveTrains.size()));
    for (uint32_t WaveIndex = 0u; WaveIndex < WaveCount; ++WaveIndex)
    {
        const OceanWaveTrain& Wave = WaveTrains[WaveIndex];
        if (Wave.Steepness < Configuration.BreakingSteepness * 0.88f) continue;

        const OceanVector2 Side = Perpendicular(Wave.Direction);
        const float WaveNumber = kTau / std::max(0.5f, Wave.Wavelength);
        const float CrestLongitudinal = Wave.PhaseSpeed * SimulationTime + (kHalfPi - Wave.Phase) / WaveNumber;
        const float InterestLongitudinal = Dot2(OceanVector2{ InterestOrigin.x, InterestOrigin.y }, Wave.Direction);
        const int32_t NearestTile = static_cast<int32_t>(std::round((InterestLongitudinal - CrestLongitudinal) / Wave.Wavelength));

        for (int32_t Tile = -1; Tile <= 1; ++Tile)
        {
            const float Longitudinal = CrestLongitudinal + static_cast<float>(NearestTile + Tile) * Wave.Wavelength;
            for (int32_t Lane = -1; Lane <= 1; ++Lane)
            {
                const float Lateral = static_cast<float>(Lane) * std::max(2.5f, Wave.Wavelength * 0.075f);
                const OceanVector3 Candidate{
                    Wave.Direction.x * Longitudinal + Side.x * Lateral,
                    Wave.Direction.y * Longitudinal + Side.y * Lateral,
                    Configuration.MeanLevel
                };
                const OceanVector2 InterestOffset{ Candidate.x - InterestOrigin.x, Candidate.y - InterestOrigin.y };
                if (Dot2(InterestOffset, InterestOffset) > Configuration.InterestRadius * Configuration.InterestRadius) continue;

                const OceanSurfaceSample Surface = SampleSurface(Candidate.x, Candidate.y);
                const float Potential = std::max(Surface.BreakingPotential, Wave.Steepness / Configuration.BreakingSteepness);
                if (Potential < 0.90f) continue;

                SpawnParticle(Surface, OceanParticleKind::SurfaceFoam, Potential);
                if (Potential > 1.04f) SpawnParticle(Surface, OceanParticleKind::SurfaceFoam, Potential);
                if (Potential > 1.10f && NextRandom() > 0.32f) SpawnParticle(Surface, OceanParticleKind::AirborneSpray, Potential);
            }
        }
    }
}

void OceanSurfaceSolver::SpawnParticle(const OceanSurfaceSample& Surface, OceanParticleKind Kind, float Energy) noexcept
{
    if (ActiveParticleCount >= Particles.size())
    {
        ++Telemetry.DroppedParticleCount;
        return;
    }

    OceanParticleRecord& Particle = Particles[ActiveParticleCount++];
    const float NormalizedEnergy = Saturate(Energy / 1.65f);
    const float Jitter = (Kind == OceanParticleKind::SurfaceFoam ? 0.34f : 0.12f) * (0.35f + NormalizedEnergy);
    Particle.Position = Surface.Position + OceanVector3{ RandomSigned() * Jitter, RandomSigned() * Jitter, 0.0f };
    Particle.Velocity = Surface.Velocity;
    Particle.Age = 0.0f;
    Particle.Kind = Kind;
    if (Kind == OceanParticleKind::SurfaceFoam)
    {
        Particle.Radius = 0.035f + 0.065f * NextRandom() + 0.022f * NormalizedEnergy;
        Particle.Lifetime = Configuration.FoamLifetime * (0.55f + 0.45f * NextRandom());
        Particle.Tint = OceanVector3{ 0.78f + 0.20f * NextRandom(), 0.88f + 0.11f * NextRandom(), 0.94f + 0.06f * NextRandom() };
        Particle.Position.z = Surface.Height + 0.02f;
        Particle.Alpha = 0.0f;
    }
    else
    {
        Particle.Radius = 0.018f + 0.05f * NextRandom() + 0.025f * NormalizedEnergy;
        Particle.Lifetime = Configuration.SprayLifetime * (0.60f + 0.40f * NextRandom());
        Particle.Tint = OceanVector3{ 0.72f + 0.22f * NextRandom(), 0.85f + 0.14f * NextRandom(), 0.94f + 0.06f * NextRandom() };
        Particle.Position.z = Surface.Height + 0.08f + 0.65f * NormalizedEnergy * NextRandom();
        Particle.Velocity.z = 1.0f + 3.8f * NormalizedEnergy * (0.45f + 0.55f * NextRandom());
        Particle.Velocity.x += RandomSigned() * (0.5f + 1.5f * NormalizedEnergy);
        Particle.Velocity.y += RandomSigned() * (0.5f + 1.5f * NormalizedEnergy);
        Particle.Alpha = 1.0f;
    }
    ++Telemetry.SpawnedParticleCount;
}

void OceanSurfaceSolver::RemoveParticle(uint32_t Index) noexcept
{
    if (Index >= ActiveParticleCount) return;
    --ActiveParticleCount;
    if (Index != ActiveParticleCount) Particles[Index] = Particles[ActiveParticleCount];
}

float OceanSurfaceSolver::NextRandom() noexcept
{
    uint32_t X = RandomCursor == 0u ? 0xA341316Cu : RandomCursor;
    X ^= X << 13u;
    X ^= X >> 17u;
    X ^= X << 5u;
    RandomCursor = X;
    return static_cast<float>(X & 0x00FFFFFFu) / 16777216.0f;
}

float OceanSurfaceSolver::RandomSigned() noexcept
{
    return NextRandom() * 2.0f - 1.0f;
}

} // namespace Frontier
