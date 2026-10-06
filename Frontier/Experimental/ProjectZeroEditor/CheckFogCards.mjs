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
  process.env.FRONTIER_PROOF_FOLDER ||
  path.join(Folder, "Screenshots/FogCards");
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

try {
  const ExpectedMediumFields = {
    "height-fog": ["Density", "Falloff Height", "Sun Scatter"],
    "aerial-fog": ["Density", "Start", "Mie Blend"],
    "local-fog": ["Density", "Coverage", "Feature Scale", "Anisotropy"],
  };

  for (const Id of Object.keys(ExpectedMediumFields)) {
    await Open(Id);
    const Visibility = Page.locator('[data-card="Visibility through fog"]');
    assert.equal(await Visibility.count(), 1);
    assert.equal(
      await Visibility.locator(".fog-visibility-heading").count(),
      1,
    );
    assert.equal(
      await Visibility.locator('[data-live-plot="Fog distance probe"]').count(),
      1,
    );
    assert.equal(await Visibility.locator(":scope > .fog-beam").count(), 1);
    assert.equal(await Page.locator(".fog-instruments > .fog-beam").count(), 0);
    assert.equal(
      await Page.locator(".fog-sight svg").getAttribute("data-fog-visual"),
      "shared-abstract-fog-field",
    );
    assert.equal(
      await Page.locator('[data-reference-slice="details"]').count(),
      0,
    );

    const Medium = Page.locator('[data-card="Medium"]');
    assert.equal(await Medium.count(), 1);
    assert.equal(await Medium.locator(".property-graph").count(), 1);
    for (const Label of ExpectedMediumFields[Id]) {
      assert.equal(await Medium.getByText(Label, { exact: true }).count(), 1);
    }
    Checks.push(
      `${Id}: one shared abstract visual, Visibility/Light transport card, embedded Beam chamber, and live Medium map`,
    );
  }

  await Open("aerial-fog");
  const Metric = Page.locator(
    '[data-card="Visibility through fog"] .graph-metric',
  );
  assert.match(await Metric.innerText(), /∞/);
  await Page.getByRole("button", { name: "Enabled", exact: true }).click();
  assert.match(await Metric.innerText(), /3,962/);
  Checks.push(
    "Atmospheric Fog sight range responds to its start-distance extinction model",
  );

  await Open("local-fog");
  assert.match(
    await Page.locator(
      '[data-card="Visibility through fog"] .graph-metric',
    ).innerText(),
    /711/,
  );
  Checks.push(
    "Local Fog sight range responds to density multiplied by coverage",
  );
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
console.log("Shared fog-card checks passed:", Checks.length);
