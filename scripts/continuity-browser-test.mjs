import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import { preset, buildNetwork } from "../src/network.js";
import { atStation } from "../src/alignment.js";
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
const model = preset();
model.name = "Corner continuity study";
model.nodes = [
  { id: "a", x: -70, z: 0 },
  { id: "b", x: 0, z: 0 },
  { id: "c", x: 0, z: 70 },
];
model.roads = [
  { id: "ab", a: "a", b: "b", width: 9 },
  { id: "bc", a: "b", b: "c", width: 9 },
];
model.traffic = 2;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.addInitScript(
  (m) => localStorage.setItem("slate-project", JSON.stringify(m)),
  model,
);
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.mesh, { timeout: 60000 });
  await page.click("#perspective");
  await page.waitForTimeout(1500);
  const rect = await page.locator("#viewport canvas").boundingBox(),
    scale = rect.height / (2 * 410 * Math.tan((37 * Math.PI) / 360));
  const road = buildNetwork(model).sampled[0],
    p = atStation(road.samples, road.samples.lengthMeters * 0.5);
  await page.mouse.click(
    rect.x + rect.width / 2 + p.x * scale,
    rect.y + rect.height / 2 + p.z * scale,
  );
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "ROAD SEGMENT",
  );
  await page.click('[data-section="details"]');
  await page.locator("#hump-enabled").check();
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.height),
    0.075,
  );
  await page.locator("#hump-height").fill("90");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.height),
    0.09,
  );
  await page.locator("#hump-length").fill("4.1");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.length),
    4.1,
  );
  await page.locator("#hump-position").fill("40");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.position),
    0.4,
  );
  assert.ok(
    await page
      .locator("#hump-status")
      .textContent()
      .then((t) => t.includes("90 mm")),
  );
  console.log(
    "PASS: selected-road speed hump addition, height, length and station",
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.position),
    0.5,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].speedHump.position),
    0.4,
  );
  await page.click('[data-visibility="calming"]');
  assert.equal(
    await page.evaluate(() => window.__slate.model.layers.calming),
    false,
  );
  await page.click('[data-visibility="calming"]');
  assert.equal(
    await page.evaluate(() => window.__slate.model.layers.calming),
    true,
  );
  console.log("PASS: hump undo/redo and traffic-calming layer visibility");
  await page.click("#save");
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("slate-project")).roads[0].speedHump
          .height,
    ),
    0.09,
  );
  await page.click('[data-asset="Details"]');
  assert.equal(await page.locator('[data-preset="speed-hump"]').count(), 1);
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
    ),
    "rgb(22, 22, 22)",
  );
  assert.ok(
    (
      await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    ).includes("DM Sans"),
  );
  assert.ok((await page.locator(".property-card").count()) > 0);
  console.log(
    "PASS: neutral reference palette, local typeface and inspector cards",
  );
  await page.locator("#hump-height").scrollIntoViewIfNeeded();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(2500);
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({ path: ".artifacts/continuous-corner-hump.png" });
  const traffic = await page.evaluate(() => window.__slate.traffic);
  assert.equal(traffic.length, 2);
  assert.ok(
    traffic.every((p) =>
      [p.x, p.z, p.dx, p.dz, p.height, p.pitch].every(Number.isFinite),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: finite traffic poses, rendered corner/hump screenshot, no runtime errors",
  );
} finally {
  await browser.close();
}
