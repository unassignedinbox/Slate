# Osteomotion — T. rex skeleton lab

A dependency-free interactive 2D osteological viewer for an adult *Tyrannosaurus rex*. The model is bone-only and left-lateral: articulated vertebrae, individual caudals, ribs and gastralia, pelvis, two-digit forelimbs, arctometatarsalian hindfeet, and a fenestrated skull.

## Run locally

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173`.

## Included motion studies

- **Walk** — alternating gait at a 0.66 Hz baseline, with a delayed vertical tail wave.
- **Run** — a faster grounded cycle, intentionally labeled “fast walk / no turn” rather than presenting an unsupported sprint or pivot.
- **Idle** — postural weight shift, rib-scale breathing motion, and tail suspension.
- **Roar** — neck rise and articulated jaw opening.
- **Sniff** — restrained head-and-neck dip while the hip remains balanced.

The viewer exposes the motion assumptions and links to the source material in the Evidence section. The reconstruction is not presented as direct observation of fossilized motion.

## Research anchors

- Van Bijlert, van Soest & Schulp (2021), *Natural-frequency method: estimating the preferred walking speed of Tyrannosaurus rex based on tail natural frequency*, Royal Society Open Science.
- Field Museum, SUE 3D model and specimen record.
- American Museum of Natural History, updated horizontal T. rex mount context.
- Carrano & Hutchinson (2002), pelvic and hindlimb musculature of *Tyrannosaurus rex*.
