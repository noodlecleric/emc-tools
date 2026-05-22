import { postNations, postTowns, getOnline } from './api.js';
import { cached, getPref, setPref } from './cache.js';
import { formatGold, formatDate, makeCoordChip, makeEntityLink, makeLastSeenBadge, loadingEl, errorEl, fetchPlayersBatch } from './render.js';
import { makeFavoriteStar } from './favorites.js';
import { makeBreadcrumb } from './breadcrumb.js';

const DAY_MS = 86_400_000;
const DELETION_THRESHOLD_DAYS = 42;
const AT_RISK_WINDOW_DAYS = 7;

const TTL_NATION = 60_000;
const TTL_TOWN_STATS = 60_000;
const TTL_ONLINE = 15_000;
const SORT_PREF_KEY = 'townSort';
const DEFAULT_BOARD = '/nation set board [msg]';

async function fetchNation(name) {
  const res = await cached(`/nations:${name.toLowerCase()}`, TTL_NATION, () => postNations([name]));
  const nation = res && res[0];
  if (!nation) throw new Error(`Nation "${name}" not found`);
  return nation;
}

async function fetchTownStats(townNames) {
  if (townNames.length === 0) return new Map();
  const map = new Map();
  for (let i = 0; i < townNames.length; i += 100) {
    const chunk = townNames.slice(i, i + 100);
    const key = `/towns-batch:${chunk.slice().sort().join(',')}`;
    const towns = await cached(key, TTL_TOWN_STATS, () => postTowns(chunk));
    for (const t of towns ?? []) map.set(t.name.toLowerCase(), t);
  }
  return map;
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

function getPersistedSort() {
  try {
    const raw = getPref(SORT_PREF_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj.column && obj.dir) return obj;
    }
  } catch { /* fallthrough */ }
  return { column: 'balance', dir: 'desc' };
}

function persistSort(sort) {
  setPref(SORT_PREF_KEY, JSON.stringify(sort));
}

function buildTownTable(rows, sort, onSort) {
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.column];
    const bv = b[sort.column];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sort.dir === 'asc' ? (av - bv) : (bv - av);
  });

  const table = document.createElement('table');
  table.className = 'town-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const cols = [
    { key: 'name', label: 'Town', numeric: false },
    { key: 'residents', label: 'Residents', numeric: true },
    { key: 'balance', label: 'Balance', numeric: true },
  ];
  cols.forEach(col => {
    const th = document.createElement('th');
    th.dataset.col = col.key;
    if (col.numeric) th.classList.add('numeric');
    if (col.key === 'balance') th.classList.add('balance-col');
    const arrow = col.key === sort.column ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
    th.textContent = col.label + arrow;
    if (col.key === sort.column) th.classList.add('sorted');
    th.addEventListener('click', () => {
      let next;
      if (sort.column === col.key) next = { column: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
      else next = { column: col.key, dir: col.numeric ? 'desc' : 'asc' };
      onSort(next);
    });
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sorted.forEach(r => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    const link = makeEntityLink('town', r.name);
    nameTd.appendChild(link);
    if (r.isOverClaimed) {
      const pill = document.createElement('span');
      pill.className = 'overclaim-pill table-pill';
      pill.textContent = 'OVER';
      pill.title = 'Currently overclaimed — vulnerable to chunk loss';
      nameTd.append(' ', pill);
    }
    const mobileSuffix = document.createElement('span');
    mobileSuffix.className = 'mobile-balance';
    mobileSuffix.textContent = ` · ${r.balance.toLocaleString()}g`;
    nameTd.appendChild(mobileSuffix);
    const resTd = document.createElement('td');
    resTd.className = 'numeric';
    resTd.textContent = r.residents.toLocaleString();
    const balTd = document.createElement('td');
    balTd.className = 'numeric balance-col';
    balTd.textContent = `${r.balance.toLocaleString()}g`;
    tr.append(nameTd, resTd, balTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderScanResults(container, overclaimed, atRisk, totalTowns) {
  container.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'muted small';
  summary.textContent = `Scanned ${totalTowns} towns · ${overclaimed.length} overclaimed · ${atRisk.length} at-risk`;
  container.appendChild(summary);

  if (overclaimed.length === 0 && atRisk.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'muted';
    ok.textContent = 'No vulnerabilities found.';
    container.appendChild(ok);
    return;
  }

  if (overclaimed.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'scan-section';
    const h4 = document.createElement('h4');
    h4.textContent = `Overclaimed (${overclaimed.length})`;
    sec.appendChild(h4);
    const list = document.createElement('div');
    list.className = 'fav-list';
    for (const item of overclaimed) {
      const rowEl = document.createElement('div');
      rowEl.className = 'fav-row';
      const left = document.createElement('span');
      left.className = 'fav-name';
      left.appendChild(makeEntityLink('town', item.town.name));
      if (item.town.mayor) {
        const sep = document.createElement('span');
        sep.className = 'muted';
        sep.textContent = ' · mayor ';
        left.append(sep, makeEntityLink('player', item.town.mayor.name));
      }
      rowEl.appendChild(left);
      const right = document.createElement('span');
      right.className = 'fav-stat';
      const num = item.town.stats?.numTownBlocks ?? 0;
      const max = item.town.stats?.maxTownBlocks ?? 0;
      const ratio = max > 0 ? Math.round((num / max) * 100) : 0;
      right.textContent = `${num}/${max} (${ratio}%)`;
      rowEl.appendChild(right);
      list.appendChild(rowEl);
    }
    sec.appendChild(list);
    container.appendChild(sec);
  }

  if (atRisk.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'scan-section';
    const h4 = document.createElement('h4');
    h4.textContent = `Mayor inactive ${DELETION_THRESHOLD_DAYS - AT_RISK_WINDOW_DAYS}–${DELETION_THRESHOLD_DAYS} days (${atRisk.length})`;
    sec.appendChild(h4);
    atRisk.sort((a, b) => b.daysInactive - a.daysInactive);
    const list = document.createElement('div');
    list.className = 'fav-list';
    for (const item of atRisk) {
      const rowEl = document.createElement('div');
      rowEl.className = 'fav-row';
      const left = document.createElement('span');
      left.className = 'fav-name';
      left.appendChild(makeEntityLink('town', item.town.name));
      const sep = document.createElement('span');
      sep.className = 'muted';
      sep.textContent = ' · mayor ';
      left.append(sep, makeEntityLink('player', item.mayor.name));
      rowEl.appendChild(left);
      const right = document.createElement('span');
      right.className = 'fav-stat';
      const remaining = DELETION_THRESHOLD_DAYS - item.daysInactive;
      right.textContent = `${item.daysInactive}d inactive · ${remaining}d to deletion`;
      if (remaining <= 3) right.classList.add('urgent');
      rowEl.appendChild(right);
      list.appendChild(rowEl);
    }
    sec.appendChild(list);
    container.appendChild(sec);
  }
}

function onlineResidentCard(resident) {
  const card = document.createElement('a');
  card.className = 'player-card';
  card.href = `?player=${encodeURIComponent(resident.name)}`;
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
  return card;
}

function offlineResidentRow(resident, lastSeen) {
  const rowEl = document.createElement('div');
  rowEl.className = 'offline-resident-row';
  rowEl.appendChild(makeEntityLink('player', resident.name));
  if (lastSeen !== undefined) rowEl.appendChild(makeLastSeenBadge(lastSeen));
  return rowEl;
}

export async function mountNation(container, name) {
  container.replaceChildren(loadingEl(`Loading ${name}…`));

  let nation, online;
  try {
    [nation, online] = await Promise.all([
      fetchNation(name),
      cached('/online', TTL_ONLINE, getOnline),
    ]);
  } catch (err) {
    container.replaceChildren(errorEl(err.message));
    return;
  }

  container.replaceChildren();

  // Breadcrumb
  container.appendChild(makeBreadcrumb([{ type: 'nation', name: nation.name }]));

  // Header with dynmap color accent
  const header = document.createElement('header');
  header.className = 'module-header';
  if (nation.dynmapColour) {
    header.style.borderBottomColor = `#${nation.dynmapColour}`;
    header.style.borderBottomWidth = '3px';
  }
  const h2 = document.createElement('h2');
  h2.textContent = nation.name;
  h2.appendChild(document.createTextNode(' '));
  // Status chips
  if (nation.status?.isPublic) h2.appendChild(makeStatusBadge('Public', 'public'));
  if (nation.status?.isOpen) h2.appendChild(makeStatusBadge('Open', 'open'));
  if (nation.status?.isNeutral) h2.appendChild(makeStatusBadge('Neutral', 'neutral'));
  h2.appendChild(document.createTextNode(' '));
  h2.appendChild(makeFavoriteStar('nations', { name: nation.name, uuid: nation.uuid }));
  header.appendChild(h2);

  const subline = document.createElement('span');
  subline.className = 'muted module-subline';
  if (nation.king) {
    subline.append('led by ', makeEntityLink('player', nation.king.name));
  }
  if (nation.wiki) {
    if (nation.king) subline.append(' · ');
    const wikiLink = document.createElement('a');
    wikiLink.href = nation.wiki;
    wikiLink.target = '_blank';
    wikiLink.rel = 'noopener';
    wikiLink.className = 'wiki-link';
    wikiLink.textContent = 'Wiki ↗';
    subline.appendChild(wikiLink);
  }
  if (subline.childNodes.length > 0) header.appendChild(subline);

  // Online count subheader (e.g. "7 of 101 online") — this is where the topbar count moved to
  const residents = nation.residents ?? [];
  const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);
  const onlineResidents = residents.filter(r => onlineUuids.has(r.uuid));
  const onlineHeader = document.createElement('span');
  onlineHeader.className = 'nation-online-count';
  onlineHeader.textContent = `${onlineResidents.length} of ${residents.length} online`;
  header.appendChild(onlineHeader);

  container.appendChild(header);

  // Board (skip if default placeholder)
  if (nation.board && nation.board !== DEFAULT_BOARD) {
    const boardEl = document.createElement('p');
    boardEl.className = 'nation-board';
    boardEl.textContent = nation.board;
    container.appendChild(boardEl);
  }

  // Stats grid
  const stats = document.createElement('div');
  stats.className = 'detail-grid';
  const s = nation.stats ?? {};

  stats.append(...row('Residents', valueText(String(s.numResidents ?? 0))));
  stats.append(...row('Towns', valueText(String(s.numTowns ?? 0))));
  if (s.numTownBlocks != null) {
    stats.append(...row('Area', valueText(`${s.numTownBlocks.toLocaleString()} blocks`)));
  }
  stats.append(...row('Allies', valueText(String(s.numAllies ?? 0))));
  stats.append(...row('Enemies', valueText(String(s.numEnemies ?? 0))));
  if (s.numOutlaws != null && s.numOutlaws > 0) {
    stats.append(...row('Outlaws', valueText(String(s.numOutlaws))));
  }
  stats.append(...row('Bank', valueText(formatGold(s.balance))));
  if (s.nationBonus != null) {
    const v = valueText(`${s.nationBonus.toLocaleString()} blocks`);
    v.title = 'Bonus town blocks granted by nation size (Towny mechanic)';
    stats.append(...row('Bonus', v));
  }
  if (nation.timestamps?.registered) {
    stats.append(...row('Founded', valueText(formatDate(nation.timestamps.registered))));
  }
  if (nation.capital) {
    stats.append(...row('Capital', valueNode(makeEntityLink('town', nation.capital.name))));
  }
  if (nation.coordinates?.spawn) {
    const { x, z } = nation.coordinates.spawn;
    stats.append(...row('Spawn', valueNode(makeCoordChip(x, z))));
  }
  container.appendChild(stats);

  // Online residents (avatars grid)
  const onlineSec = document.createElement('section');
  onlineSec.className = 'detail-section';
  const onlineH3 = document.createElement('h3');
  onlineH3.textContent = `Online (${onlineResidents.length})`;
  onlineSec.appendChild(onlineH3);
  if (onlineResidents.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `No ${nation.name} residents online right now.`;
    onlineSec.appendChild(p);
  } else {
    const grid = document.createElement('div');
    grid.className = 'roster-list';
    for (const r of onlineResidents) grid.appendChild(onlineResidentCard(r));
    onlineSec.appendChild(grid);
  }
  container.appendChild(onlineSec);

  // Offline residents (collapsible, async-enriched with last-seen)
  const offlineResidents = residents.filter(r => !onlineUuids.has(r.uuid));
  const offlineSec = document.createElement('details');
  offlineSec.className = 'detail-section offline-collapsible';
  const offlineSummary = document.createElement('summary');
  offlineSummary.textContent = `Offline (${offlineResidents.length})`;
  offlineSec.appendChild(offlineSummary);
  const offlineList = document.createElement('div');
  offlineList.className = 'offline-residents';
  offlineSec.appendChild(offlineList);
  container.appendChild(offlineSec);

  if (offlineResidents.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Everyone is online.';
    offlineList.appendChild(p);
  } else {
    // Render immediately without last-seen badges
    for (const r of offlineResidents) offlineList.appendChild(offlineResidentRow(r));
    // Enrich with last-seen async
    fetchPlayersBatch(offlineResidents.map(r => r.uuid)).then(map => {
      const enriched = offlineResidents
        .map(r => ({ ...r, lastOnline: map.get(r.uuid)?.timestamps?.lastOnline ?? null }))
        .sort((a, b) => (b.lastOnline ?? 0) - (a.lastOnline ?? 0));
      offlineList.replaceChildren();
      for (const r of enriched) offlineList.appendChild(offlineResidentRow(r, r.lastOnline));
    }).catch((err) => {
      console.warn('Failed to enrich offline residents with last-seen', err);
    });
  }

  // Towns section — sortable table
  if (nation.towns?.length) {
    const section = document.createElement('section');
    section.className = 'detail-section';
    const h3 = document.createElement('h3');
    h3.textContent = `Towns (${nation.towns.length})`;
    section.appendChild(h3);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(loadingEl('Loading town sizes…'));
    section.appendChild(wrap);
    container.appendChild(section);

    let statsMap;
    try {
      statsMap = await fetchTownStats(nation.towns.map(t => t.name));
    } catch (err) {
      wrap.replaceChildren(errorEl(err.message));
      statsMap = null;
    }

    if (statsMap) {
      const rows = nation.towns.map(t => {
        const full = statsMap.get(t.name.toLowerCase()) ?? {};
        const ts = full.stats ?? {};
        return {
          name: t.name,
          residents: ts.numResidents ?? 0,
          balance: Math.round(ts.balance ?? 0),
          isOverClaimed: full.status?.isOverClaimed ?? false,
          mayorUuid: full.mayor?.uuid ?? null,
        };
      });

      let sort = getPersistedSort();

      function rerender(newSort) {
        sort = newSort;
        persistSort(sort);
        wrap.replaceChildren(buildTownTable(rows, sort, rerender));
      }

      wrap.replaceChildren(buildTownTable(rows, sort, rerender));

      // Vulnerability scan
      const scanSec = document.createElement('section');
      scanSec.className = 'detail-section';
      const scanControls = document.createElement('div');
      scanControls.className = 'module-controls';
      const scanBtn = document.createElement('button');
      scanBtn.type = 'button';
      scanBtn.className = 'refresh-btn-large';
      const scanIcon = document.createElement('span');
      scanIcon.className = 'icon';
      scanIcon.textContent = '⚠';
      const scanLabel = document.createElement('span');
      scanLabel.textContent = 'Scan for vulnerable towns';
      scanBtn.append(scanIcon, scanLabel);
      scanControls.appendChild(scanBtn);
      const scanHint = document.createElement('span');
      scanHint.className = 'muted small';
      scanHint.textContent = '+1 batched API call · finds overclaimed towns and mayors near 42-day deletion';
      scanControls.appendChild(scanHint);
      scanSec.appendChild(scanControls);
      const scanResults = document.createElement('div');
      scanResults.className = 'scan-results';
      scanSec.appendChild(scanResults);
      container.appendChild(scanSec);

      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        scanBtn.classList.add('spinning');
        scanResults.replaceChildren(loadingEl('Scanning mayors…'));
        try {
          const mayorUuids = rows.map(r => r.mayorUuid).filter(Boolean);
          const mayors = mayorUuids.length > 0 ? await fetchPlayersBatch(mayorUuids) : new Map();
          const now = Date.now();
          const overclaimed = [];
          const atRisk = [];
          for (const r of rows) {
            const full = statsMap.get(r.name.toLowerCase());
            if (!full) continue;
            if (r.isOverClaimed) overclaimed.push({ town: full });
            if (r.mayorUuid) {
              const mayor = mayors.get(r.mayorUuid);
              const lastOnline = mayor?.timestamps?.lastOnline;
              if (lastOnline) {
                const daysInactive = Math.floor((now - lastOnline) / DAY_MS);
                if (daysInactive >= DELETION_THRESHOLD_DAYS - AT_RISK_WINDOW_DAYS
                    && daysInactive < DELETION_THRESHOLD_DAYS + 1) {
                  atRisk.push({ town: full, mayor, daysInactive });
                }
              }
            }
          }
          renderScanResults(scanResults, overclaimed, atRisk, rows.length);
        } catch (err) {
          console.error(err);
          scanResults.replaceChildren(errorEl(`Scan failed: ${err.message}`));
        } finally {
          scanBtn.disabled = false;
          scanBtn.classList.remove('spinning');
        }
      });
    }
  }

  // Allies / enemies
  for (const [key, label] of [['allies', 'Allies'], ['enemies', 'Enemies']]) {
    const arr = nation[key];
    if (!arr?.length) continue;
    const section = document.createElement('section');
    section.className = 'detail-section';
    const h3 = document.createElement('h3');
    h3.textContent = `${label} (${arr.length})`;
    section.appendChild(h3);
    const list = document.createElement('div');
    list.className = 'chip-list';
    for (const n of arr) list.appendChild(makeEntityLink('nation', n.name));
    section.appendChild(list);
    container.appendChild(section);
  }
}

function makeStatusBadge(text, kind) {
  const b = document.createElement('span');
  b.className = `status-chip status-${kind}`;
  b.textContent = text;
  return b;
}
