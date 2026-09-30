# Project-Drive telemetry evidence

This directory contains only direct outputs from the real `DriveTelemetry` executable. The former custom CPU car
rasterizer, faux editor sheet, and synthetic motion sheet were removed: they were not captures of `Frontier.exe`.

```bash
cd VehiclePhysics/Overlay/Projects/Project-Drive
make run
```

## Retained artefacts

| Artefact | Origin | Meaning |
|---|---|---|
| `ProjectDrivePhysicsTelemetry_CPU_Reference.csv` | `DriveTelemetry` | Raw 60 Hz samples from a 12-second, 240 Hz fixed-step run of `VehicleSolver`, XPBD soft tyres, Pacejka drivetrain, and aero over `DriveCourse`. It includes throttle, brake, steering, speed, wheel state, and aero drag/downforce channels. |
| `ProjectDrivePhysicsRun_CPU_Reference.txt` | `DriveTelemetry` | The solver's own run summary. |
| `ProjectDrivePhysicsTiming_CPU_Reference.txt` | `DriveTelemetry` | The solver's own fixed-step and timing report. |
| `ProjectDrivePhysicsTelemetryGraphs_CPU_Reference.svg` | Direct CSV visualization | Unsmoothened speed, throttle/brake/steering, and aero drag/downforce versus time. It is explicitly a chart of the direct output, not a Frontier render or editor capture. |
| `Provenance.json` | Gallery metadata | Commands and SHA-256 readings for the retained direct outputs and derived chart. |

## Capture rule

A Drive beauty image, visibility-raster image, Surfel-GI image, ReSTIR image, editor image, or driving GIF may only be
placed here after it is captured from the shared `Frontier.exe` project host running `ProjectDrive.frontier`. A chart may
visualize the retained CSV, but it must be identified as telemetry visualization, not a Frontier renderer or ImGui capture.
