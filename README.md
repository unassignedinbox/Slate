# Slate

Level design work for Slate. Currently: **Section 1 — Tallow Hill**, a greybox race through a town that has broken loose from the ground.

## Layout

- `levels/fragmented-town/`: the level design
  - `DESIGN.md`: intent, structure, rules, and open questions
  - `layout.js`: shards, legs, portals and hand-placed blocks (the numbers you tune)
  - `town.js`: deterministic town generation and validation
  - `check.mjs`: headless checker. Validates the layout and prints par times
- `greybox/`: the playable greybox (Vite + Three.js)
  - `src/sim/`: pure simulation: road, car, runs, autopilot, tuning
  - `src/render/`: scene building (town, road, gates, car)
  - `src/main.js`: game loop, input, camera, HUD

## Run

```bash
cd greybox
npm install
npm run dev      # live preview on port 5173
npm run check    # validate the layout; exits non-zero on any failure
```
