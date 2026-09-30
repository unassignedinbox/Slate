# Project-Drive CPU-reference evidence

This directory contains direct DriveTelemetry output plus CPU-reference mirrors of the Project-Drive opening scene declared by `ProjectDrive.frontier`: `Content/Scenes/DriveCourse.gltf`. The scene source is `DriveSceneAuthor`, now including the ControlVehicle, XPBD tyres, course props, sun/sky and a 20 x 20 drive material showcase. None of these PNG/GIF files is a native Vulkan, Slang, or ImGui capture.

| Artefact | Meaning |
|---|---|
| `ProjectDriveVisibilityRaster_CPU_Reference.png` | Visibility-raster CPU reference of the actual Drive scene family. |
| `ProjectDriveSurfelGI_CPU_Reference.png` | Same Drive scene through the CPU Surfel-GI mirror. |
| `ProjectDriveReSTIR_CPU_Reference.png` | Same Drive scene through the CPU ReSTIR-DI direct-light mirror. |
| `ProjectDriveAutomotiveMaterialsAngles_CPU_Reference.png` | Vehicle paint/glass/rubber/hub and drive material showcase angles. |
| `ProjectDriveDrivingChase_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, chase framing. |
| `ProjectDriveDrivingTrackside_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, trackside framing. |
| `ProjectDriveDrivingOverhead_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, overhead framing. |
| `ProjectDrivePhysicsTelemetryGraphs_CPU_Reference.svg` | Speed, input and aero graphs charted directly from DriveTelemetry. |
| `ProjectDriveEditorDeclarations_CPU_Reference.txt` | C-ABI editor/outliner declarations; not an ImGui screenshot. |
