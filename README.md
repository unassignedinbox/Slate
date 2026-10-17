# Slate

Game levels, built greybox-first. The current level is **Section 1 — Fragmented
Town**, a point-to-point race through a floating, broken town linked by portals.
See [`docs/levels/fragmented-town.md`](docs/levels/fragmented-town.md) for the
design.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (binds 0.0.0.0)
```

URL options: `?overview` (whole-town view), `?from=A|B|C` (drop the car at a
zone), `?debug` (route lines and wheel probes).

## Test and report

```bash
npm test           # level structure, clearance, and a headless drive
npm run report     # zones, portals, counts and leg times
npm run build      # production build
```

## Layout

```
src/engine/            generic: math, splines, anchors, ground probes, car, race, world, autopilot
src/levels/<level>/    designer data (layout.js) and procedural builders
src/render/            Three.js view, HUD, input (no game logic)
tests/                 node:test suites
tools/                 designer report
docs/levels/           level design notes
```
