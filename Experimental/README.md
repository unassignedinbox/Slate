# Experimental browser prototypes

These browser studies are kept separate from the native C++ work. The patch artifact was reconstructed as source files in `IlluminationHost/`; no `.patch` file is kept in this folder.

| Prototype | What it contains | Entry point |
| --- | --- | --- |
| **IlluminationHost** | WebGPU global-illumination vehicle exhibit, editor/HMI, live vehicle materials, ghost and wireframe views | [IlluminationHost/index.html](IlluminationHost/index.html) |
| **Interactive vehicle HMI configurator** | Standalone React/Three.js configurator prototype with material drag-and-drop and scan/ghost effects | [interactive-vehicle-hmi-configurator/index.html](interactive-vehicle-hmi-configurator/index.html) |

## Run IlluminationHost

Serve `Experimental/IlluminationHost/` from a local static server (for example, `python3 -m http.server 8000`) and open `index.html` in a WebGPU-capable browser. The cabin tablet's **Garage** app changes the live vehicle's paint and finish; its view buttons control the main car's solid, translucent ghost, or wireframe presentation.

## Run the standalone configurator

```sh
npm --prefix Experimental/interactive-vehicle-hmi-configurator ci
npm --prefix Experimental/interactive-vehicle-hmi-configurator run dev -- --host 0.0.0.0
npm --prefix Experimental/interactive-vehicle-hmi-configurator run build
```
