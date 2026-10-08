# Slate

## Road Editor

`road-editor.html` — standalone (zero-dependency) spline road editor for the
Frontier engine, in the Slate editor UI language. Open it directly in a
browser, or serve this folder (`python3 -m http.server`) and open
`road-editor.html`.

- Plan / profile / cross-section / 3D preview + drive-through
- Lanes, median, shoulders, crown, auto superelevation, kerbs, furniture
- Auto junction detection, design checks (radius / grade / runoff)
- Export: engine JSON (`.road.json`), Wavefront OBJ, centerline CSV, PNG
