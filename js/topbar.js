import { getServer, ApiError, postNations, getApiStats } from './api.js';
import { cached, getPref, setPref, getCacheStats, invalidate } from './cache.js';

const REFRESH_INTERVAL = 30_000;
const RATE_LIMIT_BACKOFF = 5 * 60_000;
const TTL_SERVER = 30_000;

let lastRefreshTime = null;
let pausedUntil = 0;
let refreshToken = 0;
let routeFn = null;
let sessionApiTotal = 0;
let lastSeenLogLength = 0;

const els = {
  vpRemaining: null,
  serverOnline: null,
  refreshBtn: null,
  lastRefresh: null,
  settingsBtn: null,
  settingsPanel: null,
  defaultNationInput: null,
  defaultNationCurrent: null,
  apiMin: null,
  apiTotal: null,
  cachePct: null,
  apiStats: null,
};

function grabEls() {
  els.vpRemaining = document.getElementById('vp-remaining');
  els.serverOnline = document.getElementById('server-online');
  els.refreshBtn = document.getElementById('refresh-btn');
  els.lastRefresh = document.getElementById('last-refresh');
  els.settingsBtn = document.getElementById('settings-btn');
  els.settingsPanel = document.getElementById('settings-panel');
  els.defaultNationInput = document.getElementById('default-nation-input');
  els.defaultNationCurrent = document.getElementById('default-nation-current');
  els.apiMin = document.getElementById('api-min');
  els.apiTotal = document.getElementById('api-total');
  els.cachePct = document.getElementById('cache-pct');
  els.apiStats = document.getElementById('api-stats');
}

function updateApiStats() {
  if (!els.apiStats) return;
  const api = getApiStats();
  const cache = getCacheStats();
  const hitPct = cache.total > 0 ? Math.round(cache.hitRate * 100) : 0;
  if (api.total > lastSeenLogLength) sessionApiTotal += api.total - lastSeenLogLength;
  lastSeenLogLength = api.total;
  if (els.apiMin) els.apiMin.textContent = api.lastMin;
  if (els.apiTotal) els.apiTotal.textContent = sessionApiTotal;
  if (els.cachePct) els.cachePct.textContent = hitPct;
  els.apiStats.classList.toggle('warn', api.lastMin > 150);
  els.apiStats.classList.toggle('approaching', api.lastMin > 90 && api.lastMin <= 150);
}

function formatLastRefresh(ts) {
  if (!ts) return '';
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 5) return 'just now';
  if (ago < 60) return `${ago}s ago`;
  return `${Math.floor(ago / 60)}m ago`;
}

function updateLastRefreshLabel() {
  if (els.lastRefresh) els.lastRefresh.textContent = formatLastRefresh(lastRefreshTime);
}

async function refreshTopbarStats() {
  if (Date.now() < pausedUntil) return;
  const myToken = ++refreshToken;
  els.refreshBtn?.classList.add('spinning');
  if (els.refreshBtn) els.refreshBtn.disabled = true;
  try {
    const server = await cached('/', TTL_SERVER, getServer);
    if (myToken !== refreshToken) return;
    const vp = server.voteParty?.numRemaining;
    const online = server.stats?.numOnlinePlayers;
    if (els.vpRemaining) els.vpRemaining.textContent = vp != null ? vp.toLocaleString() : '—';
    if (els.serverOnline) els.serverOnline.textContent = online != null ? online.toLocaleString() : '—';
    lastRefreshTime = Date.now();
    updateLastRefreshLabel();
  } catch (err) {
    if (myToken !== refreshToken) return;
    console.error(err);
    if (err instanceof ApiError && err.status === 429) {
      pausedUntil = Date.now() + RATE_LIMIT_BACKOFF;
    }
  } finally {
    if (myToken === refreshToken) {
      els.refreshBtn?.classList.remove('spinning');
      if (els.refreshBtn) els.refreshBtn.disabled = false;
    }
  }
}

function setupSettings() {
  if (!els.settingsBtn || !els.settingsPanel) return;

  function refreshCurrentDisplay() {
    if (els.defaultNationCurrent) {
      els.defaultNationCurrent.textContent = getPref('defaultNation') || 'Aba (default)';
    }
  }

  els.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !wasHidden;
    if (wasHidden) {
      refreshCurrentDisplay();
      els.defaultNationInput?.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!els.settingsPanel.hidden
        && !els.settingsPanel.contains(e.target)
        && e.target !== els.settingsBtn
        && !els.settingsBtn.contains(e.target)) {
      els.settingsPanel.hidden = true;
    }
  });

  els.defaultNationInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { els.settingsPanel.hidden = true; return; }
    if (e.key !== 'Enter') {
      els.defaultNationInput.classList.remove('invalid');
      return;
    }
    e.preventDefault();
    const value = els.defaultNationInput.value.trim();
    if (!value) return;
    els.defaultNationInput.disabled = true;
    try {
      const res = await postNations([value]);
      const found = res?.[0];
      if (!found) {
        els.defaultNationInput.classList.add('invalid');
        return;
      }
      setPref('defaultNation', found.name);
      refreshCurrentDisplay();
      els.defaultNationInput.value = '';
      els.settingsPanel.hidden = true;
    } catch {
      els.defaultNationInput.classList.add('invalid');
    } finally {
      els.defaultNationInput.disabled = false;
    }
  });
}

export function mountTopbar({ onRefresh }) {
  grabEls();
  routeFn = onRefresh;

  els.refreshBtn?.addEventListener('click', () => {
    invalidate('/');
    invalidate('/online');
    refreshTopbarStats();
    if (onRefresh) onRefresh();
  });

  setupSettings();

  refreshTopbarStats();
  setInterval(refreshTopbarStats, REFRESH_INTERVAL);
  setInterval(updateLastRefreshLabel, 1000);
  setInterval(updateApiStats, 3000);
  updateApiStats();
}
