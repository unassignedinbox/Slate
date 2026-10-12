// Visual + runtime smoke test. Loads the game in software-GL Chromium, fast
// forwards the simulation to interesting moments, and screenshots each dynamic
// track element.  Run: node tools/smoke.mjs
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chlibs/lib' },
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n  ${(e.stack || '').split('\n').slice(1, 4).join('\n  ')}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

console.log('→', URL);
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await sleep(4000);

const boot = await page.evaluate(() => {
  const s = window.__spine;
  if (!s) return { ok: false };
  const g = s.renderer.getContext();
  return {
    ok: true, lap: s.track.length, samples: s.track.deck.n, closure: s.track.closure.residual,
    bollards: s.hazards.zipper.bollards.length + (s.hazards.zipper2 ? s.hazards.zipper2.bollards.length : 0),
    trains: s.hazards.trains.length, traffic: s.hazards.traffic.vehicles.length,
    cranes: s.hazards.cranes.length, gl: g.getParameter(g.VERSION),
    towers: s.scene.children.filter((c) => c.isGroup).length,
    calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles,
  };
});
console.log('boot:', JSON.stringify(boot));

// helper: advance the sim without waiting on the (slow, software) renderer
const ff = (sec) => page.evaluate((sec) => {
  const S = window.__spine;
  const dt = 1 / 60;
  const inp = { steer: 0, throttle: 1, brake: 0, airL: 0, airR: 0, boost: 1 };
  const stub = { read: () => inp, endFrame() {}, tapped: () => false, keyTap: () => false, pressed: new Set(), pad: null };
  let t = S.__t || 800;
  for (let i = 0; i < sec * 60; i++) { S.race.update(dt, t, stub); t += dt; }
  S.__t = t;
}, sec);

/** place the player at a spot on the track and let the world run a moment */
async function at(tag, frac, opts = {}) {
  await page.evaluate((tag, frac, opts) => {
    const S = window.__spine;
    const a = S.track.anchors[tag];
    const target = a.s0 + (a.s1 - a.s0) * frac + (opts.offset || 0);
    const p = S.race.player;
    p.teleport(S.track.deck, target, opts.e ?? 0);
    p.speed = opts.speed ?? 96;
    p.hull = 100; p.wrecked = false;
    p.invuln = opts.invuln ?? 30;
    p.lifted = false; p.capture = null; p.captureState = null;
    if (opts.train) {
      const tr = S.hazards.trains[opts.train.index ?? 0];
      tr.state = opts.train.state || 'warn';
      tr.timer = opts.train.timer ?? 0.4;
    }
    if (opts.zipperPulse) {
      const z = opts.zipperPulse === 2 ? S.hazards.zipper2 : S.hazards.zipper;
      z.callPulse({ e: opts.e ?? 6 });
    }
    if (opts.crane) S.hazards.cranes[opts.crane].swingSpeed = 0.5;
  }, tag, frac, opts);
  await ff(opts.sim ?? 1.4);
  await sleep(2200);       // let the renderer catch up on a few frames
}

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log('   shot', name);
}

// ---- briefing ----
await shot('01-briefing');

// ---- race from the grid ----
await page.click('#btnRace');
await ff(3.2);
await sleep(2500);
await shot('02-grid');
await ff(6);
await sleep(2200);
await shot('03-zipper-approach');

// ---- each dynamic element ----
await at('zipper', 0.45, { e: -6, speed: 88 });
await shot('04-zipper-wave');
await at('zipper', 0.5, { e: 8, speed: 88, zipperPulse: 1, sim: 1.0 });
await shot('05-zipper-pulse');

await at('traffic', 0.35, { e: 0, speed: 92 });
await shot('06-traffic');
await at('train', 0.1, { e: 4, speed: 80, train: { state: 'crossing', timer: 1.6 }, sim: 0.7 });
await shot('07-train-crossing');
await at('train', 0.1, { e: 4, speed: 80, train: { state: 'warn', timer: 0.9 }, sim: 0.5 });
await shot('08-train-warning');

await at('crane', 0.15, { e: 10, speed: 92, sim: 1.0 });
await shot('09-crane-yfork');
// line up in the right-hand fork lane just as the magnet field settles over it
await page.evaluate(() => {
  const S = window.__spine;
  const p = S.race.player;
  const c = S.hazards.cranes[0];
  const lane = c.branches[1].e;                              // RIGHT LANE
  const w = 1 / c.swingSpeed;                                // swing period, seconds
  const peak = (w / 4) + w * Math.round(S.__t / w);          // next peak over that lane
  S.__t = peak - 0.30;                                       // arrive as it settles
  c.t = S.__t;
  p.teleport(S.track.deck, c.s - 24, lane);
  p.speed = 96; p.invuln = 0; p.hull = 100; p.wrecked = false;
  p.lifted = false; p.capture = null; p.captureState = null;
});
await ff(1.1);
await sleep(2200);
await shot('10-magnet-lock');
const lockState = await page.evaluate(() => {
  const p = window.__spine.race.player;
  return { lifted: p.lifted, capT: p.captureState ? +p.captureState.t.toFixed(2) : null,
    y: +p.pos.y.toFixed(1), e: +p.e.toFixed(1) };
});
console.log('   magnet lock:', JSON.stringify(lockState));
await ff(2.4);
await sleep(2200);
await shot('11-thrown');

await at('tsplit', 0.15, { e: -9, speed: 88, sim: 1.2 });
await shot('12-tsplit-lowline');
await page.evaluate(() => {
  const S = window.__spine;
  const br = S.track.branches.high;
  S.race.player.teleport(br, br.length * 0.45, 0).speed = 90;
});
await ff(0.8);
await sleep(2200);
await shot('13-highline');

await at('cornerD', 0.3, { e: 2, speed: 92, sim: 0.8 });
await shot('14-tighten');

// ---- showcase tour shots: park the flythrough camera on each element ----
await page.evaluate(() => {
  const S = window.__spine;
  S.race.reset(true);
  S.race.state = 'showcase';
  S.hud.show('showcase');
});

/** set the tour camera position and let it settle; `prep` stages the hazard */
async function tour(name, s, prep, wait = 2.6) {
  await page.evaluate((s, prep) => {
    const S = window.__spine;
    S.TOUR.s = s;
    S.TOUR.fired.clear();
    // eslint-disable-next-line no-new-func
    if (prep) new Function('S', prep)(S);
  }, s, prep || '');
  await ff(1.2);
  await sleep(wait * 1000);
  await shot(name);
}

const trainS = await page.evaluate(() => window.__spine.hazards.trains[0].s);
const cr1 = await page.evaluate(() => window.__spine.hazards.cranes[0].s);
const cr2 = await page.evaluate(() => window.__spine.hazards.cranes[1].s);
const tsplitS = await page.evaluate(() => window.__spine.track.anchors.tsplit.s1 - 24);

await tour('20-tour-zipper',
  await page.evaluate(() => window.__spine.track.anchors.zipper.s0 + 40),
  'S.hazards.zipper.callPulse({ e: -9 });');
await tour('21-tour-train', trainS - 52,
  'const t = S.hazards.trains[0]; t.state = "crossing"; t.timer = t.sweepDuration * 0.45; ' +
  't.offset = 0; t.dir = 1; S.hazards.trains[1].state = "idle"; S.hazards.trains[1].timer = 9;');
await tour('22-tour-crane', cr1 - 46,
  'const c = S.hazards.cranes[0]; S.hazards.trains.forEach(t => { t.state = "idle"; t.timer = 14; }); ' +
  'const r = S.race.vehicles[1]; r.teleport(S.track.deck, c.s - 12, c.branches[1].e); r.speed = 88; r.invuln = 0;');
await tour('23-tour-traffic', await page.evaluate(() => window.__spine.track.anchors.traffic.s0 + 70), '');
await tour('24-tour-tsplit', cr2 - 44,
  'S.hazards.cranes[1].swingSpeed = 0.5;');
await tour('25-tour-tighten', await page.evaluate(() => window.__spine.track.anchors.cornerD.s0 - 55), '');
await tour('26-tour-final', await page.evaluate(() => window.__spine.track.anchors.final.s0 + 60), '');

// ---- hud / results screens ----
await page.evaluate(() => {
  const S = window.__spine;
  const rows = S.race.results().map((r, i) => ({ ...r, bestLap: [27.94, 28.61, 29.30, 31.02][i] ?? null }));
  S.hud.fillResults(rows, 'RACE COMPLETE', '3 laps · 2.27 km');
  S.hud.show('results');
});
await sleep(1200);
await shot('30-results');

console.log('\n=== console/page errors ===');
console.log(logs.join('\n') || '(none)');
console.log(`${logs.length} problems`);
await browser.close();
process.exit(logs.length ? 1 : 0);
