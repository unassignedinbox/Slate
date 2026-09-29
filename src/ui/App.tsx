import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Engine } from './engine';
import { ViewportPanel } from './viewport/ViewportPanel';
import { NodeEditor } from '../ui/editor/NodeEditor';
import { useThumbs } from './thumbs';
import { Icon } from './icons';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [split, setSplit] = useState(0.46);
  const splitting = useRef(false);

  const buildToken = useStore((s) => s.buildToken);
  const pinned = useStore((s) => s.pinned);
  const setThumb = useThumbs((s) => s.set);

  // ---- create the engine once the canvas exists
  useEffect(() => {
    if (!canvasRef.current) return;
    let e: Engine | null = null;
    try {
      e = new Engine(canvasRef.current);
    } catch (err: any) {
      setInitError(String(err?.message ?? err));
      return;
    }
    const st = useStore.getState();
    e.renderer.shading = st.shading;
    e.renderer.camera.frame(st.doc.settings.worldSize, st.doc.settings.heightScale);
    e.renderer.start();
    setEngine(e);
    useStore.getState().requestBuild();
    return () => { e?.dispose(); };
  }, []);

  // ---- rebuild on demand (debounced)
  useEffect(() => {
    if (!engine) return;
    const st = useStore.getState();
    if (!st.autoBuild && buildToken === 0) return;
    const timer = setTimeout(() => {
      const s = useStore.getState();
      s.setStatus('building', 0, 'Preparing');
      engine.build(s.doc, s.pinned, {
        onProgress: (f, label) => useStore.getState().setStatus('building', f, label),
        onThumbnail: (id, data) => setThumb(id, data),
        onDone: (res) => {
          const cur = useStore.getState();
          cur.setBuildResultMeta(res.issues, res.ms);
          cur.setStatus(res.issues.some((i) => i.severity === 'error') ? 'error' : 'done', 1, 'Built');
        },
        // A build that throws is a graph/GPU problem, not a dead session: report
        // it through the normal issue channel and let the next edit try again.
        onFatal: (msg) => {
          const cur = useStore.getState();
          cur.setBuildResultMeta([{ nodeId: '', nodeTitle: 'Build', message: msg, severity: 'error' }], 0);
          cur.setStatus('error', 1, 'Build failed');
          engine.clearFatal();
        },
      });
    }, 130);
    return () => clearTimeout(timer);
  }, [engine, buildToken, pinned, setThumb]);

  // ---- splitter
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!splitting.current) return;
      const f = Math.min(0.8, Math.max(0.2, e.clientX / window.innerWidth));
      setSplit(f);
    };
    const up = () => { splitting.current = false; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  useEffect(() => {
    engine?.renderer.invalidate();
  }, [split, engine]);

  if (initError) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="modal" style={{ width: 460 }}>
          <div className="modal-head">
            <span style={{ color: 'var(--err)' }}><Icon name="alert" size={16} /></span>
            <span className="modal-title">GPU initialisation failed</span>
          </div>
          <div className="modal-body">
            <div className="hint" style={{ fontSize: 12 }}>
              {initError}
              <br /><br />
              Slate needs WebGL 2 with <code>EXT_color_buffer_float</code> for floating-point
              render targets. Try a desktop Chrome, Edge or Firefox with hardware acceleration
              enabled.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="pane pane-viewport" style={{ width: `${split * 100}%`, flex: `0 0 ${split * 100}%` }}>
        <ViewportPanel canvasRef={canvasRef} engine={engine} />
      </div>
      <div
        className="splitter"
        onPointerDown={() => { splitting.current = true; document.body.style.cursor = 'col-resize'; }}
      />
      <div className="pane pane-editor">
        <NodeEditor />
      </div>
    </div>
  );
}
