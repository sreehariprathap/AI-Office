# Admin Login + URL Routing Design

**Date:** 2026-09-13
**Status:** Approved for planning

## Summary

Two related changes to the AI-Office hub (World of Wonders):

1. **Admin login screen.** The whole app becomes admin-only, gated behind a
   real `/login` page backed by an httpOnly cookie session — replacing
   today's read-everyone / `window.prompt()`-for-write-access model.
2. **URL routing for the town.** Map, buildings and floors get real,
   shareable, bookmarkable URLs (`/gym`, `/gym/canada-desk`) instead of
   living purely in client-side `view` state.

These ship together because the login gate needs middleware to protect
*routes*, and there's no such thing as "routes to protect" until the second
change exists. Building both at once also means `App.jsx`'s navigation
plumbing is touched exactly once.

## Current State (context for implementers)

- **Auth today:** any request can read a reduced (`stripOffice`) view of the
  world; a single shared secret (`HUB_ADMIN_TOKEN` env var, falling back to a
  generated `world.hubToken`) unlocks writes. The server computes
  `admin = token === adminToken(world)` from an `x-hub-token` header or
  `?token=` query param (`src/server/hub.js:662-663`). The browser gets this
  token two ways: `GET /api/session` auto-hands it out when `host` is
  `localhost` (never on a deployment); otherwise a 🔒 icon in the topbar
  (`src/App.jsx`) opens a `window.prompt()`, and the value is cached in
  `localStorage` (`src/hub.js`, `TOKEN_KEY`).
- **Routing today:** `src/app/page.jsx` is the only route; it dynamically
  imports the fully client-rendered `App.jsx` (`ssr: false`). All navigation
  — map / building / floor / agent panel / modals — is one `view` string in
  React state (`'map' | buildingId | officeId`), plus a `modal` state object.
  Nothing is reflected in the URL; reload always returns to `view === 'map'`
  unless `view` was persisted to `localStorage` (it is, separately from the
  routing this spec adds).
- **Slugs already exist and are unique:** every building has a `slug`
  (`src/server/buildings.js`, `buildingBySlug`) and every office/floor has a
  `slug` (`src/server/hub.js`, `officeBySlug`) — both generated once at
  creation and never reused. Nothing new needs to be invented for path
  segments.

## Architecture

**Cookie session, checked by Next.js middleware, riding on the existing
token-comparison logic — not a replacement of it.**

The server's admin check becomes:

```js
const token = req.headers.get('x-hub-token') || url.searchParams.get('token') || req.cookies.get('hub_session')?.value
const admin = !!token && token === adminToken(world)
```

That one-line change is the entire server-side authorization diff. Every
existing `if (!admin) fail(401, 'x-hub-token required')` guard across
`/api/offices`, `/api/buildings`, `/api/sources`, etc. keeps working
unmodified, because the cookie is just a third place the same secret can
come from. Same-origin `fetch()` calls already send cookies automatically,
so the client no longer needs to attach a header for admin actions at all.

`middleware.js` (project root, alongside `src/app`) runs on every request
except static assets:

- `/login` and `/api/login` (and `/api/logout`) are always allowed through.
- Anywhere else: if `hub_session` cookie is present and valid (matches
  `adminToken(world)`), allow.
- Anywhere else, cookie missing/invalid, **and host is not `localhost`**:
  redirect to `/login?next=<original path>`.
- Anywhere else, cookie missing/invalid, **and host is `localhost`**:
  transparently issue the cookie (same value `GET /api/session` already
  computes today) and allow the request through — preserving today's
  frictionless local-dev experience. A real deployment never gets this
  shortcut, exactly like `GET /api/session` never hands out the token on a
  deployment today.

This requires the middleware to read `world.hubToken` / `HUB_ADMIN_TOKEN`,
i.e. run with Node (not Edge) semantics and access to the store — matching
what `src/app/api/[...path]/route.js` already declares
(`export const runtime = 'nodejs'`).

### Login flow

- `GET /login` — a plain page (no client JS required) with one field,
  "Admin token", and a submit button. Styled with the existing dark/warm
  visual language (fonts, `--accent`, card look from `styles.css`) rather
  than a generic auth page.
- `POST /api/login` — compares the submitted token to `adminToken(world)`.
  - Wrong: re-render `/login` with an inline error ("That token was
    rejected"), field cleared, no redirect.
  - Right: set `hub_session` as an httpOnly, `SameSite=Lax`, `Secure` (except
    on `localhost`), 30-day-`Max-Age` cookie, then redirect to `next` (from
    the query string middleware attached when it bounced the request) or `/`
    if there wasn't one.
- **Logout:** a "Log out" control in the topbar (replacing today's 🔒
  read-only icon — there is no more read-only mode, so it no longer applies)
  calls `POST /api/logout`, which clears the cookie and redirects to
  `/login`.
- **Mid-session expiry:** no special client handling needed — the next real
  navigation (every screen change is now a route change) hits middleware and
  redirects, same as a first visit.

### Routing

Real App Router segments replace the single catch-all page:

| Route | Renders |
|---|---|
| `/` | Town map (`TownMap.jsx`, unchanged) |
| `/login` | Login form |
| `/<building-slug>` | That building: `Building.jsx` tower view if `kind === 'workspace'`; the map with the existing landmark description-card modal auto-opened if `kind === 'landmark'` |
| `/<building-slug>/<floor-slug>` | That floor inside that building: `OfficeFloor.jsx`, unchanged, with the building's breadcrumb/floor-tabs shown exactly as today's in-app drill-down |

`App.jsx` stops owning `view` as free-standing state. It derives "what to
show" from the URL (`useParams()` / `usePathname()` from `next/navigation`)
and performs navigation via `router.push(...)` instead of `setView(...)` —
`TownMap`, `Building`, `OfficeFloor`, `BuildingSprite` need no changes; only
`App.jsx`'s navigation plumbing (`open`, `goMap`, the `onCreated` handlers
that currently call `setView`) is rewritten to push routes.

**Cross-mode links resolve automatically.** Building slugs are unique across
mock and real data (`buildingBySlug` doesn't filter by source). If a URL
names a building that exists only in the mode the visitor doesn't currently
have selected, the app switches mode to reveal it instead of showing "not
found" — a shared link behaves the same regardless of which mode was last
selected in that browser.

**Unknown slugs stay soft.** A building slug that doesn't exist, or a floor
slug that isn't inside that building, keeps the requested URL and renders
the existing in-app "Not found — back to the map" panel (`src/App.jsx`'s
current fallback) rather than a hard Next.js 404 boundary — the topbar, mode
toggle, and login/logout stay visible and usable.

**Explicitly out of scope** (stays as today's ephemeral client state, not
reflected in the URL): the selected-agent side panel, open modals (add
building, add floor, hire, connect, sources), and which side-tab (Comms /
Agent / API) is active.

## What Doesn't Change

- `TownMap.jsx`, `Building.jsx`, `OfficeFloor.jsx`, `BuildingSprite.jsx`,
  `Modals.jsx`'s form components, the whole data model
  (`server/buildings.js`, `server/world.js`, `server/sources.js`), and every
  `/api/*` route's business logic except the admin-token extraction line
  above.
- The mock/real mode toggle, demo traffic simulator, and connected-systems
  (source sync) features are untouched.

## Testing

Same hybrid approach as the town-map feature: `node:test` for the
login/session logic (token comparison, cookie set/clear on login/logout,
middleware's local-vs-deployed branching, cross-mode slug resolution) and
browser verification for the redirect behavior and route rendering — walking
login → map → building → floor → back, plus a direct deep-link visit to a
floor URL while logged out (should redirect to `/login?next=...` and land
back on that floor after logging in).

## Out of Scope

- Multiple admin accounts / usernames — still one shared secret.
- Reflecting agent selection, modals, or side-tab state in the URL.
- Any change to how mock/real mode data is generated or synced.
- Rate-limiting or brute-force protection on `/api/login` (single shared
  secret, single operator — acceptable for now; flagged here rather than
  silently skipped).
