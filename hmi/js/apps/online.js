// Online: rooms, live standings and presence on a shared minimap, plus chat. Other drivers are
// simulated here; in production the match server streams authoritative snapshots (20-60 Hz)
// and the HMI interpolates them. Standings are derived from the same track distance as the car.
import { el } from '../ui.js';
import { LOBBY, ROOMS } from '../backend.js';
import { trackAt, TRACK } from '../track.js';
import { createTrackMap } from '../minimap.js';

const CHAT_SEED = [
  ['Vortex_K', 'gg, that Monza line was clean'],
  ['Mira.R', 'anyone running soft tyres today?'],
  ['NightLine', 'Wet pack is on sale in the store'],
];

export default {
  id: 'online', name: 'Online', icon: 'online', color: '#f472b6',
  open(body, ctx) {
    const root = el('div', { class: 'online' });
    body.append(root);
    let room = null;
    let joining = false;
    const chat = CHAT_SEED.map(([who, text]) => ({ who, text }));
    const drivers = LOBBY.map((p, i) => ({ ...p, ratio: 1 + (i - 3) * 0.0004, pingNow: p.ping }));
    const youHandle = ctx.backend.account.handle;

    // ---- lobby view
    function renderLobby() {
      root.replaceChildren(
        el('h3', {}, 'Rooms'),
        el('div', { class: 'rooms' }, ROOMS.map((r) => el('section', { class: 'card room' },
          el('div', {}, el('strong', {}, r.name), el('small', { class: 'muted' }, `${r.tier} · ${r.players} drivers · ${r.ping} ms`)),
          el('button', { class: 'btn primary', disabled: joining, onclick: () => join(r) }, joining ? 'Joining…' : 'Join')))),
        el('p', { class: 'footnote' }, 'Matchmaking uses the authoritative server. Rooms shown are simulated.'),
      );
    }

    function join(r) {
      joining = true;
      renderLobby();
      setTimeout(() => {
        joining = false;
        room = r;
        ctx.toast(`Joined ${r.name}`, 'info');
        renderSession();
      }, 700);
    }

    // ---- session view
    let standingsEl, chatLog, mapCanvas, map, roomTitle;
    function renderSession() {
      roomTitle = el('strong', {}, room.name);
      standingsEl = el('tbody');
      chatLog = el('div', { class: 'chat-log' });
      mapCanvas = el('canvas', { class: 'minimap big' });
      const input = el('input', { class: 'input', placeholder: 'Message the room…', maxlength: 160 });
      const sendMsg = () => {
        const t = input.value.trim();
        if (!t) return;
        chat.push({ who: youHandle, text: t, you: true });
        input.value = '';
        renderChat();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
      root.replaceChildren(
        el('div', { class: 'session-head' }, el('div', {}, roomTitle, el('small', { class: 'muted' }, ` · ${room.tier} · ${room.players} drivers`)),
          el('button', { class: 'btn', onclick: () => { room = null; map?.dispose(); renderLobby(); } }, 'Leave')),
        el('div', { class: 'session-grid' },
          el('section', { class: 'card standings' }, el('h3', {}, 'Standings'),
            el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'P'), el('th', {}, 'Driver'), el('th', {}, 'Gap'), el('th', {}, 'Ping'))), standingsEl)),
          el('section', { class: 'card mapcard' }, el('h3', {}, 'Track · live'), mapCanvas),
          el('section', { class: 'card chat' }, el('h3', {}, 'Team & room chat'), chatLog, el('div', { class: 'row' }, input)),
        ),
      );
      map = createTrackMap(mapCanvas);
      renderChat();
      lastStandings = 0;
    }

    function renderChat() {
      if (!chatLog) return;
      chatLog.replaceChildren(...chat.slice(-30).map((m) => el('div', { class: `msg ${m.you ? 'you' : ''}` },
        el('b', {}, m.who), el('span', {}, m.text))));
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    // Presence chatter so the lobby feels alive (replaced by server events in production).
    const chatTimer = setInterval(() => {
      if (!room) return;
      const d = drivers[Math.floor(Math.random() * drivers.length)];
      const lines = ['nice lap', 'brake later?', 'pit window opens soon', 'tyres feel good', 'gg'];
      chat.push({ who: d.handle, text: lines[Math.floor(Math.random() * lines.length)] });
      renderChat();
    }, 6000);
    const pingTimer = setInterval(() => {
      drivers.forEach((d) => { d.pingNow = Math.max(12, d.ping + Math.round((Math.random() - 0.5) * 14)); });
    }, 2000);

    let lastStandings = 0;
    function update(f) {
      if (!room) {
        if (!root.querySelector('.rooms')) renderLobby();
        return;
      }
      if (!map) return;
      const own = { handle: youHandle, dist: f.distanceM, color: '#2ee6c5', own: true, ping: 9 };
      const others = drivers.map((d) => ({ handle: d.handle, dist: f.distanceM * d.ratio + d.offset, color: d.car, ping: d.pingNow, ready: d.ready }));
      const all = [own, ...others].sort((a, b) => b.dist - a.dist);
      const markers = all.map((d) => {
        const p = trackAt(TRACK, d.dist);
        return { pos: p, color: d.color, r: d.own ? 7 : 5, label: d.own ? 'YOU' : undefined };
      });
      map.draw(markers);

      const now = performance.now();
      if (now - lastStandings > 300) {
        lastStandings = now;
        const leader = all[0].dist;
        const speed = Math.max(10, f.speedKph / 3.6);
        standingsEl.replaceChildren(...all.map((d, i) => el('tr', { class: d.own ? 'own' : '' },
          el('td', {}, String(i + 1)),
          el('td', {}, el('i', { class: 'dot', style: { background: d.color } }), d.handle, d.ready === false ? el('small', { class: 'muted' }, ' · not ready') : ''),
          el('td', {}, i === 0 ? '—' : `+${((leader - d.dist) / speed).toFixed(1)}s`),
          el('td', {}, `${d.ping} ms`))));
      }
    }

    renderLobby();
    return {
      update,
      destroy() {
        clearInterval(chatTimer);
        clearInterval(pingTimer);
        map?.dispose();
      },
    };
  },
};
