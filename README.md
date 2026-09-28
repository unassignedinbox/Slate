# Golden Eagle 3D study

An interactive, mesh-only 3D study of an adult Golden Eagle (*Aquila chrysaetos*). The model is built procedurally in `app.js` from volumetric meshes: torso, head, hooked bill, eyes, golden nape hackles, booted tarsi, feet, toes, talons, 12 tail rectrices, layered coverts, rounded secondaries, and 10 fingered primaries on each wing.

## Run

This is a static site. Serve the repository root over HTTP, for example:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://localhost:4173`. The viewer loads Three.js from jsDelivr and uses WebGL for the 3D render. No image planes, 2D animation, or armature/skeleton is used. Animation is applied directly to the visible mesh groups so the wing and body motion remain inspectable.

## Animation library

- **Idle** — breathing, balance, small head and tail adjustments.
- **Wing flap** — deep powered beats, feather-group response, vertical body impulse, and tucked legs.
- **Glide** — raised shallow dihedral, extended primaries, streamlined body, tucked legs, and steering tail.
- **Walk** — alternating foot placement, rolling weight shift, grounded body bob, and folded wings.
- **Head turn** — head sweep with counter-rotating neck and balance corrections.
- **Screech** — display posture, throat/head lift, beak gape, mouth interior, and feather flare.

## Reference basis

See [SOURCES.md](SOURCES.md) for the field references and the specific anatomical / behavioral choices derived from them.
