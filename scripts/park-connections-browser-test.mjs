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
page.on("dialog", (d) => d.accept());
const m = preset();
m.name = "Park connections study";
m.nodes = [
  { id: "a", x: 0, z: -100 },
  { id: "b", x: 0, z: 100 },
];
m.roads = [{ id: "main", a: "a", b: "b", width: 12 }];
m.connections = [];
m.traffic = 0;
m.layers.landscape = false;
await page.addInitScript((m) => {
  if (!sessionStorage.getItem("park-test")) {
    localStorage.setItem("slate-project", JSON.stringify(m));
    sessionStorage.setItem("park-test", "1");
  }
}, m);
try {
  await page.goto(process.env.BASE_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__slate?.connections, {
    timeout: 60000,
  });
  await page.click("#perspective");
  await page.waitForTimeout(700);
  const box = await page.locator("#viewport canvas").boundingBox(),
    scale = box.height / (2 * 410 * Math.tan((37 * Math.PI) / 360));
  const click = async (x, z) =>
    page.mouse.click(
      box.x + box.width / 2 + x * scale,
      box.y + box.height / 2 + z * scale,
    );
  async function draw(kind, points) {
    await page.selectOption("#draw-kind", kind);
    await page.click("#draw-connection");
    for (const p of points) await click(...p);
    await page.waitForTimeout(700);
  }
  await draw("walkway", [
    [-9, -35],
    [-44, -35],
    [-80, -35],
  ]);
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    1,
  );
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "WALKWAY",
  );
  assert.equal(
    await page.evaluate(() => window.__slate.connections.warnings.length),
    0,
  );
  await page.locator("#link-width").fill("3");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[0].width),
    3,
  );
  console.log("PASS: draw a walkway snapped into the footway; edit its width");
  await draw("concrete", [
    [1, 40],
    [40, 40],
    [80, 40],
  ]);
  assert.equal(
    await page.evaluate(
      () =>
        window.__slate.model.roads.filter((r) => r.surface === "concrete")
          .length,
    ),
    1,
  );
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 3);
  console.log("PASS: concrete access road creates a shared graph junction");
  await draw("bridge", [
    [-85, 0],
    [0, 0],
    [85, 0],
  ]);
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "PARK BRIDGE",
  );
  assert.equal(
    await page.evaluate(() => window.__slate.connections.bridges[0].valid),
    true,
  );
  assert.ok(
    (await page.evaluate(() => window.__slate.connections.bridges[0].grade)) <
      1 / 12,
  );
  await page.locator("#link-width").fill("5");
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].width),
    4.5,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].width),
    5,
  );
  await page.locator("#link-height").fill("6");
  await page.locator("#link-grade-target").fill("6.5");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].gradeTarget),
    0.065,
  );
  assert.ok(
    await page
      .locator("#bridge-profile")
      .textContent()
      .then((t) => t.includes("Needs +")),
  );
  await page.locator("#link-transition").fill("5");
  await page.locator("#link-clearance-target").fill("6.5");
  assert.ok(
    await page.evaluate(() =>
      window.__slate.connections.warnings.some((w) =>
        w.message.includes("Nominal road clearance"),
      ),
    ),
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(
      () => window.__slate.model.connections[1].clearanceTarget,
    ),
    undefined,
  );
  await page.click("#redo-tool");
  assert.equal(
    await page.evaluate(
      () => window.__slate.model.connections[1].clearanceTarget,
    ),
    6.5,
  );
  await page.locator("#bridge-profile").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".artifacts/bridge-profile-inspector.png",
    timeout: 90000,
  });
  console.log(
    "PASS: smooth-approach controls, live profile, length shortfalls, clearance target and undo/redo",
  );
  await page.click("#focus-link");
  await page.waitForTimeout(700);
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({ path: ".artifacts/park-bridge.png", timeout: 90000 });
  console.log(
    "PASS: vehicle-width bridge, grounded ramps, editable profile, undo/redo and framed view",
  );
  await page.click("#save");
  await page.reload();
  await page.waitForFunction(() => window.__slate?.connections, {
    timeout: 60000,
  });
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    2,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].height),
    6,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].gradeTarget),
    0.065,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections[1].transition),
    5,
  );
  assert.equal(
    await page.evaluate(
      () => window.__slate.model.connections[1].clearanceTarget,
    ),
    6.5,
  );
  await page.locator("[data-connection]").last().click();
  assert.equal(
    await page.locator("#inspector-context").textContent(),
    "PARK BRIDGE",
  );
  await page.click("#delete-link");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    1,
  );
  await page.click("#undo-tool");
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    2,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: persistence, outliner selection, deletion and undo; no runtime errors",
  );
} finally {
  await browser.close();
}
