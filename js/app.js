import { setupRouter, route } from './router.js';
import { mountTopbar } from './topbar.js';
import { mountSearch } from './search.js';
import { subscribeFavoritesStorageEvent } from './favorites.js';
import { setupErrorBoundary } from './errors.js';
import { setupTooltips } from './tooltips.js';

setupErrorBoundary();
setupTooltips();
subscribeFavoritesStorageEvent();
setupRouter();
mountSearch({ onRefresh: route });
mountTopbar({ onRefresh: route });
route();
