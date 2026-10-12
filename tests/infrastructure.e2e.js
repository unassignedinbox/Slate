import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium as playwright, expect as baseExpect } from '@playwright/test';
import * as THREE from 'three';
import { createRoad, createCurve, validateNetwork, getJunctions } from '../src/lib/network.js';
import { planInfrastructure, bridgeReport } from '../src/lib/infrastructure.js';
import { resolveRoadMarking } from '../src/lib/placement.js';

const expect = baseExpect.configure({ timeout: 30000 });
const artifacts = '.arena/infrastructure';
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
const browser = await playwright.launch(launchOptions);
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const project = (roads, name = 'Infrastructure') => ({
  schema: 1,
  name,
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props: [],
});
const p = (x, z, nodeId) => ({ x, z, y: 0, ...(nodeId ? { nodeId } : {}) });
const saved = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('frontier-road-studio-v1')));
const settle = async () => {
  await expect(page.getByRole('button', { name: 'All changes saved', exact: true })).toBeVisible();
  return saved();
};
const load = async (n) => {
  await page.locator('input[type=file]').setInputFiles({
    name: 'fixture.roads.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(n)),
  });
  return settle();
};
const field = async (name, value) => {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
  return settle();
};
const clickWorld = async (network, position, coordinatesOnly = false) => {
  const points = network.roads.filter((r) => r.type !== 'subway').flatMap((r) => r.points);
  const minX = points.length ? Math.min(...points.map((p) => p.x)) : 0,
    maxX = points.length ? Math.max(...points.map((p) => p.x)) : 0;
  const minZ = points.length ? Math.min(...points.map((p) => p.z)) : 0,
    maxZ = points.length ? Math.max(...points.map((p) => p.z)) : 0;
  const extent = points.length ? Math.max(maxX - minX, maxZ - minZ, 160) : 1000;
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const box = await page.locator('.canvas-host canvas').boundingBox();
  const camera = new THREE.PerspectiveCamera(43, box.width / box.height, 0.2, 24000);
  camera.position.copy(center).add(new THREE.Vector3(extent * 0.43, extent * 0.54, extent * 0.61));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const q = new THREE.Vector3(position.x, position.y || 0, position.z).project(camera);
  const x = ((q.x + 1) * box.width) / 2,
    y = ((1 - q.y) * box.height) / 2;
  assert.ok(
    x > 0 && x < box.width && y > 0 && y < box.height,
    'test point must be in the fitted viewport',
  );
  if (coordinatesOnly) return { x: box.x + x, y: box.y + y };
  await page.locator('.canvas-host canvas').click({ position: { x, y } });
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
const step = (message) => console.log(`✓ ${message}`);

try {
  await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await settle();
  const node = p(0, 0, 'join');
  const joins = project(
    [
      createRoad('arterial', [node, p(30, 8), p(90, 75), p(160, 100)], 'curve', {
        name: 'Curved avenue',
        lights: false,
      }),
      createRoad('local', [node, p(-150, -10)], 'west', { name: 'West street', lights: false }),
      createRoad('local', [node, p(-10, 140)], 'south', { name: 'South street', lights: false }),
    ],
    'Clean curved joins',
  );
  await load(joins);
  await page.screenshot({ path: `${artifacts}/curved-joins.png`, timeout: 60000 });
  const markerPoint = createCurve(joins.roads[0]).getPointAt(0.55);
  markerPoint.y = 0.1;
  await page.locator('.asset-card').filter({ hasText: 'Lane arrow' }).click();
  await clickWorld(joins, markerPoint);
  let model = await settle();
  const arrow = model.props.find((p) => p.type === 'arrow');
  assert.ok(arrow?.roadId);
  assert.ok(arrow.roadAnchor);
  assert.ok(Math.abs(arrow.y) < 0.001);
  assert.equal(arrow.width, 1.6);
  await page.keyboard.press('Escape');
  step('curved joins render cleanly and placed lane decals project onto the paved surface');

  const requestedZ = arrow.z + 8;
  model = await field('Detail position Y', requestedZ);
  let editedArrow = model.props.find((p) => p.id === arrow.id);
  const resolvedArrow = resolveRoadMarking(model, editedArrow).prop;
  for (const key of ['x', 'y', 'z', 'rotation'])
    assert.ok(Math.abs(editedArrow[key] - resolvedArrow[key]) < 0.00001);
  await expect(
    page.getByRole('spinbutton', { name: 'Detail position Y', exact: true }),
  ).toHaveValue(String(Number(editedArrow.z.toFixed(2))));
  model = await field('Detail position X', 10000);
  assert.equal(model.props.find((p) => p.id === arrow.id).x, editedArrow.x);
  await expect(
    page.getByRole('spinbutton', { name: 'Detail position X', exact: true }),
  ).toHaveValue(String(Number(editedArrow.x.toFixed(2))));
  model = await field('Detail rotation', 37);
  assert.ok(
    Math.abs(model.props.find((p) => p.id === arrow.id).rotation - (37 * Math.PI) / 180) < 0.00001,
  );

  await page.locator('.asset-card').filter({ hasText: 'Zebra crossing' }).click();
  const zebraPoint = createCurve(joins.roads[0]).getPointAt(0.72);
  zebraPoint.y = 0.1;
  await clickWorld(joins, zebraPoint);
  model = await settle();
  const zebra = model.props.find((p) => p.type === 'crosswalk');
  assert.ok(zebra?.roadAnchor);
  await expect(
    page.getByRole('spinbutton', { name: 'Detail rotation', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('spinbutton', { name: 'Detail elevation', exact: true }),
  ).toBeDisabled();
  model = await field('Detail surface lift', 0.006);
  assert.equal(model.props.find((p) => p.id === zebra.id).roadAnchor.lift, 0.006);
  const liftInput = page.getByRole('spinbutton', { name: 'Detail surface lift', exact: true });
  await liftInput.fill('0.02');
  await liftInput.press('Escape');
  await expect(liftInput).toHaveValue('0.006');
  assert.equal((await saved()).props.find((p) => p.id === zebra.id).roadAnchor.lift, 0.006);
  await page.getByRole('button', { name: 'Focus selected detail', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/projected-marking-close.png`, timeout: 60000 });
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Curved avenue' })
    .getByRole('button')
    .first()
    .click();
  model = await field('Road elevation', 4);
  assert.ok(model.props.find((p) => p.id === zebra.id).y > 2);
  assert.ok(model.props.find((p) => p.id === arrow.id).y > 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.equal(model.props.find((p) => p.id === zebra.id).y, 0.006);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  model = await settle();
  assert.ok(model.props.find((p) => p.id === zebra.id).y > 2);
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Zebra crossing' })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('spinbutton', { name: 'Detail elevation', exact: true })).toHaveValue(
    String(Number(model.props.find((p) => p.id === zebra.id).y.toFixed(3))),
  );
  await page.reload({ waitUntil: 'networkidle' });
  model = await settle();
  assert.ok(model.props.find((p) => p.id === zebra.id).roadAnchor);
  assert.ok(model.props.find((p) => p.id === zebra.id).y > 2);
  validateNetwork(model);
  step(
    'projected transforms, rejected edits, surface lift, deck following and history/persistence work',
  );
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Zebra crossing' })
    .getByRole('button')
    .first()
    .click();
  await page.keyboard.press('Home');
  await page.keyboard.press('g');
  let dragSource = model.props.find((p) => p.id === zebra.id);
  const target = createCurve(model.roads.find((r) => r.id === 'curve')).getPointAt(0.48);
  target.y += 0.1;
  let from = await clickWorld(model, { ...dragSource, y: dragSource.y + 0.105 }, true);
  let to = await clickWorld(model, target, true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  model = await settle();
  assert.ok(
    Math.hypot(
      model.props.find((p) => p.id === zebra.id).x - dragSource.x,
      model.props.find((p) => p.id === zebra.id).z - dragSource.z,
    ) > 5,
  );
  validateNetwork(model);
  await page.getByRole('button', { name: 'Hide Curved avenue', exact: true }).click();
  model = await settle();
  await expect(page.locator('.detail-attachment-status')).toContainText('hidden');
  dragSource = model.props.find((p) => p.id === zebra.id);
  const otherRoad = createCurve(model.roads.find((r) => r.id === 'south')).getPointAt(0.65);
  otherRoad.y += 0.1;
  from = await clickWorld(model, { ...dragSource, y: dragSource.y + 0.105 }, true);
  to = await clickWorld(model, otherRoad, true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  model = await settle();
  assert.equal(model.props.find((p) => p.id === zebra.id).roadId, 'south');
  assert.ok(Math.abs(model.props.find((p) => p.id === zebra.id).y - 0.006) < 0.00001);
  await expect(page.locator('.detail-attachment-status')).toContainText('South street');
  validateNetwork(model);
  step('G-drag follows the projected surface and reattaches hidden-road decals onto another level');

  const street = createRoad('local', [p(-400, 0), p(400, 0)], 'street', {
    name: 'Lower road',
    lights: false,
    parking: false,
  });
  const base = project([street], 'Rail and overpass');
  await load(base);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Railway', exact: true }).click();
  await clickWorld(base, p(-100, -240));
  await clickWorld(base, p(-100, 240));
  model = await settle();
  let rail = model.roads.find((r) => r.type === 'railway');
  assert.ok(rail);
  assert.equal(model.roads.length, 2);
  assert.equal(getJunctions(model.roads).length, 0);
  assert.equal(planInfrastructure(model).crossings.length, 1);
  model = await field('Track gauge', 1.52);
  assert.equal(model.roads.find((r) => r.id === rail.id).gauge, 1.52);
  await page.getByRole('button', { name: 'Add track', exact: true }).click();
  model = await settle();
  assert.equal(model.roads.find((r) => r.id === rail.id).lanes, 3);
  await page.getByRole('button', { name: 'Remove track', exact: true }).click();
  await settle();
  step('continuous rail drawing, gauge/track count and automatic road-crossing treatment work');

  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Overpass', exact: true }).click();
  await clickWorld(model, p(40, -320));
  await clickWorld(model, p(40, 320));
  model = await settle();
  let bridge = model.roads.find((r) => r.type === 'bridge');
  assert.ok(bridge);
  assert.equal(model.roads.length, 3);
  assert.equal(getJunctions(model.roads).length, 0);
  assert.ok(bridgeReport(bridge, model).clearance > 7);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await settle()).roads.length, 2);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  model = await settle();
  assert.equal(model.roads.length, 3);
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Road overpass' })
    .getByRole('button')
    .first()
    .click();
  model = await field('Road elevation', 10);
  bridge = model.roads.find((r) => r.id === bridge.id);
  assert.ok(bridgeReport(bridge, model).clearance > 9);
  model = await field('Deck thickness', 0.9);
  assert.equal(model.roads.find((r) => r.id === bridge.id).deckThickness, 0.9);
  await page.keyboard.press('Home');
  await page.screenshot({ path: `${artifacts}/rail-and-overpass.png`, timeout: 60000 });
  assert.doesNotThrow(() => validateNetwork(model));
  step('road-over-road placement, clearance, deck properties and undo/redo work');

  const json = await exportDownload('json');
  assert.deepEqual(validateNetwork(JSON.parse(json)), model);
  const glb = await exportDownload('glb');
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(8), glb.length);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)).trim());
  for (const name of ['Railway_steel', 'Level_crossing_panels', 'Bridge_structural_concrete'])
    assert.ok(gltf.materials.some((m) => m.name === name));
  const obj = (await exportDownload('obj')).toString('utf8');
  assert.ok(obj.includes('\nf '));
  assert.ok(!/NaN|Infinity/.test(obj));
  step(
    `rail/deck/slab materials survive valid GLB (${Math.round(glb.length / 1024)} KB), OBJ and editable JSON exports`,
  );

  await page.getByRole('button', { name: 'City generator', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cloverleaf', exact: true }).click();
  await page.getByRole('textbox', { name: 'World name', exact: true }).fill('Stacked cloverleaf');
  await page.getByRole('spinbutton', { name: 'Loop radius', exact: true }).fill('60');
  await page.getByRole('spinbutton', { name: 'Overpass height', exact: true }).fill('9');
  await page.getByRole('checkbox', { name: 'Surface railway', exact: true }).check();
  await page.screenshot({ path: `${artifacts}/cloverleaf-generator.png`, timeout: 60000 });
  await page.getByRole('button', { name: 'Generate network', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  model = await settle();
  assert.equal(model.layout, 'cloverleaf');
  assert.equal(model.roads.length, 29);
  assert.equal(model.roads.filter((r) => r.type === 'ramp').length, 8);
  assert.equal(planInfrastructure(model).crossings.length, 2);
  model = await field('Road elevation', 10.5);
  assert.ok(model.roads.filter((r) => r.interchangeId).every((r) => r.interchangeHeight === 10.5));
  validateNetwork(model);
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Northbound overpass' })
    .nth(2)
    .getByRole('button')
    .first()
    .click();
  await page.keyboard.press('f');
  await page.screenshot({ path: `${artifacts}/cloverleaf-overpass-close.png`, timeout: 60000 });
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Loop · East to North' })
    .first()
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: /Spline control points/ }).click();
  const loop = model.roads.find((r) => r.name === 'Loop · East to North');
  await page.getByRole('button', { name: 'Add midpoint handle', exact: true }).click();
  model = await settle();
  assert.equal(model.roads.find((r) => r.id === loop.id).points.length, loop.points.length + 3);
  validateNetwork(model);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  await page.keyboard.press('Escape');
  step(
    'connected cloverleaf generation, global bridge height and shape-preserving ramp handles work',
  );

  await page.reload({ waitUntil: 'networkidle' });
  model = await settle();
  assert.equal(model.name, 'Stacked cloverleaf');
  assert.equal(model.roads.length, 29);
  validateNetwork(model);
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/mobile-cloverleaf.png`, timeout: 60000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
  step('infrastructure project reloads correctly and the mobile layout does not overflow');

  const empty = project([], 'Template placement');
  await load(empty);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Cloverleaf', exact: true }).click();
  await clickWorld(empty, p(0, 0));
  await clickWorld(empty, p(-440, 0));
  model = await settle();
  assert.equal(model.roads.length, 28);
  assert.equal(getJunctions(model.roads).length, 16);
  validateNetwork(model);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await settle()).roads.length, 0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal((await settle()).roads.length, 28);
  step(
    'two-click interchange placement creates the whole connected template as one undoable action',
  );

  const closeCrossing = project(
    [
      createRoad('local', [p(-55, 0), p(55, 0)], 'crossing-street', {
        name: 'Crossing approach',
        lights: false,
        parking: false,
      }),
      createRoad('railway', [p(0, -55), p(0, 55)], 'crossing-rail', { name: 'Continuous tracks' }),
    ],
    'Crossing detail',
  );
  await load(closeCrossing);
  await page.keyboard.press('Home');
  const canvasBox = await page.locator('.canvas-host canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -1850);
  await page.screenshot({ path: `${artifacts}/rail-crossing-close.png`, timeout: 60000 });
  step('close-up rail crossing and projected marking browser views render without runtime errors');

  assert.deepEqual(errors, []);
  console.log('\nAll infrastructure end-to-end checks passed.');
} catch (e) {
  await page.screenshot({ path: `${artifacts}/failure.png`, timeout: 60000 }).catch(() => {});
  console.error('Browser errors:', errors);
  throw e;
} finally {
  await browser.close();
}
