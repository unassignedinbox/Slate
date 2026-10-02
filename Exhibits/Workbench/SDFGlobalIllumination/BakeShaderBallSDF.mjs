import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { bakeShaderBallSdf, writeShaderBallSdf } from "./ShaderBallSDFBake.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const meshPath = resolve(directory, "../../Assets/ShaderBall/ShaderBall.mesh");
const outputPath = join(directory, "ShaderBallSDF.bin");
const metadataPath = join(directory, "ShaderBallSDF.meta.json");
const start = performance.now();
const bake = await bakeShaderBallSdf(meshPath);
const result = await writeShaderBallSdf(outputPath, metadataPath, bake);
process.stdout.write(
    `Wrote ${outputPath} (${result.output.byteLength.toLocaleString()} bytes)\n`
    + `SHA-256 ${result.sha256}\n`
    + `Bake time ${((performance.now() - start) / 1000).toFixed(2)} s\n`,
);
