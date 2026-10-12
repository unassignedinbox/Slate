# Road Editor — design

Slate's Road Editor generates, edits and renders a road network at a scale where the usual tricks stop working. This document is the map of the
system: what each layer guarantees, the encoding the GPU reads, and the handful of decisions that everything else is built on.

---

## 1. The brief, and what it rules out

The requirement was a city you can drive through — NFS extent, real detail, clean topology — with the whole vocabulary of street cross-sections: kerbs,
bricks, boulevards, footways, cycle lanes, bus lanes, parking, speed tables, bollards, markings, railway crossings, subways. Buildings were explicitly
out of scope.

Four consequences follow, and they shape everything:

1. **The surface is the product.** A kerb is not a decoration bolted on later; it is a 150 mm step in the same ribbon as the carriageway. Detail has
   to come out of the geometry that already exists, or it will not survive an edit.
2. **Clean topology is a generation property, not a render property.** Roads share nodes; a node owns the corner fillets of every junction it
   participates in. There is no "welding pass" that could fix it later, because an author's click can always create a new near-miss.
3. **Detail at 4 km scale cannot be per-feature objects.** 124 km of network with an object per marking is tens of millions of draws. So markings,
   pavement symbols, humps, tints and materials are *attributes of a vertex*, and street furniture is instanced per type per macro-cell.
4. **An edit must not re-upload the world.** Everything is sector-bucketed with a content signature, so a moved node costs one tile.

## 2. Pipeline

```
 generateCity(opts)          SceneDocument                     buildWorld(doc, S)                        GPU
 ───────────────────         ─────────────────                 ──────────────────────────                ──────────
 nodes / roads / lots  →     ops + undo records          →     fair → stations → skin → junctions   →   sector tiles
 transit / rail / water      every mutator wrapped             → ground → lots → props → transit          + instanced props
                             in a transaction                  → clash pass → compile sectors             + atlases
```

The arrow into `buildWorld` is the only boundary that matters. Everything to the left is plain data that must survive `JSON.stringify`; everything to
the right is disposable. That is what lets the bake run in a worker, be redone after every edit, and be replayed identically in `tools/Check.js`.

## 3. Document

`Document/SceneDocument.js` holds `nodes` (a map, `id → {x, z, y, i, j}`), `roads`, `lots`, `transit`, `crossings`, `meta`, plus a `layers` map for
visibility. A road is `{id, profile, points[], nodeA, nodeB, y0, y1, camber, bumps[], markings, struct, deck, cls, electrified, curbRadius, layer,
noJunction, noStructure, oneWay, gaps[], crossings[]}`.

Two rules carry a lot of weight:

- **`node.y = null` means "follow the terrain".** The kernel owns the surface field (`CurveKit.terrainY`), so an authored height is an *offset above
  the ground*, not an absolute. The generator never bakes terrain into nodes; the bake samples the field once per station and adds it everywhere it
  is needed — road, junction patch, lot cap, rail, tunnel. This is the only reason an undulating site does not fabricate a cut wall every 1.35 m.
- **Every mutator runs inside `transaction(label, fn)`.** A transaction accumulates inverse ops and emits one `record` event; anything that calls
  `_record` directly is invisible to history and is therefore a bug. `UndoSequence` coalesces same-label records inside 700 ms, so dragging a node is
  one undo step, not 400, and `seal()` ends a gesture. No whole-document snapshots: at 3.7k roads a snapshot is ~2 MB and the depth is unbounded.

`splitRoad` records `{pre, post, nodeId}` with a matching inverse; `applyOps(ops, dir)` replays either direction. `serialize()`/`load()` accept the
generator's node map or an array, so a generated city and an authored one are the same file.

## 4. Sections (`Kernel/ProfileSolver.js`)

35 authored cross-sections, each a list of *bands* (`carriageway`, `cycle`, `bus`, `parking`, `verge`, `footway`, `median`, `buffer`, `tram`, `quay`,
`shoulder`, `barrier`, …) with a width, a material, a mark pattern and a tint. `resolve(def)` mirrors and doubles a band when it is authored as
`sym`, and shared-surface streets (a cycle lane painted on the carriageway) must be `full` so they inherit the road's material instead of stacking a
second surface.

`PROFILE_BY_CLASS`, `profileSpeed` and `profileIsHard` feed the skin solver: the dash period, the step size, the kerb height and whether a band is
rigid all come from the section, never from a per-road special case. `profileSvg(id)` is the same data drawn as a section diagram, which is what the
profile browser in the UI shows — so the picture and the mesh cannot disagree.

Materials are a 24-entry table (`MAT`) with a colour and a roughness/wetness row; markings are 28 codes (`MARK`); symbols are 20 (`SYM`); tints 7
(`TINT`). Renaming those ids is not allowed: they are packed into a vertex byte.

## 5. Skinning (`Kernel/SkinSolver.js`)

For each road: `fairRoad` (Chaikin + curvature-adaptive resample from `CurveKit.sample`) → `stationsFor` (a station every `stepScale` metres, denser
on tight curves, trimmed where a junction took the corner, elevated by grade + camber + terrain) → `skinRoad` (a band ribbon per profile band, with
the kerb face as a zero-length quad) → `emitStructure` (fill slopes, cut walls, bridge soffits, measured against the ground under the road) →
`bumps` (speed tables, which displace the surface and drive the shader's chevron pattern).

### Vertex encoding

Every emitter funnels through `MeshSink.quad()` / `tri()`, writing 48 bytes per vertex across six streams:

| stream | w | contents | read as |
|---|---|---|---|
| `position` | 3 | world position | float3 |
| `aST` | 2 | station along the road, offset across the band | float2 |
| `aDist` | 4 | `distLeft, distRight, sAtStart, length` | float4 |
| `aMisc` | 4 | `material, tint, symbol, flags` | uint bytes, not normalised |
| `aMark` | 4 | `mark0, mark1, period, flags` | uint bytes |
| `aBump` | 1 | bump displacement | float |

From `aDist` the shader derives everything: `halfW = (x + y) * 0.5`, the signed centre offset `tc = (x − y) * 0.5`, and `min(x, y)` — the distance to
the nearest edge, which is what makes a 150 mm kerb read as a crevice without a normal map. There are no normals in the buffer; they come from
`normalize(cross(dFdx(P), dFdy(P)))` flipped by `gl_FrontFacing`, which is free and always correct for a surface this smooth.

Markings are analytic: `band(d, 0, w, aa)` with `aa = max(fwidth(d) * 0.9, 0.0015)` — a dash is a modulo of the station, its period scaled by the
section's design speed (`round(4.5 + 0.17 · profileSpeed)`, clamped), its on-fraction 0.34. Approach distance is `aDist.z` for a two-way left band and
`aDist.w` otherwise, which is what puts a stop bar on the correct side of a junction. `FLAG.LIT` marks an emissive strip; `uXray`, `uWet`, `uDetail`
and `uMarkings` are the four global knobs.

### Junctions

`buildJunctions` walks every node, sorts its incident approaches by outward bearing, and for each corner builds a quadratic Bézier fillet whose radius
is the road's `curbRadius` in metres times the global scale. Trims are pulled back by `Q.t + r / tan(max(0.30, π − φ) / 2)`, clamped to 1.4–44 m —
that term is why an acute corner does not swallow either leg. The mouth is ear-clipped into a `FLAG.PATCH` surface lifted 5 mm above the node, and a
degree-1 end becomes a hammerhead. Two near-opposite free ends on the same axis get no patch at all, because a patch there is a wedge nobody drives on.

`FLAG.RAMP` dropped kerbs are emitted at the corner bulbs so a wheelchair crossing exists in the mesh, not in a decal.

### Clash, rail, transit

`ClashSolver.resolveClashes` finds where a road crosses a rail line and stamps `road.crossings[{s, t, half, angle, key, rail, flash, gate}]`, cutting
`rail.gaps` so the track does not run through the deck; `emitGradeCrossing` paints the grooves, the white band, the flashing lights and the gate arms.
`TransitSolver` builds twin bored tubes with vent shafts and station shells; `deck`/`metro` roads get a soffit and piers via `emitStructure`.

## 6. Props (`Kernel/PropSolver.js`)

Lamps, sign gantries, trees, bollards, planters, bins, bus shelters, rail posts, drainage and substation boxes are one instance record each: 32 bytes
of `x, y, z, yaw, scale, cell, colour, extra`. PropSolver emits them in a *coarse* pass — one bucket per 660 m macro-cell × type — so a cell is a
single instanced draw, and the geometry comes from `Presentation/PropGeometry.js` templates (28 of them, authored with +Z along the direction of
travel and +X to the right, so the yaw from the road's tangent is all the placement math there is).

`features(prof)` decides what a section asks for: a verge gets trees, a footway gets lamps and bins, a median gets planters, a cycle track gets
bollards only where it is raised. `density`, `propMacro` and the six `props*` layer switches are exposed in the UI as exactly that, so the cost of
the detail is adjustable at the same place it is created.

Props read `terrainY` directly for parks and verges — they are placed on the ground, not on a road, so they do not need the station machinery.

## 7. Sectors and streaming

`MeshSink.Sectors` buckets every quad by the centroid of its two middle vertices into 220 m tiles, so a road crossing three tiles contributes to three
of them and no tile ever needs a neighbour to render correctly. `compileSectors({merge})` packs the streams and quantises each tile's bounding box to
1e-4 so a re-bake with identical content produces a byte-identical signature.

`Presentation/SectorManager.js` diffs on `verts|tris|min|max|lo|hi`. Unchanged tiles are not touched: an edit to one intersection re-uploads one
`BufferGeometry`. Prop instancing is rebuilt per apply — it is the cheap half — and LOD tiers `[190, 520, 1400]` m decide which prop sets are visible
at the current camera distance, with `lodScale` as the quality knob. `setXray` swaps to a mode where only emissive strips and transit survive, which
is how you read a metro alignment under 4 km² of city.

## 8. Presentation details

- **Atlases are generated, not shipped.** `Atlas.markingAtlas()` paints the 8×8 cell of road symbols (arrows, legends, cycle, bus, tram, give-way)
  into a canvas at load; `signAtlas()` does the same for the 32 sign faces. No binary assets, no missing-file failure, and the atlas is exactly what
  `SIGN`/`MARK` promise.
- **Colour management is manual.** The road and prop shaders do their own sRGB encode with `NoToneMapping`, because three's tonemapping chunks are
  inconsistent with a hand-written fragment that also has to match the sky and fog. Fog is `exp²` — `mix(col, uFogColor, 1 − exp(−(d · uFog.x)²))` —
  and every material in the editor implements the same line, or the horizon shows a seam.
- **Lighting is a mood, not a light rig.** `MOODS` (noon, golden, dusk, night, overcast) set sun direction, colours, fog, wetness and the emissive
  floor; `Lighting.apply(materials)` writes them into uniforms. Night turns on `FLAG.LIT` strips, lamp glow and signal heads — which is the honest
  test that the emissive channel is wired to geometry rather than to a texture.
- **Overlays** (selection ribbon, tool preview, node handles) are separate meshes with `depthTest: false`, `renderOrder: 900` and
  `frustumCulled: false`. A selection highlight that z-fights with the road it highlights is worse than none.

## 9. Interaction

`Interaction/ToolSession.js` is the prompt machine, and it is the piece the whole editor feels like. A tool declares ordered prompts; each is
satisfied by a snapped click or by the typed grammar; `point()` may return `'commit'` or `'cancel'`; a `multi` tool keeps taking points until
`Enter`. The session owns axis and plane locks, the rubber band, the `raw` point and the undo-seal on finish, and it never writes to the document
except through its tool's `commit`.

`Snapper.resolveSnap` runs a chain — node, then line, then grid, then the typed number — and reports which won, so the record bar can say `snap: node
241` instead of leaving you guessing. `CameraFly` is the Unreal half: right-drag look, middle-drag pan, wheel speed, `WASDQE`, sprint and crawl
modifiers, `F` for pointer lock, and `fit(box)` which frames any AABB, including the whole city.

`HotkeyChart` keeps a global map and a modal map; the running tool gets first refusal on every key, which is why typing `r12` never triggers the road
tool's `r`. Bindings are editable at runtime (`bind`, `unbind`, `hotkeys`), exported, imported.

## 10. Runtime

`Runtime/BakeWorker.js` receives `{type:'bake', doc, settings, revision}`, calls `buildWorld`, and transfers the packed typed arrays back — a copy of
90 MB of geometry becomes a pointer move. `BakeClient` debounces 140 ms, never duplicates an in-flight bake (the newest revision queues behind it),
applies results by revision so a stale answer cannot overwrite a newer one, and falls back to an inline bake if workers are unavailable, in which case
the editor still works and says so in the record bar.

## 11. UI

The chrome is modelled on Frontier's Project-Zero viewport header (`SultanAladin/Frontier-`, `Docs/Design/ViewportHeader.html`), including the
critique that shipped with it — never three controls saying the same state, and no dead buttons. What that means here, concretely:

- a 34 px rail in three zones: scene tools left, the **mode pill in the centre is the state** (edit / drive / inspect, not a label for it), view
  controls right;
- 26 px controls, 10.5 px small caps at `0.11em` tracking, `--accent:#4fd8e0` for interaction, `--sim:#6c77ff` for anything that runs, `--warn` for a
  pending prompt;
- one 2 px hairline under the rail that fills as the bake runs — the only progress affordance in the app;
- a record bar, always present, that says which tool is live, which prompt it is on, what you have typed, what it snapped to, and how long the last
  solve took;
- collapsible cards whose body is the live document, rebuilt rather than patched, so there is no second copy of state to drift.

The section atlas in the right panel is the profile browser: every section drawn from its own definition, filtered by text, click to set the draw
section — or, with a selection, to retarget the roads. The minimap is a canvas that redraws from `doc.bbox()` on change and takes a click into
`camera.goTo`; the console is the same verbs as the hotkeys, with history and completion.

## 12. Verification

Two gates, both headless, both in `npm test`.

`tools/Check.js` — the kernel. 35 profiles resolve to ordered finite sections; a 9-road fixture bakes to a kerb-height-correct, index-in-range,
NaN-free mesh; junction patches solve; free ends cap; determinism holds (two bakes of one document agree byte-for-byte, which is what licenses sector
diffing). It prints the triangle count per kilometre, which is the number to watch when a change touches station spacing.

`tools/Smoke.js` — the wiring. It installs a ~150-line micro DOM (`tools/dom.mjs`), boots the **real** `main.js` with a stub viewport, then: expands
every card, clicks every chip and slider, switches every mood, starts all ten tools, draws a road with three canvas clicks and `Enter`, verifies the
document grew and the bake landed, types `r14` into a radius prompt and checks it reached `road.curbRadius`, presses every bound key, presses every verb in the table (36, aliases included)
and rejects an unknown one,, switches modes, round-trips the document through `serialize`/`load`, and finally feeds a real bake through `SectorManager` to assert that tiles
index inside their own streams, that an unchanged tile is never re-uploaded, and that moving one node re-uploads 1 of 58. 50 checks.

Between them they cover everything except pixels: no GLSL is compiled and no draw is issued in either. That is the honest limit of this harness, so the
shaders are reviewed by hand and the material contract above is written down rather than inferred.

## 13. Known limits, in order of what I would fix first

1. **Bus lanes are surface-painted, not enforced.** There is no time-of-day rule and no lane-specific restriction logic — the marking is honest about
   what it is.
2. **`sprawl` generation is 4× slower than the other styles** (Poisson-ish rejection sampling). It is the one style that would benefit from its own
   worker.
3. Micro-road stubs at rail and water abutments survive `mergeMicroRoads(14)`; they are correct aprons, but they inflate the road count.
4. Junction fillets assume a single profile per corner; a motorway-to-boulevard pair reads as an odd radius rather than a taper.
5. No terrain painting: the surface is one analytic field plus `amp`, authored from the generator card, not editable with a brush.
