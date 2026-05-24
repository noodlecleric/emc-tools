import { postPlayers } from './api.js';
import { cached } from './cache.js';

const DYNMAP_BASE = 'https://map.earthmc.net/?worldname=earth&zoom=6';

export function formatGold(value) {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return `${rounded.toLocaleString()} gold`;
}

export function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  return `${mo} mo ago`;
}

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function lastSeenTier(ts) {
  if (!ts) return 'never';
  const ageMs = Date.now() - ts;
  const day = 86_400_000;
  if (ageMs < day) return 'fresh';
  if (ageMs < 7 * day) return 'recent';
  if (ageMs < 30 * day) return 'stale';
  return 'dormant';
}

// Registered tiers for online nomads (recruitability heuristic):
// green <72h, yellow <2wk, red <5wk, black >5wk
export function registeredTier(ts) {
  if (!ts) return 'never';
  const ageMs = Date.now() - ts;
  const day = 86_400_000;
  if (ageMs < 3 * day) return 'fresh';
  if (ageMs < 14 * day) return 'recent';
  if (ageMs < 35 * day) return 'stale';
  return 'old';
}

export function makeCoordChip(x, z) {
  const xR = Math.round(x);
  const zR = Math.round(z);
  const chip = document.createElement('a');
  chip.className = 'coord-chip';
  chip.href = `${DYNMAP_BASE}&x=${xR}&y=64&z=${zR}`;
  chip.target = '_blank';
  chip.rel = 'noopener';
  chip.title = 'Click to open dynmap · Shift-click to copy x z';
  chip.textContent = `${xR}, ${zR}`;
  chip.addEventListener('click', (e) => {
    if (!e.shiftKey) return; // default link behavior → opens dynmap
    e.preventDefault();
    navigator.clipboard?.writeText(`${xR} ${zR}`).then(() => {
      chip.classList.add('copied');
      const original = chip.textContent;
      chip.textContent = 'copied';
      setTimeout(() => {
        chip.classList.remove('copied');
        chip.textContent = original;
      }, 900);
    }).catch(() => {});
  });
  return chip;
}

export function makeEntityLink(type, name, label) {
  const link = document.createElement('a');
  link.className = 'entity-link';
  link.href = `?${type}=${encodeURIComponent(name)}`;
  link.textContent = label ?? name;
  link.dataset.entity = type;
  link.dataset.name = name;
  return link;
}

export function makeBadge(text, kind) {
  const b = document.createElement('span');
  b.className = `badge ${kind}`;
  b.textContent = text;
  return b;
}

export function makeLastSeenBadge(ts) {
  const tier = lastSeenTier(ts);
  const b = document.createElement('span');
  b.className = `last-seen-badge tier-${tier}`;
  b.textContent = ts ? formatRelative(ts) : 'never';
  b.title = ts ? formatDateTime(ts) : 'never logged in';
  return b;
}

export function makeRegisteredBadge(ts) {
  const tier = registeredTier(ts);
  const b = document.createElement('span');
  b.className = `registered-badge tier-${tier}`;
  b.textContent = ts ? `joined ${formatRelative(ts)}` : 'unknown';
  b.title = ts ? `Registered ${formatDate(ts)}` : 'no registration date';
  return b;
}

export function loadingEl(text = 'Loading…') {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

export function errorEl(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  return p;
}

const TTL_PLAYERS_BATCH = 60_000;
const BATCH_TIMEOUT_MS = 30_000;

export async function fetchPlayersBatch(uuids) {
  if (!uuids.length) return { map: new Map(), failedChunks: 0, totalChunks: 0 };
  const chunkSize = 100;
  const result = new Map();
  const totalChunks = Math.ceil(uuids.length / chunkSize);
  let failedChunks = 0;
  for (let i = 0; i < uuids.length; i += chunkSize) {
    const chunk = uuids.slice(i, i + chunkSize);
    const key = `/players-batch:${chunk.slice().sort().join(',')}`;
    try {
      const players = await cached(key, TTL_PLAYERS_BATCH, () => postPlayers(chunk, { timeout: BATCH_TIMEOUT_MS }));
      for (const p of players ?? []) result.set(p.uuid, p);
    } catch (err) {
      failedChunks++;
      console.warn(`fetchPlayersBatch: chunk ${i}-${i + chunk.length} failed (${err.message})`);
    }
  }
  if (failedChunks > 0) {
    console.warn(`fetchPlayersBatch: ${failedChunks} of ${totalChunks} chunks failed; returning partial results`);
  }
  // Return both shapes for back-compat (existing callers use the Map directly).
  result.failedChunks = failedChunks;
  result.totalChunks = totalChunks;
  return result;
}
