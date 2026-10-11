# Slate — Road Editor

A robust 3D **road & city editor** with a UI designed after the Frontier
**ProjectZeroEditor** experimental browser prototype
([SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-) →
`Experimental/FrontierEditor`): graphite panels, DM Sans, thin-stroke icons,
metric inspector cards, and the Construct tile menu.

![status](https://img.shields.io/badge/UI-ProjectZeroEditor%20style-2b2f36) ![stack](https://img.shields.io/badge/stack-Three.js%20·%20Vite-88a)

## Run it

```sh
npm install
npm run dev        # open the printed localhost URL
npm test           # headless smoke tests (geometry + UI)
npm run build      # production bundle in dist/
```

## What you can build

**Roads — every class you find in the world**
Motorway / highway · highway ramp · boulevard · avenue · city street · local
street · alley / service lane · pedestrian street · pathway · cycleway ·
busway · tram street · service road · waterfront promenade · race circuit.

**Proper curbs** — real kerb assemblies: gutter pans cross-falling to the
kerb, vertical reveal faces, kerb tops (barrier lip / rounded chamfer /
granite stone / mountable ramp) and 2% back-sloped paving.

**Lanes** — driving, **bus** (red asphalt + BUS legend), **cycling** (green
asphalt + bike pictograms), **parking** (bay ticks), tram track beds, hard
shoulders, planted medians, grass verges, sidewalks.

**Details** — curbs & mountable curbs, paving, road markings (double-yellow
centrelines, dashed lane lines, edge lines, turn arrows, zebra crosswalks,
parking bays), **bollards**, **speed bumps**, speed-limit signs, street
lights, benches, litter bins, hydrants, trees.

**Proper bridges** — four real structures, selectable per segment:
* **Girder / beam** — deck slab, steel I-girders, hammerhead piers, abutments
* **Arch** — parabolic ribs, spandrel columns, cross braces
* **Cable-stayed** — twin pylons, fan stays, pier bases
* **Through-truss** — Warren side trusses, top lateral bracing
plus concrete parapets or steel handrail railings and deck lamps.

**Proper railway crossings** — flangeway panels with rail slots, concrete
approach slabs, rumble strips, stop lines, hatched islands, RR pavement
paint, advance warning boards, wig-wag signals with bells, crossbucks and
counterweighted gate booms with tip lights and rubber skirts.

**Proper city parking** — surface car parks with painted bays (90°/60°),
aisle arrows, blue accessible bays, landscaped islands with trees, light
masts and entry kiosks — plus multi-storey **parking decks** with column
grids, parapets and zigzag ramps. Both are first-class editable objects.

**Rail & subways** — ballast, sleepers, twin rails, level crossings (above).
Metro lines run underground with twin tunnels, station boxes, yellow
platform edges and glazed street entrances (“Subway X-ray” reveals them).

**NFS-scale city generation** (`G` or Construct → Generate) — ~216 road
segments / 19 km of carriageway: hierarchical grid + service alleys, an
**elevated expressway** with girder viaduct over Central Boulevard and
curved flyover ramps, a **roundabout**, a river crossed by cable-stayed,
arch, truss and girder bridges, quayside promenades, a mainline with **two
gated level crossings**, an underground metro with stations, parks with
pathway loops, six parking facilities and full street furniture seeding.
Every generated piece stays editable — re-profile roads, switch bridge
structures, reshape parking, draw new roads, delete anything.
Buildings are intentionally out of scope; draw sweeping circuits with the
**race circuit** profile for NFS-style driving runs.

## Unreal-style viewport camera

| Input | Action |
| --- | --- |
| **RMB drag** | Look around |
| **W A S D / arrows** | Fly (relative to view) |
| **Q / E** (or C / Space) | Down / up |
| **Scroll wheel** | Camera speed |
| **Shift / Ctrl** | Boost / creep |
| **Alt + LMB** | Orbit pivot |
| **F** | Focus selection |

## Editor hotkeys

| Key | Action |
| --- | --- |
| **V** | Select tool |
| **R** | Draw road (polyline, Enter or double-click to finish) |
| **P** | Place prop / parking (X rotates 15°) |
| **K** | Construct menu |
| **G** | Generate city |
| **1 – 4** | Lit / Classes / Wire / Subway X view modes |
| **Del** | Delete selection |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo / redo |
| **Esc** | Cancel / deselect |

The inspector shows a live **cross-section lane diagram** for every road,
speed limits, marking/curb/sidewalk switches, bridge toggles and a profile
switcher to re-class any segment. Scene documents are pure JSON — export,
import, and localStorage autosave.

## Architecture

```
src/
  main.js         application controller (tools, selection, history, hotkeys)
  ui.js           toolbar · outliner · inspector · status bar
  construct.js    Construct modal (road/furniture/rail tiles + generator form)
  viewport.js     three.js scene, sun, picking, view modes, draw ghosts
  camera.js       Unreal-style fly camera
  model.js        pure-data RoadDocument (JSON serializable)
  profiles.js     cross-section profiles, band layout, marking rules
  roadbuilder.js  ribbons, proper curbs, markings, junction pads
  bridges.js      girder / arch / cable-stayed / truss structures
  parking.js      surface car parks + multi-storey parking decks
  rail.js         railway + proper level crossings + subway tunnels/stations
  props.js        street furniture factories (batched + pick proxies)
  citygen.js      procedural city generation
  textures.js     procedural canvas textures (asphalt, paving, paint…)
  materials.js    shared material palette
scripts/          headless smoke tests (geometry + UI)
```

UI design tokens and panel language follow
`Experimental/FrontierEditor` (`style.css`, `construct-menu.css`) —
`#101010` canvas graphite, `#161616` outliner, `#202329` construct panel,
DM Sans 13px, semantic accents on icons only.
