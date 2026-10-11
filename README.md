# Slate · Road Studio

A general-purpose, jurisdiction-neutral browser road-network editor, independent of Fracture. It is not a South African road template or a national road-standards implementation. WebGPU-first Three.js rendering, a charcoal editor shell, right-side scene/material stacks and inspector, and no node editor.

**Status: functional experimental foundation, not an AAA production road generator or certified civil-design tool.** The requested complete infrastructure scope is not finished. Procedural preview assets are not production vehicle/vegetation assets.

## Run

```sh
npm ci
npm run dev -- --port 5173
```

Open the development server. It listens on `0.0.0.0`; Arena's HTTPS preview hosts are allowed. All dependencies are bundled locally, with no runtime CDN, remote font, API key, backend, or external asset dependency. `npm run build` produces a static site in `dist/`; serve it over HTTPS for WebGPU. This is an HTML/JS application, not a single-file offline HTML export.

## Implemented

- Metric curve drawing; start → control → end. Degree-two road bends use a shared cubic-tangent solve for smooth continuation.
- A shared road/junction graph. Same-height crossings split incident roads and share a vertex; different-height crossings remain overpasses.
- Clickable junctions, numeric X/Y/Z editing, plan drag and Shift-drag elevation gizmo. Connected curves deform with the junction.
- Integer polygon union, morphological corner closing, indexed surface triangulation preserving block holes. At-grade road decks do not stack over each other.
- Continuous offset sidewalks, five metric paving patterns with relief-mapped mortar joints, and curbs standing 150 mm above asphalt.
- Crosswalk-aligned inset curb ramps, flared transitions, tactile warning tiles and instanced truncated domes.
- Recessed roadside channels, grated inlet wells and seated cast-iron manhole covers with actual road-deck cutouts.
- Intersection-aware local-road markings, crossings and stop bars. These are **illustrative**, not a jurisdiction-specific standards library.
- PBR asphalt color/roughness, material visibility, scene-layer visibility.
- Procedural street lights, cylindrical bollards, planting, and empty city blocks without buildings.
- Up to 25 preview vehicles on arc-length lane paths, with continuous corner traversal, cubic junction connectors, acceleration/braking, headway and simple junction reservations. Vehicles stop at terminal ends instead of snapping into a U-turn.
- Configurable raised speed humps: 50–120 mm high, 2.5–5 m long, with cosine-profile geometry, conforming approach chevrons, endpoint clearances, traffic slowdown and front/rear axle-based body pitch.
- Five network presets, empty projects, undo/redo, browser-local save, validated JSON import/export and ground-surface / network-bridge slab OBJ export.
- Perspective / top / street inspection camera, orbit/pan/zoom and free flight, grid and actual surface-wireframe inspection.

## 0.7 — one editable road / bridge graph

Open `?demo=bridges` with no saved project, or choose **Network library → Unified road & bridges**. The example is one connected graph: **36 road segments**, eight elevated spans/approaches, four curved approaches, a shared elevated four-way junction and ground streets below. It has 18 preview vehicles distributed across ground and elevated routes. There are no separate decorative bridge connections in this preset.

### Draw and edit

1. Choose **Asphalt road**, **Concrete access road**, or **Network bridge road**. Set the authoring **Y** elevation (0–40 m; network bridges start at 6 m). Click **start → control → end**. Endpoints snap to the actual sampled road alignment at compatible elevations, including nearby sloping approaches.
2. Select a road. **Raise road / shared ends** lifts both endpoint vertices and generates bridge structure automatically; adjoining roads remain attached and become approaches. **Start elevation** / **End elevation** allow independent heights. This does not detach a road from existing shared junctions.
3. Edit the **Spline control X/Z** coordinates or switch to **Move (G)** and drag the selected curve's control handle. Editing a previously split polyline deliberately replaces that segment with a quadratic curve. **Frame road / bridge** inspects a span closely.
4. Select a junction. Edit its X/Y/Z fields, drag in plan, or **Shift-drag vertically** in Move mode. Every incident road end follows the same vertex. Geometry changes reconcile compatible centreline intersections on completion.
5. Save locally, undo/redo or export project JSON to retain the entire editable network. JSON is the transfer format between Arena and raw.githack; browser saves are origin-scoped. Demo URLs never overwrite an existing save.

### Geometry and traffic

- Elevation is stored on graph vertices (`node.y`, default zero for old projects), in metres above the flat datum. Asphalt is at datum + 0.12 m. Endpoint elevations are joined with a cubic smoothstep between level junction landings; analytic height and grade are continuous.
- Compatible centreline intersections use a 20 mm height tolerance. Crossings on different driving levels do **not** acquire a traffic connection. Lowering an overpass to the other road's level rebuilds the at-grade junction. Splitting a sloping road re-solves its vertical approaches around the new shared landing.
- Raised junction footprints union only incident road mouths. Deck bodies subtract those footprints, giving disjoint top patches instead of crossing two ribbons on top of each other. Ground junctions retain the same centreline alignment used by traffic. Deck top tessellation uses local 2 m patches; sides and matching undersides close the 400 mm concept slab components.
- Guardrails follow exposed deck edges, not junction mouths. Candidate supports are omitted from lower-road/pavement corridors; ground light poles under bridge footprints are suppressed. This is **not structural sizing** or proof that the remaining spans are supportable.
- Vehicles use this same graph, follow deck elevation with front/rear axle pitch, and pass through the raised junction. The 25-car cap remains in effect. Ground-road humps and prior park assets remain supported.
- The inspector reports peak centreline grade against an illustrative 8.3% target and sampled proximity/clearance against 5 m. Checks sample centreline/envelope proximity every 2 m, subtract the 400 mm slab and exclude roads sharing an endpoint. They are **not** exhaustive full-width clearance, swept-vehicle, terrain, load or accessibility checks; low bridges warn rather than silently connecting levels.

**Remaining limits:** no bank/superelevation, terrain-conforming elevations, bridge sidewalks, detailed bridge drainage, engineering-rated girders/bearings/abutments or load analysis. Connected closed slab pieces retain internal component caps; the scene is not one welded manufacturing solid. Extreme/self-crossing splines still require design review. OBJ now includes ground carriageway faces and the unified network's deck tops/shells, but not bridge rails/supports, park connections, pavement detail meshes or props. Use JSON for the complete scene. Legacy **park footbridges** remain separate pedestrian/service-width assets for compatibility; they are not traffic routes.

References guiding this implementation: Epic's control-point, join and split spline workflow [1](https://docs.unrealengine.com/4.27/en-US/BuildingWorlds/Landscape/Editing/Splines); ASAM's distinction between shared same-level junctions and different driving levels [2](https://publications.pages.asam.net/standards/ASAM_OpenDRIVE/ASAM_OpenDRIVE_Specification/v1.8.1/specification/10_roads/10_01_introduction.html). Slate does not claim OpenDRIVE-format compliance.

## 0.6 — smooth bridge approaches and project-defined targets

Select a park bridge → **Approach design** in the inspector.

- The old abrupt ramp/landing breaks are replaced with parabolic toe and crest blends. The underlying longitudinal profile has continuous height and gradient; the rendered deck samples blend zones at no more than 200 mm spacing. The two 2 m end landings stay level and grounded. The elevated span stays level across the protected road/pavement corridor.
- **Toe / crest blend:** request 1–12 m transitions (default 3 m). On short approaches the actual blend is capped at half the available run. The inspector reports the actual length used on each side. Longer blends reduce abrupt changes in slope but increase the peak grade if rise/run are unchanged.
- **Target grade:** 2–15%, default 8.3%. This is an editable project target, not a national standard. Start and end approaches are checked independently, with additional run required at the current crossing reported in metres. Changing the target changes the checks, not the geometry or endpoint positions.
- **Road clearance target:** 2–10 m, default 5 m. The inspector shows nominal deck-underside clearance above the flat road datum. This does not account for road humps, crossfall, loaded deflection or a swept vehicle envelope. The existing hard rejection below 2 m nominal road clearance remains to prevent obvious intersections with the preview cars.
- A **longitudinal profile** plots the generated centreline, with vertical exaggeration and shading for the protected corridor. It displays peak centreline grade, actual approach runs/blends and nominal clearance; this is measured geometry rather than a decorative graph.
- All three settings support undo/redo and project save/import. Older projects receive the same defaults without losing their existing bridge widths, rises or endpoints.

These improvements do not establish structural capacity, accessibility compliance, vehicle breakover clearance or ride comfort. Curved deck-edge gradients can differ from the centreline grade. The legacy park bridges in this section are not AI traffic routes; 0.7 network bridges are.

## 0.5 — local pavement topology and park connections

**Pavement topology:** rendered flat surfaces are clipped into shared 6 m integer-grid patches before triangulation. This removes the old block-spanning skinny triangles around curved pavement rings. The ground-road OBJ component retains its separate triangulation. UVs remain in world space, so the paving pattern does not reset at patch edges. Corner-level browser checks now cover the district's curved corners, not only the simpler four-way fixture. Geometry tests check area coverage and a maximum 8.49 m triangle edge. Millimetre clipping tolerances remain; this is still a triangle mesh, not a welded all-quad export.

**Create connections:** use the dropdown and **Draw** button at the bottom-left of the viewport. Click **start → control → end**. Escape cancels. Existing road authoring remains available as **Asphalt road**.

- **Park walkway:** 2.5 m initial width, editable from 1.5–10 m. Ends near a road snap to the back of its sidewalk. The footprint is unioned into the paving, not layered over it. Carriageway crossings are rejected with a placement warning. Attach to a **level** sidewalk section, not a lowered crossing landing. Connections snap when drawn; moving the underlying road later may require adjusting their endpoints.
- **Concrete access road:** 5 m initial width, with endpoints snapping to road centerlines. It uses the actual road graph: existing roads split at the junction, the carriageway is unioned, and asphalt/concrete material footprints do not overlap. No centerline/edge stripes are stamped down the concrete access. Selected roads also have a **Road surface** selector. Preview traffic can use these roads.
- **Vehicle-width park bridge:** 4.5 m initial **clear width**, editable from 4–10 m, plus edge allowance for rails. A closed 350 mm deck, grounded approach ramps, 1.3 m railings and repeated park-side supports span the road. Supports avoid the road, sidewalks and park paths. Start/end points must lie inside the parks, beyond the road/sidewalk footprint. Deck rise is editable from 1–12 m. Steep approaches and low road clearance are reported; a deck too low for the preview cars is suppressed. The grade/clearance targets are design checks, not jurisdictional certification.
- **Editing:** select a connection in the viewport or its outliner row. Adjust width, bridge rise and start/end coordinates; frame or delete it. Layer toggles, JSON import/export, browser save and undo/redo retain the new features.
- **Landscape:** park lawn surfaces sit 30 mm below the paving. Trees and furniture avoid connection corridors. No buildings are added.

Choose **Network library → Park connections** for a prepared example with two connected park walks, a concrete access branch and a wide bridge. This replaces the scene only after confirmation and remains undoable. `?demo=parks` opens that example for a fresh browser without overwriting a saved project.

**Legacy park-bridge limitations:** these are geometric pedestrian/service-width bridge previews, not engineered vehicle bridges. Width does not establish a load rating. Structural sizing, vehicle swept paths, breakover and ride-comfort validation, local clearance, accessibility and collision validation remain to be engineered. These park-connection decks do **not** join the AI traffic graph. Park bridges/park paving are **not** included in OBJ export; use project JSON to retain editable geometry.

### Publishing through raw.githack

```sh
npm ci
npm run publish:static
```

`published/` is intentionally checked in for this deployment, including bundled JS, CSS, fonts and third-party license notices. The Vite base is relative, so the app works below a repository/commit path rather than assuming `/assets/`. After committing and pushing the session branch, use:

`https://raw.githack.com/unassignedinbox/Slate/COMMIT_SHA/published/index.html?demo=parks`

Replace `COMMIT_SHA` with the actual pushed commit. A commit-pinned URL avoids stale branch-cached builds. No credentials, backend or npm install are needed in the viewer's browser. Browser saves are scoped to the site origin: export/import project JSON when moving a saved scene from Arena preview to raw.githack. The original `index.html` is development source and should **not** be used as the raw.githack entry point.

## 0.4 — closed curb faces, fly camera and distinct ramp types

- **Curb/pavement shells:** road-facing, block-facing and terminal walls are extruded from the actual material polygons with outward-facing winding, plus underside caps. This fixes the old backward-facing inner curb walls without hiding the problem with double-sided materials. Walls follow the ramp heights and split at top-patch crease vertices. These separate rendered pieces are not a welded/manifold civil-export mesh.
- **Unreal-style navigation:** hold **RMB**, look with the mouse and fly with **WASD**; **Q/E** descend/ascend in world space. **Shift** gives 4× movement; the **wheel** changes fly speed from 0.25–200 m/s. RMB release, Escape, pointer cancellation or window blur clears movement. Form fields do not consume flight shortcuts. Left drag still orbits; **middle drag now pans**. Flight is collision-free, including below ground. Near clipping adapts for street-level inspection instead of cutting away nearby curbs.
- **Street inspection:** the person icon in the left viewport toolbar frames a pedestrian ramp, or the selected road's vehicle entry. **F** returns to the overview.
- **Pedestrians:** Pavement → Ramp type offers **Auto**, **Perpendicular**, and **Parallel / dropped**. The existing 2.4 m sidewalk now uses a full-width dropped landing with longitudinal approaches instead of forcing a perpendicular ramp with insufficient back landing. Wide sidewalks use a perpendicular ramp with a retained rear landing. Nominal pedestrian runs are at least 1.8 m for the 150 mm rise; flares are 1.5 m. The editor's perpendicular placement guard is a 1.22 m top landing; this is an application design target, not a universal legal requirement. Tactile panels follow the chosen ramp geometry. Old projects requesting shorter runs migrate to 1.8 m.
- **Vehicles:** select a road → **Pavement → Vehicle crossover**, or Street details → Vehicle crossover. One optional concrete apron per road has editable side (relative to A → B), width (3–7 m), run (1.5–3 m) and position (15–85%). It has a flush dropped kerb and retains at least 1.22 m of level pedestrian pavement behind the apron. It has **no pedestrian tactile panel**. On the default narrow pavement, the entry is suppressed with an explicit warning; **Widen + add** widens the network sidewalk deliberately. The default 2 m apron needs at least a 3 m sidewalk; the shortcut uses 3.2 m.
- **Integration:** both ramp types replace the underlying flat curb/pavement rather than stacking over it. Their footprints follow sampled road alignment. Vehicle entries avoid pedestrian crossings, humps, road ends, drainage grates/channels on their side and roadside fixtures. Placement settings and layer visibility support save/import and undo/redo. Splitting a road transfers its entry to one child, not all children.

**Still a visual design tool:** curved offset slopes, crossfall, driveway breakover/clearance, plot access and jurisdiction-specific approval require further engineering review. Vehicle aprons do not add buildings, plot driveways or new AI traffic routes. No claim of ADA/SANS/local-authority certification is made.

### Research used for this increment

- Epic's viewport documentation describes RMB-held WASD navigation, world-space Q/E movement and wheel-adjustable speed. [2](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine)
- The US Access Board guide informed flush curb transitions, nominal 1:12 running slopes, 1:10 flares and using parallel ramps where a perpendicular landing cannot fit. Those provisions are a design reference, not a claim of compliance with any jurisdiction. [1](https://www.access-board.gov/ada/guides/chapter-4-ramps-and-curb-ramps/)

## 0.3 — paving, drainage and embedded pedestrian access

- **Paving designs:** Materials → Pattern, or the **Surfaces** library. Running bond, herringbone, basketweave, large-format slabs and permeable-style blocks. Scale, rotation and stone tint are editable. Default units are 100 × 200 mm pavers / 600 mm slabs at 1×. These are procedural color + bump textures, not individually modeled paving blocks. The same UV scale continues across the ramp inserts; “permeable” denotes a visual pattern, not an infiltration simulation.
- **Crosswalks and ramps:** Inspector → **Pavement**. Crosswalk width, sidewalk width and ramp run share one layout. Ramp footprints are subtracted from the flat sidewalk/curb, then replaced with sloped central faces and flares. Curb walls are lowered at the entrance. Tactile tiles replace part of the ramp patch, with 5 mm truncated domes rendered at close range. No intact raised pavement or curb is left beneath these ramp inserts.
- **Drainage:** 380 mm-wide recessed V gutters, approximately 25 mm deep, with 320 × 900 mm open-slot inlet wells. Inlets avoid crosswalk/curb-ramp and speed-hump zones. Spacing is editable. Channels and wells remove the road deck below them, rather than covering uncut asphalt. There are no pipes, catchment calculation, hydraulic capacity checks, longitudinal drainage grades or water simulation yet.
- **Manholes:** Adjustable 500–1000 mm frame diameter and spacing. The road is cut to the frame footprint; the recessed lid has rim, cast-metal tread, fasteners and lifting slots. Turning a feature layer off regenerates the underlying uncut surface.
- **Persistence:** All settings support undo/redo and project save/load. Existing version-1 project files receive the new default settings on import. All new placement remains procedural/global, not individually draggable utility objects.

**Accessibility review is still required.** The v0.3 narrow-pavement landing limitation is now addressed by the automatic parallel-ramp layout described above. Narrower than 1.5 m, overlapping and incompatible approaches are still suppressed with placement warnings. Crossfall, local tactile rules, pedestrian signals and complete accessibility validation remain outstanding.

The road OBJ includes asphalt cutout boundaries but **does not include** ramp, gutter, grate, tactile, or manhole meshes. Use the Slate project format to retain the full editable scene. Polygon calculations use a millimeter grid; small seam-rounding tolerances remain.

## 0.2 — corner continuity, then one new feature

The reference editor's neutral near-black palette, DM Sans typography (self-hosted), rounded inspector cards, soft borders and monochrome selection states replace the former green-tinted chrome. The right-side layer stack/inspector layout remains.

**Fix first:** the old corner was two unrelated road endpoints with different normals. Both sides now share an exact tangent; road widths taper to a common cross-section at two-way joins. Asphalt boundaries, curb offsets, curved marking strips, picking and vehicle lanes use the same alignment. Dense sampling and millimeter-scale polygon cleaning remove visible butt-cap bulges without overlapping deck patches. This is tangent continuity (G1), not a full curvature-continuous or civil-design solver.

Vehicles retain residual travel distance when crossing a join. Genuine multiway junctions use explicit tangent-matched lane connectors instead of repositioning a car between offset centerlines. Two-way bends no longer impose an arbitrary junction dwell.

**Next feature, delivered:** select a road → **Inspector → Details → Traffic calming → Raised speed hump**. Alternatively select a road, then choose **Street details → Raised speed hump**. Adjust height, length and position; toggle the entire feature layer in the outliner. Placement is clamped away from junction mouths; too-short segments suppress the hump. Settings survive save/import and undo/redo. Humps are detail geometry and are **not included in road-surface OBJ exports**. Chevrons and the 12 km/h slowdown are preview design choices, not road-authority certification.

Further infrastructure features (engineered guardrails/bridges, damage/construction, rail/tunnels) remain separate steps, not placeholder toggles.

## Controls

| Action                     | Control                          |
| -------------------------- | -------------------------------- |
| Select road / junction     | Click · `V`                      |
| Move shared junction       | `G`, drag junction center        |
| Draw quadratic road        | `B`, click start / control / end |
| Cancel drawing             | `Escape`                         |
| Frame default network view | `F`                              |
| Orbit / pan / zoom         | Left drag / middle drag / wheel  |
| Free camera                | Hold RMB + WASD; mouse looks     |
| Fly down / up              | RMB + Q / E                      |
| Fly speed                  | RMB + wheel; Shift = 4×          |
| Street-level inspection    | Person icon on left toolbar      |
| Undo / redo                | Ctrl/Cmd Z / Ctrl/Cmd Shift Z    |
| Save in browser            | Ctrl/Cmd S                       |

The viewport move tool uses free XZ translation, not axis-constrained translation. Selected road curvature can be adjusted in the inspector; its displayed control marker is not yet draggable.

## Geometry contract and limitations

`src/network.js` is a renderer-independent geometry core. Lengths are meters; Clipper coordinates use a 1 mm integer scale. Sampled centerline ribbons are unioned, closed with round offsets, then triangulated by Earcut with polygon holes. Pavement is an outer offset minus the inner curb boundary, not a second asphalt deck. Curb walls are constructed from quad strips and split to triangles for rendering.

**The asphalt surface currently uses indexed triangles throughout, not a quad-dominant road remesher.** Long/skinny triangles remain possible. The corner closing parameter is not a certified curb-return radius; extremely acute branches, self-intersecting curves, incompatible widths, very close junctions, and short approaches need additional design constraints. Tests establish finite geometry, area preservation and graph connectivity, not road safety or perfect topology under every input.

Crossings are auto-split when drawing; moving an existing road across another existing road does not currently rebuild the crossing graph. A future edit-time planarization pass is needed. Drawn splits store sampled polylines; original quadratic control information across a split is not retained. The mesh export is **asphalt only** and not watertight. A thick deck, quad-dominant retopology, swept-path validation, standards-compliant junction connectors and full engineering validation are outstanding.

## Not implemented

- Engineered highways / interchanges, superelevation, engineered vertical alignment and hydraulic drainage design. Cubic grade transitions for network bridges are implemented.
- Engineered highway bridges, structural/load verification, underpasses and tunnels. (Unified spline-road bridge geometry and legacy park footbridges are implemented, without structural certification.)
- Railway / subway geometry, trains and station infrastructure.
- Potholes, damaged surface layers, short modular speed bumps / speed cushions, and construction phases. (Full-width raised speed humps are implemented.)
- Guardrail design families, parking layouts, billboards, traffic signals and road furniture asset catalogs.
- Accessibility certification, crossfall validation, jurisdiction-specific tactile layouts, markings and signage. (Basic ramps and tactile geometry are implemented.)
- Certified collision-free intersection traffic, signals, yielding rules and swept-turn validation. Curved lane connectors and simple reservations are implemented, but extreme junction layouts are not validated for vehicle-body clearance.
- AAA vehicle/vegetation meshes, scanned materials, terrain grading and physically calibrated lighting.

There are no decorative controls pretending to implement these systems. See the in-app Help dialog for the same scope disclosure.

## Renderer behavior

The application requests a WebGPU adapter/device and uses Three.js `WebGPURenderer`. If unavailable, it clearly labels a `WebGL2 fallback`. Device loss displays a recovery action that preserves the current project in session storage and reloads in compatibility mode. `?renderer=webgl` forces compatibility explicitly.

The sandbox's software Chromium successfully exercised the WebGL2 UI and rendering path. Its forced WebGPU adapter initializes, but its headless swapchain fails (`SharedImageBackingFactory` unavailable); **hardware WebGPU visual rendering has not been verified here**. The device-loss recovery path is included rather than leaving an unlabeled blank viewport. Software-rendered frame rates are not a hardware performance benchmark.

## Tests

```sh
npm test                 # geometry / import validation
npm run build            # production bundle
# With the dev server running:
npm run test:browser     # Chromium UI + fallback rendering smoke test
npm run test:gpu-recovery # forced software WebGPU device-loss recovery
npm run test:continuity-browser # speed-hump editing, persistence, layer toggles and neutral UI
npm run test:streetscape-browser # paving, embedded ramps, drainage, covers and save/reload
npm run test:curbs-camera-browser # flight controls, ramp modes, vehicle aprons and street-level screenshots
npm run test:elevated-browser # spline bridges, elevation topology, gizmos, persistence and undo
npm run test:parks-browser # connection authoring, bridge profiles/targets, undo/redo and persistence
npm run test:corners-browser # street-level district corner screenshots
npm run test:static-browser # compiled published build under a nested URL path
```

The browser harness uses an npm-distributed Linux Chromium and extracts its bundled runtime libraries, avoiding an external browser download. Generated screenshots go in ignored `.artifacts/`. Static detail geometry is batched by material. Dependency and generated build directories are not committed.

## References

- Inspected `c7egoist/Frontier`, branch `arena/8070fd6c-frontier`, including its corner/geometry architecture. No implementation was copied.
- Inspected `SultanAladin/Frontier-`, `Experimental/FrontierEditor/style.css` and README for visual direction. The requested exact `ProjectZeroEditor` path was not present in that tree; this editor adapts the charcoal outliner/inspector language in a new layout.

See `THIRD_PARTY_NOTICES.md` for dependency licenses.
