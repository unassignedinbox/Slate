import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium as playwright, expect as baseExpect } from '@playwright/test';
import * as THREE from 'three';
import {
  createRoad,
  createBridge,
  createCurve,
  ROAD_VARIANTS,
  BRIDGE_PRESETS,
  validateNetwork,
} from '../src/lib/network.js';
import { buildTopology } from '../src/lib/topology.js';
import { planInfrastructure } from '../src/lib/infrastructure.js';
import { planBridgeStructure } from '../src/lib/bridges.js';
const expect = baseExpect.configure({ timeout: 30000 });
const artifacts = '.arena/catalog';
await mkdir(artifacts, { recursive: true });
let launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
else if (process.platform === 'linux' && process.arch === 'x64') {
  const {
    default: chromium,
    inflate,
    setupLambdaEnvironment,
  } = await import('@sparticuz/chromium');
  await inflate('./node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  setupLambdaEnvironment('/tmp/al2023/lib');
  launchOptions = {
    ...launchOptions,
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  };
}
const browser = await playwright.launch(launchOptions),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const p = (x, z, nodeId) => ({ x, z, y: 0, ...(nodeId ? { nodeId } : {}) });
const project = (roads, name = 'Catalog') => ({
  schema: 1,
  name,
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props: [],
});
const saved = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('frontier-road-studio-v1')));
const settle = async () => {
  await expect(page.getByRole('button', { name: 'All changes saved', exact: true })).toBeVisible();
  return saved();
};
const load = async (network) => {
  await page.locator('input[type=file]').setInputFiles({
    name: 'streetscape.roads.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(network)),
  });
  await expect.poll(saved).toEqual(network);
  await page.waitForTimeout(300);
  return settle();
};
const field = async (name, value) => {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
  return settle();
};
const worldPoint = async (network, position) => {
  const points = network.roads.flatMap((r) => r.points),
    minX = points.length ? Math.min(...points.map((p) => p.x)) : 0,
    maxX = points.length ? Math.max(...points.map((p) => p.x)) : 0,
    minZ = points.length ? Math.min(...points.map((p) => p.z)) : 0,
    maxZ = points.length ? Math.max(...points.map((p) => p.z)) : 0;
  const extent = points.length ? Math.max(maxX - minX, maxZ - minZ, 160) : 1000,
    center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    box = await page.locator('.canvas-host canvas').boundingBox();
  const camera = new THREE.PerspectiveCamera(43, box.width / box.height, 0.2, 24000);
  camera.position.copy(center).add(new THREE.Vector3(extent * 0.43, extent * 0.54, extent * 0.61));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const point = new THREE.Vector3(position.x, position.y || 0, position.z).project(camera);
  return {
    x: ((point.x + 1) / 2) * box.width + box.x,
    y: ((1 - point.y) / 2) * box.height + box.y,
  };
};
const clickWorld = async (network, position) => {
  const q = await worldPoint(network, position);
  await page.mouse.click(q.x, q.y);
};
const exportDownload = async (format) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  if (format === 'json') await page.getByRole('button', { name: /Road project.*json/ }).click();
  if (format === 'obj') await page.getByRole('button', { name: /Wavefront.*obj/ }).click();
  const promise = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export network', exact: true }).click();
  const download = await promise,
    path = `${artifacts}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  return readFile(path);
};
const glbJSON = (buffer) => {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  const length = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString('utf8', 20, 20 + length));
};
const step = (text) => console.log(`✓ ${text}`);

try {
  await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await settle();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Browse road profiles', exact: true }).click();
  await expect(page.locator('.preset-card')).toHaveCount(35);
  await page.getByRole('button', { name: 'Browse bridge designs', exact: true }).click();
  await expect(page.locator('.preset-card')).toHaveCount(13);
  await page.screenshot({ path: `${artifacts}/bridge-library.png`, timeout: 60000 });
  step('Expanded collections expose 35 road profiles and 13 bridge designs');

  // All 24 profiles are actually created through the two-click UI, not merely
  // counted in a static catalog. Test the authoritative saved parameters.
  for (const preset of ROAD_VARIANTS) {
    const empty = project([], `Road ${preset.id}`);
    await load(empty);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Browse road profiles', exact: true }).click();
    await page.getByLabel('Search road presets', { exact: true }).fill(preset.name);
    await page.locator('.preset-card').filter({ hasText: preset.name }).click();
    await clickWorld(empty, { x: -280, z: 0 });
    await clickWorld(empty, { x: 280, z: 0 });
    let model = await settle();
    assert.equal(model.roads.length, 1);
    const road = model.roads[0];
    assert.equal(road.presetId, preset.id);
    assert.equal(road.type, preset.type);
    assert.equal(road.lanes, preset.lanes);
    assert.equal(road.oneWay, preset.oneWay || false);
    assert.equal(road.laneWidth, preset.laneWidth);
    assert.equal(road.median, preset.median);
    assert.equal(road.sidewalk, preset.sidewalk);
    validateNetwork(model);
    if (['motorway-eight', 'transit-boulevard', 'boulevard-green'].includes(preset.id)) {
      await page.keyboard.press('Home');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${artifacts}/${preset.id}.png`, timeout: 60000 });
    }
  }
  step(
    'All 24 added road profiles draw with the correct native type, lanes, width and roadside layout',
  );

  for (const preset of BRIDGE_PRESETS) {
    const empty = project([], `Bridge ${preset.id}`);
    await load(empty);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Browse bridge designs', exact: true }).click();
    await page.getByLabel('Search road presets', { exact: true }).fill(preset.name);
    await page.locator('.preset-card').filter({ hasText: preset.name }).click();
    await clickWorld(empty, { x: -350, z: 0 });
    const end = await worldPoint(empty, { x: 350, z: 0 });
    await page.mouse.move(end.x, end.y, { steps: 6 });
    if (preset.id === 'bridge-cable')
      await page.screenshot({ path: `${artifacts}/cable-stayed-preview.png`, timeout: 60000 });
    await page.mouse.click(end.x, end.y);
    let model = await settle();
    assert.equal(model.roads.length, 1);
    let bridge = model.roads[0];
    assert.equal(bridge.presetId, preset.id);
    assert.equal(bridge.bridgeStyle, preset.bridgeStyle);
    assert.equal(bridge.points.length, 10);
    assert.equal(bridge.points[0].y, 0);
    assert.equal(bridge.points.at(-1).y, 0);
    assert.equal(bridge.points[3].y, preset.elevation);
    validateNetwork(model);
    await expect(page.getByLabel('Bridge structure family', { exact: true })).toHaveValue(
      preset.bridgeStyle,
    );
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);
    const canvas = await page.locator('.canvas-host canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${artifacts}/${preset.id}.png`, timeout: 60000 });
    if (preset.id === 'bridge-arch') {
      model = await field('Bridge structural rise', 16);
      assert.equal(model.roads[0].bridgeRise, 16);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      model = await settle();
      assert.equal(model.roads[0].bridgeRise, 12);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      model = await settle();
      assert.equal(model.roads[0].bridgeRise, 16);
    }
    if (preset.id === 'bridge-cable') {
      model = await field('Bridge tower height', 27);
      model = await field('Bridge pier spacing', 40);
      assert.equal(model.roads[0].bridgeTowerHeight, 27);
      assert.equal(model.roads[0].bridgeSupportSpacing, 40);
      const before = planBridgeStructure(
        bridge,
        planInfrastructure(project([bridge])),
        buildTopology(project([bridge])).plans.get(bridge.id),
      );
      bridge = model.roads[0];
      const after = planBridgeStructure(
        bridge,
        planInfrastructure(model),
        buildTopology(model).plans.get(bridge.id),
      );
      assert.ok(
        Math.max(...after.members.map((m) => m.a.y)) >
          Math.max(...before.members.map((m) => m.a.y)) + 8,
      );
    }
    if (preset.id === 'bridge-girder') {
      await page.getByLabel('Bridge structure family', { exact: true }).selectOption('truss');
      model = await settle();
      assert.equal(model.roads[0].bridgeStyle, 'truss');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      model = await settle();
      assert.equal(model.roads[0].bridgeStyle, 'girder');
    }
    if (preset.id === 'bridge-foot') {
      model = await field('Path width', 5.5);
      assert.equal(model.roads[0].laneWidth, 5.5);
      assert.equal(model.roads[0].type, 'path');
      assert.equal(model.roads[0].lanes, 0);
    }
  }
  step(
    'All 12 bridge designs draw with real elevated spans, structural previews, editable families and dimensions',
  );

  const roads = BRIDGE_PRESETS.map((preset, i) => {
    const x = ((i % 3) - 1) * 850,
      z = (Math.floor(i / 3) - 1.5) * 550;
    return createBridge([p(x - 300, z), p(x + 300, z)], preset.id, undefined, `bridge-${i}`);
  });
  let model = await load(project(roads, 'Bridge collection'));
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.deepEqual(await saved(), model);
  const exported = JSON.parse((await exportDownload('json')).toString());
  assert.deepEqual(validateNetwork(exported), model);
  const glb = glbJSON(await exportDownload('glb')),
    features = glb.nodes.flatMap((n) => Object.keys(n.extras?.bridgeFeatures || {}));
  for (const name of [
    'Bridge_deck_slab',
    'Steel_I_girder_web',
    'Box_girder_soffit',
    'Through_arch_rib',
    'Masonry_arch_voussoir',
    'Truss_diagonal',
    'Cable_stayed_fan',
    'Suspension_main_cable',
    'Viaduct_edge_haunch',
    'Covered_bridge_pitched_roof',
    'Timber_longitudinal_stringer',
  ])
    assert.ok(features.includes(name), `${name} geometry exported`);
  const materials = glb.materials.map((m) => m.name);
  for (const name of [
    'Bridge_structural_steel',
    'Bridge_cable_steel',
    'Bridge_masonry',
    'Bridge_structural_timber',
    'Timber_decking',
    'Covered_bridge_roof',
  ])
    assert.ok(materials.includes(name), `${name} material exported`);
  const obj = (await exportDownload('obj')).toString();
  for (const name of [
    'Batched_Bridge_structural_steel',
    'Batched_Bridge_structural_timber',
    'Batched_Covered_bridge_roof',
  ])
    assert.ok(obj.includes(name), `${name} in OBJ`);
  step(
    'Complete bridge collection reloads and round-trips JSON, and exports actual structures/materials in GLB/OBJ',
  );

  await page.setViewportSize({ width: 760, height: 740 });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Browse bridge designs', exact: true }).click();
  await expect(page.locator('.preset-card')).toHaveCount(13);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${artifacts}/mobile-catalog.png`, timeout: 60000 });
  assert.deepEqual(errors, []);
  step('Responsive catalog and no browser/WebGL errors');
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, timeout: 60000 }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
