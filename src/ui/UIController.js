import { EAGLE_PLUMAGE_PRESETS } from '../eagle/EaglePlumages.js';

export class UIController {
  constructor(app) {
    this.app = app;
    this.selectedHotspot = null;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';

    overlay.innerHTML = `
      <!-- Top Bar -->
      <div class="top-bar">
        <!-- Brand & Species Card -->
        <div class="glass-panel brand-section">
          <div class="brand-title">
            <span>🦅 EAGLE 3D STUDIO</span>
            <span class="badge-aaa">AAA READY</span>
          </div>
          <div id="species-name" class="species-name">Adult Bald Eagle (Haliaeetus leucocephalus)</div>
          <div id="species-desc" class="species-desc">
            Iconic North American sea eagle with pure white head & tail, dark chocolate brown plumage, and bright yellow hooked bill and talons.
          </div>
          <div class="specs-grid">
            <div class="spec-item">
              <span class="spec-label">Wingspan</span>
              <span class="spec-val">2.15 m (7.1 ft)</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Grip Force</span>
              <span class="spec-val">400+ PSI</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Top Speed</span>
              <span class="spec-val">160 km/h dive</span>
            </div>
          </div>
        </div>

        <!-- Top Right Controls -->
        <div class="top-right-controls">
          <!-- Plumage Presets -->
          <div class="glass-panel control-pill-group">
            <button class="pill-btn active" data-plumage="bald">🇺🇸 Bald Eagle</button>
            <button class="pill-btn" data-plumage="golden">👑 Golden Eagle</button>
            <button class="pill-btn" data-plumage="harpy">⚡ Harpy Eagle</button>
            <button class="pill-btn" data-plumage="arctic">❄️ Arctic Falcon</button>
            <button class="pill-btn" data-plumage="shadow">🌑 Shadow Apex</button>
          </div>

          <!-- Camera & Render Mode Presets -->
          <div class="glass-panel control-pill-group">
            <button class="pill-btn active" data-cam="orbit">🔄 Orbit</button>
            <button class="pill-btn" data-cam="chase">🎬 Cinematic</button>
            <button class="pill-btn" data-cam="beak">🦅 Beak Close-Up</button>
            <button class="pill-btn" data-cam="talon">🦶 Talons</button>
            <button class="pill-btn" data-cam="ground">🛫 Ground</button>
          </div>

          <!-- Render & Lighting Tools -->
          <div class="glass-panel control-pill-group">
            <button class="pill-btn" id="btn-wireframe">🕸️ Wireframe</button>
            <button class="pill-btn" id="btn-skeleton">🦴 Skeleton Rig</button>
            <button class="pill-btn" id="btn-light">☀️ Sky / Sunset</button>
            <button class="pill-btn" id="btn-audio-mute">🔊 Audio</button>
            <button class="pill-btn active" id="btn-export-modal" style="background: var(--accent-gold); color: #000;">📥 Export 3D</button>
          </div>
        </div>
      </div>

      <!-- Left Anatomy Hotspot Sidebar -->
      <div class="glass-panel side-panel-left">
        <div class="panel-header">
          <span>Anatomy & Biomechanics</span>
          <span style="font-size: 0.68rem; color: var(--accent-gold);">10 HOTSPOTS</span>
        </div>
        <div class="hotspot-list" id="hotspot-list">
          <div class="hotspot-card active" data-spot="beak">
            <div class="hotspot-title">
              <span>1. Hooked Maxilla & Beak</span>
              <span>Keratin</span>
            </div>
            <div class="hotspot-desc">Arched culmen and downward-hooked tomia designed for tearing prey and defending territory.</div>
          </div>
          <div class="hotspot-card" data-spot="cere">
            <div class="hotspot-title">
              <span>2. Cere & Nares (Nostrils)</span>
              <span>Waxy Base</span>
            </div>
            <div class="hotspot-desc">Soft fleshy yellow saddle covering the base of maxilla with angled oval nares for high-speed airflow.</div>
          </div>
          <div class="hotspot-card" data-spot="brow">
            <div class="hotspot-title">
              <span>3. Supraorbital Ridge</span>
              <span>Cranial Brow</span>
            </div>
            <div class="hotspot-desc">Prominent bony brow shelf that creates the intense raptor gaze and shields eyes from direct sunlight glare.</div>
          </div>
          <div class="hotspot-card" data-spot="eyes">
            <div class="hotspot-title">
              <span>4. Dual-Fovea Raptor Eyes</span>
              <span>Acuity 20/5</span>
            </div>
            <div class="hotspot-desc">Piercing pale amber irises with deep pupils providing 340° peripheral awareness and 5x human visual acuity.</div>
          </div>
          <div class="hotspot-card" data-spot="primaries">
            <div class="hotspot-title">
              <span>5. Slotted Primaries (P7-P10)</span>
              <span>Emarginated</span>
            </div>
            <div class="hotspot-desc">Finger-like wingtip feathers that flex independently, dampening wingtip vortices and maximizing soaring lift.</div>
          </div>
          <div class="hotspot-card" data-spot="alula">
            <div class="hotspot-title">
              <span>6. Alula (Bastard Wing)</span>
              <span>Thumb Slot</span>
            </div>
            <div class="hotspot-desc">3 quill feathers on Digit I that deflect upwards during steep climbs to prevent aerodynamic stalls.</div>
          </div>
          <div class="hotspot-card" data-spot="keel">
            <div class="hotspot-title">
              <span>7. Pectoral Keel (Carina)</span>
              <span>Sternum</span>
            </div>
            <div class="hotspot-desc">Deep sternal keel ridge anchoring the massive pectoralis major muscles powering the flap cycle.</div>
          </div>
          <div class="hotspot-card" data-spot="rectrices">
            <div class="hotspot-title">
              <span>8. Wedge Fan Tail (Rectrices)</span>
              <span>12 Feathers</span>
            </div>
            <div class="hotspot-desc">Radiating rectrix fan serving as an aerodynamic pitch elevator, yaw rudder, and air brake during landings.</div>
          </div>
          <div class="hotspot-card" data-spot="hallux">
            <div class="hotspot-title">
              <span>9. Hallux Claw (Digit I)</span>
              <span>400+ PSI</span>
            </div>
            <div class="hotspot-desc">Heavy rear-facing opposable digit equipped with a 2-inch razor-curved talon delivering lethal piercing grip.</div>
          </div>
          <div class="hotspot-card" data-spot="scales">
            <div class="hotspot-title">
              <span>10. Scaled Tarsus (Anisodactyl)</span>
              <span>Armor Scutes</span>
            </div>
            <div class="hotspot-desc">Hexagonal reticulate scales and anterior scute plates protecting the metatarsus and foot pads.</div>
          </div>
        </div>
      </div>

      <!-- Screech Banner Indicator -->
      <div id="screech-indicator">🔊 RAPTOR SCREECH!</div>

      <!-- Bottom Animation Deck -->
      <div class="bottom-bar">
        <!-- Main Animation Selectors -->
        <div class="glass-panel anim-deck">
          <button class="anim-btn active" data-anim="flap">🦅 Wing Flap</button>
          <button class="anim-btn" data-anim="glide">🌬️ Soaring Glide</button>
          <button class="anim-btn" data-anim="walk">🐾 Ground Walk</button>
          <button class="anim-btn" data-anim="idle">🪺 Idle Perch</button>
          <button class="anim-btn" data-anim="screech">📢 Screech Cry</button>
          <button class="anim-btn" data-anim="head_turn">👀 Head Scan</button>
        </div>

        <!-- Playback & Secondary Controls -->
        <div class="glass-panel playback-controls">
          <button class="play-pause-btn" id="btn-play-pause" title="Play/Pause">⏸️</button>
          
          <div class="slider-group">
            <span>Speed:</span>
            <input type="range" id="speed-slider" min="0.1" max="2.0" step="0.05" value="1.0">
            <span id="speed-val" style="font-family: var(--font-mono); width: 32px;">1.0x</span>
          </div>

          <div class="slider-group" style="margin-left: 8px;">
            <span>Wind Flex:</span>
            <input type="range" id="wind-slider" min="0" max="2.5" step="0.1" value="1.0">
          </div>

          <div class="slider-group" style="margin-left: 8px;">
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="check-breath" checked> Breathing
            </label>
          </div>

          <div class="slider-group" style="margin-left: 8px;">
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="check-stabilize" checked> Head Lock
            </label>
          </div>
        </div>
      </div>

      <!-- Export Modal Overlay -->
      <div class="modal-overlay" id="export-modal">
        <div class="glass-panel modal-card">
          <div class="modal-title">
            <span>📥 Export 3D Eagle Asset</span>
            <button id="btn-close-modal" style="background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer;">✕</button>
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
            Download the production-ready 3D Eagle asset complete with high-res PBR textures, skeletal rig, and all 6 biomechanical animation cycles (Flap, Glide, Walk, Idle, Screech, Head Turn) ready for Unreal Engine 5, Unity, Blender, or Maya.
          </p>

          <div class="export-btn-group">
            <button class="download-btn" id="btn-download-glb">
              <span>📦 Download Animated GLB (.glb)</span>
              <span style="font-size: 0.72rem; opacity: 0.8;">Standard PBR + Rig + 6 Clips</span>
            </button>
            <button class="download-btn secondary" id="btn-download-obj">
              <span>📐 Download Wavefront OBJ (.obj)</span>
              <span style="font-size: 0.72rem; opacity: 0.8;">Static High-Res Mesh</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  bindEvents() {
    // Plumage selector
    document.querySelectorAll('[data-plumage]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-plumage]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const key = btn.dataset.plumage;
        this.app.setPlumage(key);

        const preset = EAGLE_PLUMAGE_PRESETS[key];
        if (preset) {
          document.getElementById('species-name').textContent = preset.name;
          document.getElementById('species-desc').textContent = preset.description;
        }
      });
    });

    // Animation selector
    document.querySelectorAll('[data-anim]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const anim = btn.dataset.anim;
        this.app.playAnimation(anim);
      });
    });

    // Camera preset buttons
    document.querySelectorAll('[data-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cam]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.app.setCameraPreset(btn.dataset.cam);
      });
    });

    // Wireframe toggle
    const btnWire = document.getElementById('btn-wireframe');
    btnWire.addEventListener('click', () => {
      const active = btnWire.classList.toggle('active');
      this.app.setWireframe(active);
    });

    // Skeleton visualizer toggle
    const btnSkel = document.getElementById('btn-skeleton');
    btnSkel.addEventListener('click', () => {
      const active = btnSkel.classList.toggle('active');
      this.app.setSkeletonVisible(active);
    });

    // Lighting preset toggle
    const btnLight = document.getElementById('btn-light');
    let lightMode = 0;
    const lightNames = ['☀️ Sky', '🌅 Sunset', '🌑 Dark Studio', '🌲 Forest'];
    btnLight.addEventListener('click', () => {
      lightMode = (lightMode + 1) % 4;
      btnLight.textContent = lightNames[lightMode];
      this.app.setEnvironment(lightMode);
    });

    // Audio toggle
    const btnAudio = document.getElementById('btn-audio-mute');
    let isMuted = false;
    btnAudio.addEventListener('click', () => {
      isMuted = !isMuted;
      btnAudio.textContent = isMuted ? '🔇 Muted' : '🔊 Audio';
      btnAudio.classList.toggle('active', !isMuted);
      this.app.audio.setMuted(isMuted);
    });

    // Play/Pause button
    const btnPlay = document.getElementById('btn-play-pause');
    btnPlay.addEventListener('click', () => {
      const paused = this.app.togglePlayPause();
      btnPlay.textContent = paused ? '▶️' : '⏸️';
    });

    // Speed slider
    const speedSlider = document.getElementById('speed-slider');
    const speedVal = document.getElementById('speed-val');
    speedSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      speedVal.textContent = val.toFixed(2) + 'x';
      this.app.setPlaybackSpeed(val);
    });

    // Wind flex slider
    const windSlider = document.getElementById('wind-slider');
    windSlider.addEventListener('input', (e) => {
      this.app.animations.secondaryMotion.windIntensity = parseFloat(e.target.value);
    });

    // Checkboxes
    document.getElementById('check-breath').addEventListener('change', (e) => {
      this.app.animations.secondaryMotion.breathingEnabled = e.target.checked;
    });

    document.getElementById('check-stabilize').addEventListener('change', (e) => {
      this.app.animations.secondaryMotion.headStabilization = e.target.checked;
    });

    // Hotspots sidebar cards
    document.querySelectorAll('[data-spot]').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('[data-spot]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.app.focusHotspot(card.dataset.spot);
      });
    });

    // Export modal triggers
    const modal = document.getElementById('export-modal');
    document.getElementById('btn-export-modal').addEventListener('click', () => {
      modal.classList.add('open');
    });

    document.getElementById('btn-close-modal').addEventListener('click', () => {
      modal.classList.remove('open');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });

    // Export GLB & OBJ
    document.getElementById('btn-download-glb').addEventListener('click', () => {
      this.app.exporter.exportGLB();
    });

    document.getElementById('btn-download-obj').addEventListener('click', () => {
      this.app.exporter.exportOBJ();
    });
  }

  showScreechBanner() {
    const el = document.getElementById('screech-indicator');
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
    }, 1200);
  }
}
