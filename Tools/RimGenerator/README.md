# Slate One-Piece Y Rim Generator

This is a Blender 3.6+ procedural asset tool for a high-fidelity wheel **rim only**. It generates a one-piece Y-spoke assembly, an editable lathed blank-rim cross section, physically readable lug nuts and bolt shafts, PBR materials, and a GLB export path. It never creates a tyre or tyre material.

## Install

1. Zip the `Tools/RimGenerator` folder, or select `Tools/RimGenerator/rim_generator.py` directly.
2. In Blender, open **Edit > Preferences > Add-ons > Install** and select the zip/script.
3. Enable **Slate One-Piece Y Rim Generator**.
4. Open the 3D View sidebar with `N` and choose the **Rim Generator** tab.

## Generate

1. Set bead diameter, width, dish, hub fitment, Y-spoke count/style, lug pattern, finish, and segment density.
2. Click **Generate One-Piece Y Rim**.
3. The generated asset is placed in the `RIM_GENERATOR` collection.
4. Click **Export GLB** to export the whole generated assembly using the path in the panel.

The default is a 5 Y, 18 x 9.5 in performance rim with 5 hex lugs. The wheel axle is +X so the camera-facing rim face is +X and Blender's +Z remains world up.

## Topology intent

- `Rim_OnePiece_Y_Assembly` is the single main mesh datablock containing the revolved blank, hub ring, and every Y spoke.
- Each Y is generated from one closed concave silhouette and extruded as one continuous prism. There is no separate `V + |` construction and no loose straight bar hidden inside the spoke.
- `Rim_Lug_Nuts_And_Bolts` is a separate serviceable hardware mesh containing a bolt shaft, washer, and chamfered hex nut for every lug.
- `Rim_Center_Cap` is separate serviceable hardware. `Rim_Inner_Barrel_Shading` is only an inner-barrel material/shading ring; it is not a tyre.
- The `Rim_Generator_Root` custom properties record the no-tyre rule, units, profile source, finish, and topology intent for downstream exporters.

The blank, hub and spoke shapes are intentionally one main object for game export. They use overlapping, manufactured clearances instead of a destructive boolean union, so the Y transitions stay stable when artists change parameters. Apply the bevel modifier and run the target engine's normal validation pass before a final shipping bake.

## Editable blank cross section

`RimBlank_CrossSection` is a cyclic Blender Curve. Its control points are `(axial width, radius)` in meters and it is the source of the revolved blank when **Use edited cross-section curve** is enabled.

- Leave that option off while iterating the numeric diameter/width parameters.
- To design a custom barrel/lip, select `RimBlank_CrossSection`, press `Tab`, move or add profile points, enable the option, and generate again.
- **Reset Cross-Section** restores the parameterized lip, bead-seat, barrel and rear-return profile.

## Materials

The generator creates or refreshes these node-based materials:

- `Rim_Finish_*`: brushed silver, gunmetal, satin black, forged bronze, or ceramic white.
- `Rim_Inner_Barrel`: dark metallic inner barrel for depth behind the Y spokes.
- `Rim_Machined_Edge`: high-metallic machined highlight, optionally assigned to the spokes.
- `Rim_Titanium_Lugs`: bolt, washer and hex-nut hardware.
- `Rim_Center_Cap`: matching center cap.

All surfaces use Principled BSDF metallic/roughness values and the mesh receives smooth shading plus a small angle-limited bevel for clean AAA highlights.

## Reference direction

No external image is bundled or baked into the tool. The visual direction is a modern one-piece forged Y-spoke layout with aggressive concavity and clear brake-space openings, informed by the public RVRN RV-MR01 reference:

<https://rvrnwheel.com/products/1-piece-y-spoke-forged-wheels-series-rv-mr01>

This is only a design reference; no third-party geometry or textures are imported.
