# Frontier Road Studio

An experimental, working **road-network authoring editor** for Slate. Its charcoal/olive interface is inspired by the browser editor in [Frontier / Experimental / FrontierEditor](https://github.com/SultanAladin/Frontier-/tree/main/Experimental/FrontierEditor), associated with Project-Zero.

This is a standalone React + Three.js application. It does **not** modify the linked repository or connect to Frontier's native C++ renderer.

## Start

Node.js 20.19+ is recommended.

```sh
npm ci
npm run dev -- --port 5173
```

The server binds to `0.0.0.0` and accepts the proxied preview host. There are no required external assets or services; fonts, icons, materials, and geometry are local.

```sh
npm run build
npm run preview -- --port 5173
```

A desktop browser with WebGL 2 is recommended. If WebGL cannot initialize, the project loads a simple selectable 2D network view; 3D camera functions are unavailable in that fallback.

## What works

- **48 road/bridge presets:** the original twelve — urban arterial, neighborhood street, city boulevard, expressway, interchange ramp, country road, road overpass, surface railway, shared pathway, subway corridor, roundabout, and service road — plus **24 additional road profiles and 12 bridge designs**, detailed below. Five connected templates add **cloverleaf and diamond interchanges**, plus **T-junction, Y-merge and four-way connectors**.
- Two-click spline drawing; hold **Shift on the finish click** to add a curved midpoint. Endpoints snap to nearby existing nodes. Optional 5-meter grid snapping is available.
- New straight **and curved** roads split at-grade crossings into shared junctions. Spline intersections are refined in arc-length space and checked for elevation. Rail/road crossings and raised overpasses do not become road junctions.
- Shared-node editing: moving a handle moves every connected endpoint. Insert midpoint handles, split segments, duplicate, hide, or delete roads.
- Roundabouts have twelve circular arc segments with shared entry nodes, a paved ring, and a central island. Circulation is counterclockwise for right-hand profiles and clockwise for left-hand profiles. Snap approach roads to those nodes. Duplicating an arc duplicates its whole roundabout.
- Live lane profiles: one-way/two-way traffic, travel-lane counts and widths, medians, dedicated bus lanes, protected cycle lanes, parking bays, paved sidewalks, raised curbs, lighting, markings, elevation, and design speed.
- Asphalt, concrete, stone-paving, gravel and timber-deck surface materials. Lane surfaces, directional arrows, bus/cycle stencils, crosswalks, parking dividers, and center/edge lines are generated geometrically.
- Regional visual profiles for the United States, United Kingdom, continental Europe, Japan, and Australia, including left/right-hand driving conventions.
- Ten placeable street details: zebra crossing, lane arrow, bollard, speed hump, a short railway-crossing kit, street light, bus shelter, metro entrance, vehicle pavement ramp, and pedestrian curb ramp. New lane arrows and zebra decals project onto curved road surfaces and avoid junction/rail buffers. Their saved road-frame anchors follow reshaping/elevation changes and remap onto split segments; numeric transforms, dragging and rendered geometry use the same resolved position. The inspector identifies the attached road, limits surface lift to 30 mm, and shows orphaned/blocked markings without rendering floating fallback boxes; the short crossing kit is distinct from the continuous railway tool. Select them in the viewport or Scene tab, then move, rotate, resize applicable assets, duplicate, or delete them.
- **Four curb drainage styles:** gutter grates, kerb openings, continuous linear slot drains, and combined grate/inlet units. Spacing is editable; hardware avoids junctions, railway decks and access ramps. Kerb inlets cut the actual curb beam.
- **Real dropped-curb geometry:** vehicle access ramps lower the curb and paving together and include a 5 m concrete apron. Pedestrian ramps have tactile warning pads; both sides of generated or placed crosswalks get automatic drops. Custom ramp position, side, width and run are editable and road-relative, including after a split.
- Seeded **2 × 2, 4 × 4, and 8 × 8 km** city generation in grid, organic, radial, or cloverleaf layouts. Surface railway, bus/cycle/parking lanes, river bridges, and subway corridors are optional where applicable. Buildings are deliberately excluded.
- Perspective and top views, orbit/pan/zoom, Unreal-style free-flight controls, layer visibility, subway authoring overlay, minimap navigation, wireframe, and viewport screenshots.
- Automatic connected-road drive preview. This is an animated follow camera, **not vehicle physics**.
- 35-step project undo/redo, browser-local autosave, validated JSON import, and GLB/OBJ/JSON downloads.

## Expanded road and bridge library

The always-visible **Road profiles +24** and **Bridges +12** collection buttons expose the expanded catalog without scrolling past the featured cards. There are **35 non-bridge profiles and 13 bridge designs** (including the original overpass), plus five separate junction/interchange templates. Search and category filtering work across the full library. A saved `presetId` retains the profile identity, while `type` keeps the native road/rail/path domain for clean connectivity.

### 24 additional road profiles

| Category     | Added profiles                                                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Urban · 12   | Compact residential street; wide residential street; one-way neighborhood street; one-way city avenue; urban collector; four-lane undivided avenue; six-lane arterial; eight-lane boulevard; garden boulevard; transit boulevard; protected cycle street; paved shared street |
| Highways · 6 | Six-lane motorway; eight-lane motorway; one-way motorway carriageway; concrete expressway; two-lane interchange ramp; highway frontage road                                                                                                                                   |
| Rural · 4    | Single-track country lane; wide rural highway; gravel access road; farm service lane                                                                                                                                                                                          |
| Paths · 2    | Six-meter paved promenade; 3.2-meter asphalt cycleway                                                                                                                                                                                                                         |

These are not aliases: lane count/width/direction, medians, shoulder width, bus/cycle/parking bands, sidewalk dimensions, curb treatment and/or running-surface material change the actual road profile. Every profile remains editable, connects through the same at-grade topology pipeline, and survives splitting/import/export. Path width now controls its physical deck width instead of a hard-coded strip.

### 12 additional bridge designs

| Design                      | Visible structural geometry                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| City slab overpass          | Two-lane concrete deck with close-spaced piers                                             |
| Steel I-girder              | Exposed webs and top/bottom flanges below a thin roof slab                                 |
| Concrete box girder         | Twin box soffits and webs, with an open interior rather than a solid filled deck           |
| Tied through-arch           | Paired arch ribs, vertical hangers and high overhead ties                                  |
| Masonry arch viaduct        | Repeated stone arch voussoirs, spandrels and pier bents                                    |
| Warren truss                | Triangulated side frames, posts, chords and overhead bracing                               |
| Cable-stayed                | Twin portal pylons with fan cables to the deck edges                                       |
| Suspension                  | Twin towers, curved main cables, vertical suspenders, anchor cables and stiffening girders |
| Concrete urban viaduct      | Six-lane deck, frequent pier bents and edge haunches                                       |
| Covered timber              | Timber side trusses/planking, timber bents and a pitched roof                              |
| Timber trestle              | Exposed timber stringers, braced bents and textured board decking                          |
| Pedestrian truss footbridge | Four-meter path-domain deck, safety rails and pedestrian-scale trusses                     |

Choose a bridge, click its approach start, then its finish. The live preview includes the structure silhouette; all designs generate smooth Bézier approaches with ground/snap-height ends and a raised central span. Existing roads below stay grade-separated. **Bridge structure** in the Inspector edits family, pier spacing (16–120 m), deck thickness, arch/truss/roof rise where appropriate, and cable/suspension tower height (8–40 m). Deck elevation, lanes, sidewalks and materials remain editable. Footbridge path width can be edited without turning it into a vehicle road.

The same frame planner supports rotated and gently curved alignments. Low vehicle-crossing ties are avoided, and below-deck decoration/piers check lower road/rail corridors. These are architectural authoring templates, **not certified structural designs**: the clearance readout describes the deck envelope; check supports, cable placement, grades and curved spans for the target project. Girder/box/trestle central decks use a thin slab so their actual structural members remain visible. Timber grain and board-joint textures are generated locally and exported with materials.

## Camera and editing shortcuts

| Input                  | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| Right mouse drag       | Free look                                                    |
| WASD                   | Horizontal fly movement, including while holding right mouse |
| Q / E                  | Descend / ascend                                             |
| Shift while flying     | Speed boost                                                  |
| Alt + left drag        | Orbit                                                        |
| Middle drag            | Pan                                                          |
| Mouse wheel            | Zoom                                                         |
| F                      | Frame selected road or detail                                |
| Home                   | Frame the network                                            |
| V                      | Selection tool                                               |
| R                      | Draw a road                                                  |
| G                      | Drag spline handles or a selected placed detail              |
| Shift + finish click   | Curved road                                                  |
| Escape                 | Cancel tool / stop drive preview / close dialog              |
| Delete / Backspace     | Delete selection                                             |
| Ctrl / Cmd + Z         | Undo                                                         |
| Ctrl / Cmd + Shift + Z | Redo                                                         |
| Ctrl / Cmd + S         | Save locally                                                 |
| Ctrl / Cmd + K         | Focus library search                                         |
| ?                      | Help and shortcuts                                           |

Choose **Roundabout** under the Structures category: click its center, then its radius. **Cloverleaf** and **Diamond** use a center click and a second click to set size/orientation. Connector tools use a first click on an existing road, followed by a branch endpoint. Other roads and railway lines use start and finish clicks. Assets use click-to-place, not drag-and-drop from the library.

## Rail, overpasses and interchanges

The library has six always-visible shortcuts:

- **Railway:** draw continuous single–four-track surface lines. Default: two tracks, 4.2 m spacing and **1.435 m standard gauge** (measured between the inside rail-head edges). Steel head/web/foot geometry, sleepers and ballast follow the spline. At matching-height road crossings, concrete panels replace the road slice, sidewalks ramp down, lane paint stops short, flange recesses remain visible and signals/open barriers are generated. Track count, spacing, gauge, crossing treatment and signals are editable. The surface-rail layer is separate from the underground metro overlay.
- **Overpass:** draw a raised road across a lower road. Cubic Bézier approaches connect to a flat central deck. Concrete slabs, guardrails, capped piers and terrain-embedded footings are generated; each physical pier/footing footprint is checked against lower roads/rails, including parallel roads under wide decks, and automatic streetlights/trees are not placed through raised decks. The inspector reports crossing clearance and maximum grade. Short approaches or low clearance produce a warning, not an engineering approval.
- **Cloverleaf:** place the whole interchange in clear space with two clicks, or choose **City generator → Cloverleaf** for a dedicated map. It contains **28 segments: 20 split one-way mainline sections, four 270° loop ramps and four exterior connectors**. All sixteen merge/exit nodes are shared, and all twelve straight/left/right movements are connected. North–south passes above east–west without a central road junction. The default footprint is approximately 1.23 km across, with a 55 m loop radius and 8 m deck height. Generator radius and height are adjustable. Changing **Interchange height** updates every connected ramp/mainline; duplicating a member duplicates the complete interchange with fresh IDs.

- **Diamond:** a classic raised-highway interchange with **13 segments: six split one-way highway sections, three ground cross-street sections and four directional slip roads**. Six real junctions connect all twelve straight/left/right movements. Both ramp terminals stay at grade; the highway crosses the street above them. Changing interchange height or duplicating a member acts on the whole group. Supports rotated placement and left-driving profiles.
- **T-junction:** click an existing street, then the branch endpoint. The street is split at its actual spline position, and the new two-way branch shares that node. It never duplicates the existing carriageway.
- **Y merge:** click an existing road, then the entry-ramp start. A one-way cubic ramp approaches tangent to the mainline and shares its split node. Existing-road shape and attached paint/access ramps are preserved.

A **Four-way connector** is also available under **More road categories → Junctions** (or library search). It adds two opposite branches to the same split node. T/four-way tools need ground-level streets and reject near-parallel branches. All connectors require at least 24 m of branch length and an endpoint outside the existing road corridor.

At-grade intersections with existing roads are connected during template insertion. Placement that would stack its mainlines on existing parallel streets is rejected: move it into clear space or generate an interchange map instead. Very acute rail angles and rail lines running longitudinally inside a road require manual treatment; automatic level crossings need an angle above approximately seven degrees and matching elevations.

Existing schema-1 projects are compatible; their junctions render through the new topology builder without replacing your saved roads. Bézier splits and inserted handles preserve the curve analytically; sliced legacy Catmull–Rom roads use a fine distance-parameterized polyline approximation.

## Drainage and pavement access

1. Select a road with paved sidewalks. Under **Inspector → Roadside details**, enable raised curbs and choose **Curb drainage**. Gutter grate, kerb opening and combined inlet have an editable **Drain spacing** (8–100 m); linear slots are continuous between protected gaps. Drain spacing follows the same absolute station phase after road splits.
2. Choose **Vehicle pavement ramp** or **Pedestrian curb ramp** in the bottom Street details tray (also under **Infrastructure**), then click near the desired curb. The actual curb beam and sidewalk surface are lowered, with flared transitions back to the ordinary pavement height. The vehicle apron extends 5 m beyond the pavement; pedestrian drops have textured tactile warning paving.
3. Select the ramp or its Scene entry. Edit **Asset width** (1.2–12 m), **Curb side** and **Ramp run**, or press **G** to drag it along/onto another road with sidewalks. Elevation and orientation follow the road rather than floating in world space. A deleted road or removed sidewalk leaves an authoring attachment available for undo/repair, but no floating replacement ramp.
4. **Crosswalk curb ramps** controls paired automatic pedestrian drops at that road's generated and placed zebras. A placed pedestrian ramp can replace a coincident automatic drop for custom sizing. Custom ramps remain independent of the automatic toggle.

Pavement starts at the road's 0.1 m surface level at a ramp mouth and rises to its ordinary 0.28 m level over the chosen run. Drain bodies avoid ramp/flared-edge spans and rail decks. These are static authoring meshes, not water-flow/vehicle physics or an accessibility/engineering certification; review slopes, landings and placement for your target project.

## Export workflow

**GLB** preserves indexed geometry, normals, UVs, material assignments, and procedural surface/stencil/tactile textures. Drain and access meshes are included; merged mesh extras retain streetscape and bridge structural-feature counts. Core carriageways/junctions are welded and batched by material; curbs, slabs, rail and furniture retain their authoring groups. Use JSON for individual editable-road semantics. Instanced street lights and guardrail posts are expanded to ordinary mesh nodes for broad importer compatibility; no GPU-instancing extension is required.

**OBJ** contains geometric surfaces and UVs, without an MTL sidecar. Choose GLB if materials are needed. For compact road-only OBJ files, disable **Include procedural street lights**. Explicitly placed details and bridge guardrails remain included.

**JSON** preserves the full editable project: road profiles, spline/control points, node IDs, roundabout/rail/interchange parameters, road preset identities and bridge families/spans/rise/towers/support spacing, drainage and road-relative curb-ramp anchors, Bézier controls, traffic profile, generator metadata, visibility, and placed details. Open it using **File → Open road project**. JSON is the authoring source of truth; mesh exports are not re-importable as editable splines.

Mesh exports omit terrain, river water, decorative street trees, authoring handles, and editor overlays. Subway geometry is exported at its actual underground elevation, not the raised planning-overlay position.

### Units and axes

The model uses meters and Three.js's Y-up coordinates. The inspector displays the ground plane as X/Y and elevation as Z, matching Unreal-style navigation conventions.

- **Standard glTF · Y-up · meters** is the default. Use it with importers that already convert glTF axes and units.
- **Unreal mesh pipeline · Z-up · centimeters** applies a +90° X rotation and 100× scale. It is useful for OBJ or custom engine pipelines that require explicit Z-up centimeter data.

Do not apply both this export conversion and another importer conversion. Engine import settings, collision, streaming, and gameplay integration must be configured in the target engine; native Unreal imports have not been executed here.

## Geometry and performance

Roads use centripetal Catmull–Rom splines, cubic Bézier paths, exact circular roundabout arcs and distance-parameterized polylines. A shared topology planner computes cutbacks from actual spline frames, not adjacent control-point chords. Junction contours reuse the exact road portal coordinates/elevations, with concave curb returns and pavement strips rather than convex-hull overlays. Carriageways have the same 0.1 m surface offset across roads and junctions; sidewalk returns use the same 0.28 m offset as sidewalk ribbons. Smooth degree-two connections share a mitered cross-section instead of acquiring a bulky patch.

Core surfaces use world-space UVs and are welded across road/junction seams before normals are recomputed. Base samples are approximately 2.5 m apart, or 1 m on raised roads/ramps, capped at 700 subdivisions. Curb drops insert exact stations at their mouths/flared edges plus local 0.5 m sampling, so small access ramps cannot disappear between base samples. Paint is projected onto curve frames and masked by junction/crossing buffers. Solid beams/slabs use longitudinally shared indexed face strips to keep large exports manageable.

The live viewport batches by material while retaining face-range mappings for selection. Furniture uses instancing, static shadows are cached, idle scenes render on demand, and a logarithmic depth buffer plus an altitude-adaptive near plane stabilizes thin markings over large worlds. Export generation pauses GPU work and lazy-loads export libraries. Core surfaces remain welded in GLB/OBJ; separate slabs, paving, rail and paint remain intentional components.

The import safety limits are **2,000 road segments**, **5,000 placed details**, **128 spline points per segment**, and **8 MB per JSON file**. The densest generator setting produces 316 segments. Mesh-file size and frame rate depend on network extent, density, furniture, and GPU; large OBJ exports can still be substantial.

## Deliberate boundaries

This is an **experimental browser authoring tool**, not a production highway-engineering package or an NFS game engine:

- Regional markings are visual design profiles, not certified regulatory implementations or an exhaustive collection of every road type worldwide. Presets can be extended in `src/lib/profiles.js`.
- Road/junction surface seams are stitched and welded within material batches, but this is **not one globally watertight solid/collision mesh**. Paint, paving, slabs and hardware are separate components; engineering-grade fillets, structural sizing, clearance envelopes, physics collision cooking and terrain embankments remain target-engine work. Extreme widths, very short segments or self-crossing hand-edited splines can still need manual correction.
- Subway authoring currently covers twin tracks, a bed, and surface entrances, not excavated terrain or complete enclosed stations/tunnels.
- Trains are continuous static infrastructure, not animated rolling stock or a railway signaling simulation. There is no traffic AI, vehicle simulation, navmesh generation, native editor plugin, terrain deformation, occlusion system, or world-partition streaming.
- Saves live only in the current browser/origin. Export JSON regularly for portable backups. If browser storage is unavailable or full, the header asks you to export instead of falsely reporting a successful save.

## Verification

```sh
npm test
npm run build
```

Unit checks cover deterministic generation, 8 km city data, exact welded portal-edge incidence, ray coverage at curved seams, sidewalk returns, Bézier shape/tangent preservation, curved at-grade crossings, paint clipping, stable marking anchors/transforms/split remapping, continuous rail/grade separation, pier exclusion, bridge clearance, all 48 catalog identities, distinct road layouts, all twelve new bridge families, exposed girders, structural clearance, curved alignments, safe midpoint splits and all twelve cloverleaf and diamond movements, actual existing-road connector splitting, rotated/left-driving templates, drain/ramp exclusion, flush dropped-paving ray coverage, curb-inlet gaps, curb-ramp transforms/split remapping, JSON round trips and import validation.

With the dev or preview server running:

```sh
npm run test:e2e
# Only the rail/overpass/interchange browser suite:
npm run test:e2e:infrastructure
# Only the drainage/curb-access/connector browser suite:
npm run test:e2e:streetscape
# Only the expanded road/bridge catalog browser suite:
npm run test:e2e:catalog
# Another server/port:
EDITOR_URL=http://127.0.0.1:5173 npm run test:e2e
```

The browser checks exercise real WebGL rendering, drawing, live profile changes, history, detail transforms, scene selection, regional markings, material changes, WASD/free look, top view, layers, drive preview, 4 km organic generation, all three downloads, JSON import/reload, help, and responsive layout. The infrastructure suite additionally draws real rail lines and overpasses, edits gauge/track count/decks, places projected decals, generates/places cloverleaves, changes connected ramp heights, preserves Bézier handles, and tests infrastructure exports/persistence, rejected numeric marking edits, cancel-with-Escape, road-following decals, surface-lift controls and G-drag reattachment from hidden roads. The streetscape suite checks four drainage controls, curb ramp placement/width/run/side edits, history, actual G-drag, crosswalk pairing, split remapping/reload, existing-road connector placement, diamond height editing and GLB/OBJ drainage/access meshes. The catalog suite draws all 24 added profiles and all 12 bridge designs through the UI, checks structural previews and dimensions/family/history, reloads the complete bridge collection, and verifies its actual geometry/material exports. GLB headers/materials/streetscape/bridge metadata and OBJ vertices/faces are checked, and browser runtime errors fail the test. Evidence goes to ignored `.arena/e2e/`, `.arena/infrastructure/`, `.arena/streetscape/` and `.arena/catalog/`; large generated exports are not committed.

On Linux x64, the test uses the npm-distributed headless Chromium binary and bundled libraries. Other platforms may use their installed Playwright Chromium, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Source layout

```text
src/App.jsx                 Project history, persistence, actions, application shell
src/components/Viewport.jsx Three.js lifecycle, navigation, picking, tools, exports
src/components/Inspector.jsx Road/detail property controls and lane cross-section
src/components/Library.jsx   Road presets, scene hierarchy, detail tray
src/components/Dialogs.jsx   City generation, export, and help
src/components/Thumbnails.jsx Original procedural SVG illustrations
src/engine/roads.js          Scene construction, materials, batching, props and terrain
src/engine/features.js       Road paint, paving, rail and bridge rendering
src/engine/bridges.js       Exportable arch/truss/cable/girder/roof mesh construction
src/engine/streetscape.js    Integrated pavement/curb drops, tactile pads, inlets and grates
src/engine/geometry.js       Pure indexed geometry and surface welding
src/lib/network.js           Authoring model, city generation and validation
src/lib/profiles.js          Road presets, lane bands and driving conventions
src/lib/curves.js            Splines, frames and analytic Bézier slicing
src/lib/topology.js          Shared portal/cutback/curb-return planner
src/lib/connectivity.js      Refined curve intersections and atomic insertion
src/lib/infrastructure.js    Crossings, pier exclusion, clearance and placement checks
src/lib/bridges.js          Road-frame structure members, spans and corridor protection
src/lib/structures.js        Connected interchange/overpass and existing-road junction factories
src/lib/streetscape.js       Curb anchors, drop profiles and protected drainage stations
src/lib/markings.js          Paint footprint/buffer planner
src/lib/placement.js         Surface-aware street-detail placement
src/styles.css              Editor styling and responsive layouts
```
