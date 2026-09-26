import { Game } from './game.js';

const container = document.getElementById('app');

function fatal(err) {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `
      <div class="t" style="color:#ff5a45">Failed to deploy</div>
      <pre style="max-width:80vw;white-space:pre-wrap;font-size:11px;opacity:.7">${
        err && err.message ? err.message : err
      }</pre>`;
  }
}

const game = new Game(container);
window.__game = game;

game.build().catch(fatal);

window.addEventListener('error', (e) => {
  if (e && e.error) console.error('runtime error', e.error);
});
