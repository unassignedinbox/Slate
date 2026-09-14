// Probe the live SolidArc app: build a box, apply a top-edge fillet/chamfer,
// and measure the resulting geometry against the analytic ground truth.
const puppeteer = require('puppeteer');

const URL = process.env.URL || 'http://127.0.0.1:8080/index.html';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  const out = await page.evaluate(() => {
    const R = {};
    const has = (n) => typeof window[n] === 'function';
    R.api = ['solidBuild', 'profileSegs', 'loopSubs', 'ringOf', 'cornerGeom', 'mk', 'byId']
      .map((n) => n + ':' + has(n));

    // ---- find/create a simple box body -------------------------------------
    const bodies = (window.doc ? doc.figures.filter((f) => f.kind === 'body' && f.profile) : []);
    R.bodies = bodies.map((b) => ({ id: b.id, name: b.name, op: b.op, params: b.params }));
    if (!bodies.length) return R;
    const f = bodies[0];

    const bbox = (m) => {
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      (m.tris || []).forEach((t) => t.forEach((p) => p.forEach((v, i) => {
        lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v);
      })));
      return { lo, hi };
    };
    const summary = (m) => ({
      tris: (m.tris || []).length,
      quads: (m.quads || []).length,
      faces: m.brep ? m.brep.faces.map((x) => x.key + '#' + x.kind) : null,
      bbox: bbox(m),
    });

    const saved = f.edits ? JSON.parse(JSON.stringify(f.edits)) : [];
    const build = (edits) => {
      f.edits = edits;
      let m = null, err = null;
      try { m = solidBuild(f); } catch (e) { err = String(e); }
      f.edits = saved;
      return { m, err };
    };

    R.base = (() => { const b = build([]); return b.err ? { err: b.err } : summary(b.m); })();

    // what edge keys exist on the untouched solid?
    const b0 = build([]);
    R.edgeKeys = b0.m && b0.m.brep ? b0.m.brep.edges.map((e) => e.key) : [];

    // ---- apply a top chamfer + fillet and measure --------------------------
    const trial = (type, r, keyFilter) => {
      const keys = R.edgeKeys.filter(keyFilter);
      if (!keys.length) return { skip: 'no keys' };
      const b = build(keys.map((k) => ({ type, key: k, r })));
      if (b.err) return { err: b.err, keys };
      const s = summary(b.m);
      s.keys = keys;
      return s;
    };
    const topKey = (k) => /^top:/.test(k);
    R.chamfer2_top = trial('chamfer', 2, topKey);
    R.fillet2_top = trial('fillet', 2, topKey);
    R.chamfer5_top = trial('chamfer', 5, topKey);

    return R;
  });

  console.log(JSON.stringify({ errs, out }, null, 2));
  await browser.close();
})();
