// Diagnostic badge for the 3D page: shows whether scripts run and whether taps reach the page.
// Temporary; remove once input is confirmed working on the user's browser.
const badge = document.createElement('div');
badge.id = 'probe';
badge.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;font:12px/1.4 monospace;color:#9ff;background:rgba(0,0,0,.7);padding:4px 8px;border-radius:6px;pointer-events:none;max-width:70vw;white-space:pre-wrap';
document.body.appendChild(badge);
let taps = 0, last = '-', errs = 0;
const describe = (el) => (el && el.id ? '#' + el.id : el && el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : el ? el.tagName : 'null');
const build = document.querySelector('meta[name=build]')?.content ?? 'none';
function paint(extra = '') {
  const dock = [...document.querySelectorAll('#dock .tile-label')].map((n) => n.textContent).join('/');
  badge.textContent = `build ${build} · view ${innerWidth}x${innerHeight}\ndock: ${dock}\ntaps: ${taps} · errors: ${errs}\nlast: ${last}${extra}`;
}
for (const type of ['pointerdown', 'touchstart']) {
  window.addEventListener(type, (e) => {
    taps++;
    last = `${type} @${Math.round(e.clientX ?? e.touches?.[0]?.clientX ?? 0)},${Math.round(e.clientY ?? e.touches?.[0]?.clientY ?? 0)} ${describe(e.target)}`;
    paint();
  }, { capture: true, passive: true });
}
window.addEventListener('error', (e) => { errs++; paint(`\n${String(e.message).slice(0, 80)}`); });
setInterval(() => paint(), 1000);
paint();
