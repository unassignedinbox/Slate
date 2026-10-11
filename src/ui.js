// Editor chrome: toolbar, outliner tree, inspector cards, status bar —
// laid out and styled after the Frontier ProjectZeroEditor prototype.
import { el, fmt, clamp } from './util.js';
import { svgIcon } from './icons.js';
import { PROFILES, layoutBands, BAND, TRAVEL, profileWidth } from './profiles.js';
import { PROP_KINDS } from './props.js';
import { propCollections, polylineLength } from './model.js';

export function buildShell(c) {
  const root = document.getElementById('app');
  root.className = 'shell';
  root.innerHTML = '';

  // ---------------- toolbar ----------------
  const toolBtn = (tool, icon, label, key) =>
    el('button', {
      class: 'tool-btn',
      dataset: { tool },
      onclick: () => c.setTool(tool),
    },
      el('span', { html: svgIcon(icon, 14) }),
      label,
      el('kbd', { text: key })
    );

  const speedReadout = el('b', { text: '26' });
  const toolbar = el('div', { class: 'toolbar' },
    el('div', { class: 'tool-group' },
      toolBtn('select', 'MousePointer2', 'Select', 'V'),
      toolBtn('draw', 'Spline', 'Draw Road', 'R'),
      toolBtn('prop', 'Cone', 'Place Prop', 'P'),
    ),
    el('div', { class: 'tool-sep' }),
    el('button', {
      class: 'tool-btn primary',
      onclick: () => c.openConstruct(),
    },
      el('span', { html: svgIcon('Construction', 14) }),
      'Construct',
      el('kbd', { text: 'K' })
    ),
    el('button', {
      class: 'tool-btn',
      onclick: () => c.generateCity(),
    },
      el('span', { html: svgIcon('Sparkles', 14) }),
      'Generate City',
      el('kbd', { text: 'G' })
    ),
    el('div', { class: 'tool-sep' }),
    el('button', { class: 'tool-btn', onclick: () => c.undo(), title: 'Undo' },
      el('span', { html: svgIcon('Undo2', 14) }), 'Undo'),
    el('button', { class: 'tool-btn', onclick: () => c.redo(), title: 'Redo' },
      el('span', { html: svgIcon('Redo2', 14) }), 'Redo'),
    (() => {
      const pills = el('div', { class: 'view-pills' });
      for (const [id, label] of [['lit', 'Lit'], ['classes', 'Classes'], ['wire', 'Wire'], ['subway', 'Subway X']]) {
        pills.append(el('button', {
          class: 'view-pill',
          dataset: { view: id },
          onclick: () => c.setViewMode(id),
          text: label,
        }));
      }
      return pills;
    })(),
    el('div', { class: 'cam-readout' },
      el('span', { html: svgIcon('Gauge', 13) }),
      'Speed', speedReadout, 'm/s'
    )
  );

  // ---------------- outliner ----------------
  const searchInput = el('input', {
    placeholder: 'Search scene…',
    oninput: (e) => {
      outlinerState.search = e.target.value;
      updateOutliner();
    },
  });

  const treeScroll = el('div', { class: 'outliner-scroll' });
  const sceneNameInput = el('input', {
    value: c.getSceneName(),
    onchange: (e) => c.setSceneName(e.target.value),
  });

  const outliner = el('aside', { class: 'outliner' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-symbol', html: svgIcon('Waypoints', 22) }),
      'slate', el('span', { class: 'brand-dot', text: '.' }),
      el('span', { class: 'version', text: 'ROAD EDITOR · V0.1' })
    ),
    el('div', { class: 'scene-label' },
      el('span', { text: 'SCENE' }),
      el('span', {}, el('i', { class: 'status-dot' }))
    ),
    el('div', { class: 'scene-title' }, sceneNameInput, el('span', { class: 'scene-extension', text: '.slate' })),
    el('div', { class: 'outliner-heading' },
      el('h2', {}, 'World outliner', el('span', { text: 'LIVE' })),
      el('button', {
        class: 'icon-button',
        title: 'Construct',
        html: svgIcon('Plus', 15),
        onclick: () => c.openConstruct(),
      })
    ),
    el('div', { class: 'search' },
      el('span', { html: svgIcon('Search', 13) }),
      searchInput,
      el('button', {
        class: 'search-clear',
        html: svgIcon('X', 12),
        onclick: () => {
          searchInput.value = '';
          outlinerState.search = '';
          updateOutliner();
        },
      })
    ),
    treeScroll,
    el('div', { class: 'outliner-bottom' },
      el('div', { class: 'world-icon', html: svgIcon('Layers', 16) }),
      el('div', {},
        el('strong', { text: 'World settings' }),
        el('span', { id: 'world-stats', text: '—' })
      ),
      el('i', { class: 'little-dot ok' })
    )
  );

  // ---------------- viewport ----------------
  const viewportEl = el('div', { class: 'viewport' },
    el('div', { class: 'viewport-toolbar' },
      el('div', { class: 'vp-chip' },
        el('i', { class: 'dot' }),
        el('span', { id: 'vp-tool-chip', html: '<b>Select</b> · click objects to inspect' })
      ),
      el('div', { class: 'vp-chip', id: 'vp-snap-chip' },
        el('span', { html: svgIcon('Grid3x3', 12) }),
        el('span', { html: 'Snap <b>5 m</b>' })
      )
    ),
    el('div', { class: 'viewport-hint' },
      el('span', {}, el('kbd', { text: 'RMB' }), 'look'),
      el('span', {}, el('kbd', { text: 'WASD' }), 'fly'),
      el('span', {}, el('kbd', { text: 'Q / E' }), 'down / up'),
      el('span', {}, el('kbd', { text: 'Shift' }), 'boost'),
      el('span', {}, el('kbd', { text: 'Scroll' }), 'speed'),
      el('span', {}, el('kbd', { text: 'Alt+LMB' }), 'orbit'),
      el('span', {}, el('kbd', { text: 'F' }), 'focus'),
      el('span', {}, el('kbd', { text: 'Del' }), 'delete'),
      el('span', {}, el('kbd', { text: 'K' }), 'construct')
    ),
    el('div', {
      class: 'axis-widget',
      id: 'axis-widget',
      html: axisSvg(),
    })
  );

  // ---------------- inspector ----------------
  const inspectorTop = el('div', { class: 'inspector-top', text: 'INSPECTOR' });
  const inspectorContent = el('div', { class: 'inspector-content' });
  const inspectorFooter = el('div', { class: 'inspector-footer' },
    el('span', { html: svgIcon('CircleDot', 11) }),
    el('span', { id: 'inspector-footer-text', text: 'Nothing selected' }),
    el('i', { class: 'status-dot' })
  );
  const inspector = el('aside', { class: 'inspector' },
    inspectorTop,
    inspectorContent,
    inspectorFooter
  );

  // ---------------- status bar ----------------
  const sbCoords = el('b', { text: '0.0 / 0.0' });
  const sbFps = el('b', { text: '60' });
  const sbTool = el('span', { class: 'sb-tool', text: 'SELECT' });
  const sbHint = el('span', { class: 'sb-hint', text: 'Ready' });
  const statusbar = el('div', { class: 'statusbar' },
    el('span', {}, 'Cursor ', sbCoords),
    el('span', {}, 'FPS ', sbFps),
    el('span', {}, 'Tool ', sbTool),
    el('span', {}, 'Snap ', el('b', { id: 'sb-snap', text: '5 m' })),
    sbHint
  );

  root.append(outliner, toolbar, viewportEl, inspector, statusbar);

  // toast stack
  const toastStack = el('div', { class: 'toast-stack' });
  document.body.append(toastStack);

  function toast(msg, kind = 'ok') {
    const t = el('div', { class: `toast ${kind}` },
      el('span', { html: svgIcon(kind === 'warn' ? 'Zap' : 'CircleDot', 14) }),
      msg
    );
    toastStack.append(t);
    setTimeout(() => t.remove(), 3800);
  }

  // ================= outliner rendering =================
  const outlinerState = { search: '', collapsed: new Set(), hidden: new Set() };

  function matches(name, kind) {
    const q = outlinerState.search.toLowerCase();
    if (!q) return true;
    return `${name} ${kind}`.toLowerCase().includes(q);
  }

  function treeRow({ id, name, kind, icon, iconColor, isHidden, selectable = true }) {
    const row = el('div', {
      class: `tree-row${c.getSelection() === id ? ' selected' : ''}${isHidden ? ' hidden-object' : ''}`,
      dataset: { id },
    },
      el('button', {
        class: 'object-button',
        onclick: () => selectable && c.select(id),
        ondblclick: () => c.focusSelected(),
      },
        el('span', { class: 'obj-icon', html: svgIcon(icon, 15), style: iconColor ? { color: iconColor } : null }),
        el('span', { class: 'obj-name', text: name }),
        kind ? el('span', { class: 'obj-kind', text: kind }) : null,
        el('i', { class: 'selected-dot' })
      ),
      el('button', {
        class: 'visibility',
        title: isHidden ? 'Show' : 'Hide',
        html: svgIcon(isHidden ? 'EyeOff' : 'Eye', 13),
        onclick: (e) => {
          e.stopPropagation();
          c.toggleHidden(id, !isHidden);
        },
      })
    );
    return row;
  }

  function groupBlock(label, count, key, rows) {
    const collapsed = outlinerState.collapsed.has(key);
    return el('div', { class: `group${collapsed ? ' collapsed' : ''}` },
      el('button', {
        class: 'group-label',
        onclick: () => {
          if (collapsed) outlinerState.collapsed.delete(key);
          else outlinerState.collapsed.add(key);
          updateOutliner();
        },
      },
        el('span', { class: 'group-chevron', html: svgIcon('ChevronDown', 11) }),
        label,
        el('span', { class: 'group-count', text: String(count) })
      ),
      el('div', { class: 'group-rows' }, rows)
    );
  }

  function updateOutliner() {
    const doc = c.doc;
    treeScroll.innerHTML = '';

    // Roads
    const segRows = doc.segments
      .filter((s) => matches(s.name, s.profile) && !outlinerState.hidden.has(`__filter:${s.profile}`))
      .slice(0, 220)
      .map((s) =>
        treeRow({
          id: s.id,
          name: s.name,
          kind: (PROFILES[s.profile]?.name || s.profile).split(' ')[0],
          icon: PROFILES[s.profile]?.icon || 'Route',
          iconColor: 'var(--c-road)',
          isHidden: !!s.hidden,
        })
      );
    treeScroll.append(groupBlock('Road network', doc.segments.length, 'roads', segRows.length
      ? segRows
      : el('div', { class: 'outliner-empty', text: 'No roads yet — press R to draw one or G to generate a city.' })));

    // Rail & transit
    const railRows = [
      ...doc.rails.map((r) =>
        treeRow({ id: r.id, name: r.name, kind: 'RAIL', icon: 'RailSymbol', iconColor: 'var(--c-rail)', isHidden: !!r.hidden })
      ),
      ...doc.subways.map((s) =>
        treeRow({ id: s.id, name: s.name, kind: 'METRO', icon: 'TrainFront', iconColor: 'var(--c-subway)', isHidden: !!s.hidden })
      ),
    ];
    treeScroll.append(groupBlock('Rail & transit', railRows.length, 'rail', railRows.length
      ? railRows
      : el('div', { class: 'outliner-empty', text: 'No rail or subway lines.' })));

    // Furniture collections
    const colls = propCollections(doc);
    const furnitureRows = [];
    for (const [kind, items] of colls) {
      const meta = PROP_KINDS[kind] || { name: kind, icon: 'Circle' };
      if (!matches(meta.name, kind)) continue;
      furnitureRows.push(
        treeRow({
          id: `coll:${kind}`,
          name: meta.name,
          kind: `×${items.length}`,
          icon: meta.icon,
          iconColor: 'var(--c-furniture)',
          isHidden: c.hiddenKinds?.has(kind) || false,
        })
      );
    }
    treeScroll.append(groupBlock('Street furniture', doc.props.length, 'furniture', furnitureRows.length
      ? furnitureRows
      : el('div', { class: 'outliner-empty', text: 'No furniture placed.' })));

    // Parking
    const parkingRows = (doc.parkingLots || [])
      .filter((l) => matches(l.name, l.kind))
      .map((l) =>
        treeRow({
          id: l.id,
          name: l.name,
          kind: l.kind === 'deck' ? 'DECK' : 'LOT',
          icon: l.kind === 'deck' ? 'Warehouse' : 'SquareParking',
          iconColor: 'var(--c-parking)',
          isHidden: !!l.hidden,
        })
      );
    treeScroll.append(groupBlock('Parking', (doc.parkingLots || []).length, 'parking', parkingRows.length
      ? parkingRows
      : el('div', { class: 'outliner-empty', text: 'No parking yet — generate a city or place a lot.' })));

    // Environment
    const envRows = [];
    if (doc.env?.river && matches(doc.env.river.name, 'river')) {
      envRows.push(treeRow({ id: doc.env.river.id, name: doc.env.river.name, kind: 'WATER', icon: 'Waves', iconColor: '#74bdd4' }));
    }
    for (const p of doc.env?.parks || []) {
      if (!matches(p.name, 'park')) continue;
      envRows.push(treeRow({ id: p.id, name: p.name, kind: 'PARK', icon: 'Trees', iconColor: 'var(--c-env)' }));
    }
    if (doc.junctions?.length && matches('junctions', 'junction')) {
      envRows.push(treeRow({ id: 'coll:junctions', name: 'Junctions', kind: `×${doc.junctions.length}`, icon: 'Grid3x3', iconColor: '#8da995', isHidden: c.hiddenKinds?.has('junctions') || false }));
    }
    treeScroll.append(groupBlock('Environment', envRows.length, 'env', envRows.length
      ? envRows
      : el('div', { class: 'outliner-empty', text: 'Generate a city to add terrain features.' })));

    // world stats
    const st = doc.stats();
    const statsEl = document.getElementById('world-stats');
    if (statsEl) {
      statsEl.textContent = `${st.segments} roads · ${fmt(st.laneKm, 1)} km · ${st.props} props`;
    }
  }

  // ================= inspector rendering =================

  function laneDiagram(profile) {
    const layout = layoutBands(profile);
    const total = profileWidth(profile);
    const W = 300;
    const H = 64;
    const scale = W / total;
    let x = 0;
    let rects = '';
    let laneList = '';
    for (const b of layout) {
      const w = b.w * scale;
      const def = BAND[b.t];
      const h = 26 + (def.y ?? 0) * 34;
      rects += `<rect x="${x.toFixed(1)}" y="${(H - h - 8).toFixed(1)}" width="${Math.max(1, w - 0.6).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${def.color}"/>`;
      if (w > 13) {
        rects += `<text x="${(x + w / 2).toFixed(1)}" y="${(H - h / 2 - 4).toFixed(1)}" font-size="6.4" fill="rgba(12,12,14,.65)" text-anchor="middle" font-family="DM Sans">${(def.label.split(' ')[0]).slice(0, 7)}</text>`;
      }
      x += w;
      if (TRAVEL.has(b.t)) {
        laneList += `<div class="lane-item"><i class="lane-chip" style="background:${def.color}"></i>${def.label}<span class="lane-w">${fmt(b.w, 2)} m · ${b.dir > 0 ? '↗' : '↙'}</span></div>`;
      } else {
        laneList += `<div class="lane-item"><i class="lane-chip" style="background:${def.color}"></i>${def.label}<span class="lane-w">${fmt(b.w, 2)} m</span></div>`;
      }
    }
    const svg = `<svg class="lane-diagram" viewBox="0 0 ${W} ${H}" height="${H}">${rects}</svg>`;
    return { svg, laneList: `<div class="lane-list">${laneList}</div>` };
  }

  function card(title, icon, body, tag = '') {
    return el('div', { class: 'card' },
      el('header', {},
        el('span', { html: svgIcon(icon, 14) }),
        el('span', { text: title }),
        tag ? el('span', { class: 'card-tag', text: tag }) : null
      ),
      el('div', { html: body })
    );
  }

  function slider(label, value, min, max, step, onInput, unit = '') {
    const val = el('b', { text: `${value}${unit}` });
    return el('div', { class: 'control-line' },
      el('span', { text: label }),
      el('span', { class: 'value' }, val),
      el('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
        style: { width: '100%', flexBasis: '100%' },
        oninput: (e) => {
          const v = Number(e.target.value);
          val.textContent = `${v}${unit}`;
          onInput(v);
        },
      })
    );
  }

  function updateInspector() {
    inspectorContent.innerHTML = '';
    const sel = c.getSelection();
    const doc = c.doc;
    const obj = sel ? doc.find(sel) : null;

    if (!obj && sel && sel.startsWith('coll:')) {
      renderCollection(sel.slice(5));
      return;
    }
    if (!obj && sel && doc.junctions?.some((j) => j.id === sel)) {
      const jn = doc.junctions.find((j) => j.id === sel);
      renderObjectHeader(jn.name, 'Junction', 'Grid3x3', '#8da995');
      inspectorContent.append(
        card('Junction', 'Grid3x3',
          `<div class="metric">${fmt(jn.size, 1)}<small>m</small></div>
           <p class="muted">Intersection pad with zebra approaches on all four arms.</p>
           <div class="control-line"><span>Position</span><span class="value">${fmt(jn.x, 1)} / ${fmt(jn.z, 1)}</span></div>`,
          'APPROACHES ×4')
      );
      return;
    }
    if (!obj && sel && doc.env?.river?.id === sel) {
      renderObjectHeader(doc.env.river.name, 'River', 'Waves', '#74bdd4');
      inspectorContent.append(
        card('Water body', 'Waves',
          `<div class="metric">${fmt(doc.env.river.half * 2, 0)}<small>m wide</small></div>
           <p class="muted">Quayside river with concrete embankments and bridge crossings.</p>`)
      );
      return;
    }
    if (!obj && sel && doc.env?.parks?.some((p) => p.id === sel)) {
      const park = doc.env.parks.find((p) => p.id === sel);
      renderObjectHeader(park.name, 'Park', 'Trees', 'var(--c-env)');
      inspectorContent.append(
        card('Green space', 'Trees',
          `<div class="metric">${fmt(park.w, 0)}<small>×</small>${fmt(park.h, 0)}<small>m</small></div>
           <p class="muted">Park block with crossing pathways, benches and trees.</p>`)
      );
      return;
    }

    if (!obj) {
      renderSceneInspector();
      return;
    }

    if (doc.segments.includes(obj)) return renderSegmentInspector(obj);
    if ((doc.parkingLots || []).includes(obj)) return renderParkingInspector(obj);
    if (doc.props.includes(obj)) return renderPropInspector(obj);
    if (doc.rails.includes(obj)) return renderRailInspector(obj);
    if (doc.subways.includes(obj)) return renderSubwayInspector(obj);
    renderSceneInspector();
  }

  function renderObjectHeader(name, type, icon, color) {
    inspectorContent.append(
      el('div', { class: 'object-header' },
        el('div', { class: 'object-emblem', html: svgIcon(icon, 20), style: { color } }),
        el('div', {},
          el('h1', { text: name }),
          el('p', { text: type })
        ),
        el('div', { class: 'object-actions' },
          el('button', {
            class: 'icon-button',
            title: 'Focus (F)',
            html: svgIcon('Focus', 14),
            onclick: () => c.focusSelected(),
          }),
          el('button', {
            class: 'icon-button danger',
            title: 'Delete',
            html: svgIcon('Trash2', 14),
            onclick: () => c.deleteSelected(),
          })
        )
      )
    );
  }

  function switchRow(label, on, onToggle) {
    return el('button', {
      class: `property-switch ${on ? 'is-on' : 'is-off'}`,
      onclick: onToggle,
    },
      el('span', { html: svgIcon(on ? 'Eye' : 'EyeOff', 13) }),
      el('span', { text: label }),
      el('span', { class: 'switch-state', text: on ? 'ON' : 'OFF' })
    );
  }

  function renderSegmentInspector(seg) {
    const profile = PROFILES[seg.profile] || PROFILES.street;
    const ov = seg.overrides || (seg.overrides = {});
    renderObjectHeader(seg.name, `${profile.category} · ${profile.name}`, profile.icon, 'var(--c-road)');
    inspectorContent.append(
      el('p', { class: 'description-line', text: profile.desc })
    );

    const switches = el('div', { class: 'property-switches' },
      switchRow('Markings', ov.markings !== false, () => {
        ov.markings = ov.markings === false;
        c.updateSegment(seg.id, { overrides: { ...ov } });
      }),
      switchRow('Curbs', ov.curbs !== false, () => {
        ov.curbs = ov.curbs === false;
        c.updateSegment(seg.id, { overrides: { ...ov } });
      }),
      switchRow('Sidewalks', ov.sidewalks !== false, () => {
        ov.sidewalks = ov.sidewalks === false;
        c.updateSegment(seg.id, { overrides: { ...ov } });
      }),
      switchRow('Bridge deck', !!seg.bridge, () => {
        c.updateSegment(seg.id, { bridge: !seg.bridge, bridgeType: seg.bridgeType || 'girder' });
      })
    );
    inspectorContent.append(switches);

    const diag = laneDiagram(profile);
    const len = polylineLength(seg.points);
    inspectorContent.append(
      card('Cross section', 'Spline',
        `${diag.svg}${diag.laneList}`,
        `${fmt(profileWidth(profile), 1)} M WIDE`),
      card('Speed limit', 'Gauge',
        `<div class="metric">${ov.speedLimit ?? profile.speedLimit}<small>km/h</small></div>
         <p class="muted">Posted limit for this ${profile.name.toLowerCase()}.</p>
         <div class="slider-wrap">${''}</div>`,
        profile.category.toUpperCase())
    );
    const speedCard = inspectorContent.lastChild;
    speedCard.querySelector('.slider-wrap').append(
      el('input', {
        type: 'range',
        min: '10',
        max: '130',
        step: '5',
        value: String(ov.speedLimit ?? profile.speedLimit),
        oninput: (e) => {
          const v = Number(e.target.value);
          speedCard.querySelector('.metric').innerHTML = `${v}<small>km/h</small>`;
          ov.speedLimit = v;
          c.updateSegment(seg.id, { overrides: { ...ov } }, true);
        },
      })
    );

    const p0 = seg.points[0];
    inspectorContent.append(
      card('Geometry', 'Ruler',
        `<div class="metric">${fmt(len, 1)}<small>m long</small></div>
         <p class="muted">${seg.points.length} control points${seg.bridge ? ' · elevated deck with pillars & railings' : ''}</p>
         <div class="xyz-row">
           <label><b>X</b><input type="number" data-ax="x" value="${fmt(p0.x, 1)}"></label>
           <label><b>Y</b><input type="number" data-ax="y" value="${fmt(p0.y ?? 0, 1)}"></label>
           <label><b>Z</b><input type="number" data-ax="z" value="${fmt(p0.z, 1)}"></label>
         </div>`,
        seg.bridge ? 'BRIDGE' : 'PLANAR')
    );
    inspectorContent.lastChild.querySelectorAll('.xyz-row input').forEach((input) => {
      input.addEventListener('change', () => {
        const ax = input.dataset.ax;
        const v = Number(input.value) || 0;
        const pts = seg.points.map((p) => ({ ...p }));
        pts[0][ax] = v;
        c.updateSegment(seg.id, { points: pts });
      });
    });

    // curb + bridge structure
    inspectorContent.append(
      card('Curb & structure', 'Fence',
        `<p class="muted">Kerb profile and bridge structure for this segment.</p>
         <div class="control-line"><span>Curb style</span><span class="value" style="flex:1;max-width:150px"></span></div>
         <div class="control-line"><span>Bridge structure</span><span class="value" style="flex:1;max-width:150px"></span></div>`,
        seg.bridge ? 'BRIDGED' : 'AT GRADE')
    );
    const structCard = inspectorContent.lastChild;
    const curbSel = el('select', {
      onchange: (e) => c.updateSegment(seg.id, { overrides: { ...ov, curbStyle: e.target.value === 'default' ? undefined : e.target.value } }),
      style: { width: '100%', background: '#191d24', border: '1px solid #3b4351', color: '#ccd2df', borderRadius: '5px', padding: '6px' },
    });
    const currentCurb = ov.curbStyle || profile.curbStyle || 'barrier';
    for (const s of ['default', 'barrier', 'rounded', 'stone', 'mountable', 'none']) {
      curbSel.append(el('option', {
        value: s,
        text: s === 'default' ? `Profile default (${currentCurb})` : s,
        selected: (ov.curbStyle || 'default') === s ? 'selected' : null,
      }));
    }
    structCard.querySelectorAll('.control-line .value')[0].append(curbSel);
    const brSel = el('select', {
      onchange: (e) => {
        if (!seg.bridge) c.updateSegment(seg.id, { bridge: true, bridgeType: e.target.value });
        else c.updateSegment(seg.id, { bridgeType: e.target.value });
      },
      style: { width: '100%', background: '#191d24', border: '1px solid #3b4351', color: '#ccd2df', borderRadius: '5px', padding: '6px' },
    });
    for (const [v, label] of [['girder', 'Girder / beam'], ['arch', 'Arch'], ['cable', 'Cable-stayed'], ['truss', 'Through truss']]) {
      brSel.append(el('option', {
        value: v,
        text: label,
        selected: (seg.bridgeType || 'girder') === v ? 'selected' : null,
      }));
    }
    structCard.querySelectorAll('.control-line .value')[1].append(brSel);

    // profile switcher
    inspectorContent.append(
      card('Road class', 'Layers',
        `<p class="muted">Re-profile this segment — lane layout, curbs and markings update immediately.</p>`,
        'RECIPE')
    );
    const profCard = inspectorContent.lastChild;
    const selectEl = el('select', {
      onchange: (e) => c.updateSegment(seg.id, { profile: e.target.value }),
    });
    for (const [key, p] of Object.entries(PROFILES)) {
      selectEl.append(el('option', { value: key, text: p.name, selected: key === seg.profile ? 'selected' : null }));
    }
    selectEl.style.cssText = 'width:100%;margin-top:4px;background:#191d24;border:1px solid #3b4351;color:#ccd2df;border-radius:5px;padding:8px;';
    profCard.querySelector('div').append(selectEl);

    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn',
          onclick: () => c.duplicateSelected(),
        }, el('span', { html: svgIcon('Copy', 13) }), 'Duplicate'),
        el('button', {
          class: 'action-btn danger',
          onclick: () => c.deleteSelected(),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete')
      )
    );
  }

  function renderPropInspector(prop) {
    const meta = PROP_KINDS[prop.kind] || { name: prop.kind, desc: '' };
    renderObjectHeader(meta.name, `Street furniture · ${meta.group || 'prop'}`, meta.icon, 'var(--c-furniture)');
    inspectorContent.append(el('p', { class: 'description-line', text: meta.desc }));

    const p = prop;
    inspectorContent.append(
      card('Transform', 'Move3d',
        `<p class="muted">World position and heading.</p>
         <div class="xyz-row">
           <label><b>X</b><input type="number" data-ax="x" value="${fmt(p.x, 1)}"></label>
           <label><b>Y</b><input type="number" data-ax="y" value="${fmt(p.y ?? 0, 2)}"></label>
           <label><b>Z</b><input type="number" data-ax="z" value="${fmt(p.z, 1)}"></label>
         </div>
         <div class="slider-wrap"></div>`,
        'WORLD SPACE')
    );
    const tCard = inspectorContent.lastChild;
    tCard.querySelectorAll('.xyz-row input').forEach((input) => {
      input.addEventListener('change', () => {
        const ax = input.dataset.ax;
        c.updateProp(prop.id, { [ax]: Number(input.value) || 0 });
      });
    });
    const rotVal = el('b', { text: `${Math.round(((p.rotY ?? 0) * 180) / Math.PI)}°` });
    tCard.querySelector('.slider-wrap').append(
      el('div', { class: 'control-line' }, el('span', { text: 'Heading' }), el('span', { class: 'value' }, rotVal)),
      el('input', {
        type: 'range',
        min: '0',
        max: '360',
        step: '1',
        value: String(Math.round(((p.rotY ?? 0) * 180) / Math.PI)),
        oninput: (e) => {
          const v = Number(e.target.value);
          rotVal.textContent = `${v}°`;
          c.updateProp(prop.id, { rotY: (v * Math.PI) / 180 }, true);
        },
      })
    );

    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn wide',
          onclick: () => c.select(`coll:${prop.kind}`),
        }, el('span', { html: svgIcon('Layers', 13) }), `All ${meta.name.toLowerCase()}s`),
        el('button', {
          class: 'action-btn',
          onclick: () => c.duplicateSelected(),
        }, el('span', { html: svgIcon('Copy', 13) }), 'Duplicate'),
        el('button', {
          class: 'action-btn danger',
          onclick: () => c.deleteSelected(),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete')
      )
    );
  }

  function renderParkingInspector(lot) {
    const isDeck = lot.kind === 'deck';
    renderObjectHeader(
      lot.name,
      isDeck ? 'Multi-storey parking deck' : 'Surface car park',
      isDeck ? 'Warehouse' : 'SquareParking',
      'var(--c-parking)'
    );
    inspectorContent.append(el('p', {
      class: 'description-line',
      text: isDeck
        ? 'Column grid · deck slabs · parapets · zigzag ramps · entry kiosks'
        : 'Painted bays · aisles & arrows · accessible bays · landscaped islands · lights · kiosks',
    }));
    inspectorContent.append(
      card('Footprint', 'Ruler',
        `<div class="metric">${fmt(lot.w ?? 72, 0)}<small>×</small>${fmt(lot.h ?? 46, 0)}<small>m</small></div>
         <p class="muted">${isDeck ? `${lot.levels ?? 3} levels` : `Bays at ${(lot.angle ?? 90)}°`} · ${fmt(((lot.w ?? 72) * (lot.h ?? 46)) / 12, 0)} car spaces approx.</p>`,
        isDeck ? 'DECK' : 'SURFACE LOT')
    );
    const geoCard = inspectorContent.lastChild.querySelector('div');
    const numRow = (label, key, min, max, unit = ' m') => {
      const input = el('input', {
        type: 'number',
        value: String(lot[key] ?? 0),
        style: { width: '78px', background: '#191d24', border: '1px solid #3b4351', color: '#ccd2df', borderRadius: '5px', padding: '6px 8px' },
        onchange: (e) => c.updateProp(lot.id, { [key]: Number(e.target.value) || 0 }),
      });
      return el('div', { class: 'control-line' },
        el('span', { text: label }),
        el('span', { class: 'value' }, input, el('small', { text: unit }))
      );
    };
    geoCard.append(
      numRow('Width', 'w', 20, 200),
      numRow('Depth', 'h', 16, 160),
      numRow('Heading', 'rotY', 0, 360, ' rad'),
    );
    if (isDeck) geoCard.append(numRow('Levels', 'levels', 1, 6, ' floors'));
    else {
      const angRow = el('div', { class: 'control-line' },
        el('span', { text: 'Bay angle' }),
        el('span', { class: 'value' },
          el('button', {
            class: 'property-switch',
            style: { padding: '4px 8px' },
            onclick: () => {
              c.updateProp(lot.id, { angle: (lot.angle ?? 90) === 90 ? 60 : 90 });
            },
          }, el('span', { class: 'switch-state', text: `${lot.angle ?? 90}°` }))
        )
      );
      geoCard.append(angRow);
    }
    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn',
          onclick: () => c.duplicateSelected(),
        }, el('span', { html: svgIcon('Copy', 13) }), 'Duplicate'),
        el('button', {
          class: 'action-btn danger',
          onclick: () => c.deleteSelected(),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete')
      )
    );
  }

  function renderRailInspector(rail) {
    renderObjectHeader(rail.name, 'Railway mainline', 'RailSymbol', 'var(--c-rail)');
    inspectorContent.append(el('p', { class: 'description-line', text: 'Ballast bed · sleepers · twin rails · level crossings' }));
    const len = polylineLength(rail.points);
    inspectorContent.append(
      card('Alignment', 'Ruler',
        `<div class="metric">${fmt(len / 1000, 2)}<small>km</small></div>
         <p class="muted">${rail.points.length} alignment points · ${(rail.crossings || []).length} level crossing(s) with gates and signals.</p>`,
        'MAINLINE')
    );
    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn danger wide',
          onclick: () => c.deleteSelected(),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete line')
      )
    );
  }

  function renderSubwayInspector(sw) {
    renderObjectHeader(sw.name, 'Metro line', 'TrainFront', 'var(--c-subway)');
    inspectorContent.append(el('p', { class: 'description-line', text: 'Twin running tunnels · station boxes · platform edges · street entrances' }));
    const stList = (sw.stations || [])
      .map((s) => `<div class="control-line"><span>${s.name}</span><span class="value">${fmt(s.x, 0)} / ${fmt(s.z, 0)}</span></div>`)
      .join('');
    inspectorContent.append(
      card('Stations', 'TrainFront',
        `<div class="metric">${(sw.stations || []).length}<small>stations</small></div>
         <p class="muted">Tunnel depth ${fmt(sw.depth ?? -9, 1)} m below the surface.</p>${stList}`,
        'UNDERGROUND')
    );
    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn wide',
          onclick: () => c.setViewMode('subway'),
        }, el('span', { html: svgIcon('Eye', 13) }), 'Subway X-ray view'),
        el('button', {
          class: 'action-btn danger',
          onclick: () => c.deleteSelected(),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete')
      )
    );
  }

  function renderCollection(kind) {
    const doc = c.doc;
    if (kind === 'junctions') {
      renderObjectHeader('Junctions', 'Intersection collection', 'Grid3x3', '#8da995');
      inspectorContent.append(
        card('Intersections', 'Grid3x3',
          `<div class="metric">${doc.junctions?.length ?? 0}<small>pads</small></div>
           <p class="muted">Asphalt junction pads with zebra crossings on every approach.</p>`,
          'COLLECTION')
      );
      return;
    }
    const items = doc.props.filter((p) => p.kind === kind);
    const meta = PROP_KINDS[kind] || { name: kind, icon: 'Circle', desc: '' };
    renderObjectHeader(meta.name, `Collection · ${items.length} placed`, meta.icon, 'var(--c-furniture)');
    inspectorContent.append(el('p', { class: 'description-line', text: meta.desc }));
    inspectorContent.append(
      card('Placement', 'Layers',
        `<div class="metric">${items.length}<small>instances</small></div>
         <p class="muted">Batch selection of every ${meta.name.toLowerCase()} in the scene.</p>`,
        'COLLECTION')
    );
    inspectorContent.append(
      el('div', { class: 'action-grid' },
        el('button', {
          class: 'action-btn',
          onclick: () => c.focusCollection(kind),
        }, el('span', { html: svgIcon('Focus', 13) }), 'Focus nearest'),
        el('button', {
          class: 'action-btn danger',
          onclick: () => c.deleteCollection(kind),
        }, el('span', { html: svgIcon('Trash2', 13) }), 'Delete all')
      )
    );
  }

  function renderSceneInspector() {
    const doc = c.doc;
    const st = doc.stats();
    inspectorContent.append(
      el('div', { class: 'object-header' },
        el('div', { class: 'object-emblem', html: svgIcon('Layers', 20) }),
        el('div', {},
          el('h1', { text: 'Scene overview' }),
          el('p', { text: 'Road & city editor · nothing selected' })
        )
      ),
      el('div', { class: 'stat-strip' },
        statCell('Roads', st.segments, 'Spline'),
        statCell('Length', `${fmt(st.laneKm, 1)}`, 'Ruler'),
        statCell('Props', st.props, 'Cone')
      ),
      el('div', { class: 'stat-strip' },
        statCell('Rail', st.rails, 'RailSymbol'),
        statCell('Metro', st.subways, 'TrainFront'),
        statCell('Parking', st.parking ?? 0, 'SquareParking')
      )
    );

    inspectorContent.append(
      card('Viewport & camera', 'Camera',
        `<p class="muted">Unreal-style navigation. Hold RMB to look, WASD to fly, Q/E vertical, scroll to change speed, Shift boost, Alt+LMB orbit.</p>`,
        'UNREAL NAV')
    );
    const camCard = inspectorContent.lastChild.querySelector('div');
    camCard.append(
      slider('Camera speed', Math.round(c.getCameraSpeed?.() ?? 26), 2, 200, 1, (v) => c.setCameraSpeed?.(v), ' m/s'),
      slider('Sun azimuth', doc.settings.sunAzimuth, 0, 360, 1, (v) => {
        doc.settings.sunAzimuth = v;
      }, '°'),
      slider('Sun elevation', doc.settings.sunElevation, 5, 85, 1, (v) => {
        doc.settings.sunElevation = v;
      }, '°'),
      el('div', { class: 'control-line' },
        el('span', { text: 'Ground grid' }),
        el('span', { class: 'value' },
          el('button', {
            class: 'property-switch',
            style: { padding: '4px 8px' },
            onclick: (e) => {
              const on = c.toggleGrid();
              e.currentTarget.classList.toggle('is-on', on);
              e.currentTarget.querySelector('.switch-state').textContent = on ? 'ON' : 'OFF';
            },
          },
            el('span', { class: 'switch-state', text: doc.settings.showGrid ? 'ON' : 'OFF' })
          )
        )
      )
    );

    inspectorContent.append(
      card('Scene file', 'Save',
        `<p class="muted">The whole city is a pure-data document — save, share, regenerate.</p>
         <div class="action-grid">
           <button class="action-btn" data-act="export"><span>${svgIcon('Download', 13)}</span>Export JSON</button>
           <button class="action-btn" data-act="import"><span>${svgIcon('Upload', 13)}</span>Import JSON</button>
           <button class="action-btn wide danger" data-act="clear"><span>${svgIcon('Trash2', 13)}</span>Clear scene</button>
         </div>`,
        'DOCUMENT')
    );
    const fileCard = inspectorContent.lastChild;
    fileCard.querySelector('[data-act=export]').addEventListener('click', () => c.exportJSON());
    fileCard.querySelector('[data-act=import]').addEventListener('click', () => c.importJSON());
    fileCard.querySelector('[data-act=clear]').addEventListener('click', () => c.clearScene());

    inspectorContent.append(
      card('Keyboard', 'Keyboard',
        `<div class="hotkey-grid">
          <kbd>V</kbd><span>Select tool</span>
          <kbd>R</kbd><span>Draw road</span>
          <kbd>P</kbd><span>Place prop</span>
          <kbd>K</kbd><span>Construct menu</span>
          <kbd>G</kbd><span>Generate city</span>
          <kbd>F</kbd><span>Focus selection</span>
          <kbd>Del</kbd><span>Delete selection</span>
          <kbd>1–4</kbd><span>View modes</span>
          <kbd>Ctrl+Z</kbd><span>Undo / redo</span>
        </div>`,
        'SHORTCUTS')
    );
  }

  function statCell(label, value, icon) {
    return el('div', { class: 'stat-cell' },
      el('span', { class: 'eyebrow', html: `${svgIcon(icon, 11)} ${label}` }),
      el('div', { class: 'metric', text: String(value) })
    );
  }

  // ================= tool / status =================

  const TOOL_HINTS = {
    select: ['Select', 'click objects to inspect · drag empty space with RMB to look'],
    draw: ['Draw Road', 'click to place points · Enter or double-click to finish · Esc cancels'],
    prop: ['Place Prop', 'click to place · R rotates · Esc cancels'],
  };

  function setToolUI(tool) {
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    const [label, hint] = TOOL_HINTS[tool] || TOOL_HINTS.select;
    sbTool.textContent = label.toUpperCase();
    sbHint.textContent = hint;
    const chip = document.getElementById('vp-tool-chip');
    if (chip) chip.innerHTML = `<b>${label}</b> · ${hint}`;
    viewportEl.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  function setViewUI(mode) {
    toolbar.querySelectorAll('.view-pill').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === mode);
    });
  }

  function setSpeedUI(v) {
    speedReadout.textContent = String(Math.round(v));
  }

  function setCoords(x, z) {
    sbCoords.textContent = `${fmt(x, 1)} / ${fmt(z, 1)}`;
  }

  function setFps(v) {
    sbFps.textContent = String(v);
  }

  function setHint(text) {
    sbHint.textContent = text;
  }

  function setSnapUI(v) {
    const elSnap = document.getElementById('sb-snap');
    if (elSnap) elSnap.textContent = v ? `${v} m` : 'off';
    const chip = document.getElementById('vp-snap-chip');
    if (chip) chip.innerHTML = `<span>${svgIcon('Grid3x3', 12)}</span><span>Snap <b>${v ? v + ' m' : 'off'}</b></span>`;
  }

  let viewportFps = 60;

  function updateAll() {
    updateOutliner();
    updateInspector();
  }

  // refresh inspector when camera speed changes externally etc.
  return {
    updateAll,
    updateOutliner,
    updateInspector,
    setToolUI,
    setViewUI,
    setSpeedUI,
    setCoords,
    setFps: (v) => {
      viewportFps = v;
      setFps(v);
    },
    setHint,
    setSnapUI,
    toast,
    viewportEl,
    refreshSceneName: () => {
      sceneNameInput.value = c.getSceneName();
    },
  };
}

function axisSvg() {
  return `<svg viewBox="0 0 74 74" width="74" height="74">
    <circle cx="37" cy="37" r="30" fill="#141414aa" stroke="#2c2c2c"/>
    <g id="axis-gizmo" transform="rotate(0 37 37)">
      <line x1="37" y1="37" x2="37" y2="12" stroke="#8da995" stroke-width="2"/>
      <text x="37" y="9" fill="#8da995" font-size="8" text-anchor="middle">Z</text>
      <line x1="37" y1="37" x2="60" y2="48" stroke="#ab8181" stroke-width="2"/>
      <text x="64" y="52" fill="#ab8181" font-size="8" text-anchor="middle">X</text>
      <line x1="37" y1="37" x2="14" y2="48" stroke="#829ac5" stroke-width="2"/>
      <text x="10" y="52" fill="#829ac5" font-size="8" text-anchor="middle">Y</text>
    </g>
  </svg>`;
}

export function updateAxisWidget(yawDeg) {
  const g = document.getElementById('axis-gizmo');
  if (g) g.setAttribute('transform', `rotate(${yawDeg} 37 37)`);
}
