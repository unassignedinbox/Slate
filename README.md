# Portal Circuit: 7 Stages of Hazard

A high-speed, arcade-style 3D racing obstacle course game built with **Three.js** and procedural **Web Audio API**.

Players pilot the authentic **Frontier PROTO-X wedge coupe** from `Project-Drive` through a sequence of 7 modular hazard sectors, interconnected by glowing sci-fi portal checkpoints leading to the grand victory finish line.

---

## 🚗 The Vehicle: Frontier PROTO-X Coupe

Extracted directly from the authored vehicle geometry in `SultanAladin/Frontier-` (`ControlVehicleStructure.inl`, `ControlVehicleRimMesh.inl`, and `ControlVehicleTyreMesh.inl`):
- **Chassis Body**: 1,492 vertices, 2,924 triangles across 8 authored material slots:
  - `MatBodyPaint`: Metallic clearcoat automotive finish with customizable paint palette.
  - `MatVehicleGlass`: Translucent glossy cockpit glazing with realistic reflections.
  - `MatVehiclePlastic`: Matte black aero splitters, diffusers, and side skirts.
  - `MatTyre`: Carcass rubber seals.
  - `MatVehicleTrim`: Satin silver aero accents.
  - `MatHeadlight`: Emissive headlights with dynamic Three.js SpotLight beams.
  - `MatTaillight`: Neon red taillights that bloom on braking and reversing.
  - `MatVehicleDefault`: Grille and internal fixtures.
- **4 Wheels**: Composed of authored rim mags (`MatHub`) and rubber tire tread lattices (`MatTyre`), mounted at the exact authored socket locations:
  - Front-Left: `[-1.0475, 0.0914, -1.7274]`
  - Front-Right: `[1.0475, 0.0914, -1.7274]`
  - Rear-Left: `[-1.0475, 0.0914, 1.6686]`
  - Rear-Right: `[1.0475, 0.0914, 1.6686]`
- **Arcade Physics**:
  - Speed-sensitive steering, acceleration across 6 gear ratios, and reverse.
  - Handbrake drifting mechanics with tire screech audio, skid marks, and combo score multiplier.
  - Rocket Nitro Boost with cyan/orange exhaust flames, FOV punch, and high-speed thrust.
  - Dynamic suspension roll (body lean in corners), pitch (dive under braking, squat under throttle), and vertical bounce.
  - Health & impact damage system with respawn at the current sector checkpoint.

---

## 🌀 The 7 Modular Hazard Stages

### Stage 1: Shattered Metropolis (Floating Building Debris)
- **Setting**: Twilight sky over an infinite abyss with fractured skyscraper towers.
- **Course**: Narrow rooftop runways, helipads, and suspended skyway bridges between fractured buildings.
- **Hazard**: Moving floating debris chunks (shattered concrete slabs and rebar frames) oscillating and tumbling across the raceway that can strike and shove the player. Falling off the roof triggers automatic respawn.
- **Goal**: Reach the final cantilevered helipad housing **Portal 1**.

### Stage 2: Sewer Conduit (Curved Pipe & Steam Eruptions)
- **Setting**: Massive underground aqueduct pipe tunnel with structural iron ribs and emergency beacons.
- **Course**: Parabolic curved half-pipe interior where players can ride up the curved walls.
- **Hazard 1 (Sludge)**: Toxic green fluorescent effluent along the bottom gutter causing slippery hydroplaning.
- **Hazard 2 (Steam Eruptions)**: A dynamic "PIPE PRESSURE" meter climbs as you race. Wall fissures crackle and erupt with high-pressure boiling steam and scalding water geysers that violently deflect and damage the vehicle.
- **Goal**: Reach the industrial sluice gate holding **Portal 2**.

### Stage 3: Dung Beetle Ridge (Hillside Crossing & Rolling Boulders)
- **Setting**: Red-rock desert canyon ridge flanked by steep bluffs.
- **The Beetles**: 5 Giant animated Scarab Dung Beetles perched along the cliff tops.
- **Hazard**: Giant spherical dung boulders pushed and catapulted down the hillsides, bouncing across the roadway. Collisions cause severe kinetic impact, launching the car into a spin.
- **Goal**: Slalom through the canyon boulders to the ancient stone archway housing **Portal 3**.

### Stage 4: Smart City Wave Bollards (Kinetic Security Grid)
- **Setting**: Cyberpunk neon boulevard with holographic skyscrapers and smart traffic gantries.
- **Hazard 1 (Sensor Detection)**: Overhead gantries scan oncoming traffic; entering the sensor zone triggers traffic lights to transition from Green to Amber, then Red lockdown.
- **Hazard 2 (Wave Bollards)**: Retractable steel security bollards rise and sink in undulating harmonic waves. When the traffic light turns Red, aggressive wave crests erupt from the asphalt. Timing open valleys is crucial.
- **Goal**: Reach the cyber highway plaza housing **Portal 4**.

### Stage 5: Metro Monorail Crossings (High-Speed Rail Intersections)
- **Setting**: Dense downtown transit corridor with elevated monorail viaducts.
- **Course**: Expressway intersecting active monorail tracks at grade across 3 distinct crossings.
- **Hazard**: Rhythmic flashing warning beacons, crossing bells, and lowering barrier arms herald high-speed futuristic bullet monorail trains zooming across the road at 160+ km/h. Players must brake or boost through narrow gaps.
- **Goal**: Reach the central terminal station housing **Portal 5**.

### Stage 6: Magnetic Scrapyard (Traveling Crane & Tractor Beam)
- **Setting**: Heavy industrial scrap metal yard with towering car wrecks.
- **The Crane**: Giant traveling gantry crane traversing on overhead rails.
- **Hazard 1 (Scrap Drops)**: Loose bundles of scrap metal, crushed engines, and iron girders occasionally break free from the magnet and crash down onto the raceway.
- **Hazard 2 (Magnetic Tractor Beam)**: Driving directly beneath the active electromagnet triggers a magnetic field that lifts the car off the pavement. With wheels spinning in mid-air, players must steer or trigger nitro boost to break free before getting pinned.
- **Goal**: Cross the blast furnace ramp into **Portal 6**.

### Stage 7: D-Day Gauntlet & Grand Finale (Minefield Maze & Turrets)
- **Setting**: Coastal battlefield with anti-tank Czech hedgehogs, sandbags, and trench bunkers.
- **Hazard 1 (Minefield Maze)**: Grid of active proximity landmines marked by blinking red LEDs. Driving over a mine detonates a massive fiery explosion launching the vehicle.
- **Hazard 2 (Pillbox Turrets)**: Heavy concrete pillbox bunkers with twin machine gun turrets that dynamically track the car with red targeting lasers and fire rapid salvos of tracer rounds.
- **Grand Finish Line**: Emerge onto the victory promenade to cross the grand checkered finish line archway with celebration floodlights, victory fanfare, and fireworks!

---

## 🎮 Controls

| Action | Keyboard | Touch / On-Screen |
| :--- | :--- | :--- |
| **Accelerate** | `W` or `↑` | `▲` button |
| **Brake / Reverse** | `S` or `↓` | `▼` button |
| **Steer Left / Right** | `A` / `D` or `←` / `→` | `◀` / `▶` buttons |
| **Handbrake / Drift** | `Spacebar` | `DRIFT` button |
| **Nitro Boost** | `Left Shift` / `Right Shift` | `NITRO` button |
| **Change Camera** | `C` | `🎥` button |
| **Reset Vehicle** | `R` | `🔄` button |
| **Mute Audio** | `M` | `🔊` button |
| **Pause / Stage Select** | `Esc` | `⚙️` button |

---

## 🛠️ Architecture & Tech Stack

- **Three.js**: WebGL rendering with ACES Filmic tone mapping, PCF soft shadow maps, and custom vertex/fragment shaders.
- **Web Audio API**: 100% procedural sound synthesis (dual-oscillator engine tone, noise-based tire skid, steam hisses, crossing bells, gunfire cracks, sub-bass explosions, victory fanfare, and synthwave soundtrack).
- **Vite**: Ultra-fast build and dev server.
