# Slate HMI — Design Plan

A racing-grade, Android-styled vehicle HMI with live 3D components embedded in
2D app windows. Prototype in HTML/WebGL first, then port to C++.

---

## 1. Goals

| # | Goal | What it means in practice |
|---|------|---------------------------|
| G1 | AAA racing look | Dark carbon/graphite base, team-accent colours, condensed display type, glow/bloom only on critical data, 60 fps. |
| G2 | Android-style shell | Status bar, app launcher grid, recents, back/home gestures, rounded cards, Material-style motion. |
| G3 | Apps for a vehicle | Weather, Suspension, Aerodynamics, Tyres, Telemetry, Garage, Map, Settings. |
| G4 | Online / multiplayer apps | Lobby, Friends, Wallet, Store. Same shell, networked data. |
| G5 | Live 3D inside 2D | Car model, suspension, tyre, wing rendered in real time inside app windows. |
| G6 | Interactive | Touch, mouse, keyboard, gamepad, and (later) steering-wheel buttons/rotary dial. |
| G7 | Portable to C++ | Strict separation of data, logic and view so the HTML prototype maps 1:1 to the C++ build. |

---

## 2. Form factor — decision needed

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Digital cockpit (recommended)** | Ultrawide cluster (e.g. 1920×720 or 2×1600×720 curved) + centre touch display; apps open in the centre display. | Matches racing dashes (F1/GT); room for 3D viewports; Android-like shell fits a touch screen. | Needs more screen real estate and a fixed layout. |
| B. HUD overlay | Transparent overlay on top of a 3D race view. | Very immersive, glanceable. | Little space for full apps like Wallet/Store; hard to make Android-like. |
| C. Hybrid (planned) | Cockpit is the base; a "HUD mode" collapses the dash into a transparent overlay on the 3D view. | Covers both; the HUD is just a layout preset. | More layout work. |

**Working assumption: Option C, with Option A as the default layout.** Prototype resolution: 1920×720 (cluster-width) with a 1920×1080 "full centre" preset.

---

## 3. Layout (cluster preset, 1920×720)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 14:32  ▮▮▮ LTE  24°C ☀     P3   LAP 12/50   ΔS1 −0.214   DRS ◉ READY      │  ← status bar (Android)
├───────────────┬──────────────────────────────────────┬───────────────────┤
│  SPEED        │                                      │  TYRES  (3D)      │
│  287 km/h     │      ACTIVE APP WINDOW               │  ◐ ◑ ◐ ◑  82°C     │
│  GEAR 7       │      (Android-style card,            │                   │
│  ▮▮▮▮▮▮▮▯▯ rpm│       rounded, elevated)             │  SUSP (3D)        │
│               │                                      │  travel graph     │
├───────────────┴──────────────────────────────────────┴───────────────────┤
│  ⌂  Home    ◁ Back    ▦ Recents    [Weather][Susp][Aero][Tyres][Store]…  │  ← nav bar / dock
└──────────────────────────────────────────────────────────────────────────┘
```

* **Left / right rails** = always-on racing instruments (speed, gear, rpm, delta, tyre temps). Never covered by apps.
* **Centre** = Android-style app window. Apps can be full-bleed, split, or floating cards.
* **Top** = status bar. **Bottom** = nav bar and dock.

---

## 4. Architecture

```
┌───────────────────────── UI (view) ─────────────────────────┐
│ Shell (status bar, launcher, recents, nav)                  │
│ Apps (Weather, Suspension, Aero, Tyres, Wallet, Store, …)   │
│ Components (Gauge, Card, Slider, Graph, Viewport3D, …)      │
└──────────────▲───────────────────────────────▲──────────────┘
               │ state (signals / stores)      │ commands (intents)
┌──────────────┴───────────────────────────────┴──────────────┐
│ Core services                                               │
│  Telemetry · Vehicle sim · Weather · Session · Wallet/Store  │
│  Input router · App registry · Settings                     │
└──────────────▲───────────────────────────────▲──────────────┘
               │ schema (JSON now, binary later)│
┌──────────────┴───────────────────────────────┴──────────────┐
│ Data sources: mock sim (prototype) │ network server │ CAN/sim│
└─────────────────────────────────────────────────────────────┘
```

Rules that keep the C++ port cheap:

1. **Views never call the network or the sim directly.** They read a store and dispatch intents.
2. **All data crosses one schema** (see §6). The prototype uses a local mock; C++ replaces the mock with a real source without touching the UI.
3. **Design tokens are data** (JSON), not hard-coded CSS (see §5.1).
4. **Each app is a module** with `mount()`, `unmount()`, `onIntent()` and a manifest (id, name, icon, permissions, network needs).

---

## 5. Visual system

### 5.1 Design tokens (`/design/tokens.json`)
Colours, spacing, radii, type scale, motion curves, elevation. Generated into CSS variables now and into a C++ header later.

Example:
```json
{
  "color": {
    "bg":        "#0A0B0D",
    "surface":   "#15171B",
    "surfaceHi": "#1F2228",
    "accent":    "#E10600",
    "ok":        "#2EE59D",
    "warn":      "#FFC400",
    "crit":      "#FF3B30",
    "text":      "#F4F5F7",
    "textDim":   "#8A8F98"
  },
  "radius":  { "card": 28, "chip": 14, "pill": 999 },
  "space":   { "xs": 4, "s": 8, "m": 16, "l": 24, "xl": 32 },
  "type": {
    "display": { "family": "Titillium Web", "weight": 700 },
    "data":    { "family": "Share Tech Mono", "weight": 400 },
    "ui":      { "family": "Roboto", "weight": 500 }
  },
  "motion": { "standard": "cubic-bezier(0.2,0,0,1)", "durationMs": 280 }
}
```
Fonts are bundled (no CDN) so the HMI works offline.

### 5.2 Android look
* Status bar, nav bar with Home/Back/Recents, app grid launcher with icons.
* Material-3-style cards: large radius, tonal surfaces, ripple/press feedback.
* Motion: shared-element transitions from launcher icon into app window; recents as a horizontal card stack.
* Dark theme only in v1; accent colour per team/livery.

### 5.3 Racing look
* Condensed display type for numbers; monospace for telemetry.
* Colour is semantic only: green = good, amber = caution, red = critical. No decorative colour on data.
* Subtle bloom/glow on RPM and shift lights; no glow on text.
* Thin scanline/carbon texture at very low opacity, togglable.

---

## 6. Data schema (contract between UI and vehicle/server)

Versioned JSON now (`schemaVersion: 1`); a binary form (e.g. protobuf or fixed-struct over shared memory) later.

```json
{
  "schemaVersion": 1,
  "t": 1728484320.512,
  "vehicle": {
    "speedKmh": 287.4, "gear": 7, "rpm": 11250, "throttle": 0.92, "brake": 0.0,
    "steerDeg": -3.1, "drs": "ready", "position": 3, "lap": 12, "lapsTotal": 50,
    "suspension": {
      "travelMm": { "FL": 42.1, "FR": 40.8, "RL": 55.0, "RR": 53.9 },
      "springRate": { "front": 180, "rear": 210 },
      "damper": { "bump": 6, "rebound": 8 },
      "antiRollBar": { "front": 3, "rear": 5 }
    },
    "tyres": {
      "FL": { "tempC": 82, "pressureBar": 2.1, "wearPct": 14, "compound": "soft" },
      "FR": { "tempC": 84, "pressureBar": 2.1, "wearPct": 15, "compound": "soft" },
      "RL": { "tempC": 88, "pressureBar": 1.9, "wearPct": 16, "compound": "soft" },
      "RR": { "tempC": 90, "pressureBar": 1.9, "wearPct": 16, "compound": "soft" }
    },
    "aero": { "frontWingDeg": 12, "rearWingDeg": 18, "downforceN": 14200, "dragN": 3100 }
  },
  "weather": { "airTempC": 24, "trackTempC": 39, "humidityPct": 48, "rainIntensity": 0.0, "windKmh": 11, "windDeg": 240 },
  "session": { "online": true, "lobbyId": "L-1042", "players": 8 },
  "wallet": { "currency": "CR", "balance": 12500 }
}
```

Intents (UI → core), e.g. `{"type":"setFrontWing","deg":14}`, `{"type":"buyItem","sku":"TYRE_HARD"}`, `{"type":"openApp","id":"suspension"}`.

---

## 7. 3D inside the 2D UI

### 7.1 Rendering approach (prototype)
* **Three.js (WebGL)** for all 3D. One shared `WebGLRenderer`; each `Viewport3D` component is a `<div>` with its own camera and scene, rendered with scissor/viewport regions per frame. This keeps one GPU context.
* Models are **glTF 2.0 (.glb)**, Draco-compressed, with LODs. Suspension, wheels and wings are separate named nodes so they can be animated by telemetry.
* Procedural fallbacks (primitives) let the UI run before artists deliver assets.

### 7.2 Component examples
| Component | 3D content | Driven by |
|-----------|------------|-----------|
| `CarViewport` | Full car, orbit camera, livery swap | `vehicle.*`, Garage intents |
| `SuspensionViewport` | Corner-by-corner springs/dampers, animated travel | `suspension.travelMm`, spring/damper settings |
| `TyreViewport` | Tyre with temperature heat-map on tread, pressure ring | `tyres.*` |
| `AeroViewport` | Car + wings, angle sliders, airflow particles | `aero.*` |
| `WeatherViewport` | Sky dome, rain/wind particles, sun position | `weather.*` |
| `TrackMap` | 2D SVG track with 3D markers | `session`, `vehicle.position` |

### 7.3 Performance budget (60 fps = 16.6 ms)
* Simulation + data: ≤ 2 ms
* UI DOM/CSS updates: ≤ 3 ms (batch updates per frame, avoid layout thrash)
* 3D: ≤ 8 ms total for all visible viewports (only render viewports that are on screen; lower rate for background ones)
* Headroom: 3 ms

---

## 8. Interaction design

| Input | Prototype | Vehicle (later) |
|-------|-----------|-----------------|
| Touch | Taps, drags, swipe to go home / recents | Same, with larger hit areas |
| Mouse | Click, drag to orbit 3D, wheel to zoom | Not used |
| Keyboard | Arrow keys + Enter/Esc (mirrors a d-pad) | Not used |
| Gamepad | Left stick = focus, A = select, B = back, bumpers = switch app | Not used |
| Steering wheel | — | Buttons + rotary dial mapped to the same focus/select/back actions |

Focus model: every interactive element is reachable by focus navigation so the same UI works for touch and wheel controls.

**Safety/usability note:** this is a racing-game-style HMI, so it can be as dense as needed. If it ever goes into a real vehicle, the displays would have to follow in-vehicle display rules (e.g. ISO 15008 legibility, ISO 15005 driver-interaction guidance, UNECE R121 for controls and telltales). The design below keeps critical info (speed, gear, warnings) on fixed rails and never behind an app.

---

## 9. Multiplayer, Wallet, Store

* **Session service**: WebSocket to a Node server (prototype). Lobby list, join/leave, player count, presence. Rooms are authoritative on the server; the HMI only renders the state it receives.
* **Wallet**: balance and transaction history. Read-only from the client; all changes go through the server.
* **Store**: items (tyre compounds, aero kits, liveries, sounds). Buying happens in the Store app, and items show up as unlocks in the Tyres/Aero/Garage apps.
* **Auth**: placeholder token in the prototype; real login (OAuth/OIDC) later.
* Offline mode: apps show cached data and a status chip; no crashes when the link drops.

---

## 10. Proposed repo layout

```
Slate/
├── docs/HMI_DESIGN.md          ← this file
├── design/tokens.json          ← design tokens (single source)
├── prototype/                  ← HTML/TS/Three.js prototype
│   ├── index.html
│   ├── src/
│   │   ├── shell/              ← status bar, launcher, nav, recents
│   │   ├── apps/               ← weather, suspension, aero, tyres, wallet, store, …
│   │   ├── components/         ← gauges, cards, sliders, Viewport3D
│   │   ├── core/               ← store, intents, input router, app registry
│   │   ├── sim/                ← mock vehicle + weather generator (same schema)
│   │   └── render3d/           ← shared renderer, models, LOD
│   ├── assets/models/          ← .glb (Git LFS or external storage if large)
│   └── fonts/
├── server/                     ← Node WebSocket mock for multiplayer/wallet
└── cpp/                        ← (later) C++ port, same folder names
```

Large binary assets (`.glb`, fonts, textures) go through Git LFS or external storage per repo convention; none are committed in the first milestone.

---

## 11. Technology choices

| Layer | Prototype (now) | Production C++ (later) — options |
|-------|-----------------|----------------------------------|
| UI framework | HTML/CSS + TypeScript (Web Components or a light framework) | **Qt 6 (QML + Qt Quick 3D)** — best fit for an embedded dash; or Unreal UMG if this is a game build; or Dear ImGui / LVGL for a lean embedded target |
| 3D | Three.js / WebGL | Qt Quick 3D, Unreal, or OpenGL/Vulkan directly |
| Data | JSON over WebSocket (mock) | Same JSON/protobuf; shared memory or SOME/IP / CAN bridge for real vehicle |
| Build | Vite + TypeScript | CMake |
| Tests | Vitest (logic), Playwright (screenshot + fps) | GoogleTest, Qt Test |

The prototype is structured so each HTML component has a clear C++/QML equivalent (`Card` ↔ `Rectangle`, `Viewport3D` ↔ `View3D`, `store` ↔ `QObject` properties, intents ↔ invokable slots).

---

## 12. Milestones

| M | Deliverable | Exit criteria |
|---|-------------|---------------|
| M0 | Tokens, schema, repo scaffold | `tokens.json` and schema v1 reviewed; Vite app boots |
| M1 | Shell: status bar, launcher, nav, recents, transitions | Open/close any app with Android-style motion, 60 fps |
| M2 | Mock sim + cluster rails (speed, gear, rpm, delta, tyre temps) | Live numbers update from the mock at 60 Hz |
| M3 | `CarViewport` + `SuspensionViewport` driven by sim | Suspension visibly moves with telemetry; orbit camera works |
| M4 | Tyres, Aero, Weather apps with 3D viewports | Each app's controls change the 3D model and the data |
| M5 | Input router: keyboard, mouse, gamepad, focus model | Full UI usable without touch |
| M6 | Server + Session/Lobby, Wallet, Store | Purchase updates the wallet and unlocks an item in another app |
| M7 | Polish: HUD mode, audio cues, theming, perf pass | Passes perf budget on target hardware |
| M8 | C++ port spec + first QML/Qt slice (shell + one app) | Same data schema drives a native build |

---

## 13. Open decisions (need input)

1. **Form factor**: cockpit only, HUD only, or hybrid (recommended)?
2. **Target resolution / screen count**: 1920×720 cluster, 1920×1080 centre, or multi-screen?
3. **Car source**: licensed/own 3D models, or procedural placeholders first?
4. **C++ target**: Qt 6 (embedded dash), Unreal (game-engine build), or undecided?
5. **Realism level**: arcade-style sim data (proposed) or physics-accurate telemetry?
6. **Multiplayer backend**: own server (proposed for prototype) or existing service?
