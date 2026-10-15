import { CAR_COLORS } from './car.js';
import { sound } from './audio.js';

export class HUD {
  constructor(container, onSelectStage, onSelectColor, onReset, onToggleCam) {
    this.container = container;
    this.onSelectStage = onSelectStage;
    this.onSelectColor = onSelectColor;
    this.onReset = onReset;
    this.onToggleCam = onToggleCam;

    this.touchInput = {
      up: false,
      down: false,
      left: false,
      right: false,
      drift: false,
      boost: false
    };

    this._createDOM();
    this._attachListeners();
  }

  _createDOM() {
    this.container.innerHTML = `
      <style>
        .hud-panel {
          position: absolute;
          font-family: 'Segoe UI', -apple-system, Roboto, sans-serif;
          color: #fff;
          text-shadow: 0 0 8px rgba(0,0,0,0.8);
          pointer-events: auto;
        }

        /* Top Bar: Stage & Checkpoints */
        #top-bar {
          top: 15px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          background: rgba(10, 14, 24, 0.75);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(0, 240, 255, 0.3);
          border-radius: 20px;
          padding: 8px 24px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .stage-title {
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 2px;
          color: #00f0ff;
          text-transform: uppercase;
        }
        .stage-subtitle {
          font-size: 11px;
          color: #8fa0ba;
          letter-spacing: 1px;
        }
        .checkpoint-track {
          display: flex;
          gap: 12px;
          margin-top: 4px;
        }
        .cp-node {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid #3a4b60;
          background: #121824;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: bold;
          color: #8fa0ba;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .cp-node.active {
          border-color: #00f0ff;
          background: #00f0ff;
          color: #050b14;
          box-shadow: 0 0 10px #00f0ff;
          transform: scale(1.15);
        }
        .cp-node.passed {
          border-color: #00ff66;
          background: #00ff66;
          color: #050b14;
        }

        /* Top Left: Timer & Health */
        #telemetry-left {
          top: 18px;
          left: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .timer-box {
          background: rgba(10, 14, 24, 0.75);
          backdrop-filter: blur(8px);
          border-left: 3px solid #00f0ff;
          border-radius: 4px;
          padding: 6px 14px;
          font-family: monospace;
          font-size: 18px;
          font-weight: bold;
          color: #fff;
          letter-spacing: 1px;
        }
        .health-bar-container {
          width: 170px;
          height: 10px;
          background: rgba(20,20,25,0.8);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 5px;
          overflow: hidden;
        }
        #health-bar {
          width: 100%;
          height: 100%;
          background: #00ff66;
          transition: width 0.2s ease, background 0.3s ease;
        }
        .health-label {
          font-size: 10px;
          font-weight: bold;
          color: #aaa;
          letter-spacing: 1px;
        }

        /* Top Right: Controls & Menu button */
        #top-right-controls {
          top: 18px;
          right: 20px;
          display: flex;
          gap: 10px;
        }
        .btn-icon {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgba(10, 14, 24, 0.8);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(0, 240, 255, 0.4);
          color: #fff;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-icon:hover {
          background: #00f0ff;
          color: #050b14;
          box-shadow: 0 0 12px #00f0ff;
        }

        /* Center: Hazard Warning & Stage Clear Banner */
        #banner-box {
          top: 28%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: none;
          flex-direction: column;
          align-items: center;
          background: linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.25), transparent);
          padding: 16px 60px;
          text-align: center;
          pointer-events: none;
        }
        #banner-title {
          font-size: 32px;
          font-weight: 900;
          letter-spacing: 4px;
          color: #fff;
          text-shadow: 0 0 20px #00f0ff;
        }
        #banner-sub {
          font-size: 16px;
          color: #00f0ff;
          letter-spacing: 2px;
          margin-top: 4px;
        }

        /* Drift Points Overlay */
        #drift-box {
          top: 38%;
          left: 50%;
          transform: translateX(-50%);
          display: none;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
        }
        #drift-score {
          font-size: 28px;
          font-weight: 900;
          color: #ffaa00;
          text-shadow: 0 0 15px #ffaa00;
        }
        #drift-multi {
          font-size: 14px;
          font-weight: bold;
          color: #ff5500;
        }

        /* Bottom Center: Speedometer & Tachometer */
        #speed-dial {
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          background: radial-gradient(circle at center, rgba(12, 18, 30, 0.85) 0%, rgba(6, 9, 16, 0.95) 75%);
          backdrop-filter: blur(10px);
          border: 2px solid rgba(0, 240, 255, 0.4);
          border-radius: 50%;
          width: 145px;
          height: 145px;
          box-shadow: 0 0 25px rgba(0, 240, 255, 0.25);
          justify-content: center;
          pointer-events: none;
        }
        #speed-num {
          font-size: 42px;
          font-weight: 900;
          line-height: 1;
          color: #fff;
          text-shadow: 0 0 12px rgba(0, 240, 255, 0.8);
          font-family: monospace;
        }
        .speed-unit {
          font-size: 11px;
          font-weight: bold;
          letter-spacing: 2px;
          color: #00f0ff;
          margin-top: 2px;
        }
        #gear-box {
          font-size: 13px;
          font-weight: bold;
          color: #ffaa00;
          margin-top: 2px;
        }
        /* Boost Gauge Arc / Bar */
        #boost-bar-container {
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          width: 170px;
          height: 7px;
          background: rgba(20,20,25,0.8);
          border: 1px solid rgba(0, 240, 255, 0.4);
          border-radius: 4px;
          overflow: hidden;
        }
        #boost-bar {
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, #0088ff, #00f0ff);
          box-shadow: 0 0 10px #00f0ff;
          transition: width 0.1s linear;
        }

        /* Virtual On-Screen Mobile Controls */
        #mobile-controls {
          position: absolute;
          bottom: 20px;
          left: 0;
          width: 100%;
          display: flex;
          justify-content: space-between;
          padding: 0 25px;
          pointer-events: none;
        }
        .mobile-btn-group {
          display: flex;
          gap: 14px;
          pointer-events: auto;
        }
        .touch-btn {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: rgba(12, 18, 30, 0.7);
          backdrop-filter: blur(6px);
          border: 2px solid rgba(0, 240, 255, 0.4);
          color: #fff;
          font-size: 20px;
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
          touch-action: none;
          cursor: pointer;
        }
        .touch-btn:active {
          background: #00f0ff;
          color: #050b14;
          box-shadow: 0 0 15px #00f0ff;
        }
        .touch-btn-boost {
          border-color: #00ffcc;
          font-size: 14px;
        }
        .touch-btn-drift {
          border-color: #ffaa00;
          font-size: 14px;
        }

        /* Modal Menu / Stage Select */
        #menu-modal {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(5, 8, 14, 0.88);
          backdrop-filter: blur(12px);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: auto;
        }
        .modal-content {
          background: #0e1422;
          border: 2px solid #00f0ff;
          border-radius: 16px;
          padding: 30px 40px;
          width: 90%;
          max-width: 580px;
          box-shadow: 0 0 40px rgba(0, 240, 255, 0.3);
          text-align: center;
        }
        .modal-title {
          font-size: 26px;
          font-weight: 900;
          color: #fff;
          letter-spacing: 2px;
          margin-bottom: 8px;
        }
        .modal-subtitle {
          font-size: 13px;
          color: #8fa0ba;
          margin-bottom: 24px;
        }
        .stage-select-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 24px;
        }
        .stage-card {
          background: #151d30;
          border: 1px solid #2a3850;
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }
        .stage-card:hover {
          border-color: #00f0ff;
          background: #1c2742;
          transform: translateY(-2px);
        }
        .stage-card-num {
          font-size: 10px;
          font-weight: 800;
          color: #00f0ff;
        }
        .stage-card-title {
          font-size: 13px;
          font-weight: bold;
          color: #fff;
          margin-top: 2px;
        }
        .color-palette {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .color-swatch {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #fff;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .color-swatch:hover {
          transform: scale(1.2);
        }
        .btn-primary {
          background: #00f0ff;
          color: #050b14;
          font-size: 15px;
          font-weight: 800;
          border: none;
          border-radius: 8px;
          padding: 12px 32px;
          cursor: pointer;
          letter-spacing: 1px;
          transition: all 0.2s;
        }
        .btn-primary:hover {
          box-shadow: 0 0 20px #00f0ff;
          transform: scale(1.05);
        }

        /* Victory Screen Modal */
        #victory-modal {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(5, 8, 14, 0.92);
          backdrop-filter: blur(14px);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: auto;
        }
      </style>

      <!-- Top Bar Stage Progress -->
      <div id="top-bar" class="hud-panel">
        <div class="stage-title" id="stage-title-text">STAGE 1 / 7</div>
        <div class="stage-subtitle" id="stage-subtitle-text">SHATTERED METROPOLIS</div>
        <div class="checkpoint-track">
          <div class="cp-node active" data-stage="1">1</div>
          <div class="cp-node" data-stage="2">2</div>
          <div class="cp-node" data-stage="3">3</div>
          <div class="cp-node" data-stage="4">4</div>
          <div class="cp-node" data-stage="5">5</div>
          <div class="cp-node" data-stage="6">6</div>
          <div class="cp-node" data-stage="7">7</div>
        </div>
      </div>

      <!-- Top Left Telemetry -->
      <div id="telemetry-left" class="hud-panel">
        <div class="timer-box" id="time-display">00:00.00</div>
        <div>
          <div class="health-label">CHASSIS INTEGRITY</div>
          <div class="health-bar-container">
            <div id="health-bar"></div>
          </div>
        </div>
      </div>

      <!-- Top Right Actions -->
      <div id="top-right-controls" class="hud-panel">
        <div class="btn-icon" id="btn-cam" title="Change Camera (C)">🎥</div>
        <div class="btn-icon" id="btn-mute" title="Mute/Unmute (M)">🔊</div>
        <div class="btn-icon" id="btn-reset" title="Reset Car (R)">🔄</div>
        <div class="btn-icon" id="btn-menu" title="Menu / Stage Select (Esc)">⚙️</div>
      </div>

      <!-- Center Banner Notifications -->
      <div id="banner-box" class="hud-panel">
        <div id="banner-title">CHECKPOINT REACHED</div>
        <div id="banner-sub">WARPING TO NEXT SECTOR...</div>
      </div>

      <!-- Drift Points Display -->
      <div id="drift-box" class="hud-panel">
        <div id="drift-score">+0 PTS</div>
        <div id="drift-multi">x1.0 MULTIPLIER</div>
      </div>

      <!-- Bottom Speed Dial & Boost -->
      <div id="speed-dial" class="hud-panel">
        <div id="speed-num">0</div>
        <div class="speed-unit">KM/H</div>
        <div id="gear-box">GEAR 1</div>
      </div>
      <div id="boost-bar-container" class="hud-panel">
        <div id="boost-bar"></div>
      </div>

      <!-- Touch / Mobile Controls -->
      <div id="mobile-controls">
        <div class="mobile-btn-group">
          <div class="touch-btn" id="btn-left">◀</div>
          <div class="touch-btn" id="btn-right">▶</div>
        </div>
        <div class="mobile-btn-group">
          <div class="touch-btn touch-btn-drift" id="btn-drift">DRIFT</div>
          <div class="touch-btn touch-btn-boost" id="btn-boost">NITRO</div>
          <div class="touch-btn" id="btn-brake">▼</div>
          <div class="touch-btn" id="btn-gas">▲</div>
        </div>
      </div>

      <!-- Menu / Stage Select Modal -->
      <div id="menu-modal">
        <div class="modal-content">
          <div class="modal-title">PORTAL CIRCUIT ODYSSEY</div>
          <div class="modal-subtitle">7 Modular Obstacle Stages · Frontier PROTO-X Coupe</div>

          <div style="font-size: 12px; font-weight: bold; color: #00f0ff; margin-bottom: 8px; text-align: left;">JUMP TO STAGE:</div>
          <div class="stage-select-grid">
            <div class="stage-card" data-stage="1">
              <div class="stage-card-num">STAGE 1</div>
              <div class="stage-card-title">Shattered Roofs</div>
            </div>
            <div class="stage-card" data-stage="2">
              <div class="stage-card-num">STAGE 2</div>
              <div class="stage-card-title">Sewer Pipe Conduit</div>
            </div>
            <div class="stage-card" data-stage="3">
              <div class="stage-card-num">STAGE 3</div>
              <div class="stage-card-title">Dung Beetle Ridge</div>
            </div>
            <div class="stage-card" data-stage="4">
              <div class="stage-card-num">STAGE 4</div>
              <div class="stage-card-title">Wave Bollards City</div>
            </div>
            <div class="stage-card" data-stage="5">
              <div class="stage-card-num">STAGE 5</div>
              <div class="stage-card-title">Metro Monorail</div>
            </div>
            <div class="stage-card" data-stage="6">
              <div class="stage-card-num">STAGE 6</div>
              <div class="stage-card-title">Magnetic Crane</div>
            </div>
            <div class="stage-card" data-stage="7" style="grid-column: span 2;">
              <div class="stage-card-num">STAGE 7 (FINALE)</div>
              <div class="stage-card-title">D-Day Bunker Minefield & Turrets</div>
            </div>
          </div>

          <div style="font-size: 12px; font-weight: bold; color: #00f0ff; margin-bottom: 8px; text-align: left;">PAINT CUSTOMIZER:</div>
          <div class="color-palette" id="color-palette"></div>

          <div style="font-size: 11px; color: #8fa0ba; margin-bottom: 16px; line-height: 1.5;">
            Controls: WASD / Arrow Keys = Drive · Space = Drift/Handbrake · Shift = Nitro Boost · C = Camera · R = Reset
          </div>

          <button class="btn-primary" id="btn-resume">RESUME RACE</button>
        </div>
      </div>

      <!-- Victory Modal -->
      <div id="victory-modal">
        <div class="modal-content" style="border-color: #ffd700; box-shadow: 0 0 50px rgba(255, 215, 0, 0.4);">
          <div class="modal-title" style="color: #ffd700;">🏆 GRAND PRIX CHAMPION! 🏆</div>
          <div class="modal-subtitle">All 7 Hazard Obstacle Stages Cleared!</div>

          <div style="background: rgba(0,0,0,0.5); border-radius: 10px; padding: 18px; margin-bottom: 24px; text-align: left;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #8fa0ba;">TOTAL TIME:</span>
              <span id="vic-total-time" style="font-weight: bold; color: #fff; font-family: monospace;">00:00.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #8fa0ba;">TOTAL DRIFT SCORE:</span>
              <span id="vic-drift-score" style="font-weight: bold; color: #ffaa00;">0 PTS</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #8fa0ba;">FINAL VEHICLE STATUS:</span>
              <span id="vic-health" style="font-weight: bold; color: #00ff66;">100% OPERATIONAL</span>
            </div>
          </div>

          <button class="btn-primary" id="btn-vic-restart" style="background: #ffd700;">PLAY AGAIN</button>
        </div>
      </div>
    `;

    // Populate color swatches
    const palette = this.container.querySelector('#color-palette');
    CAR_COLORS.forEach(c => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      swatch.title = c.name;
      swatch.onclick = () => {
        if (this.onSelectColor) this.onSelectColor(c.hex);
      };
      palette.appendChild(swatch);
    });
  }

  _attachListeners() {
    // Stage select cards in modal
    this.container.querySelectorAll('.stage-card').forEach(card => {
      card.onclick = () => {
        const s = parseInt(card.getAttribute('data-stage'), 10);
        this.hideMenu();
        if (this.onSelectStage) this.onSelectStage(s);
      };
    });

    // Top progress bar nodes
    this.container.querySelectorAll('.cp-node').forEach(node => {
      node.onclick = () => {
        const s = parseInt(node.getAttribute('data-stage'), 10);
        if (this.onSelectStage) this.onSelectStage(s);
      };
    });

    // Header buttons
    const btnMenu = this.container.querySelector('#btn-menu');
    btnMenu.onclick = () => this.toggleMenu();

    const btnResume = this.container.querySelector('#btn-resume');
    btnResume.onclick = () => this.hideMenu();

    const btnMute = this.container.querySelector('#btn-mute');
    btnMute.onclick = () => {
      const isMuted = sound.toggleMute();
      btnMute.textContent = isMuted ? '🔇' : '🔊';
    };

    const btnReset = this.container.querySelector('#btn-reset');
    btnReset.onclick = () => {
      if (this.onReset) this.onReset();
    };

    const btnCam = this.container.querySelector('#btn-cam');
    btnCam.onclick = () => {
      if (this.onToggleCam) this.onToggleCam();
    };

    const btnVicRestart = this.container.querySelector('#btn-vic-restart');
    btnVicRestart.onclick = () => {
      this.hideVictory();
      if (this.onSelectStage) this.onSelectStage(1);
    };

    // Virtual Touch buttons
    const bindTouch = (id, key) => {
      const el = this.container.querySelector(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); this.touchInput[key] = true; sound.init(); };
      const end = (e) => { e.preventDefault(); this.touchInput[key] = false; };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    };

    bindTouch('#btn-gas', 'up');
    bindTouch('#btn-brake', 'down');
    bindTouch('#btn-left', 'left');
    bindTouch('#btn-right', 'right');
    bindTouch('#btn-boost', 'boost');
    bindTouch('#btn-drift', 'drift');
  }

  showMenu() {
    this.container.querySelector('#menu-modal').style.display = 'flex';
  }

  hideMenu() {
    this.container.querySelector('#menu-modal').style.display = 'none';
  }

  toggleMenu() {
    const modal = this.container.querySelector('#menu-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
  }

  showVictory(totalTimeStr, driftScore, health) {
    this.container.querySelector('#vic-total-time').textContent = totalTimeStr;
    this.container.querySelector('#vic-drift-score').textContent = Math.floor(driftScore) + ' PTS';
    this.container.querySelector('#vic-health').textContent = Math.floor(health) + '% INTEGRITY';
    this.container.querySelector('#victory-modal').style.display = 'flex';
  }

  hideVictory() {
    this.container.querySelector('#victory-modal').style.display = 'none';
  }

  showBanner(title, sub, duration = 2.5) {
    const box = this.container.querySelector('#banner-box');
    const t = this.container.querySelector('#banner-title');
    const s = this.container.querySelector('#banner-sub');
    t.textContent = title;
    s.textContent = sub;
    box.style.display = 'flex';

    if (this._bannerTimeout) clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => {
      box.style.display = 'none';
    }, duration * 1000);
  }

  update(car, stageIndex, stageTitle, stageSub, elapsedTime) {
    // Speedometer
    const speedKmh = Math.floor(Math.abs(car.speed) * 3.6);
    this.container.querySelector('#speed-num').textContent = speedKmh;

    // Gear
    const gearText = car.speed < -0.5 ? 'GEAR R' : `GEAR ${car.gear}`;
    this.container.querySelector('#gear-box').textContent = gearText;

    // Boost Bar
    this.container.querySelector('#boost-bar').style.width = car.nitro + '%';

    // Health Bar
    const healthPercent = Math.max(0, (car.health / car.maxHealth) * 100);
    const healthBar = this.container.querySelector('#health-bar');
    healthBar.style.width = healthPercent + '%';
    healthBar.style.background = healthPercent > 50 ? '#00ff66' : (healthPercent > 25 ? '#ffaa00' : '#ff0033');

    // Timer display (MM:SS.ms)
    const mins = Math.floor(elapsedTime / 60);
    const secs = Math.floor(elapsedTime % 60);
    const millis = Math.floor((elapsedTime % 1) * 100);
    this.container.querySelector('#time-display').textContent =
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;

    // Stage title & subtitle
    this.container.querySelector('#stage-title-text').textContent = `STAGE ${stageIndex} / 7`;
    this.container.querySelector('#stage-subtitle-text').textContent = stageSub.toUpperCase();

    // Checkpoint nodes
    this.container.querySelectorAll('.cp-node').forEach(node => {
      const s = parseInt(node.getAttribute('data-stage'), 10);
      node.classList.remove('active', 'passed');
      if (s === stageIndex) node.classList.add('active');
      else if (s < stageIndex) node.classList.add('passed');
    });

    // Drift Overlay
    const driftBox = this.container.querySelector('#drift-box');
    if (car.isDrifting && car.driftScore > 0) {
      driftBox.style.display = 'flex';
      this.container.querySelector('#drift-score').textContent = `+${Math.floor(car.driftScore)} PTS`;
      this.container.querySelector('#drift-multi').textContent = `x${car.driftMultiplier.toFixed(1)} MULTIPLIER`;
    } else {
      driftBox.style.display = 'none';
    }
  }
}
