# Slate — STEEL TIDE

A low-poly **D-Day beach assault** built with Three.js. You land in a beat-up
sedan between a **rising ocean tide** and **the Wall** — 560 metres of minefield,
wire and machine-guns in between — and you have to reach it.

![map](test/map.png)

## The battlefield (ocean → wall)

- **Rising tide** — the ocean level climbs for ~7 minutes and floods the beach,
  the wire belts and finally the first trenches. Wading slows you, deep water drowns you,
  a flooded engine dies. **You start in the vehicle — you have wheels, use them.**
- **Winding dirt road** from the wrecked landing craft to the gate — the safe-ish
  lane: it snakes between the minefields, threads the wire gaps and the dragon teeth.
  Leave it and you're in the mines.
- **Minefield** — ~118 tank mines (pressure plates: only vehicles trigger them, but the
  blast kills anyone nearby; one wheel on a plate ends the car) plus ~56 anti-personnel
  mines that blink and explode.
- **Barbed wire belts** — five belts strung across the beach with gaps at the road.
  On foot they cut you up; **the car smashes through them**.
- **Czech hedgehogs, wrecked tanks, huge mounds of earth** — cover from sentry fire
  when you're on foot; two mounds carry forward bunkers.
- **Fire trenches** (zig-zag, duckboards, plank bridges where the road crosses) —
  step in and the sentries lose line of sight on you.
- **MG sentries** — 16 of them along the defense line and the wall. They **track and
  shoot both you and the vehicle** in aimed bursts; tracers walk in on you.
- **Bombing runs** — when you push inland in the vehicle, a bomber comes in over
  the water, drops a stick of two on the car and egresses. The engine drone and an
  `AIRCRAFT INBOUND` warning are your cue to get out and scatter.
- **Dragon teeth** row + wire + a Jersey-barrier chicane before the wall.
- **The Great Wall** — 16 m of concrete with wall-top sentries. Reach it (z ≈ 162) to win.

## The car

A low-poly sedan (Nissan-Sentra-ish silhouette, extruded side profile — not a box).
You **start behind the wheel**. `E` to exit/re-enter. Arcade physics: terrain following,
obstacle collisions, engine flooding, 120 hp of damage states (smoke → fire → explosion).
Sentries and bombers prioritize it over you — ditch it when the sky growls.

## Controls

| Key | Action |
| --- | --- |
| `WASD` | Move / drive |
| `SHIFT` | Sprint |
| `SPACE` | Jump / handbrake |
| `E` | Enter / exit vehicle |
| `C` | Toggle orbit camera |
| `M` | Mute |
| `ESC` | Pause |

## Run

Any static file server, e.g.:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no assets — everything (geometry, textures, sound) is generated procedurally.

## Dev

```bash
node test/smoke.mjs    # headless logic test: builds the world, simulates gameplay
node test/boot.mjs     # full E2E: boots the real main.js in a fake DOM + fake GL,
                       #   plays through every path (88 asserts)
node test/mapview.mjs  # renders test/map.png (top-down battlefield map)
node test/asciimap.mjs # ASCII overview of the layout
```

Structure: `js/world.js` (terrain heightfield, tide, sky) · `js/props.js` (wall, bunkers,
sentries, tanks, wire, mines, sandbags) · `js/planes.js` (bomber runs) · `js/car.js` ·
`js/player.js` · `js/combat.js` (sentry AI, mines, wire, tide) · `js/effects.js` ·
`js/audio.js` (synthesized) · `js/main.js`.
