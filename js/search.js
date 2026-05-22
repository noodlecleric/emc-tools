import { getCachedNations } from './cache.js';

const TYPES = ['nation', 'town', 'player'];

let isOpen = false;
let isMounted = false;
let routeFn = null;
let lastFocus = null;
let overlayEl = null;
let panelEl = null;
let inputEl = null;
let goBtn = null;
let suggestionsEl = null;
let typeButtons = null;
let currentType = 'nation';
let nationsList = null;
let blurHideTimer = null;

function placeholderFor(type) {
  if (type === 'nation') return 'Search nations…';
  if (type === 'town') return 'Town name…';
  return 'Player name…';
}

function buildOverlay() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'search-overlay';
  overlayEl.hidden = true;
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-labelledby', 'search-overlay-title');

  const backdrop = document.createElement('div');
  backdrop.className = 'search-overlay-backdrop';
  backdrop.addEventListener('click', closeSearch);

  panelEl = document.createElement('div');
  panelEl.className = 'search-overlay-panel';

  const srTitle = document.createElement('h2');
  srTitle.id = 'search-overlay-title';
  srTitle.className = 'visually-hidden';
  srTitle.textContent = 'Search';
  panelEl.appendChild(srTitle);

  // Header: type tabs + close
  const header = document.createElement('div');
  header.className = 'search-overlay-header';

  const types = document.createElement('div');
  types.className = 'search-types';
  types.setAttribute('role', 'tablist');
  TYPES.forEach((type, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-type' + (i === 0 ? ' active' : '');
    btn.dataset.type = type;
    btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    btn.addEventListener('click', () => setType(type));
    types.appendChild(btn);
  });
  header.appendChild(types);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-overlay-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close search');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeSearch);
  header.appendChild(closeBtn);

  panelEl.appendChild(header);

  // Input row
  const inputWrap = document.createElement('div');
  inputWrap.className = 'search-input-wrap';

  inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'search-input';
  inputEl.placeholder = placeholderFor('nation');
  inputEl.autocomplete = 'off';
  inputEl.spellcheck = false;
  inputEl.addEventListener('input', updateSuggestions);
  inputEl.addEventListener('focus', updateSuggestions);
  inputEl.addEventListener('keydown', onInputKeydown);
  inputEl.addEventListener('blur', () => {
    // Delay so click on suggestion still fires before we hide
    if (blurHideTimer) clearTimeout(blurHideTimer);
    blurHideTimer = setTimeout(() => {
      if (suggestionsEl) suggestionsEl.hidden = true;
    }, 200);
  });

  goBtn = document.createElement('button');
  goBtn.className = 'search-go';
  goBtn.type = 'button';
  goBtn.setAttribute('aria-label', 'Search');
  goBtn.textContent = '⌕';
  goBtn.addEventListener('click', submitSearch);

  suggestionsEl = document.createElement('div');
  suggestionsEl.className = 'search-suggestions';
  suggestionsEl.hidden = true;
  suggestionsEl.setAttribute('role', 'listbox');

  inputWrap.append(inputEl, goBtn, suggestionsEl);
  panelEl.appendChild(inputWrap);

  // Hint footer
  const help = document.createElement('p');
  help.className = 'search-overlay-help';
  help.innerHTML = 'Enter to search · Esc to close';
  panelEl.appendChild(help);

  overlayEl.append(backdrop, panelEl);
  document.body.appendChild(overlayEl);

  typeButtons = types.querySelectorAll('.search-type');
}

function setType(type) {
  currentType = type;
  typeButtons.forEach(b => b.classList.toggle('active', b.dataset.type === type));
  inputEl.placeholder = placeholderFor(type);
  updateSuggestions();
}

async function updateSuggestions() {
  if (currentType !== 'nation') {
    suggestionsEl.hidden = true;
    return;
  }
  if (!nationsList) {
    try { nationsList = await getCachedNations(); }
    catch { nationsList = []; }
  }
  const q = inputEl.value.trim().toLowerCase();
  if (!q) { suggestionsEl.hidden = true; return; }
  const matches = nationsList
    .filter(n => n.name.toLowerCase().includes(q))
    .slice(0, 8);
  if (matches.length === 0) { suggestionsEl.hidden = true; return; }
  suggestionsEl.replaceChildren();
  matches.forEach(n => {
    const item = document.createElement('a');
    item.href = `?nation=${encodeURIComponent(n.name)}`;
    item.className = 'search-suggestion';
    item.textContent = n.name;
    // Clicking lets the global SPA click handler fire navigation; we just close the overlay.
    item.addEventListener('click', closeSearch);
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.hidden = false;
}

function submitSearch() {
  const value = inputEl.value.trim();
  if (!value) { inputEl.focus(); return; }
  history.pushState({}, '', `?${currentType}=${encodeURIComponent(value)}`);
  if (routeFn) routeFn();
  closeSearch();
}

function onInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitSearch();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
}

function trapTab(e) {
  if (!isOpen || e.key !== 'Tab') return;
  const focusables = Array.from(panelEl.querySelectorAll('button, input, a[href]'))
    .filter(el => !el.hasAttribute('hidden') && !el.disabled);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function bindGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+K / Ctrl+K — always opens (even when typing in another input)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (!isOpen) openSearch();
      return;
    }

    // `/` opens search ONLY when not already typing in a field
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const inField = e.target.matches?.('input, textarea, [contenteditable]');
      if (!inField) {
        e.preventDefault();
        if (!isOpen) openSearch();
        return;
      }
    }

    // Esc closes (also handled by input keydown; this covers focus-on-close-btn)
    if (e.key === 'Escape' && isOpen) {
      closeSearch();
      return;
    }

    trapTab(e);
  });

  const trigger = document.getElementById('search-trigger');
  if (trigger) trigger.addEventListener('click', openSearch);
}

export function openSearch() {
  if (!isMounted || isOpen) return;
  isOpen = true;
  lastFocus = document.activeElement;
  overlayEl.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the input after layout so the cursor is in the right place
  requestAnimationFrame(() => inputEl.focus());
}

export function closeSearch() {
  if (!isMounted || !isOpen) return;
  isOpen = false;
  overlayEl.hidden = true;
  inputEl.value = '';
  suggestionsEl.hidden = true;
  document.body.style.overflow = '';
  if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
  if (lastFocus && typeof lastFocus.focus === 'function') {
    lastFocus.focus();
  }
}

export function mountSearch({ onRefresh } = {}) {
  if (isMounted) return;
  isMounted = true;
  routeFn = onRefresh;
  buildOverlay();
  bindGlobalShortcuts();
}
