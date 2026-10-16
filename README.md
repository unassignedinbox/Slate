# Slate · vehicle illumination exhibit

Continuation of the linked Frontier IlluminationHost patch, with a vehicle-focused pneumatic tyre model (no XPBD), cockpit/HMI and scrape sparks.

```sh
node Experimental/IlluminationHost/ExhibitExchange.mjs --port 8080 --address 0.0.0.0
```

Open the preview in a WebGPU-capable Chrome/Edge browser. No install step or external runtime assets are needed.

- **ControlVehicle → Pneumatic carcass:** front/rear pressure, per-wheel punctures/blowouts, live pressure/closure/condition, fresh tyres.
- **C:** driver cockpit / chase. The camera selector and vehicle inspector also offer passenger and centre-cabin debug views. **F8:** free camera.
- **W/S, A/D, Space:** drive/brake, steer, handbrake. **B:** line lock. **R:** respawn. **H:** hide/restore the editor and debug overlays.
- In the cockpit, click the centre tablet; its **Tyres** and **Telemetry** pages are live. The steering-wheel cluster shows live speed, gear and rpm.

Useful direct preview: `/?camera=driver&quality=low` (use `balanced` or `high` on a capable GPU).

```sh
npm test --prefix Experimental/IlluminationHost
npm run benchmark --prefix Experimental/IlluminationHost
```

See [the exhibit guide](Experimental/IlluminationHost/README.md) and [the implementation/validation notes](Experimental/IlluminationHost/PneumaticTyres.md).

## Source and branch boundaries

This checkout initially contained only `README.md`; it is **not** a full Frontier checkout. The requested reference branch `SultanAladin/Frontier-:arena/9440f4d0-frontier` (`ebd757e69181199ff34fdef70c88a7ebaf460977`) was inspected: it does not contain `Experimental/IlluminationHost`. The self-contained exhibit was restored from the user's [linked patch](https://github.com/SultanAladin/Frontier-/blob/GI-Updated-Html-Version/01a141bb-e6e8-71cb-8fbf-e7a69a00b7de.patch), then modified here. Unrelated native engine/editor files were not imported.

The three binary mesh archives omitted by that patch were rebuilt from the referenced `arena/4f07c82a-frontier` sources; their Git blob hashes match the patch exactly. The cockpit fixture layout and four small HMI modules come from that branch at `319e5532d2f0f1ca59e6e5fb6997085928aadec2`.

All work remains on this session's fixed branch, `arena/8e836026-slate`. No upstream Frontier branch has been changed or pushed.
