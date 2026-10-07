import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  ornamentalCatalog,
  ornamentalPattern,
} from "../src/ornamentalConstructions.js";
import {
  patternStarterCatalog,
  patternStarter,
  patternStructureManifest,
  patternInventory,
  patternSVG,
  validatePattern,
} from "../src/patternDocument.js";
import { applyStitches } from "../src/patternStitches.js";
const geometry = (d) =>
  JSON.stringify(
    d.layers.map(({ path, kind, x, y, width, height, rotation, fillRule }) => ({
      path,
      kind,
      x,
      y,
      width,
      height,
      rotation,
      fillRule,
    })),
  );

test("200 construction ledger excludes primitives, palettes, aliases and parameter-only variants", () => {
  expect(patternInventory).toMatchObject({
    designs: 200,
    ornamental: 174,
    textile: 26,
  });
  expect(patternStructureManifest).toHaveLength(200);
  expect(new Set(patternStructureManifest.map((p) => p.structure)).size).toBe(
    200,
  );
  const counted = patternStarterCatalog.filter((p) => p.countedDesign);
  for (const name of [
    "Polka dots",
    "Ombre bands",
    "Zigzag ribbons",
    "Micro dots",
    "Ink Cube Fade",
    "African Diamond Carpet",
    "Pinstripes",
  ])
    expect(counted.some((p) => p.name === name)).toBe(false);
  expect(counted.filter((p) => p.group === "Fabric weaves")).toHaveLength(16);
  expect(counted.filter((p) => p.group === "Stitch patterns")).toHaveLength(10);
  const hashes = new Set();
  for (const p of counted) {
    const doc = patternStarter(p.name);
    const hash = createHash("sha256").update(geometry(doc)).digest("hex");
    expect(hashes.has(hash), p.name).toBe(false);
    hashes.add(hash);
    expect(validatePattern(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  }
  // This is regression evidence for no exact geometry duplicates, not a visual quality score.
});

test("63 new constructions preserve complete bounded paths, construction identity and added stitches", () => {
  expect(ornamentalCatalog).toHaveLength(63);
  for (const group of [
    "African inlay",
    "Islamic networks",
    "Ornamental carpets",
  ])
    expect(ornamentalCatalog.filter((p) => p.group === group)).toHaveLength(21);
  for (const p of ornamentalCatalog) {
    const raw = ornamentalPattern(p.name),
      doc = patternStarter(p.name);
    expect(doc.construction).toBe(p.id);
    expect(doc.layers.length).toBeLessThanOrEqual(61);
    expect(
      doc.layers.every(
        (l) => l.path.length < 100000 && !/NaN|Infinity/.test(l.path),
      ),
    ).toBe(true);
    expect(doc.layers.map((l) => l.path)).toEqual(
      raw.layers.map((l) => l.path),
    );
    expect(JSON.stringify(doc).length).toBeLessThan(12000000);
    expect(patternSVG(doc)).not.toContain("<image");
    const stitched = validatePattern(
      applyStitches(doc, {
        enabled: true,
        type: "Chain stitch",
        layout: "border",
      }),
    );
    expect(stitched.layers.filter((l) => l.stitchRole)).toHaveLength(3);
    expect(stitched.construction).toBe(p.id);
  }
});

test("200 filter, construction descriptions, palette independence and live new material", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/?material=natural-cotton&studio=pattern&pattern=chromatic-diamond-tapestry",
  );
  await page
    .getByRole("button", {
      name: "200 structures · no colorway counts ↗",
      exact: true,
    })
    .click();
  await expect(page.locator(".pe-library-count")).toContainText("200 results");
  await page.getByLabel("Textile family colorway").selectOption("Earth");
  await expect(page.locator(".pe-library-count")).toContainText("200 results");
  await page.getByLabel("Pattern collection").selectOption("African inlay");
  await expect(page.locator(".pe-starters button")).toHaveCount(21);
  await page
    .getByRole("button", { name: "Four Gate Marquetry", exact: true })
    .click();
  await expect(page.getByText("Construction:", { exact: false })).toContainText(
    "Four opposed gates",
  );
  await page.screenshot({ path: ".playwright/v76/african-studio.png" });
  await page.getByLabel("Pattern collection").selectOption("Islamic networks");
  await page
    .getByRole("button", { name: "Diamond Bowtie Arabesque", exact: true })
    .click();
  await page.screenshot({ path: ".playwright/v76/islamic-studio.png" });
  await page.getByRole("button", { name: "3D material", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Material preview status" }),
  ).toContainText("Live material · ready");
  await page.getByRole("button", { name: /Apply to material/ }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-material-ready",
    "true",
  );
  expect(errors).toEqual([]);
});
