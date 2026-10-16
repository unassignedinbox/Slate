# Slate

Arena working branch for the **IlluminationHost** pre-C++ WebGPU prototype
(distance-field GI · surface cards · ReSTIR GI · ControlVehicle).

- `IlluminationHost/` — the prototype, reconstructed file-by-file from the Frontier-
  patch `01a141bc-a4a3-72ce-8295-398724231feb.patch` (no patch file kept), binaries
  restored, plus the HMI finishes (paint / clear coat / rims, live on the car) and
  the X-ray ghost/wireframe view ported from
  `Experimental/interactive-vehicle-hmi-configurator`. See
  [`IlluminationHost/README.md`](IlluminationHost/README.md). Run it with any static
  server: `cd IlluminationHost && python3 -m http.server 8080`.
- [`PLAN.md`](PLAN.md) — the queued follow-up work (tyre deformation, sparks,
  rim marks, steering assist, physics notes).

To carry this into Frontier-: copy `IlluminationHost/` to
`Experimental/IlluminationHost/`, delete the `.patch` file, and add the README row +
provenance paragraph from the patch's `Experimental/README.md` hunk.
