import { chromium } from "@playwright/test";
import chromiumBinary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
await inflate("node_modules/@sparticuz/chromium/bin/al2023.tar.br");
const browser = await chromium.launch({
  executablePath: await chromiumBinary.executablePath(),
  args: chromiumBinary.args,
  headless: true,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: "/tmp/al2023/lib:" + (process.env.LD_LIBRARY_PATH || ""),
  },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.mesh, { timeout: 60000 });
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads.length),
    21,
  );
  console.log("PASS: viewport and default network loaded");
  await page.click('[data-visibility="landscape"]');
  assert.equal(
    await page.evaluate(() => window.__slate.model.layers.landscape),
    false,
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.layers.landscape),
    true,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.layers.landscape),
    false,
  );
  console.log("PASS: layer visibility, undo and redo");
  await page.click('[data-tab="materials"]');
  await page.locator("#roughness").fill("0.6");
  await page.locator("#roughness").dispatchEvent("change");
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.roughness),
    0.6,
  );
  await page.selectOption("#paving-pattern", "Large format");
  assert.equal(
    await page.evaluate(() => window.__slate.model.materials.paving),
    "Large format",
  );
  console.log("PASS: materials editing");
  await page.click('[data-workspace="simulate"]');
  await page.locator("#vehicle-count").fill("25");
  await page.locator("#vehicle-count").dispatchEvent("change");
  assert.equal(await page.evaluate(() => window.__slate.model.traffic), 25);
  // Changing a parameter rebuilds the inspector's default view; switch back to traffic.
  await page.click('[data-section="traffic"]');
  await page.click("#pause-traffic");
  assert.match(await page.locator("#pause-traffic").textContent(), /Resume/);
  console.log("PASS: capped traffic and pause");
  await page.click("#save");
  assert.ok(await page.evaluate(() => localStorage.getItem("slate-project")));
  await page.click("#export");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-mesh");
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "road-surface.obj");
  await page.click("#close-dialog");
  console.log("PASS: save and OBJ download");
  await page.click('[data-preset="junction"]');
  await page.click("#confirm-new");
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 4);
  await page.click("#perspective");
  await page.waitForTimeout(1500);
  const rect = await page.locator("#viewport canvas").boundingBox();
  const scale = rect.height / (2 * 410 * Math.tan((37 * Math.PI) / 360));
  const pixel = (x, z) => [
    rect.x + rect.width / 2 + x * scale,
    rect.y + rect.height / 2 + z * scale,
  ];
  await page.mouse.click(...pixel(0, 0));
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "JUNCTION",
  );
  await page.locator("#node-x").fill("8");
  await page.locator("#node-x").dispatchEvent("change");
  assert.equal(await page.evaluate(() => window.__slate.model.nodes[0].x), 8);
  console.log("PASS: junction picking and connected transform");
  await page.click('[data-tool="draw"]');
  for (const p of [
    [-55, -30],
    [0, -30],
    [55, -30],
  ])
    await page.mouse.click(...pixel(...p));
  assert.ok((await page.evaluate(() => window.__slate.model.roads.length)) > 4);
  console.log("PASS: viewport curve drawing and crossing split");
  await page.keyboard.press("Escape");
  await page.click("#undo-tool");
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 4);
  await page.click('[data-preset="district"]');
  await page.click("#confirm-new");
  await page.click("#save");
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({ path: ".artifacts/workspace.png", timeout: 90000 });
  await page.setViewportSize({ width: 900, height: 700 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: ".artifacts/compact.png", timeout: 90000 });
  console.log("PASS: compact editor layout");
  assert.deepEqual(errors, []);
  console.log("PASS: no browser runtime errors");
} finally {
  await browser.close();
}
