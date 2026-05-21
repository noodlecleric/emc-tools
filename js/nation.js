import { postNations, postTowns } from './api.js';
import { cached, getPref, setPref } from './cache.js';
import { formatGold, formatDate, makeCoordChip, makeEntityLink, loadingEl, errorEl } from './render.js';

const TTL_NATION = 60_000;
const TTL_TOWN_STATS = 60_000;
const SORT_PREF_KEY = 'townSort';

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
    if (typeof av === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
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
      if (sort.column === col.key) {
        next = { column: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        next = { column: col.key, dir: col.numeric ? 'desc' : 'asc' };
      }
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

export async function mountNation(container, name) {
  container.replaceChildren(loadingEl(`Loading ${name}…`));
  let nation;
  try {
    nation = await fetchNation(name);
  } catch (err) {
    container.replaceChildren(errorEl(err.message));
    return;
  }

  container.replaceChildren();

  // Header
  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = nation.name;
  header.appendChild(h2);
  if (nation.king) {
    const wrap = document.createElement('span');
    wrap.className = 'muted';
    wrap.append('led by ', makeEntityLink('player', nation.king.name));
    header.appendChild(wrap);
  }
  container.appendChild(header);

  // Stats grid
  const stats = document.createElement('div');
  stats.className = 'detail-grid';
  const s = nation.stats ?? {};

  stats.append(...row('Residents', valueText(String(s.numResidents ?? 0))));
  stats.append(...row('Towns', valueText(String(s.numTowns ?? 0))));
  stats.append(...row('Allies', valueText(String(s.numAllies ?? 0))));
  stats.append(...row('Enemies', valueText(String(s.numEnemies ?? 0))));
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
      // skip the table; still render allies/enemies below
      statsMap = null;
    }

    if (statsMap) {
      const rows = nation.towns.map(t => {
        const ts = statsMap.get(t.name.toLowerCase())?.stats ?? {};
        return {
          name: t.name,
          residents: ts.numResidents ?? 0,
          balance: Math.round(ts.balance ?? 0),
        };
      });

      let sort = getPersistedSort();

      function rerender(newSort) {
        sort = newSort;
        persistSort(sort);
        wrap.replaceChildren(buildTownTable(rows, sort, rerender));
      }

      wrap.replaceChildren(buildTownTable(rows, sort, rerender));
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
