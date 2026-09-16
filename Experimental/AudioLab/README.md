# AudioLab — Slate / Project Zero Racing Audio Suite

SolidArc-themed modular audio editor for Frontier Slate.

## Structure
```
Experimental/AudioLab/
  index.html — Main editor (SolidArc theme, 3-panel)
  Content/Audio/
    Ambience/ — Clouds, Wind (6 variants)
    Foliage/ — Tree rustle, Grass shuffle
    Terrain/ — Sand rolling, Gravel
    Vehicle/
      Surfaces/ — Sand, Gravel, Tarmac, Wet, Dirt, Mud, Grass
      Tires/ — Screech Short/Long/Drift, Brake Lock
      Impacts/ — Light/Medium/Heavy Crash, Metal Crunch, Bumper
      Engine/ — Idle Loop, Rev Low/High, Turbo Spool
    UI/ — Hover, Click
  generate_audio.py — Procedural generator (numpy + wave)
```

38 WAV files, 44.1kHz 16-bit stereo, loopable where appropriate.

## Features (index.html)
- **Outliner** (left): Category tree, search, quick play
- **Viewport** (center): Waveform, spectrogram toggle, playhead, loop region, Racing Surface Simulator
- **Inspector** (right): Modular audio graph
  - Playback: Pitch (-12..+12 st), Detune (cents), Rate (0.25x-4x), Volume dB, Pan, Loop
  - Filters: Lowpass, Highpass, Bandpass, Q
  - Effects Chain: Reverb, Distortion, Delay, Compressor (drag to reorder, bypass)
  - Envelope ADSR
  - Project Zero Integration: C++ snippet with miniaudio

## Usage in Project Zero
Files are copied to `Projects/Project-Zero/Content/AudioArchives/` for engine use.

```cpp
// Engine uses miniaudio (ExternalPackages/miniaudio)
auto wind = AudioArchive::Load("Ambience/Wind_Breeze_Light.wav");
wind.SetPitch(2.0f); // semitones
wind.SetPlaybackRate(1.2f);
wind.SetVolumeDb(-3.0f);
wind.SetLoop(true);
wind.Play();

// Surface blending based on physics material
float tarmac = Math::Lerp(...);
auto tarmacSfx = AudioArchive::Load("Vehicle/Surfaces/Car_Tarmac_Drive_Loop.wav");
auto gravelSfx = AudioArchive::Load("Vehicle/Surfaces/Car_Gravel_Drive_Loop.wav");
tarmacSfx.SetVolume(tarmac);
gravelSfx.SetVolume(1.0f - tarmac);
```

## Running the Editor
Need HTTP server (fetch requires HTTP):
```
cd Experimental/AudioLab
python3 -m http.server 8000
# open http://localhost:8000
```

## Audio Generation
Procedural synthesis via `generate_audio.py`:
- Wind: pink noise + LFO amplitude modulation + bandpass
- Foliage: granular synthesis (120-300 grains)
- Terrain: filtered noise + random clicks
- Vehicle: tire hiss + rumble + engine harmonics
- Screech: sine sweep + harmonic + noise
- Crash: low boom (50-150Hz) + resonances + debris

All files are real WAVs, not code-generated at runtime, ready for engine import.

## Theme
Matches https://sultanaladin.github.io/Frontier-/solidarc/ and Slate UIComponents.html:
- Dark bg #050505, panel #121212, inset #1a1a1a
- Rounded panels 20px, pills 999px
- General Sans font, 60fps, Z-up notation in statusbar
- Outliner · Viewport · Inspector 3-panel grid
