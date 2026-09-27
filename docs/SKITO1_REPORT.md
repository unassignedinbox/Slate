# `Skito1.blend` — what's actually in it

Opened with Blender 4.2 headless and dumped object by object. Your read
on it was right; here are the specifics.

## Contents

| | |
|---|---|
| objects | 42 |
| meshes | 37 |
| **armatures** | **0** |
| total vertices | **6,781** |
| total faces | 6,199 |
| materials | 7 |
| images | 2, both broken |

## The problems, in order of how much they cost

**1. There is no rig at all.** Zero armatures. Nothing to animate. Every
joint, every hierarchy, every weight would have to be authored from
scratch — and that is the majority of the work on a creature like this,
not the modelling.

**2. Nothing is named.** Every object is `Cylinder.0xx`, `Sphere.00x`,
`Plane.00x`, plus one `Tee Joint`, one `Cube`, one `Circle` and five
`Empty`. There is no way to tell a femur from an antenna except by
looking at it. Materials are `Material` through `Material.005` plus
`Dots Stroke`.

**3. Nine objects carry unapplied destructive booleans.** `BOOLEAN /
DIFFERENCE` modifiers pointing at cutter objects — `Cylinder.008`,
`.009`, `.010`, `.023` — which are themselves 8-vertex cubes carrying
*their own* boolean modifiers. That is a dependency chain, and it is
fragile: when I baked the file down, **3 of the 10 modifiers failed to
apply**. Eight more objects carry `MIRROR` modifiers. Until those are
resolved the mesh you see in the viewport is not a mesh you can ship.

**4. It is two copies of the same animal.** `Collection` (20 objects,
dimensions up to 19.08) and `Collection.001` (20 objects, dimensions
0.05-3.4). Same creature at two scales. `Collection.001` is the tidier
one.

**5. The reference images are gone, and they were never mosquito
references anyway.** `0b5e813ac16ffb929c8661cc38f224e7.jpg` and
`b3922d7e09b407973e2c29f2eb13ac87.jpg`, both `NOTPACKED`, both resolving
to size `(0,0)`, both pointing at `//../../Downloads/landscaping/`. They
are landscaping photos. Nothing was lost.

**6. One complete leg**, as you said — the rest is mirrored or absent.

## What it actually is

A blockout. A good one — the proportions read as a mosquito and the
silhouette is sound — but a blockout: 6.8k triangles, no UVs, no
textures, no rig, no naming, and a destructive modifier stack that
partially fails to bake.

## Recommendation

**Build clean.** Not because the file is bad work, but because of what
would have to happen to it: resolve the boolean chains by hand, identify
and name 37 anonymous objects, rebuild the missing legs, author a full
skeleton, and skin it. That is more work than building the animal
procedurally — and the procedural version gives you parameters, which a
baked mesh never will.

That is what `src/mosquito/` is.

## Converted anyway

`assets/skito/Skito1_Collection.obj` and
`assets/skito/Skito1_Collection_001.obj`, with modifiers baked where
Blender could bake them (7 of 10 applied; the 3 failures are the boolean
cutter chains described above). `.mtl` files alongside. Use
`Collection_001` if you want the refined one.

Regenerate or inspect with:

```bash
node tools/simcheck.mjs                       # the new rig
python tools/blend_inspect.py <file.blend>    # dump any .blend
```
