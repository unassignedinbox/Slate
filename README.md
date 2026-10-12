# Slate

A browser-based procedural **road network editor**. Draw, edit and generate
city-scale road networks with a real parametric cross-section model — kerbs,
paving, bus and cycle lanes, parking, tram and heavy-rail track, bridges,
tunnels, markings, bollards, speed bumps and level crossings.

Built for making **large drivable maps** (think NFS-style circuits), so the
generator favours long, clean, continuous carriageways with well-formed
intersection topology. Roads only — no buildings.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Navigation

The viewport uses Unreal-editor camera controls:

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | fly forward / left / back / right |
| `Q` / `E` | descend / ascend |
| right-drag | mouse-look |
| middle-drag | pan |
| wheel | dolly (hold for finer steps) |
| `F` | frame selection |
| `Home` | frame the whole network |
| `Shift` | move faster · `Ctrl` slower |
| `1`–`4` | select / draw / node / paint tools |
| `G` | grid · `J` wireframe · `K` helpers · `H` HUD |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |

Hold the right mouse button in the viewport for the WASD fly camera; the panel
at the bottom-left of the viewport shows the active keys.

## Model

Every edge carries a **cross-section**: an ordered list of bands running
left→right across the road.

```js
[
  { k: 'sidewalk', w: 2.5, s: 'concrete', h: 0.15, riser: 'curb' },
  { k: 'cycle',    w: 2.0, s: 'asphalt_red', dir: 1 },
  { k: 'driving',  w: 3.4, s: 'asphalt', dir: 1 },
  { k: 'bus',      w: 3.5, s: 'asphalt', dir: 1 },
  { k: 'median',   w: 1.8, s: 'planting', h: 0.12 },
  { k: 'parking',  w: 2.4, s: 'paver' },
  { k: 'rail',     w: 4.2, s: 'ballast', gauge: 1.435, rails: 2 },
]
```

Band kinds cover driving, bus, cycle, parking, taxi, HOV, shoulder, sidewalk,
pedestrian zones, medians, planting strips, verges, soft edges, barriers,
kerbs, walls, cycle tracks, tram, light rail, heavy rail, metro, high-speed
rail and footbridges. Surfaces run from asphalt and concrete through sett,
cobble, paver, gravel, dirt, grass, rubber, steel and ballast. Longitudinal
markings, transverse markings (zebra, stop bars, give way) and road symbols
(arrows, cycle, bus, taxi, diamond, pedestrian, chevron, rail cross, SLOW)
are generated from the band list automatically.

Junctions are patched procedurally from the approach geometry: an arbitrary
number of arms at any angle, T and Y shapes, skewed crossings, roundabouts and
grade-separated slip roads. Road surfaces, kerb returns, footway rings,
crossings and the yellow box are all rebuilt from the mouth geometry.

## Generator

`src/gen/CityGenerator.js` produces a network over a large extent from a seed.
Patterns:

- **grid** — hierarchical arterials / collectors / locals with jitter
- **radial** — ring-and-spoke concentric grid
- **organic** — relaxed irregular network
- **highway** — long-distance grade-separated corridors
- **coastal** — network pinned to a shoreline

Options cover block size, road hierarchy, roundabout density, one-way ratio,
bus lanes, cycle lanes, parking lanes, street lighting, rail lines and metro
lines. Rail and metro corridors are laid down first; road/rail crossings are
detected and given proper level-crossing decks, flangeways and check rails.

## Layout

```
src/core/    math, terrain heightfield, camera, editor state, tile builder
src/model/   network document (no Three.js) and the surface/kind tables
src/gen/     cross-section compiler, mesh sink, road ribbon builder,
             markings, junctions, railway, props, textures, materials
src/ui/      widgets, chrome, panels, cross-section editor, exporter UI
src/io/      JSON, glTF, OBJ and CSV export
tools/       headless test harnesses
```

The world is partitioned into tiles that build on a 9 ms/frame budget with two
LOD levels, so a 6 km city streams in without blocking the UI.

## Export

- **glTF / GLB** — full scene, one buffer
- **OBJ** — meshes only
- **CSV** — quantity schedule by surface
- **JSON** — the editable network document (`.slate.json`)

## Tests

```bash
node tools/smoke.mjs       # geometry pipeline: 7 sections, no browser needed
npm i --no-save jsdom
node tools/dom-smoke.mjs   # full UI in jsdom: 15 sections
```

`smoke.mjs` walks the generator over every pattern and asserts the mesh is
finite, watertight and correctly wound. `dom-smoke.mjs` builds the whole
editor UI, drives every menu, toolbar button, inspector control and export
dialog, and fails on any uncaught DOM exception.

## URL flags

- `?city=0` — boot with an empty network
- `?city=20240:3000:organic` — `seed:extent:pattern`
