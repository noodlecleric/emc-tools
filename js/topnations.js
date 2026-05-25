import { postNations, getOnline } from './api.js';
import { cached, getPref, setPref } from './cache.js';
import { formatGold, makeEntityLink, loadingEl, errorEl } from './render.js';

const TTL_NATIONS_ENRICHED = 5 * 60_000; // 5 min — residents/balance/area move slowly
const TTL_ONLINE = 15_000;
const SORT_KEY = 'topNationsSort';

async function fetchAllNations() {
  // GET /nations is just name+UUID list — small
  const res = await cached('/nations:listAll', TTL_NATIONS_ENRICHED, async () => {
    const r = await fetch('https://api.earthmc.net/v4/nations');
    if (!r.ok) throw new Error(`Failed to list nations: ${r.status}`);
    return r.json();
  });
  return res;
}

async function fetchEnrichedNations(names) {
  // POST /nations capped at 100 per batch; 131 nations → 2 batches
  const map = new Map();
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const key = `/nations-enriched:${chunk.slice().sort().join(',')}`;
    const data = await cached(key, TTL_NATIONS_ENRICHED, () => postNations(chunk));
    for (const n of data ?? []) map.set(n.name.toLowerCase(), n);
  }
  return map;
}

function getPersistedSort() {
  try {
    const raw = getPref(SORT_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj.column && obj.dir) return obj;
    }
  } catch { /* fallthrough */ }
  return { column: 'residents', dir: 'desc' };
}

function persistSort(s) { setPref(SORT_KEY, JSON.stringify(s)); }

function buildTable(rows, sort, onSort) {
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.column];
    const bv = b[sort.column];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sort.dir === 'asc' ? (av - bv) : (bv - av);
  });

  const table = document.createElement('table');
  table.className = 'town-table cards-on-mobile';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const cols = [
    { key: 'name', label: 'Nation', numeric: false },
    { key: 'residents', label: 'Residents', numeric: true },
    { key: 'towns', label: 'Towns', numeric: true },
    { key: 'online', label: 'Online', numeric: true },
    { key: 'area', label: 'Area', numeric: true },
    { key: 'balance', label: 'Gold', numeric: true },
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
    nameTd.dataset.label = 'Nation';
    nameTd.appendChild(makeEntityLink('nation', r.name));

    const resTd = document.createElement('td');
    resTd.className = 'numeric';
    resTd.dataset.label = 'Residents';
    resTd.textContent = r.residents.toLocaleString();

    const townsTd = document.createElement('td');
    townsTd.className = 'numeric';
    townsTd.dataset.label = 'Towns';
    townsTd.textContent = r.towns.toLocaleString();

    const onlineTd = document.createElement('td');
    onlineTd.className = 'numeric';
    onlineTd.dataset.label = 'Online';
    if (r.online > 0) onlineTd.classList.add('online-count');
    onlineTd.textContent = r.online.toLocaleString();

    const areaTd = document.createElement('td');
    areaTd.className = 'numeric';
    areaTd.dataset.label = 'Area';
    areaTd.textContent = r.area.toLocaleString();

    const balTd = document.createElement('td');
    balTd.className = 'numeric';
    balTd.dataset.label = 'Gold';
    balTd.textContent = `${r.balance.toLocaleString()}g`;

    tr.append(nameTd, resTd, townsTd, onlineTd, areaTd, balTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

export async function mountTopNations(container) {
  container.replaceChildren();

  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Nations';
  header.appendChild(h2);
  const subhead = document.createElement('span');
  subhead.className = 'muted';
  subhead.textContent = 'all 131 nations · sortable · live online counts';
  header.appendChild(subhead);
  container.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.appendChild(loadingEl('Loading nation data (4 API calls)…'));
  container.appendChild(wrap);

  let list, enriched, online;
  try {
    list = await fetchAllNations();
    const names = list.map(n => n.name);
    [enriched, online] = await Promise.all([
      fetchEnrichedNations(names),
      cached('/online', TTL_ONLINE, getOnline),
    ]);
  } catch (err) {
    wrap.replaceChildren(errorEl(err.message));
    return;
  }

  const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);

  const rows = list.map(({ name }) => {
    const n = enriched.get(name.toLowerCase());
    if (!n) {
      return { name, residents: 0, towns: 0, online: 0, area: 0, balance: 0 };
    }
    const residents = n.residents ?? [];
    const onlineCount = residents.filter(r => onlineUuids.has(r.uuid)).length;
    return {
      name: n.name,
      residents: n.stats?.numResidents ?? residents.length,
      towns: n.stats?.numTowns ?? 0,
      online: onlineCount,
      area: n.stats?.numTownBlocks ?? 0,
      balance: Math.round(n.stats?.balance ?? 0),
    };
  });

  let sort = getPersistedSort();

  function rerender(newSort) {
    sort = newSort;
    persistSort(sort);
    wrap.replaceChildren(buildTable(rows, sort, rerender));
  }

  wrap.replaceChildren(buildTable(rows, sort, rerender));
}
