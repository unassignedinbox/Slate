//============================================================================================================================================
// Frontier/VolumetricDynamics/OceanSurfaceSolver.h — Non-spectral ocean surface, breaking particles, and GTX-safe runtime contract
//============================================================================================================================================

#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

namespace Frontier {

struct OceanVector2
{
    float x = 0.0f;
    float y = 0.0f;

    OceanVector2 operator+(const OceanVector2& Other) const noexcept { return { x + Other.x, y + Other.y }; }
    OceanVector2 operator-(const OceanVector2& Other) const noexcept { return { x - Other.x, y - Other.y }; }
    OceanVector2 operator*(float Scale) const noexcept { return { x * Scale, y * Scale }; }
    OceanVector2 operator/(float Scale) const noexcept { return Scale != 0.0f ? OceanVector2{ x / Scale, y / Scale } : OceanVector2{}; }
};

struct OceanVector3
{
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    OceanVector3 operator+(const OceanVector3& Other) const noexcept { return { x + Other.x, y + Other.y, z + Other.z }; }
    OceanVector3 operator-(const OceanVector3& Other) const noexcept { return { x - Other.x, y - Other.y, z - Other.z }; }
    OceanVector3 operator*(float Scale) const noexcept { return { x * Scale, y * Scale, z * Scale }; }
    OceanVector3 operator/(float Scale) const noexcept { return Scale != 0.0f ? OceanVector3{ x / Scale, y / Scale, z / Scale } : OceanVector3{}; }
    OceanVector3& operator+=(const OceanVector3& Other) noexcept { x += Other.x; y += Other.y; z += Other.z; return *this; }
};

enum class OceanParticleKind : uint32_t
{
    SurfaceFoam = 0u,
    AirborneSpray = 1u
};

struct OceanWaveTrain
{
    OceanVector2 Direction;                // [-] unit travel direction on the horizontal plane
    float Wavelength = 32.0f;              // [m] crest spacing
    float Amplitude = 0.5f;                // [m] vertical amplitude
    float Steepness = 0.35f;               // [-] horizontal orbit compression
    float Phase = 0.0f;                    // [rad] deterministic phase offset
    float PhaseSpeed = 10.0f;              // [m/s] deep-water group speed approximation
};

struct OceanSurfaceConfiguration
{
    float MeanLevel = 0.0f;                // [m] still-water datum
    OceanVector2 WindDirection{ 1.0f, 0.0f };
    float WindSpeed = 16.0f;               // [m/s]
    float Gravity = 9.80665f;              // [m/s²]
    float WaterDensity = 1025.0f;          // [kg/m³]
    uint32_t MaximumParticleCount = 32768u;
    uint32_t CrestTrainCount = 9u;
    float FixedStep = 1.0f / 60.0f;        // [s] deterministic simulation quantum
    uint32_t MaximumCatchupSteps = 4u;
    float InterestRadius = 140.0f;         // [m] particle and interaction budget around the viewer
    float BreakingSteepness = 0.78f;       // [-] crest compression threshold
    float FoamLifetime = 4.0f;             // [s]
    float SprayLifetime = 1.65f;           // [s]
    uint32_t RandomSeed = 0x6E624EB7u;
};

struct OceanSurfaceSample
{
    OceanVector3 Position;                 // [m] queried point on the displaced surface
    OceanVector3 Normal{ 0.0f, 0.0f, 1.0f };
    OceanVector3 Velocity;                 // [m/s] Lagrangian surface velocity
    float Height = 0.0f;                   // [m] Position.z, repeated for cheap gameplay queries
    float CrestCompression = 0.0f;         // [-] local steepness diagnostic
    float BreakingPotential = 0.0f;        // [-] particle emission driver, not a material mask
};

struct OceanParticleRecord
{
    OceanVector3 Position;                 // [m]
    OceanVector3 Velocity;                 // [m/s]
    OceanVector3 Tint{ 1.0f, 1.0f, 1.0f };
    float Radius = 0.04f;                  // [m]
    float Age = 0.0f;                      // [s]
    float Lifetime = 1.0f;                 // [s]
    float Alpha = 1.0f;                    // [-] authored by the simulation for the renderer
    OceanParticleKind Kind = OceanParticleKind::SurfaceFoam;
};

struct OceanParticleDrawRecord
{
    OceanVector3 Position;                 // [m]
    float Radius = 0.0f;                   // [m]
    OceanVector3 Tint;                     // [-] linear colour
    float Alpha = 0.0f;                    // [-]
};

static_assert(sizeof(OceanParticleDrawRecord) == 32u, "OceanParticleDrawRecord must mirror the particle draw shader");

struct OceanSurfaceTelemetry
{
    uint32_t ActiveParticleCount = 0u;
    uint32_t SpawnedParticleCount = 0u;
    uint32_t DroppedParticleCount = 0u;
    uint32_t FixedStepCount = 0u;
    uint32_t ImpulseCount = 0u;
    float SimulatedSeconds = 0.0f;
    float LastAdvanceMilliseconds = 0.0f;
};

class OceanSurfaceSolver
{
public:
    OceanSurfaceSolver() noexcept;
    explicit OceanSurfaceSolver(const OceanSurfaceConfiguration& InitialConfiguration) noexcept;
    ~OceanSurfaceSolver() noexcept = default;

    OceanSurfaceSolver(const OceanSurfaceSolver&) = delete;
    OceanSurfaceSolver& operator=(const OceanSurfaceSolver&) = delete;

    static OceanSurfaceConfiguration ConstructGTXConfiguration() noexcept;

    void Reset() noexcept;
    void Advance(float ElapsedSeconds) noexcept;
    void AssignInterestOrigin(const OceanVector3& Location) noexcept;
    void AssignInterestRadius(float RadiusMeters) noexcept;

    [[nodiscard]] OceanSurfaceSample SampleSurface(float X, float Y) const noexcept;
    [[nodiscard]] OceanSurfaceSample SampleSurface(float X, float Y, float TimeSeconds) const noexcept;

    // These are gameplay-facing disturbances. They create finite wave packets and particle births; no texture painting is used.
    void InjectImpact(const OceanVector3& Location, const OceanVector3& RelativeVelocity, float RadiusMeters) noexcept;
    void InjectWake(const OceanVector3& Location, const OceanVector3& Heading, float SpeedMetersPerSecond,
                    float LengthMeters, float BeamMeters) noexcept;

    [[nodiscard]] const std::vector<OceanParticleRecord>& QueryParticles() const noexcept { return Particles; }
    [[nodiscard]] uint32_t QueryParticleCount() const noexcept { return ActiveParticleCount; }
    void WriteParticleDrawRecords(OceanParticleDrawRecord* Destination, uint32_t Capacity) const noexcept;
    [[nodiscard]] const std::vector<OceanWaveTrain>& QueryWaveTrains() const noexcept { return WaveTrains; }
    [[nodiscard]] const OceanSurfaceConfiguration& QueryConfiguration() const noexcept { return Configuration; }
    [[nodiscard]] const OceanSurfaceTelemetry& QueryTelemetry() const noexcept { return Telemetry; }
    [[nodiscard]] float QuerySimulationTime() const noexcept { return SimulationTime; }

private:
    struct OceanImpulseRecord
    {
        OceanVector3 Origin;
        OceanVector2 Direction{ 1.0f, 0.0f };
        float Energy = 0.0f;                // [m] height impulse
        float Wavelength = 8.0f;            // [m]
        float TravelSpeed = 8.0f;           // [m/s]
        float Radius = 20.0f;               // [m] compact support scale
        float BirthTime = 0.0f;            // [s]
        float Lifetime = 8.0f;             // [s]
    };

    void ConstructWaveTrains() noexcept;
    void AdvanceFixedStep(float Δτ) noexcept;
    void UpdateImpulses() noexcept;
    void UpdateParticles(float Δτ) noexcept;
    void EmitBreakingParticles() noexcept;
    void PushImpulse(const OceanImpulseRecord& Impulse) noexcept;
    void SpawnParticle(const OceanSurfaceSample& Surface, OceanParticleKind Kind, float Energy) noexcept;
    void RemoveParticle(uint32_t Index) noexcept;
    [[nodiscard]] float NextRandom() noexcept;
    [[nodiscard]] float RandomSigned() noexcept;
    [[nodiscard]] OceanVector2 NormalizedDirection(const OceanVector2& Direction) const noexcept;

    OceanSurfaceConfiguration Configuration;
    std::vector<OceanWaveTrain> WaveTrains;
    std::vector<OceanParticleRecord> Particles;
    std::vector<OceanImpulseRecord> Impulses;
    OceanSurfaceTelemetry Telemetry;
    OceanVector3 InterestOrigin;
    float SimulationTime = 0.0f;
    float RemainderSeconds = 0.0f;
    uint32_t ActiveParticleCount = 0u;
    uint32_t RandomCursor = 0u;
};

} // namespace Frontier
