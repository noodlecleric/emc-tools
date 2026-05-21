import { postTowns, getOnline } from './api.js';
import { cached } from './cache.js';
import { formatGold, formatDate, makeCoordChip, makeEntityLink, makeLastSeenBadge, loadingEl, errorEl, fetchPlayersBatch } from './render.js';

const TTL_TOWN = 60_000;
const TTL_ONLINE = 15_000;

async function fetchTown(name) {
  const res = await cached(`/towns:${name.toLowerCase()}`, TTL_TOWN, () => postTowns([name]));
  const town = res && res[0];
  if (!town) throw new Error(`Town "${name}" not found`);
  return town;
}

function row(label, valueEl) {
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  return [l, valueEl];
}

function valueText(text) {
  const v = document.createElement('div');
  v.className = 'value';
  v.textContent = text;
  return v;
}

function valueNode(node) {
  const v = document.createElement('div');
  v.className = 'value';
  v.appendChild(node);
  return v;
}

function residentCard(resident, lastSeen) {
  const card = document.createElement('a');
  card.className = 'player-card';
  card.href = `?player=${encodeURIComponent(resident.name)}`;
  card.dataset.entity = 'player';
  card.dataset.name = resident.name;
  card.title = resident.name;

  const img = document.createElement('img');
  img.src = `https://crafthead.net/avatar/${resident.uuid}/48`;
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.loading = 'lazy';
  img.onerror = () => { img.style.visibility = 'hidden'; };

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = resident.name;

  card.append(img, name);
  if (lastSeen !== undefined) card.appendChild(makeLastSeenBadge(lastSeen));
  return card;
}

export async function mountTown(container, name) {
  container.replaceChildren(loadingEl(`Loading ${name}…`));
  let town, online;
  try {
    [town, online] = await Promise.all([
      fetchTown(name),
      cached('/online', TTL_ONLINE, getOnline),
    ]);
  } catch (err) {
    container.replaceChildren(errorEl(err.message));
    return;
  }

  container.replaceChildren();

  // Header
  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = town.name;
  header.appendChild(h2);
  if (town.mayor) {
    const wrap = document.createElement('span');
    wrap.className = 'muted';
    wrap.append('mayor: ', makeEntityLink('player', town.mayor.name));
    header.appendChild(wrap);
  }
  container.appendChild(header);

  // Stats
  const stats = document.createElement('div');
  stats.className = 'detail-grid';
  const s = town.stats ?? {};

  stats.append(...row('Residents', valueText(String(s.numResidents ?? 0))));
  stats.append(...row('Town blocks', valueText(String(s.numTownBlocks ?? 0))));
  stats.append(...row('Bank', valueText(formatGold(s.balance))));
  if (town.timestamps?.registered) {
    stats.append(...row('Founded', valueText(formatDate(town.timestamps.registered))));
  }
  if (town.nation) {
    stats.append(...row('Nation', valueNode(makeEntityLink('nation', town.nation.name))));
  } else {
    stats.append(...row('Nation', valueText('—')));
  }
  if (town.coordinates?.spawn) {
    const { x, z } = town.coordinates.spawn;
    stats.append(...row('Spawn', valueNode(makeCoordChip(x, z))));
  }
  container.appendChild(stats);

  // Residents split
  const residents = town.residents ?? [];
  const onlineSet = new Set(online?.players?.map(p => p.uuid) ?? []);
  const onlineResidents = residents.filter(r => onlineSet.has(r.uuid));
  const offlineResidents = residents.filter(r => !onlineSet.has(r.uuid));

  // Online
  const onlineSec = document.createElement('section');
  onlineSec.className = 'detail-section';
  const onlineH = document.createElement('h3');
  onlineH.textContent = `Online (${onlineResidents.length})`;
  onlineSec.appendChild(onlineH);
  if (onlineResidents.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No residents online.';
    onlineSec.appendChild(p);
  } else {
    const grid = document.createElement('div');
    grid.className = 'roster-list';
    for (const r of onlineResidents) grid.appendChild(residentCard(r));
    onlineSec.appendChild(grid);
  }
  container.appendChild(onlineSec);

  // Offline (with last-seen badges, enriched async)
  const offlineSec = document.createElement('section');
  offlineSec.className = 'detail-section';
  const offlineH = document.createElement('h3');
  offlineH.textContent = `Offline (${offlineResidents.length})`;
  offlineSec.appendChild(offlineH);
  const offlineGrid = document.createElement('div');
  offlineGrid.className = 'roster-list';
  offlineSec.appendChild(offlineGrid);
  container.appendChild(offlineSec);

  if (offlineResidents.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Everyone is online.';
    offlineSec.replaceChild(p, offlineGrid);
  } else {
    // Render initial grid without badges so it appears quickly
    for (const r of offlineResidents) offlineGrid.appendChild(residentCard(r));
    // Enrich with last-seen badges in the background
    try {
      const map = await fetchPlayersBatch(offlineResidents.map(r => r.uuid));
      const enriched = offlineResidents
        .map(r => ({ ...r, lastOnline: map.get(r.uuid)?.timestamps?.lastOnline ?? null }))
        .sort((a, b) => (b.lastOnline ?? 0) - (a.lastOnline ?? 0));
      offlineGrid.replaceChildren();
      for (const r of enriched) offlineGrid.appendChild(residentCard(r, r.lastOnline));
    } catch (err) {
      console.warn('Failed to enrich offline residents with last-seen', err);
      // grid stays without badges
    }
  }
}
