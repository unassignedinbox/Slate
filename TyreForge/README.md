# TyreForge — Racing Tyre Lab

Procedural 3D racing-tyre generator for game development. Zero build step:
open `index.html` from any static server (e.g. `python3 -m http.server`).
Three.js r169 is vendored under `vendor/` — works fully offline.

## What it does

- **11 named tyre presets** across slick, semi-slick, street/grip, rain, drift,
  rally, off-road, snow/ice (studded), GT wet, concept and touring — e.g.
  `GZERO RS` (racing slick), `GRIZZLY MAGNUM MT` (mud-terrain),
  `DRIFT KAIJU SS` (stretched drift), `HYDRO SPEAR V` (directional rain).
- **Correct procedural profile** — section width / aspect ratio / rim size in
  real units, bulged or stretched fitment from rim width, shoulder arc, crown.
  Live cross-section drawing with dimensions + HUD stats (overall diameter,
  mm/revolution, revs/km, fitment verdict).
- **Visible tread AND sidewall** — tread is real displaced geometry driven by a
  procedurally baked height-field (displacement + normal + albedo + roughness
  maps). Sidewall branding, size codes, load indices, wear markers and rotation
  arrows are painted per tyre (readable on both sides).
- **New → worn** — wear slider grinds rubber off contact surfaces: shallow sipes
  disappear first, tops polish, camber slider adds shoulder wear.
- **Tread lab editor** — design your own tile: longitudinal channels, lateral
  grooves, wavy sipes, chevrons, **circular/ring grooves**, **hexagons** & hex
  block grids, lug pockets, ice studs. Drag elements on the tile, tune every
  parameter, change pattern pitch around the tyre.
- **Game export** — one-click `GLB` with displacement-baked tread geometry
  (metres), plus heightmap / normal / albedo / roughness / sidewall PNGs and a
  spec JSON (diameter, circumference, revs/km, pattern) for your tuner.

## Files

| path | role |
| --- | --- |
| `js/treads.js` | height-field tread engine, wear model, preset library, name generator |
| `js/tyre.js` | profile geometry, tread band, rim, texture bakes, GLB export |
| `js/sidewall.js` | sidewall lettering/markings painter |
| `js/editor.js` | 2D tread-tile editor |
| `js/main.js` | scene, lighting, UI wiring |
