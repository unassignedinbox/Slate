import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import { preset } from "../src/network.js";
import assert from "node:assert/strict";
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
m.nodes = [
  { id: "a", x: 0, z: -100 },
  { id: "b", x: 0, z: 100 },
];
m.roads = [{ id: "ground", a: "a", b: "b", width: 10 }];
m.connections = [];
m.traffic = 0;
m.layers.landscape = false;
await page.addInitScript((m) => {
  if (!sessionStorage.getItem("elevated-test")) {
    localStorage.setItem("slate-project", JSON.stringify(m));
    sessionStorage.setItem("elevated-test", "1");
  }
}, m);
const range = async (id, value) => {
  await page.locator("#" + id).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
};
try {
  await page.goto(
    process.env.BASE_URL || "http://localhost:5173/?renderer=webgl",
  );
  await page.waitForFunction(() => window.__slate?.roadStructures);
  await page.click("#perspective");
  const box = await page.locator("#viewport canvas").boundingBox();
  const screen = (x, z, y = 0) => {
    const scale = box.height / (2 * (410 - y) * Math.tan((37 * Math.PI) / 360));
    return [
      box.x + box.width / 2 + x * scale,
      box.y + box.height / 2 + z * scale,
    ];
  };
  const click = async (x, z, y = 0) => page.mouse.click(...screen(x, z, y));
  async function draw(points) {
    await page.selectOption("#draw-kind", "roadbridge");
    await page.click("#draw-connection");
    for (const p of points) await click(...p, 6);
    await page.waitForFunction(() => document.querySelector("#road-elevation"));
  }
  await draw([
    [-80, 0],
    [0, 20],
    [80, 0],
  ]);
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 2);
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    0,
  );
  assert.equal(await page.locator("#road-elevation").inputValue(), "6");
  console.log(
    "PASS spline drawing creates a grade-separated graph road, not a park object",
  );
  await range("road-elevation", 2);
  assert.ok(
    await page.evaluate(() =>
      window.__slate.roadChecks.some((c) => c.clearance < 2),
    ),
  );
  assert.ok(
    (await page.locator("#inspector").innerText()).includes(
      "sampled deck clearance",
    ),
  );
  await page.click("#undo-tool");
  assert.equal(await page.locator("#road-elevation").inputValue(), "6");
  await page.click("#redo-tool");
  assert.equal(await page.locator("#road-elevation").inputValue(), "2");
  await page.click("#undo-tool");
  await range("road-start-y", 0);
  assert.ok(
    await page.evaluate(() =>
      window.__slate.model.nodes.some((n) => n.y === 0),
    ),
  );
  assert.ok(
    (await page.locator("#inspector").innerText()).includes(
      "peak centreline grade",
    ),
  );
  await page.click("#undo-tool");
  await page.locator("#spline-z").fill("35");
  await page.locator("#spline-z").press("Tab");
  assert.ok(
    await page.evaluate(() =>
      window.__slate.model.roads.some((r) => r.control?.[1] === 35),
    ),
  );
  await range("road-elevation", 0);
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 4);
  assert.equal(
    await page.evaluate(() => window.__slate.roadStructures.length),
    0,
  );
  await page.click("#undo-tool");
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 2);
  console.log(
    "PASS elevations, clearance feedback, spline control, topology rebuild and undo/redo",
  );
  await page.click('[data-tool="move"]');
  const handle = screen(0, 35, 6.8);
  await page.mouse.move(...handle);
  await page.mouse.down();
  await page.mouse.move(handle[0] + 9, handle[1] + 3);
  await page.mouse.up();
  assert.ok(
    await page.evaluate(() =>
      window.__slate.model.roads.some((r) => r.control?.[0] > 1),
    ),
  );
  await page.click("#undo-tool");
  console.log("PASS viewport spline-control dragging");
  await draw([
    [0, -70],
    [0, 0],
    [0, 70],
  ]);
  assert.equal(await page.evaluate(() => window.__slate.model.roads.length), 5);
  const n = await page.evaluate(() => {
    const m = window.__slate.model;
    return m.nodes.find(
      (n) =>
        n.y === 6 &&
        m.roads.filter((r) => r.a === n.id || r.b === n.id).length === 4,
    );
  });
  assert.ok(n);
  await click(n.x, n.z, 6);
  await page.waitForSelector("#node-y");
  await range("node-y", 7);
  assert.equal(
    await page.evaluate(
      (id) => window.__slate.model.nodes.find((n) => n.id === id).y,
      n.id,
    ),
    7,
  );
  await page.click("#undo-tool");
  await page.click('[data-tool="move"]');
  await page.keyboard.down("Shift");
  const start = screen(n.x, n.z, 6);
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0], start[1] - 5);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  assert.ok(
    await page.evaluate(
      (id) => window.__slate.model.nodes.find((n) => n.id === id).y > 6,
      n.id,
    ),
  );
  await page.click("#undo-tool");
  console.log(
    "PASS elevated four-way surface picking, shared elevation and vertical gizmo drag",
  );
  await page.click("#save");
  const saved = await page.evaluate(() => window.__slate.model);
  await page.reload();
  await page.waitForFunction(() => window.__slate?.roadStructures);
  assert.deepEqual(
    (await page.evaluate(() => window.__slate.model)).nodes,
    saved.nodes,
  );
  assert.deepEqual(
    (await page.evaluate(() => window.__slate.model)).roads,
    saved.roads,
  );
  await page.screenshot({
    path: ".artifacts/elevated-network-editor.png",
    timeout: 90000,
  });
  assert.deepEqual(errors, []);
  console.log("PASS saved project reload and zero browser runtime errors");
} catch (e) {
  console.log("ERRORS", errors);
  console.log(
    await page.evaluate(() => ({
      model: window.__slate?.model,
      inspector: document.querySelector("#inspector")?.textContent,
      toast: document.querySelector("#toast")?.textContent,
    })),
  );
  await page.screenshot({
    path: ".artifacts/elevated-browser-failure.png",
    timeout: 90000,
  });
  throw e;
} finally {
  await browser.close();
}
