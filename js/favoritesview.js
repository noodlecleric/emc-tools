import { postNations, postTowns, postPlayers, getOnline } from './api.js';
import { cached } from './cache.js';
import { getFavorites, reorderFavorite } from './favorites.js';
import { formatGold, makeEntityLink, makeLastSeenBadge, loadingEl, errorEl } from './render.js';

const TTL_ONLINE = 15_000;
const TTL_BATCH = 60_000;

function sectionEl(title, count) {
  const sec = document.createElement('section');
  sec.className = 'detail-section favorites-section';
  const h3 = document.createElement('h3');
  h3.textContent = `${title} (${count})`;
  sec.appendChild(h3);
  return sec;
}

function emptyEl(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

function favoriteRow(entityType, name, statsNode, idx, onReorder) {
  const row = document.createElement('div');
  row.className = `fav-row fav-row-${entityType}`;
  row.draggable = true;
  row.dataset.idx = String(idx);

  const handle = document.createElement('span');
  handle.className = 'fav-drag-handle';
  handle.textContent = '⋮⋮';
  handle.title = 'Drag to reorder';
  row.appendChild(handle);

  const linkWrap = document.createElement('span');
  linkWrap.className = 'fav-name';
  linkWrap.appendChild(makeEntityLink(entityType, name));
  row.appendChild(linkWrap);

  const stat = document.createElement('span');
  stat.className = 'fav-stat';
  if (typeof statsNode === 'string') {
    stat.textContent = statsNode;
  } else if (statsNode) {
    stat.appendChild(statsNode);
  }
  row.appendChild(stat);

  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIdx = parseInt(row.dataset.idx, 10);
    if (Number.isInteger(fromIdx) && Number.isInteger(toIdx) && fromIdx !== toIdx) {
      onReorder(fromIdx, toIdx);
    }
  });

  return row;
}

function reorderAndRemount(container, type, fromIdx, toIdx) {
  reorderFavorite(type, fromIdx, toIdx);
  mountFavorites(container);
}

export async function mountFavorites(container) {
  container.replaceChildren();

  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Favorites';
  header.appendChild(h2);
  const subhead = document.createElement('span');
  subhead.className = 'muted';
  subhead.textContent = 'pinned entities · stored in your browser only';
  header.appendChild(subhead);
  container.appendChild(header);

  const favs = getFavorites();

  // ---- Nations ----
  const nationsSec = sectionEl('Nations', favs.nations.length);
  container.appendChild(nationsSec);
  if (favs.nations.length === 0) {
    nationsSec.appendChild(emptyEl('No favorited nations. Star one from any nation page.'));
  } else {
    const list = document.createElement('div');
    list.className = 'fav-list';
    nationsSec.appendChild(list);
    list.appendChild(loadingEl('Fetching nation data…'));
    try {
      const [data, online] = await Promise.all([
        cached(`/nations-batch:fav:${favs.nations.map(n => n.name.toLowerCase()).sort().join(',')}`, TTL_BATCH,
          () => postNations(favs.nations.map(n => n.name))),
        cached('/online', TTL_ONLINE, getOnline),
      ]);
      const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);
      list.replaceChildren();
      for (const fav of favs.nations) {
        const found = data?.find(n => n.name.toLowerCase() === fav.name.toLowerCase());
        if (!found) {
          list.appendChild(favoriteRow('nation', fav.name, 'not found', favs.nations.indexOf(fav), (f, t) => reorderAndRemount(container, 'nations', f, t)));
          continue;
        }
        const residents = found.residents ?? [];
        const onlineCount = residents.filter(r => onlineUuids.has(r.uuid)).length;
        list.appendChild(favoriteRow('nation', found.name, `${onlineCount}/${residents.length} online`, favs.nations.indexOf(fav), (f, t) => reorderAndRemount(container, 'nations', f, t)));
      }
    } catch (err) {
      console.error(err);
      list.replaceChildren(errorEl(`Failed: ${err.message}`));
    }
  }

  // ---- Towns ----
  const townsSec = sectionEl('Towns', favs.towns.length);
  container.appendChild(townsSec);
  if (favs.towns.length === 0) {
    townsSec.appendChild(emptyEl('No favorited towns. Star one from any town page.'));
  } else {
    const list = document.createElement('div');
    list.className = 'fav-list';
    townsSec.appendChild(list);
    list.appendChild(loadingEl('Fetching town data…'));
    try {
      const [data, online] = await Promise.all([
        cached(`/towns-batch:fav:${favs.towns.map(t => t.name.toLowerCase()).sort().join(',')}`, TTL_BATCH,
          () => postTowns(favs.towns.map(t => t.name))),
        cached('/online', TTL_ONLINE, getOnline),
      ]);
      const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);
      list.replaceChildren();
      for (const fav of favs.towns) {
        const found = data?.find(t => t.name.toLowerCase() === fav.name.toLowerCase());
        if (!found) {
          list.appendChild(favoriteRow('town', fav.name, 'not found', favs.towns.indexOf(fav), (f, t) => reorderAndRemount(container, 'towns', f, t)));
          continue;
        }
        const residents = found.residents ?? [];
        const onlineCount = residents.filter(r => onlineUuids.has(r.uuid)).length;
        const isOver = found.status?.isOverClaimed;
        const stat = document.createElement('span');
        const text = document.createTextNode(`${onlineCount}/${residents.length} online · ${formatGold(found.stats?.balance)}`);
        stat.appendChild(text);
        if (isOver) {
          const pill = document.createElement('span');
          pill.className = 'overclaim-pill';
          pill.textContent = 'OVER';
          stat.append(' ', pill);
        }
        list.appendChild(favoriteRow('town', found.name, stat, favs.towns.indexOf(fav), (f, t) => reorderAndRemount(container, 'towns', f, t)));
      }
    } catch (err) {
      console.error(err);
      list.replaceChildren(errorEl(`Failed: ${err.message}`));
    }
  }

  // ---- Players ----
  const playersSec = sectionEl('Players', favs.players.length);
  container.appendChild(playersSec);
  if (favs.players.length === 0) {
    playersSec.appendChild(emptyEl('No favorited players. Star one from any player page or popover.'));
  } else {
    const list = document.createElement('div');
    list.className = 'fav-list';
    playersSec.appendChild(list);
    list.appendChild(loadingEl('Fetching player data…'));
    try {
      // Prefer UUID, fall back to name
      const lookups = favs.players.map(p => p.uuid || p.name);
      const [data, online] = await Promise.all([
        cached(`/players-batch:fav:${lookups.slice().sort().join(',')}`, TTL_BATCH,
          () => postPlayers(lookups)),
        cached('/online', TTL_ONLINE, getOnline),
      ]);
      const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);
      list.replaceChildren();
      for (const fav of favs.players) {
        const found = data?.find(p =>
          (fav.uuid && p.uuid?.toLowerCase() === fav.uuid.toLowerCase())
          || p.name?.toLowerCase() === fav.name.toLowerCase()
        );
        if (!found) {
          list.appendChild(favoriteRow('player', fav.name, 'not found', favs.players.indexOf(fav), (f, t) => reorderAndRemount(container, 'players', f, t)));
          continue;
        }
        const isOnline = onlineUuids.has(found.uuid);
        const stat = document.createElement('span');
        if (isOnline) {
          const dot = document.createElement('span');
          dot.className = 'online-dot';
          dot.title = 'Online now';
          stat.appendChild(dot);
          stat.append(' Online now');
        } else {
          stat.appendChild(makeLastSeenBadge(found.timestamps?.lastOnline));
        }
        list.appendChild(favoriteRow('player', found.name, stat, favs.players.indexOf(fav), (f, t) => reorderAndRemount(container, 'players', f, t)));
      }
    } catch (err) {
      console.error(err);
      list.replaceChildren(errorEl(`Failed: ${err.message}`));
    }
  }
}
