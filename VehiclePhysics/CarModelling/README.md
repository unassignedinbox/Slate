# CarModelling — SolidArc vehicle authoring archive

This folder is retained as the SolidArc authoring archive for vehicle body studies. Project-Drive no longer uses the old
box proxy; the active vehicle is `ControlVehicle.blend`, exported through `ControlVehicleMesh.inl` and authored into the
Drive opening scene by `DriveSceneAuthor`.

## Layout

- `Engine/AuthoringTools/SolidArc/` (repo root) — the shared SolidArc authoring tool source.
- `BuildConsole.sh` — minimal build of the SolidArc console binary.
- `ControlVehicle/` — the active Project-Drive vehicle source, socket extraction scripts, and exported mesh payload.
- `Meshes/` — retained authored exports that are not the old box proxy.

## Active Project-Drive vehicle

Project-Drive uses the real ControlVehicle asset:

- `ControlVehicle/ControlVehicle.blend` is the authored source.
- `ControlVehicle/controlvehicle_mesh.json` and `Projects/Project-Drive/Source/ControlVehicleMesh.inl` carry the
  dependency-free mesh payload.
- `VehicleGeometry.h` reads the authored socket positions for wheel centres, suspension mounts and aero points.
- `DriveSceneAuthor` assigns distinct paint, glass, trim, rubber, hub and brake materials in the exported Drive scene.

The obsolete box proxy script and exported OBJ/MTL/material manifest have been removed so new evidence cannot regress to
that placeholder.
