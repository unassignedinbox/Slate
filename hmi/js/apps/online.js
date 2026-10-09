// Online: rooms, live race standings on a shared track map, friends and presence, chat and a
// leaderboard. Other drivers are simulated here. In production the match server streams
// authoritative snapshots (20-60 Hz) over WebSocket and the HMI interpolates them. Standings are
// derived from the same track distance as the local car.
import { el } from '../ui.js';
import { LOBBY, ROOMS } from '../backend.js';
import { trackAt, TRACK } from '../track.js';
import { createTrackMap } from '../minimap.js';
import { tabs } from '../kit.js';

const CHAT_SEED = [
  ['Vortex_K', 'gg, that Monza line was clean'],
  ['Mira.R', 'anyone running soft tyres today?'],
  ['NightLine', 'Wet pack is on sale in the store'],
];
const CHAT_LINES = ['nice lap', 'brake later?', 'pit window opens soon', 'tyres feel good', 'gg'];

const bars = (ping) => {
  const n = ping < 40 ? 4 : ping < 60 ? 3 : ping < 90 ? 2 : 1;
  return el('span', { class: `k-ping q${n}`, title: `${ping} ms` }, el('i'), el('i'), el('i'), el('i'));
};

export default {
  id: 'online', name: 'Online', icon: 'online', color: '#f472b6',
  open(body, ctx) {
    const accent = '#2ee6c5';
    const youHandle = ctx.backend.account.handle;
    const drivers = LOBBY.map((p, i) => ({ ...p, ratio: 1 + (i - 3) * 0.0004, pingNow: p.ping, status: p.ready ? 'Online' : 'Away' }));
    const chat = CHAT_SEED.map(([who, text]) => ({ who, text }));
    let room = null;
    let joining = null;
    let youReady = false;
    let tab = 'rooms';

    const content = el('div', { class: 'on-content' });
    const nav = tabs([['rooms', 'Rooms'], ['race', 'Race'], ['friends', 'Friends'], ['board', 'Leaderboard']], tab, (k) => { tab = k; render(); });
    const roomBadge = el('span', { class: 'k-badge' }, 'Not in a room');
    body.append(el('div', { class: 'on-head' }, el('div', {}, el('span', { class: 'k-cap' }, 'DRIVER'), el('b', {}, youHandle)),
      el('div', { class: 'on-head-r' }, nav.root, roomBadge)),
      content);

    // ---- views
    function roomsView() {
      return el('div', { class: 'on-rooms' },
        el('div', { class: 'on-room-list' }, ROOMS.map((r) => {
          const [have, cap] = r.players.split('/').map(Number);
          const full = have >= cap;
          return el('section', { class: 'k-card on-room' },
            el('div', { class: 'on-room-h' }, el('strong', {}, r.name), el('span', { class: `k-badge ${r.tier === 'Pro' ? 'hot' : r.tier === 'Gold' ? 'ok' : ''}` }, r.tier)),
            el('div', { class: 'on-room-m' },
              el('div', { class: 'k-bar on-fill' }, el('i', { style: { width: `${(have / cap) * 100}%` } })),
              el('small', { class: 'muted' }, `${have}/${cap} drivers`)),
            el('div', { class: 'on-room-f' }, bars(r.ping), el('span', { class: 'muted' }, `${r.ping} ms`),
              el('span', { class: 'spacer' }),
              el('button', {
                class: 'k-btn primary', disabled: full || joining != null || room?.id === r.id,
                onclick: () => join(r),
              }, room?.id === r.id ? 'Joined' : joining === r.id ? 'Joining…' : full ? 'Full' : 'Join')));
        })),
        room ? lobbyCard() : el('section', { class: 'k-card on-empty' }, el('strong', {}, 'Pick a room to start'), el('small', { class: 'muted' }, 'Ranked rooms match you with drivers of similar pace.')),
        el('p', { class: 'footnote' }, 'Matchmaking uses the authoritative server. Rooms shown are simulated.'));
    }

    function lobbyCard() {
      const others = drivers.slice(0, 5);
      return el('section', { class: 'k-card on-lobby' },
        el('div', { class: 'k-cap' }, `LOBBY · ${room.name}`),
        el('ul', { class: 'on-players' },
          el('li', {}, el('i', { class: 'dot', style: { background: accent } }), el('b', {}, youHandle), el('small', { class: 'muted' }, ' you'),
            el('span', { class: 'spacer' }), el('span', { class: `k-badge ${youReady ? 'ok' : ''}` }, youReady ? 'Ready' : 'Not ready')),
          others.map((d) => el('li', {}, el('i', { class: 'dot', style: { background: d.car } }), el('b', {}, d.handle),
            el('span', { class: 'spacer' }), bars(d.pingNow), el('span', { class: `k-badge ${d.ready ? 'ok' : ''}` }, d.ready ? 'Ready' : 'Not ready')))),
        el('div', { class: 'on-lobby-actions' },
          el('button', { class: `k-btn ${youReady ? 'ghost' : 'primary'}`, onclick: () => { youReady = !youReady; render(); } }, youReady ? 'Cancel ready' : 'Ready up'),
          el('button', { class: 'k-btn ghost', onclick: leave }, 'Leave room')));
    }

    function raceView() {
      if (!room) {
        return el('section', { class: 'k-card on-empty on-empty-race' }, el('strong', {}, 'You are not in a race'),
          el('small', { class: 'muted' }, 'Join a room to see live standings and chat.'),
          el('button', { class: 'k-btn primary', onclick: () => { tab = 'rooms'; render(); } }, 'Browse rooms'));
      }
      standingsEl = el('tbody');
      chatLog = el('div', { class: 'chat-log' });
      mapCanvas = el('canvas', { class: 'on-map' });
      const input = el('input', { class: 'input', placeholder: 'Message the room…', maxlength: 160 });
      const sendMsg = () => {
        const t = input.value.trim();
        if (!t) return;
        chat.push({ who: youHandle, text: t, you: true });
        input.value = '';
        renderChat();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      return el('div', { class: 'on-race' },
        el('section', { class: 'k-card on-standings' }, el('div', { class: 'k-cap' }, 'STANDINGS · LIVE'),
          el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'P'), el('th', {}, 'Driver'), el('th', {}, 'Gap'), el('th', {}, 'Ping'))), standingsEl)),
        el('div', { class: 'on-race-r' },
          el('section', { class: 'k-card on-mapcard' }, el('div', { class: 'k-cap' }, 'TRACK · LIVE'), mapCanvas),
          el('section', { class: 'k-card on-chat' }, el('div', { class: 'k-cap' }, 'ROOM CHAT'), chatLog, el('div', { class: 'row' }, input))));
    }

    function friendsView() {
      return el('div', { class: 'on-friends' },
        drivers.map((d) => el('section', { class: 'k-card on-friend' },
          el('div', { class: 'on-avatar', style: { background: `linear-gradient(135deg, ${d.car}, #0b1116)` } }, d.handle.slice(0, 2).toUpperCase()),
          el('div', { class: 'on-friend-b' }, el('strong', {}, d.handle), el('small', { class: 'muted' }, `${d.status} · ${room ? 'in your room' : 'no room'}`)),
          bars(d.pingNow),
          el('button', { class: 'k-btn ghost', onclick: () => ctx.toast(`Invite sent to ${d.handle}`, 'info') }, 'Invite'))));
    }

    function boardView() {
      const rows = [...drivers.map((d) => ({ name: d.handle, lap: 81.2 + (d.offset % 7) * 0.09 + d.ping * 0.01, car: d.car })),
        { name: youHandle, lap: ctx.sim.bestLap ?? 81.46, car: accent, you: true }].sort((a, b) => a.lap - b.lap);
      return el('section', { class: 'k-card on-board' }, el('div', { class: 'k-cap' }, 'MONZA SPRINT · BEST LAP'),
        el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'P'), el('th', {}, 'Driver'), el('th', {}, 'Best lap'), el('th', {}, 'Gap'))),
          el('tbody', {}, rows.map((r, i) => el('tr', { class: r.you ? 'own' : '' },
            el('td', {}, String(i + 1)), el('td', {}, el('i', { class: 'dot', style: { background: r.car } }), r.name),
            el('td', {}, r.lap.toFixed(3)), el('td', {}, i === 0 ? '—' : `+${(r.lap - rows[0].lap).toFixed(3)}`))))));
    }

    let standingsEl = null, chatLog = null, mapCanvas = null, map = null;
    function renderChat() {
      if (!chatLog) return;
      chatLog.replaceChildren(...chat.slice(-30).map((m) => el('div', { class: `msg ${m.you ? 'you' : ''}` }, el('b', {}, m.who), el('span', {}, m.text))));
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function render() {
      map?.dispose(); map = null;
      nav.set(tab);
      roomBadge.className = `k-badge ${room ? 'ok' : ''}`;
      roomBadge.textContent = room ? `In ${room.name}` : 'Not in a room';
      const views = { rooms: roomsView, race: raceView, friends: friendsView, board: boardView };
      content.replaceChildren(views[tab]());
      if (tab === 'race' && room) {
        map = createTrackMap(mapCanvas);
        renderChat();
      }
    }

    function join(r) {
      joining = r.id;
      render();
      setTimeout(() => {
        joining = null;
        room = r;
        youReady = false;
        ctx.toast(`Joined ${r.name}`, 'info');
        render();
      }, 700);
    }
    function leave() {
      room = null;
      youReady = false;
      render();
    }

    // Presence chatter so the room feels alive (replaced by server events in production).
    const chatTimer = setInterval(() => {
      if (!room) return;
      const d = drivers[Math.floor(Math.random() * drivers.length)];
      chat.push({ who: d.handle, text: CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)] });
      if (tab === 'race') renderChat();
    }, 6000);
    const pingTimer = setInterval(() => {
      drivers.forEach((d) => { d.pingNow = Math.max(12, d.ping + Math.round((Math.random() - 0.5) * 14)); });
    }, 2000);

    let lastStandings = 0;
    function update(f) {
      if (!room || tab !== 'race' || !map) return;
      const own = { handle: youHandle, dist: f.distanceM, color: accent, own: true, ping: 9 };
      const others = drivers.map((d) => ({ handle: d.handle, dist: f.distanceM * d.ratio + d.offset, color: d.car, ping: d.pingNow, ready: d.ready }));
      const all = [own, ...others].sort((a, b) => b.dist - a.dist);
      map.draw(all.map((d) => ({ pos: trackAt(TRACK, d.dist), color: d.color, r: d.own ? 7 : 5, label: d.own ? 'YOU' : undefined })));

      const now = performance.now();
      if (now - lastStandings > 300 && standingsEl) {
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

    render();
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
