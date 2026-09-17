# M9 — denoiser and motion-vector re-enable

M9 restores the two deferred presentation/history features as default-on:

- `ReSTIRIntegratorConfiguration::Denoise = true`
- `ReSTIRIntegratorConfiguration::TemporalReprojection = true`

Project-Zero exposes explicit A/B controls without changing the default:

```text
Project-Zero.exe --scene materialgrid
Project-Zero.exe --scene materialgrid --no-denoise
Project-Zero.exe --scene materialgrid --no-reprojection
Project-Zero.exe --scene materialgrid --no-denoise --no-reprojection
```

`--no-denoise` keeps the running linear accumulation and bypasses the à-trous presentation pass. `--no-reprojection` keeps the same-pixel history path. Both switches are intended for converged-image comparisons; the second also resets the sampling history when changed through the live integrator setter.

## What is validated headlessly

`bash Exhibits/Workbench/Materials/CheckMaterialM9.sh` runs the M9 gate. It verifies the default-on feature bits, CLI wiring, raster motion convention, history normal/depth rejection, off-screen disocclusion, running-mean update, à-trous early-out/final-level writes, kernel-to-filter barriers, and the transmission/subsurface/sky source path. The CPU mirror covers accepted motion, normal rejection, depth rejection, disabled reprojection, and converged-copy behavior.

The sandbox has no Vulkan device or shader compiler, so the final GPU pixel A/B and sky-backed outdoor-glass render remain explicitly marked as device-runner work. No headless source proof is presented as a GPU render result.
