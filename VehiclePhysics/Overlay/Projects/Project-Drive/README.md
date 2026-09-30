# Project-Drive

Project-Drive is opened by `Frontier.exe`, never by a project-owned windowed executable. Its project specification is
`ProjectDrive.frontier` and its optional code image is `Source/ProjectDriveInterchange.cpp`.

## Ownership

| Capability | Owner |
|---|---|
| Window, Vulkan device, visibility raster, Surfel GI, ReSTIR, editor, global camera, input, sun and sky | `Frontier.exe` |
| Drive course, ControlVehicle, XPBD tyres, driver interpretation, chase-camera requests, vehicle panels | `ProjectDrive.dll` |
| 20 x 20 Drive material showcase in the opening scene | `DriveSceneAuthor` |

The code image reaches host facilities through the versioned `CodeInterchange` C ABI. C++ standard-library records,
exceptions, allocator ownership, Vulkan references, and ImGui records do not cross it.

## Project content

`Source/DriveCourse.h` describes the proving ground shared by the vehicle and its content authoring. `DriveSceneAuthor`
exports `Content/Scenes/DriveCourse.gltf`: ControlVehicle, four XPBD tyre wheels, course props, and a 20 x 20 material
showcase so visibility raster, Surfel GI and ReSTIR all render the same project opening scene family.

## Editor declarations

`ProjectDriveInterchange.cpp` declares host-owned panels for the outliner, ControlVehicle inspector, XPBD tyres, vehicle
dynamics, render modes, Drive material showcase, and telemetry graphs. It also declares outliner subjects for body
paint/glass/trim, four tyres, hubs, brakes, course props, sun/sky, and every 20 x 20 material-showcase cell.

## Build and opening

Use the authoritative host route:

```powershell
powershell -File Tools\Build\ToolchainSequence.ps1
```

This compiles shared source once into `Frontier.exe`, then links `ProjectDrive.dll` independently. Open the project with:

```text
Frontier.exe Projects/Project-Drive/ProjectDrive.frontier
```

Do not add `DriveExecution.cpp`, a second project `main`, a window owner, or an include into Project-Zero source.
