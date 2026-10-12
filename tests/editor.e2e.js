import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium as playwright, expect as baseExpect } from '@playwright/test';
import { createInitialNetwork, validateNetwork } from '../src/lib/network.js';

const expect = baseExpect.configure({ timeout: 30000 });
const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173';
const artifacts = '.arena/e2e';
const storageKey = 'frontier-road-studio-v1';
await mkdir(artifacts, { recursive: true });
let launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
} else if (process.platform === 'linux' && process.arch === 'x64') {
  const {
    default: chromium,
    inflate,
    setupLambdaEnvironment,
  } = await import('@sparticuz/chromium');
  // The included NSS libraries also allow this browser to run in minimal Debian test sandboxes.
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
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const savedProject = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
const settle = async () => {
  await expect(page.getByRole('button', { name: 'All changes saved', exact: true })).toBeVisible();
  return savedProject();
};
const step = (name) => console.log(`✓ ${name}`);
const canvasClick = async (x, y) => {
  const canvas = page.locator('.canvas-host canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * x, y: box.height * y } });
};
const exportDownload = async (format) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  if (format === 'json') await page.getByRole('button', { name: /Road project.*json/ }).click();
  if (format === 'obj') {
    await page.getByRole('button', { name: /Wavefront.*obj/ }).click();
    await page
      .getByRole('switch', { name: 'Include procedural street lights', exact: true })
      .click();
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export network', exact: true }).click();
  const download = await downloadPromise;
  const path = `${artifacts}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  return readFile(path);
};

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.canvas-host canvas').waitFor();
  await settle();
  assert.equal((await savedProject()).roads.length, 44);
  await page.screenshot({ path: `${artifacts}/desktop.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  step('WebGL editor boots with a connected starter city and no horizontal overflow');

  const laneWidth = page.getByRole('spinbutton', { name: 'Lane width', exact: true });
  await laneWidth.fill('3.6');
  await laneWidth.press('Enter');
  let model = await settle();
  const editedId = model.roads.find((r) => r.laneWidth === 3.6)?.id;
  assert.ok(editedId);
  const bus = page.getByRole('switch', { name: 'Dedicated bus lanes', exact: true });
  await bus.click();
  await expect(bus).toHaveAttribute('aria-checked', 'true');
  model = await settle();
  assert.equal(model.roads.find((r) => r.id === editedId).bus, true);
  await page.getByRole('switch', { name: 'Protected cycle lanes', exact: true }).click();
  await settle();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Protected cycle lanes', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Protected cycle lanes', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  step('Live lane width, bus/cycle configuration, undo and redo work');

  await page.getByRole('button', { name: /Spline control points/ }).click();
  await page.getByRole('button', { name: 'Add midpoint handle', exact: true }).click();
  model = await settle();
  assert.equal(model.roads.find((r) => r.id === editedId).points.length, 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  model = await settle();
  assert.equal(model.roads.length, 43);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.equal(model.roads.length, 44);
  step('Spline handles and deletion are undoable');

  await page.keyboard.press('Home');
  await page.locator('.preset-card').filter({ hasText: 'Country road' }).click();
  await canvasClick(0.24, 0.19);
  await canvasClick(0.36, 0.27);
  model = await settle();
  assert.ok(model.roads.length > 44);
  assert.ok(model.roads.some((r) => r.type === 'rural'));
  assert.doesNotThrow(() => validateNetwork(model));
  step('Two-click road drawing creates valid geometry');

  await page.locator('.asset-card').filter({ hasText: 'Bollard' }).click();
  await canvasClick(0.56, 0.56);
  model = await settle();
  let bollard = model.props.find((p) => p.type === 'bollard');
  assert.ok(bollard);
  await expect(
    page.getByRole('spinbutton', { name: 'Detail rotation', exact: true }),
  ).toBeVisible();
  const rotation = page.getByRole('spinbutton', { name: 'Detail rotation', exact: true });
  await rotation.fill('90');
  await rotation.press('Enter');
  model = await settle();
  bollard = model.props.find((p) => p.id === bollard.id);
  assert.ok(Math.abs(bollard.rotation - Math.PI / 2) < 0.00001);
  const x = page.getByRole('spinbutton', { name: 'Detail position X', exact: true });
  const oldX = bollard.x;
  await x.fill(String(oldX + 5));
  await x.press('Enter');
  model = await settle();
  assert.ok(Math.abs(model.props.find((p) => p.id === bollard.id).x - (oldX + 5)) < 0.11);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  model = await settle();
  assert.ok(!model.props.some((p) => p.id === bollard.id));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.ok(model.props.some((p) => p.id === bollard.id));
  step('Street-detail placement, transform controls, deletion and restoration work');

  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page
    .locator('.scene-road')
    .filter({ hasText: 'Bollard' })
    .first()
    .getByRole('button')
    .click();
  await expect(
    page.getByRole('button', { name: 'Focus selected detail', exact: true }),
  ).toBeVisible();
  await page.locator('.scene-road').first().getByRole('button').first().click();
  const regional = page.getByRole('combobox', { name: 'Regional marking profile', exact: true });
  await regional.selectOption('uk');
  model = await settle();
  assert.equal(model.standard, 'uk');
  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole('button', { name: /Cast concrete.*Light surface/ }).click();
  model = await settle();
  assert.ok(model.roads.some((r) => r.material === 'concrete'));
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  step('Scene selection, regional traffic profile and real material changes work');

  await page.keyboard.press('Home');
  const before = await page.locator('.viewport-coordinates').innerText();
  const bounds = await page.locator('.canvas-host canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.3);
  await page.mouse.down({ button: 'right' });
  await page.keyboard.down('w');
  await page.waitForTimeout(750);
  await page.keyboard.up('w');
  await page.mouse.move(bounds.x + bounds.width * 0.6 + 15, bounds.y + bounds.height * 0.3 + 5);
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.viewport-coordinates')).not.toHaveText(before);
  await page.getByRole('button', { name: 'Perspective', exact: true }).click();
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top view', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Snap to 5 meter grid', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Snap to 5 meter grid', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Viewport layers', exact: true }).click();
  await page.getByRole('button', { name: 'Subway overlay', exact: true }).click();
  await page.getByRole('button', { name: 'Viewport layers', exact: true }).click();
  await page.getByRole('button', { name: 'Drive preview', exact: true }).click();
  await expect(page.locator('.drive-hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drive-hud')).toHaveCount(0);
  step('Unreal-style WASD navigation, top view, grid snap, subway overlay and drive preview work');

  await page.getByRole('button', { name: 'City generator', exact: true }).click();
  await page.getByRole('textbox', { name: 'World name', exact: true }).fill('Northhaven');
  await page.getByRole('button', { name: 'Organic', exact: true }).click();
  await page.getByRole('button', { name: '4 × 4 km', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Generation seed', exact: true }).fill('7128');
  await page.screenshot({ path: `${artifacts}/generator.png` });
  await page.getByRole('button', { name: 'Generate network', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  model = await settle();
  assert.equal(model.name, 'Northhaven');
  assert.equal(model.size, 4000);
  assert.equal(model.layout, 'organic');
  assert.doesNotThrow(() => validateNetwork(model));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  model = await settle();
  assert.equal(model.name, 'Westhaven');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  model = await settle();
  assert.equal(model.name, 'Northhaven');
  step('Seeded 4 km organic city generation and whole-network history work');

  const json = await exportDownload('json');
  const exported = validateNetwork(JSON.parse(json.toString('utf8')));
  assert.equal(exported.name, 'Northhaven');
  const glb = await exportDownload('glb');
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLength = glb.readUInt32LE(12),
    gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength).trim());
  assert.ok(gltf.meshes.length > 0);
  assert.ok(gltf.materials.length > 0);
  const obj = await exportDownload('obj');
  assert.ok(obj.toString('utf8').includes('\nv '));
  assert.ok(obj.toString('utf8').includes('\nf '));
  assert.ok(!obj.toString('utf8').includes('NaN'));
  step(
    `JSON, material-bearing GLB (${Math.round(glb.length / 1024)} KB) and OBJ downloads are valid`,
  );

  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'northhaven.roads.json', mimeType: 'application/json', buffer: json });
  model = await settle();
  assert.deepEqual(model, exported);
  await page.reload({ waitUntil: 'networkidle' });
  model = await settle();
  assert.deepEqual(model, exported);
  await page.getByRole('button', { name: 'Help and keyboard shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  step('JSON import, reload persistence and keyboard-help dialog work');

  const starter = Buffer.from(JSON.stringify(createInitialNetwork()));
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'westhaven.roads.json', mimeType: 'application/json', buffer: starter });
  await settle();
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/mobile.png`, timeout: 60000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
  assert.deepEqual(errors, []);
  step('Responsive layout passes; no browser or WebGL runtime errors');
  console.log('\nAll editor end-to-end checks passed.');
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
