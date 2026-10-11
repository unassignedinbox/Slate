import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import assert from "node:assert/strict";
await inflate("node_modules/@sparticuz/chromium/bin/al2023.tar.br");
const browser = await chromium.launch({
  executablePath: await binary.executablePath(),
  args: [...binary.args, "--enable-unsafe-webgpu"],
  env: {
    ...process.env,
    LD_LIBRARY_PATH: "/tmp/al2023/lib:" + (process.env.LD_LIBRARY_PATH || ""),
  },
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForSelector("#recover-renderer", { timeout: 60000 });
  await page.click("#recover-renderer");
  await page.waitForFunction(
    () => window.__slate?.backend === "WebGL2 fallback",
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads.length),
    21,
  );
  console.log(
    "PASS: failed WebGPU swapchain recovers into explicitly labeled WebGL2 with project intact",
  );
} finally {
  await browser.close();
}
