const memory = new Map();
let cacheHits = 0;
let cacheMisses = 0;

export function cached(key, ttlMs, loader) {
  const entry = memory.get(key);
  const now = Date.now();
  if (entry && entry.expiresAt > now) {
    cacheHits++;
    return entry.value;
  }
  cacheMisses++;

  const promise = Promise.resolve().then(loader).catch((err) => {
    memory.delete(key);
    throw err;
  });
  memory.set(key, { value: promise, expiresAt: now + ttlMs });
  return promise;
}

export function invalidate(prefix) {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
}

export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRate: total === 0 ? 0 : cacheHits / total,
  };
}

const LS_PREFIX = 'emc-tools:';

export function getPref(k) {
  try { return localStorage.getItem(LS_PREFIX + k); }
  catch { return null; }
}

export function setPref(k, v) {
  try { localStorage.setItem(LS_PREFIX + k, v); }
  catch { /* Safari private mode throws; silent fallback */ }
}

/**
 * Cached full nations list (name + UUID only). ~8KB payload.
 * Stored in localStorage with 24h TTL. Used for nation autocomplete.
 */
const NATIONS_KEY = 'nationsList';
const NATIONS_TTL = 24 * 60 * 60 * 1000;

export async function getCachedNations() {
  try {
    const raw = getPref(NATIONS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj.fetchedAt && (Date.now() - obj.fetchedAt < NATIONS_TTL) && Array.isArray(obj.nations)) {
        return obj.nations;
      }
    }
  } catch { /* fall through to fetch */ }

  const res = await fetch('https://api.earthmc.net/v4/nations');
  if (!res.ok) throw new Error(`Failed to fetch nations: ${res.status}`);
  const nations = await res.json();
  setPref(NATIONS_KEY, JSON.stringify({ nations, fetchedAt: Date.now() }));
  return nations;
}
