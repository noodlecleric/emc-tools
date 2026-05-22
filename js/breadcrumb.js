import { makeEntityLink } from './render.js';

/**
 * Render a breadcrumb trail for an entity page.
 * items: array of { type, name } where type is 'nation' | 'town' | 'player'.
 * Last item is the current page (rendered non-clickable). Earlier items are links.
 */
export function makeBreadcrumb(items) {
  const nav = document.createElement('nav');
  nav.className = 'breadcrumb';
  nav.setAttribute('aria-label', 'Breadcrumb');
  items.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      nav.appendChild(sep);
    }
    if (i === items.length - 1) {
      const span = document.createElement('span');
      span.className = 'breadcrumb-current';
      span.textContent = item.name;
      nav.appendChild(span);
    } else {
      const link = makeEntityLink(item.type, item.name, item.name);
      link.classList.add('breadcrumb-link');
      nav.appendChild(link);
    }
  });
  return nav;
}
