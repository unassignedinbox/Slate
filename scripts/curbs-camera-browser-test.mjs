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
model.name = "Street-level ramp inspection";
model.layers.landscape = false;
model.traffic = 0;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.addInitScript((m) => {
  if (!sessionStorage.getItem("camera-test")) {
    localStorage.setItem("slate-project", JSON.stringify(m));
    sessionStorage.setItem("camera-test", "1");
  }
}, model);
const nav = () => page.evaluate(() => window.__slate.navigation),
  distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.navigation, {
    timeout: 60000,
  });
  let box = await page.locator("#viewport canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  const initial = await nav();
  await page.mouse.down({ button: "right" });
  assert.equal((await nav()).active, true);
  await page.keyboard.down("w");
  await page.waitForTimeout(1300);
  await page.keyboard.up("w");
  assert.ok(distance((await nav()).position, initial.position) > 0.2);
  const oldSpeed = (await nav()).speed;
  await page.mouse.wheel(0, -120);
  assert.ok((await nav()).speed > oldSpeed);
  let prior = await nav();
  await page.keyboard.down("e");
  await page.waitForTimeout(1100);
  await page.keyboard.up("e");
  assert.ok((await nav()).position[1] > prior.position[1] + 0.1);
  await page.mouse.move(
    box.x + box.width * 0.55 + 40,
    box.y + box.height * 0.55 - 20,
  );
  const oriented = await nav();
  assert.ok(distance(oriented.quaternion, initial.quaternion) > 0.01);
  await page.mouse.up({ button: "right" });
  assert.equal((await nav()).active, false);
  await page.waitForTimeout(400);
  assert.ok(distance((await nav()).position, oriented.position) < 0.001);
  console.log(
    "PASS: RMB look, WASD flight, Q/E vertical, wheel speed and stable orbit hand-off",
  );
  prior = await nav();
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  assert.ok(distance((await nav()).position, prior.position) < 0.001);
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.keyboard.press("Escape");
  await page.keyboard.up("w");
  await page.mouse.up({ button: "right" });
  assert.equal((await nav()).active, false);
  console.log(
    "PASS: no movement without RMB; Escape cancels and clears held keys",
  );
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal((await nav()).active, false);
  await page.keyboard.up("w");
  await page.mouse.up({ button: "right" });
  console.log("PASS: window blur clears active flight and held keys");
  await page.click('[data-section="streets"]');
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.parallelRamps),
    8,
  );
  await page.selectOption("#pedestrian-mode", "perpendicular");
  assert.equal(await page.evaluate(() => window.__slate.streetscape.ramps), 0);
  await page.selectOption("#pedestrian-mode", "auto");
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.parallelRamps),
    8,
  );
  await page.click("#street-view");
  await page.waitForTimeout(500);
  assert.ok((await nav()).near < 0.1);
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({
    path: ".artifacts/pedestrian-ramp-street.png",
    timeout: 60000,
  });
  console.log(
    "PASS: auto parallel ramps, insufficient-landing rejection and street-level inspection",
  );
  await page.click("#frame");
  await page.click("#perspective");
  await page.waitForTimeout(800);
  box = await page.locator("#viewport canvas").boundingBox();
  const scale = box.height / (2 * 410 * Math.tan((37 * Math.PI) / 360));
  await page.mouse.click(
    box.x + box.width / 2 - 40 * scale,
    box.y + box.height / 2,
  );
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "ROAD SEGMENT",
  );
  await page.click('[data-section="streets"]');
  await page.locator("#driveway-enabled").check();
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.vehicleCrossovers),
    0,
  );
  await page.click("#driveway-widen");
  assert.equal(await page.evaluate(() => window.__slate.model.sidewalk), 3.2);
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.vehicleCrossovers),
    1,
  );
  await page.locator("#driveway-width").fill("5");
  await page.selectOption("#driveway-side", "-1");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].driveway.width),
    5,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].driveway.side),
    -1,
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].driveway.side),
    1,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].driveway.side),
    -1,
  );
  await page.click('[data-visibility="driveways"]');
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.vehicleCrossovers),
    0,
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.vehicleCrossovers),
    1,
  );
  await page.locator("#driveway-width").focus();
  prior = await nav();
  await page.keyboard.press("w");
  await page.waitForTimeout(200);
  assert.ok(distance((await nav()).position, prior.position) < 0.001);
  console.log(
    "PASS: vehicle undo/redo, topology-restoring layer toggle and input isolation",
  );
  await page.click("#street-view");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: ".artifacts/vehicle-crossover-street.png",
    timeout: 60000,
  });
  await page.click("#save");
  await page.reload();
  await page.waitForFunction(() => window.__slate?.navigation, {
    timeout: 60000,
  });
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads[0].driveway.width),
    5,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.streetscape.vehicleCrossovers),
    1,
  );
  assert.equal((await nav()).active, false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: distinct vehicle entry, widening, settings, persistence and no runtime errors",
  );
} finally {
  await browser.close();
}
