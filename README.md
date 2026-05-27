# emc-tools

Quick-glance EarthMC stats and lookups in a browser tab. Pin it, leave it open, glance at it between sessions.

**Live:** https://noodlecleric.github.io/emc-tools/

## What it does

- **Top bar** auto-refreshes every 30s with your default nation's online roster, vote party progress, and total server players
- **Nation / Town / Player** lookup modules with cross-linking (click any name to jump to that entity)
- **Top Nations** sortable table for all 131 EMC nations (Residents / Online / Area / Gold)
- **Online Nomads** view: townless players currently on the server, color-coded by how recently they registered
- **Favorites** for nations, towns, and players with drag-and-drop reorder. Each favorite row shows a live stat (online count for nations, overclaim flag for towns, online dot for players)
- **Vulnerability scan** on nation pages: surfaces overclaimed member towns and mayors approaching the 42-day deletion threshold
- **Coord chips** everywhere: click to copy `x z`, shift-click to open the dynmap at those coords
- **Deep links** for everything: `?nation=Aba`, `?town=Bordeaux`, `?player=NoodleCleric`, `?view=nations`, `?view=townless`, `?view=favorites`

## Run locally

It's static. No build step, no dependencies.

```bash
git clone https://github.com/noodlecleric/emc-tools.git
cd emc-tools
python3 -m http.server 8000
```

Open http://localhost:8000.

## Stack

Vanilla HTML + JS (ES modules) + hand-written CSS. No framework, no bundler. The browser fetches directly from `https://api.earthmc.net/v4`.

```
index.html             single-page shell
styles.css             all styles, mobile-responsive
js/
  app.js               entry, SPA router, top bar refresh loop, search bar
  api.js               fetch wrapper with timeout, error normalization, request log
  cache.js             in-memory TTL Map + localStorage helpers
  render.js            shared utilities: coord chips, badges, formatters, player batch
  online.js            top bar's nation online roster
  nation.js            nation lookup module, towns table, vulnerability scan
  town.js              town lookup module (online/offline residents, overclaim status)
  player.js            player popover + full-page module
  topnations.js        sortable table of all nations
  townless.js          online nomads view
  favorites.js         localStorage favorites data layer
  favoritesview.js     favorites view module with drag-reorder
```

## API usage

Designed to stay well under EarthMC's ~180 req/min rate limit.

- POST endpoints use `Content-Type: text/plain` to skip the OPTIONS preflight (the API returns 404 on OPTIONS, which breaks browser POSTs with `application/json`)
- In-memory TTL cache per URL: 15s for `/online`, 30s for `/`, 60s for nation/town POSTs, 5min for the top-nations enrichment
- `hasTown` lookups for the Nomads view persist in `localStorage` for 24h so subsequent sessions only check players we haven't seen
- The full nations list (~8KB, 131 entries) is cached in `localStorage` for 24h to power autocomplete in the search bar
- Live API request counter is visible in the top bar (`API: 6/min · 11 total · cache 84%`) for self-policing. Goes yellow above 90/min, red above 150/min.

Most pages cost 1-4 API calls on cold load. Cached re-loads cost zero.

## Privacy

- No analytics, no error tracking, no third-party scripts
- All preferences (default nation, favorites, sort orders, the `hasTown` cache, staff list) stored in `localStorage` only
- External services used: `mc-heads.net` for player avatars, `playerdb.co` for Mojang name lookups on the Staff view (called only for staff UUIDs that EMC's API can't resolve — typically once per 24h)
- No accounts, no auth, no server-side state. Purely static files served from GitHub Pages.

## Contributing

Issues and PRs welcome if you play EMC and want a feature. The PRD lives outside this repo, but the file structure above and the comments in each module should be enough to find your way around.

## License

[MIT](./LICENSE)
