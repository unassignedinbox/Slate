// Headless WebGL smoke test (SwiftShader): loads the built app, fails on any
// console/page error, screenshots scenarios for visual inspection.
// Usage: npm run build && (vite preview &) && node test/render.test.mjs [url]
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const shotsDir = new URL('./shots/', import.meta.url);
fs.mkdirSync(shotsDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('[console] ' + msg.text());
});
page.on('pageerror', (err) => errors.push('[page] ' + err.message));

console.log('loading', url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('window.__slateReady === true', { timeout: 180000 });
console.log('app ready, rendering frames...');

async function shot(name, waitMs) {
  const f0 = await page.evaluate('window.__slateFrames || 0');
  await new Promise((r) => setTimeout(r, waitMs));
  const f1 = await page.evaluate('window.__slateFrames || 0');
  const path = new URL(`./shots/${name}.png`, import.meta.url).pathname;
  await page.screenshot({ path });
  console.log(`${name}: frames ${f0} -> ${f1}, saved ${path}`);
}

async function selectPreset(name) {
  await page.evaluate((n) => {
    const sel = document.getElementById('preset-select');
    sel.value = n;
    sel.dispatchEvent(new Event('change'));
  }, name);
}

await shot('beach-break', 12000);
await selectPreset('Pipeline');
await shot('pipeline', 10000);
await selectPreset('Cancellation Lab');
await page.evaluate('new Promise(r => setTimeout(r, 4000))');
await shot('cancellation-lab', 10000);

const err = await page.evaluate('window.__slateError || null');
if (err) errors.push('[fatal] ' + err);
await browser.close();

if (errors.length) {
  console.error('RENDER ERRORS:\n' + errors.slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('render.test.mjs: ALL PASS (no console/page errors)');
