export function bindHud({ onThreat, onStrike, onToggleTour, onCycleCamera, onToggleDebug }) {
  const els = {
    boot: document.getElementById('boot'),
    bootFill: document.getElementById('boot-fill'),
    hud: document.getElementById('hud'),
    stateLabel: document.getElementById('state-label'),
    fps: document.getElementById('fps'),
    tris: document.getElementById('tris'),
    btnThreat: document.getElementById('btn-threat'),
    btnAttack: document.getElementById('btn-attack'),
    btnPath: document.getElementById('btn-path'),
    btnCam: document.getElementById('btn-cam'),
    btnLegs: document.getElementById('btn-legs'),
  };

  els.btnThreat.addEventListener('click', onThreat);
  els.btnAttack.addEventListener('click', onStrike);
  els.btnPath.addEventListener('click', () => {
    const active = onToggleTour();
    els.btnPath.textContent = active ? 'Auto Wall-Walk Tour (On)' : 'Auto Wall-Walk Tour';
    els.btnPath.classList.toggle('btn-danger', active);
  });
  els.btnCam.addEventListener('click', () => {
    const label = onCycleCamera();
    els.btnCam.textContent = `Camera: ${label}`;
  });
  els.btnLegs.addEventListener('click', onToggleDebug);

  function setBootProgress(p) {
    els.bootFill.style.width = `${Math.round(p * 100)}%`;
  }
  function hideBoot() {
    els.boot.classList.add('hidden');
    els.hud.classList.remove('hidden');
  }
  function setState(label) {
    els.stateLabel.textContent = `state: ${label}`;
  }
  function setStats(fps, tris) {
    els.fps.textContent = `FPS ${fps}`;
    els.tris.textContent = `Tris ${tris.toLocaleString()}`;
  }

  return { setBootProgress, hideBoot, setState, setStats, els };
}
