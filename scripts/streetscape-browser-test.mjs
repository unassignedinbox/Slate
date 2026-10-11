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
const model = preset("junction");
model.name = "Pavement & drainage study";
model.sidewalk = 3.2;
model.traffic = 4;
model.layers.landscape = false;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.addInitScript((m) => {
  if (!sessionStorage.getItem("street-test")) {
    localStorage.setItem("slate-project", JSON.stringify(m));
    sessionStorage.setItem("street-test", "1");
  }
}, model);
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.streetscape, {
    timeout: 60000,
  });
  const stats = await page.evaluate(() => window.__slate.streetscape);
  assert.equal(stats.crossings, 4);
  assert.equal(stats.ramps, 8);
  assert.equal(stats.tactiles, 8);
  assert.ok(stats.grates > 0);
  assert.ok(stats.manholes > 0);
  console.log(
    "PASS: integrated ramps, tactile paving, drainage and manholes render",
  );
  await page.click('[data-section="streets"]');
  await page.locator("#street-drain-spacing").fill("45");
  assert.equal(
    await page.evaluate(() => window.__slate.model.streets.drainSpacing),
    45,
  );
  await page.locator("#street-manhole-diameter").fill("800");
  assert.equal(
    await page.evaluate(() => window.__slate.model.streets.manholeDiameter),
    0.8,
  );
  await page.locator("#street-manholes").uncheck();
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.manholes),
    0,
  );
  await page.locator("#street-manholes").check();
  await page.locator("#street-ramps").uncheck();
  assert.equal(await page.evaluate(() => window.__slate.streetscape.ramps), 0);
  await page.locator("#street-ramps").check();
  await page.locator("#street-tactile").uncheck();
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.tactiles),
    0,
  );
  await page.locator("#street-tactile").check();
  await page.locator("#street-crossing-width").fill("3.6");
  assert.equal(
    await page.evaluate(() => window.__slate.model.streets.crossingWidth),
    3.6,
  );
  console.log("PASS: dimensions and topology-restoring feature toggles");
  await page.click("#edit-paving");
  assert.equal(await page.locator("#paving-pattern option").count(), 5);
  await page.selectOption("#paving-pattern", "Basketweave");
  await page.locator("#paving-scale").fill("1.5");
  await page.locator("#paving-rotation").fill("45");
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.paving),
    "Basketweave",
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.pavingScale),
    1.5,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.pavingRotation),
    45,
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.pavingRotation),
    0,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.pavingRotation),
    45,
  );
  await page.click('[data-asset="Surfaces"]');
  assert.equal(await page.locator(".paving-thumbnail").count(), 5);
  await page.click('[data-preset="paving:Herringbone"]');
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.paving),
    "Herringbone",
  );
  console.log(
    "PASS: five paving designs, scale, rotation, asset thumbnails, undo/redo",
  );
  await page.click("#save");
  await page.reload();
  await page.waitForFunction(() => window.__slate?.streetscape, {
    timeout: 60000,
  });
  assert.equal(
    await page.evaluate(() => window.__slate.model.streets.manholeDiameter),
    0.8,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.pavingRotation),
    45,
  );
  console.log(
    "PASS: browser save/reload preserves streetscape and material settings",
  );
  await page.click('[data-section="streets"]');
  await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas");
    for (let i = 0; i < 25; i++)
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await page.waitForTimeout(2500);
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({ path: ".artifacts/streetscape.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: inspected streetscape screenshot and no browser runtime errors",
  );
} finally {
  await browser.close();
}
