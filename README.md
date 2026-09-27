# MOTORBALL — Iron City Grand Prix

The Motorball track from **Alita: Battle Angel**, redesigned as a drivable 3D racing
circuit — banked half-pipe trough, tunnel undercross, 18 m crossover bridge, 100k-seat
stadium, Zalem hanging overhead — plus a low-poly 90s-sedan race car to test it with.

Built with [three.js](https://threejs.org/). No assets: every texture, mesh and sound is
generated at runtime.

![Circuit layout](docs/track-map.png)

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # static bundle in dist/
npm run preview
```

## Controls

| Key | |
| --- | --- |
| `W` / `↑` | throttle (also starts the countdown) |
| `S` / `↓` | brake, then reverse |
| `A` `D` / `←` `→` | steer |
| `Shift` | nitrous boost |
| `Space` | handbrake / drift |
| `C` | cycle camera — chase, close, hood, trackside, free orbit |
| `R` | restart the race |
| `L` | change livery |
| `M` | engine audio on/off |
| `B` | bloom on/off |
| `H` | hide the HUD |
| `` ` `` | show/hide the controls panel |

Gamepad (triggers + left stick) and touch controls are supported too.

## The circuit

**1.65 km · figure-eight · 41° max banking · 18 m crossover · 26–42 m wide**

Kansas Straight → Tunnel Entry → **The Undercross** (210 m tunnel) → Factory Straight →
**The Trap** (chicane) → **The Bowl** (banked hairpin, Turn 1) → **Vector Ramp** (18 m up,
on pylons) → **The Bridge** (over the tunnel) → North Sweep → **The Grinder** (banked
hairpin) → start/finish.

Carrying speed up the banking is the whole game: the roadway is a trough, so you can run
the wall through The Bowl and The Grinder and come out the far side faster than anything
that stayed on the flat.

Read [`DESIGN.md`](DESIGN.md) for the reference research on the film's track and exactly
what was changed to make it work for cars.

## Project layout

```
index.html            HUD markup
src/trackData.js      circuit definition: 10 corner vertices -> centreline generator
src/track.js          track geometry (roadway, trough, barriers, tunnel, pylons, gantry)
                      + the collision surface used by the car
src/car.js            low-poly Sentra-style race car mesh + arcade-sim physics
src/environment.js    stadium bowl, crowd, floodlights, jumbotrons, Zalem, skyline
src/main.js           game loop, cameras, lap timing, particles, post-processing
src/hud.js            speed/laps/minimap HUD
src/input.js          keyboard + gamepad + touch
src/audio.js          synthesised engine and tyre audio (WebAudio, no samples)
tools/smoke.mjs       headless build + AI-driven 2-lap test (node tools/smoke.mjs)
tools/trackpng.mjs    renders docs/track-map.png from the live spline
tools/trackmap.mjs    renders docs/track-map.svg from the live spline
```

## Tests

```bash
node tools/smoke.mjs
```

Builds the circuit, stadium and every car livery headlessly, checks the bridge clears the
tunnel, then drives two AI laps and asserts the car never NaNs, gets stuck, or leaves the
road.
