# SolidScape

Node-based SDF terrain authoring tool. The node graph compiles to a flat **edit tape** that is
raymarched live on the GPU (Phase 1 of `docs/SDF-Research.md`); SDF primitive nodes appear in the
viewport instantly and can be **sculpted on directly** with build / carve / smooth brushes. Sculpt
strokes are recorded as dab lists bound to the primitive under the cursor, so they flow through the
graph like any other edit — downstream erosion nodes will consume the same field.

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
coloured world axes. The SDF field renders through a full-screen raymarch pass that writes
`gl_FragDepth`, so it composites correctly with the grid — lit by the same sun, shadowed by a
soft sun-ray march, fogged by the same density.

### Sculpt toolbar (top pill)
| Tool | Key | Action |
|---|---|---|
| Select | `1` | LMB free for camera — no sculpting |
| Build | `2` | LMB drag adds material (`Ctrl` inverts to carve) |
| Carve | `3` | LMB drag subtracts material (`Ctrl` inverts to build) |
| Smooth | `4` | heavily-blended sunk dabs relax creases |

Brush tips: sphere · box · cylinder. `R` scrubber / `[` `]` / `Ctrl+Wheel` set radius; `S`
scrubber sets blend strength. The cursor ring projects onto the SDF surface and tints per tool
(white build · red carve · green smooth). While sculpting, RMB/MMB camera controls still work.

Strokes bind to the primitive node whose sub-field owns the surface at the first hit
(`AttributePoint`), raycast against a snapshot of the field taken at pointer-down, and space dabs
by travelled arc length with a carried remainder.

### Viewport Settings panel
Opened by the round sun button (top-right). Hosts everything that used to live in the old top bar:

| Group | Controls |
|---|---|
| Document | New · Save (`Ctrl+S`) · Load · Undo (`Ctrl+Z`) · Redo (`Ctrl+Y`) |
| Terrain Field | Resolution (Half/Full/Super render scale) · March Quality (Draft/Balanced/Fine) |
| Solar Position | Elevation, Azimuth |
| Atmosphere | Turbidity, Rayleigh, Mie, Mie Direction, Fog |
| Exposure | Exposure, Sun intensity |
| Reference | Ground tone, Grid toggle, Axes toggle |
| Presets | Midday · Golden · Overcast · Dusk |

Documents serialise to `.solidscape` JSON — nodes, wires, params and all sculpt strokes.

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
| `src/sdf.ts` | Edit-tape document — graph→tape compiler, CPU evaluator, raycast picking, dab attribution |
| `src/sdfPass.ts` | GPU full-screen raymarcher interpreting the tape (GLSL3, writes depth) |
| `src/sculpt.ts` | Brush engine — dab spacing, stroke binding, cursor projection |
| `src/graph.ts` | Graph surface — pan/zoom, drag, wiring, marquee, selection |
| `src/nodeCatalogue.ts` | Node type declarations (ports, params, groups) |
| `src/icons.ts` | Inline stroke-SVG glyph set |
| `src/main.ts` | Composition — panels, palette, menus, shortcuts, document/undo |

Design tokens are lifted from `References/UIComponents.html` so SolidScape matches the Slate kit.

## Edit tape (Phase 1 of docs/SDF-Research.md)

Three instruction kinds, 3 RGBA32F texels each, interpreted identically by GLSL and the CPU mirror:

| Op | Meaning |
|---|---|
| `PUSH` | push a primitive distance (sphere / rounded box / cylinder / ground plane) |
| `COMBINE` | pop two, push smooth union / subtraction / intersection |
| `DAB` | blend a sculpt dab into the top of stack |

This is the deliberately brute-force analytic layer — the whole tape re-evaluates per pixel per
step, expected to strain past a few hundred edits. The brick cache (Phase 2+), Lipschitz pruning
and stroke coalescing described in the research doc replace it without changing the document model.

## Not yet implemented
Brick cache / incremental evaluation, noise generators and erosion actually deforming the field
(nodes pass through), meshing/export, stroke coalescing.
