# Slate HMI — HTML prototype

Racing-style vehicle HMI in plain HTML/JS + Three.js. Design plan: `../docs/HMI_DESIGN.md`.

```bash
npm install
npm run dev      # http://localhost:5173  (bind 0.0.0.0)
npm run build    # static build in dist/
```

## What's in it
- **3D tablet cockpit** (`src/scene/cockpit3d.js`): the HMI panels are real 3D objects on a curved layout inside a 3D tablet bezel (Three.js WebGL + CSS3D). Rails angle toward the driver, the app window moves forward when an app opens, and the view leans with pointer or touch. Designed for a landscape tablet (~16:10); portrait is scaled down, not redesigned.
- **Cockpit panels**: speed/gear/rpm/pedals on the left, tyres/suspension/weather on the right, app window in the centre.
- **Android-style shell**: status bar, app launcher, Back/Home/Recents nav bar, dock, recents cards with close.
- **Apps**: Telemetry (circuit + inputs), Suspension (live 3D + setup sliders/presets), Aerodynamics (live 3D + wing trim), Tyres (3D tyre temperature zones, compounds, pit stop), Weather (3D scene with rain/sun/wind), Garage (livery swap), Multiplayer (lobbies, join/leave), Store and Wallet (CR economy, unlocks cross-app), Settings (HUD mode, accent, FPS).
- **Mock data**: arcade lap simulation in `src/core/sim.js` using the schema from the design doc.

## Keys
`1–9` open app · `H` home · `R` recents · `Esc` back · drag / wheel to orbit and zoom 3D.

## Layout
- `src/core/` store, simulation, economy (wallet/store)
- `src/render3d/` procedural car, tyre, shared viewport base, 3D scenes
- `src/apps/` one module per app (`create / mount / unmount / update`)
- `src/scene/` 3D cockpit (tablet bezel, CSS3D panel placement, parallax)
- `src/shell/` Android-style shell
- `src/ui/` widgets, icons, tyre heat ramp

## Known limits (prototype)
- Car is procedural placeholder geometry; swap in glTF models later.
- Each 3D view has its own WebGL context (design target is one shared renderer).
- Portrait tablets are scaled to fit, not laid out separately.
- Multiplayer and store are local mocks; no server yet.
- Gamepad and steering-wheel input not wired yet (keyboard and mouse only).
