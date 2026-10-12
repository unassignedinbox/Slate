# Slate — Road Editor

A road-network editor that generates and authors cities at driving scale: kerbs, paving bricks, boulevards, cycle tracks, bus lanes, parking bays,
speed tables, bollards, road markings, tram grooves, level crossings and a bored metro — all baked into clean, sector-aligned topology you can fly
through with an Unreal-style camera.

Buildings are deliberately out of scope. Everything here is the surface you drive on, and the network that carries it.

```bash
npm install
npm run dev        # http://localhost:5173  — the editor
npm run build      # production bundle, worker emitted as its own chunk
npm test           # kernel gate (tools/Check.js) + headless UI gate (tools/Smoke.js)
```

`npm run dev` prints a LAN URL; the editor binds `0.0.0.0:5173` and accepts any host, so it works behind a proxy unchanged.

## Moving the camera

| | |
|---|---|
| `W A S D` / `Q` `E` | forward, back, strafe, down, up |
| right-drag | look · middle-drag pan · wheel = speed |
| `Shift` / `Ctrl` | sprint / crawl |
| `F` | pointer lock (pawn mode) |
| `Home` | frame the whole city |

## Editing

Click a road to select it, then edit it in the right-hand card. Drawing is prompt-driven, so a tool tells you what it wants and accepts either a
snapped click or a typed number:

`3` length · `12,45` length+angle · `a45` angle lock · `r12` kerb radius · `x40` / `z40` axis lock · `@120,-40` absolute · `Tab` next field ·
`Backspace` delete a point · `Esc` back out · `Enter` commit

| | |
|---|---|
| `R` / `N` / `K` / `V` | draw road · move node · split · add vertex |
| `H` / `J` / `C` | speed hump · kerb radius · weld two free ends |
| `Del` / `Esc` / `Enter` | delete selection · back out of a prompt · commit |
| `G` / `X` / `P` / `O` | grid snap · x-ray · props · markings |
| `Tab` / `F` / `Home` | edit → drive → inspect · pointer lock · frame the city |
| `B` / `1`–`5` / `?` / `~` | re-bake · light mood · hotkey chart · console |

The console is the fast path for anything batch: `generate style=dutch seed=7 terrain=9`, `sector`, `props off`, `profile AVE-4`, `bind ctrl+g
generate`. Everything it can do, the panels can do, and vice versa — there is one document behind both.

## Layout

```
Editor/RoadEditor/
  Kernel/        geometry, sections, tessellation, props, transit — no DOM, no three.js
  Generation/    the city generator (grid, organic, superblock, sprawl, dutch, circuit)
  Document/      the scene graph, ops, undo — every edit is a reversible op record
  Interaction/   camera, snapping, hotkeys, prompt sessions, the tools
  Presentation/  atlases, materials, instanced props, sector streaming, the viewport
  Runtime/       the bake worker and its debounced client
  UI/            Frontier-style chrome: rail, cards, record bar, minimap, console
```

`tools/Check.js` and `tools/Smoke.js` are the two gates: the first proves the kernel produces sane, finite, deterministic geometry; the second boots
the actual editor against a micro DOM, clicks through its panels, draws a road with three clicks and a typed radius, and diffs the resulting scene.

## What it costs

Measured at `half:2300` (a 4.6 km square) with props and metro on, seed 7 — one bake, whole city, on a single core in Node:

| style | roads | network | triangles | sectors | junctions | prop instances | generate | bake |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| grid | 3,741 | 124.5 km | 699,917 | 1,185 | 2,543 | 48,879 | 1.2 s | 1.3 s |
| dutch | 4,748 | 134.2 km | 667,317 | 1,287 | 3,419 | 54,887 | 1.5 s | 1.1 s |
| sprawl | 5,200 | 113.5 km | 797,018 | 1,244 | 4,675 | 46,990 | 4.2 s | 0.9 s |
| circuit | 4,567 | 120.0 km | 728,876 | 1,380 | 3,253 | 46,469 | 1.5 s | 0.9 s |
| superblock | 3,341 | 121.8 km | 666,590 | 1,193 | 2,193 | 48,032 | 0.9 s | 0.8 s |
| organic | 3,425 | 136.4 km | 641,631 | 1,219 | 2,197 | 56,254 | 0.9 s | 0.9 s |

Terrain is free: the same grid at 9 m of relief produces the identical triangle count, because roads follow the surface instead of fighting it.
Adding or moving one node re-uploads 1 of ~1,200 tiles.

See [Docs/RoadEditor.md](Docs/RoadEditor.md) for the design: the section solver, the vertex encoding, the junction fillets, and why the UI looks
the way it does.
