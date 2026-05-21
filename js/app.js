import { fetchTopBarData } from './online.js';
import { fetchPlayer, renderPlayerDetail } from './player.js';
import { getPref, setPref } from './cache.js';
import { ApiError } from './api.js';

const REFRESH_INTERVAL = 30_000;
const RATE_LIMIT_BACKOFF = 5 * 60_000;
const FALLBACK_NATION = 'Aba';

const els = {
  nationName: document.getElementById('nation-name'),
  nationOnline: document.getElementById('nation-online'),
  nationTotal: document.getElementById('nation-total'),
  vpRemaining: document.getElementById('vp-remaining'),
  serverOnline: document.getElementById('server-online'),
  rosterList: document.getElementById('roster-list'),
  refreshBtn: document.getElementById('refresh-btn'),
  lastRefresh: document.getElementById('last-refresh'),
  playerDetail: document.getElementById('player-detail'),
  playerDetailName: document.getElementById('player-detail-name'),
  playerDetailBody: document.getElementById('player-detail-body'),
  playerDetailClose: document.getElementById('player-detail-close'),
};

let lastRefreshTime = null;
let currentNation = resolveNation();
let refreshToken = 0;
let pausedUntil = 0;
let intervalId = null;
let selectedCard = null;

function resolveNation() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('nation');
  if (fromUrl) return fromUrl;
  const fromStorage = getPref('defaultNation');
  if (fromStorage) return fromStorage;
  return FALLBACK_NATION;
}

function persistNationIfFromUser() {
  // Only persist to localStorage when the value didn't come from a URL param.
  // Otherwise two tabs with different ?nation= values would fight on next visit.
  const params = new URLSearchParams(window.location.search);
  if (!params.get('nation')) setPref('defaultNation', currentNation);
}

function renderPlayerCard(player) {
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
  card.addEventListener('click', () => openPlayerDetail(card, player));
  return card;
}

function renderRoster(players, nationName, totalResidents, serverOnline) {
  els.rosterList.replaceChildren();
  if (players.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    const server = serverOnline != null ? ` ${serverOnline.toLocaleString()} others on the server.` : '';
    p.textContent = `No ${nationName} residents online.${server}`;
    els.rosterList.appendChild(p);
    return;
  }
  for (const p of players) els.rosterList.appendChild(renderPlayerCard(p));
}

async function openPlayerDetail(cardEl, listPlayer) {
  if (selectedCard) selectedCard.classList.remove('is-selected');
  cardEl.classList.add('is-selected');
  selectedCard = cardEl;

  els.playerDetail.hidden = false;
  els.playerDetailName.textContent = listPlayer.name;
  els.playerDetailBody.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Loading…' }));

  try {
    const player = await fetchPlayer(listPlayer.uuid);
    renderPlayerDetail(player, els.playerDetailBody, els.playerDetailName);
  } catch (err) {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to load player: ${err.message}`;
    els.playerDetailBody.replaceChildren(p);
  }
}

function closePlayerDetail() {
  els.playerDetail.hidden = true;
  if (selectedCard) selectedCard.classList.remove('is-selected');
  selectedCard = null;
}

function formatLastRefresh(ts) {
  if (!ts) return '';
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 5) return 'just now';
  if (ago < 60) return `${ago}s ago`;
  return `${Math.floor(ago / 60)}m ago`;
}

function updateLastRefreshLabel() {
  els.lastRefresh.textContent = formatLastRefresh(lastRefreshTime);
}

async function refresh() {
  if (Date.now() < pausedUntil) return;
  const myToken = ++refreshToken;
  els.refreshBtn.classList.add('spinning');
  els.refreshBtn.disabled = true;
  try {
    const data = await fetchTopBarData(currentNation);
    if (myToken !== refreshToken) return; // a newer refresh started; drop this result
    els.nationName.textContent = data.nation.name;
    els.nationOnline.textContent = data.onlineResidents.length;
    els.nationTotal.textContent = data.nation.totalResidents;
    els.vpRemaining.textContent = data.voteParty != null ? data.voteParty.toLocaleString() : '—';
    els.serverOnline.textContent = data.serverOnline != null ? data.serverOnline.toLocaleString() : '—';
    renderRoster(data.onlineResidents, data.nation.name, data.nation.totalResidents, data.serverOnline);
    lastRefreshTime = Date.now();
    updateLastRefreshLabel();
  } catch (err) {
    if (myToken !== refreshToken) return;
    console.error(err);
    if (err instanceof ApiError && err.status === 429) {
      pausedUntil = Date.now() + RATE_LIMIT_BACKOFF;
      const msg = document.createElement('p');
      msg.className = 'error';
      msg.textContent = `Rate-limited by API. Backing off for 5 minutes.`;
      els.rosterList.replaceChildren(msg);
    } else {
      const msg = document.createElement('p');
      msg.className = 'error';
      msg.textContent = `Failed to load: ${err.message}`;
      els.rosterList.replaceChildren(msg);
    }
  } finally {
    if (myToken === refreshToken) {
      els.refreshBtn.classList.remove('spinning');
      els.refreshBtn.disabled = false;
    }
  }
}

els.refreshBtn.addEventListener('click', refresh);
els.playerDetailClose.addEventListener('click', closePlayerDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.playerDetail.hidden) closePlayerDetail();
});

persistNationIfFromUser();
refresh();
intervalId = setInterval(refresh, REFRESH_INTERVAL);
setInterval(updateLastRefreshLabel, 1000);
