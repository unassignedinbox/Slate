# Wheel Rim Sketcher (browser)

Browser twin of `Engine/ContentInterchange/WheelRimSpecification.{h,cpp}` — same algorithm, same topology contract,
live materials and colour. Rim, spokes and barrel only; no tyre. Lug nuts and the centre cap are separate closed shells.

```
index.html            viewport, CDN bootstrap (probes unpkg ⇒ jsdelivr ⇒ esm.sh ⇒ ./vendor)
RimSpecification.js   the generator — zero dependencies, runs in node as well as the browser
RimWorkspace.js       three.js studio, parameter panel, topology report, OBJ / glTF export
```

## Run

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory Tools/WheelRimSketcher
# then open http://localhost:8080/
```

Headless check (no browser, no three.js):

```bash
node -e "import('./Tools/WheelRimSketcher/RimSpecification.js').then(m=>{
  const p=m.defaultParameters(); m.normalise(p); const s=m.synthesise(p);
  console.log(m.audit(s, s.parts[0].firstTriangle, s.parts[0].triangleCount)); })"
```

Every preset reports `shellCount 1 · boundaryEdges 0 · nonManifoldEdges 0 · flippedEdges 0` and a positive enclosed
volume — one connected, closed, outward-facing manifold, exactly like the C++ module (same triangle counts, same
volumes to six decimals).

## Panel

* **preset** — the six wheels; **paint scheme** — seven two-tone combinations.
* **Size & barrel** — diameter, width, ET, flange, barrel wall, drop well, bead taper, section smoothing, and
  *show section curve* which draws the resolved blank-rim cross-section in the half-plane that generates it.
* **Spokes** — family (Straight · Split · Twisted · Turbine · Weave · Dished), count, root/tip width, taper, sweep,
  twist, split angle, phase.
* **Face plate** — hub radius, outer band, dish, concavity, thicknesses, crown, back relief, junction fillet (the
  smooth-minimum radius where a spoke grows out of the hub), edge bevel and bevel bands.
* **Hub, lugs & hardware** — bore, PCD, lug count/hole/seat/depth/phase, nut style and size, centre cap, valve hole.
* **Materials & colour** — per surface slot (face · pockets & walls · lip & flange · barrel interior · lug nuts ·
  centre cap): a finish recipe (gloss paint, satin graphite, polished / brushed / machined alloy, chrome, bronze or
  gold anodised, matte black, gunmetal, candy red, steel) plus live **colour**, metalness, roughness, clear coat,
  coat roughness and anisotropy. Finishes only seed the sliders — colour stays yours after picking one.
* **Quality & output** — angular / radial segments, crease angle, live-update toggle, wireframe, exposure, auto spin,
  **export OBJ** and **export glTF**.

## Parity with the engine module

The port is line-for-line: `contourUnion` / `contourIntersect`, the spoke recipes, the `ϕ(r,θ)` face contour, the
dish / crown / relief height surfaces, the J-section with its rounded knots and arc-length resample, the lattice mask
with spur and pinch-vertex cleanup, the Newton snap onto `ϕ = 0`, the bevel band walls, the welded barrel sweep, the
crease-limited corner normals and the per-shell orientation fix. Finish recipes carry the same numbers the OpenPBR
slabs use, so what the viewer shows is what `WheelRimStructure` exports to glTF.

Not ported: the glTF material extras the engine writes (the browser export uses three's `GLTFExporter`, i.e. plain
`KHR_materials_clearcoat` / `KHR_materials_anisotropy` rather than the `slate_` haze and F82 fields).
