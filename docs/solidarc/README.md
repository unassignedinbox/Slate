# SolidArc HTML prototype

This directory contains the HTML-only SolidArc prototype and its headless verification harness. It is intentionally separate from the C++ kernel work.

## Run

Serve this directory with any static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8080 --bind 0.0.0.0 --directory docs/solidarc
```

The prototype supports sketch primitives, analytic profile conversion, finite extrusion with holes, B-rep inspection, face features, and edge-specific fillet/chamfer edits. A single edge changes only that stable edge key; face-wide or loop-wide behavior is represented explicitly by a wildcard selection. Existing tangent/processed edges are not re-applied accidentally.

## Verification

Run from the repository root:

```sh
node docs/solidarc/Verification/smoke.js
```

The harness covers sketch primitives and constraints, planar-profile extrusion, nested holes, B-rep finiteness/closure/winding/normal checks, stable sub-element selection after topology changes, face features, and mixed per-edge fillet/chamfer operations.
