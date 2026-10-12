# Road Editor

The Road Editor is the browser prototype for the ProjectZeroEditor road tooling. It generates a
whole city from nothing, repairs the network it generated, and draws the result with a hand-written
WebGL2 renderer. Roads only: no buildings, no traffic.

    Experimental/RoadEditor/
      index.html          the editor shell
      src/                the editor: generator, network repair, geometry, renderer, UI
      tools/              node tools: smoke, headless, preview, bundle, serve
      dist/               the single-file release build (committed)
      preview/            plan renders of the generated cities (committed)

## Running it

    cd Experimental/RoadEditor
    npm install            # esbuild only, and only for the release build
    npm run serve          # http://localhost:8080

Two entry points, because they are for two different jobs:

| URL | What it is | When to use it |
| --- | --- | --- |
| `/` | `dist/ProjectZeroEditor.html` — one self-contained file | sharing it, embedding it in a sandboxed iframe, opening it from `file://` |
| `/dev` | `index.html` + `src/*.js` as modules | editing the source; a reload picks up the change |

`npm run bundle` rebuilds `dist/ProjectZeroEditor.html` from `index.html` and `src/`. The release
build has to be rebuilt by hand after a source change; there is no watcher.

## Controls

| Action | Input |
| --- | --- |
| Move (Unreal-style free camera) | `W A S D` |
| Up / down | `E` / `Q`, or `Space` / `C` |
| Look | hold right mouse and drag |
| Fast / slow | `Shift` / `Ctrl` |
| Fly speed | mouse wheel |
| Orbit the point of interest | hold `Alt` and drag, or middle-drag |
| Focus the selection | `F` |
| View presets | `1` map, `2` top, `3` street, `4` chase |
| X-ray skeleton overlay | `X` |
| Markings / props / shadows | `M` / `P` / `H` |
| Regenerate the city | `G` |
| Delete the selected road | `Del` |
| Deselect, close the overlay | `Esc` |

The left panel generates and inspects, the right panel inspects one road or one junction at a time:
the Build tab carries the preset, extent, seed and the feature switches (bus lanes, cycle lanes,
parking lanes, footways, canyon circuit, river, railways, subway), the Library tab lists the road
profiles, and the Issues tab lists the validation report with a map marker per entry.

## What it does

### Generating

`src/citygen.js` builds a city outwards from a centre: a map polygon (radial with jitter), a core
loop, ring roads, radial arterials, motorways, a canyon circuit, a river with bridges, railways and
a subway, then districts. Each district is subdivided by recursive cutting: a region is split by a
chord, the road that owns the chord is laid along it, and the two halves are subdivided again until
the pieces are block-sized. The subdivision carries the block-scale table, so alley-sized blocks
appear near the centre and larger ones at the edge.

### Repairing

A generated network is a pile of curves that almost touch. `src/network.js` turns it into a network:
every pass is listed in order at the top of the file.

| Pass | What it decides |
| --- | --- |
| `attachEnds` | welds an end to the carriageway it was aimed at (snap 1.5 m, search 26 m, rescue 30 m) |
| `dedupeRoads` | drops a road that lies on top of another of the same family |
| `resolveCrossings` | finds real crossings, decides which are junctions and which are grade-separated |
| `stitchEnds` | welds coincident ends, joins collinear pairs into one road |
| `createNodes` | one junction per crossing point, merging requests that are the same junction |
| `dissolveShortEdges` | collapses streets shorter than 13 m into one junction, culls debris |
| `planGrade` | samples the terrain, plans bridge decks and ramps, limits the gradient |
| `buildJunctions` | kind, cut distances, fillet radius, control type, roundabout rings |
| `dissolveShortEdges` (again) | absorbs the slivers that trimming leaves between two junctions |
| `relaxNodes` | settles one height per junction and shapes the approaches to it |
| `buildRenderPaths` | fits a denser point list for the surfaces |
| `validateNetwork` | the report the Issues tab shows |

Three decisions in that list are worth knowing about, because they are what makes the plan read as
a city rather than as a diagram:

* **Junctions merge by street count, not by radius.** A generous merge radius swallowed every
  crossing in a district and produced junctions with twenty arms, each arm a ten-metre stub of a
  street that had been cut three times in one spot. A merge now has to be within `3 + 0.4 · (widths)`
  metres and must not push the junction past five streets or ten arms.
* **Five or more streets at one point become a roundabout.** That many arms of stop lines is neither
  buildable nor readable, and a roundabout reduces every approach to one give-way movement. The
  circulating carriageway, the centre island, the splitter islands and the give-way dashes are all
  geometry, in `buildRoundabout`.
* **A junction sits at one height, and the streets come to it.** `relaxNodes` averages the heights of
  the streets that arrive at a junction, propagates that along chains of short streets until a whole
  cluster sits level, and then clamps every arm end onto its junction. The gradient limiter runs
  between the clamps with the ends pinned, so it can reshape the street behind the junction but not
  lift it off.

### Drawing

`src/build.js` sweeps every road's profile along its render path: carriageway, kerbs, footways,
verges, medians, tram beds. Junction surfaces come from the same cut distances the network decided,
so the asphalt of a junction and the asphalt of its arms are the same surface, not two that overlap.
Markings, street furniture, bridges, tunnels, retaining walls, rail, subway, terrain and the x-ray
overlay are separate builders in the same file. `src/render.js` is the WebGL2 renderer: one draw
call per material batch, one instanced draw per prop kind, and a shadow map.

## Verification

Every number below came out of a run on this branch, not out of the design.

| Check | Command | Result |
| --- | --- | --- |
| City generates, builds and validates | `npm run smoke city` | 1 864 roads, 827 junctions, 107.3 km, 435.7 lane-km, 506 blocks, 1.96 s to generate, 1.60 s to build |
| Town generates, builds and validates | `npm run smoke town` | 517 roads, 224 junctions, 29.9 km, 118.4 lane-km, 161 blocks, 0.46 s / 1.63 s |
| Roundabouts | `npm run preview` | 140 in the city, 45 in the town |
| UI, panels, picking, export | `npm run headless` | every subsystem exercised without throwing |
| Single-file build | `npm run bundle` | `dist/ProjectZeroEditor.html`, 177 KB |
| Plan render | `npm run preview` | `preview/city-3000.png`, `preview/town-1600.png` |

The validation report for the default city ends with 16 errors and 85 warnings: thirteen short road
segments that survived the dissolves, and three junctions where one arm still cannot reach its
junction's height. Everything else in the report is informational — footways carrying no traffic,
free ends at the map edge, and the junction-skin slivers, which are the asphalt a junction leaves
between itself and its neighbour and which are not streets at all.

## Known gaps

* **Terrain does not follow the roads.** Roads are graded to a design gradient on the terrain;
  the terrain mesh is built from the terrain alone, so a graded road cuts into a hill or floats
  over a dip. Deforming the terrain toward the network near the corridors is the next fidelity step.
* **Rail sleepers are boxes.** 66 k triangles of the 800 k in the city build are railway sleepers
  drawn as individual boxes, spaced 0.62 m apart. They should be instanced like the props are.
* **No routing layer.** The network has a graph and the junctions have turn geometry, but nothing
  walks it: no pathfinding, no lane-level connectivity, no one-way enforcement beyond the render.
* **Blocks are generated but not used.** `net.blocks` carries the block polygons and the subdivision
  report carries why each one stopped; nothing draws them yet. They are where buildings would go.
* **Extent 6 000 m runs out of memory** in `tools/headless.mjs` at Node's default heap. The editor
  itself has not been tried at that size.
