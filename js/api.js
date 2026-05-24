const BASE = 'https://api.earthmc.net/v4';
const DEFAULT_TIMEOUT = 10_000;

export class ApiError extends Error {
  constructor(status, path, body) {
    super(`API ${status} for ${path}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

// Lightweight rolling log of recent API calls for the visible counter.
const requestLog = [];
const MAX_LOG = 2000;

function logRequest(record) {
  requestLog.push({ ts: Date.now(), ...record });
  if (requestLog.length > MAX_LOG) requestLog.shift();
  // Prune entries older than 1 hour
  const cutoff = Date.now() - 3_600_000;
  while (requestLog.length && requestLog[0].ts < cutoff) requestLog.shift();
}

export function getApiStats() {
  const now = Date.now();
  let lastMin = 0;
  let lastHour = 0;
  for (const r of requestLog) {
    if (now - r.ts < 60_000) lastMin++;
    if (now - r.ts < 3_600_000) lastHour++;
  }
  return { lastMin, lastHour, total: requestLog.length };
}

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      // text/plain dodges the OPTIONS preflight 404 bug on EMC's API.
      // The server still parses the body as JSON.
      headers: body ? { 'Content-Type': 'text/plain' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    logRequest({ path, method, status: res.status });
    if (!res.ok) {
      let errBody = null;
      try { errBody = await res.json(); } catch { /* ignore */ }
      throw new ApiError(res.status, path, errBody);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export const getServer = () => request('/');
export const getOnline = () => request('/online');
export const postNations = (names, opts) => request('/nations', { method: 'POST', body: { query: names }, ...opts });
export const postTowns = (names, opts) => request('/towns', { method: 'POST', body: { query: names }, ...opts });
export const postPlayers = (names, opts) => request('/players', { method: 'POST', body: { query: names }, ...opts });
