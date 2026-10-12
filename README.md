# Slate Pursuit

An AI-driven 3D street-racing and police-pursuit game on a procedurally generated city.
**You do not drive.** Every racer, police unit, helicopter and drone is AI-controlled; you are a
spectator with a camera (free fly, chase cam, or an auto director that cuts between the hot targets).

The city comes from the Frontier Road Editor's generator (4 km × 4 km, ~225 km of road, junctions,
roundabouts, bridges, a river, one-ways and cul-de-sacs). The renderer is three.js.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (add ?seed=1337&size=4096 to pick the city)
npm run build        # production bundle in dist/
npm run test:sim     # headless simulation checks (node)
npm run test:map     # headless map-generator check (node)
```

## What is in the game

- **Racers** – AI cars run a one-lap loop across the city on a 3–5 km course with a grid,
  overtaking through lane changes, and a live standings board.
- **Heat & police** – racers who run well over the limit build *wanted* points. Heat levels 1–5
  dispatch more cruisers (low-poly, Crown Victoria-style livery with an animated light bar),
  a helicopter, recon and interceptor drones. Officers PIT racers, lay tire nets, fire jammers and
  EMP pulses, raise bollards, and set up roadblocks. Racers get **busted** when stuck with officers
  on them, or **escape** once the heat cools.
- **Bollards** – rising security posts set into the carriageway. When raised they stop traffic
  across the full road width; cars standing on them are stunned. Some are placed on the race loop
  itself so lockdowns happen on the route.
- **Roadblocks** – police chicane (parked cruisers across the lanes), photon wall (holographic laser
  barrier that stops and stuns, overloads after three hits) and drone wall (five interceptors holding
  the lanes; hitting one destroys it and jolts the car).
- **Gadgets** (replacing spike strips and adding new ones)
  - *Tire net* – magnetic lock-net across lanes; locks tyres (replaces the spike strip).
  - *EMP pulse* – stalls every non-police vehicle in radius for ~4 s and downs drones.
  - *Signal jammer* – 12 s field that makes racers drift and slow and makes air units lose their link.
  - *Photon wall* and *drone wall* (above) and *bollard lockdown* (above).
- **Drones** – recon drones tag the target (adding heat while tagged); interceptor drones dive and
  deliver a shock pulse; wall drones make the drone-wall roadblock.
- **Helicopter** – orbits the hottest racer with a searchlight, drops tire nets ahead, calls jammers.

## Controls

| Key | Action |
| --- | --- |
| 1 / 2 / 3 | Free camera / follow selected car / auto director |
| Tab, `[`, `]` | Next / previous target |
| F | Follow the hottest racer |
| RMB + mouse, RMB + WASD/QE, Shift, wheel, MMB | Free camera (any manual input switches to free) |
| Space | Pause |
| T | Cycle simulation speed (0.5×, 1×, 2×, 4×) |
| N | Skip to the next race |
| M | Toggle minimap |
| H | Toggle help |

## Layout

```
src/
  main.js                 entry: generate city → build sim & view → frame loop
  map/road/               road-network generator and geometry (from Frontier RoadEditor, see NOTICE)
  map/render/             textures, materials, street-furniture library (from Frontier RoadEditor)
  game/sim/               pure game logic, no three.js or DOM (testable in node)
    graph.js              drivable graph, routes, race loops
    traffic.js            vehicles, IDM car following, lane changes, junction transfers
    race.js               grid, standings, wanted points, bust/escape
    police.js             dispatch, chase/intercept, PIT, gadget use, roadblocks, lockdowns
    gadgets.js            tire nets, EMP, jammers, photon walls
    bollards.js           rising bollard gates
    air.js                helicopter, recon/interceptor drones, drone wall
    index.js              GameSim facade (fixed-step update, heat, civilians, events)
  game/view/              three.js rendering
    scene.js              renderer, sky/night lighting, per-frame sync of all objects
    city.js               road chunks, instanced furniture, ground, river
    models.js             low-poly cars, police cruiser, helicopter, drones, gadget meshes
    rig.js                free / follow / director cameras
    hud.js                heat, standings, target card, feed, minimap
    camera.js             fly camera (from Frontier RoadEditor)
scripts/
  sim-test.mjs            full-game invariants over several virtual minutes
  map-smoke.mjs           generator + mesh build check
```

## Licensing note

The `src/map/` code is taken from `SultanAladin/Frontier-` (branch `arena/80ae15cf-frontier`,
`Experimental/RoadEditor`). That repository has no LICENSE file and its NOTICE says no licence
is granted, so **reuse needs the owner's permission before this project is distributed.** See
`src/map/NOTICE.md`.
