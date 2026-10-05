import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../FrontierEditor/package.json"),
);
const { chromium } = Require("playwright");
const BuildRequire = createRequire(
  path.resolve(Folder, "../FrontierEditor/package.json"),
);
const Proof =
  process.env.FRONTIER_PROOF_FOLDER ||
  path.resolve(Folder, "Screenshots/Reference");
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
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1100 } });
const Errors = [],
  FontFailures = [],
  Results = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
await Page.addInitScript(() =>
  addEventListener("message", (Event) => {
    if (Event.data?.ReferenceHost) window.LastReferenceHost = Event.data;
  }),
);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/";
const Cases = [
  ["world", "Folder", "folder", ".fd-state"],
  ["wind", "Wind", "wind", ".wf-trace"],
  ["moon", "Moon", "moon", ".mp-atlas"],
  ["clouds", "Clouds", "clouds", ".cl-layer"],
  ["height-fog", "Fog", "fog", ".fg-scatter"],
  ["sun", "Sun", "sun", null],
  ["light", "ExistingArea", "arealight", null],
  ["reference-key-spot", "Spot", "spotlight", null],
  ["reference-rim-point", "RimPoint", "pointlight", null],
  ["reference-fill-point", "FillPoint", "pointlight", null],
  ["reference-ece-low-beam", "IES", "ieslight", null],
  ["reference-softbox", "Softbox", "arealight", null],
  ["reference-studio-tube", "Tube", "tubelight", null],
];
let Reference;
if (process.env.FRONTIER_REFERENCE_SOURCE) {
  const Source = path.resolve(process.env.FRONTIER_REFERENCE_SOURCE, "src");
  const Code = `import {buildSheet} from ${JSON.stringify(Source + "/inspector.js")};
    import {makeNode,flat} from ${JSON.stringify(Source + "/world.js")};
    window.RenderReference = Data => {
      const Presets = new Map(flat.map(n => [n.name,n.props]));
      const Nodes = new Map(Data.Rows.map(r => { const n=makeNode(r.Name,r.Type); n.vis=!Data.Hidden[r.Id]; n.open=!Data.Collapsed[r.Id];
        Object.assign(n.props,Presets.get(r.Preset)||{},Data.Values[r.Id]?.ReferenceInspector?.Properties||{}); return [r.Id,n]; }));
      for(const r of Data.Rows){const n=Nodes.get(r.Id),p=Nodes.get(r.Parent);if(p)p.kids.push(n);let id=r.Parent;n.depth=0;const seen=new Set([r.Id]);while(Nodes.has(id)&&!seen.has(id)){seen.add(id);n.depth++;id=Data.Rows.find(x=>x.Id===id)?.Parent;}}
      document.querySelector('.props').append(buildSheet(Nodes.get(Data.Selected)));
    };`;
  const Bundle = await BuildRequire("esbuild").build({
    stdin: { contents: Code, resolveDir: Source },
    bundle: true,
    write: false,
    format: "iife",
  });
  Reference = await Browser.newPage({ viewport: { width: 340, height: 4000 } });
  Reference.on("pageerror", (Error) => Errors.push(Error.stack));
  Reference.Template = `<!doctype html><html><head><style>${fs.readFileSync(path.join(Folder, "InspectorDepot/Fontshare.css"))}${fs.readFileSync(path.join(Source, "styles.css"))}
    html,body{height:auto;overflow:hidden;background:var(--panel)}.props{display:block;overflow:hidden;flex:none}</style></head>
    <body><div class="props"></div><script>${Bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );
async function Open(Id) {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".reference-inspector-copy iframe").waitFor();
  const Frame = await Page.locator(
    ".reference-inspector-copy iframe",
  ).contentFrame();
  // FrameLocator deliberately keeps all assertions scoped away from the retained cards.
  await Frame.locator(".sheet").waitFor();
  await Page.waitForTimeout(450);
  return Frame;
}
function Metrics() {
  return [...document.querySelectorAll(".sheet > .ident,.mpanel > *")].map(
    (Node) => {
      const Box = Node.getBoundingClientRect(),
        Style = getComputedStyle(Node);
      return {
        Class: Node.className,
        Width: Box.width,
        Height: Box.height,
        Background: Style.backgroundColor,
        Radius: Style.borderRadius,
        Font: Style.fontFamily,
        Weight: Style.fontWeight,
        Size: Style.fontSize,
      };
    },
  );
}
try {
  for (const [Id, Name, Type, Last] of Cases) {
    const Frame = await Open(Id);
    const ActualFrame = Page.frames().find(
      (Value) => Value.url() === "about:srcdoc",
    );
    assert.equal(
      await Page.locator(".reference-inspector-copy").getAttribute(
        "data-reference-kind",
      ),
      Type,
    );
    if (["wind", "clouds", "fog", "moon"].includes(Type)) {
      assert.equal(
        await Frame.locator(".mpanel > :last-child").evaluate(
          (Node, Selector) => Node.matches(Selector),
          Last,
        ),
        true,
      );
      assert.equal(await Frame.locator(".sheet > .pcard").count(), 0);
    }
    if (Type === "moon") {
      assert.equal(await Frame.locator(".sheet > *").count(), 1);
      assert.equal(await Frame.locator(".mpanel > *").count(), 1);
    }
    if (Id.startsWith("reference-"))
      assert.equal(
        await Page.locator(".inspector-scroll > .inspector").count(),
        0,
      );
    else
      assert.ok(
        await Page.locator(".inspector-scroll").evaluate(
          (Node) => Node.children.length > 1,
        ),
        "Existing cards remain: " + Id,
      );
    assert.ok((await Frame.locator("canvas").count()) > 0);
    assert.equal(
      await ActualFrame.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No horizontal overflow: " + Id,
    );
    if (Reference) {
      const Data = await ActualFrame.evaluate(() => window.LastReferenceHost);
      await Reference.setContent(Reference.Template);
      await Reference.evaluate((Data) => window.RenderReference(Data), Data);
      await Reference.evaluate((Type) => {
        const Sheet = document.querySelector(".sheet"),
          Custom = Sheet.querySelector(".mpanel");
        if (Type === "moon") {
          const Atlas = Custom.querySelector(".mp-atlas");
          [...Custom.children].forEach((n) => {
            if (n !== Atlas) n.remove();
          });
          [...Sheet.children].forEach((n) => {
            if (n !== Custom) n.remove();
          });
        }
        if (["wind", "clouds", "fog"].includes(Type)) {
          const End = Custom.querySelector(
            { wind: ".wf-trace", clouds: ".cl-layer", fog: ".fg-scatter" }[
              Type
            ],
          );
          while (End.nextElementSibling) End.nextElementSibling.remove();
          [...Sheet.children].forEach((n) => {
            if (n !== Custom && !n.matches(".ident")) n.remove();
          });
        }
      }, Type);
      await Reference.waitForTimeout(450);
      assert.deepEqual(
        await ActualFrame.evaluate(Metrics),
        await Reference.evaluate(Metrics),
        "Original source layout/styles: " + Id,
      );
    }
    await Page.mouse.move(0, 0);
    await Page.screenshot({ path: path.join(Proof, Name + ".png") });
    Results.push(
      Name +
        ": requested scope, preserved existing cards, canvas, width and original-source card metrics pass",
    );
  }
  let Frame = await Open("clouds");
  const Input = Frame.locator(".cl-layer .step input").first();
  const Before = await Input.inputValue();
  await Input.fill(String(Number(Before) + 7));
  await Input.press("Enter");
  await Page.waitForTimeout(200);
  const Changed = (await Saved()).Values.clouds.ReferenceInspector.Properties;
  Frame = await Open("clouds");
  assert.equal(
    await Frame.locator(".cl-layer .step input").first().inputValue(),
    String(Number(Before) + 7),
  );
  assert.deepEqual(
    (await Saved()).Values.clouds.ReferenceInspector.Properties,
    Changed,
  );
  Results.push("Cloud deck numeric editing persists across reload");
  Frame = await Open("reference-softbox");
  await Frame.locator("textarea").fill("Reference light notes");
  await Frame.locator(".name-edit").dblclick();
  const Literal = 'Softbox & <test> "name"';
  await Frame.locator(".name-edit input").fill(Literal);
  await Frame.locator(".name-edit input").press("Enter");
  await Page.waitForTimeout(200);
  Frame = await Open("reference-softbox");
  assert.equal(await Frame.locator(".name-edit").textContent(), Literal);
  assert.equal(
    await Frame.locator("textarea").inputValue(),
    "Reference light notes",
  );
  assert.equal(
    (await Saved()).Rows.find((Row) => Row.Id === "reference-softbox").Name,
    Literal,
  );
  await Frame.locator('[title="Visibility  (H)"]').click();
  await Page.waitForTimeout(150);
  assert.equal((await Saved()).Hidden["reference-softbox"], true);
  await Frame.locator('[title="Lock  (L)"]').click();
  await Page.waitForTimeout(150);
  assert.equal(
    (await Saved()).Values["reference-softbox"].ReferenceInspector.Locked,
    true,
  );
  Results.push(
    "Light notes, literal rename, visibility and lock survive the host state bridge",
  );
  Frame = await Open("moon");
  const Height = await Page.locator("iframe").evaluate(
    (Node) => Node.clientHeight,
  );
  await Frame.getByTitle("Taller atlas").click();
  await Page.waitForTimeout(200);
  assert.ok(
    (await Page.locator("iframe").evaluate((Node) => Node.clientHeight)) >
      Height,
  );
  await Frame.getByTitle("Taller atlas").click();
  await Page.waitForTimeout(200);
  assert.equal(
    await Page.locator("iframe").evaluate((Node) => Node.clientHeight),
    Height,
  );
  const Grid = Frame.getByRole("button", { name: "GRID", exact: true });
  await Grid.click();
  assert.equal(await Grid.getAttribute("class"), "mp-tag");
  Results.push(
    "Atlas layers work; expanding and shrinking updates the parent height without nested scrolling",
  );
  Frame = await Open("lighting");
  await Frame.locator(".fd-eye").first().click();
  await Page.waitForTimeout(150);
  assert.equal((await Saved()).Hidden.light, true);
  await Frame.getByRole("button", { name: "EXPANDED", exact: true }).click();
  await Page.waitForTimeout(150);
  assert.equal((await Saved()).Collapsed.lighting, true);
  Results.push(
    "Folder manifest visibility and collection expansion update the actual outliner",
  );
  Frame = await Open("reference-ece-low-beam");
  await Frame.getByRole("button", {
    name: "SAE LOW BEAM",
    exact: true,
  }).click();
  await Page.waitForTimeout(150);
  assert.equal(
    (await Saved()).Values["reference-ece-low-beam"].ReferenceInspector
      .Properties.profile,
    "SAE Low Beam",
  );
  const Tape = Frame.locator(".al-output .tape canvas").first();
  await Tape.scrollIntoViewIfNeeded();
  const Bounds = await Tape.boundingBox();
  await Page.mouse.move(Bounds.x + Bounds.width * 0.25, Bounds.y + 8);
  await Page.mouse.down();
  await Page.mouse.move(Bounds.x + Bounds.width * 0.7, Bounds.y + 8, {
    steps: 12,
  });
  await Page.mouse.up();
  await Page.waitForTimeout(150);
  const Flux = (await Saved()).Values["reference-ece-low-beam"]
    .ReferenceInspector.Properties.lumens;
  assert.ok(
    Flux > 5000 && Flux < 6500,
    "Tape drag continues across state synchronization",
  );
  Results.push(
    "IES profile switching and continuous tape dragging persist without remounting the inspector",
  );
  await Page.evaluate(() => {
    const Key = "Frontier.ProjectZeroHtml.v1",
      State = JSON.parse(localStorage.getItem(Key));
    State.Rows = State.Rows.filter((Row) => Row.Id !== "reference-key-spot");
    State.Rows.find((Row) => Row.Id === "world").Parent = "height-fog";
    localStorage.setItem(Key, JSON.stringify(State));
  });
  Frame = await Open("world");
  assert.ok(
    !(await Saved()).Rows.some((Row) => Row.Id === "reference-key-spot"),
  );
  assert.ok((await Frame.locator(".fd-empty").count()) > 0);
  Results.push(
    "Deleted copied lights stay deleted on reload; malformed cyclic hierarchy does not recurse",
  );
  assert.equal(Errors.length, 0, Errors.join("\n"));
} catch (Error) {
  Errors.push(Error.stack);
  throw Error;
} finally {
  const Report = {
    ReferenceCommit: Manifest.deployedCommit,
    Browser: Browser.version(),
    GeneratedHtmlSha256: createHash("sha256")
      .update(fs.readFileSync(path.join(Folder, "index.html")))
      .digest("hex"),
    OriginalSourceCompared: !!Reference,
    UnchangedSourceFiles: Object.keys(Manifest.unchangedFiles).length,
    Results,
    Errors,
    FontFailures: [...new Set(FontFailures)],
    FontCaveat:
      "Fontshare is external, as in the reference. Comparisons use the same available font/fallback in both documents; not a font-available pixel-perfect claim.",
  };
  fs.writeFileSync(
    path.join(Proof, "Checks.json"),
    JSON.stringify(Report, null, 2) + "\n",
  );
  console.log(JSON.stringify(Report, null, 2));
  await Browser.close();
}
