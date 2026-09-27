# Operation Slate — D-Day, the run to the wall

A low-poly Three.js driving game. You come ashore in a requisitioned saloon on a
defended beachhead. The Atlantic Wall is four and a half kilometres inland and
the only way through is the gate. The tide is rising behind you.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake, then reverse |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `C` | cycle camera (chase / bonnet / high) |
| `P` | pause · `M` mute · `R` restart |

## The run

* **The course.** 4 434 m of graded road from the surf line to the gate, plus a
  955 m coastal bypass and two spurs. Long sweepers, two hairpins, a sunken
  lane, a ruined-village chicane and a chokepoint where the carriageway is
  mined. Nothing on the route is straight for long.
* **The wall.** A 44 m curtain spanning the whole map, built from 22 m panels
  each founded on the ground beneath it so it follows the terrain with a dead
  level crest. It has buttresses, counterforts, crenellations, MG towers and
  one gate. Drive through the gate and you have won.
* **The tide.** Sea level climbs 0.135 m/s after an eight second grace period,
  from −9.5 m to +17.5 m. The beach is shallow, so the water eats the first
  kilometre fast and then slows as the ground climbs. Over 1.25 m of water and
  the engine floods.
* **The defence.** 26 bunkers, casemates and Tobruk nests, each with a sentry
  MG that tracks the car inside 330 m, fires seven-round bursts of real tracer
  (ballistic, travelling rounds — no lasers) and loses you behind mounds,
  trenches and wrecks. Ground fire is joined from about two minutes in by
  low-poly dive bombers that siren, release, and pull off the road line.
* **The ground.** 45 earth mounds, 98 craters, eight revetted trench systems,
  20 belts of barbed wire (concertina coils and four-strand apron fences on
  angle-iron pickets), 10 sandbag walls, 99 Czech hedgehogs, 298 dragon's
  teeth, 15 barricades and Belgian gates, 18 static tanks in berms, 326 mines
  of which 46 are Teller mines with the cross-shaped pressure spider.
* **Repairs.** Six engineer dumps sit just off the carriageway under a
  red-cross pennant. Drive into one for +38 hull. They cost you a line and a
  little time, which is the point.

## Layout of the code

```
src/
  config.js            world scale, tide, car, weapon and palette constants
  game.js              the loop: input, damage, tide, win/lose, camera, HUD feed
  world/
    route.js           road network as splines, with grading and progress lookup
    layout.js          deterministic placement of every fortification and prop
    field.js           heightfield + road raster + surface classification
    terrain.js         the terrain and road ribbon meshes
    battlefield.js     builds and batches the world in loader stages
    ocean.js, sky.js   tide surface, sun, clouds, smoke columns
  props/               bunkers, mines, wire/teeth/hedgehogs, vehicles, scatter
  entities/            car, sentries, bullet pool, aircraft, particle effects
  systems/             collision grid, WebAudio engine and weapons
  ui/hud.js            DOM HUD, minimap, briefing and result cards
```

The world is built once from a fixed seed (`WORLD.seed = 19440606`), so every
run is the same battlefield. Static geometry is merged per material by the
batcher — the whole beachhead is a few hundred draw calls.

### Build order

`route → layout → Field → roads.gradeTo → field.bakeRoads → meshes → Ocean`

`field.bakeRoads()` must run after the roads are graded and before any
`height()` / `surface()` query, or the terrain will not know where the roads
are.

## Headless tooling

There is no browser in CI, so the game is verifiable from Node alone:

```bash
node scripts/gen-check.mjs    # generation sanity: grades, surfaces, tide table
node scripts/sim.mjs          # autopilot playthrough + damage tally by cause
SIM_GOD=1 SIM_FRAMES=26000 node scripts/sim.mjs
node scripts/profile.mjs      # ms/frame per subsystem, mesh and triangle census
node scripts/render.mjs       # software rasteriser -> shots/*.png
SHOT=wall,car node scripts/render.mjs
```

`scripts/render.mjs` is a small z-buffered CPU rasteriser that understands the
scene graph, instanced meshes, vertex colours, unlit materials and fog, and
applies the same ACES tone map and sRGB encode as the WebGL renderer. It exists
so the look of the game can be checked without a GPU. The PNGs in `shots/` are
its output.

`new Game(null, null, null, { headless: true })` gives you the full simulation
with no DOM: `await load(); start();` then call `game.step(dt)` and read
`game.car`, `game.stats`, `game.ocean.level`.
