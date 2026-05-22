import { setupRouter, route } from './router.js';
import { mountTopbar } from './topbar.js';
import { subscribeFavoritesStorageEvent } from './favorites.js';
import { setupErrorBoundary } from './errors.js';

setupErrorBoundary();
subscribeFavoritesStorageEvent();
setupRouter();
mountTopbar({ onRefresh: route });
route();
