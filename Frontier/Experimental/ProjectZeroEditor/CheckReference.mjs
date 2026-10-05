import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  ResolveWind,
  EvaluateWind,
  ResolveInspectorWind,
} from "./WindSpecification.js";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../FrontierEditor/package.json"),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER ||
  path.join(Folder, "Screenshots/Selected");
fs.mkdirSync(Proof, { recursive: true });
const Results = [],
  Errors = [],
  FontFailures = [];
const Manifest = JSON.parse(
  fs.readFileSync(path.join(Folder, "InspectorDepot/Provenance.json")),
);
for (const [Name, Hash] of Object.entries(Manifest.unchangedFiles))
  assert.equal(
    createHash("sha256")
      .update(fs.readFileSync(path.join(Folder, "InspectorDepot", Name)))
      .digest("hex"),
    Hash,
  );
// Numeric checks cover the same evaluator used by strokes, history and existing cloud consumers.
const Path = [
  [-300, 0],
  [-100, 0],
  [100, 0],
  [300, 0],
];
const Spline = (Follow) =>
  ResolveWind({
    WindField: {
      Components: [
        {
          Type: "Spline",
          Strength: 20,
          Bearing: 180,
          Radius: 260,
          Follow,
          Path,
        },
      ],
    },
  });
assert.deepEqual(EvaluateWind(Spline(1), 0, 0), [20, 0]);
assert.ok(EvaluateWind(Spline(1), 0, 100)[1] < 0);
assert.ok(EvaluateWind(Spline(0), 0, 100)[1] > 0);
assert.deepEqual(EvaluateWind(Spline(1), 0, 1000), [0, 0]);
assert.ok(EvaluateWind(Spline(1), 400, 0)[0] > 0);
const Degenerate = Spline(1);
Degenerate.Components[0].Path = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
assert.deepEqual(EvaluateWind(Degenerate, 0, 0), [0, 0]);
const Tornado = ResolveWind({
  WindField: { Components: [{ Type: "Tornado", Strength: 20 }] },
});
assert.deepEqual(EvaluateWind(Tornado, 0, 0), [0, 0]);
assert.ok(EvaluateWind(Tornado, 100, 0)[1] > 0);
for (const Field of [Spline(0), Spline(0.5), Spline(1), Tornado])
  for (let I = 0; I < 40; I++)
    assert.ok(
      EvaluateWind(Field, I * 13 - 260, I * 7 - 120).every(Number.isFinite),
    );
assert.equal(ResolveInspectorWind().Components.length, 1);
const Authored = ResolveWind({
  WindField: {
    Components: [
      { Type: "Gust", Strength: 12 },
      { Type: "Radial", Strength: 8 },
    ],
  },
});
assert.deepEqual(ResolveInspectorWind({ WindField: Authored }), Authored);
const Single = ResolveWind({
  WindField: {
    Components: [{ Type: "Directional", Strength: 7, Bearing: 90 }],
  },
});
const Combined = {
  ...Single,
  Components: [...Single.Components, ...Authored.Components],
};
const V = EvaluateWind(Combined, 30, 60, 1),
  A = EvaluateWind(Single, 30, 60, 1),
  B = EvaluateWind(Authored, 30, 60, 1);
assert.ok(Math.hypot(V[0] - A[0] - B[0], V[1] - A[1] - B[1]) < 1e-10);
Results.push(
  "Spline tangent, cross-path attraction, following extremes, bounded support, degeneracy, tornado, finite samples, legacy fields and superposition pass",
);
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-gpu"],
  headless: true,
});
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1100 } });
Page.on("pageerror", (E) => Errors.push(E.stack));
Page.on("requestfailed", (R) => {
  if (R.url().includes("fontshare.com")) FontFailures.push(R.url());
});
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/";
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );
async function Open(Id) {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".reference-inspector-copy iframe").waitFor();
  const F = Page.frames().find((F) => F.url() === "about:srcdoc");
  await F.locator(".sheet").waitFor();
  await Page.waitForTimeout(300);
  return F;
}
async function Capture(Name) {
  await Page.waitForTimeout(500);
  await Page.screenshot({ path: path.join(Proof, Name + ".png") });
}
try {
  for (const [Id, Classes] of [
    ["sun", [".mp-hero", ".mp-rail", ".mp-duo"]],
    ["wind", [".wf-hero", ".mp-rail", ".mp-duo", ".wf-trace"]],
    [
      "height-fog",
      [".fg-hero", ".mp-rail", ".mp-duo", ".fg-vis", ".fg-scatter"],
    ],
    ["clouds", [".cl-hero", ".mp-rail", ".mp-duo", ".cl-cover", ".cl-layer"]],
    ["reference-rim-point", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-fill-point", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-key-spot", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-ece-low-beam", [".mp-rail"]],
    ["reference-softbox", [".mp-rail"]],
    ["reference-studio-tube", [".mp-rail"]],
    ["light", [".mp-rail"]],
  ]) {
    const F = await Open(Id);
    assert.deepEqual(
      await F.locator(".mpanel > *").evaluateAll(
        (Nodes, Selectors) =>
          Nodes.map((N, I) => N.matches(Selectors[I] || ".missing")),
        Classes,
      ),
      Classes.map(() => true),
    );
    assert.equal(
      await Page.locator(".inspector-scroll").evaluate(
        (N) => N.children.length,
      ),
      1,
    );
    assert.equal(await F.locator(".sheet > .pcard").count(), 0);
    assert.equal(
      await F.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (
      ["sun", "wind", "height-fog", "clouds", "reference-rim-point"].includes(
        Id,
      )
    )
      await Capture(Id);
    Results.push(
      Id +
        ": exact approved card set; no appended legacy, Object or Notes cards",
    );
  }
  await Page.goto(Address + "?inspect=moon");
  assert.equal(await Page.locator(".reference-inspector-copy").count(), 0);
  assert.equal(await Page.locator('[data-panel="moon"]').count(), 1);
  await Page.goto(Address + "?inspect=camera");
  assert.equal(await Page.locator('[data-panel="camera"]').count(), 1);
  Results.push(
    "Moon Atlas skipped; existing Moon and protected Editor Camera inspectors retained",
  );
  let F = await Open("world");
  assert.equal(await F.locator(".folderpanel").count(), 1);
  assert.equal(await Page.locator(".folder-inspector").count(), 0);
  F = await Open("wind");
  const Canvas = () => F.locator(".wf-hero canvas");
  await Canvas().focus();
  await Canvas().press("ArrowUp");
  await Canvas().press("ArrowRight");
  await Page.waitForTimeout(120);
  assert.equal(
    (await Saved()).Values.wind.WindField.Components[0].Strength,
    5.2,
  );
  let Bounds = await Canvas().boundingBox();
  await Page.mouse.move(
    Bounds.x + Bounds.width / 2 + 20,
    Bounds.y + Bounds.height / 2,
  );
  await Page.mouse.down();
  await Page.mouse.move(
    Bounds.x + Bounds.width / 2 + 48,
    Bounds.y + Bounds.height / 2,
    { steps: 10 },
  );
  await Page.mouse.up();
  await Page.waitForTimeout(150);
  let Part = (await Saved()).Values.wind.WindField.Components[0];
  assert.equal(Part.Bearing, 90);
  assert.ok(Part.Strength > 24 && Part.Strength < 27);
  await F.getByRole("button", { name: "Tornado", exact: true }).click();
  Bounds = await Canvas().boundingBox();
  await Page.mouse.move(
    Bounds.x + Bounds.width / 2,
    Bounds.y + Bounds.height / 2,
  );
  await Page.mouse.down();
  await Page.mouse.move(
    Bounds.x + Bounds.width * 0.6,
    Bounds.y + Bounds.height * 0.6,
    { steps: 8 },
  );
  await Page.mouse.up();
  await Page.waitForTimeout(150);
  Part = (await Saved()).Values.wind.WindField.Components[0];
  assert.ok(Part.X > 95 && Part.Z > 95);
  await F.getByLabel("Tornado rotation").selectOption("-1");
  await Page.waitForTimeout(100);
  assert.equal((await Saved()).Values.wind.WindField.Components[0].Spin, -1);
  await Capture("Tornado");
  await F.getByRole("button", { name: "Spline", exact: true }).click();
  await F.getByLabel("Spline following").fill("0.95");
  await Page.waitForTimeout(120);
  Part = (await Saved()).Values.wind.WindField.Components[0];
  assert.equal(Part.Follow, 0.95);
  Bounds = await Canvas().boundingBox();
  const Start = Part.Path[1];
  await Page.mouse.move(
    Bounds.x + (Start[0] / 1000 + 0.5) * Bounds.width,
    Bounds.y + (Start[1] / 1000 + 0.5) * Bounds.height,
  );
  await Page.mouse.down();
  await Page.mouse.move(
    Bounds.x + Bounds.width * 0.4,
    Bounds.y + Bounds.height * 0.2,
    { steps: 10 },
  );
  await Page.mouse.up();
  await Page.waitForTimeout(150);
  const Edited = (await Saved()).Values.wind.WindField;
  assert.ok(Math.abs(Edited.Components[0].Path[1][0] + 100) < 5);
  await Capture("Spline");
  F = await Open("wind");
  assert.deepEqual((await Saved()).Values.wind.WindField, Edited);
  assert.equal(await F.getByLabel("Spline following").inputValue(), "0.95");
  await F.getByRole("button", {
    name: "Pause flow preview",
    exact: true,
  }).click();
  await Page.waitForTimeout(100);
  const T = await Canvas().getAttribute("data-time");
  await Page.waitForTimeout(300);
  assert.equal(await Canvas().getAttribute("data-time"), T);
  await F.getByRole("button", {
    name: "Resume flow preview",
    exact: true,
  }).click();
  await Page.waitForTimeout(200);
  assert.notEqual(await Canvas().getAttribute("data-time"), T);
  Results.push(
    "Arrow pointer/keyboard control, tornado centre drag, spline handles/following, field persistence and pause/resume pass",
  );
  // Verify the readout is from the shared velocity query rather than the retired synthetic waveform.
  await F.getByRole("button", { name: "Arrow", exact: true }).click();
  await F.getByLabel("Wind strength").fill("12");
  await F.getByLabel("Wind strength").press("Tab");
  await Page.waitForTimeout(400);
  assert.equal(await F.locator(".wf-trace .mp-num .i").textContent(), "12");
  assert.equal(await F.locator(".wf-trace .mp-num .d").textContent(), ".0");
  F = await Open("wind"); // fresh stationary sample window, not the preceding edited history
  assert.match(await F.locator(".wf-specs").innerText(), /1.00×/);
  await F.getByLabel("Wind strength").fill("0");
  await F.getByLabel("Wind strength").press("Tab");
  await Page.waitForTimeout(300);
  assert.equal(await F.locator(".wf-trace .mp-num .i").textContent(), "0");
  const Height = await Page.locator("iframe").evaluate((N) => N.clientHeight);
  await F.getByTitle("Taller trace").click();
  await Page.waitForTimeout(150);
  assert.ok(
    (await Page.locator("iframe").evaluate((N) => N.clientHeight)) > Height,
  );
  await F.getByTitle("Taller trace").click();
  await Page.waitForTimeout(150);
  assert.equal(
    await Page.locator("iframe").evaluate((N) => N.clientHeight),
    Height,
  );
  for (const Width of [1024, 1280, 1440, 1920]) {
    await Page.setViewportSize({ width: Width, height: 900 });
    await Page.waitForTimeout(100);
    assert.equal(
      await F.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  Results.push(
    "Anemometer agrees with constant/zero field; trace growth/shrinkage and 1024–1920 layouts pass",
  );
  assert.deepEqual(Errors, []);
} catch (E) {
  Errors.push(E.stack);
  await Page.screenshot({ path: path.join(Proof, "Failure.png") });
  throw E;
} finally {
  const Report = {
    Browser: Browser.version(),
    HtmlSha256: createHash("sha256")
      .update(fs.readFileSync(path.join(Folder, "index.html")))
      .digest("hex"),
    Results,
    Errors,
    FontFailures: [...new Set(FontFailures)],
  };
  fs.writeFileSync(
    path.join(Proof, "Checks.json"),
    JSON.stringify(Report, null, 2) + "\n",
  );
  console.log(JSON.stringify(Report, null, 2));
  await Browser.close();
}
