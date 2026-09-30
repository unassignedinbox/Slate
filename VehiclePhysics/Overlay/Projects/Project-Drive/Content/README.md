# Project-Drive Content

Runtime-generated and user-editable content for Project-Drive opened by `Frontier.exe`.

- `Scenes/DriveCourse.gltf` — the drive course plus ControlVehicle, four procedural XPBD tyre wheels, ramp, speed
  bumps, cones, and the 20 x 20 Drive material showcase. Regenerated automatically when `DriveSceneAuthor`'s revision
  counter changes, or delete the file to force a rebuild.
- `Frontier.config.toml` — written by the editor when you change render, appearance, or input settings and press Save.
  Absent by default; the app uses built-in defaults until you save. No engine-tree edit is needed to create it.
