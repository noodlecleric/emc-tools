import { mountLanding } from './landing.js';
import { mountNation } from './nation.js';
import { mountTown } from './town.js';
import { mountPlayer } from './player.js';
import { mountTownless } from './townless.js';
import { mountTopNations } from './topnations.js';
import { mountFavorites } from './favoritesview.js';
import { mountStaff } from './staff.js';

let mainView = null;

function highlightNav(target) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === target);
  });
}

function updateTitle(text) {
  document.title = text ? `${text} · emc-tools` : 'emc-tools';
}

export function route() {
  if (!mainView) mainView = document.getElementById('main-view');
  const params = new URLSearchParams(location.search);
  if (params.has('nation')) {
    highlightNav(null);
    const name = params.get('nation');
    updateTitle(name);
    mountNation(mainView, name);
  } else if (params.has('town')) {
    highlightNav(null);
    const name = params.get('town');
    updateTitle(name);
    mountTown(mainView, name);
  } else if (params.has('player')) {
    highlightNav(null);
    const name = params.get('player');
    updateTitle(`Player: ${name}`);
    mountPlayer(mainView, name);
  } else if (params.get('view') === 'townless') {
    highlightNav('townless');
    updateTitle('Nomads');
    mountTownless(mainView);
  } else if (params.get('view') === 'nations') {
    highlightNav('nations');
    updateTitle('Nations');
    mountTopNations(mainView);
  } else if (params.get('view') === 'favorites') {
    highlightNav('favorites');
    updateTitle('Favorites');
    mountFavorites(mainView);
  } else if (params.get('view') === 'staff') {
    highlightNav('staff');
    updateTitle('Staff');
    mountStaff(mainView);
  } else {
    highlightNav('home');
    updateTitle('');
    mountLanding(mainView);
  }
}

export function setupRouter() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || !(href.startsWith('?') || href === '?')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const url = new URL(link.href, location.origin);
    history.pushState({}, '', url);
    route();
  });

  window.addEventListener('popstate', route);

  return { route };
}
