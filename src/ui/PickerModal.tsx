// Shared "add something" modal: searchable tile grid with category rail.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CloseButton } from './controls';

export interface PickerItem {
  id: string;
  label: string;
  blurb: string;
  tags: string[];
  category: string;
  swatch?: string[];
  glyph?: React.ReactNode;
}

export default function PickerModal({
  title,
  items,
  onPick,
  onClose,
}: {
  title: string;
  items: PickerItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return [
      { name: 'All', count: items.length },
      ...[...counts.entries()].map(([name, count]) => ({ name, count })),
    ];
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'All' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.blurb.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, category]);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-label={title}>
        <div className="panel-head">
          <span className="emblem">{title}</span>
          <CloseButton onClick={onClose} label="Close" />
        </div>
        <div className="panel-body">
          <div className="panel-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search"
            />
          </div>
          <nav className="cat-nav">
            {categories.map((c) => (
              <button key={c.name} className={category === c.name ? 'active' : ''} onClick={() => setCategory(c.name)}>
                {c.name} <small>{c.count}</small>
              </button>
            ))}
          </nav>
          {visible.length === 0 ? (
            <p className="empty-note">Nothing here matches that.</p>
          ) : (
            <div className="tile-grid">
              {visible.map((item) => (
                <button key={item.id} className="tile" onClick={() => onPick(item.id)}>
                  <span
                    className="tile-emblem"
                    style={
                      item.swatch
                        ? { background: `linear-gradient(135deg, ${item.swatch.join(', ')})` }
                        : undefined
                    }
                  >
                    {item.glyph}
                  </span>
                  <strong>{item.label}</strong>
                  <span className="tile-tags">{item.tags.join(' · ')}</span>
                  <span className="muted">{item.blurb}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
