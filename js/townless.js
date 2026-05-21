import { getOnline } from './api.js';
import { cached, getPref, setPref, invalidate } from './cache.js';
import { loadingEl, errorEl, fetchPlayersBatch, makeRegisteredBadge } from './render.js';

const TTL_ONLINE = 15_000;
const HAS_TOWN_TTL = 24 * 60 * 60 * 1000;
const HAS_TOWN_KEY = 'hasTownMap';

function loadHasTownMap() {
  try {
    const raw = getPref(HAS_TOWN_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj));
  } catch { return new Map(); }
}

function saveHasTownMap(map) {
  try {
    setPref(HAS_TOWN_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch { /* quota or private mode */ }
}

function isEntryFresh(entry) {
  return entry && (Date.now() - entry.checkedAt < HAS_TOWN_TTL);
}

async function fetchTownlessOnline() {
  const online = await cached('/online', TTL_ONLINE, getOnline);
  const players = online?.players ?? [];
  if (players.length === 0) return { nomads: [], freshFetches: 0 };

  const map = loadHasTownMap();
  const now = Date.now();

  const unknownUuids = [];
  for (const p of players) {
    if (!isEntryFresh(map.get(p.uuid))) unknownUuids.push(p.uuid);
  }

  let freshFetches = 0;
  if (unknownUuids.length > 0) {
    const fetched = await fetchPlayersBatch(unknownUuids);
    freshFetches = Math.ceil(unknownUuids.length / 100);
    for (const [uuid, player] of fetched) {
      const stats = player.stats ?? {};
      const entry = {
        hasTown: player.status?.hasTown ?? false,
        registered: player.timestamps?.registered ?? null,
        checkedAt: now,
      };
      if ('balance' in stats) entry.balance = stats.balance;
      map.set(uuid, entry);
    }
    saveHasTownMap(map);
  }

  const nomads = [];
  for (const p of players) {
    const entry = map.get(p.uuid);
    if (entry && entry.hasTown === false) {
      nomads.push({
        name: p.name,
        uuid: p.uuid,
        registered: entry.registered,
        balance: entry.balance,
      });
    }
  }
  nomads.sort((a, b) => (b.registered ?? 0) - (a.registered ?? 0));
  return { nomads, freshFetches };
}

function nomadCard(nomad) {
  const card = document.createElement('a');
  card.className = 'player-card';
  card.href = `?player=${encodeURIComponent(nomad.name)}`;
  card.dataset.entity = 'player';
  card.dataset.name = nomad.name;
  card.title = nomad.name;

  const img = document.createElement('img');
  img.src = `https://crafthead.net/avatar/${nomad.uuid}/48`;
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.loading = 'lazy';
  img.onerror = () => { img.style.visibility = 'hidden'; };

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = nomad.name;

  card.append(img, name, makeRegisteredBadge(nomad.registered));
  return card;
}

export async function mountTownless(container) {
  container.replaceChildren();

  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Online nomads';
  header.appendChild(h2);
  const subhead = document.createElement('span');
  subhead.className = 'muted';
  subhead.textContent = 'townless players currently online · manual refresh only';
  header.appendChild(subhead);
  container.appendChild(header);

  const controls = document.createElement('div');
  controls.className = 'module-controls';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'refresh-btn-large';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '⟳';
  const label = document.createElement('span');
  label.textContent = 'Refresh';
  refreshBtn.append(icon, label);
  controls.appendChild(refreshBtn);

  const status = document.createElement('span');
  status.className = 'muted small';
  controls.appendChild(status);

  const legend = document.createElement('span');
  legend.className = 'muted small nomad-legend';
  legend.innerHTML = '<span class="registered-badge tier-fresh">&lt;72h</span><span class="registered-badge tier-recent">&lt;2w</span><span class="registered-badge tier-stale">&lt;5w</span><span class="registered-badge tier-old">5w+</span>';
  controls.appendChild(legend);

  container.appendChild(controls);

  const listSec = document.createElement('section');
  listSec.className = 'detail-section';
  const grid = document.createElement('div');
  grid.className = 'roster-list';
  listSec.appendChild(grid);
  container.appendChild(listSec);

  async function refresh() {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
    grid.replaceChildren(loadingEl('Looking for online nomads…'));
    status.textContent = '';
    invalidate('/online');
    try {
      const start = Date.now();
      const { nomads, freshFetches } = await fetchTownlessOnline();
      const ms = Date.now() - start;
      status.textContent = `${nomads.length} found · ${freshFetches} new lookup${freshFetches === 1 ? '' : 's'} · ${ms}ms`;
      grid.replaceChildren();
      if (nomads.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No online nomads right now.';
        grid.appendChild(p);
        return;
      }
      for (const n of nomads) grid.appendChild(nomadCard(n));
    } catch (err) {
      console.error(err);
      grid.replaceChildren(errorEl(`Failed: ${err.message}`));
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  refreshBtn.addEventListener('click', refresh);
  refresh();
}
