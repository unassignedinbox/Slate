# SLATE: ZIPPER AVENUE ⚡

**Wipeout-grade anti-grav racing dropped into a living city street from a Ready Player One
fever dream.** The avenue itself races you back.

A complete, playable 3D web racing game in a single `index.html` (Three.js, vendored locally
in `vendor/` — no build step, no CDN needed at runtime).

## ▶ Run it

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` via any static server. Click **START RACE**.

## 🏁 The Track — Zipper Avenue GP (Neo-Kyo, Sector 7)

A ~2 km closed anti-grav circuit through a neon city, 3 laps against 5 rival aces,
with two AI wingmates (**NOVA** & **JINX**) flying as **Team Slate**.

### Dynamic elements

| Element | What happens |
|---|---|
| **⚡ Bollard Zipper** | 16 rows per lap × 5 lanes. Only one lane per row is sunk open — and the opening **walks sideways** like a zipper as you approach. Read the **Zipper Radar** (bottom-right HUD) and thread it, or… |
| **◈ Zipper-Tether (signature move)** | Hold **SPACE**: the open gap is magnetically **drawn toward your lane** (visible energy tether, bollards re-rise/sink in real time). Your teammates dive through the gap *you* pulled open. Clean team threads build **TEAM SYNC** → fill it for a **TEAM SURGE**. Boost and Tether share one Energy pool — choose. |
| **🚄 Maglev Crossings ×2** | Freight maglevs blast **perpendicular across the track** every ~24 s. Sirens, flashing posts and a red banner give you ~4 s: commit or brake. |
| **🚕 Hover Traffic** | Taxis cruise at half speed, change lanes and thread the zipper themselves. Near-misses pay score; bumpers cost shield. Riding their slipstream refunds Energy. |
| **⬢ Energy Pads** | Cyan pads: +30 Energy and a kick of speed. |

Crashing into raised bollards, traffic or a train damages your **shield** — it reboots at
55% if it ever hits zero, so the run never dead-ends.

## 🎮 Controls

| Action | Keys |
|---|---|
| Steer | `A`/`D` or `◀`/`▶` (touch buttons on mobile) |
| Boost | `SHIFT` or `W` |
| Brake | `S` or `▼` |
| **Draw Zipper gap to your lane** | **`SPACE`** or `E` (hold) |
| Pause | `P` / `ESC` |
| Camera (Chase / Low / Hood) | `C` |
| Sound | `M` |

Auto-throttle is engaged — your job is the line, the gap, and your team.

## 📁 Files

- `index.html` — the entire game (UI, HUD, minimap, zipper radar, audio synth, race logic)
- `vendor/three.module.js` — Three.js r160, vendored so the game works fully offline
