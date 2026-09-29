import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { useThumbs } from '../thumbs';
import { Icon } from '../icons';
import { Toggle } from './controls';

export function ViewSettings({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const background = useStore((s) => s.background);
  const canvasControls = useStore((s) => s.canvasControls);
  const setView = useStore((s) => s.setView);
  const autoBuild = useStore((s) => s.autoBuild);
  const setAutoBuild = useStore((s) => s.setAutoBuild);
  const thumbsOn = useThumbs((s) => s.enabled);
  const setThumbs = useThumbs((s) => s.setEnabled);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="menu fade-in" style={{ top: 44, right: 0 }} ref={ref}>
      <div className="menu-label">View</div>
      <div className="menu-row" style={{ cursor: 'default' }}>
        Canvas Controls
        <span className="right"><Toggle on={canvasControls} onChange={(v) => setView({ canvasControls: v })} /></span>
      </div>
      <div className="menu-row" style={{ cursor: 'default' }}>
        Node Previews
        <span className="right"><Toggle on={thumbsOn} onChange={setThumbs} /></span>
      </div>
      <div className="menu-row" style={{ cursor: 'default' }}>
        Auto Build
        <span className="right"><Toggle on={autoBuild} onChange={setAutoBuild} /></span>
      </div>

      <div className="menu-label">Background</div>
      <button className={`menu-row${background === 'dots' ? ' sel' : ''}`} onClick={() => setView({ background: 'dots' })}>
        Dotted Grid
        {background === 'dots' && <span className="right"><Icon name="check" size={14} /></span>}
      </button>
      <button className={`menu-row${background === 'blank' ? ' sel' : ''}`} onClick={() => setView({ background: 'blank' })}>
        Blank
        {background === 'blank' && <span className="right"><Icon name="check" size={14} /></span>}
      </button>
    </div>
  );
}
