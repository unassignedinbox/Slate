# Fracture Lab — real-time, material-aware destruction (TypeScript + WebGL)

A live playground demonstrating how AAA games do **realistic real-time fracture** for
**glass, wood, buildings/concrete, plastic and rock** — deliberately *not* the
usual uniform cell/Voronoi fracture, because uniform Voronoi looks wrong for
almost every real material.

```
npm install
npm run dev     # → http://localhost:5173
```

**Controls:** click = shoot a steel ball · drag = orbit · scroll = zoom ·
`R` reset · `S` slow-mo · power slider in the panel.

---

## Why plain Voronoi fracture fails

Blender-style cell fracture scatters uniform seeds over the volume, so every
material breaks into the same convex-pebble mosaic. Real materials don't:

| Material | Real failure mode | What this demo does |
|---|---|---|
| Glass | Radial cracks racing from the impact + concentric "spider-web" rings, pulverized Hertzian cone at the impact, outer plates stay wedged in the frame | Runtime pattern generation **aligned to the impact point** |
| Wood | Anisotropic: splits **along the grain** into long sharp splinters, tears jagged **across** the grain | Grain-aligned splinter band, spiked stub edges on both halves |
| Concrete / buildings | Chunks + **structural collapse**: unsupported masonry above a hole falls | Baked chunk hierarchy + support graph + flood-fill island detection |
| Plastic | **Ductile**, doesn't shatter: punches a hole, tears into petals that bend outward and stay attached, stress-whitens | Hinged petaling with spring bend-back + whitened materials |
| Rock | Comminution: powder & small debris near the impact, big slabs far away; rough granular crack faces | Recursive **impact-graded** plane splitting + matched-noise rough fracture surfaces |

This mirrors the published AAA approach: **impact-aligned fracture patterns
applied to convex decompositions at runtime** (Müller, Chentanez, Kim,
*Real Time Dynamic Fracture with Volumetric Approximate Convex Decompositions*,
SIGGRAPH 2013 — the paper behind **NVIDIA Blast**), combined with
**pre-fractured chunk hierarchies + support graphs** as used by Blast and
Rainbow Six Siege's RealBlast for structural material.

## Architecture

```
src/
  convex.ts        geometry kernel: convex polyhedra, plane slicing, cap
                   rebuilding, matched-noise rough fracture faces, volume/
                   centroid integrals, BufferGeometry conversion (2 material
                   groups: original surface vs fresh fracture surface)
  pattern2d.ts     2D crack patterns in panel space + prism extrusion
                   (glass rays/rings, wood splinters, plastic petals)
  physics.ts       shard-focused rigid bodies: impulse+friction ground
                   contacts, angular response, sleeping, debris budget with
                   priority eviction, static-box supports
  particles.ts     one-draw-call pooled particles (glass glitter, dust, fibers)
  audio.ts         procedural material-tuned impact sounds (no assets)
  stations/
    glass.ts       radial+concentric runtime pattern, hanging shards,
                   2nd-hit cascade release
    wood.ts        grain-anisotropic splinter band
    wall.ts        BAKE: recursive jittered chunking (seams exactly coplanar
                   → invisible until damaged) + support-graph collapse
    plastic.ts     ductile petaling + stress whitening + fatigue tear-off
    rock.ts        recursive impact-graded fracture, re-shootable chunks
                   (unlimited refracture — shards remember their hulls)
  main.ts          scene, ballistics (swept raycasts), HUD, slow-mo
```

### How glass is done (the hard one)

Glass can't be pre-baked meaningfully because the pattern must align with the
impact point. At the moment of impact we:

1. Convert the hit to pane-space 2D.
2. Generate 11–16 **radial rays** with angular jitter and geometrically
   spaced **concentric rings** (dense near the impact) — the exact morphology
   annealed glass exhibits.
3. The shared jittered node lattice makes neighbouring cells watertight;
   each cell is clipped to the pane rect and extruded through the thickness.
4. Cells are then triaged by distance:
   * **core** → pulverized into a particle burst (Hertzian crushing),
   * **near field** → dagger shards launched as rigid bodies,
   * **far field** → *cracked-but-hanging* plates, shrunk ~1.5% so crack
     lines catch light, each tilted a fraction of a degree so facets glint.
     A second hit releases nearby plates instantly and cascades the rest out
     of the frame over ~a second — like real broken safety-frame glass.
5. Broken edges use a green-tinted, less-transparent material (real glass
   edges are green).

### Baking vs runtime — what goes where

* **Baked (load time):** the concrete wall's chunk hierarchy + adjacency
  graph. Cuts are exact planes so the intact wall renders seamless; nothing
  is visible until damage happens. This is what you'd ship as an offline
  asset (Houdini RBD / Blast authoring) in a real production.
* **Runtime:** glass/plastic patterns (must align to impact), wood's break
  band (must align to impact), rock's recursive splitting (depends on impact
  energy & location), the wall's *fresh* sub-fracture near the hit, and the
  support-graph solve.

### Scaling this to a real AAA production

* Swap the toy rigid-body world for **PhysX / Jolt / Chaos**; the shard hulls
  here are already convex, which is exactly what those engines want.
* Move shard transforms into **instanced rendering** and the debris update
  onto **WebGPU compute** (the geometry kernel is renderer-agnostic;
  three.js `WebGPURenderer` is a drop-in swap when browser support matters
  less than throughput).
* Author per-material **fracture pattern libraries** (the Müller/Blast
  approach): a handful of pre-built patterns per material, warped and
  transformed onto the impact point at runtime, then intersected with the
  chunk decomposition.
* Add **damage accumulation** (stress solver) so repeated small hits weaken
  the support graph before collapse.
* Interior-face UVs + triplanar detail normals for fracture surfaces.

## References

* Müller, Chentanez, Kim — *Real Time Dynamic Fracture with Volumetric
  Approximate Convex Decompositions*, ACM TOG (SIGGRAPH) 2013.
* NVIDIA **Blast** destruction SDK (chunk hierarchies, support graphs,
  stress solver).
* Ubisoft — RealBlast destruction in Rainbow Six Siege (procedural
  refracture + structural surfaces).
* Epic — UE5 **Chaos Destruction** (geometry collections, clustering,
  connection graphs) — same architecture, different vendor.
