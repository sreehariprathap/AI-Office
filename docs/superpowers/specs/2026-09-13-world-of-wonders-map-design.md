# World of Wonders — town map design

**Date:** 2026-09-13
**Repo:** AI-Office (the hub / Agent HQ app)
**Status:** approved design, ready for an implementation plan

## Goal

Today the hub opens onto a single building whose floors are the connected
markets. That models one system well and more than one badly: a second
connected source would just pile more floors into the same tower.

This change adds a world above the building. Opening the app lands on a town
map — "World of Wonders" — where each building is a workspace. The current
Agent HQ tower becomes one building on that map (renamed "Financial Market",
holding the four market floors it already has). An admin can add more
buildings, and clicking any building drills into the floors and people it
already knows how to render.

Hierarchy, before and after:

```
before:   world → offices (floors) → agents
after:    world → buildings → offices (floors) → agents
```

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| What a building *is* | new `world.buildings[]` entity; offices gain `buildingId` | building = a connected source (can't add empty buildings); building = a string label on offices (can't exist without floors, can't be styled) |
| "On login" | no auth work — the map is simply the default landing view | a real login screen (separate concern, its own spec if wanted) |
| What an admin-added building is for | mix: `workspace` (holds floors) or `landmark` (scenery, no drill-down) | workspace-only; decorative-only |
| Building placement | auto-layout on a town grid, derived not stored | admin drag-and-drop; auto-now-store-xy-for-later |
| Art target | match the reference town closely, reached in staged passes | same-style-but-simpler; plain cards on a canvas |
| Testing | hybrid: `node:test` for logic invariants + browser verification for visuals | browser-only; full test framework |

## Data model

New entity, `world.buildings[]`:

```js
{
  id, slug,                         // slug is the stable handle: /api/buildings/financial-market
  name: 'Financial Market',
  kind: 'workspace' | 'landmark',   // holds floors, or pure scenery
  sprite: 'market' | 'lab' | 'studio' | 'cafe' | 'gym' | 'library' | 'post' | 'tower',
  theme,                            // existing THEMES palette key
  description,
  sourceId,                         // links a connected source's floors; null for hand-made
  createdAt,
}
```

`office.buildingId` — every office belongs to exactly one building. That is
the only change to the office shape.

Three rules keep this coherent:

1. **Buildings are always hub-owned, even source-linked ones.** The
   `agent-hq/v1` snapshot protocol has no concept of buildings, so nothing
   upstream overwrites them: the auto-created one can be freely renamed to
   "Financial Market", re-sprited, and re-themed. `sourceId` is only a link,
   used for auto-assigning synced offices and for mode filtering. This
   deliberately avoids the `external` + `notManaged` edit lock that applies
   to synced offices and agents.
2. **One building per source, auto-created on first sync.** When
   `applySnapshot` runs for a source with no building yet, it creates one
   (named from the source's `remoteName`, sprite `market`) and assigns that
   source's offices to it.
3. **Mode filtering keys off `sourceId` for buildings** — set means real,
   unset means mock. Offices keep their existing `external` rule and
   additionally inherit visibility from their building.

## API surface

Mirrors the existing office routes one level up.

| Route | Who | Notes |
|---|---|---|
| `GET /api/buildings` | anyone | mode-filtered list of `buildingView` |
| `POST /api/buildings` | admin | `{name, kind, sprite, theme, description}` |
| `GET /api/buildings/:slug` | anyone | one `buildingView` with its floors |
| `PATCH /api/buildings/:slug` | admin | name / kind / sprite / theme / description |
| `DELETE /api/buildings/:slug` | admin | 409 if it still holds floors |
| `POST /api/offices` | admin | gains `buildingSlug` in body |
| `PATCH /api/offices/:slug` | admin | gains `buildingSlug`, to move a floor between buildings |

`POST /api/offices` resolves `buildingSlug` as: use it if given; if omitted
and exactly one workspace building exists, use that one; if omitted with
several, 400.

`buildingView(b)` mirrors the existing `officeView` rollup, so the map can
label every building from data already in the payload:

```js
{ ...building,
  endpoint: '/api/buildings/financial-market',
  floors: [{ id, slug, name, theme, numberOfAgents, online, stats }],
  numberOfFloors, numberOfAgents, online,
  stats: { working, idle, meeting, error, offline },   // summed across floors
}
```

`GET /api/state` gains `buildings: [...]`, keeping the single poll the UI
already runs as the only request on the hot path.

Two invariants are enforced server-side, not only in the UI:

- Deleting a building that still holds floors returns 409 naming the floors —
  empty it first (delete or move them). Never silently orphan a floor.
- A `landmark` cannot hold floors: creating or moving an office into one is a
  400, and flipping a populated `workspace` to `landmark` is refused.

## Navigation and views

Three view states replace today's two:

```
'map'                 the town                              ← new default landing
{ building: slug }    that building's tower of floors       ← today's Building.jsx, scoped
{ office: slug }      the floor: desks and people           ← today's OfficeFloor.jsx, unchanged
```

`OfficeFloor` is untouched — it already takes a single office. `Building.jsx`
changes only in rendering one building's offices rather than every office in
the world.

The topbar becomes contextual, because a flat list of every floor is the wrong
axis once floors live in different buildings:

- **On the map** — brand, building count, `＋ Add building` (admin), mode
  toggle. No floor tabs.
- **Inside a building** — today's floor tabs, scoped to that building.
- **Breadcrumb** replaces the lone "🏢 Building" tab:
  `World of Wonders › Financial Market › Crypto Desk`, each segment clickable.

Brand text becomes **WORLD OF WONDERS**; clicking it returns to the map.

Clicking a building:

- `workspace` with floors → its tower
- `workspace`, empty → its tower showing "No floors yet" plus `＋ Add floor`
  for admins
- `landmark` → a name/description card in place, no drill-down

Unchanged on purpose: view persistence stays in `localStorage` (`hq:view`),
and there is still no URL routing — the hub has never had it, and deep links
are a separate self-contained change. `select(id, jump)` keeps working: it
jumps to the agent's office, and building context derives from that office's
`buildingId`.

Returning users have a stored `hq:view` from the old two-state model. On read:
the literal `'campus'` maps to `'map'`; an office id/slug that still resolves
maps to `{ office: slug }`; anything unrecognised falls back to `'map'`. So an
existing session lands somewhere sensible rather than on a blank view.

## Map rendering

One new layout function in `world.js`, mirroring `layoutFloor`. Everything is
derived; nothing is hand-placed or stored:

```js
layoutTown(buildings) → {
  W, H,                                     // canvas grows with building count
  lots:    [{ building, x, y, w, h, row }], // two rows, main street between
  street:  { path, lamps: [...] },
  scenery: [{ type, x, y, variant }],       // trees, planters, fences, benches
}
```

Scenery placement is seeded from a hash of the town, the same way `lookOf()`
seeds each agent's appearance, so the town varies but never reshuffles between
renders or viewers.

One `<BuildingSprite kind theme name stats />` component, not N drawings: roof
shape, wall colour, sign board, window grid and door derive from `sprite` +
`theme`. A new kind is a variant entry, not a new file. Each building is a
`<g>` with a `<title>` tooltip and `onClick` — the same pattern as today's
desks and floors — with `shapeRendering="auto"` so curves render smooth inside
the `crispEdges` root.

The established visual language carries over: dusk sky gradient, soft-blurred
backdrop, vignette framing, drop shadows, flat-illustration treatment. The town
must read as the same world as the building interiors.

Each building's sign carries its `buildingView` rollup — name, floor count,
agent count, and an alert pip (the existing `err-dot`) when any agent inside is
in `error` — so the state of the whole world is readable without drilling in.

### Staging

Because placement and scenery are derived rather than authored, every later art
pass is visual-only, with no risk to the model or navigation.

- **This spec ships:** `layoutTown`, ground + street + lamps, the eight sprite
  kinds, basic scenery (trees, planters, fences), sky + vignette, hover/click,
  sign rollups.
- **Follow-up art passes:** river and bridges, forest and mountain backdrop,
  per-kind facade detail, NPCs walking the street, compass rose and title
  banner.

## Migration

Runs inside `initWorld`, idempotently, on every load — a no-op once adopted:

- a synced office without a `buildingId` → its source's building, created on
  the spot from the source's `remoteName` if missing
- a hand-made office without a `buildingId` → a single auto-created
  "Head Office" workspace building

No manual step and no downtime; the live world picks it up on its next
request. `buildSeed` also gains buildings so mock mode renders as a town.

## Edge cases

| Case | Behaviour |
|---|---|
| Source syncs a new office later | auto-assigned to that source's building |
| Source removed (`purgeSource`) | its building goes too, unless hand-made floors remain in it |
| Delete building with floors | 409, "empty it first" |
| Landmark given floors | 400 at create/move; populated workspace → landmark refused |
| No buildings at all | empty lot with `＋ Add building` (admin), or "nothing here yet" |
| Mock ⇄ real toggle | switches towns; each mode has its own buildings |
| Second source connected | a second building appears beside the first |
| Source unreachable | building renders; its floors keep today's "Source unreachable" state |

## Testing

Hybrid, proportionate to a repo that currently has no test suite.

**`node:test`** (Node's built-in runner — no new dependencies, no config),
covering pure logic only:

- `layoutTown` — determinism for a given building set; no overlapping lots;
  canvas grows with count
- `initWorld` migration — adopts orphaned offices; idempotent across repeated
  loads; synced offices land in their source's building
- building invariants through the route handlers — delete-with-floors 409,
  landmark-with-floors 400, `buildingSlug` resolution rules, source
  auto-assign on sync

**Browser verification** for everything visual, the workflow already in use:
`npm run build`, then screenshots at desktop and mobile widths covering the
map, a building's tower, a floor, an empty building, and a landmark.

## Out of scope

Named explicitly so they don't creep in: real authentication, URL routing and
deep links, admin drag-placement of buildings, and the follow-up art passes
listed under Staging.

## Implementation constraints

- `AGENTS.md` warns this Next.js version has breaking changes against training
  data. Read the relevant guide in `node_modules/next/dist/docs/` before
  writing server/route code.
- Follow the existing route style in `src/server/hub.js`: `route(method, path,
  handler)`, `fail(status, msg)` for errors, `if (!admin) fail(401, ...)` for
  admin gates, and a `q(world)` query helper for views.
- The hub is serverless: no timers, no module-level mutable state. All state
  changes go through `withWorld`.
