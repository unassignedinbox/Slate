# Sources and provenance

Pinned on 2026-10-01.

- [Jure Triglav — Webgiya repository](https://github.com/jure/webgiya), commit [`0cd7f96859adc34e181f34a5d804e53fa94799cb`](https://github.com/jure/webgiya/commit/0cd7f96859adc34e181f34a5d804e53fa94799cb) — complete WebGPU/Three.js surfel GI implementation copied under the MIT license.
- [Webgiya live demonstration](https://jure.github.io/webgiya/) — upstream runtime and inspector reference.
- [Surfel-based global illumination on the web](https://juretriglav.si/surfel-based-global-illumination-on-the-web/) — author's detailed explanation and interactive derivation.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — upstream Webgiya vendors a branch with Firefox/Safari WebGPU fixes; its license and patch notes remain in `src/external/three-mesh-bvh/`.
- [Poly Haven, Pizzo Pernice Pure Sky](https://polyhaven.com/a/pizzo_pernice_puresky) — CC0 HDR environment distributed by upstream Webgiya.
- `Exhibits/Assets/ShaderBall/ShaderBall.mesh` — shared Slate `SBM1` geometry, copied byte-for-byte into the static application's public assets.

## Reproducibility check

With the pinned Webgiya repository checked out at `/tmp/webgiya`, this command identifies all source changes:

```bash
diff -qr /tmp/webgiya/src Exhibits/Workbench/WebgiyaSurfelGI/src
```

Expected result:

```text
Files .../src/content.ts and .../src/content.ts differ
Only in .../src: mainVisibility.ts
Only in .../src: screenProbePass.ts
Only in .../src: shaderBallScene.ts
```

No pinned surfel algorithm source differs. `content.ts` changes the scene-preset list, `shaderBallScene.ts` supplies the ShaderBalls/light lab, `screenProbePass.ts` adds the optional camera-visible probe estimator, and `mainVisibility.ts` is a derived host composing screen probes and GTAO while the original `main.ts` remains unchanged.
