import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import { preset } from "../src/network.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
await inflate("node_modules/@sparticuz/chromium/bin/al2023.tar.br");
const browser = await chromium.launch({
  executablePath: await binary.executablePath(),
  args: binary.args,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: "/tmp/al2023/lib:" + (process.env.LD_LIBRARY_PATH || ""),
  },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const m = preset();
m.traffic = 0;
m.layers.landscape = false;
await page.addInitScript(
  (m) => localStorage.setItem("slate-project", JSON.stringify(m)),
  m,
);
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.navigation, {
    timeout: 60000,
  });
  await mkdir(".artifacts", { recursive: true });
  for (const index of [0, 11]) {
    await page.click("#frame");
    await page.click("#perspective");
    await page.waitForTimeout(700);
    const n = m.nodes[index],
      box = await page.locator("#viewport canvas").boundingBox(),
      scale = box.height / (2 * 410 * Math.tan((37 * Math.PI) / 360));
    await page.mouse.click(
      box.x + box.width / 2 + n.x * scale,
      box.y + box.height / 2 + n.z * scale,
    );
    assert.equal(
      await page.locator("#inspector-context").textContent(),
      "JUNCTION",
    );
    await page.click("#street-view");
    await page.waitForTimeout(700);
    await page.screenshot({
      path: `.artifacts/curved-pavement-${index}.png`,
      timeout: 90000,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: default district curved-corner selection and street-level rendering; screenshots captured for review",
  );
} finally {
  await browser.close();
}
