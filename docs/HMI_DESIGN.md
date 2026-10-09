# Slate HMI: design plan

Target: a racing / vehicle HMI on a 2D screen (digital cockpit or HUD) with 3D content inside
apps, an Android-style app shell, and online multiplayer features. Designed in HTML first, to be
ported to C++ later.

## 1. Goals and constraints

| Area | Requirement | How it is met |
|---|---|---|
| Look | Android-like shell (status bar, home, drawer, recents, nav bar) | `hmi/js/launcher.js`, `hmi/css/hmi.css` |
| Apps | Weather, Suspension, Aero, Tyres, Cockpit, Wallet/Store, Online | `hmi/js/apps/*.js`, registry in `hmi/js/apps/index.js` |
| 3D in apps | Vehicle, suspension and airflow rendered inside app windows | `hmi/js/car3d.js` (shared Three.js view) |
| Interactive | Setup sliders, presets, purchases, chat, camera control | Sliders write to the vehicle model; see §5 |
| Multiplayer | Account, store and lobby are server-authoritative | `hmi/js/backend.js` (mock with the real API shape) |
| Vehicle use | Glanceable, large type, high contrast, shallow menus | 1280x720 base layout, at most two taps to any app |
| Future C++ | Same data contract and app model | §4 telemetry contract, §9 roadmap |

## 2. Architecture

```
 C++ vehicle core (physics, sensors, control, networking)
        │  VehicleState frame @ 60 Hz (shared memory / IPC / WebSocket)
        ▼
 HMI data layer   vehicle.js (sim stand-in) · bus.js · backend.js
        │  telemetry frame → foreground app.update(frame)
        ▼
 Shell            launcher.js: status bar, home, drawer, recents, nav bar
        │  app lifecycle: open(body, ctx) → { update, destroy }
        ▼
 Apps (7)         apps/*.js            3D views: car3d.js
```

Rules that keep the design portable:

1. Apps do not call each other. They use the shared `ctx` (sim, backend, bus, toast).
2. The shell forwards telemetry only to the foreground app. Background apps are not updated, and
   closing one from Recents destroys it, which frees its 3D context.
3. Every money-changing call is async and validated by the server. The HMI never trusts its own
   balance.
4. The 3D view is driven only by numbers (suspension mm, roll, pitch, flap angles, tyre temps).
   No physics runs in the renderer, so the C++ side stays the single source of truth.

## 3. Screens and apps

**Shell.** A fixed 1280x720 screen scaled to the window. Status bar (clock, ONLINE, alerts),
a home screen with two live widgets (speed/gear and track weather), an app grid and a dock. Swipe
up opens the app drawer with search. Recents shows cards. The nav bar provides back, home and
recents. Safety alerts (tyre over-temperature) show in the status bar and as a toast, at most one
per 15 s per alert.

| App | Content | 3D | Data source (real build) |
|---|---|---|---|
| Cockpit | Speed, gear, 15 shift LEDs, throttle/brake, G-meter, lap timing, track minimap, tyre tiles | No | Powertrain, IMU, timing |
| Suspension | Setup sliders (ride height, spring, damping, anti-roll), corner travel, roll/pitch/heave, 8 s trace | Yes: exposed wishbones, pushrod, coilovers, live articulation | Damper/spring sensors, IMU, setup writes |
| Aero | Front/rear flap control, presets, downforce / drag / L-D / balance, downforce-vs-speed curve, airflow | Yes: wings respond to flaps, particle airflow | Aero model, flap actuators |
| Tyres | Compound select, per-corner temperature, pressure, wear, temperature trace | Tyre colour is shared with the 3D car (rim ring) | TPMS, tyre thermal model |
| Weather | Current conditions, wind compass, track temperature, grip index, rain chance, 8 h forecast | No | Environment service |
| Wallet | Balance, transfers, activity log | No | Account service |
| Store | Liveries (cosmetic; recolour the 3D car) and setup packs (apply settings) | Livery preview | Store service |
| Online | Rooms, live standings with time gaps, shared track map with all cars, chat | Track map | Match server snapshots |

## 4. Telemetry contract (basis for the C++ struct)

One frame per tick, plain numbers, SI-style units. The current JS shape is in `vehicle.js`.

```cpp
struct TyreState { float tempC; float pressureBar; float wearPct; };
struct Corner    { float travelMm; float roadMm; };          // compression, road height
struct Aero      { float downforceN, dragN, balanceFrontPct, lOverD, wingRear, wingFront; };
struct VehicleState {
  double t; double distanceM; int lap; float lapTimeS, lastLapS, bestLapS;
  float speedKph; float rpm; int gear; float throttle, brake; float latG, longG;
  Corner susp[4];  float rollDeg, pitchDeg, heaveMm;
  TyreState tyres[4]; Aero aero;
  float trackX, trackY, trackHeading, trackCurvature, trackProgress;
  Setup setup;     // rideHeight, springRate, damping, antiRoll, compound, wings
  Alert alerts[8]; // level, key, text
};
```

Setup values go the other way: a slider change becomes a `setup write` command to the C++ control
layer. Commands are acknowledged, and the HMI shows the acknowledged value.

## 5. Interaction and feedback

- Sliders are the only input that changes the car. Changes apply immediately in the model, and
  sliders re-sync when a setup pack changes them elsewhere.
- Presets (Straight / Balanced / Corner) set both aero flaps together.
- Camera presets (Orbit, Front, Side, Rear, Top) tween the 3D camera.
- Purchases show a pending state (disabled button), then a toast on success or failure.
- Touch targets are at least 44 px. Keyboard: Esc = back, Home = home.

## 6. 3D strategy

- **Now:** a procedural single-seater built from extruded plan and profile shapes, so there are no
  assets to load. Suspension, pitch, roll, heave and wheel spin are all driven by telemetry. The
  visual exaggeration (×2.5) is labelled in the UI.
- **Next:** swap in glTF/USD assets from the car CAD pipeline. Keep the same node names
  (`hub_fl`, `upright_fl`, `wing_front`, …) so the animation code does not change.
- **Performance:** only the foreground app renders. One WebGL context per open 3D app. Particles
  are a single point cloud. Target 60 fps on the target SoC, budget 16 ms per frame.
- **Native port:** Qt Quick 3D or Unreal Engine for the premium look. Reuse the same node names and
  data contract, so the JS prototype is a reference rather than throwaway work.

## 7. Multiplayer and services

- An authoritative server runs the match and the account. The HMI renders snapshots at 20–60 Hz
  and interpolates between them. Other cars are never simulated locally.
- Store and Wallet go through the account API with server-side validation. The mock already uses
  the same async shape (`purchase`, `equipLivery`, `transfer`).
- Lobby standings are derived from the same track distance as the local car, so the view matches
  the server snapshot once the mock is replaced.

## 8. Safety and HMI guidelines (for a road vehicle)

This prototype targets a racing or simulation context. For a road vehicle, plan for:

- Restrict non-driving tasks (Store, Wallet, chat) while the vehicle is moving, following the
  driver-distraction guidance of the relevant regulators and OEM standards. The shell has a hook
  for this: actions in `ctx` can be refused based on speed.
- Display legibility and contrast should follow ISO 15008 (in-vehicle visual displays). Verify on
  real hardware, not only in a browser.
- Safety-critical warnings (tyre overheat, brake temperature) belong on a dedicated, always-on
  layer that apps cannot cover.
- Functional-safety requirements for critical displayed data follow ISO 26262. Keep the warning
  path separate from app code.

## 9. Roadmap

1. **Done in this branch:** HTML prototype with the shell, 7 apps, the shared 3D car and a mock backend.
2. Replace the simulator with recorded telemetry (a real car log or a sim replay) to validate the contract.
3. Asset pipeline for glTF car models and textures.
4. Define the telemetry and command schema in one file (JSON Schema or protobuf) shared by JS and C++.
5. C++ port: Qt 6 (QML + Quick 3D) on the target hardware, or Unreal if the look requires it.
6. Real account, store and match services; latency and reconnect tests.
7. On-hardware testing: legibility, touch latency, thermal behaviour and safety lockouts.

## 10. Run it

```
cd hmi && python3 -m http.server 8080
```

Open http://localhost:8080. Three.js is vendored in `hmi/vendor/`, so no internet access is needed.
Debug from the console: `hmi.sim.set({ wingRear: 0.9 })`, `hmi.launcher.launch('aero')`.

## 11. Known limits of this prototype

- The vehicle model is a stand-in simulator, not a physics model. The lap is a fixed closed-loop track.
- Weather, wallet, store and lobby data are mock values. Persistence uses `localStorage`.
- Checked in headless Chromium: no console errors, and all seven apps open and render. Not yet
  checked on the target display or touch hardware.

## 12. In-car tablet (3D) and kiosk mode

`hmi/index.html` (the main preview at `/`) shows the HMI as a 3D tablet in a stylised cabin. It is not a car model.

- **Tablet:** a rounded WebGL body. The screen is the live HMI (`app.html`), placed in CSS 3D on the
  front face, so the real DOM and the WebGL suspension view both render inside it and take touch and
  mouse input. Apps, buttons, sliders and the back and home bar all work on the tablet.
- **Input routing:** the CSS 3D layer sits above the WebGL canvas and takes pointer events. The
  tablet is tilted, so taps are routed through the same camera projection the CSS renderer uses.
  `window.carScene.toPage(x, y)` exposes that mapping for tests.
- **Cabin:** dashboard, pillars, roof, steering wheel and a road whose speed follows the HMI's speed
  (the HMI posts its telemetry to the parent page). Replace it with a real interior later.
- **Kiosk mode:** `app.html?kiosk=1` (no input, auto-cycles through home and every app, and the 3D
  views auto-orbit). Each app is closed after its turn to release its 3D context. Used for demos.
- **Known bug fixed:** the app-window layer covered the home screen and blocked every tap. It is now
  click-through, and only visible app windows take pointer events.
- **Touch:** taps, sliders and the swipe-up-for-drawer gesture work with touch and mouse. The home
  screen uses `touch-action: none` so the browser does not take a vertical swipe as a page pan. The
  swipe is tracked on the document, so a finger or cursor that leaves the home area still counts.

Production note: the iframe is a development convenience. In a vehicle, the same screen would be a
native surface in the display compositor, with the same app model.

## 13. How the 3D suspension works

The Suspension app draws each corner as a linkage between fixed points on the chassis and the wheel
hub. Each frame, the code does this:

1. **Chassis pose.** Heave, pitch and roll come from telemetry (the four corner travels). The
   chassis group is moved and rotated to match.
2. **Wheel position.** Each hub follows the road height under its wheel (telemetry), so the tyre
   stays on the ground while the body moves.
3. **Links.** Each link is a cylinder between two world points: the upper and lower wishbones
   (chassis mounts to upright pick-ups), the upright, the pushrod (upright to rocker) and the
   coilover (rocker to lower arm). Each link is placed from its two end points. The spring is a
   helix whose length tracks the rocker-to-arm distance, so it compresses when the car does.
4. **Wheel spin.** Rotation comes from distance travelled divided by tyre radius.

This is a visual approximation. Hub height comes from the road profile, not from the sensed travel.
A production model would:

- use real **hardpoints** from the CAD suspension geometry (the fixed chassis and upright points);
- drive the **upright position** from the sensed wheel travel, and solve the wishbone and pushrod
  geometry each frame (a linkage / kinematics solve, not a fixed placement);
- take the **damper and spring** positions directly from the rod or LVDT sensors, and chassis
  attitude from the IMU;
- keep **level-of-detail** versions of the model (full detail when the app is open, simplified
  when it is in the background).
