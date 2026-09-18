# Slate — Professional SDF Terrain Studio & Gaea Erosion Engine

> **Slate** is a high-performance procedural Signed Distance Field (SDF) terrain generator with realistic geomorphological erosion, interactive 3D SDF sculpting, a Photoshop-style layer stack, and an authentic satellite color grading library modeled directly after QuadSpinner Gaea 1.x & 2.x.

---

## 🏔️ Architecture Overview

Slate replaces bulky node editors with a streamlined, responsive **Layer Stack** hierarchy on the right and an interactive **3D WebGL Viewport** on the left.

```
+-----------------------------------------------------------+-----------------------------------+
|  VIEWPORT (LEFT)                                          |  INSPECTOR (RIGHT)                |
|  - Real-time 3D Three.js Terrain & Orbit Controls         |  - Project Preset Selector        |
|  - Shading: SatMap, Height, Wear, Deposit, Flow, Normal  |  - Layer Stack (Add, Reorder)     |
|  - 3D Raycasted Brush Ring Cursor                         |  - Gaea Algorithm Parameters      |
|  - Sun Azimuth/Elevation & Lighting                       |  - SDF Sculpting Brush Suite      |
|  - 2D Orthographic / 3D Perspective Switcher              |  - SatMap CLUT Gradient Browser   |
|  - Resolution Switcher (128, 256, 512, 1024)              |  - Production Exporters           |
+-----------------------------------------------------------+-----------------------------------+
```

---

## 🔬 Gaea Algorithm Research & Implementation

### 1. Hydraulic Erosion (Gaea Fluvial & Downcutting)
- **Stream Power Incision & Downcutting**: Vertical bedrock incision gouges sharp V-shaped gullies and canyon gorges based on unit stream power ($\Omega = \rho g Q S$).
- **Inhibition Factor**: Replicates Gaea's downcutting inhibition — when sediment accumulates in channels, it buffers bedrock from downcutting, transitioning erosive torrents into wide alluvial fans.
- **Base Level Equilibration**: Establishes minimum incision thresholds to form broad valley floors.
- **Fluvial Capacity & SPMD Transport**: Droplets transport sediment downhill according to dynamic carrying capacity ($C = K_c \cdot v \cdot \text{slope} \cdot w$).
- **Data Maps Generated**:
  - `wearMap`: Bedrock carved away by downcutting and abrasion.
  - `depositMap`: Sediment settled in depressions and alluvial fans.
  - `flowMap`: Water flux through river stream channels.

### 2. Orographic Rain & Selective Precipitation (Gaea Rain)
- **Orographic Lift**: Windward slopes facing oncoming wind vectors ($\vec{w}$) force moist air upward, generating dense precipitation ($\max(0, -\nabla h \cdot \vec{w})$).
- **Leeward Rain Shadow**: Descending air on the backside of ridges creates realistic arid rain shadows.
- **Altitude Limits**: Focuses condensation within customizable cloud altitude boundaries.
- **Selective Masking**: Combines painted artist precipitation masks to direct stream networks.

### 3. Alluvium & Deposits (Gaea Alluvium)
- **Crevice Detection**: Uses discrete Laplacian curvature ($\nabla^2 h$) to detect concave hollows and micro-crevices.
- **Settling Viscosity**: Modulates how sediment settles into valleys versus washing away.
- **Chaotic Drift**: Injects low-frequency fractal drift to break artificial planar deposits.
- **Modes**: Crevices, Valley Fans, and Sediment Drift.

### 4. Rocky & Thermal Weathering (Gaea Rocky / Talus)
- **Angle of Repose Failure**: Automatically destabilizes terrain slopes exceeding the critical repose angle ($\theta_c \approx 32^\circ - 38^\circ$), cascading rock down to form scree aprons at cliff feet.
- **Cellular Rock Shatter**: Stamps Voronoi cellular fractures onto bare steep rock faces to simulate freeze-thaw weathering.

### 5. SDF Terrain Primitives & CSG
- **Mountain Cone SDF**: Conical distance falloff with radial ridge modulation and fBm displacement.
- **Voronoi Ridges**: $F_2 - F_1$ cellular distance matching Gaea's classic shattered slope technique.
- **Ridge Noise**: Razor-sharp knife arêtes using $(1 - |\text{noise}|)^2$.
- **Plateau / Mesa**: Bounded box SDF with bevel falloff and terrace steps.
- **Volcanic Caldera**: Ring ridge with crater depression and resurgent central cone.
- **River Canyon**: Sinuous carving SDF with stepped sedimentary canyon walls.
- **Sand Dunes**: Directional asymmetric wind slip-faces.

### 6. Interactive SDF Sculpting for Directed Custom Erosion
Interactive 3D brush that applies SDF operators directly onto the terrain:
- 🌊 **Carve Gully (Downcutting Incision)**: Sweeps a sharp V-notch profile along your stroke, carving custom river ravines.
- 🪵 **Deposit Talus (Scree Mound)**: Piles sediment along your stroke, constrained by natural angle of repose.
- 🌿 **Alluvial Wash (Smoothing)**: Relaxes slopes and fills micro-crevices into alluvial plains.
- ⛏️ **Rock Chisel (Fracture)**: Stamps craggy cellular fractures into cliff faces.
- 🌧️ **Rain Painter**: Paints precipitation probability directly onto the mountain surface.
- ⛰️ **Raise Peak / Lower Valley / Plateau Level**: Standard organic sculpting brushes.

### 7. SatMap Satellite Color Map Library
Authentic multi-stop color lookup tables extracted from real-world satellite imagery across global geological formations:
- **Rocky**: Grand Canyon Redwall, Alpine Granite Horn, Dolomite Limestone, Glencoe Highlands.
- **Desert**: Sahara Golden Erg, Namib Sossusvlei, Atacama Salar Basin.
- **Lush**: Cascades Pine Forest, Swiss Pre-Alps Meadow, Milford Sound Fiord.
- **Arctic**: Patagonian Ice Sheet, Icelandic Black Sand & Blue Ice.
- **Volcanic**: Iceland Eldhraun Moss on Basalt, Mount Fuji Basalt Tephra.
- **Badlands**: Danxia Rainbow Strata, Painted Desert Chinle.

**Shading Driver & Features**:
- **Composite Driver**: Blends elevation, slope gradient, wear exposure, and deposit tinting.
- **Gaea Surfacer Rock Highlight**: Screen-blends highlights onto sharp convex ridges and windward rock spurs.
- **Flow Wetness**: Darkens and saturates active river and stream beds.
- **Deposit Silt Blend**: Overlays warm alluvial sediment in valleys.

---

## 💾 Export Formats

- **16-bit RAW Heightmap**: High precision 65536 elevation steps for Unreal Engine, Unity, and Blender.
- **8-bit PNG Heightmap**: Standard grayscale heightmap.
- **3D Wavefront OBJ**: Triangulated mesh with normalized UVs and vertex normals.
- **SatMap Albedo Texture (PNG)**: Full RGBA satellite color texture.
- **Flow Drainage Map (PNG)**: River channel mask for water shaders.
- **Deposit / Talus Map (PNG)**: Sediment distribution mask for gravel scattering.
- **Normal Map (PNG)**: Tangent-space RGB normal map.

---

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` to access Slate Terrain Studio.
