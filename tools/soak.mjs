// Simulation soak test: runs the game logic at full speed inside the page with
// no rendering, driving the player with a simple racing controller. Catches
// NaNs, stuck AI, un-drivable physics and hazard regressions.
// Run: node tools/soak.mjs [seconds]
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const SECONDS = Number(process.argv[2] || 240);
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chlibs/lib' },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
await page.goto(process.env.URL || 'http://localhost:8080/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const report = await page.evaluate((SECONDS) => {
  const S = window.__spine;
  const { race, track, hazards: haz } = S;
  const p = race.player;
  const dt = 1 / 60;
  const profile = race.profile;
  const T = track.length;

  // reset to a clean grid
  race.reset(false);
  race.state = 'racing';
  race.countdown = 0;
  race.time = 0;

  const log = {
    steps: 0, nans: 0, wrecks: 0, lifts: 0, hullHits: {}, lapTimes: [], minHull: 100,
    maxProgress: 0, state: '', finishedOrder: [], stuckFrames: 0, elevator: 0, finite: true,
    events: [], wreckLog: [],
  };
  const dmg = {};
  const origAdd = p.addHullDamage.bind(p);
  p.addHullDamage = (amount, reason) => {
    log.hullHits[reason] = (log.hullHits[reason] || 0) + 1;
    const d = dmg[reason] || (dmg[reason] = { n: 0, total: 0, s0: Infinity, s1: -Infinity, speeds: [] });
    d.n++; d.total += amount; d.s0 = Math.min(d.s0, p.s); d.s1 = Math.max(d.s1, p.s);
    d.speeds.push(Math.round(p.speed));
    let phase = '';
    if (reason === 'train') {
      for (const tr of haz.trains) {
        let ds = tr.s - p.s;
        if (ds < -T * 0.5) ds += T; else if (ds > T * 0.5) ds -= T;
        if (Math.abs(ds) < 60) phase = `${tr.state}/${tr.timer.toFixed(2)}@${ds.toFixed(0)}`;
      }
    }
    log.events.push(`${reason} -${Math.round(amount)} @t${t.toFixed(1)} lap${p.lap} s${Math.round(p.s)} e${p.e.toFixed(1)} v${Math.round(p.speed)} ${phase}`);
    if (log.events.length > 200) log.events.shift();
    return origAdd(amount, reason);
  };
  const origWreck = p.wreck.bind(p);
  p.wreck = (reason) => {
    log.wreckLog.push(`s${Math.round(p.s)} v${Math.round(p.speed)} zone=${track.zoneAt(p.s)} ${reason || '?'}`);
    return origWreck(reason);
  };
  for (const v of race.vehicles) {
    if (v === p) continue;
    v.__laps = 0; v.__w1 = v.onLap; v.onLapComplete = () => { v.__laps++; };
  }
  const input = { steer: 0, throttle: 1, brake: 0, airL: 0, airR: 0, boost: 0 };
  const stub = { read: () => input, endFrame() {}, tapped: () => false, keyTap: () => false, pressed: new Set(), pad: null };

  let t = 0;
  let watchBest = -1e9, watchT = 0;
  let prevS = p.s;
  const stuckBuckets = {};
  const wreckBuckets = {};
  let wasWrecked = false;
  for (let i = 0; i < SECONDS * 60; i++) {
    // --- autopilot: racing line, look-ahead braking, traffic weaving,
    //     and a real decision at maglev crossings (commit or wait) ---
    const onBranch = p.path !== track.deck;
    const look = 16 + p.speed * 0.34;
    const sAhead = onBranch ? p.s + look : p.s + look;
    const idx = onBranch ? Math.min(p.path.n - 1, Math.round(sAhead)) : track.deck.idx(sAhead);
    let targetE = onBranch ? 0 : profile.line[idx];
    const safe = haz.safeLane(p.s + 14, p.e);
    if (safe != null) targetE = safe;
    const isl = track.island;
    if (p.s > isl.s0 - 50 && p.s < isl.s1 + 10) targetE = (p.e >= 0 ? 1 : -1) * Math.max(11, Math.abs(targetE));
    // weave around traffic
    for (const tv of haz.traffic.vehicles) {
      let dsv = tv.s - p.s;
      if (dsv > T * 0.5) dsv -= T; else if (dsv < -T * 0.5) dsv += T;
      if (Math.abs(dsv) < 34 && Math.abs(tv.e - p.e) < 6.5) {
        targetE += (p.e >= tv.e ? 1 : -1) * 7;
      }
    }
    // steer toward the line, and toward the tangent further out
    const f2 = p.path.frame(p.s + 8, {});
    let headErr = f2.th - p.yaw;
    while (headErr > Math.PI) headErr -= Math.PI * 2;
    while (headErr < -Math.PI) headErr += Math.PI * 2;
    const f = p.path.frame(p.s, {});
    const hw = f.hw;
    targetE = Math.max(-hw * 0.46, Math.min(hw * 0.46, targetE));
    input.steer = Math.max(-1, Math.min(1, (targetE - p.e) * 0.13 - headErr * 1.5));

    // corner braking: slowest point in the next 170 m
    let vLim = Infinity, dist = 0;
    for (let d = 12; d < 170; d += 8) {
      const v = profile.vmax[track.deck.idx(p.s + d)];
      if (v < vLim) { vLim = v; dist = d; }
    }
    let canBrake = Math.sqrt(vLim * vLim + 2 * 40 * dist) * 0.95;

    // maglev decision: slow only if we would arrive inside the sweep
    let hold = false;
    let crossing = null;
    for (const tr of haz.trains) {
      let ds = tr.s - p.s;
      if (ds < -T * 0.5) ds += T; else if (ds > T * 0.5) ds -= T;
      if (ds > 0 && ds < 340 && (!crossing || ds < crossing.ds)) crossing = { ds, tr };
    }
    if (crossing) {
      const w = crossing.tr.dangerWindow();
      const arrive = crossing.ds / Math.max(24, p.speed);
      if (arrive > w.start - 0.9 && arrive < w.end + 0.5) {
        hold = true;
        const wantArrive = w.end + 1.4;
        canBrake = Math.min(canBrake, crossing.ds / Math.max(0.7, wantArrive));
      }
    }
    input.brake = (p.speed > canBrake * 1.04 || hold) ? 1 : 0;
    input.throttle = input.brake ? 0 : 1;
    if (input.brake && !hold) input.boost = 0;
    if (!crossing || !hold) input.boost = input.boost || ((p.speed < canBrake * 0.8 && vLim > 120) ? 1 : 0);
    input.airL = 0; input.airR = 0;
    if (hold && p.speed < 26) input.brake = 0;   // don't stall out
    input.throttle = input.brake ? 0 : 1;        // and never leave throttle at 0
    race.update(dt, t, stub);
    t += dt;
    log.steps++;

    // --- invariant checks ---
    const vals = [p.pos.x, p.pos.y, p.pos.z, p.speed, p.e, p.yaw, p.hull];
    if (vals.some((v) => !isFinite(v))) { log.nans++; log.finite = false; }
    if (p.wrecked) log.wrecks++;
    if (p.lifted) log.lifts++;
    log.minHull = Math.min(log.minHull, p.hull);
    const prog = race.totalProgress(p);
    log.maxProgress = Math.max(log.maxProgress, prog);
    if (Math.abs(p.s - prevS) < 0.35 && !p.wrecked && p.speed < 6) {
      log.stuckFrames++;
      const b = Math.floor(p.s / 100) * 100;
      stuckBuckets[b] = (stuckBuckets[b] || 0) + 1;
    }
    if (p.wrecked && !wasWrecked) {
      const b = Math.floor(p.s / 100) * 100;
      wreckBuckets[b] = (wreckBuckets[b] || 0) + 1;
    }
    wasWrecked = p.wrecked;
    prevS = p.s;
    if (p.speed > 260) log.elevator++;

    // progress watchdog: flag any 2 s window with no forward progress
    if (prog > watchBest + 0.5) { watchBest = prog; watchT = t; }
    else if (t - watchT > 2.0) {
      watchT = t;
      const f = track.deck.frame(p.s, {});
      log.watch ??= [];
      if (log.watch.length < 6) {
        log.watch.push({
          t: +t.toFixed(1), s: +p.s.toFixed(2), e: +p.e.toFixed(2), speed: +p.speed.toFixed(1),
          yaw: +p.yaw.toFixed(3), lap: p.lap, race: race.state,
          hw: +f.hw.toFixed(1), x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1),
          projErr: +Math.hypot(p.pos.x - f.x, p.pos.z - f.z).toFixed(1),
          hint: p._hint, wrecked: p.wrecked, lifted: p.lifted, capture: !!p.capture,
          prevS: +(p.prevS ?? -1).toFixed(1), idx: track.deck.idx(p.s),
          path: p.path === track.deck ? 'deck' : 'branch', plen: +p.path.length.toFixed(0),
          phw: +(p.path.hw[Math.min(p.path.n - 1, Math.max(0, Math.round(p.s)))] ?? -1).toFixed(1),
          lastS: +(p.lastS ?? -1).toFixed(1), inputs: `${input.steer.toFixed(2)}/${input.throttle}/${input.brake}/${input.boost}`,
          rate: +((p.s - (p.prevS ?? p.s)) * 60).toFixed(1),
          onDeckProj: +(() => { const d = track.deck.project(p.pos.x, p.pos.z, null, track.deck.n, {}); return d.dist; })().toFixed(1),
        });
      }
    }
    if (race.state === 'finished') break;
  }
  log.dmg = dmg;
  log.stuckBuckets = stuckBuckets;
  log.wreckBuckets = wreckBuckets;
  log.zoneOfStop = track.zoneAt(p.s);
  log.state = race.state;
  log.playerLaps = p.lap;
  log.playerBest = p.bestLap;
  log.finishedOrder = race.finishOrder.map((v) => v.name);
  log.rivals = race.vehicles.filter((v) => v !== p).map((v) => ({
    name: v.name, lap: v.lap, s: +v.s.toFixed(0), speed: +v.speed.toFixed(0),
    hull: +v.hull.toFixed(0), wrecked: v.wrecked, lifted: v.lifted,
  }));
  log.hazards = {
    trains: haz.trains.map((tr) => tr.state),
    zipperPulse: haz.zipper.pulse.mix,
    bollards: haz.zipper.bollards.length + (haz.zipper2 ? haz.zipper2.bollards.length : 0),
  };
  log.results = race.results().slice(0, 4).map((r) => ({ n: r.name, p: r.place, fin: r.finished }));
  return log;
}, SECONDS);

console.log(JSON.stringify(report, null, 1));
await browser.close();
const bad = !report.finite || report.nans > 0 || report.playerLaps < 1;
console.log(bad ? '\nSOAK: FAIL' : '\nSOAK: PASS');
process.exit(bad ? 1 : 0);
