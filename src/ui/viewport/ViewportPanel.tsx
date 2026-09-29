import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { makeDefaultGraph } from '../../state/defaultGraph';
import { Icon } from '../icons';
import type { Engine } from '../engine';

function MiniSlider({
  label, value, min, max, step = 1, unit, onChange, width = 74,
}: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange(v: number): void; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="mini-slider">
      <label>{label}</label>
      <div
        className="mini-track"
        ref={ref}
        style={{ width }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !ref.current) return;
          const w = ref.current.clientWidth;
          const dv = ((e.clientX - drag.current.x) / w) * (max - min);
          const nv = Math.min(max, Math.max(min, Math.round((drag.current.v + dv) / step) * step));
          onChange(Number(nv.toFixed(4)));
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <div className="mini-fill" style={{ width: `${pct}%` }} />
        <div className="mini-knob" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
      <span className="mini-val">{step >= 1 ? Math.round(value) : value.toFixed(2)}{unit}</span>
    </div>
  );
}

export function ViewportPanel({
  canvasRef, engine,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  engine: Engine | null;
}) {
  const shading = useStore((s) => s.shading);
  const setShading = useStore((s) => s.setShading);
  const status = useStore((s) => s.status);
  const issues = useStore((s) => s.issues);
  const settings = useStore((s) => s.doc.settings);
  const pinned = useStore((s) => s.pinned);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const loadDoc = useStore((s) => s.loadDoc);
  const [stats, setStats] = useState({ fps: 0, res: '' });
  const [shadeMenu, setShadeMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!engine) return;
    engine.renderer.onStats = (fps, res) => setStats({ fps, res });
    engine.renderer.shading = shading;
    engine.renderer.invalidate();
  }, [engine, shading]);

  // ---- camera interaction
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !engine) return;
    let mode: 'none' | 'orbit' | 'pan' = 'none';
    let lx = 0;
    let ly = 0;

    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      mode = e.button === 1 || e.shiftKey || e.button === 2 ? 'pan' : 'orbit';
      lx = e.clientX; ly = e.clientY;
      engine.renderer.markMoving();
    };
    const move = (e: PointerEvent) => {
      if (mode === 'none') return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'orbit') engine.renderer.camera.orbit(dx, dy);
      else engine.renderer.camera.pan(dx, dy, engine.lastResult?.settings.worldSize ?? 4096);
      engine.renderer.markMoving();
    };
    const up = () => { mode = 'none'; engine.renderer.invalidate(); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      engine.renderer.camera.zoom(e.deltaY);
      engine.renderer.markMoving();
    };
    const ctx = (e: Event) => e.preventDefault();

    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', ctx);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('contextmenu', ctx);
    };
  }, [engine, canvasRef]);

  const errCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;

  const save = () => {
    const blob = new Blob([useStore.getState().serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'terrain.slate.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const snapshot = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'slate-viewport.png';
    a.click();
  };

  const exportHeight = () => {
    if (!engine) return;
    const r = engine.readHeight();
    if (!r) return;
    // 16-bit PNG is awkward in-browser; emit a raw .r32 with a sidecar name
    const blob = new Blob([new Uint8Array(r.data.buffer as ArrayBuffer)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `heightmap_${r.size}x${r.size}_float32.raw`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <canvas ref={canvasRef} className="viewport-canvas" />

      {/* top toolbar */}
      <div className="vp-top">
        <div className="pill">
          <button className="iconbtn" title="New graph" onClick={() => { if (confirm('Discard the current graph?')) loadDoc(makeDefaultGraph()); }}>
            <Icon name="filePlus" size={15} />
          </button>
          <button className="iconbtn" title="Save .json" onClick={save}><Icon name="save" size={15} /></button>
          <button className="iconbtn" title="Open .json" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /></button>
          <div className="pill-sep" />
          <button className="iconbtn" title="Undo" disabled={!past.length} onClick={undo}><Icon name="undo" size={15} /></button>
          <button className="iconbtn" title="Redo" disabled={!future.length} onClick={redo}><Icon name="redo" size={15} /></button>
          <div className="pill-sep" />
          <button
            className={`iconbtn${engine?.lastResult?.volume ? ' on' : ''}`}
            title={engine?.lastResult?.volume ? 'Cave volume active' : 'No cave volume connected'}
          >
            <Icon name="cube" size={15} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className={`iconbtn${shadeMenu ? ' on' : ''}`} title="Shading mode" onClick={() => setShadeMenu((v) => !v)}>
              <Icon name="monitor" size={15} />
            </button>
            {shadeMenu && (
              <div className="menu fade-in" style={{ top: 34, left: -80 }} onMouseLeave={() => setShadeMenu(false)}>
                <div className="menu-label">Shading</div>
                {(['shaded', 'albedo', 'normals', 'height'] as const).map((m) => (
                  <button key={m} className={`menu-row${shading.shadeMode === m ? ' sel' : ''}`} onClick={() => { setShading({ shadeMode: m }); setShadeMenu(false); }}>
                    {m[0].toUpperCase() + m.slice(1)}
                    {shading.shadeMode === m && <span className="right"><Icon name="check" size={14} /></span>}
                  </button>
                ))}
                <div className="menu-div" />
                <div className="menu-row" style={{ cursor: 'default' }}>Shadows<span className="right"><button className={`toggle${shading.shadows ? ' on' : ''}`} onClick={() => setShading({ shadows: !shading.shadows })} /></span></div>
                <div className="menu-row" style={{ cursor: 'default' }}>Ambient Occlusion<span className="right"><button className={`toggle${shading.ao ? ' on' : ''}`} onClick={() => setShading({ ao: !shading.ao })} /></span></div>
                <div className="menu-row" style={{ cursor: 'default' }}>Contours<span className="right"><button className={`toggle${shading.contours ? ' on' : ''}`} onClick={() => setShading({ contours: !shading.contours })} /></span></div>
              </div>
            )}
          </div>
          <button className={`iconbtn${shading.water ? ' on' : ''}`} title="Water" onClick={() => setShading({ water: !shading.water })}>
            <Icon name="image" size={15} />
          </button>
          <button className="iconbtn" title="Save viewport PNG" onClick={snapshot}><Icon name="camera" size={15} /></button>
          <button className="iconbtn" title="Export heightmap (raw float32)" onClick={exportHeight}><Icon name="download" size={15} /></button>
          <span className="pill-label">{pinned ? 'Preview ·' : ''} Untitled {past.length ? '*' : ''}</span>
          <button
            className="iconbtn danger"
            title="Cancel build"
            disabled={status !== 'building'}
            onClick={() => engine?.cancel()}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const j = JSON.parse(await f.text());
              if (j.nodes && j.edges && j.settings) loadDoc({ nodes: j.nodes, edges: j.edges, settings: j.settings });
            } catch { alert('Could not read that file.'); }
            e.target.value = '';
          }}
        />
      </div>

      {/* left rail — viewport tools */}
      <div className="vp-rail">
        <button className="iconbtn accent on" title="Orbit (drag)"><Icon name="circleDashed" size={15} /></button>
        <button className="iconbtn" title="Frame terrain" onClick={() => { engine?.renderer.camera.frame(settings.worldSize, settings.heightScale); engine?.renderer.invalidate(); }}>
          <Icon name="search" size={15} />
        </button>
        <div className="sep" />
        <button className="iconbtn" title="Top view" onClick={() => { if (!engine) return; engine.renderer.camera.pitch = 1.48; engine.renderer.camera.yaw = -Math.PI / 2; engine.renderer.invalidate(); }}>
          <Icon name="grid" size={15} />
        </button>
        <button className="iconbtn" title="Front view" onClick={() => { if (!engine) return; engine.renderer.camera.pitch = 0.08; engine.renderer.camera.yaw = -Math.PI / 2; engine.renderer.invalidate(); }}>
          <Icon name="monitor" size={15} />
        </button>
        <button className="iconbtn" title="Side view" onClick={() => { if (!engine) return; engine.renderer.camera.pitch = 0.08; engine.renderer.camera.yaw = 0; engine.renderer.invalidate(); }}>
          <Icon name="cube" size={15} />
        </button>
        <div className="sep" />
        <button className={`iconbtn${shading.grid ? ' on' : ''}`} title="Reference grid" onClick={() => setShading({ grid: !shading.grid })}>
          <Icon name="scan" size={15} />
        </button>
        <button className={`iconbtn${shading.shadows ? ' on' : ''}`} title="Shadows" onClick={() => setShading({ shadows: !shading.shadows })}>
          <Icon name="shield" size={15} />
        </button>
        <button className={`iconbtn${shading.ao ? ' on' : ''}`} title="Ambient occlusion" onClick={() => setShading({ ao: !shading.ao })}>
          <Icon name="mask" size={15} />
        </button>
        <button className={`iconbtn${shading.contours ? ' on' : ''}`} title="Contour lines" onClick={() => setShading({ contours: !shading.contours })}>
          <Icon name="layers" size={15} />
        </button>
      </div>

      {/* badges */}
      <div className="vp-badge">
        <div className="badge">{settings.resolution}² · {(settings.worldSize / 1000).toFixed(1)} km · {(settings.worldSize / settings.resolution).toFixed(1)} m/px</div>
        {engine?.lastResult?.volume && <div className="badge accent">caves {settings.volumeResolution}³</div>}
        {pinned && <div className="badge accent">previewing node</div>}
        {errCount > 0 && <div className="badge err">{errCount} error{errCount > 1 ? 's' : ''}</div>}
        {warnCount > 0 && <div className="badge warn">{warnCount} warning{warnCount > 1 ? 's' : ''}</div>}
      </div>

      {/* bottom bar */}
      <div className="vp-bottom">
        <MiniSlider label="Sun" value={shading.sunAzimuth} min={-180} max={180} step={1} unit="°" onChange={(v) => setShading({ sunAzimuth: v })} />
        <MiniSlider label="Alt" value={shading.sunElevation} min={2} max={88} step={1} unit="°" onChange={(v) => setShading({ sunElevation: v })} />
        <MiniSlider label="Light" value={shading.sunIntensity} min={0} max={6} step={0.05} onChange={(v) => setShading({ sunIntensity: v })} />
        <MiniSlider label="Ambient" value={shading.ambient} min={0} max={2} step={0.02} onChange={(v) => setShading({ ambient: v })} />
        <MiniSlider label="Fog" value={shading.fog} min={0} max={3} step={0.02} onChange={(v) => setShading({ fog: v })} />
        <MiniSlider label="Quality" value={shading.quality} min={0.25} max={1} step={0.05} onChange={(v) => setShading({ quality: v })} />
        <select className="vp-select" value={shading.shadeMode} onChange={(e) => setShading({ shadeMode: e.target.value as any })}>
          <option value="shaded">Shaded</option>
          <option value="albedo">Albedo</option>
          <option value="normals">Normals</option>
          <option value="height">Height</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--txt-4)', whiteSpace: 'nowrap' }}>
          {stats.res} · {stats.fps.toFixed(0)} fps
        </span>
      </div>
    </>
  );
}
