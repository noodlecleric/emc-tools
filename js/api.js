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

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      // text/plain (not application/json) keeps this a CORS "simple request" so the browser
       // skips the OPTIONS preflight. The EMC API returns 404 on OPTIONS, which would fail
       // any preflight even though the actual GET/POST works fine.
      headers: body ? { 'Content-Type': 'text/plain' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
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
export const postNations = (names) => request('/nations', { method: 'POST', body: { query: names } });
export const postTowns = (names) => request('/towns', { method: 'POST', body: { query: names } });
export const postPlayers = (names) => request('/players', { method: 'POST', body: { query: names } });
