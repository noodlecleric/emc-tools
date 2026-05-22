import { getServer, postNations, getOnline } from './api.js';
import { cached, getPref, setPref } from './cache.js';
import { loadingEl, errorEl, makeEntityLink } from './render.js';

const TTL_ONLINE = 15_000;
const TTL_NATION = 60_000;

const TTL_SERVER = 30_000;

function makeAvatarCard(resident) {
  const card = document.createElement('a');
  card.className = 'player-card';
  card.href = `?player=${encodeURIComponent(resident.name)}`;
  card.title = resident.name;
  const img = document.createElement('img');
  img.src = `https://crafthead.net/avatar/${resident.uuid}/48`;
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.loading = 'lazy';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = resident.name;
  card.append(img, name);
  return card;
}

function renderFeatureCards(container) {
  const sec = document.createElement('section');
  sec.className = 'landing-features';
  sec.setAttribute('aria-label', 'What you can do here');

  const cards = [
    {
      title: 'Nations',
      href: '?view=nations',
      desc: 'Every nation on the server, ranked by activity. Spot who is growing and who is bleeding members.',
      cta: 'Browse nations →',
    },
    {
      title: 'Nomads',
      href: '?view=townless',
      desc: 'Townless players currently online. Useful for recruiting newcomers or scouting fresh arrivals.',
      cta: 'See online nomads →',
    },
    {
      title: '★ Favorites',
      href: '?view=favorites',
      desc: 'Pin nations, towns, and players to your personal watchlist with live online status.',
      cta: 'Open favorites →',
    },
  ];

  for (const card of cards) {
    const a = document.createElement('a');
    a.className = 'feature-card';
    a.href = card.href;
    const title = document.createElement('h3');
    title.className = 'feature-card-title';
    title.textContent = card.title;
    const desc = document.createElement('p');
    desc.className = 'feature-card-desc';
    desc.textContent = card.desc;
    const cta = document.createElement('span');
    cta.className = 'feature-card-cta';
    cta.textContent = card.cta;
    a.append(title, desc, cta);
    sec.appendChild(a);
  }

  container.appendChild(sec);
}

async function renderHomeNationOnline(container, nationName) {
  const sec = document.createElement('section');
  sec.className = 'landing-home-nation';
  const h2 = document.createElement('h2');
  h2.className = 'landing-section-title';
  h2.textContent = `${nationName} — online now`;
  sec.appendChild(h2);
  const placeholder = loadingEl('Loading…');
  sec.appendChild(placeholder);
  container.appendChild(sec);

  try {
    const [nationRes, online] = await Promise.all([
      cached(`/nations:${nationName.toLowerCase()}`, TTL_NATION, () => postNations([nationName])),
      cached('/online', TTL_ONLINE, getOnline),
    ]);
    const nation = nationRes?.[0];
    if (!nation) {
      placeholder.remove();
      sec.appendChild(errorEl(`Nation "${nationName}" not found.`));
      return;
    }
    const residents = nation.residents ?? [];
    const onlineUuids = new Set(online?.players?.map(p => p.uuid) ?? []);
    const onlineResidents = residents.filter(r => onlineUuids.has(r.uuid));

    placeholder.remove();
    h2.textContent = `${nation.name} — ${onlineResidents.length} of ${residents.length} online`;

    if (onlineResidents.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `No one from ${nation.name} is online right now.`;
      sec.appendChild(p);
    } else {
      const grid = document.createElement('div');
      grid.className = 'roster-list';
      for (const r of onlineResidents) grid.appendChild(makeAvatarCard(r));
      sec.appendChild(grid);
    }
  } catch (err) {
    console.error(err);
    placeholder.remove();
    sec.appendChild(errorEl(`Failed to load: ${err.message}`));
  }
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function renderServerStats(container, server) {
  container.replaceChildren();
  container.appendChild(el('h2', 'landing-section-title', 'Server right now'));

  const grid = el('div', 'landing-grid');
  const stats = server.stats ?? {};
  const vp = server.voteParty ?? {};

  const items = [
    {
      label: 'Players online',
      value: `${(stats.numOnlinePlayers ?? 0).toLocaleString()} / ${(stats.maxPlayers ?? 0).toLocaleString()}`,
    },
    {
      label: 'Votes until vote party',
      value: vp.numRemaining != null ? vp.numRemaining.toLocaleString() : '—',
    },
    {
      label: 'Nations',
      value: (stats.numNations ?? 0).toLocaleString(),
    },
    {
      label: 'Towns',
      value: (stats.numTowns ?? 0).toLocaleString(),
    },
    {
      label: 'Residents',
      value: (stats.numResidents ?? 0).toLocaleString(),
    },
  ];

  for (const item of items) {
    const cell = el('div', 'landing-stat');
    cell.append(el('div', 'landing-stat-value', item.value), el('div', 'landing-stat-label', item.label));
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // Secondary: moon + weather
  const parts = [];
  if (server.moonPhase) parts.push(`Moon: ${server.moonPhase.replace(/_/g, ' ').toLowerCase()}`);
  if (server.status?.isThundering) parts.push('Thundering');
  else if (server.status?.hasStorm) parts.push('Stormy');
  if (parts.length > 0) container.appendChild(el('p', 'muted small landing-secondary', parts.join(' · ')));
}

export async function mountLanding(container) {
  container.replaceChildren();

  // Intro
  const intro = el('section', 'landing-intro');
  intro.appendChild(el('h1', 'landing-title', 'emc-tools'));
  intro.appendChild(el(
    'p',
    'landing-summary',
    'A quick-glance dashboard for EarthMC. Track your nation, browse all nations, find vulnerable towns, spot recruitable nomads. No login required, everything stays in your browser.',
  ));
  container.appendChild(intro);

  // Quick link to user's default nation, if set
  const defaultNation = getPref('defaultNation');
  if (defaultNation) {
    const quick = el('section', 'landing-quick');
    quick.appendChild(el('span', 'muted', 'Your nation: '));
    const link = makeEntityLink('nation', defaultNation);
    link.classList.add('landing-quick-link');
    quick.appendChild(link);
    container.appendChild(quick);
  }

  // Feature cards (discovery aid)
  renderFeatureCards(container);

  // Server stats
  const statsSec = el('section', 'landing-stats');
  statsSec.appendChild(loadingEl('Loading server stats…'));
  container.appendChild(statsSec);

  // Home nation setup
  const setupSec = el('section', 'landing-setup');
  setupSec.appendChild(el('h2', 'landing-section-title', 'Set your home nation'));
  const desc = el('p', 'muted small');
  desc.append('The nation you want quick access to. Currently: ');
  const current = el('span', 'mono');
  current.textContent = defaultNation || 'Aba (default)';
  desc.appendChild(current);
  setupSec.appendChild(desc);

  const form = el('form', 'landing-setup-form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'landing-input';
  input.placeholder = 'Nation name';
  input.autocomplete = 'off';
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'landing-submit';
  btn.textContent = 'Save';
  form.append(input, btn);
  setupSec.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    btn.disabled = true;
    input.classList.remove('invalid');
    try {
      const res = await postNations([value]);
      const found = res?.[0];
      if (!found) {
        input.classList.add('invalid');
        return;
      }
      setPref('defaultNation', found.name);
      current.textContent = found.name;
      input.value = '';
      // Trigger storage event for cross-tab notify (best-effort)
    } catch {
      input.classList.add('invalid');
    } finally {
      btn.disabled = false;
    }
  });

  container.appendChild(setupSec);

  // Fetch stats
  try {
    const server = await cached('/', TTL_SERVER, getServer);
    renderServerStats(statsSec, server);
  } catch (err) {
    statsSec.replaceChildren(errorEl(err.message));
  }

  // Home nation online roster (only if default nation is set)
  if (defaultNation) {
    renderHomeNationOnline(container, defaultNation);
  }
}
