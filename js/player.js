import { postPlayers } from './api.js';
import { cached } from './cache.js';
import { formatGold, formatDate, formatDateTime, formatRelative, makeEntityLink, makeBadge, loadingEl, errorEl } from './render.js';
import { makeFavoriteStar } from './favorites.js';
import { makeBreadcrumb } from './breadcrumb.js';

const TTL_PLAYER = 30_000;

export async function fetchPlayer(nameOrUuid) {
  const key = `/players:${nameOrUuid.toLowerCase()}`;
  const res = await cached(key, TTL_PLAYER, () => postPlayers([nameOrUuid]));
  const player = res && res[0];
  if (!player) throw new Error(`Player "${nameOrUuid}" not found`);
  return player;
}

function rowEls(label, valueEl, dim = false) {
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  if (typeof valueEl === 'string') {
    const v = document.createElement('div');
    v.className = `value${dim ? ' dim' : ''}`;
    v.textContent = valueEl;
    return [l, v];
  }
  return [l, valueEl];
}

function renderHeader(nameContainer, player) {
  nameContainer.replaceChildren();
  const nameSpan = document.createElement('span');
  nameSpan.textContent = player.formattedName ?? player.name;
  nameContainer.appendChild(nameSpan);

  const s = player.status ?? {};
  if (s.isOnline) nameContainer.appendChild(makeBadge('Online', 'online'));
  if (s.isKing) nameContainer.appendChild(makeBadge('King', 'king'));
  else if (s.isMayor) nameContainer.appendChild(makeBadge('Mayor', 'mayor'));

  nameContainer.appendChild(document.createTextNode(' '));
  nameContainer.appendChild(makeFavoriteStar('players', { name: player.name, uuid: player.uuid }));
}

function renderBody(bodyContainer, player) {
  const status = player.status ?? {};
  const stats = player.stats ?? {};
  const ts = player.timestamps ?? {};

  bodyContainer.replaceChildren();
  const append = (...els) => els.forEach(e => bodyContainer.appendChild(e));

  if (player.town) {
    const v = document.createElement('div');
    v.className = 'value';
    v.appendChild(makeEntityLink('town', player.town.name));
    append(...rowEls('Town', v));
  } else {
    append(...rowEls('Town', 'townless', true));
  }

  if (player.nation) {
    const v = document.createElement('div');
    v.className = 'value';
    v.appendChild(makeEntityLink('nation', player.nation.name));
    append(...rowEls('Nation', v));
  } else {
    append(...rowEls('Nation', '—', true));
  }

  if (status.isOnline) {
    append(...rowEls('Last online', 'Online now'));
  } else if (ts.lastOnline) {
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = `${formatRelative(ts.lastOnline)} · ${formatDateTime(ts.lastOnline)}`;
    append(...rowEls('Last online', v));
  } else {
    append(...rowEls('Last online', '—', true));
  }

  if (ts.joinedTownAt) {
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = formatDate(ts.joinedTownAt);
    v.title = 'Date this player joined their current town. The API does not track nation-join dates directly; this resets if a player switches towns within the same nation.';
    append(...rowEls('Joined town', v));
  }

  if (ts.registered) {
    append(...rowEls('Registered', formatDate(ts.registered)));
  }

  if ('balance' in stats) {
    append(...rowEls('Balance', formatGold(stats.balance)));
  } else {
    append(...rowEls('Balance', 'private', true));
  }

  if (player.about) {
    const v = document.createElement('div');
    v.className = 'value about-cell';
    v.textContent = player.about;
    append(...rowEls('About', v));
  }
}

// Phase 1 popover render path
export function renderPlayerDetail(player, bodyContainer, nameHeader) {
  renderHeader(nameHeader, player);
  renderBody(bodyContainer, player);
}

// Full-page player module
export async function mountPlayer(container, nameOrUuid) {
  container.replaceChildren(loadingEl(`Loading ${nameOrUuid}…`));
  let player;
  try {
    player = await fetchPlayer(nameOrUuid);
  } catch (err) {
    container.replaceChildren(errorEl(err.message));
    return;
  }

  container.replaceChildren();

  // Breadcrumb: Nation > Town > Player
  const crumbs = [];
  if (player.nation) crumbs.push({ type: 'nation', name: player.nation.name });
  if (player.town) crumbs.push({ type: 'town', name: player.town.name });
  crumbs.push({ type: 'player', name: player.name });
  container.appendChild(makeBreadcrumb(crumbs));

  const card = document.createElement('div');
  card.className = 'player-module';

  const header = document.createElement('header');
  header.className = 'player-module-header';

  const avatar = document.createElement('img');
  avatar.className = 'player-module-avatar';
  avatar.src = `https://crafthead.net/avatar/${player.uuid}/64`;
  avatar.alt = '';
  avatar.width = 64;
  avatar.height = 64;
  avatar.loading = 'lazy';
  avatar.onerror = () => { avatar.style.visibility = 'hidden'; };

  const h2 = document.createElement('h2');
  renderHeader(h2, player);

  header.append(avatar, h2);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'detail-grid';
  renderBody(body, player);
  card.appendChild(body);

  container.appendChild(card);
}
