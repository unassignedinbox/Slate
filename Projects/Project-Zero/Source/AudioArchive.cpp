//============================================================================================================================================
// AudioArchive.cpp — Implementation stub (miniaudio integration)
//============================================================================================================================================
#include "AudioArchive.h"
#include <fstream>
#include <iostream>

namespace Frontier
{

AudioArchive& AudioArchive::Instance()
{
    static AudioArchive s_Instance;
    return s_Instance;
}

void AudioArchive::Initialize(const std::filesystem::path& archiveRoot)
{
    m_Root = archiveRoot;
    // In real implementation: parse AudioArchives.toml via tomlpp + manifest.json
    // For now, scan directory
    if (!std::filesystem::exists(m_Root)) return;

    for (auto& entry : std::filesystem::recursive_directory_iterator(m_Root))
    {
        if (entry.is_regular_file() && entry.path().extension() == ".wav")
        {
            AudioDescriptor desc;
            desc.fileName = entry.path().filename().string();
            desc.relativePath = std::filesystem::relative(entry.path(), m_Root).string();
            desc.fullPath = entry.path().string();
            desc.loopable = desc.fileName.find("Loop") != std::string::npos || desc.fileName.find("Drive") != std::string::npos;
            m_Descriptors[desc.relativePath] = desc;
        }
    }
    std::cout << "[AudioArchive] Loaded " << m_Descriptors.size() << " descriptors from " << m_Root << "\n";
}

AudioDescriptor AudioArchive::Load(const std::string& relativePath) const
{
    auto it = m_Descriptors.find(relativePath);
    if (it != m_Descriptors.end()) return it->second;
    // Fallback: construct
    AudioDescriptor d;
    d.relativePath = relativePath;
    d.fileName = std::filesystem::path(relativePath).filename().string();
    d.fullPath = (m_Root / relativePath).string();
    return d;
}

AudioArchive::SurfaceBlend AudioArchive::EvaluateSurfaceBlend(const std::string& physicsMaterial, float speedKmh) const
{
    SurfaceBlend blend;
    // Simple material mapping — in real game, query physics
    if (physicsMaterial == "Tarmac") { blend.tarmac = 1.0f; }
    else if (physicsMaterial == "Gravel") { blend.gravel = 1.0f; blend.tarmac = 0.0f; }
    else if (physicsMaterial == "Sand") { blend.sand = 1.0f; blend.tarmac = 0.0f; }
    else if (physicsMaterial == "Dirt") { blend.dirt = 1.0f; blend.tarmac = 0.0f; }
    else if (physicsMaterial == "Mud") { blend.mud = 1.0f; blend.tarmac = 0.0f; }
    else if (physicsMaterial == "Grass") { blend.grass = 1.0f; blend.tarmac = 0.0f; }
    else if (physicsMaterial == "Wet") { blend.wet = 1.0f; blend.tarmac = 0.3f; }

    // Speed affects volume — low speed quieter
    float speedFactor = std::clamp(speedKmh / 100.0f, 0.1f, 1.0f);
    blend.tarmac *= speedFactor;
    blend.gravel *= speedFactor;
    blend.sand *= speedFactor;
    blend.dirt *= speedFactor;
    blend.mud *= speedFactor;
    blend.grass *= speedFactor;
    blend.wet *= speedFactor;

    return blend;
}

void AudioArchive::PlayOneShot(const std::string& relativePath, const AudioPlaybackConfiguration& config) const
{
    // Stub: in real implementation, create ma_sound with config
    // ma_sound_set_pitch, ma_sound_set_volume, etc.
    std::cout << "[AudioArchive] PlayOneShot: " << relativePath
              << " pitch=" << config.pitchSemitones
              << " rate=" << config.playbackRate
              << " volDb=" << config.volumeDb << "\n";
}

void AudioArchive::PlayTireScreech(float intensity, bool isDrift) const
{
    std::string path;
    if (isDrift) path = "Vehicle/Tires/Tire_Screech_Drift.wav";
    else if (intensity > 0.7f) path = "Vehicle/Tires/Tire_Screech_Long.wav";
    else path = "Vehicle/Tires/Tire_Screech_Short.wav";

    AudioPlaybackConfiguration cfg;
    cfg.volumeDb = -6.0f + intensity * 6.0f;
    cfg.pitchSemitones = intensity * 2.0f;
    PlayOneShot(path, cfg);
}

void AudioArchive::PlayCrash(float impactForce) const
{
    std::string path;
    if (impactForce < 20.0f) path = "Vehicle/Impacts/Car_Hit_Light.wav";
    else if (impactForce < 60.0f) path = "Vehicle/Impacts/Car_Hit_Medium.wav";
    else path = "Vehicle/Impacts/Car_Crash_Heavy.wav";

    AudioPlaybackConfiguration cfg;
    cfg.volumeDb = std::clamp(impactForce / 10.0f - 10.0f, -12.0f, 6.0f);
    PlayOneShot(path, cfg);
}

} // namespace Frontier
