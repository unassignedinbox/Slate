//============================================================================================================================================
// AudioArchive — Project Zero Racing Audio Integration
// Uses miniaudio (ExternalPackages/miniaudio) — 38 files from Experimental/AudioLab
//============================================================================================================================================
#pragma once

#include <string>
#include <unordered_map>
#include <filesystem>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
// AudioCategory — mirrors Content/Audio/ folder structure
//----------------------------------------------------------------------------------------------------------------------
enum class AudioCategory
{
    Ambience,
    Foliage,
    Terrain,
    VehicleSurface,
    VehicleTire,
    VehicleImpact,
    VehicleEngine,
    UI
};

//----------------------------------------------------------------------------------------------------------------------
// AudioDescriptor — metadata for each wav (parsed from AudioArchives.toml / manifest.json)
//----------------------------------------------------------------------------------------------------------------------
struct AudioDescriptor
{
    std::string             fileName;       // e.g. "Wind_Breeze_Light.wav"
    std::string             relativePath;   // e.g. "Ambience/Wind_Breeze_Light.wav"
    std::string             fullPath;       // resolved absolute
    float                   durationSeconds = 0.0f; // [s]
    bool                    loopable = true;
    AudioCategory           category = AudioCategory::Ambience;
    std::string             description;
};

//----------------------------------------------------------------------------------------------------------------------
// AudioPlaybackConfiguration — modular params exposed in AudioLab Inspector
//----------------------------------------------------------------------------------------------------------------------
struct AudioPlaybackConfiguration
{
    float pitchSemitones = 0.0f;        // [-12, +12] st — maps to detune
    float detuneCents = 0.0f;           // [-100, +100] ¢
    float playbackRate = 1.0f;          // [0.25, 4.0] ×
    float volumeDb = 0.0f;              // [-40, +6] dB
    float pan = 0.0f;                   // [-1, +1] L/R
    bool  loop = true;

    // Filters (Biquad)
    bool  filtersEnabled = false;
    float lowpassHz = 20000.0f;         // [20, 20000] Hz
    float highpassHz = 20.0f;           // [20, 1000] Hz
    float bandpassHz = 1000.0f;         // [100, 8000] Hz
    float q = 1.0f;                     // [0.1, 2.0]

    // Effects
    float reverbWet = 0.35f;            // [0, 1]
    float distortion = 0.0f;            // [0, 1]
    float delayWet = 0.22f;             // [0, 1]
    float compressor = 0.0f;            // [0, 1]

    // Envelope
    float attackMs = 10.0f;             // [ms]
    float decayMs = 120.0f;
    float sustain = 0.85f;              // [0,1]
    float releaseMs = 180.0f;
};

//----------------------------------------------------------------------------------------------------------------------
// AudioArchive — loads from Projects/Project-Zero/Content/AudioArchives/
// In production, wraps miniaudio::ma_sound with above configuration
//----------------------------------------------------------------------------------------------------------------------
class AudioArchive
{
public:
    static AudioArchive& Instance();

    // Load all descriptors from manifest.json / toml
    void Initialize(const std::filesystem::path& archiveRoot);

    // Load single file — returns descriptor (actual ma_sound creation in .cpp)
    AudioDescriptor Load(const std::string& relativePath) const;

    // Surface blending helper for racing
    // tarmacWeight = 1.0 = full tarmac, 0.0 = full offroad
    struct SurfaceBlend
    {
        float tarmac = 1.0f;
        float gravel = 0.0f;
        float sand = 0.0f;
        float dirt = 0.0f;
        float mud = 0.0f;
        float grass = 0.0f;
        float wet = 0.0f;
    };

    // Returns volume map for current physics material
    SurfaceBlend EvaluateSurfaceBlend(const std::string& physicsMaterial, float speedKmh) const;

    // One-shot helpers
    void PlayOneShot(const std::string& relativePath, const AudioPlaybackConfiguration& config = {}) const;
    void PlayTireScreech(float intensity, bool isDrift) const;
    void PlayCrash(float impactForce) const; // maps force to Light/Medium/Heavy

private:
    std::unordered_map<std::string, AudioDescriptor> m_Descriptors;
    std::filesystem::path m_Root;
};

} // namespace Frontier
