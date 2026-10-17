# Slate - Level 01 greybox

**Section 1: Fractured Town** is a point-to-point racing section through a town hanging in pieces
in the air. The drivable line runs over broken road slabs, a supermarket roof, shop roofs, a
pitched terrace roof, a house floor, a bridge, a market square and a church nave, and it moves
while you drive it. It ends in a portal to Section 2, in another part of the same map.

![Fractured Town](docs/img/09-portal.jpg)

```bash
npm install
npm run dev     # http://localhost:5173  (G = designer panel, T = autopilot demo)
npm test        # headless: autopilot completes Section 1 (~47.7 s) + moving-joint audit
```

The design document has the beat sheet, plan, height profile, motion and fracture design,
metrics and controls: [docs/LEVEL01_SECTION1.md](docs/LEVEL01_SECTION1.md).

Built with Three.js + Vite. The car is Frontier Project-Drive's ControlVehicle
(`public/assets/control-vehicle.json`).
