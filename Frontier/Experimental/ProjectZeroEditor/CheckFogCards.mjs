import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/FogCards");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium",
  args: ["--no-sandbox", "--disable-gpu"],
});
const Page = await Browser.newPage({ viewport: { width: 1365, height: 900 } });
Page.setDefaultTimeout(12000);
const Address =
  process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
const Checks = [],
  Errors = [],
  FontFailures = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  await Page.waitForTimeout(250);
};
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );

try {
  await Open("height-fog");
  assert.equal(await Page.locator('[data-reference-slice="summary"]').count(), 1);
  assert.equal(await Page.locator('[data-reference-slice="details"]').count(), 1);
  assert.equal(await Page.locator('[data-reference-slice="beam"]').count(), 1);
  assert.equal(await Page.locator('[data-card="Visibility through fog"]').count(), 0);

  const Visibility = Page.frameLocator('[data-reference-slice="details"] iframe');
  await Visibility.locator(".fg-vis").waitFor();
  assert.equal(await Visibility.locator(".fg-vis").count(), 1);
  assert.equal(await Visibility.locator(".fg-scatter").count(), 0);

  const Medium = Page.locator('[data-card="Medium"]');
  assert.equal(await Medium.locator('[data-reference-slice="beam"]').count(), 1);
  const Beam = Page.frameLocator('[data-reference-slice="beam"] iframe');
  await Beam.locator(".fg-chamber").waitFor();
  assert.equal(await Beam.locator(".fg-chamber").count(), 1);
  assert.equal(await Beam.locator(".fg-vis").count(), 0);
  assert.equal(await Page.getByRole("img", { name: "Height fog density volume" }).count(), 1);
  assert.equal(await Page.getByLabel("Fog probe altitude").count(), 0);
  assert.equal(await Page.getByLabel("Fog probe distance").count(), 0);
  Checks.push(
    "Height Fog uses the retained rich Visibility visual, a non-graph density volume, and Beam Chamber in Medium",
  );

  await Page.getByRole("button", { name: "Enabled", exact: true }).click();
  const BeamCanvas = Beam.locator(".fg-chamber canvas"),
    Snapshot = () => BeamCanvas.evaluate((Canvas) => Canvas.toDataURL());
  await BeamCanvas.waitFor();
  for (const [Label, Value] of [
    ["Density value", "0.08"],
    ["Falloff Height value", "120"],
    ["Sun Scatter value", "1.6"],
    ["Colour value", "#8fa4bb"],
  ]) {
    const Before = await Snapshot();
    await Page.getByLabel(Label, { exact: true }).fill(Value);
    await Page.getByLabel(Label, { exact: true }).press("Tab");
    await Page.waitForTimeout(100);
    assert.notEqual(await Snapshot(), Before, `${Label} must repaint Beam Chamber`);
  }
  Checks.push(
    "Enabled, Density, Falloff Height, Sun Scatter and Colour all repaint the same Beam Chamber model",
  );

  const NativeDensity = Page.getByLabel("Density value", { exact: true }),
    BeforeImportedEdit = await NativeDensity.inputValue();
  await Visibility.locator(".fg-vis canvas").click({ position: { x: 45, y: 40 } });
  await Page.waitForTimeout(150);
  assert.notEqual(await NativeDensity.inputValue(), BeforeImportedEdit);
  const StoredProperties =
    (await Saved()).Values["height-fog"].ReferenceInspector?.Properties || {};
  for (const Key of ["enabled", "density", "height", "sunScatter", "color"])
    assert.equal(Key in StoredProperties, false, `${Key} must not be stored twice`);
  Checks.push(
    "Imported Height visual and native controls are bidirectional; mapped Fog values are stored once",
  );

  for (const Id of ["aerial-fog", "local-fog"]) {
    await Open(Id);
    assert.equal(await Page.locator(".reference-inspector-copy").count(), 0);
    assert.equal(await Page.locator(".fog-sight").count(), 1);
    assert.equal(await Page.locator(".fog-reading").count(), 6);
    assert.equal(await Page.locator('[data-card="Visibility through fog"]').count(), 1);
    assert.equal(await Page.locator(".fog-instruments > .fog-beam").count(), 1);
    assert.equal(
      await Page.locator('[data-card="Medium"] [data-reference-slice="beam"]').count(),
      0,
    );
    Checks.push(`${Id}: restored C054 Fog cards remain unchanged`);
  }
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(
    path.join(Proof, "Checks.json"),
    JSON.stringify({ Checks, Errors, FontFailures }, null, 2),
  );
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Height Fog correction checks passed:", Checks.length);
