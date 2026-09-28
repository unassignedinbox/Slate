# Slate — Scorpion motion study

A procedural, articulated scorpion asset built from anatomical references. The result is a glTF 2.0 model with a detailed segmented body, 8 walking legs, paired pedipalps/pincers, chelicerae, pectines, sensory setae, 5-segment metasoma, telson, and aculeus.

## Run the viewer

```bash
python3 -m http.server 8000 --bind 0.0.0.0 --directory public
```

Open `http://localhost:8000/` locally. In Arena preview, use the live preview for the server. The viewer loads Three.js from jsDelivr and `public/scorpion.glb` relative to the page.

## Deliverables

- `public/scorpion.glb` — self-contained glTF 2.0 model with PBR materials, named anatomy nodes, and embedded animation data.
- `public/index.html` — orbitable studio viewer with WALK and ATTACK controls.
- `public/scorpion_standalone.html` — server-independent viewer with the GLB embedded; useful when a live preview process expires.
- `tools/generate_scorpion.py` — deterministic generator. Re-run it after changing geometry or animation parameters.
- `tools/serve_preview.cjs` — small Node static server with glTF MIME and CORS headers.
- `references.md` — anatomy, gait, and visual reference sources plus the modeling audit.

## Clips

- `Walk_Alternate_Tetrapod` — 1 second loop. Uses the biologically documented alternating tetrapod pattern: left 1 + left 3 + right 2 + right 4 against its complement, with lifted swing legs and subtle tail sway.
- `Attack_Chelae_And_Aculeus` — 1.6 seconds. Braces the legs, closes the movable chela fingers, cocks the metasoma, and drives the aculeus forward before recovering.

The model uses +X forward, +Y animal-left, +Z up. It is a general adult emperor-type study, not a species claim: scorpion morphology varies by species and production accuracy should be checked against a specimen when a particular taxon is required.
