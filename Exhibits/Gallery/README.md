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
├── Drive/          Project-Drive scene, vehicle-motion and direct telemetry CPU-reference evidence
└── ProjectZero/    Project-Zero default 20 x 20 material-showcase CPU-reference evidence
```

The Project-Zero and Project-Drive CPU-reference images are keyed to the project `.frontier` files and scene-author
sources. They are not native captures; native renderer/editor captures must be added with `*_Native_*` names.
