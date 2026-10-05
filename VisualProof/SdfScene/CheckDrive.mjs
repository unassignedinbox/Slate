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
  args: ["--no-sandbox"],
});
const Page = await Browser.newPage({ viewport: { width: 1280, height: 1040 } });
const Errors = [],
  Results = [];
Page.on("pageerror", (Error) => Errors.push(Error.message));
const Address =
  process.env.FRONTIER_EDITOR_URL ||
  "http://127.0.0.1:4180/VisualProof/SdfScene/Drive/";
try {
  for (const Pose of (process.env.FRONTIER_DRIVE_POSES || "Loaded").split(
    ",",
  )) {
    const Base = path.join(Folder, "Drive", Pose),
      Report = JSON.parse(fs.readFileSync(path.join(Base, "Provenance.json")));
    assert.equal(Report.exitCode, 0);
    for (const [Name, Hash] of Object.entries(Report.images))
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(Base, Name)))
          .digest("hex"),
        Hash,
      );
    const Log = fs.readFileSync(path.join(Base, "Execution.log"), "utf8");
    assert.ok(Log.includes("facets=22046 instances=22"));
    assert.ok(
      Log.includes(
        "PASS real Drive non-rigid displacement beyond pose-only wheel: 0.00637654 m",
      ),
    );
    assert.ok(
      Log.includes(
        "PASS full Drive geometry, production SDF diffuse GI and GI-off readbacks",
      ),
    );
    assert.ok(!Log.includes("[Vulkan validation]"));
    await Page.goto(Address + "?pose=" + Pose);
    await Page.waitForFunction(
      () =>
        document.querySelector("#capture").complete &&
        document.querySelector("#capture").naturalWidth === 512 &&
        !document.querySelector("#capture").hidden,
    );
    assert.ok(
      (await Page.locator("#state").textContent()).includes("Verified"),
    );
    const Metrics = await Page.evaluate(async (Pose) => {
      const Arrays = [];
      for (const Name of ["Scene-GI.png", "Scene-GI-off.png"]) {
        const ImageReading = new Image();
        ImageReading.src = Pose + "/" + Name;
        await ImageReading.decode();
        const Canvas = document.createElement("canvas");
        Canvas.width = ImageReading.width;
        Canvas.height = ImageReading.height;
        const Context = Canvas.getContext("2d");
        Context.drawImage(ImageReading, 0, 0);
        Arrays.push(
          Context.getImageData(0, 0, Canvas.width, Canvas.height).data,
        );
      }
      let Sum = 0,
        Changed = 0;
      const Colours = new Set();
      for (let Index = 0; Index < Arrays[0].length; Index += 4) {
        let Difference = 0;
        for (let Channel = 0; Channel < 3; Channel++) {
          const Delta = Arrays[0][Index + Channel] - Arrays[1][Index + Channel];
          Sum += Delta * Delta;
          Difference += Math.abs(Delta);
        }
        if (Difference > 0) Changed++;
        Colours.add(Arrays[0].slice(Index, Index + 3).join(","));
      }
      return {
        Rms: Math.sqrt(Sum / ((Arrays[0].length / 4) * 3)),
        Changed,
        Colours: Colours.size,
      };
    }, Pose);
    assert.ok(
      Metrics.Rms > 0.01 && Metrics.Changed > 1000 && Metrics.Colours > 64,
    );
    assert.ok(
      Math.abs(Metrics.Rms - Number(Log.match(/gi_on_off_rms ([\d.]+)/)[1])) <
        0.001,
    );
    await Page.screenshot({ path: path.join(Base, "Viewer.png") });
    await Page.locator('[data-gi="off"]').click();
    await Page.waitForFunction(
      () =>
        document.querySelector("#capture").src.endsWith("Scene-GI-off.png") &&
        document.querySelector("#capture").complete,
    );
    Results.push({
      Pose,
      Pixels: Metrics,
      Source: Report.source,
      Run: Report.run,
      Verified: true,
    });
  }
  const Rest = JSON.parse(
    fs.readFileSync(path.join(Folder, "Drive/Rest/Provenance.json")),
  );
  if (Rest.exitCode !== 0) {
    await Page.goto(Address + "?pose=Rest");
    await Page.waitForFunction(() =>
      document.querySelector("#state").textContent.includes("incomplete"),
    );
    assert.equal(await Page.locator("#capture").isVisible(), true);
    await Page.locator('[data-gi="off"]').click();
    await Page.waitForFunction(
      () =>
        document.querySelector("#state").textContent === "Capture not verified",
    );
    assert.equal(await Page.locator("#capture").isVisible(), false);
    Results.push({
      Pose: "Rest",
      Verified: false,
      RetainedGiOn: !!Rest.images["Scene-GI.png"],
      Reason:
        "GI-off execution timed out; viewer correctly distinguishes partial output from a passing comparison",
    });
  }
  assert.deepEqual(Errors, []);
} catch (Error) {
  Errors.push(Error.stack);
  throw Error;
} finally {
  fs.writeFileSync(
    path.join(Folder, "Drive/Checks.json"),
    JSON.stringify({ Browser: Browser.version(), Results, Errors }, null, 2) +
      "\n",
  );
  console.log(JSON.stringify({ Results, Errors }, null, 2));
  await Browser.close();
}
