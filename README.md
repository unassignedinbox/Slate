# Slate — Can-Scale Reactor Lab

A browser-local 3D educational exhibit for comparing modular materials and fail-safe responses inside a fixed can-scale envelope. The project is intentionally a reduced-order teaching model, not engineering software or an operating procedure.

## Run

```bash
npm install
npm run dev
```

Open the Vite preview, then use the left Outliner, center 3D viewport, and right Inspector / Materials / Safety docks. `npm test` runs the deterministic simulation checks; `npm run build` creates the production bundle.

## Highlights

- Orbit-able three.js model with cutaway, exploded, radiation-field, and label modes.
- Swappable fuel, cladding, coolant, and shield modules.
- Point-kinetics proxy, heat-balance proxy, exponential attenuation comparison, bounded seeded sensor noise, and vibration response.
- Coolant-loss, sensor-fault, and shield-breach test conditions.
- Automatic SCRAM plus an explicit “Render core inert” fail-safe demonstration.
- Exportable run snapshots and a repeatable seed for comparisons.

The editor shell is an original implementation inspired by the latest Project Zero editor direction in [SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-/tree/arena/10e50e56-frontier), specifically the requested Frontier branch. See [`docs/RESEARCH_NOTES.md`](docs/RESEARCH_NOTES.md) for model scope, references, equations, and validation notes.
