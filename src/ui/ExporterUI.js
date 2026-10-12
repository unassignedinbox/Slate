/* ============================================================================
   ExporterUI — file dialogs and the road-type reference sheet.
   ========================================================================== */

import { h, $, fmtInt } from './widgets.js';
import { saveJSON, loadJSON, exportGLTF, exportOBJ, exportCSV, quantities } from '../io/Exporter.js';
import { PRESETS, KINDS, GROUPS } from '../model/Presets.js';

export function createExporter(editor, app) {
  const input = h('input', { type: 'file', accept: '.json,.slate.json', style: { display: 'none' } });
  document.body.appendChild(input);

  function modal(title, build, { width = 640 } = {}) {
    const body = h('div', { class: 'modal-body' });
    const card = h('div', { class: 'modal', style: { width: `${width}px` } },
      h('div', { class: 'modal-head' },
        h('span', { class: 't' }, title),
        h('button', { class: 'modal-x', type: 'button', onclick: () => close() }, '×'),
      ),
      body,
    );
    const back = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === back) close(); } }, card);
    document.body.appendChild(back);
    const close = () => back.remove();
    build(body, close);
    return { close, body };
  }

  return {
    saveJSON() {
      saveJSON(editor.net, `slate-network-${Date.now()}.slate.json`);
      app.toast('Saved network JSON', 'ok');
    },

    openFile(cb) {
      input.value = '';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const json = await loadJSON(f);
          cb(json);
        } catch (e) {
          app.toast(`Could not read file: ${e.message}`, 'err');
        }
      };
      input.click();
    },

    async exportGLTF(world) {
      const tris = world.stats.tris;
      if (tris > 3_000_000) {
        modal('Export glTF', (body, close) => {
          body.appendChild(h('div', { class: 'info-note warn' },
            `This scene has <b>${fmtInt(tris)}</b> triangles. The export will be several hundred megabytes and may take a while.`));
          body.appendChild(h('div', { class: 'btn-row', style: { marginTop: '12px', justifyContent: 'flex-end' } },
            h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); doExport(); } }, 'Export anyway'),
          ));
        }, { width: 420 });
        return;
      }
      doExport();
      async function doExport() {
        app.toast('Exporting glTF…');
        try {
          await exportGLTF(world, 'slate-roads.glb', true);
          app.toast('glTF exported', 'ok');
        } catch (e) {
          app.toast(`Export failed: ${e.message}`, 'err');
        }
      }
    },

    exportOBJ(world) {
      app.toast('Exporting OBJ…');
      try {
        exportOBJ(world, 'slate-roads.obj');
        app.toast('OBJ exported', 'ok');
      } catch (e) { app.toast(`Export failed: ${e.message}`, 'err'); }
    },

    exportCSV(net) {
      exportCSV(net, 'slate-schedule.csv');
      app.toast('Schedule exported', 'ok');
    },

    showReference() {
      modal('Road type reference', (body) => {
        const q = quantities(editor.net);
        body.appendChild(h('div', { class: 'info-note' },
          `Network: <b>${fmtInt(editor.net.edges.size)}</b> segments · <b>${(q.length / 1000).toFixed(2)} km</b> total · `
          + `<b>${fmtInt(q.area)} m²</b> of constructed surface.`));

        for (const grp of GROUPS) {
          const items = PRESETS.filter((p) => p.group === grp);
          if (!items.length) continue;
          body.appendChild(h('div', { class: 'lib-group-label', style: { paddingLeft: '0' } }, grp));
          const t = h('table', { class: 'kv-table', style: { marginBottom: '10px' } });
          for (const p of items) {
            const w = p.bands.reduce((s, b) => s + (b.w || 0), 0);
            const cw = p.bands.filter((b) => KINDS[b.k]?.traffic).reduce((s, b) => s + (b.w || 0), 0);
            const lanes = p.bands.filter((b) => ['driving', 'bus', 'cycle', 'tram'].includes(b.k)).length;
            t.appendChild(h('tr', {},
              h('td', { class: 'k', style: { width: '38%' } }, p.name),
              h('td', { class: 'v' }, `${w.toFixed(1)} m wide · ${cw.toFixed(1)} m carriageway · ${lanes} lane${lanes === 1 ? '' : 's'}`),
            ));
          }
          body.appendChild(t);
        }

        if (q.bySurface.length) {
          body.appendChild(h('div', { class: 'lib-group-label', style: { paddingLeft: '0' } }, 'Surface quantities'));
          const t = h('table', { class: 'kv-table' });
          for (const s of q.bySurface.slice(0, 12)) {
            t.appendChild(h('tr', {},
              h('td', { class: 'k' }, s.surface),
              h('td', { class: 'v' }, `${fmtInt(s.area)} m²`),
            ));
          }
          body.appendChild(t);
        }
      }, { width: 660 });
    },
  };
}
