# Frontier proof gallery

`Exhibits/Gallery/` is the single durable destination for captured images, direct telemetry extracts, proof logs, and their
provenance. Rebuildable proof sources live under `Exhibits/Workbench/`; disposable executables and intermediates belong
in `_AgentScratch/` or feature-local diagnostics and are not authoritative evidence.

## Naming and execution truthfulness

- `*_CPU_Reference.*` is the canonical name for a CPU reference. It is not represented as a native Vulkan, Slang, or
  ImGui capture.
- A native image or GIF must use a clearly separate `*_Native_*` name and identify the Frontier executable, project
  specification, scene, and render mode in sibling provenance.
- A CPU chart may visualize direct telemetry, but it must not be presented as a Frontier renderer/editor capture.
- Every gallery carries `Provenance.json` with the command, source/output SHA-256 readings, and execution boundary.

## Gallery map

```text
Gallery/
├── CodeImages/     Dynamic code-image ABI lifecycle result and provenance
└── Drive/          Direct Project-Drive physics telemetry only; host captures are required for visual evidence
```

No Project-Zero image is retained until it is captured from the shared host's default 20 × 20 material scene.
Retired analytical scenes, custom CPU renderers, synthetic UI sheets, and their derived images are intentionally absent.
