import { getOnline } from './api.js';
import { cached, getPref, setPref, invalidate } from './cache.js';
import { loadingEl, errorEl, fetchPlayersBatch } from './render.js';

const TTL_ONLINE = 15_000;
const STAFF_LIST_KEY = 'staffList';
const STAFF_LIST_TTL = 24 * 60 * 60 * 1000;
const STAFF_LIST_URL = 'https://raw.githubusercontent.com/Veyronity/staff/master/staff.json';
const PLAYERDB_URL = 'https://playerdb.co/api/player/minecraft/';
const PLAYERDB_TIMEOUT = 8_000;

// Role hierarchy, top to bottom. Drives section ordering and badge color.
const ROLE_ORDER = ['owner', 'admin', 'developer', 'moderator', 'helper'];
const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  moderator: 'Moderator',
  helper: 'Helper',
};

/**
 * Resolve UUIDs to current Mojang names via playerdb.co (CORS-enabled Mojang proxy).
 * Used as fallback for staff who've opted out of EMC's public API — EMC returns []
 * for opted-out players, so /players can't tell us their names. Mojang's session
 * server has no CORS, so we use playerdb as a browser-friendly bridge.
 * Returns Map<uuid, username>. Silent on individual failures.
 */
async function resolveNamesFromPlayerDB(uuids) {
  const results = new Map();
  await Promise.all(uuids.map(async (uuid) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PLAYERDB_TIMEOUT);
    try {
      const res = await fetch(PLAYERDB_URL + uuid, { signal: ctrl.signal });
      if (!res.ok) return;
      const json = await res.json();
      const username = json?.data?.player?.username;
      if (username) results.set(uuid, username);
    } catch { /* fall through to UUID-prefix display */ }
    finally { clearTimeout(t); }
  }));
  return results;
}

/**
 * Fetch + cache the staff roster. Resolves UUIDs to current Mojang names:
 *  1. Batched POST /players (EMC) — fastest, but returns [] for opted-out staff.
 *  2. playerdb.co fallback for any UUIDs EMC couldn't resolve.
 * Cached blob shape: { fetchedAt, members: [{ uuid, role, name }] }
 */
async function fetchStaffRoster({ force = false } = {}) {
  if (!force) {
    try {
      const raw = getPref(STAFF_LIST_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj.fetchedAt && (Date.now() - obj.fetchedAt < STAFF_LIST_TTL) && Array.isArray(obj.members)) {
          return obj;
        }
      }
    } catch { /* fall through */ }
  }

  const res = await fetch(STAFF_LIST_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load staff list (HTTP ${res.status})`);
  const json = await res.json();

  // Flatten role → uuid[] map into [{ uuid, role }] entries, preserving role order.
  const members = [];
  for (const role of ROLE_ORDER) {
    const ids = Array.isArray(json[role]) ? json[role] : [];
    for (const uuid of ids) members.push({ uuid, role });
  }

  // Resolve names. EMC first (one batch chunk for ~35 UUIDs).
  const playerMap = await fetchPlayersBatch(members.map(m => m.uuid));
  const unresolved = [];
  for (const m of members) {
    const p = playerMap.get(m.uuid);
    m.name = p?.name ?? null;
    if (!m.name) unresolved.push(m.uuid);
  }

  // Fallback: playerdb.co for opted-out staff (EMC returns [] for those).
  if (unresolved.length > 0) {
    const fallbackNames = await resolveNamesFromPlayerDB(unresolved);
    for (const m of members) {
      if (!m.name && fallbackNames.has(m.uuid)) m.name = fallbackNames.get(m.uuid);
    }
  }

  const blob = { fetchedAt: Date.now(), members };
  setPref(STAFF_LIST_KEY, JSON.stringify(blob));
  return blob;
}

function roleBadge(role) {
  const span = document.createElement('span');
  span.className = `staff-role-badge role-${role}`;
  span.textContent = ROLE_LABELS[role] ?? role;
  return span;
}

function staffCard(member, isOnline) {
  const card = document.createElement('a');
  card.className = `player-card${isOnline ? '' : ' offline'}`;
  // Some staff may have no resolved name (deleted/renamed/opted-out). Skip the link target then.
  const displayName = member.name ?? member.uuid.slice(0, 8);
  card.href = member.name ? `?player=${encodeURIComponent(member.name)}` : '#';
  if (!member.name) card.addEventListener('click', e => e.preventDefault());
  card.dataset.entity = 'player';
  card.dataset.name = displayName;
  card.title = displayName;

  const img = document.createElement('img');
  img.src = `https://mc-heads.net/avatar/${member.uuid}/48`;
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.loading = 'lazy';
  img.onerror = () => { img.style.visibility = 'hidden'; };

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = displayName;

  card.append(img, name, roleBadge(member.role));
  return card;
}

function renderSection(container, title, members, isOnline) {
  if (members.length === 0) return;
  const sec = document.createElement('section');
  sec.className = 'detail-section';

  const h3 = document.createElement('h3');
  h3.className = 'section-heading';
  h3.textContent = `${title} (${members.length})`;
  sec.appendChild(h3);

  const grid = document.createElement('div');
  grid.className = 'roster-list';

  // Sort by role hierarchy, then by name within role.
  const sorted = [...members].sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  for (const m of sorted) grid.appendChild(staffCard(m, isOnline));
  sec.appendChild(grid);
  container.appendChild(sec);
}

function formatAge(ms) {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export async function mountStaff(container) {
  container.replaceChildren();

  const header = document.createElement('header');
  header.className = 'module-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Staff';
  header.appendChild(h2);
  const subhead = document.createElement('span');
  subhead.className = 'muted';
  subhead.textContent = 'EarthMC staff · online first, offline dimmed';
  header.appendChild(subhead);
  container.appendChild(header);

  const controls = document.createElement('div');
  controls.className = 'module-controls';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'refresh-btn-large';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '⟳';
  const label = document.createElement('span');
  label.textContent = 'Refresh';
  refreshBtn.append(icon, label);
  controls.appendChild(refreshBtn);

  const status = document.createElement('span');
  status.className = 'muted small';
  controls.appendChild(status);

  container.appendChild(controls);

  const body = document.createElement('div');
  body.className = 'staff-body';
  container.appendChild(body);

  const footer = document.createElement('p');
  footer.className = 'muted small staff-source';
  container.appendChild(footer);

  async function render({ forceList = false } = {}) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
    body.replaceChildren(loadingEl('Loading staff…'));
    status.textContent = '';

    try {
      // Parallelize: staff roster (mostly cached) + live online list.
      const [roster, online] = await Promise.all([
        fetchStaffRoster({ force: forceList }),
        cached('/online', TTL_ONLINE, getOnline),
      ]);

      const onlineUuids = new Set((online?.players ?? []).map(p => p.uuid));
      const onlineMembers = roster.members.filter(m => onlineUuids.has(m.uuid));
      const offlineMembers = roster.members.filter(m => !onlineUuids.has(m.uuid));

      body.replaceChildren();
      if (onlineMembers.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No staff online right now.';
        body.appendChild(p);
      } else {
        renderSection(body, 'Online', onlineMembers, true);
      }
      renderSection(body, 'Offline', offlineMembers, false);

      status.textContent = `${onlineMembers.length} of ${roster.members.length} online`;

      // Source attribution + refresh-list link
      footer.replaceChildren();
      const age = Date.now() - roster.fetchedAt;
      const sourceLink = document.createElement('a');
      sourceLink.href = 'https://github.com/Veyronity/staff';
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener';
      sourceLink.textContent = 'Veyronity/staff';
      footer.append('Source: ', sourceLink, ` · list updated ${formatAge(age)} · `);
      const refreshListBtn = document.createElement('a');
      refreshListBtn.href = '#';
      refreshListBtn.textContent = 'refetch list';
      refreshListBtn.addEventListener('click', (e) => {
        e.preventDefault();
        render({ forceList: true });
      });
      footer.appendChild(refreshListBtn);
    } catch (err) {
      console.error(err);
      body.replaceChildren(errorEl(`Failed: ${err.message}`));
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  refreshBtn.addEventListener('click', () => {
    invalidate('/online');
    render();
  });

  render();
}
