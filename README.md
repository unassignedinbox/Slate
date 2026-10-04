# Slate — Project-Zero HTML Editor

A self-contained HTML reconstruction of the Project-Zero native editor UI.

The workspace is intentionally based on the **C++ editor surface**, rather than
`Frontier/Experimental/FrontierEditor`: its layout and controls mirror the
native `EditorHost`, `OutlinerPanel`, `ViewportPanel`, `InspectorPanel`, and
`NativeConstructPanel` from the supplied Slate reference branch.

## Run

No install or build step is required:

```sh
python3 -m http.server 8080 --bind 0.0.0.0
```

Open `http://localhost:8080`.

## Included interactions

- C++-style three-pane layout: outliner, viewport, and native-card inspector.
- Searchable/filterable hierarchy, visibility/lock controls, selection, and
  keyboard shortcuts: `Ctrl/Cmd + Shift + F`, `Ctrl/Cmd + K`, `G`, `R`, `S`.
- Colored-box viewport placeholders for scene entries, with native-style
  red/green/blue move, rotate, and scale gizmos.
- A command surface supporting examples such as `find Sun`, `add tyre`, and
  `play`.
- Construct palette with complete visual coverage for geometry, environment,
  lighting, transport (vehicle, tyre, rim), cloth/soft-body simulation, and
  media entities.
- The copied native inspector card language, including the C++ tyre inspector
  and its Tyre Generator editor surface.

All icons are inline SVGs so the editor remains portable and works offline.
