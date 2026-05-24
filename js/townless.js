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

/**
 * Streams nomads via callbacks:
 *  - onNomad(nomad): one nomad ready to render
 *  - onProgress({ completed, total, nomadsFound, failed }): batch progress
 * Cached nomads emit synchronously after /online resolves;
 * unknown UUIDs are checked in parallel and stream as each chunk finishes.
 */
async function fetchTownlessOnline({ onProgress, onNomad } = {}) {
  let online;
  try {
    online = await cached('/online', TTL_ONLINE, getOnline);
  } catch (err) {
    throw new Error(`Couldn't fetch the online players list (${err.message}). Tap Refresh to retry.`);
  }
  const players = online?.players ?? [];
  if (players.length === 0) {
    if (onProgress) onProgress({ completed: 0, total: 0, nomadsFound: 0, failed: 0 });
    return { freshFetches: 0, failedChunks: 0 };
  }

  const map = loadHasTownMap();
  const now = Date.now();
  const onlineByUuid = new Map();
  for (const p of players) onlineByUuid.set(p.uuid, p);

  let nomadsFound = 0;
  const unknownUuids = [];
  for (const p of players) {
    const entry = map.get(p.uuid);
    if (isEntryFresh(entry)) {
      if (entry.hasTown === false) {
        if (onNomad) onNomad({ name: p.name, uuid: p.uuid, registered: entry.registered });
        nomadsFound++;
      }
    } else {
      unknownUuids.push(p.uuid);
    }
  }

  if (onProgress) onProgress({ completed: 0, total: 0, nomadsFound, failed: 0 });

  if (unknownUuids.length === 0) {
    return { freshFetches: 0, failedChunks: 0 };
  }

  const batchResult = await fetchPlayersBatch(unknownUuids, {
    onChunk: ({ completed, total, failed, players: chunkPlayers }) => {
      for (const player of chunkPlayers) {
        const stats = player.stats ?? {};
        const entry = {
          hasTown: player.status?.hasTown ?? false,
          registered: player.timestamps?.registered ?? null,
          checkedAt: now,
        };
        if ('balance' in stats) entry.balance = stats.balance;
        map.set(player.uuid, entry);

        if (entry.hasTown === false) {
          const onlinePlayer = onlineByUuid.get(player.uuid);
          if (onlinePlayer) {
            if (onNomad) onNomad({
              name: onlinePlayer.name,
              uuid: onlinePlayer.uuid,
              registered: entry.registered,
            });
            nomadsFound++;
          }
        }
      }
      if (onProgress) onProgress({ completed, total, nomadsFound, failed });
    },
  });

  saveHasTownMap(map);

  return { freshFetches: batchResult.totalChunks, failedChunks: batchResult.failedChunks };
}

function nomadCard(nomad) {
  const card = document.createElement('a');
  card.className = 'player-card';
  card.href = `?player=${encodeURIComponent(nomad.name)}`;
  card.dataset.entity = 'player';
  card.dataset.name = nomad.name;
  card.dataset.registered = String(nomad.registered ?? 0);
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

function insertNomadSorted(grid, nomad) {
  const card = nomadCard(nomad);
  const newReg = nomad.registered ?? 0;
  const existingCards = grid.querySelectorAll('.player-card');
  for (const existing of existingCards) {
    const existingReg = parseInt(existing.dataset.registered ?? '0', 10);
    if (newReg > existingReg) {
      grid.insertBefore(card, existing);
      return;
    }
  }
  grid.appendChild(card);
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
      let nomadCount = 0;
      let clearedLoading = false;

      const result = await fetchTownlessOnline({
        onProgress: ({ completed, total, nomadsFound, failed }) => {
          if (total === 0) {
            status.textContent = nomadsFound > 0
              ? `${nomadsFound} from cache · checking new players…`
              : 'Checking online players…';
          } else {
            const failedSuffix = failed > 0 ? ` · ${failed} failed` : '';
            status.textContent = `Checking ${completed}/${total} batches · ${nomadsFound} nomads so far${failedSuffix}`;
          }
        },
        onNomad: (nomad) => {
          if (!clearedLoading) {
            grid.replaceChildren();
            clearedLoading = true;
          }
          insertNomadSorted(grid, nomad);
          nomadCount++;
        },
      });

      const ms = Date.now() - start;

      if (nomadCount === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No online nomads right now.';
        grid.replaceChildren(p);
      }

      const lookupsLabel = `${result.freshFetches} new lookup${result.freshFetches === 1 ? '' : 's'}`;
      const failedSuffix = result.failedChunks > 0 ? ` · ${result.failedChunks} failed` : '';
      status.textContent = `${nomadCount} found · ${lookupsLabel}${failedSuffix} · ${ms}ms`;
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
