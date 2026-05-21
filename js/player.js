import { postPlayers } from './api.js';
import { cached } from './cache.js';

const TTL_PLAYER = 30_000;

export async function fetchPlayer(nameOrUuid) {
  const key = `/players:${nameOrUuid.toLowerCase()}`;
  const res = await cached(key, TTL_PLAYER, () => postPlayers([nameOrUuid]));
  const player = res && res[0];
  if (!player) throw new Error(`Player "${nameOrUuid}" not found`);
  return player;
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function rowEl(label, valueEl, dim = false) {
  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const val = typeof valueEl === 'string' ? document.createElement('div') : valueEl;
  if (typeof valueEl === 'string') {
    val.className = `value${dim ? ' dim' : ''}`;
    val.textContent = valueEl;
  }
  return [labelEl, val];
}

export function renderPlayerDetail(player, container, nameHeader) {
  const status = player.status ?? {};
  const stats = player.stats ?? {};
  const ts = player.timestamps ?? {};

  // Header: formatted name + status badges
  nameHeader.replaceChildren();
  const nameSpan = document.createElement('span');
  nameSpan.textContent = player.formattedName ?? player.name;
  nameHeader.appendChild(nameSpan);

  if (status.isOnline) {
    const b = document.createElement('span');
    b.className = 'badge online';
    b.textContent = 'Online';
    nameHeader.appendChild(b);
  }
  if (status.isKing) {
    const b = document.createElement('span');
    b.className = 'badge king';
    b.textContent = 'King';
    nameHeader.appendChild(b);
  } else if (status.isMayor) {
    const b = document.createElement('span');
    b.className = 'badge mayor';
    b.textContent = 'Mayor';
    nameHeader.appendChild(b);
  }

  // Body rows
  container.replaceChildren();
  const append = (...els) => els.forEach(e => container.appendChild(e));

  append(...rowEl('Town', player.town?.name ?? '—', !player.town));
  append(...rowEl('Nation', player.nation?.name ?? '—', !player.nation));
  append(...rowEl('Last online', status.isOnline ? 'Online now' : formatRelative(ts.lastOnline)));
  append(...rowEl('Registered', formatDate(ts.registered), !ts.registered));

  if ('balance' in stats) {
    append(...rowEl('Balance', stats.balance.toFixed(2)));
  } else {
    append(...rowEl('Balance', 'private', true));
  }

  if (player.about) {
    append(...rowEl('About', player.about));
  }
}
