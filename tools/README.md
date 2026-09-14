# Blend kernel test harness

Headless tools used to diagnose and verify the SolidArc edge fillet / chamfer rewrite.
The app is a single HTML file with one inline `<script>`; `harness.js` loads that script
into a Node VM behind a permissive DOM stub and exposes the geometry kernel, so the
solid modeller can be exercised and measured without a browser.

    node harness.js      # sanity: does the kernel load, what symbols exist
    node regress.js      # the regression suite (21 assertions)
    node measure.js      # ground-truth measurements on a square prism
    node render.js       # writes ../docs/blend-proof.svg (visual proof)

`diagnose*.js` are the exploratory scripts that located the original defects.

## Oracles

For a prism of height H whose top edge is blended with size r, at parameter
u in [0,1] from the wall to the cap:

* **chamfer** - `d = r·u`, `e = r·(1-u)`: a flat 45 deg band.
* **fillet** - `phi = (pi/2)·u`, `d = r(1-cos phi)`, `e = r(1-sin phi)`: tangent to the
  wall at u=0 and to the cap at u=1 (the rolling-ball condition).

Along a straight run the fillet surface is a **cylinder** of radius r about the
inward-offset axis at `z = H-r`. Where two blended runs meet, the two cylinders
**intersect**; the corner curve is that mitre, and a mitre point lies on *both*
cylinders exactly (`hypot(r cos phi, r sin phi) = r`). A sphere is **not** the correct
corner surface for a swept edge blend - that was verified analytically and the
oracle in `measure.js` was corrected accordingly.
