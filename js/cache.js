const memory = new Map();

export function cached(key, ttlMs, loader) {
  const entry = memory.get(key);
  const now = Date.now();
  if (entry && entry.expiresAt > now) return entry.value;

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

const LS_PREFIX = 'emc-tools:';

export function getPref(k) {
  try { return localStorage.getItem(LS_PREFIX + k); }
  catch { return null; }
}

export function setPref(k, v) {
  try { localStorage.setItem(LS_PREFIX + k, v); }
  catch { /* Safari private mode throws; silent fallback is correct */ }
}
