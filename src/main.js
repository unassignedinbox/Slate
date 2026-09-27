import './style.css';
import { Game } from './game.js';

const game = new Game(
  document.getElementById('app'),
  document.getElementById('ui'),
  document.getElementById('loader'),
);

game.load().catch((err) => {
  console.error(err);
  const el = document.querySelector('#loader .loadText');
  if (el) el.textContent = `Failed to deploy: ${err.message}`;
});

// handy for poking at the world from the console
window.__slate = game;
