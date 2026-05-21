# emc-tools — PRD (v2)

> v2 supersedes the original PRD after a multi-reviewer pass (UX, FE dashboards, MC-playing full-stack, EMC tool author). The original scoped 8 modules as a single-page "explorer." Reviewer consensus said that's solving the wrong problem: the actual product is a pinned-tab glance dashboard with a few on-demand lookups, not an explorer.

## Problem

While playing EMC I tab out to check three things, repeatedly:

- Who from my nation is online right now
- How many votes until the next vote party
- Whether the server is busy enough to bother logging on

Today I bounce between the in-game UI, the dynmap, and the EMC website to answer those. I want one pinned tab that answers all three at a glance, plus a fast lookup pane for the occasional "what's that nation / town / player" question.

Sub-goal: get better at calling public APIs directly with `fetch()`, no wrappers.

## Audience

- **Phase 1:** just me. One pinned tab.
- **Phase 2:** ~30-person EMC nation, link dropped in the nation Discord.

## Non-negotiables

- **Privacy.** No artifact, hosting account, or deployed asset links to my real identity. Commits in this repo use the alt git identity. No analytics, no error tracking, no third-party scripts that log IPs beyond what's strictly required to render the page.
- **Static-only.** Single `index.html`, single `app.js`, single `styles.css`. All API calls go from the user's browser to `api.earthmc.net/v4`. No backend, no proxy, no secrets.
- **No auth in v1.** All v1 endpoints are unauthenticated. SSE and shop data are deferred (require in-game API key).

## Product shape

A pinned-tab dashboard with one persistent top bar and one swappable lookup pane. Not eight tabs. Not eight modules.

```
┌────────────────────────────────────────────────────────────────┐
│ [my nation] 3/12 online · VP in 47 · 184 on server  · refresh  │  <- top bar, persistent
├────────────────────────────────────────────────────────────────┤
│  Online now:  ● Alice  ● Bob  ● Carol                          │
│                                                                │
│  Look up:  [ search nation / town / player ]                   │
│                                                                │
│  [ result pane swaps based on what was searched ]              │
└────────────────────────────────────────────────────────────────┘
```

The top bar is the product. The lookup pane is supporting.

## Phase 1 — Top bar only

Single goal: a tab I'll actually pin and check before logging in.

**Top bar content (auto-refresh every 30s):**
- Default nation name + `online/total` count
- Vote party remaining votes (`voteParty.numRemaining` from `GET /`)
- Total online players on server
- "Last refreshed: 12s ago" indicator, click to refresh

**Online roster (always visible below the bar):**
- Names of nation members currently online, with Minecraft head avatars from `crafthead.net/avatar/<uuid>`
- Sorted by name
- "0 of 12 online" when empty (denominator matters, never just "no results")

**Default nation resolution order:**
1. URL param: `?nation=Foo` — wins. Lets me share a deep link in Discord that pre-populates for the recipient.
2. localStorage: `defaultNation` key — set via a one-time prompt on first visit.
3. Empty state: small inline input "Set your default nation."

**Phase 1 success criteria:**
- I pin the tab and check it at least once before every play session for one week.
- A nation-mate I share the URL with can see useful data in <5 seconds without clicking anything.

## Phase 2 — Lookup pane

Three lookup modules behind a single search input. Type-ahead optional but cheap to add.

- **Nation lookup.** Resident count, town count, king, capital coord chip, allies, enemies, member towns (each town clickable → town lookup), founded date.
- **Town lookup.** Mayor (clickable → player lookup), nation (clickable → nation lookup), resident count, spawn coord chip, residents list with online-status dot.
- **Player lookup.** Town/nation badges (clickable), online status, titles, balance if present, last-online timestamp (the #1 question in any nation Discord).

**Cross-linking is a v1 requirement, not a polish item.** Every name in a result that maps to another module's entity is a clickable link to that module. Without this, the modules stay islands and I go back to the EMC website to navigate, defeating the whole point.

**Coord chips are required, not text.** Every coord pair in any result renders as a chip:
- Click → copies the coord pair (format TBD during implementation, dynmap's `x z` is the most useful default for pasting into Discord)
- Shift-click → opens the same coords on EMC dynmap in a new tab

**URL params for deep linking:** `?nation=Foo`, `?town=Bar`, `?player=Baz`. Page loads land directly on the relevant lookup with the entity pre-fetched. No form-first empty state for shared links.

## Phase 3 — Reassess, do not pre-spec

The original PRD planned a location query module (`POST /location`) and a nearby-towns module (`POST /nearby`). Player-side reviewer pointed out the dynmap already does both better and faster. Hold these in reserve. If after a month of Phase 2 use I notice myself wanting them, I'll add them. Most likely outcome: I don't.

Same for: SSE event subscriptions, shop data, Mystery Master leaderboards, historical tracking.

## Out of scope (v1)

- SSE event subscriptions (need API key)
- Shop / QuickShop queries (need API key)
- Mystery Master leaderboards
- Historical / trend data
- User accounts
- Multi-server support (api.earthmc.net is Aurora-only; Nova was folded)

## Tech stack

- **Vanilla HTML + JS + plain CSS.** No build step. No framework. ES modules via `<script type="module">` for code splitting.
- **No Tailwind CDN.** Tailwind Play CDN parses on every page load and is explicitly not for production. Hand-write ~80 lines of CSS for v1. If styling complexity grows, swap in Tailwind CLI binary as a one-shot pre-deploy step (still no build in the Vite sense).
- **No external scripts.** Avatars from `crafthead.net` are the only third-party resource. Image fetches don't leak much.
- **Deploy:** Netlify or GitHub Pages under the alt account. URL stays generic (`emc-tools.netlify.app` or similar).

### File layout

```
/index.html
/styles.css
/js/
  app.js                  entry; wires top bar, search, URL param routing
  api.js                  fetch wrapper, base URL, timeout, error normalization
  cache.js                in-memory Map with TTL + localStorage helpers for defaults
  render.js               shared renderers: avatar, coord chip, error, loading skeleton
  modules/
    nation.js
    town.js
    player.js
    online.js             top bar logic + roster intersection
```

## API contracts and known gotchas

These are validated against actual API behavior (reviewer pass), not docs alone.

- **Base URL:** `https://api.earthmc.net/v4`
- **CORS:** confirmed `Access-Control-Allow-Origin: *` on all endpoints, including POST bodies. No proxy needed.
- **POST bodies use `{"query": [...]}`** for `/nations`, `/towns`, `/players`, `/location`. Accept arrays up to ~100 entries — batch lookups, never loop single requests.
- **Vote party:** `GET /` returns `voteParty.numRemaining` and `voteParty.target`. Stable between votes, polling more than every ~30s is wasted.
- **Online roster intersection:** `GET /online` returns canonical player names; nation/town rosters may return stale casing after a Mojang name change. **Normalize both sides to lowercase before intersecting** or "who's online" silently undercounts.
- **Rate limit:** undocumented ~180 req/min per IP, returns 429 with no `Retry-After`. The 30s auto-refresh on the top bar is well under this; batching via array `query` is the defense for lookup-heavy sessions.
- **Response times:** bimodal. 100–300ms typical; 3–8s during server saves (every ~5 min). Implement a visible loading state (skeleton, not spinner) and a 10s timeout.
- **Missing fields:** common, not exceptional. `balance` is **omitted** (not null) when opted out. Use `in` checks. Render missing fields as muted "—" with a tooltip, never as "null" and never as a missing row.
- **Errors carry ACAO headers** too — `fetch()` won't throw on a 404. Handle status codes explicitly, distinguish 404 (inline empty state) from 5xx (retry button) from network failure (top banner).
- **Big payloads:** `GET /nations` is ~2MB, `GET /towns` is ~8MB. Don't call those from the browser; use the POST-by-name form for v1.
- **Resident → nation reverse lookup** is a common future need. Cache every `POST /players` response in the in-memory map so a "given player, what nation" question doesn't require a fresh round-trip.

## Caching policy

Two tiers, no more:

- **In-memory `Map`** (`cache.js`), keyed by full path. TTLs:
  - `/online` and the top bar's nation roster: 15s
  - `POST /nations/...` and `POST /towns/...`: 60s
  - `GET /` (server status): 30s
- **localStorage:** only `defaultNation` and `defaultTown`. Never API response payloads. A stale roster surviving a reload is worse than a fresh fetch.

## Privacy checklist (before deploy)

- [ ] Commits in this repo use `noodlecleric` git identity (`includeIf` rule already wired)
- [ ] No real name in README, HTML metadata, footer, or LICENSE
- [ ] No `<meta name="author">`, no copyright line with a real name
- [ ] Hosting account uses alt email; deployed under generic subdomain
- [ ] No analytics, no Sentry, no third-party tracking
- [ ] No CDN calls beyond what the user explicitly opted into (avatars from crafthead.net acceptable; revisit before public launch if needed)
- [ ] No `User-Agent` or custom headers that identify the project's origin

## Build sequence

1. **Phase 1 build.** `index.html` + `styles.css` + `js/api.js` + `js/cache.js` + `js/online.js` + `js/app.js`. Top bar renders for a hardcoded nation, then promote to URL param + localStorage. Deploy to Netlify under alt account.
2. **Use for a week.** Honest test: do I actually open it before play sessions?
3. **Phase 2 build.** Add `js/render.js`, `js/modules/nation.js`, `js/modules/town.js`, `js/modules/player.js`. Wire cross-linking, coord chips, URL params for each entity type, last-online timestamps.
4. **Share with nation.** Drop the link in nation Discord with a one-line "what is this."
5. **Phase 3 (maybe never).** Reassess based on actual usage.
