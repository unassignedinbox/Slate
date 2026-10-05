import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../FrontierEditor/package.json"),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER ||
  path.join(Folder, "Screenshots/Additive");
fs.mkdirSync(Proof, { recursive: true });
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
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-gpu"],
  headless: true,
});
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
const Results = [],
  Errors = [],
  FontFailures = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/";
let Previous;
if (process.env.FRONTIER_BASELINE_HTML) {
  Previous = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await Previous.route("http://baseline.test/**", (Route) =>
    Route.fulfill({
      contentType: "text/html",
      body: fs.readFileSync(process.env.FRONTIER_BASELINE_HTML, "utf8"),
    }),
  );
}
function Inventory() {
  const Root = document.querySelector(".inspector-scroll > [data-panel]");
  if (!Root) return null;
  return {
    Panel: Root.dataset.panel,
    Cards: [...Root.querySelectorAll("[data-card]")].map(
      (Node) => Node.dataset.card,
    ),
    Headings: [...Root.querySelectorAll("h1,h2,h3")].map(
      (Node) => Node.textContent,
    ),
    Controls: [...Root.querySelectorAll("input,select,textarea")].map(
      (Node) => [Node.tagName, Node.type, Node.getAttribute("aria-label")],
    ),
  };
}
async function Open(Id) {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll").waitFor();
  if (await Page.locator(".reference-inspector-copy").count()) {
    const Frame = Page.frames().find((Value) => Value.url() === "about:srcdoc");
    await Frame.locator(".sheet").waitFor();
    return Frame;
  }
}
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );
try {
  for (const Id of [
    "world",
    "showcase",
    "lighting",
    "camera",
    "moon",
    "sun",
    "wind",
    "clouds",
    "height-fog",
    "light",
  ]) {
    await Open(Id);
    const Actual = await Page.evaluate(Inventory);
    assert.ok(Actual, Id + " original inspector exists");
    if (Previous) {
      await Previous.goto("http://baseline.test/?inspect=" + Id);
      await Previous.locator(".inspector-scroll > [data-panel]").waitFor();
      assert.deepEqual(
        Actual,
        await Previous.evaluate(Inventory),
        Id + " original card order and controls match b424bc3",
      );
    }
    if (["world", "showcase", "lighting", "camera", "moon"].includes(Id)) {
      assert.equal(await Page.locator(".reference-inspector-copy").count(), 0);
      if (["world", "showcase", "lighting"].includes(Id))
        assert.equal(await Page.locator(".folder-inspector").count(), 1);
    } else {
      assert.equal(await Page.locator(".reference-inspector-copy").count(), 1);
      assert.ok(
        await Page.evaluate(
          () =>
            !!(
              document
                .querySelector(".inspector-scroll > [data-panel]")
                .compareDocumentPosition(
                  document.querySelector(".reference-inspector-copy"),
                ) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
      );
    }
    if (["world", "wind", "clouds"].includes(Id))
      await Page.screenshot({ path: path.join(Proof, Id + "-original.png") });
    Results.push(
      Id +
        ": original inspector retained; correct imported-panel presence and append order" +
        (Previous ? "; baseline card/control inventory matches" : ""),
    );
  }
  for (const [Id, Selectors] of [
    ["sun", [".mp-hero", ".mp-rail", ".mp-duo"]],
    ["wind", [".wf-hero", ".mp-rail", ".mp-duo", ".wf-trace"]],
    ["clouds", [".cl-hero", ".mp-rail", ".mp-duo", ".cl-cover", ".cl-layer"]],
    [
      "height-fog",
      [".fg-hero", ".mp-rail", ".mp-duo", ".fg-vis", ".fg-scatter"],
    ],
    ["reference-rim-point", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-fill-point", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-key-spot", [".mp-rail", ".mp-duo", ".li-photo"]],
    ["reference-ece-low-beam", [".mp-rail"]],
    ["reference-softbox", [".mp-rail"]],
    ["reference-studio-tube", [".mp-rail"]],
    ["light", [".mp-rail"]],
  ]) {
    const Frame = await Open(Id);
    assert.deepEqual(
      await Frame.locator(".mpanel > *").evaluateAll(
        (Nodes, Selectors) =>
          Nodes.map((Node, Index) =>
            Node.matches(Selectors[Index] || ".missing"),
          ),
        Selectors,
      ),
      Selectors.map(() => true),
    );
    assert.equal(await Frame.locator(".sheet > .pcard").count(), 0);
    assert.equal(
      await Frame.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await Frame.locator(".flow-controls").count(),
      0,
      "Rejected C041 controls are absent",
    );
    if (["wind", "clouds", "height-fog", "reference-rim-point"].includes(Id)) {
      await Page.locator(".reference-inspector-copy").evaluate((Node) =>
        Node.scrollIntoView({ block: "start" }),
      );
      await Page.waitForTimeout(400);
      await Page.screenshot({ path: path.join(Proof, Id + "-added.png") });
    }
    Results.push(Id + ": only selected imported cards are added");
  }
  let Frame = await Open("clouds");
  const Control = Frame.locator(".cl-layer .step input").first();
  const Before = Number(await Control.inputValue());
  await Control.fill(String(Before + 7));
  await Control.press("Enter");
  await Page.waitForTimeout(150);
  Frame = await Open("clouds");
  assert.equal(
    Number(await Frame.locator(".cl-layer .step input").first().inputValue()),
    Before + 7,
  );
  assert.ok(
    (await Page.locator('[data-panel="clouds"] [data-card]').count()) > 0,
  );
  Results.push(
    "Added Cloud deck edits persist without removing original Cloud controls",
  );
  await Open("world");
  await Page.getByLabel("Collection notes", { exact: true }).fill(
    "Original folder retained",
  );
  await Page.reload();
  assert.equal(
    await Page.getByLabel("Collection notes", { exact: true }).inputValue(),
    "Original folder retained",
  );
  assert.equal(await Page.locator("iframe").count(), 0);
  Results.push(
    "Original Folder notes persist; no imported Folder elements or iframe",
  );
  await Open("wind");
  assert.equal(
    await Page.getByRole("button", {
      name: "Expand WindEditor",
      exact: true,
    }).count(),
    1,
  );
  await Page.getByRole("button", {
    name: "Expand WindEditor",
    exact: true,
  }).click();
  await Page.getByRole("dialog", { name: "WindEditor", exact: true }).waitFor();
  Results.push("Pre-C041 composite WindEditor is restored and opens");
  assert.deepEqual(Errors, []);
} catch (Error) {
  Errors.push(Error.stack);
  throw Error;
} finally {
  const Report = {
    Browser: Browser.version(),
    Baseline: Previous ? "b424bc3" : null,
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
