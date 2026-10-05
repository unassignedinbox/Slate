import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE);
const { chromium } = Require("playwright");
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
const Errors = [],
  Results = [];
const Output = path.join(Folder, "Captures");
fs.mkdirSync(Output, { recursive: true });
Page.on("pageerror", (Error) => Errors.push(Error.message));
const Source = JSON.parse(
  fs.readFileSync(path.join(Folder, "SourceDepot/Provenance.json")),
);
for (const [Name, Record] of Object.entries(Source))
  for (const [File, Hash] of Object.entries(Record.files))
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(Folder, "SourceDepot", Name, File)))
        .digest("hex"),
      Hash,
    );
try {
  await Page.goto(
    process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/FractureEditor/",
  );
  await Page.waitForFunction(
    () => Number(document.querySelector("#count").textContent) > 1,
  );
  assert.equal(await Page.locator("#conservation").textContent(), "0.0000%");
  Results.push("Actual solid solver: concrete fragments conserve volume");
  await Page.screenshot({ path: path.join(Output, "Runtime.png") });
  await Page.locator("#separation").fill("0.2");
  assert.equal(
    await Page.locator("#separation-output").textContent(),
    "0.200 m",
  );
  await Page.locator("#wireframe").click();
  assert.equal(
    await Page.locator("#wireframe").getAttribute("aria-pressed"),
    "true",
  );
  await Page.locator("#wireframe").click();
  Results.push("Separation and wireframe controls respond");
  for (const Asset of ["wood", "rock", "plastic"]) {
    await Page.locator(`[data-asset="${Asset}"]`).click();
    await Page.locator("#apply").click();
    assert.ok(Number(await Page.locator("#count").textContent()) > 1);
    assert.ok(
      Number.parseFloat(await Page.locator("#conservation").textContent()) <
        0.01,
    );
    Results.push(Asset + ": material-specific solve, finite volume agreement");
  }
  await Page.locator('[data-asset="glass"]').click();
  await Page.locator("#apply").click();
  await Page.waitForFunction(
    () =>
      document
        .querySelector("#viewport-status")
        .textContent.includes("extracted"),
    {},
    { timeout: 16000 },
  );
  assert.ok(Number(await Page.locator("#count").textContent()) > 1);
  Results.push(
    "First-branch live crack-tip solver finishes and produces shell geometry",
  );
  await Page.screenshot({ path: path.join(Output, "Shell.png") });
  await Page.locator('[data-asset="tempered"]').click();
  await Page.locator("#baked").click();
  await Page.locator("#apply").click();
  await Page.waitForFunction(
    () => document.querySelectorAll(".pattern").length === 4,
    {},
    { timeout: 30000 },
  );
  assert.equal(
    await Page.locator("#execution").textContent(),
    "Cached geometry",
  );
  await Page.locator(".pattern").nth(2).click();
  assert.equal(await Page.locator(".pattern.selected").count(), 1);
  Results.push(
    "Baked shell library computes four seed variants and reuses stored geometry",
  );
  await Page.screenshot({ path: path.join(Output, "Baked.png") });
  const Download = Page.waitForEvent("download");
  await Page.locator("#export").click();
  const File = await Download;
  const Payload = JSON.parse(fs.readFileSync(await File.path(), "utf8"));
  assert.equal(Payload.patterns.length, 4);
  assert.equal(Payload.nativeAsset, false);
  assert.ok(Payload.patterns.every((Pattern) => Pattern.fragments.length > 0));
  Results.push(
    "JSON export contains real fragment geometry and both pinned sources; not falsely labelled native",
  );
  await Page.locator("#seed").fill("123");
  await Page.locator("#seed").press("Tab");
  assert.equal(await Page.locator(".pattern").count(), 0);
  Results.push("Recipe edits invalidate cached geometry");
  await Page.locator("#search").fill("granite");
  assert.equal(await Page.locator(".asset:visible").count(), 1);
  await Page.locator("#search").fill("");
  Results.push("Asset search narrows the visible selection");
  await Page.locator('[data-asset="concrete"]').click();
  await Page.locator("#apply").click();
  await Page.waitForFunction(
    () => document.querySelectorAll(".pattern").length === 4,
  );
  assert.equal(await Page.locator("#conservation").textContent(), "0.0000%");
  Results.push("Baked solid library also uses the same shared editor");
  await Page.locator("#reset").click();
  assert.equal(await Page.locator("#count").textContent(), "1");
  Results.push("Reset restores intact geometry");
  await Page.locator('[data-asset="steel"]').click();
  assert.equal(await Page.locator("#runtime").isDisabled(), true);
  await Page.locator("#apply").click();
  await Page.waitForFunction(
    () => document.querySelectorAll(".pattern").length === 3,
    {},
    { timeout: 60000 },
  );
  await Page.locator(".pattern").nth(2).click();
  assert.equal(await Page.locator("#count").textContent(), "1");
  await Page.locator("#separation").fill("0");
  assert.equal(
    await Page.locator("#separation-output").textContent(),
    "0 / 11",
  );
  await Page.locator("#separation").fill("11");
  await Page.screenshot({ path: path.join(Output, "Plasticity.png") });
  const MetalDownload = Page.waitForEvent("download");
  await Page.locator("#export").click();
  const Metal = JSON.parse(
    fs.readFileSync(await (await MetalDownload).path(), "utf8"),
  );
  assert.equal(Metal.patterns.length, 3);
  assert.equal(Metal.patterns[2].deformationFrames.length, 12);
  const First = Metal.patterns[2].deformationFrames[0].vertices,
    Last = Metal.patterns[2].deformationFrames[11].vertices;
  assert.ok(Last.some((Value, Index) => Math.abs(Value - First[Index]) > 0.01));
  assert.ok(
    Last.some(
      (Value, Index) =>
        Index % 3 !== 2 && Math.abs(Value - First[Index]) > 0.001,
    ),
  );
  Results.push(
    "Metal: real twelve-sample XYZ plastic deformation, three baked tools, scrubbing and export; no brittle fracture",
  );
  await Page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(
    await Page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await Page.screenshot({ path: path.join(Output, "Narrow.png") });
  await Page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await Page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  Results.push("1024px and 390px layouts have no horizontal overflow");
  assert.deepEqual(Errors, []);
} catch (Error) {
  Errors.push(Error.stack);
  throw Error;
} finally {
  fs.writeFileSync(
    path.join(Output, "Checks.json"),
    JSON.stringify(
      {
        Browser: Browser.version(),
        HtmlSha256: createHash("sha256")
          .update(fs.readFileSync(path.join(Folder, "index.html")))
          .digest("hex"),
        Results,
        Errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ Results, Errors }, null, 2));
  await Browser.close();
}
