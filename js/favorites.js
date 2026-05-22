import { getPref, setPref } from './cache.js';

const KEY = 'favorites';

const EMPTY = () => ({ nations: [], towns: [], players: [] });

function load() {
  try {
    const raw = getPref(KEY);
    if (!raw) return EMPTY();
    const obj = JSON.parse(raw);
    return {
      nations: Array.isArray(obj.nations) ? obj.nations : [],
      towns: Array.isArray(obj.towns) ? obj.towns : [],
      players: Array.isArray(obj.players) ? obj.players : [],
    };
  } catch { return EMPTY(); }
}

function save(favs) {
  try { setPref(KEY, JSON.stringify(favs)); } catch { /* private mode */ }
}

export function getFavorites() {
  return load();
}

export function isFavorite(type, key) {
  const favs = load();
  const list = favs[type] ?? [];
  const k = String(key).toLowerCase();
  return list.some(f => (f.name?.toLowerCase() === k) || (f.uuid?.toLowerCase() === k));
}

export function addFavorite(type, entity) {
  const favs = load();
  if (!favs[type]) favs[type] = [];
  const k = entity.name?.toLowerCase();
  if (favs[type].some(f => f.name?.toLowerCase() === k)) return false;
  favs[type].push({
    name: entity.name,
    uuid: entity.uuid ?? null,
    addedAt: Date.now(),
  });
  save(favs);
  notify();
  return true;
}

export function removeFavorite(type, key) {
  const favs = load();
  const list = favs[type] ?? [];
  const k = String(key).toLowerCase();
  const idx = list.findIndex(f => (f.name?.toLowerCase() === k) || (f.uuid?.toLowerCase() === k));
  if (idx === -1) return false;
  list.splice(idx, 1);
  save(favs);
  notify();
  return true;
}

export function toggleFavorite(type, entity) {
  if (isFavorite(type, entity.name)) {
    removeFavorite(type, entity.name);
    return false;
  }
  addFavorite(type, entity);
  return true;
}

export function reorderFavorite(type, fromIdx, toIdx) {
  const favs = load();
  const list = favs[type];
  if (!list) return false;
  if (fromIdx < 0 || fromIdx >= list.length) return false;
  if (toIdx < 0 || toIdx >= list.length) return false;
  if (fromIdx === toIdx) return false;
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, item);
  save(favs);
  notify();
  return true;
}

// Lightweight subscriber so the star icon stays in sync if favorites change elsewhere.
const subscribers = new Set();
function notify() {
  for (const cb of subscribers) cb();
}
export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// Cross-tab sync: when another tab modifies localStorage, refresh local UI.
export function subscribeFavoritesStorageEvent() {
  window.addEventListener('storage', (e) => {
    if (e.key === 'emc-tools:favorites') notify();
  });
}

export function makeFavoriteStar(type, entity) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'favorite-star';
  btn.dataset.type = type;
  btn.dataset.name = entity.name;
  btn.setAttribute('aria-label', 'Toggle favorite');

  function render() {
    const fav = isFavorite(type, entity.name);
    btn.classList.toggle('is-favorited', fav);
    btn.textContent = fav ? '★' : '☆';
    btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
  }
  render();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(type, entity);
    render();
  });

  // Keep the star in sync if favorites change in another tab/route
  const unsub = subscribe(render);
  // Clean up when removed from DOM (best-effort, OK if it leaks one closure)
  return btn;
}
