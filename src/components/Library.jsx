import React, { useState } from 'react';
import {
  Search,
  LayoutGrid,
  ListTree,
  ChevronDown,
  ChevronRight,
  Plus,
  Globe2,
  ArrowUpRight,
  FolderOpen,
  Eye,
  EyeOff,
  Layers3,
  Sparkles,
  X,
  ChevronsUp,
  ChevronsDown,
  SlidersHorizontal,
  TrainFront,
  Network,
  Route,
  Columns3,
} from 'lucide-react';
import {
  ROAD_PRESETS,
  STRUCTURE_PRESETS,
  DETAILS,
  networkStats,
  isBridgePreset,
} from '../lib/network.js';
import { RoadThumbnail, DetailThumbnail } from './Thumbnails.jsx';

export default function Library({
  network,
  selectedId,
  activePreset,
  onPresetSelect,
  onSelect,
  onGenerate,
  onVisibility,
  tab,
  onTabChange,
  selectedPropId,
  onSelectProp,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [expanded, setExpanded] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const stats = networkStats(network);
  const presets = [...ROAD_PRESETS, ...STRUCTURE_PRESETS].filter(
    (p) =>
      (category === 'All' ||
        (category === 'Bridges'
          ? isBridgePreset(p)
          : category === 'Roads'
            ? !isBridgePreset(p) && !p.template
            : p.category === category)) &&
      `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  const shown = query || category !== 'All' || expanded ? presets : presets.slice(0, 6);
  const groups = [
    { name: 'Arterials & boulevards', types: ['arterial', 'boulevard'] },
    { name: 'Local streets', types: ['local', 'service', 'rural'] },
    { name: 'Highways & structures', types: ['highway', 'bridge', 'ramp', 'roundabout'] },
    { name: 'Railways & metro', types: ['railway', 'subway'] },
    { name: 'Pathways', types: ['path'] },
  ];
  return (
    <aside className="library-panel">
      <div className="panel-heading">
        <span>
          {tab === 'Library' ? 'Road library' : 'Scene hierarchy'}
          <small>
            {tab === 'Library'
              ? String(ROAD_PRESETS.length + STRUCTURE_PRESETS.length).padStart(2, '0')
              : stats.segments}
          </small>
        </span>
        <button
          aria-label="Draw a road"
          className="icon-button"
          onClick={() => onPresetSelect(activePreset)}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="library-tabs">
        {[
          { name: 'Library', icon: LayoutGrid },
          { name: 'Scene', icon: ListTree },
        ].map((t) => (
          <button
            className={tab === t.name ? 'active' : ''}
            key={t.name}
            onClick={() => onTabChange(t.name)}
          >
            <t.icon size={13} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="library-search">
        <Search size={13} />
        <input
          aria-label={tab === 'Library' ? 'Search road presets' : 'Search scene roads'}
          placeholder={tab === 'Library' ? 'Search road types…' : 'Find in scene…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={12} />
          </button>
        ) : (
          <span>⌘ K</span>
        )}
      </div>
      {tab === 'Library' && (
        <div className="category-filters">
          {['All', 'Urban', 'Highways'].map((c) => (
            <button
              key={c}
              className={category === c ? 'active' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
          <div className="relative">
            <button
              className={
                ['Bridges', 'Junctions', 'Rural', 'Structures', 'Railways', 'Paths'].includes(
                  category,
                )
                  ? 'active'
                  : ''
              }
              aria-label="More road categories"
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <SlidersHorizontal size={12} />
            </button>
            {filterOpen && (
              <div className="dropdown-menu category-menu">
                {['Bridges', 'Junctions', 'Rural', 'Structures', 'Railways', 'Paths'].map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCategory(c);
                      setFilterOpen(false);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'Library' && (
        <div className="catalog-collections" aria-label="Road and bridge collections">
          <button
            aria-label="Browse road profiles"
            className={category === 'Roads' ? 'active' : ''}
            onClick={() => {
              setQuery('');
              setCategory('Roads');
            }}
          >
            <Route size={16} />
            <div>
              <strong>
                Road profiles <span>+24</span>
              </strong>
              <small>{ROAD_PRESETS.filter((p) => !isBridgePreset(p)).length} configurations</small>
            </div>
          </button>
          <button
            aria-label="Browse bridge designs"
            className={category === 'Bridges' ? 'active' : ''}
            onClick={() => {
              setQuery('');
              setCategory('Bridges');
            }}
          >
            <Columns3 size={16} />
            <div>
              <strong>
                Bridges <span>+12</span>
              </strong>
              <small>{ROAD_PRESETS.filter(isBridgePreset).length} designs</small>
            </div>
          </button>
        </div>
      )}
      {tab === 'Library' && (
        <div className="infrastructure-shortcuts" aria-label="Infrastructure tools">
          <button
            className={activePreset === 'railway' ? 'active' : ''}
            onClick={() => onPresetSelect('railway')}
            title="Draw continuous train tracks"
          >
            <TrainFront size={15} />
            <span>Railway</span>
          </button>
          <button
            className={activePreset === 'bridge' ? 'active' : ''}
            onClick={() => onPresetSelect('bridge')}
            title="Draw a road overpass"
          >
            <Route size={15} />
            <span>Overpass</span>
          </button>
          <button
            className={activePreset === 'cloverleaf' ? 'active' : ''}
            onClick={() => onPresetSelect('cloverleaf')}
            title="Place a connected cloverleaf interchange"
          >
            <Network size={15} />
            <span>Cloverleaf</span>
          </button>
          {[
            { id: 'diamond', label: 'Diamond', title: 'Place a connected diamond interchange' },
            {
              id: 'tjunction',
              label: 'T-junction',
              title: 'Attach a branch to an existing street',
            },
            {
              id: 'ymerge',
              label: 'Y merge',
              title: 'Attach a tangent entry ramp to an existing road',
            },
          ].map((p) => (
            <button
              key={p.id}
              className={activePreset === p.id ? 'active' : ''}
              onClick={() => onPresetSelect(p.id)}
              title={p.title}
            >
              <Network size={15} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="library-scroll">
        {tab === 'Library' ? (
          <>
            <div className="library-section-caption">
              <span>
                {category === 'All'
                  ? 'ROAD & BRIDGE PRESETS'
                  : category === 'Bridges'
                    ? 'BRIDGE DESIGNS'
                    : `${category.toUpperCase()} PROFILES`}
              </span>
              <span>{presets.length} types</span>
            </div>
            <div className="preset-list">
              {shown.map((p) => (
                <button
                  className={`preset-card ${p.id === activePreset ? 'selected' : ''}`}
                  key={p.id}
                  onClick={() => onPresetSelect(p.id)}
                >
                  <div className="preset-image">
                    <RoadThumbnail type={p.id} />
                  </div>
                  <div className="preset-copy">
                    <strong>{p.name}</strong>
                    <span>{p.description}</span>
                    {p.id === activePreset && (
                      <small>{p.template ? 'CONNECTED TEMPLATE' : 'SELECTED PRESET'}</small>
                    )}
                  </div>
                  <ChevronRight size={13} className="preset-arrow" />
                </button>
              ))}
            </div>
            {shown.length === 0 && (
              <div className="library-empty">
                <Search size={20} />
                <span>No matching road types.</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setCategory('All');
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            {presets.length > 6 && !query && category === 'All' && (
              <button className="browse-presets" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show fewer presets' : 'Browse all road types'}
                {expanded ? <ChevronDown size={12} /> : <ArrowUpRight size={12} />}
              </button>
            )}
            <div className="library-tip">
              <div className="library-tip-symbol">
                <SplineIcon />
              </div>
              <p>
                Every road starts with a spline.
                <br />
                <span>Choose a preset, then draw in the viewport.</span>
              </p>
            </div>
          </>
        ) : (
          <div className="scene-tree">
            <div className="scene-root">
              <Globe2 size={14} />
              <strong>{network.name}</strong>
              <span>{stats.segments}</span>
            </div>
            {groups.map((g) => {
              const roads = network.roads.filter(
                (r) =>
                  g.types.includes(r.type) && r.name.toLowerCase().includes(query.toLowerCase()),
              );
              if (!roads.length) return null;
              return (
                <div className="tree-group" key={g.name}>
                  <button
                    className="tree-group-title"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}
                  >
                    {collapsed[g.name] ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <FolderOpen size={13} />
                    <span>{g.name}</span>
                    <small>{roads.length}</small>
                  </button>
                  {!collapsed[g.name] &&
                    roads.map((r) => (
                      <div
                        className={`scene-road ${r.id === selectedId ? 'selected' : ''} ${r.hidden ? 'hidden' : ''}`}
                        key={r.id}
                      >
                        <button onClick={() => onSelect(r.id)}>
                          <span className={`tree-road-dot ${r.type}`} />
                          <span>{r.name}</span>
                        </button>
                        <button
                          aria-label={`${r.hidden ? 'Show' : 'Hide'} ${r.name}`}
                          title={r.hidden ? 'Show road' : 'Hide road'}
                          onClick={() => onVisibility(r.id)}
                        >
                          {r.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
            {network.props.length > 0 && (
              <div className="tree-group">
                <button
                  className="tree-group-title"
                  onClick={() => setCollapsed((c) => ({ ...c, details: !c.details }))}
                >
                  {collapsed.details ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  <Layers3 size={13} />
                  <span>Placed details</span>
                  <small>{network.props.length}</small>
                </button>
                {!collapsed.details &&
                  network.props
                    .filter((p) =>
                      (DETAILS.find((d) => d.id === p.type)?.name || '')
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((p, i) => (
                      <div
                        className={`scene-road ${selectedPropId === p.id ? 'selected' : ''}`}
                        key={p.id}
                      >
                        <button onClick={() => onSelectProp(p.id)}>
                          <span className="tree-road-dot detail" />
                          <span>
                            {DETAILS.find((d) => d.id === p.type)?.name}{' '}
                            {String(i + 1).padStart(2, '0')}
                          </span>
                        </button>
                      </div>
                    ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="library-bottom">
        <div className="world-caption">
          <span className="eyebrow">YOUR WORLD</span>
          <button title="Generate a new city" aria-label="Generate a new city" onClick={onGenerate}>
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="world-card">
          <div className="world-icon">
            <Globe2 size={20} />
          </div>
          <div>
            <strong>{network.name}</strong>
            <span>
              {(network.size / 1000).toFixed(1)} × {(network.size / 1000).toFixed(1)} km world
            </span>
          </div>
          <span className="live-dot" />
        </div>
        <button className="generate-network" onClick={onGenerate}>
          <Sparkles size={13} />
          Generate a city
          <ChevronRight size={13} />
        </button>
      </div>
    </aside>
  );
}

function SplineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 19C6 4 18 20 20 5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="17.5" width="3" height="3" rx=".5" stroke="currentColor" />
      <rect x="18.5" y="3.5" width="3" height="3" rx=".5" stroke="currentColor" />
    </svg>
  );
}

export function AssetTray({ activeDetail, onSelect, expanded, onExpand }) {
  const [filter, setFilter] = useState('All details');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const assets = DETAILS.filter(
    (d) =>
      (filter === 'All details' || d.category === filter) &&
      d.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className={`asset-tray ${expanded ? 'expanded' : ''}`} aria-label="Detail library">
      <div className="asset-tray-heading">
        <div>
          <Layers3 size={13} />
          <span>Detail library</span>
          <small>Click an asset to place it</small>
        </div>
        <span className="asset-count">{DETAILS.length} assets</span>
        <button
          className="icon-button"
          aria-label="Search street details"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search size={13} />
        </button>
        <button
          className="icon-button"
          title={expanded ? 'Collapse detail library' : 'Expand detail library'}
          aria-label="Expand detail library"
          onClick={onExpand}
        >
          {expanded ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
        </button>
      </div>
      <div className="asset-filter-row">
        {['All details', 'Markings', 'Street furniture', 'Infrastructure'].map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        {searchOpen && (
          <input
            aria-label="Search details"
            placeholder="Find an asset…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        )}
      </div>
      <div className="asset-list">
        {assets.map((d) => (
          <button
            key={d.id}
            className={`asset-card ${activeDetail?.id === d.id ? 'selected' : ''}`}
            onClick={() => onSelect(d)}
          >
            <div className="asset-image">
              <DetailThumbnail type={d.id} />
              <span className="asset-add">
                <Plus size={11} />
              </span>
            </div>
            <span>{d.name}</span>
          </button>
        ))}
        {assets.length === 0 && <div className="asset-no-results">No matching details.</div>}
      </div>
    </section>
  );
}
