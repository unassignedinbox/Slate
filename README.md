# Slate

## Road Editor (experimental)

A browser-based road and city layout editor for open-world, NFS-style maps. Roads are edited as
lane cross-sections, so bus lanes, bike lanes, parking, curbs and medians are first-class. Buildings are
intentionally out of scope; this is roads and their furniture only.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # geometry, model, city generator and mesh tests
npm run build    # type-check + production build
```

### Controls
| Input | Action |
|---|---|
| RMB hold + mouse | Look (Unreal-style) |
| W A S D / Q E | Fly forward/left/back/right, down/up (only while RMB is held) |
| Shift | Boost ×3 |
| Wheel | Adjust fly speed while RMB held; dolly otherwise |
| 1 / 2 / 3 / 4 | Select · Draw road · Place prop · Erase |
| LMB (Select) | Pick road or prop; drag white handles to reshape |
| PageUp / PageDown | Raise / lower the selected control point 0.25 m |
| Enter, double-click | Finish a drawn road · Esc cancel |
| F | Frame selection · G toggle snap |
| Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) | Undo / redo |
| Del | Delete selection |

### What the editor models
- **Roads / paths / rail / subway** as Catmull-Rom or straight polylines with per-point elevation.
- **Cross-sections** as ordered lanes (`driving`, `bus`, `bike`, `parking`, `shoulder`, `median`, `sidewalk`, `pedestrian`), each with width and travel direction. Presets: highway, avenue (bus + bike + parking), arterial, local, alley, cycleway, footpath, promenade, rail, subway.
- **Generated detail**: curb faces where raised lanes meet others; lane markings (yellow centre lines, dashed white lane lines, solid edges, parking bays, direction arrows); zebra crossings at junctions; junction discs.
- **Props**: bollards (repeating), speed bumps, street lights (repeating), bus stops, subway entrances.
- **Railway crossings** are derived automatically wherever a rail line crosses a road: crossing pad, gate booms and posts.
- **Subway lines** render as underground tunnels (toggle in the top bar).

### City generator
`Generate city…` builds a jittered street grid (avenues every 6 blocks, arterials every 3, local
streets between), a highway ring with ramps, a rail line, two subway lines with stations, footpaths,
and street furniture. Seed and block count are adjustable.

### Files
- `src/core/` — pure data model, geometry, city generator (no DOM, no three.js)
- `src/render/` — pure mesh builder and network-to-mesh conversion; three.js materials and view
- `src/editor/` — editor state, tools, undo, fly camera, DOM UI
- `tests/` — Node test suite

### Save format
Networks are JSON (`format: "slate-roads"`, `version: 1`). The editor autosaves to browser storage
and can import/export the file.

### Known limitations
- Junctions are flat discs with zebra stripes; curb returns at corners are not modelled.
- Rail crossings are at grade only (no over/underpasses yet).
- Full mesh rebuild on each edit (≈0.9 s for the default ~57 km city in headless Chromium); dragging large
  networks will feel laggy. Incremental per-road rebuild is the next performance step.
- Export is JSON only; no engine-native (Project-Zero) format yet.
