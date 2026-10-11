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
busway · tram street · service road · waterfront promenade.

**Lanes** — driving, **bus** (red asphalt + BUS legend), **cycling** (green
asphalt + bike pictograms), **parking** (bay ticks), tram track beds, hard
shoulders, planted medians, grass verges, sidewalks.

**Details** — curbs & mountable curbs, paving, road markings (double-yellow
centrelines, dashed lane lines, edge lines, turn arrows, zebra crosswalks,
parking bays), **bollards**, **speed bumps**, speed-limit signs, street
lights, benches, litter bins, hydrants, trees.

**Bridges** — elevated segments with concrete decks, edge beams, railings
and pillars (generated automatically where the city river runs).

**Rail & subways** — ballast, sleepers, twin rails, **level crossings** with
rubber panels, RR pavement paint, crossbuck signals, twin red lamps and
raised striped gate booms. Metro lines run underground with twin tunnels,
station boxes, yellow platform edges and glazed street entrances
(“Subway X-ray” view mode reveals them).

**City generation** (`G` or the Construct → Generate tab) — hierarchical
street grid with bus / cycle / parking networks, a river with bridges and
quayside promenades, a mainline with a level crossing, an underground metro
line with stations, parks with pathways, and full street furniture seeding.
Buildings are intentionally out of scope.

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
| **P** | Place prop (X rotates 15°) |
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
  roadbuilder.js  ribbons, curbs, markings, bridges, junction pads
  rail.js         railway + level crossings + subway tunnels/stations
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
