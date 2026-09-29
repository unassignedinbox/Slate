import React, { useEffect, useMemo, useRef, useState } from 'react';
import { allNodeDefs, CATEGORY_META, type CategoryId, type NodeDef } from '../../core/graph/types';
import { Icon } from '../icons';

const ORDER: CategoryId[] = ['generators', 'shape', 'erosion', 'analysis', 'texturing', 'volume', 'output'];

export function AddPalette({
  x, y, onPick, onClose,
}: {
  x: number;
  y: number;
  onPick(type: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<CategoryId>>(new Set(['generators']));
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const all = useMemo(() => allNodeDefs().filter((d) => d.type !== 'output'), []);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const score = (d: NodeDef) => {
      const t = d.title.toLowerCase();
      const s = d.subtitle.toLowerCase();
      const k = (d.keywords ?? []).join(' ').toLowerCase();
      if (t.startsWith(q)) return 0;
      if (t.includes(q)) return 1;
      if (k.includes(q)) return 2;
      if (s.includes(q)) return 3;
      return 99;
    };
    return all.map((d) => ({ d, s: score(d) })).filter((r) => r.s < 99).sort((a, b) => a.s - b.s).map((r) => r.d);
  }, [q, all]);

  useEffect(() => { setActive(0); }, [q]);

  const byCat = useMemo(() => {
    const m = new Map<CategoryId, NodeDef[]>();
    for (const d of all) {
      if (!m.has(d.category)) m.set(d.category, []);
      m.get(d.category)!.push(d);
    }
    return m;
  }, [all]);

  const toggle = (c: CategoryId) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!matches) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter' && matches[active]) { e.preventDefault(); onPick(matches[active].type); }
  };

  return (
    <div className="palette fade-in" style={{ left: x, top: y }} ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="palette-search"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="palette-list">
        {matches ? (
          matches.length === 0 ? (
            <div className="hint">No nodes match “{query}”.</div>
          ) : (
            matches.map((d, i) => (
              <button
                key={d.type}
                className={`item-row${i === active ? ' active' : ''}`}
                style={{ paddingLeft: 10 }}
                onClick={() => onPick(d.type)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="cat-icon" style={{ color: CATEGORY_META[d.category].accent }}>
                  <Icon name={d.icon} size={14} />
                </span>
                <span className="item-main">
                  <span className="item-title">{d.title}</span>
                  <span className="item-sub">{d.subtitle}</span>
                </span>
                <span className="item-add"><Icon name="plus" size={13} /></span>
              </button>
            ))
          )
        ) : (
          ORDER.map((cat) => {
            const items = byCat.get(cat);
            if (!items?.length) return null;
            const meta = CATEGORY_META[cat];
            const isOpen = open.has(cat);
            return (
              <div key={cat}>
                <button className="cat-row" onClick={() => toggle(cat)}>
                  <span className="cat-icon" style={{ color: meta.accent }}><Icon name={meta.icon} size={15} /></span>
                  {meta.label}
                  <span className="cat-chev"><Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} /></span>
                </button>
                {isOpen &&
                  items.map((d) => (
                    <button key={d.type} className="item-row" onClick={() => onPick(d.type)}>
                      <span className="item-main">
                        <span className="item-title">{d.title}</span>
                        <span className="item-sub">{d.subtitle}</span>
                      </span>
                      <span className="item-add"><Icon name="plus" size={13} /></span>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
