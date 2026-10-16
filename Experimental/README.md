# Experimental browser prototypes

This directory contains browser-first studies that precede native C++ integration. They are kept separate from the engine and do not imply that a feature has been ported to the native runtime.

| Prototype | Entry point | Stack |
| --- | --- | --- |
| IlluminationHost — vehicle, in-car HMI, ReSTIR global illumination and proving grounds | [IlluminationHost/index.html](IlluminationHost/index.html) | JavaScript, WebGPU/WGSL |

Run the prototype from its own directory:

```sh
cd Experimental/IlluminationHost
python3 -m http.server 8080
# Open http://localhost:8080/ in a WebGPU-capable browser.
```

The reconstructed application, setup notes and follow-up roadmap are in [IlluminationHost/README.md](IlluminationHost/README.md) and [IlluminationHost/ROADMAP.md](IlluminationHost/ROADMAP.md). Native C++ sources and Jolt Physics are not part of this prototype.
