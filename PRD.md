# emc-tools — PRD

## Problem

I want a fast way to query EarthMC data without bouncing between the in-game UI, the dynmap, and the EMC website. The starter use cases:

- How many residents are in a given nation?
- Who from a given nation or town is online right now?
- How many votes until the next vote party?
- General nation, town, and player lookups while playing.

Sub-goal: get better at calling APIs directly. Plain `fetch()` against a real public API beats a wrapper library for learning.

## Audience

Phase 1: just me. Phase 2: my EMC nation.

## Constraints

- **Privacy.** Nothing in this repo, hosting account, or deployed site links to my real identity. All git commits in this repo use `noodlecleric@gmail.com`. No analytics.
- **Static-only.** No backend, no server-side secrets, no databases. All API calls go from the user's browser to `api.earthmc.net`.
- **No auth in v1.** All starter queries use unauthenticated endpoints. SSE and shop data are v2 (require in-game API key).
- **Free hosting.** Netlify, Cloudflare Pages, or GitHub Pages under the alt account.

## v1 Scope

Single-page web app with these query modules:

1. **Nation lookup.** Input: nation name. Output: resident count, town count, king, capital, allies, enemies, member towns.
2. **Town lookup.** Input: town name. Output: mayor, nation, resident count, coordinates, residents list.
3. **Player lookup.** Input: player name. Output: town, nation, online status, titles, balance (if not opted out).
4. **Who's online at X.** Input: nation or town name. Output: intersection of `GET /online` with that group's resident list.
5. **Vote party tracker.** Output: current player count, remaining votes until next party, recent server status from `GET /`.
6. **Server stats.** Output: online count, weather, moon phase, total nations/towns/residents.
7. **Location query.** Input: X/Z coords. Output: wilderness vs. town/nation ownership.
8. **Nearby towns.** Input: town name or coords + radius. Output: list of towns within radius.

**Saved defaults** in localStorage: pick a default nation and a default town so I can hit "who's online in my nation" with one click. localStorage only, never leaves the browser.

## Out of scope (v1)

- SSE event subscriptions (need API key)
- Shop / QuickShop queries (need API key)
- Auto-refresh / live dashboard
- Mystery Master leaderboards
- Historical tracking or trend data
- User accounts of any kind

## Tech stack

- Vanilla HTML + JS + Vite. No React. Forces direct `fetch()` use, which is the point.
- Tailwind via CDN for styling speed.
- Deployed to Netlify (alt-email account) or Cloudflare Pages.

## Open questions

- **CORS.** Does `api.earthmc.net/v4` allow browser-origin requests? Docs don't say. First task in implementation is a one-line `fetch` smoke test from a local Vite dev server. If CORS blocks, fallback is a thin Cloudflare Worker proxy (still free, still no PII).
- **Opt-outs.** Some player data is hidden when residents opt out. UI should degrade gracefully when fields are missing.
- **Name vs UUID.** Most endpoints accept either. Default to name input for humans; cache name → UUID lookups in memory per session.

## Milestones

1. **Scaffold + smoke test.** Vite project, one button, hits `GET /` and renders JSON. Confirms CORS.
2. **Three starter queries.** Nation population, online-at-X, vote party.
3. **Remaining endpoints.** Town, player, location, nearby, server stats.
4. **Saved defaults.** localStorage for default nation and town.
5. **Polish + deploy.** Layout, empty states, error handling, deploy under alt identity.
6. **Share with nation.** Drop link in nation Discord.

## Privacy checklist (before any deploy)

- [ ] Git commits in this repo use `noodlecleric@gmail.com`
- [ ] No real name in README, package.json, or HTML metadata
- [ ] Hosting account uses alt email
- [ ] No analytics scripts
- [ ] No external font/CDN calls that log IPs (Tailwind CDN is acceptable; revisit if needed)
- [ ] Deployed domain is generic (something like `emc-tools.netlify.app`, not anything identifying)
