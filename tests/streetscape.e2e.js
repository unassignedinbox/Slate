import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium as playwright, expect as baseExpect } from '@playwright/test';
import * as THREE from 'three';
import { createRoad, createCurve, validateNetwork, getJunctions } from '../src/lib/network.js';
import { buildTopology } from '../src/lib/topology.js';
import { planInfrastructure } from '../src/lib/infrastructure.js';
import { resolveCurbAccess, planStreetscape } from '../src/lib/streetscape.js';
const expect = baseExpect.configure({ timeout: 30000 });
const artifacts = '.arena/streetscape';
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
const project = (roads, name = 'Curb access') => ({
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
  const road = createRoad('local', [p(-160, 0, 'west'), p(160, 0, 'east')], 'street', {
    name: 'Access street',
    lights: false,
    parking: false,
    sidewalk: 2.4,
  });
  let model = await load(project([road]));
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Access street' })
    .locator('button')
    .first()
    .click();
  for (const type of ['grate', 'inlet', 'slot', 'combined']) {
    await page.getByLabel('Curb drainage', { exact: true }).selectOption(type);
    model = await settle();
    assert.equal(model.roads[0].drainage, type);
  }
  model = await field('Drain spacing', 24);
  assert.equal(model.roads[0].drainSpacing, 24);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.asset-card').filter({ hasText: 'Vehicle pavement ramp' }).click();
  await clickWorld(model, { x: -50, z: 5, y: 0.28 });
  model = await settle();
  let access = model.props.find((p) => p.type === 'driveway');
  assert.ok(access?.curbAnchor);
  assert.equal(access.roadId, 'street');
  await expect(
    page.getByRole('spinbutton', { name: 'Detail rotation', exact: true }),
  ).toBeDisabled();
  model = await field('Detail width', 6);
  model = await field('Ramp run', 1.8);
  await page.getByLabel('Curb side', { exact: true }).selectOption('-1');
  model = await settle();
  access = model.props.find((p) => p.type === 'driveway');
  assert.equal(access.width, 6);
  assert.equal(access.rampDepth, 1.8);
  assert.equal(access.curbAnchor.side, -1);
  // Undo/redo is a single authoring action, including the changed paving.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.equal(model.props[0].curbAnchor.side, 1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  model = await settle();
  assert.equal(model.props[0].curbAnchor.side, -1);
  await page.locator('.asset-card').filter({ hasText: 'Pedestrian curb ramp' }).click();
  await clickWorld(model, { x: 45, z: 5, y: 0.28 });
  model = await settle();
  assert.ok(model.props.find((p) => p.type === 'curbRamp')?.curbAnchor);
  await page.locator('.asset-card').filter({ hasText: 'Zebra crossing' }).click();
  await clickWorld(model, { x: 0, z: 0, y: 0.1 });
  model = await settle();
  let ctx = { topology: buildTopology(model), infrastructure: planInfrastructure(model) },
    st = planStreetscape(model, ctx.topology.plans.get('street'), ctx.infrastructure);
  assert.equal(st.ramps.filter((r) => r.automatic).length, 2);
  assert.equal(st.ramps.filter((r) => !r.automatic).length, 2);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${artifacts}/curb-authoring.png`, timeout: 60000 });
  step(
    'Four drain styles, editable vehicle/pedestrian ramps, paired crosswalk drops and undo/redo',
  );

  // Direct G-drag uses the same attached geometry as numeric edits.
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Vehicle pavement ramp' })
    .locator('button')
    .first()
    .click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(1000);
  access = model.props.find((p) => p.type === 'driveway');
  const resolved = resolveCurbAccess(model, access),
    start = await worldPoint(model, { x: access.x, z: access.z, y: 0.15 }),
    end = await worldPoint(model, { x: -20, z: access.z, y: 0.15 });
  await page.locator('.canvas-host canvas').focus();
  await page.keyboard.press('g');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 14 });
  await page.mouse.up();
  model = await settle();
  access = model.props.find((p) => p.type === 'driveway');
  assert.ok(Math.abs(access.x + 20) < 5);
  assert.equal(access.curbAnchor.side, resolved.side);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Focus selected detail', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.mouse.move(730, 425);
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifacts}/vehicle-ramp-close.png`, timeout: 60000 });
  await page.keyboard.press('Home');
  await page.waitForTimeout(900);
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Pedestrian curb ramp' })
    .locator('button')
    .first()
    .click();
  await page.getByRole('button', { name: 'Focus selected detail', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifacts}/pedestrian-ramp-close.png`, timeout: 60000 });
  // Saved anchors survive splitting and a complete browser reload.
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Access street' })
    .locator('button')
    .first()
    .click();
  await page.getByRole('button', { name: 'Split selected segment', exact: true }).click();
  model = await settle();
  for (const prop of model.props.filter((p) => p.curbAnchor))
    assert.ok(resolveCurbAccess(model, prop));
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.deepEqual(await saved(), model);
  const json = JSON.parse((await exportDownload('json')).toString());
  assert.deepEqual(validateNetwork(json), model);
  const glb = glbJSON(await exportDownload('glb'));
  const features = glb.nodes.flatMap((n) => Object.keys(n.extras?.streetscapeFeatures || {}));
  for (const name of [
    'Vehicle_access_apron',
    'Tactile_crosswalk_warning_pad',
    'Kerb_inlet_throat',
    'Gutter_grate_bar',
  ])
    assert.ok(features.includes(name), `${name} in GLB`);
  const obj = (await exportDownload('obj')).toString();
  for (const name of [
    'Batched_Vehicle_access_concrete',
    'Batched_Tactile_warning_paving',
    'Batched_Drain_recess',
    'Batched_Drain_cast_iron',
  ])
    assert.ok(obj.includes(name), `${name} in OBJ`);
  step('Road-relative dragging, split remapping, persistence and actual drain/ramp mesh exports');

  // Each branch tool attaches to the original road rather than overlaying it.
  for (const [type, shortcut, count, degree] of [
    ['tjunction', 'T-junction', 3, 3],
    ['ymerge', 'Y merge', 3, 3],
    ['crossroad', 'Four-way connector', 4, 4],
  ]) {
    model = await load(project([road], 'Connector fixture'));
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    if (type === 'crossroad') {
      await page.getByRole('button', { name: 'More road categories', exact: true }).click();
      await page.getByRole('button', { name: 'Junctions', exact: true }).click();
      await page.locator('.preset-card').filter({ hasText: shortcut }).click();
    } else await page.getByRole('button', { name: shortcut, exact: true }).click();
    await clickWorld(model, { x: 0, z: 0, y: 0.1 });
    await clickWorld(model, { x: -70, z: 100 });
    model = await settle();
    assert.equal(model.roads.length, count);
    assert.ok(getJunctions(model.roads).some((n) => n.roads.length === degree));
    validateNetwork(model);
    await page.screenshot({ path: `${artifacts}/${type}.png`, timeout: 60000 });
  }
  step('T, tangent Y and four-way connectors share real existing-road nodes');

  model = await load(project([], 'Diamond fixture'));
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Diamond', exact: true }).click();
  await clickWorld(model, { x: 0, z: 0 });
  await clickWorld(model, { x: -400, z: 0 });
  model = await settle();
  assert.equal(model.roads.length, 13);
  assert.equal(buildTopology(model).junctions.length, 6);
  validateNetwork(model);
  await page.keyboard.press('Home');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${artifacts}/diamond-interchange.png`, timeout: 60000 });
  model = await field('Road elevation', 10);
  assert.ok(model.roads.every((r) => r.interchangeHeight === 10));
  assert.ok(model.roads.some((r) => r.points.some((p) => p.y === 10)));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.ok(model.roads.every((r) => r.interchangeHeight === 8));
  step(
    'Diamond two-click preview/creation, connected ramp terminals and coordinated height editing',
  );

  await page.setViewportSize({ width: 760, height: 740 });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Diamond', exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${artifacts}/mobile-tools.png`, timeout: 60000 });
  assert.deepEqual(errors, []);
  step('Responsive tools and no browser/WebGL errors');
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, timeout: 60000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
