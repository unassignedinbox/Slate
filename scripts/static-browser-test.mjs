import { PerspectiveCamera, Vector3 } from "three";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import { inflate } from "../node_modules/@sparticuz/chromium/build/lambdafs.js";
import assert from "node:assert/strict";
const root = resolve("published"),
  prefix = "/nested/app/",
  types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
    ".md": "text/plain",
  };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://test"),
      path = decodeURIComponent(url.pathname);
    if (!path.startsWith(prefix)) throw Error("Wrong base");
    const file = resolve(root, path.slice(prefix.length) || "index.html");
    if (!file.startsWith(root + "/")) throw Error("Bad path");
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
    });
    res.end(await readFile(file));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
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
  errors = [],
  bad = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().endsWith("favicon.ico")) bad.push(r.url());
});
try {
  await page.goto(
    `http://127.0.0.1:${server.address().port}${prefix}index.html?demo=parks`,
  );
  await page.waitForFunction(() => window.__slate?.connections, {
    timeout: 60000,
  });
  assert.equal(
    await page.evaluate(() => window.__slate.model.name),
    "Park connections",
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    3,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.connections.bridges[0].valid),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.connections.warnings.length),
    0,
  );
  await page.locator("[data-connection]").first().click();
  await page.click("#focus-link");
  await page.waitForTimeout(700);
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({
    path: ".artifacts/published-park-demo.png",
    timeout: 90000,
  });
  await page.goto(
    `http://127.0.0.1:${server.address().port}${prefix}index.html?demo=bridges&renderer=webgl`,
  );
  await page.waitForFunction(
    () => window.__slate?.model.name === "One network · bridge district",
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.roads.length),
    36,
  );
  assert.equal(
    await page.evaluate(() => window.__slate.model.connections.length),
    0,
  );
  assert.equal(await page.evaluate(() => window.__slate.traffic.length), 18);
  assert.ok(
    await page.evaluate(() =>
      window.__slate.traffic.some((c) => c.height > 5.9),
    ),
  );
  assert.ok(
    await page.evaluate(() =>
      window.__slate.roadChecks.every((c) => c.clearance >= 5),
    ),
  );
  await page.screenshot({
    path: ".artifacts/published-unified-network.png",
    timeout: 90000,
  });
  const nav = await page.evaluate(() => window.__slate.navigation),
    box = await page.locator("#viewport canvas").boundingBox(),
    camera = new PerspectiveCamera(37, box.width / box.height, 0.1, 4000);
  camera.position.fromArray(nav.position);
  camera.quaternion.fromArray(nav.quaternion);
  camera.updateMatrixWorld(true);
  const point = new Vector3(50, 6.12, 45).project(camera);
  await page.mouse.click(
    box.x + ((point.x + 1) * box.width) / 2,
    box.y + ((1 - point.y) * box.height) / 2,
  );
  await page.waitForSelector("#road-elevation");
  assert.equal(await page.locator("#road-elevation").inputValue(), "6");
  await page.click("#focus-road");
  await page.locator("#road-elevation").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".artifacts/published-network-bridge-detail.png",
    timeout: 90000,
  });
  console.log(
    "PASS: compiled unified bridge demo, 36 connected roads, elevated traffic, deck picking and focused 3D inspector",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(bad, []);
  console.log(
    "PASS: compiled app runs from a nested static path; relative JS/CSS/fonts load, park demo renders, and no runtime/asset errors",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
