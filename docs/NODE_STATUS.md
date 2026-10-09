# Node status

Every Gaea node id from the requirement list (1–240) is registered in `src/engine/registry.js`, plus one extra node (241, Substance-style procedural fill).

Counts: 163 implemented, 78 approximate.


- **implemented** — runs the described operation directly with the listed parameters.
- **approximate** — runs, but uses a simplified or heuristic form of the named Gaea behaviour. Do not expect parity with QuadSpinner output.

| ID | Node | Category | Mode | Status | Params |
|---|---|---|---|---|---|
| 1 | Constant | Primitives | gen | implemented | value, seed |
| 2 | Perlin | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 3 | Simplex | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 4 | Value Noise | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 5 | Voronoi (F1) | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 6 | Voronoi (F2) | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 7 | Voronoi (F3) | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 8 | Voronoi (F4) | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 9 | Voronoi Crackle | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 10 | Worley | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, jitter |
| 11 | Cellular | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed |
| 12 | Gabor | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed, angle |
| 13 | Sparse Convolution | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed |
| 14 | Wavelet | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed |
| 15 | fBm (Fractal Brownian Motion) | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 16 | Ridged Multifractal | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 17 | Billow | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 18 | Swiss | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 19 | Jordan | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 20 | Random | Primitives | gen | implemented | seed |
| 21 | Grid | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed, lineWidth |
| 22 | Hexagonal | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed |
| 23 | Brick | Primitives | gen | approximate | scale, offsetX, offsetY, rotation, seed, lineWidth |
| 24 | Checker | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 25 | Stripes | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 26 | Sine | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 27 | Sawtooth | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 28 | Triangle Wave | Primitives | gen | implemented | scale, offsetX, offsetY, rotation, seed |
| 29 | Gradient Linear | Gradients | gen | implemented | angle, extent |
| 30 | Gradient Radial | Gradients | gen | implemented | extent |
| 31 | Gradient Angular | Gradients | gen | implemented | offset |
| 32 | Gradient Square | Gradients | gen | implemented | extent |
| 33 | Shape Circle | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 34 | Shape Square | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 35 | Shape Triangle | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 36 | Shape Star | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 37 | Mountain | Shapes | gen | implemented | centerX, centerY, radius, octaves, lacunarity, gain, seed |
| 38 | Volcano | Shapes | gen | implemented | centerX, centerY, radius, seed |
| 39 | Mesa | Shapes | gen | implemented | radius, height, seed |
| 40 | Dunes | Shapes | gen | implemented | angle, wavelength, seed |
| 41 | Hills | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 42 | Ridges | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 43 | Crater | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 44 | Canyon | Shapes | gen | implemented | width, seed |
| 45 | Plain | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 46 | Plateau | Shapes | gen | implemented | detail, seed |
| 47 | Cliff | Shapes | gen | implemented | position, seed |
| 48 | Rocky | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 49 | Badlands | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 50 | Coast | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 51 | Island | Shapes | gen | implemented | centerX, centerY, radius, detail, seed |
| 52 | Continent | Shapes | gen | implemented | scale, offsetX, offsetY, rotation, seed, octaves, lacunarity, gain |
| 53 | Hydraulic (General) | Erosion | mod | implemented | iterations, seed |
| 54 | Hydraulic Rain | Erosion | mod | implemented | iterations, seed |
| 55 | Hydraulic Flow | Erosion | mod | approximate | K, iterations |
| 56 | Hydraulic Stream | Erosion | mod | approximate | K, threshold, iterations |
| 57 | Hydraulic River | Erosion | mod | approximate | K, threshold, iterations |
| 58 | Thermal | Erosion | mod | implemented | talus, rate, iterations |
| 59 | Wind | Erosion | mod | approximate | angle, strength |
| 60 | Glacial | Erosion | mod | approximate | width, depth, threshold |
| 61 | Coastal | Erosion | mod | approximate | seaLevel, band, strength |
| 62 | Cascade | Erosion | mod | approximate | threshold, steps, amount |
| 63 | Sediment Transport | Erosion | mod | approximate | radius, amount |
| 64 | Debris Flow | Erosion | mod | approximate | threshold, rate, iterations |
| 65 | Snowmelt | Erosion | mod | approximate | snowline, rate |
| 66 | FastErosion | Erosion | mod | approximate | K |
| 67 | FlowErosion | Erosion | mod | approximate | strength, steps |
| 68 | RainErosion | Erosion | mod | approximate | strength |
| 69 | StreamErosion | Erosion | mod | approximate | K, threshold, iterations |
| 70 | Strata | Geology | mod | approximate | layers, tilt, amount, seed |
| 71 | Sediment | Geology | mod | approximate | radius, amount |
| 72 | Outcrop | Geology | mod | approximate | threshold, amount, seed |
| 73 | Fault | Geology | mod | approximate | angle, offset, throw, softness |
| 74 | Fold | Geology | mod | approximate | amplitude, frequency, angle |
| 75 | Tectonic | Geology | mod | approximate | scale, width, amount, seed |
| 76 | Uplift | Geology | mod | approximate | centerX, centerY, radius, amount |
| 77 | Subsidence | Geology | mod | approximate | centerX, centerY, radius, amount |
| 78 | Graben | Geology | mod | approximate | angle, width, amount |
| 79 | Horst | Geology | mod | approximate | angle, width, amount |
| 80 | Volcanic | Geology | mod | approximate | centerX, centerY, radius, height, seed |
| 81 | Lava Flow | Geology | mod | approximate | thickness, length |
| 82 | Impact | Geology | mod | approximate | centerX, centerY, radius, depth |
| 83 | Meteor | Geology | mod | approximate | count, radius, depth, seed |
| 84 | Mineral | Geology | mod | approximate | scale, amount, seed |
| 85 | Water Fill | Water | mod | implemented | level |
| 86 | Lake | Water | mod | implemented | minDepth, selectivity, deepen |
| 87 | River | Water | mod | implemented | threshold, depth, width, waterLift |
| 88 | Stream | Water | mod | implemented | threshold, depth |
| 89 | Ocean | Water | mod | implemented | level, shelf, carve |
| 90 | Flood | Water | mod | approximate | stage, reach, threshold |
| 91 | Pond | Water | mod | approximate | minDepth, maxDepth |
| 92 | Waterfall | Water | mod | approximate | threshold, steep, drop |
| 93 | Delta | Water | mod | approximate | sea, radius, amount, threshold |
| 94 | Meander | Water | mod | approximate | amplitude, frequency, depth, threshold |
| 95 | Blur Gaussian | Filters | mod | implemented | radius |
| 96 | Blur Box | Filters | mod | implemented | radius |
| 97 | Blur Radial | Filters | mod | implemented | centerX, centerY, strength |
| 98 | Sharpen | Filters | mod | implemented | amount |
| 99 | Unsharp Mask | Filters | mod | implemented | radius, threshold, amount |
| 100 | Median | Filters | mod | implemented | radius |
| 101 | Dilate | Filters | mod | implemented | radius |
| 102 | Erode Morphological | Filters | mod | implemented | radius |
| 103 | Smooth | Filters | mod | implemented | amount |
| 104 | Detail Enhance | Filters | mod | implemented | radius, amount |
| 105 | Contrast | Filters | mod | implemented | amount |
| 106 | Brightness | Filters | mod | implemented | amount |
| 107 | Gamma | Filters | mod | implemented | gamma |
| 108 | Levels | Filters | mod | implemented | inLow, inHigh, gamma, outLow, outHigh |
| 109 | Curves | Filters | mod | implemented | curve |
| 110 | Histogram | Filters | mod | implemented | — |
| 111 | Equalize | Filters | mod | implemented | — |
| 112 | Normalize | Filters | mod | implemented | — |
| 113 | Invert | Filters | mod | implemented | — |
| 114 | Abs | Filters | mod | implemented | — |
| 115 | Clamp | Filters | mod | implemented | min, max |
| 116 | Remap | Filters | mod | implemented | inMin, inMax, outMin, outMax |
| 117 | Terrace | Filters | mod | implemented | steps, smooth |
| 118 | Quantize | Filters | mod | implemented | levels |
| 119 | Posterize | Filters | mod | implemented | levels |
| 120 | Steepen | Filters | mod | implemented | radius, amount |
| 121 | Flatten | Filters | mod | implemented | value, amount |
| 122 | Planar | Filters | mod | implemented | amount |
| 123 | Slope | Filters | gen | implemented | heightScale |
| 124 | Direction | Filters | gen | implemented | — |
| 125 | Convexity | Filters | gen | implemented | radius |
| 126 | Concavity | Filters | gen | implemented | radius |
| 127 | Roughness | Filters | gen | approximate | radius |
| 128 | Smoothness | Filters | gen | approximate | radius |
| 129 | Add | Combiners | combine | implemented | source, value, radius |
| 130 | Subtract | Combiners | combine | implemented | source, value, radius |
| 131 | Multiply | Combiners | combine | implemented | source, value, radius |
| 132 | Divide | Combiners | combine | implemented | source, value, radius |
| 133 | Max | Combiners | combine | implemented | source, value, radius |
| 134 | Min | Combiners | combine | implemented | source, value, radius |
| 135 | Average | Combiners | combine | implemented | source, value, radius |
| 136 | Blend | Combiners | combine | implemented | source, value, radius |
| 137 | Overlay | Combiners | combine | implemented | source, value, radius |
| 138 | Screen | Combiners | combine | implemented | source, value, radius |
| 139 | Darken | Combiners | combine | implemented | source, value, radius |
| 140 | Lighten | Combiners | combine | implemented | source, value, radius |
| 141 | Difference | Combiners | combine | implemented | source, value, radius |
| 142 | Exclusion | Combiners | combine | implemented | source, value, radius |
| 143 | Soft Light | Combiners | combine | implemented | source, value, radius |
| 144 | Hard Light | Combiners | combine | implemented | source, value, radius |
| 145 | Color Dodge | Combiners | combine | implemented | source, value, radius |
| 146 | Color Burn | Combiners | combine | implemented | source, value, radius |
| 147 | Linear Dodge | Combiners | combine | implemented | source, value, radius |
| 148 | Linear Burn | Combiners | combine | implemented | source, value, radius |
| 149 | Vivid Light | Combiners | combine | implemented | source, value, radius |
| 150 | Linear Light | Combiners | combine | implemented | source, value, radius |
| 151 | Pin Light | Combiners | combine | implemented | source, value, radius |
| 152 | Hard Mix | Combiners | combine | implemented | source, value, radius |
| 153 | Slope Mask | Masks | mask | implemented | min, max |
| 154 | Height Mask | Masks | mask | implemented | min, max, feather |
| 155 | Curvature Mask | Masks | mask | implemented | — |
| 156 | Cavity Mask | Masks | mask | implemented | — |
| 157 | Convexity Mask | Masks | mask | implemented | — |
| 158 | Flow Mask | Masks | mask | implemented | min, max |
| 159 | Water Mask | Masks | mask | implemented | — |
| 160 | Snow Mask | Masks | mask | implemented | line, slopeCut |
| 161 | Shadow Mask | Masks | mask | implemented | azimuth, altitude |
| 162 | Ambient Occlusion Mask | Masks | mask | implemented | radius, strength |
| 163 | Direction Mask | Masks | mask | implemented | angle, width |
| 164 | Roughness Mask | Masks | mask | approximate | radius |
| 165 | Terrace Mask | Masks | mask | implemented | steps, width |
| 166 | Cliff Mask | Masks | mask | implemented | min, max |
| 167 | Ridge Mask | Masks | mask | implemented | — |
| 168 | Valley Mask | Masks | mask | implemented | — |
| 169 | Edge Mask | Masks | mask | implemented | width |
| 170 | Distance Mask | Masks | mask | implemented | centerX, centerY, radius |
| 171 | Position Mask | Masks | mask | implemented | axis, min, max, feather |
| 172 | Angle Mask | Masks | mask | implemented | angle, width |
| 173 | Range Mask | Masks | mask | implemented | source, min, max, feather |
| 174 | Gradient Mask | Masks | mask | implemented | angle, extent |
| 175 | Radial Mask | Masks | mask | implemented | centerX, centerY, radius |
| 176 | Angular Mask | Masks | mask | implemented | centerX, centerY, start, span |
| 177 | Select Mask | Masks | mask | implemented | height, slope |
| 178 | Custom Painted Mask | Masks | mask | implemented | — |
| 179 | Colorize | Color | obj | implemented | palette |
| 180 | SatMap | Color | obj | approximate | palette, seed |
| 181 | CLUTer | Color | obj | approximate | palette, steps |
| 182 | Color Slope | Color | obj | approximate | flat, steep |
| 183 | Color Height | Color | obj | approximate | low, high |
| 184 | Color Curvature | Color | obj | approximate | concave, convex |
| 185 | Color Flow | Color | obj | approximate | wet |
| 186 | Color Snow | Color | obj | approximate | color, line |
| 187 | Color Rock | Color | obj | approximate | color |
| 188 | Color Vegetation | Color | obj | approximate | color |
| 189 | Color Desert | Color | obj | approximate | color |
| 190 | Color Ice | Color | obj | approximate | color, line |
| 191 | Color Water | Color | obj | approximate | color |
| 192 | Gradient Map | Color | obj | implemented | palette |
| 193 | Triplanar | Color | obj | approximate | base, alt, scale, seed |
| 194 | Splat | Color | obj | approximate | seed |
| 195 | Material | Color | obj | approximate | material |
| 196 | Albedo | Color | obj | implemented | gain |
| 197 | Normal Map | Maps | obj | implemented | strength |
| 198 | Roughness Map | Maps | obj | implemented | — |
| 199 | AO Map | Maps | obj | approximate | radius, strength |
| 200 | Displacement Map | Maps | obj | approximate | amount, scale, seed |
| 201 | Flow Map | Maps | obj | approximate | — |
| 202 | Moisture Map | Maps | obj | approximate | — |
| 203 | Snow Map | Maps | obj | approximate | line |
| 204 | Translate | Transforms | xform | implemented | dx, dy |
| 205 | Rotate | Transforms | xform | implemented | angle |
| 206 | Scale | Transforms | xform | implemented | factor |
| 207 | Warp | Transforms | xform | implemented | amount, scale, seed |
| 208 | Domain Warp | Transforms | xform | implemented | amount, scale, seed |
| 209 | Tile | Transforms | xform | implemented | count |
| 210 | Mirror | Transforms | xform | implemented | axis |
| 211 | Repeat | Transforms | xform | implemented | count, dx |
| 212 | Flip | Transforms | xform | implemented | axis |
| 213 | Crop | Transforms | xform | implemented | size, x, y |
| 214 | Resize | Transforms | xform | implemented | factor |
| 215 | Resample | Transforms | xform | implemented | factor |
| 216 | Offset | Transforms | xform | implemented | dx, dy |
| 217 | Cache | Utility | obj | implemented | — |
| 218 | Output | Utility | obj | implemented | name |
| 219 | Input | Utility | obj | implemented | — |
| 220 | File Import | Utility | obj | implemented | — |
| 221 | Export | Utility | obj | implemented | — |
| 222 | View | Utility | obj | implemented | mode |
| 223 | Compare | Utility | obj | implemented | — |
| 224 | 3D View | Utility | obj | approximate | exaggeration |
| 225 | Stats | Utility | obj | approximate | — |
| 226 | Switch | Utility | obj | implemented | select |
| 227 | Gate | Utility | obj | implemented | threshold, fill |
| 228 | Merge | Utility | obj | implemented | amount |
| 229 | Split | Utility | obj | approximate | bands |
| 230 | Channel Extract | Utility | obj | approximate | channel |
| 231 | Combine Channels | Utility | obj | approximate | channel |
| 232 | Grayscale | Utility | obj | implemented | — |
| 233 | RGB to HSV | Utility | obj | approximate | — |
| 234 | HSV to RGB | Utility | obj | approximate | — |
| 235 | Luminance | Utility | obj | approximate | — |
| 236 | Scatter | Vegetation | obj | approximate | density, seed |
| 237 | Density | Vegetation | obj | approximate | radius |
| 238 | Biome | Vegetation | obj | approximate | — |
| 239 | Tree Line | Vegetation | obj | approximate | altitude, softness |
| 240 | Grass Line | Vegetation | obj | approximate | altitude, softness |
| 241 | Procedural Fill (SP-style) | Color | obj | implemented | color, color2, pattern, scale, contrast, seed |
