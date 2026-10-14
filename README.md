# SLATE — Portal Rush 🏁

A 3D arcade obstacle-course racer (Three.js) built from 7 small, modular, detailed scenes
linked by **portal checkpoints**. Finish one scene, drive through the glowing portal, and you
materialise at the start of the next — all the way to the chequered finish.

## The car — Frontier's Project-Drive ControlVehicle 🚗
Same car as **Project-Drive** in [SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-/tree/arena%2F4f07c82a-frontier):
the authored `ControlVehicle` mesh (1,492 verts / 2,924 tris, +X fwd / +Y left / +Z up, metres)
was converted verbatim from `EngineContent/GeometryArchives/ControlVehicleStructure.inl`
→ `assets/control-vehicle.json` (see `tools/convert-control-vehicle.py`), keeping its
per-face material families: `MatBodyPaint` (MetallicCoat), Glass, Plastic, Tyre, blue Hub,
Brake, Trim, Headlight & Taillight. Tyre/hub/brake faces are split into 4 spinning wheel pivots.

## The 7 scenes
1. **☁️ Fractured Rooftops** — drive fractured floating house-roofs, jump the gaps; drifting building debris can knock you off.
2. **🚿 Sewer Pipe** — curved half-pipe road with sewage channels. Cracks spew steam; the longer you're in there, the higher the **pressure** rises and the more cracks blow (they launch & slow you).
3. **🪲 Dung-Beetle Crossing** — giant beetles on the hill roll dung balls downhill across your road.
4. **🚦 Sensor Bollard City** — traffic-light sensors detect you and a wave of bollards retracts/rises in your path.
5. **🚝 Monorail Crossings** — two elevated monorail crossings, warning lights, trains that wreck you.
6. **🧲 Magnet Crane** — a swinging crane drops scrap… and its magnet periodically **sucks the car up** too.
7. **💥 D-Day Minefield Maze** — hedgehog/concrete maze, live mines, and rotating turrets firing machine-gun tracers.

## Play
Open `index.html` (or serve the folder) — `python3 -m http.server 8000`

| Key | Action |
|---|---|
| W/S or ↑/↓ | throttle / brake-reverse (Project-Drive layout) |
| A/D or ←/→ | steer |
| Space | handbrake |
| Shift | boost |
| R | respawn at scene start |
| P | pause |

Damage (❤️) from debris, dung, steam, trains, scrap, mines & turret fire. Hit 0 and you respawn at 55%.
HUD tracks time, speed, portal distance, and sewer pressure. Touch pedals appear on coarse pointers.

## Files
- `index.html` / `src/style.css` / `src/game.js` — the whole game (Three.js via CDN import map)
- `assets/control-vehicle.json` — converted Project-Drive ControlVehicle mesh + material families
- `tools/convert-control-vehicle.py` — the converter used to produce it
