import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { unzipSync, strFromU8 } from "fflate";
import { materials } from "../src/materials.js";

const htmlPath = new URL("../site/index.html", import.meta.url);
const publicURL = process.env.ALLOY_PUBLIC_URL;
const localURL = "https://alloy-standalone.invalid/site/index.html";

async function downloadText(page, name) {
  await page.getByRole("button", { name: /Export material/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const stream = await (await downloading).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function frame(page) {
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-material-ready",
    "true",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

// ALLOY_PUBLIC_URL enables a genuine remote check. Connection failures fail the
// test; it never silently substitutes the local build for an unreachable host.
test("standalone page renders, edits and exports without external assets", async ({
  page,
}, testInfo) => {
  const html = await readFile(htmlPath, "utf8");
  const url = publicURL || localURL;
  const errors = [],
    unexpectedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.url() === url && request.isNavigationRequest()) {
      if (publicURL) return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    }
    if (!/^https?:/.test(request.url())) return route.continue();
    unexpectedRequests.push(request.url());
    return route.abort("blockedbyclient");
  });

  const response = await page.goto(url);
  expect(response.status()).toBe(200);
  if (
    publicURL &&
    (await page.getByText("One more step", { exact: true }).isVisible())
  ) {
    // GitHack documents this notice for HTML pages. Confirm it like a visitor;
    // don't change the served content, suppress errors or use a local fallback.
    await page
      .getByRole("button", { name: "Open the page", exact: true })
      .click();
  }
  await expect(page.locator(".material-preview img")).toHaveCount(
    materials.length,
    { timeout: 300000 },
  );
  const thumbnails = await page
    .locator(".material-preview img")
    .evaluateAll((images) => images.map((img) => img.src));
  expect(new Set(thumbnails).size).toBe(materials.length);
  await expect(page.locator("h1")).toHaveText("Racing Green");
  await expect(
    page.locator("script[src], link[rel=stylesheet][href]"),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Apply Natural Cotton", exact: true })
    .click();
  await expect(page.getByLabel("Preview object")).toHaveValue("Draped cloth");
  await page.getByLabel("Thread scale value", { exact: true }).fill("12");
  await page.getByLabel("Weave construction").selectOption("herringbone");
  await page.getByLabel("Warp yarn · lengthwise hex").fill("#344f81");
  await page.getByLabel("Weft yarn · crosswise hex").fill("#dec39b");
  const cloth = JSON.parse(
    await downloadText(page, /Material preset All surface/),
  );
  expect(cloth.schema).toBe("alloy.material.v6");
  expect(cloth.material).toMatchObject({
    weavePattern: "herringbone",
    warpColor: "#344f81",
    weftColor: "#dec39b",
    detailScale: 12,
  });

  await page
    .getByRole("button", { name: "Apply Aurora Flip", exact: true })
    .click();
  await page.getByLabel("Preview object").selectOption("Shader ball");
  await page
    .getByLabel("Color-shift strength value", { exact: true })
    .fill("0");
  await frame(page);
  const before = await page
    .locator("canvas")
    .evaluate((canvas) => canvas.toDataURL());
  await page
    .getByLabel("Color-shift strength value", { exact: true })
    .fill("100");
  await page.getByLabel("Color phase value", { exact: true }).fill("68");
  await frame(page);
  const after = await page
    .locator("canvas")
    .evaluate((canvas) => canvas.toDataURL());
  expect(after).not.toBe(before);

  const exported = await downloadText(page, /Three.js procedural shader/);
  const factory = exported
    .replace(/import \* as THREE from ['"]three['"];?/, "")
    .replace(/export const /g, "const ")
    .replace(/export (async )?function /g, "$1function ")
    .replace(
      /export default createMaterial\(preset\);/,
      "return createMaterial(preset);",
    );
  const material = new Function("THREE", factory)(THREE);
  try {
    expect(material.isMeshPhysicalMaterial).toBe(true);
    expect(material.iridescence).toBe(1);
    expect(material.userData.params.filmThickness).toBeCloseTo(629.2);
    expect(material.userData.params.recipeId).toBe("paint");
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader);
    expect(shader.uniforms.uFilmThickness.value).toBeCloseTo(629.2);
    expect(shader.fragmentShader).toContain(
      "material.iridescenceThickness=uFilmThickness",
    );
  } finally {
    material.dispose();
  }
  await page
    .getByRole("button", { name: "Apply Broadleaf Green", exact: true })
    .click();
  await frame(page);
  const leafSource = await downloadText(page, /Three.js procedural shader/);
  const leafFactory = leafSource
    .replace(/import \* as THREE from ['"]three['"];?/, "")
    .replace(/export const /g, "const ")
    .replace(/export (async )?function /g, "$1function ")
    .replace(
      /export default createMaterial\(preset\);/,
      "return createMaterial(preset);",
    );
  const leafMaterial = new Function("THREE", leafFactory)(THREE);
  try {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    leafMaterial.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain("#define uType 31");
    expect(shader.fragmentShader).toContain("bioCell");
    expect(shader.uniforms.uCellScale.value).toBeGreaterThan(20);
    expect(leafMaterial.alphaMap).toBeNull();
  } finally {
    leafMaterial.dispose();
  }
  await page.getByRole("button", { name: /Export material/ }).click();
  await page.getByRole("button", { name: /Bake procedural maps/ }).click();
  await page.getByLabel("Bake resolution").selectOption("256");
  const baking = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Bake & download ZIP", exact: true })
    .click();
  const stream = await (await baking).createReadStream(),
    parts = [];
  for await (const chunk of stream) parts.push(chunk);
  const maps = unzipSync(Buffer.concat(parts));
  expect(Object.keys(maps)).toHaveLength(8);
  expect(JSON.parse(strFromU8(maps["material.json"])).schema).toBe(
    "alloy.surface-bake.v1",
  );
  expect(
    JSON.parse(strFromU8(maps["material.json"])).domain.projection,
  ).toContain("UV0");
  expect(Buffer.from(maps["normal.png"]).subarray(1, 4).toString()).toBe("PNG");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Apply Pure Aluminium", exact: true })
    .click();
  await page.getByRole("switch", { name: "Enable metal scratches" }).check();
  await page.getByLabel("Scratch density value", { exact: true }).fill("60");
  await frame(page);
  const scratchedSource = await downloadText(
    page,
    /Three.js procedural shader/,
  );
  const scratchedFactory = scratchedSource
    .replace(/import \* as THREE from ['"]three['"];?/, "")
    .replace(/export const /g, "const ")
    .replace(/export (async )?function /g, "$1function ")
    .replace(
      /export default createMaterial\(preset\);/,
      "return createMaterial(preset);",
    );
  const scratchedMaterial = new Function("THREE", scratchedFactory)(THREE);
  try {
    expect(scratchedMaterial.userData.params.metalScratches).toBe(true);
    expect(scratchedMaterial.userData.params.scratchDensity).toBeCloseTo(7.2);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    scratchedMaterial.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain("#define uMetalScratches 1");
    expect(shader.fragmentShader).toContain("surfaceHeight+=metalCuts.y");
  } finally {
    scratchedMaterial.dispose();
  }
  await page
    .getByRole("button", { name: "Apply Crocodile Belly Leather", exact: true })
    .click();
  await expect(page.getByLabel("Preview object")).toHaveValue("Leather swatch");
  await frame(page);
  const leatherSource = await downloadText(page, /Three.js procedural shader/);
  const leatherFactory = leatherSource
    .replace(/import \* as THREE from ['"]three['"];?/, "")
    .replace(/export const /g, "const ")
    .replace(/export (async )?function /g, "$1function ")
    .replace(
      /export default createMaterial\(preset\);/,
      "return createMaterial(preset);",
    );
  const leatherMaterial = new Function("THREE", leatherFactory)(THREE);
  try {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    leatherMaterial.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain("#define uType 30");
    expect(shader.fragmentShader).toContain("vectorHide");
    expect(leatherMaterial.map).toBeNull();
  } finally {
    leatherMaterial.dispose();
  }
  if (process.env.ALLOY_CAPTURE === "leather") {
    for (const name of ["Crocodile Belly Leather", "Cognac Leather"]) {
      await page
        .getByRole("button", { name: "Apply " + name, exact: true })
        .click();
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page.getByLabel("Viewport zoom").fill("2.32");
      await frame(page);
      await page
        .locator(".inspector-scroll")
        .evaluate((e) => (e.scrollTop = 0));
      await page.screenshot({
        path: ".playwright/review/" + name.replaceAll(" ", "-") + ".png",
      });
    }
  }
  if (process.env.ALLOY_CAPTURE === "1") {
    await page
      .getByRole("button", { name: "Apply Raw Selvedge Denim", exact: true })
      .click();
    await frame(page);
    await page.screenshot({ path: testInfo.outputPath("denim-fit.png") });
    await page.getByRole("button", { name: "Macro", exact: true }).click();
    await frame(page);
    await page.screenshot({ path: testInfo.outputPath("denim-macro.png") });
  }
  if (process.env.ALLOY_CAPTURE === "v6") {
    for (const name of ["Scratches", "LED Pixel Matrix"]) {
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page
        .getByRole("button", { name: "Apply " + name, exact: true })
        .click();
      await frame(page);
      await page
        .locator(".inspector-scroll")
        .evaluate((el) => (el.scrollTop = 0));
      await page.screenshot({
        path: testInfo.outputPath(name.replaceAll(" ", "-") + "-fit.png"),
      });
      await page.getByRole("button", { name: "Macro", exact: true }).click();
      await frame(page);
      await page.screenshot({
        path: testInfo.outputPath(name.replaceAll(" ", "-") + "-macro.png"),
      });
    }
  }
  await page
    .getByRole("button", { name: "Pattern studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Painted blossoms", exact: true })
    .click();
  await page.getByLabel("Pattern base material").selectOption("pottery");
  await page
    .getByLabel("Motif material", { exact: true })
    .selectOption("ceramic");
  await page.getByLabel("Relief (mm)", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Assign this finish to all motifs" })
    .click();
  await page
    .getByRole("button", { name: "Apply to material", exact: false })
    .click();
  await expect(page.getByLabel("Preview object")).toHaveValue("Teapot");
  await frame(page);
  const decoratedSource = await downloadText(
    page,
    /Three.js procedural shader/,
  );
  const decoratedFactory = decoratedSource
    .replace(/import \* as THREE from ['"]three['"];?/, "")
    .replace(
      /export default createMaterial\(preset\);/,
      "return createMaterial(preset);",
    )
    .replace(/export /g, "");
  const decorated = new Function("THREE", decoratedFactory)(THREE);
  expect(decorated.userData.params.pattern.layers.length).toBeGreaterThan(10);
  expect(decorated.userData.params.recipeId).toBe("pottery");
  decorated.dispose();
  if (process.env.ALLOY_CAPTURE === "patterns") {
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await frame(page);
    await page.screenshot({ path: ".playwright/final-pottery.png" });
    await page
      .getByRole("button", { name: "Pattern studio", exact: true })
      .click();
    await page.screenshot({ path: ".playwright/final-pattern-editor.png" });
  }
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
