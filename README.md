# APEX Motorsport — HMI prototype

A browser-first concept for a high-performance racing-game vehicle interface. The screen is still a **2D HMI**: the launcher, controls, telemetry and HUD are HTML/CSS; interactive vehicle and component visualizations are rendered into small Three.js canvases inside the apps.

## Run it

```bash
npm install
npm run dev
```

Vite binds to `0.0.0.0` for the Arena preview. `npm run build` makes a static production bundle.

## Design intent

- **Two display contexts:** the Pit Console is the full Android-inspired app launcher for setup and social/economy screens. Race HUD is a separate, reduced-information overlay for driving; it deliberately does not surface Store or Wallet while the car is on track.
- **Apps, not a web dashboard:** Weather, Suspension, Aerodynamics, Tyres, Crew, Wallet, Store and Vehicle are independent app destinations with a persistent launcher rail, familiar rounded app glyphs, a shared top status bar and cross-app data.
- **3D is a focused instrument:** the home/garage show a rotatable car; Suspension shows a live-adjusting front-corner assembly; Aero layers animated flow vectors over the car; Tyres has an inspectable 3D race tyre. Drag to orbit and scroll to zoom. The control surfaces stay 2D and readable.
- **Racing-game visual language:** dark graphite surfaces, technical mono labels, large vehicle-first typography, luminous lime telemetry, subtle grids and high-contrast state changes. Responsive breakpoints retain a compact touch launcher on smaller screens.

## Prototype interactions

- Switch between **Console** and **Race HUD** in the top-right mode switch.
- Open an app from the rail or Android-style home launcher.
- Change ride height, spring rate, rebound, aero balance/DRS, tyre compound/pressure and forecast window.
- Invite a crew member, join a sample lobby, request a pit stop, claim a daily reward, and buy/equip a sample Store item. Credits and a few garage choices persist in local storage.
- These are **front-end simulations**. There is no account service, live telemetry feed, multiplayer backend, payment flow or authoritative game economy in this HTML prototype.

## Suggested C++ / game-engine handoff

Keep the visual prototype as a design and interaction reference, then rebuild the shell in the game's native UI stack (for Unreal, CommonUI + UMG/Slate; for a custom engine, its equivalent retained-mode UI). Keep the 3D viewer behind a narrow UI boundary: replace the Three.js canvas with a native render target/viewport and the production car, suspension, aero and tyre assets. Don't ship browser WebGL as the in-game renderer unless that is an explicit engine decision.

A clean native seam is to feed the screens read-only view models such as `VehicleTelemetry`, `SetupProfile`, `WeatherSnapshot`, `TyreState`, `WalletState` and `MultiplayerPresence`; send player edits as commands (for example `SetRideHeight` or `SelectCompound`). The game owns simulation values, and the online service owns presence, inventory and purchases. Wallet/store transactions must be server-authoritative. For production, add controller navigation and focus rules, safe-area layouts, localization, accessibility, pause/pit-state gating, telemetry staleness indicators, and inactive-view rendering caps.

## Files

- `src/main.js` — app registry, screens, prototype state and interactions.
- `src/scene.js` — generated Three.js vehicle, suspension, airflow and tyre scenes.
- `src/style.css` — responsive HMI/console/HUD visual system.
- `vite.config.js` — Arena-compatible preview host settings.
