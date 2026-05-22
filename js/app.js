import { fetchTopBarData } from './online.js';
import { fetchPlayer, renderPlayerDetail, mountPlayer } from './player.js';
import { mountNation } from './nation.js';
import { mountTown } from './town.js';
import { mountTownless } from './townless.js';
import { mountTopNations } from './topnations.js';
import { mountFavorites } from './favoritesview.js';
import { getPref, setPref, getCachedNations, getCacheStats } from './cache.js';
import { ApiError, postNations, getApiStats } from './api.js';

const REFRESH_INTERVAL = 30_000;
const RATE_LIMIT_BACKOFF = 5 * 60_000;
const FALLBACK_NATION = 'Aba';

const topEls = {
  nationSwitcher: document.getElementById('nation-switcher'),
  nationInput: document.getElementById('nation-input'),
  nationName: document.getElementById('nation-name'),
  nationOnline: document.getElementById('nation-online'),
  nationTotal: document.getElementById('nation-total'),
  vpRemaining: document.getElementById('vp-remaining'),
  serverOnline: document.getElementById('server-online'),
  refreshBtn: document.getElementById('refresh-btn'),
  lastRefresh: document.getElementById('last-refresh'),
};

const searchEls = {
  input: document.getElementById('search-input'),
  go: document.getElementById('search-go'),
  suggestions: document.getElementById('search-suggestions'),
  types: document.querySelectorAll('.search-type'),
};

const apiStatsEl = document.getElementById('api-stats');

const mainView = document.getElementById('main-view');

let currentNation = resolveTopBarNation();
let lastRefreshTime = null;
let lastData = null;
let refreshToken = 0;
let pausedUntil = 0;
let defaultViewUpdater = null;
let selectedCardEl = null;

function resolveTopBarNation() {
  const stored = getPref('defaultNation');
  if (stored) return stored;
  const params = new URLSearchParams(location.search);
  const urlNation = params.get('nation');
  if (urlNation) return urlNation;
  return FALLBACK_NATION;
}

// ============================================================
// SPA navigation
// ============================================================

document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || !(href.startsWith('?') || href === '?')) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const url = new URL(link.href, location.origin);
  history.pushState({}, '', url);
  route();
});

window.addEventListener('popstate', route);

// ============================================================
// Router
// ============================================================

function highlightNav(target) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === target);
  });
}

function route() {
  const params = new URLSearchParams(location.search);
  defaultViewUpdater = null;
  if (params.has('nation')) {
    highlightNav(null);
    mountNation(mainView, params.get('nation'));
  } else if (params.has('town')) {
    highlightNav(null);
    mountTown(mainView, params.get('town'));
  } else if (params.has('player')) {
    highlightNav(null);
    mountPlayer(mainView, params.get('player'));
  } else if (params.get('view') === 'townless') {
    highlightNav('townless');
    mountTownless(mainView);
  } else if (params.get('view') === 'nations') {
    highlightNav('nations');
    mountTopNations(mainView);
  } else if (params.get('view') === 'favorites') {
    highlightNav('favorites');
    mountFavorites(mainView);
  } else {
    highlightNav('default');
    mountDefaultView();
  }
}

// ============================================================
// Default view (top bar's nation roster + click-for-popover)
// ============================================================

function mountDefaultView() {
  mainView.replaceChildren();

  const roster = document.createElement('section');
  roster.className = 'roster';
  roster.id = 'default-roster';

  const h2 = document.createElement('h2');
  h2.textContent = 'Online now';
  roster.appendChild(h2);

  const list = document.createElement('div');
  list.className = 'roster-list';
  list.id = 'roster-list';
  list.setAttribute('aria-live', 'polite');
  const loadingP = document.createElement('p');
  loadingP.className = 'muted';
  loadingP.textContent = 'Loading…';
  list.appendChild(loadingP);
  roster.appendChild(list);

  const popover = document.createElement('section');
  popover.className = 'player-detail';
  popover.id = 'player-detail';
  popover.hidden = true;
  popover.setAttribute('aria-labelledby', 'player-detail-name');

  const popHeader = document.createElement('header');
  popHeader.className = 'player-detail-header';
  const popH2 = document.createElement('h2');
  popH2.id = 'player-detail-name';
  popH2.textContent = '…';
  const popClose = document.createElement('button');
  popClose.className = 'close-btn';
  popClose.id = 'player-detail-close';
  popClose.type = 'button';
  popClose.setAttribute('aria-label', 'Close');
  popClose.textContent = '×';
  popClose.addEventListener('click', closePopover);
  popHeader.append(popH2, popClose);

  const popBody = document.createElement('div');
  popBody.className = 'player-detail-body';
  popBody.id = 'player-detail-body';
  const popLoading = document.createElement('p');
  popLoading.className = 'muted';
  popLoading.textContent = 'Loading…';
  popBody.appendChild(popLoading);

  popover.append(popHeader, popBody);
  mainView.append(roster, popover);

  selectedCardEl = null;
  defaultViewUpdater = (data) => updateRosterFromData(data);
  if (lastData) updateRosterFromData(lastData);
}

function updateRosterFromData(data) {
  const list = document.getElementById('roster-list');
  if (!list) return;
  list.replaceChildren();
  const players = data.onlineResidents ?? [];
  if (players.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    const server = data.serverOnline != null ? ` ${data.serverOnline.toLocaleString()} others on the server.` : '';
    p.textContent = `No ${data.nation.name} residents online.${server}`;
    list.appendChild(p);
    return;
  }
  for (const player of players) list.appendChild(rosterCard(player));
}

function rosterCard(player) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'player-card';
  card.dataset.uuid = player.uuid;
  card.dataset.name = player.name;
  card.title = player.name;

  const img = document.createElement('img');
  img.src = `https://crafthead.net/avatar/${player.uuid}/48`;
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.loading = 'lazy';
  img.onerror = () => { img.style.visibility = 'hidden'; };

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = player.name;

  card.append(img, name);
  card.addEventListener('click', () => openPopover(card, player));
  return card;
}

async function openPopover(cardEl, listPlayer) {
  const popover = document.getElementById('player-detail');
  const nameH = document.getElementById('player-detail-name');
  const body = document.getElementById('player-detail-body');
  if (!popover) return;

  if (selectedCardEl) selectedCardEl.classList.remove('is-selected');
  cardEl.classList.add('is-selected');
  selectedCardEl = cardEl;

  popover.hidden = false;
  nameH.textContent = listPlayer.name;
  const loading = document.createElement('p');
  loading.className = 'muted';
  loading.textContent = 'Loading…';
  body.replaceChildren(loading);

  try {
    const player = await fetchPlayer(listPlayer.uuid);
    renderPlayerDetail(player, body, nameH);
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to load player: ${err.message}`;
    body.replaceChildren(p);
  }
}

function closePopover() {
  const popover = document.getElementById('player-detail');
  if (popover) popover.hidden = true;
  if (selectedCardEl) selectedCardEl.classList.remove('is-selected');
  selectedCardEl = null;
}

document.addEventListener('keydown', (e) => {
  const popover = document.getElementById('player-detail');
  if (e.key === 'Escape' && popover && !popover.hidden) closePopover();
});

// ============================================================
// Top bar refresh loop
// ============================================================

function formatLastRefresh(ts) {
  if (!ts) return '';
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 5) return 'just now';
  if (ago < 60) return `${ago}s ago`;
  return `${Math.floor(ago / 60)}m ago`;
}

function updateLastRefreshLabel() {
  topEls.lastRefresh.textContent = formatLastRefresh(lastRefreshTime);
}

function updateTopBar(data) {
  topEls.nationName.textContent = data.nation.name;
  topEls.nationOnline.textContent = data.onlineResidents.length;
  topEls.nationTotal.textContent = data.nation.totalResidents;
  topEls.vpRemaining.textContent = data.voteParty != null ? data.voteParty.toLocaleString() : '—';
  topEls.serverOnline.textContent = data.serverOnline != null ? data.serverOnline.toLocaleString() : '—';
}

async function refresh() {
  if (Date.now() < pausedUntil) return;
  const myToken = ++refreshToken;
  topEls.refreshBtn.classList.add('spinning');
  topEls.refreshBtn.disabled = true;
  try {
    const data = await fetchTopBarData(currentNation);
    if (myToken !== refreshToken) return;
    lastData = data;
    updateTopBar(data);
    if (defaultViewUpdater) defaultViewUpdater(data);
    lastRefreshTime = Date.now();
    updateLastRefreshLabel();
  } catch (err) {
    if (myToken !== refreshToken) return;
    console.error(err);
    if (err instanceof ApiError && err.status === 429) {
      pausedUntil = Date.now() + RATE_LIMIT_BACKOFF;
      flashTopBarError('Rate-limited. Backing off 5 min.');
    } else {
      flashTopBarError(`Failed: ${err.message}`);
    }
  } finally {
    if (myToken === refreshToken) {
      topEls.refreshBtn.classList.remove('spinning');
      topEls.refreshBtn.disabled = false;
    }
  }
}

function flashTopBarError(message) {
  const list = document.getElementById('roster-list');
  if (!list) return;
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  list.replaceChildren(p);
}

topEls.refreshBtn.addEventListener('click', refresh);
setInterval(refresh, REFRESH_INTERVAL);
setInterval(updateLastRefreshLabel, 1000);

// ============================================================
// Nation switcher (inline edit in top bar)
// ============================================================

function setupNationSwitcher() {
  const { nationSwitcher: btn, nationInput: input } = topEls;

  function cancelEdit() {
    btn.hidden = false;
    input.hidden = true;
    input.classList.remove('invalid');
  }

  btn.addEventListener('click', () => {
    input.value = currentNation;
    btn.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });

  input.addEventListener('blur', cancelEdit);

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') return cancelEdit();
    if (e.key !== 'Enter') {
      input.classList.remove('invalid');
      return;
    }
    const value = input.value.trim();
    if (!value || value.toLowerCase() === currentNation.toLowerCase()) return cancelEdit();
    input.disabled = true;
    try {
      const res = await postNations([value]);
      const found = res?.[0];
      if (!found) {
        input.classList.add('invalid');
        input.disabled = false;
        return;
      }
      currentNation = found.name;
      setPref('defaultNation', currentNation);
      cancelEdit();
      input.disabled = false;
      refresh();
    } catch (err) {
      console.error(err);
      input.classList.add('invalid');
      input.disabled = false;
    }
  });
}

setupNationSwitcher();

// ============================================================
// Search bar (Nation/Town/Player with nation autocomplete)
// ============================================================

function setupSearch() {
  const { input, go, suggestions, types } = searchEls;
  let currentType = 'nation';
  let nationsList = null;

  function setType(type) {
    currentType = type;
    types.forEach(b => b.classList.toggle('active', b.dataset.type === type));
    input.placeholder = type === 'nation' ? 'Search nations…'
      : type === 'town' ? 'Town name…'
      : 'Player name…';
    updateSuggestions();
  }

  function submitSearch() {
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    history.pushState({}, '', `?${currentType}=${encodeURIComponent(value)}`);
    route();
    input.value = '';
    suggestions.hidden = true;
  }

  types.forEach(btn => btn.addEventListener('click', () => setType(btn.dataset.type)));
  go.addEventListener('click', submitSearch);

  async function updateSuggestions() {
    if (currentType !== 'nation') {
      suggestions.hidden = true;
      return;
    }
    if (!nationsList) {
      try { nationsList = await getCachedNations(); }
      catch { nationsList = []; }
    }
    const q = input.value.trim().toLowerCase();
    if (!q) { suggestions.hidden = true; return; }
    const matches = nationsList
      .filter(n => n.name.toLowerCase().includes(q))
      .slice(0, 8);
    if (matches.length === 0) { suggestions.hidden = true; return; }
    suggestions.replaceChildren();
    matches.forEach(n => {
      const item = document.createElement('a');
      item.href = `?nation=${encodeURIComponent(n.name)}`;
      item.className = 'search-suggestion';
      item.textContent = n.name;
      item.addEventListener('click', () => {
        input.value = '';
        suggestions.hidden = true;
      });
      suggestions.appendChild(item);
    });
    suggestions.hidden = false;
  }

  input.addEventListener('input', updateSuggestions);
  input.addEventListener('focus', updateSuggestions);
  input.addEventListener('blur', () => {
    setTimeout(() => { suggestions.hidden = true; }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitSearch();
    } else if (e.key === 'Escape') {
      input.value = '';
      suggestions.hidden = true;
      input.blur();
    }
  });
}

setupSearch();

// ============================================================
// API stats counter (visible in topbar)
// ============================================================

const apiMinEl = document.getElementById('api-min');
const apiTotalEl = document.getElementById('api-total');
const cachePctEl = document.getElementById('cache-pct');
let sessionApiTotal = 0;
let lastSeenLogLength = 0;

function updateApiStats() {
  if (!apiStatsEl) return;
  const api = getApiStats();
  const cache = getCacheStats();
  const hitPct = cache.total > 0 ? Math.round(cache.hitRate * 100) : 0;
  // api.total is the rolling log length (pruned to 1 hour). For a true session total,
  // track increments separately so it never decrements when old entries age out.
  if (api.total > lastSeenLogLength) {
    sessionApiTotal += api.total - lastSeenLogLength;
  } else if (api.total < lastSeenLogLength) {
    // log pruned older entries; we still count what we already counted
  }
  lastSeenLogLength = api.total;

  if (apiMinEl) apiMinEl.textContent = api.lastMin;
  if (apiTotalEl) apiTotalEl.textContent = sessionApiTotal;
  if (cachePctEl) cachePctEl.textContent = hitPct;
  apiStatsEl.classList.toggle('warn', api.lastMin > 150);
  apiStatsEl.classList.toggle('approaching', api.lastMin > 90 && api.lastMin <= 150);
}

setInterval(updateApiStats, 3000);
updateApiStats();

// ============================================================
// Boot
// ============================================================

route();
refresh();
