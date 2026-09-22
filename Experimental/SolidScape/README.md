# SolidScape

Node-based SDF terrain authoring tool — **UI shell only**. No SDF field solving is implemented yet;
every node is a visual declaration with live parameters, ports and wiring, but nothing is evaluated.

Layout: **viewport left · node editor right**, with a draggable splitter.

```bash
cd Experimental/SolidScape
npm install
npm run dev          # http://localhost:5173
```

---

## Viewport (left)

Three.js scene with a physically-derived **Hošek/Preetham sky dome**, sun directional light,
hemisphere fill, exponential-squared fog, a ground reference plane and a two-tier grid with
coloured world axes.

### Sun & Sky panel
Opened by the round sun button (top-right) or the rail's *Sun Placement* / *Sky Preset* tools.

| Group | Controls |
|---|---|
| Solar Position | Elevation, Azimuth |
| Atmosphere | Turbidity, Rayleigh, Mie, Mie Direction, Fog |
| Exposure | Exposure, Sun intensity |
| Reference | Ground tone, Grid toggle, Axes toggle |
| Presets | Midday · Golden · Overcast · Dusk |

All scrubbers drag horizontally, `Shift` for fine precision, double-click to reset.
Sun colour and fog tint shift automatically toward warm at low elevation.

### Camera schemes
Toggled by the segmented switch, top-right of the viewport.

**Fly · Unreal**
| Input | Action |
|---|---|
| RMB / LMB drag | Look |
| `W` `A` `S` `D` | Move relative to view |
| `Q` / `E` / `Space` | Down / Up |
| `Shift` | Sprint ×4 |
| `Ctrl` | Crawl ×0.25 |
| Wheel while looking | Trim flight speed |
| Wheel idle | Dolly forward |

**Orbit · Blender**
| Input | Action |
|---|---|
| MMB / LMB drag | Orbit pivot |
| `Shift` + drag, RMB drag | Pan pivot |
| Wheel | Dolly zoom |
| Numpad `.` | Frame scene |

Live status strip reports camera mode, speed, position, sun angles and frame rate.

---

## Node editor (right)

Infinite pan/zoom canvas with dotted-grid background, matching the reference design.

- **Pan** — MMB / RMB / `Alt` + drag · **Zoom** — wheel · **Marquee** — LMB drag on empty canvas
- **Palette** — `Tab`, right-click → *Add Node…*; search, arrow keys, `Enter` to place
- **Wiring** — drag port dot to port dot; type-checked, colour-coded per data domain
  (field · scalar · vector · colour · flow). Inputs accept one wire; dragging off an input detaches it.
- **Selection toolbar** — floats above selection: collapse, preview, pin, lock, rename, inspect, delete
- **Context menus** — separate node and canvas menus, header + keyboard hints
- **Settings dropdown** (round button, top-right) — canvas controls, snap toggle, background style
  (Dotted Grid / Line Grid / Blank)
- **Node parameters** — inline scrubbable pills with fill bars, `Shift` fine, double-click reset
- **Build pill** — bottom-left progress readout, re-runs on graph mutation

### Shortcuts
`Tab` palette · `Del`/`⌫` delete · `Ctrl/⌘ D` duplicate · `F` frame graph · `Esc` dismiss

### Node catalogue
| Group | Nodes |
|---|---|
| Generators | Simplex, Perlin, Value, MultiFractal, Cellular (Voronoi), White Noise |
| Primitives | SDF Sphere, Box, Plane, Cylinder |
| Combinators | Smooth Union, Subtract, Intersect, Mix Fields |
| Deformers | Domain Warp, Terrace, Hydraulic Erosion, Displace |
| Texturing | Slope Mask, Height Mask, Material Layer |
| Output | Terrain Output, Start |

---

## Source layout

| File | Role |
|---|---|
| `index.html` | Static shell — panels, toolbars, rails |
| `src/styles.css` | Design tokens + every component style |
| `src/viewport.ts` | Three.js scene, sky, dual camera schemes |
| `src/graph.ts` | Graph surface — pan/zoom, drag, wiring, marquee, selection |
| `src/nodeCatalogue.ts` | Node type declarations (ports, params, groups) |
| `src/icons.ts` | Inline stroke-SVG glyph set |
| `src/main.ts` | Composition — panels, palette, menus, shortcuts |

Design tokens are lifted from `References/UIComponents.html` so SolidScape matches the Slate kit.

## Not yet implemented
SDF field solving, meshing/raymarching, graph execution, serialisation, undo/redo.
