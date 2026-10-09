import { svgIcon } from '../ui/icons.js';
import { h, button, toast, clamp } from '../ui/widgets.js';
import { state, set } from '../core/store.js';

const LOBBIES = [
  { id: 'L-1042', name: 'Sprint · Monza', max: 8, players: 5, ping: 42 },
  { id: 'L-1043', name: 'Endurance · Spa', max: 12, players: 9, ping: 58 },
  { id: 'L-1044', name: 'Wet qualifying · Silverstone', max: 8, players: 3, ping: 35 },
  { id: 'L-1045', name: 'Time attack · Suzuka', max: 4, players: 2, ping: 77 },
  { id: 'L-1046', name: 'League practice · Interlagos', max: 10, players: 7, ping: 64 },
];

export default {
  id: 'lobby',
  name: 'Multiplayer',
  icon: svgIcon('lobby'),
  color: '#00D2B4',
  group: 'online',
  create() {
    let timer = null;
    const lobbies = LOBBIES.map((l) => ({ ...l }));
    const banner = h('div', { class: 'banner' });
    const list = h('div', { class: 'lobby-list' });
    const current = h('div', { class: 'card' });

    function join(l) {
      if (!state.session.online) { toast('Go online first (status bar or Settings)'); return; }
      set('session.lobbyId', l.id);
      set('session.players', l.players);
      toast(`Joined ${l.name}`);
    }
    function leave() { set('session.lobbyId', null); toast('Left lobby'); }

    function render() {
      const online = state.session.online;
      banner.className = online ? 'banner ok' : 'banner';
      banner.textContent = online
        ? 'Connected · mock server (eu-south-1) · 0 unread invites'
        : 'Offline · showing cached lobbies · joining is disabled';
      list.replaceChildren(...lobbies.map((l) => {
        const joined = state.session.lobbyId === l.id;
        return h('div', { class: 'lobby-row' },
          h('div', {},
            h('div', { class: 'lobby-name', text: l.name }),
            h('div', { class: 'dim', text: `${l.id} · ${l.players}/${l.max} players · ${l.ping} ms` })),
          joined ? button('Leave', leave, 'btn') : button('Join', () => join(l), 'btn primary'));
      }));
      const joined = lobbies.find((l) => l.id === state.session.lobbyId);
      current.replaceChildren(
        h('div', { class: 'card-title', text: 'Current session' }),
        joined
          ? h('div', { class: 'lobby-name', text: `${joined.name}` })
          : h('div', { class: 'dim', text: 'Not in a lobby' }),
        joined ? h('div', { class: 'dim', text: `${state.session.players} players · host sets the rules` }) : null);
    }

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left col' }, banner, h('div', { class: 'card grow' }, h('div', { class: 'card-title', text: 'Open lobbies' }), list)),
      h('div', { class: 'split-right' }, current));

    return {
      el,
      mount() {
        render();
        timer = setInterval(() => {
          for (const l of lobbies) {
            l.players = clamp(l.players + (Math.random() < 0.5 ? -1 : 1), 1, l.max);
            l.ping = clamp(l.ping + Math.round((Math.random() - 0.5) * 8), 20, 140);
          }
          if (state.session.lobbyId) set('session.players', lobbies.find((l) => l.id === state.session.lobbyId).players);
          render();
        }, 2500);
      },
      unmount() { clearInterval(timer); timer = null; },
      update(_s, path) { if (path === '*' || path.startsWith('session')) render(); },
    };
  },
};
