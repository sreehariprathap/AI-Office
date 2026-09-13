# World of Wonders Town Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a town map above the existing single building, so the app opens onto a world of buildings, each holding floors of agents.

**Architecture:** A new `world.buildings[]` entity owns offices via `office.buildingId`. Pure building logic lives in a new `src/server/buildings.js` (unit-tested with `node:test`); `hub.js` only gains thin routes over it. The map is rendered by a new `layoutTown()` in `src/world.js` (deterministic, derived — nothing stored) feeding a new `TownMap` component built from one parameterised `BuildingSprite`. `App.jsx` grows from two view states to three (map → building → floor).

**Tech Stack:** Next.js 16 (App Router, serverless), React 19, plain SVG for all artwork, `node:test` for logic tests, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-world-of-wonders-map-design.md`

## Global Constraints

- **Next.js breaking changes:** `AGENTS.md` warns this Next.js version differs from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing server/route code.
- **Serverless:** no timers, no module-level mutable state. All world mutations go through `withWorld`.
- **Route style:** follow `src/server/hub.js` — `route(method, pattern, handler)`, handler receives `{ world, admin, can, req, url, params, body }`, errors via `fail(status, message)`, admin gates via `if (!admin) fail(401, 'x-hub-token required')`.
- **ESM only:** `package.json` has `"type": "module"`. Use `import`, never `require`.
- **No new dependencies.** Tests use Node's built-in `node:test` + `node:assert/strict`.
- **Buildings are always hub-owned.** Never apply the `external`/`notManaged` edit lock to a building, even a source-linked one.
- **Persistence:** `localStorage` key `hq:view`. No URL routing, no deep links.
- **Copy:** the product name is exactly `World of Wonders`.
- **Field names are fixed** by the spec: `buildings[]`, `office.buildingId`, `kind` (`workspace`|`landmark`), `sprite`, `sourceId`.

---

## File Structure

**Created:**
- `src/server/buildings.js` — pure building logic: constants, create, source-linking, migration, queries. No HTTP concerns.
- `src/components/BuildingSprite.jsx` — one parameterised building facade (roof/walls/sign/windows/door by `sprite` + `theme`).
- `src/components/TownMap.jsx` — the map scene: ground, street, scenery, building lots.
- `tests/buildings.test.js` — migration + query + invariant logic.
- `tests/townLayout.test.js` — `layoutTown` determinism and geometry.

**Modified:**
- `src/server/hub.js` — `ensureBuildings` in `initWorld`, `buildingView` in `q()`, building routes, `/api/state`, office routes gain `buildingSlug`.
- `src/server/sources.js` — `applySnapshot` assigns synced offices to the source's building; `purgeSource` drops it.
- `src/server/seed.js` — mock world gains buildings.
- `src/world.js` — add `layoutTown()` beside `layoutFloor()`.
- `src/App.jsx` — three view states, contextual topbar, breadcrumb, brand rename, stored-view migration.
- `src/components/Building.jsx` — render one building's offices instead of all.
- `src/components/Modals.jsx` — add `NewBuildingModal`.
- `src/styles.css` — map, breadcrumb, building-card styles.
- `package.json` — add `"test"` script.

---

### Task 1: Buildings module — constants, create, migration

**Files:**
- Create: `src/server/buildings.js`
- Create: `tests/buildings.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BUILDING_KINDS`, `BUILDING_SPRITES`, `createBuilding(world, opts) -> building`, `buildingForSource(world, src) -> building`, `ensureBuildings(world) -> world`, `floorsOf(world, building) -> office[]`, `buildingBySlug(world, slug) -> building | undefined`.

- [ ] **Step 1: Add the test script to package.json**

Change the `scripts` block to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --test tests/",
    "agent:demo": "node examples/agent-client.js"
  },
```

- [ ] **Step 2: Write the failing tests**

Create `tests/buildings.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuilding, buildingForSource, ensureBuildings, floorsOf, buildingBySlug } from '../src/server/buildings.js'

const emptyWorld = (over = {}) => ({ buildings: [], offices: [], agents: [], sources: [], ...over })

test('createBuilding defaults to a workspace with a unique slug', () => {
  const world = emptyWorld()
  const a = createBuilding(world, { name: 'Financial Market' })
  const b = createBuilding(world, { name: 'Financial Market' })
  assert.equal(a.kind, 'workspace')
  assert.equal(a.slug, 'financial-market')
  assert.notEqual(b.slug, a.slug, 'second building with the same name gets a distinct slug')
  assert.equal(world.buildings.length, 2)
})

test('createBuilding rejects unknown kind and sprite by falling back', () => {
  const world = emptyWorld()
  const b = createBuilding(world, { name: 'X', kind: 'nonsense', sprite: 'nonsense' })
  assert.equal(b.kind, 'workspace')
  assert.equal(b.sprite, 'tower')
})

test('buildingForSource creates one building per source and reuses it', () => {
  const world = emptyWorld({ sources: [{ id: 'src-1', name: 'Workforce', remoteName: "Sreehari's AI Workforce" }] })
  const first = buildingForSource(world, world.sources[0])
  const second = buildingForSource(world, world.sources[0])
  assert.equal(first.id, second.id)
  assert.equal(first.name, "Sreehari's AI Workforce")
  assert.equal(first.sourceId, 'src-1')
  assert.equal(world.buildings.length, 1)
})

test('ensureBuildings adopts synced offices into their source building', () => {
  const world = emptyWorld({
    sources: [{ id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }],
    offices: [{ id: 'o1', slug: 'crypto', external: true, source: 'src-1' }],
  })
  ensureBuildings(world)
  const building = world.buildings.find((b) => b.sourceId === 'src-1')
  assert.ok(building, 'source building created')
  assert.equal(world.offices[0].buildingId, building.id)
})

test('ensureBuildings puts hand-made offices in one shared Head Office', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }, { id: 'o2', slug: 'b' }] })
  ensureBuildings(world)
  assert.equal(world.buildings.length, 1)
  assert.equal(world.buildings[0].name, 'Head Office')
  assert.equal(world.offices[0].buildingId, world.offices[1].buildingId)
})

test('ensureBuildings is idempotent', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const snapshot = JSON.stringify(world)
  ensureBuildings(world)
  ensureBuildings(world)
  assert.equal(JSON.stringify(world), snapshot, 'repeat runs change nothing')
})

test('floorsOf and buildingBySlug read back what was written', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const b = buildingBySlug(world, world.buildings[0].slug)
  assert.equal(floorsOf(world, b).length, 1)
  assert.equal(buildingBySlug(world, 'nope'), undefined)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/server/buildings.js'`

- [ ] **Step 4: Write the implementation**

Create `src/server/buildings.js`:

```js
// Buildings — the layer above offices. A building holds floors (offices);
// a floor holds agents.
//
// Buildings are ALWAYS hub-owned, even when linked to a connected source:
// the agent-hq/v1 snapshot protocol has no concept of buildings, so nothing
// upstream can overwrite one. `sourceId` is only a link — used to auto-adopt
// that source's floors and for mock/real filtering — never an edit lock.
import { randomUUID } from 'node:crypto'

export const BUILDING_KINDS = ['workspace', 'landmark']
export const BUILDING_SPRITES = ['market', 'lab', 'studio', 'cafe', 'gym', 'library', 'post', 'tower']
export const DEFAULT_SPRITE = 'tower'

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building'

export const buildingBySlug = (world, slug) =>
  world.buildings.find((b) => b.slug === slug || b.id === slug)

export const floorsOf = (world, building) =>
  world.offices.filter((o) => o.buildingId === building.id)

function uniqueSlug(world, base) {
  let slug = slugify(base)
  while (world.buildings.some((b) => b.slug === slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  return slug
}

export function createBuilding(world, { name, kind, sprite, theme, description, sourceId = null }) {
  const building = {
    id: randomUUID(),
    slug: uniqueSlug(world, name),
    name: String(name).slice(0, 40),
    kind: BUILDING_KINDS.includes(kind) ? kind : 'workspace',
    sprite: BUILDING_SPRITES.includes(sprite) ? sprite : DEFAULT_SPRITE,
    theme: theme || 'slate',
    description: String(description || '').slice(0, 200),
    sourceId,
    createdAt: Date.now(),
  }
  world.buildings.push(building)
  return building
}

/** The one building that owns a connected source's floors. Created on demand. */
export function buildingForSource(world, src) {
  const existing = world.buildings.find((b) => b.sourceId === src.id)
  if (existing) return existing
  return createBuilding(world, {
    name: src.remoteName || src.name || 'Connected System',
    sprite: 'market',
    theme: 'amber',
    sourceId: src.id,
  })
}

/**
 * Adopt every office that has no buildingId. Idempotent: once each office is
 * adopted this is a no-op, so it is safe to call on every world load.
 * Synced offices go to their source's building; hand-made ones share a single
 * "Head Office".
 */
export function ensureBuildings(world) {
  world.buildings ||= []
  const orphans = world.offices.filter((o) => !o.buildingId)
  if (!orphans.length) return world

  let headOffice = null
  for (const office of orphans) {
    if (office.source) {
      const src = world.sources.find((s) => s.id === office.source)
      if (src) {
        office.buildingId = buildingForSource(world, src).id
        continue
      }
    }
    headOffice ||=
      world.buildings.find((b) => !b.sourceId && b.kind === 'workspace') ||
      createBuilding(world, { name: 'Head Office', sprite: 'tower', theme: 'slate' })
    office.buildingId = headOffice.id
  }
  return world
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 tests passing.

- [ ] **Step 6: Commit**

```bash
git add package.json src/server/buildings.js tests/buildings.test.js
git commit -m "feat: buildings module with idempotent office adoption"
```

---

### Task 2: Wire migration into initWorld and seed the mock town

**Files:**
- Modify: `src/server/hub.js` (imports; `initWorld`)
- Modify: `src/server/seed.js` (`buildSeed`)
- Modify: `tests/buildings.test.js` (append)

**Interfaces:**
- Consumes: `ensureBuildings`, `createBuilding` from Task 1.
- Produces: every loaded world has `world.buildings[]` populated and every office has a `buildingId`. `buildSeed()` returns `{ buildings, offices, agents, connections, messages }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/buildings.test.js`:

```js
import { buildSeed } from '../src/server/seed.js'

test('buildSeed produces buildings and every office belongs to one', () => {
  const seed = buildSeed()
  assert.ok(seed.buildings.length > 0, 'seed has buildings')
  for (const office of seed.offices) {
    assert.ok(office.buildingId, `office ${office.slug} has a buildingId`)
    assert.ok(seed.buildings.some((b) => b.id === office.buildingId), 'buildingId resolves')
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `seed has buildings` (buildSeed has no `buildings` key).

- [ ] **Step 3: Add buildings to the seed**

In `src/server/seed.js`, add the import at the top:

```js
import { createBuilding } from './buildings.js'
```

Inside `buildSeed()`, immediately after the `offices` array is built, insert:

```js
  // Mock mode is a town too: one workspace building holding the demo floors,
  // plus a landmark so the map shows both kinds from first boot.
  const seedWorld = { buildings: [], offices, sources: [] }
  const headquarters = createBuilding(seedWorld, {
    name: 'Head Office',
    sprite: 'tower',
    theme: 'slate',
    description: 'Where the demo team works.',
  })
  createBuilding(seedWorld, {
    name: 'Cafe',
    kind: 'landmark',
    sprite: 'cafe',
    theme: 'amber',
    description: 'Nothing runs here. It just makes the street feel lived-in.',
  })
  offices.forEach((o) => { o.buildingId = headquarters.id })
  const buildings = seedWorld.buildings
```

Then add `buildings` to the object `buildSeed` returns (alongside `offices`, `agents`, …).

- [ ] **Step 4: Wire the migration into initWorld**

In `src/server/hub.js`, add to the imports:

```js
import { ensureBuildings } from './buildings.js'
```

In `initWorld`, add the `buildings` default beside the other `||=` lines and call the migration just before `ensureEnvSource(world)`:

```js
  world.buildings ||= []
  // ... existing ||= lines ...
  ensureEnvSource(world)
  ensureBuildings(world)   // adopts any office that predates buildings; no-op afterwards
  return world
```

Note the order: `ensureEnvSource` first, so the env-configured source exists before `ensureBuildings` looks for its building.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 tests.

- [ ] **Step 6: Verify a legacy world migrates**

Run: `npm run build`
Expected: build succeeds.

Then run `npm run dev` and `curl -s localhost:3000/api/state | head -c 400`.
Expected: the payload parses and the server logs no errors. (Buildings are not in `/api/state` yet — that is Task 3.)

- [ ] **Step 7: Commit**

```bash
git add src/server/hub.js src/server/seed.js tests/buildings.test.js
git commit -m "feat: adopt offices into buildings on world load, seed a mock town"
```

---

### Task 3: buildingView and /api/state

**Files:**
- Modify: `src/server/hub.js` (`q()`, `/api/state` route)
- Modify: `tests/buildings.test.js` (append)

**Interfaces:**
- Consumes: `floorsOf` from Task 1.
- Produces: `q(world).buildingView(building) -> { ...building, endpoint, floors[], numberOfFloors, numberOfAgents, online, stats }`. `GET /api/state` includes `buildings`.

- [ ] **Step 1: Write the failing test**

Append to `tests/buildings.test.js`:

```js
import { buildingSummary } from '../src/server/buildings.js'

test('buildingSummary rolls floor and agent counts up from offices', () => {
  const world = emptyWorld({
    offices: [{ id: 'o1', slug: 'a', name: 'A', theme: 'teal' }, { id: 'o2', slug: 'b', name: 'B', theme: 'teal' }],
    agents: [
      { id: 'a1', officeId: 'o1', status: 'working' },
      { id: 'a2', officeId: 'o1', status: 'error' },
      { id: 'a3', officeId: 'o2', status: 'offline' },
    ],
  })
  ensureBuildings(world)
  const view = buildingSummary(world, world.buildings[0])
  assert.equal(view.numberOfFloors, 2)
  assert.equal(view.numberOfAgents, 3)
  assert.equal(view.online, 2, 'offline agents are not online')
  assert.equal(view.stats.error, 1)
  assert.equal(view.floors[0].numberOfAgents, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildingSummary is not a function`.

- [ ] **Step 3: Implement buildingSummary**

Append to `src/server/buildings.js`:

```js
const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']

/**
 * The rollup a building shows on the map: its floors plus the totals across
 * them. Pure — takes a world, returns data, touches no HTTP concerns.
 */
export function buildingSummary(world, building) {
  const floors = floorsOf(world, building)
  const agentsIn = (office) => world.agents.filter((a) => a.officeId === office.id)
  const all = floors.flatMap(agentsIn)
  const count = (status) => all.filter((a) => a.status === status).length
  return {
    ...building,
    endpoint: `/api/buildings/${building.slug}`,
    floors: floors.map((o) => {
      const agents = agentsIn(o)
      return {
        id: o.id,
        slug: o.slug,
        name: o.name,
        theme: o.theme,
        numberOfAgents: agents.length,
        online: agents.filter((a) => a.status !== 'offline').length,
        stats: Object.fromEntries(STATUSES.map((s) => [s, agents.filter((a) => a.status === s).length])),
      }
    }),
    numberOfFloors: floors.length,
    numberOfAgents: all.length,
    online: all.filter((a) => a.status !== 'offline').length,
    stats: Object.fromEntries(STATUSES.map((s) => [s, count(s)])),
  }
}
```

- [ ] **Step 4: Expose it through the hub**

In `src/server/hub.js`, extend the `buildings.js` import:

```js
import { ensureBuildings, buildingSummary } from './buildings.js'
```

Inside `function q(world)`, add before the `return` and include it in the returned object:

```js
  const buildingView = (b) => buildingSummary(world, b)
```

```js
  return { officeBySlug, agentById, officeOf, agentView, connectionView, officeView, buildingView }
```

In the `GET /api/state` handler, add `buildings` to the returned object, mode-filtered the same way the UI filters everything else — a building is "real" when it has a `sourceId`:

```js
    buildings: world.buildings.map((b) => q(world).buildingView(b)),
```

Place it directly above the existing `offices:` line so the payload reads top-down (buildings → offices → agents).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 9 tests.

- [ ] **Step 6: Verify the payload**

Run `npm run dev`, then:

```bash
curl -s localhost:3000/api/state | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.buildings.map(b=>`${b.name} kind=${b.kind} floors=${b.numberOfFloors} agents=${b.numberOfAgents}`))})"
```

Expected: at least one building printed with a non-zero floor count.

- [ ] **Step 7: Commit**

```bash
git add src/server/hub.js src/server/buildings.js tests/buildings.test.js
git commit -m "feat: buildingView rollup exposed in /api/state"
```

---

### Task 4: Building CRUD routes and their invariants

**Files:**
- Modify: `src/server/hub.js` (new routes after the office routes)
- Modify: `tests/buildings.test.js` (append)

**Interfaces:**
- Consumes: `createBuilding`, `buildingBySlug`, `floorsOf`, `buildingSummary`, `BUILDING_KINDS`, `BUILDING_SPRITES`.
- Produces: `GET/POST /api/buildings`, `GET/PATCH/DELETE /api/buildings/:slug`. Produces `canBecomeLandmark(world, building) -> boolean` used by Task 5.

- [ ] **Step 1: Write the failing test**

Append to `tests/buildings.test.js`:

```js
import { canBecomeLandmark } from '../src/server/buildings.js'

test('a populated workspace cannot become a landmark; an empty one can', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const populated = world.buildings[0]
  assert.equal(canBecomeLandmark(world, populated), false)

  const empty = createBuilding(world, { name: 'Gym', sprite: 'gym' })
  assert.equal(canBecomeLandmark(world, empty), true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `canBecomeLandmark is not a function`.

- [ ] **Step 3: Implement the predicate**

Append to `src/server/buildings.js`:

```js
/** A building may only become a landmark while it holds no floors. */
export const canBecomeLandmark = (world, building) => floorsOf(world, building).length === 0
```

- [ ] **Step 4: Add the routes**

In `src/server/hub.js`, extend the import:

```js
import {
  ensureBuildings, buildingSummary, createBuilding, buildingBySlug, floorsOf, canBecomeLandmark,
  BUILDING_KINDS, BUILDING_SPRITES,
} from './buildings.js'
```

Add these routes immediately after the existing `/api/offices/...` routes:

```js
const buildingOr404 = (world, slug) => buildingBySlug(world, slug) || fail(404, 'building not found')

route('GET', '/api/buildings', ({ world }) => world.buildings.map((b) => q(world).buildingView(b)))

route('POST', '/api/buildings', ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  if (!body.name) fail(400, 'name required')
  if (body.kind && !BUILDING_KINDS.includes(body.kind)) fail(400, `kind must be one of ${BUILDING_KINDS.join(', ')}`)
  if (body.sprite && !BUILDING_SPRITES.includes(body.sprite)) fail(400, `sprite must be one of ${BUILDING_SPRITES.join(', ')}`)
  const building = createBuilding(world, body)
  return [201, q(world).buildingView(building)]
})

route('GET', '/api/buildings/:slug', ({ world, params }) =>
  q(world).buildingView(buildingOr404(world, params.slug)))

route('PATCH', '/api/buildings/:slug', ({ world, admin, params, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  const building = buildingOr404(world, params.slug)
  // Source-linked buildings stay editable on purpose: the snapshot protocol
  // has no concept of buildings, so nothing upstream will overwrite this.
  if (body.kind === 'landmark' && !canBecomeLandmark(world, building)) {
    fail(400, `"${building.name}" still holds floors — move or delete them before making it a landmark`)
  }
  if (body.kind && !BUILDING_KINDS.includes(body.kind)) fail(400, `kind must be one of ${BUILDING_KINDS.join(', ')}`)
  if (body.sprite && !BUILDING_SPRITES.includes(body.sprite)) fail(400, `sprite must be one of ${BUILDING_SPRITES.join(', ')}`)
  for (const k of ['name', 'kind', 'sprite', 'theme', 'description']) {
    if (body[k] !== undefined) building[k] = k === 'name' ? String(body[k]).slice(0, 40) : body[k]
  }
  return q(world).buildingView(building)
})

route('DELETE', '/api/buildings/:slug', ({ world, admin, params }) => {
  if (!admin) fail(401, 'x-hub-token required')
  const building = buildingOr404(world, params.slug)
  const floors = floorsOf(world, building)
  if (floors.length) {
    fail(409, `"${building.name}" still holds ${floors.length} floor(s): ${floors.map((f) => f.name).join(', ')} — delete or move them first`)
  }
  world.buildings = world.buildings.filter((b) => b.id !== building.id)
  return { ok: true }
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 10 tests.

- [ ] **Step 6: Verify the guards over HTTP**

Run `npm run dev`. Get the admin token from `.env` (`HUB_ADMIN_TOKEN`), then:

```bash
T=$(grep HUB_ADMIN_TOKEN .env | cut -d= -f2)
# create
curl -s -X POST localhost:3000/api/buildings -H "x-hub-token: $T" -H 'content-type: application/json' \
  -d '{"name":"Research Lab","sprite":"lab"}' | head -c 200; echo
# delete a building that has floors -> 409
SLUG=$(curl -s localhost:3000/api/buildings | node -pe "JSON.parse(require('fs').readFileSync(0)).find(b=>b.numberOfFloors>0).slug")
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "localhost:3000/api/buildings/$SLUG" -H "x-hub-token: $T"
```

Expected: create returns the new building JSON; the delete prints `409`.

- [ ] **Step 7: Commit**

```bash
git add src/server/hub.js src/server/buildings.js tests/buildings.test.js
git commit -m "feat: building CRUD routes with empty-before-delete and landmark guards"
```

---

### Task 5: Office routes accept buildingSlug

**Files:**
- Modify: `src/server/hub.js` (`POST /api/offices`, `PATCH /api/offices/:slug`)
- Modify: `tests/buildings.test.js` (append)

**Interfaces:**
- Consumes: `buildingBySlug`, `floorsOf` from Task 1; `canBecomeLandmark` from Task 4.
- Produces: `resolveBuilding(world, slug) -> { building } | { error }` used by both office routes.

- [ ] **Step 1: Write the failing test**

Append to `tests/buildings.test.js`:

```js
import { resolveBuilding } from '../src/server/buildings.js'

test('resolveBuilding falls back to the only workspace when no slug is given', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  assert.equal(resolveBuilding(world, undefined).building.id, world.buildings[0].id)
})

test('resolveBuilding demands a slug once there are several workspaces', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  createBuilding(world, { name: 'Research Lab', sprite: 'lab' })
  assert.match(resolveBuilding(world, undefined).error, /buildingSlug required/)
})

test('resolveBuilding refuses landmarks and unknown slugs', () => {
  const world = emptyWorld()
  const cafe = createBuilding(world, { name: 'Cafe', kind: 'landmark', sprite: 'cafe' })
  assert.match(resolveBuilding(world, cafe.slug).error, /landmark/)
  assert.match(resolveBuilding(world, 'nope').error, /not found/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `resolveBuilding is not a function`.

- [ ] **Step 3: Implement the resolver**

Append to `src/server/buildings.js`:

```js
/**
 * Which building a new or moved floor belongs to. Returns `{ building }` or
 * `{ error }` — the caller decides the HTTP status, keeping this module free
 * of HTTP concerns.
 */
export function resolveBuilding(world, slug) {
  if (slug) {
    const building = buildingBySlug(world, slug)
    if (!building) return { error: `building "${slug}" not found` }
    if (building.kind === 'landmark') return { error: `"${building.name}" is a landmark and cannot hold floors` }
    return { building }
  }
  const workspaces = world.buildings.filter((b) => b.kind === 'workspace')
  if (workspaces.length === 1) return { building: workspaces[0] }
  if (!workspaces.length) return { error: 'no workspace building exists — create one first' }
  return { error: `buildingSlug required: ${workspaces.map((b) => b.slug).join(', ')}` }
}
```

- [ ] **Step 4: Use it in the office routes**

In `src/server/hub.js`, extend the import with `resolveBuilding`.

In `POST /api/offices`, after the `if (!body.name) fail(400, 'name required')` line, add:

```js
  const target = resolveBuilding(world, body.buildingSlug)
  if (target.error) fail(400, target.error)
```

and add `buildingId: target.building.id,` to the office object literal.

In `PATCH /api/offices/:slug`, add before the existing field assignments:

```js
  if (body.buildingSlug !== undefined) {
    const moved = resolveBuilding(world, body.buildingSlug)
    if (moved.error) fail(400, moved.error)
    o.buildingId = moved.building.id
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 13 tests.

- [ ] **Step 6: Verify over HTTP**

```bash
T=$(grep HUB_ADMIN_TOKEN .env | cut -d= -f2)
curl -s -X POST localhost:3000/api/offices -H "x-hub-token: $T" -H 'content-type: application/json' \
  -d '{"name":"Lab Floor 1","buildingSlug":"research-lab"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).buildingId ? 'has buildingId' : 'MISSING'"
```

Expected: `has buildingId`.

- [ ] **Step 7: Commit**

```bash
git add src/server/hub.js src/server/buildings.js tests/buildings.test.js
git commit -m "feat: offices are created into and moved between buildings"
```

---

### Task 6: Source sync adopts floors; purge removes the building

**Files:**
- Modify: `src/server/sources.js` (`applySnapshot`, `purgeSource`)
- Modify: `tests/buildings.test.js` (append)

**Interfaces:**
- Consumes: `buildingForSource`, `floorsOf` from Task 1.
- Produces: synced offices always carry a `buildingId`; removing a source removes its building unless hand-made floors remain.

- [ ] **Step 1: Write the failing test**

Append to `tests/buildings.test.js`:

```js
import { applySnapshot, purgeSource } from '../src/server/sources.js'

const snapshot = (offices) => ({
  protocol: 'agent-hq/v1',
  source: { id: 'ai-workforce', name: 'Workforce' },
  offices,
  messages: [],
})

test('applySnapshot puts every synced office in the source building', () => {
  const world = { buildings: [], offices: [], agents: [], connections: [], messages: [], sources: [] }
  const src = { id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }
  world.sources.push(src)
  applySnapshot(world, src, snapshot([
    { slug: 'crypto', name: 'Crypto Desk', agents: [], connections: [] },
    { slug: 'india', name: 'India Desk', agents: [], connections: [] },
  ]))
  const building = world.buildings.find((b) => b.sourceId === 'src-1')
  assert.ok(building)
  assert.equal(floorsOf(world, building).length, 2)
})

test('purgeSource removes the source building when nothing hand-made is left', () => {
  const world = { buildings: [], offices: [], agents: [], connections: [], messages: [], sources: [] }
  const src = { id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }
  world.sources.push(src)
  applySnapshot(world, src, snapshot([{ slug: 'crypto', name: 'Crypto Desk', agents: [], connections: [] }]))
  purgeSource(world, src)
  assert.equal(world.buildings.filter((b) => b.sourceId === 'src-1').length, 0)
  assert.equal(world.offices.length, 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — no building is created by `applySnapshot`.

- [ ] **Step 3: Implement**

In `src/server/sources.js`, add the import:

```js
import { buildingForSource, floorsOf } from './buildings.js'
```

In `applySnapshot`, before the `for (const o of snap.offices)` loop, resolve the building once:

```js
  world.buildings ||= []
  const building = buildingForSource(world, src)
```

and add `buildingId: building.id,` to the `next` office object built inside that loop (alongside `external: true` and `source: src.id`).

In `purgeSource`, after the existing filters that drop the source's records, add:

```js
  // Drop the source's building too, unless hand-made floors were moved into it.
  world.buildings = (world.buildings || []).filter(
    (b) => b.sourceId !== src.id || floorsOf(world, b).length > 0,
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 15 tests.

- [ ] **Step 5: Verify against the live source**

Run `npm run dev`, wait ~10s for the env source to sync, then:

```bash
curl -s localhost:3000/api/state | node -pe "JSON.parse(require('fs').readFileSync(0)).buildings.map(b=>b.name+': '+b.numberOfFloors+' floors').join('\n')"
```

Expected: one building named after the workforce source, holding its market floors (4 at time of writing).

- [ ] **Step 6: Commit**

```bash
git add src/server/sources.js tests/buildings.test.js
git commit -m "feat: synced floors land in their source's building"
```

---

### Task 7: layoutTown

**Files:**
- Modify: `src/world.js` (add `layoutTown` beside `layoutFloor`)
- Create: `tests/townLayout.test.js`

**Interfaces:**
- Consumes: `hash()` already exported from `src/world.js`.
- Produces: `layoutTown(buildings) -> { W, H, lots, street, scenery }` where `lots: [{ building, x, y, w, h, row }]`, `street: { x, y, w, h, lamps: [{x,y}] }`, `scenery: [{ type, x, y, variant }]`.

- [ ] **Step 1: Write the failing test**

Create `tests/townLayout.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutTown } from '../src/world.js'

const buildings = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, slug: `b-${i}`, name: `B${i}`, kind: 'workspace', sprite: 'tower' }))

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('every building gets exactly one lot', () => {
  const { lots } = layoutTown(buildings(5))
  assert.equal(lots.length, 5)
  assert.equal(new Set(lots.map((l) => l.building.id)).size, 5)
})

test('lots never overlap', () => {
  const { lots } = layoutTown(buildings(9))
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      assert.ok(!overlaps(lots[i], lots[j]), `lot ${i} overlaps lot ${j}`)
    }
  }
})

test('buildings alternate rows so the town stays balanced', () => {
  const { lots } = layoutTown(buildings(4))
  assert.equal(lots.filter((l) => l.row === 0).length, 2)
  assert.equal(lots.filter((l) => l.row === 1).length, 2)
})

test('the canvas grows with the town and never collapses when empty', () => {
  const small = layoutTown(buildings(2))
  const big = layoutTown(buildings(8))
  assert.ok(big.W > small.W, 'wider with more buildings')
  const empty = layoutTown([])
  assert.ok(empty.W > 0 && empty.H > 0, 'an empty town still has a canvas')
  assert.deepEqual(empty.lots, [])
})

test('layout is deterministic for the same buildings', () => {
  assert.deepEqual(layoutTown(buildings(6)), layoutTown(buildings(6)))
})

test('scenery is seeded by the town, so it changes only when the town does', () => {
  const a = layoutTown(buildings(3))
  const b = layoutTown(buildings(3))
  assert.deepEqual(a.scenery, b.scenery)
  const c = layoutTown(buildings(4))
  assert.notDeepEqual(a.scenery, c.scenery)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `layoutTown is not a function`.

- [ ] **Step 3: Implement layoutTown**

Append to `src/world.js`, directly after `layoutFloor`:

```js
// ---------------------------------------------------------------- town layout
// The map is derived, never stored: give it the buildings and it returns the
// whole scene. Same contract as layoutFloor one level up.
const LOT_W = 200
const LOT_H = 160
const LOT_GAP = 44
const STREET_H = 130
const TOWN_PAD = 70

export function layoutTown(buildings) {
  // Alternate rows so adding a building keeps both sides of the street even.
  const top = buildings.filter((_, i) => i % 2 === 0)
  const bottom = buildings.filter((_, i) => i % 2 === 1)
  const cols = Math.max(top.length, bottom.length, 1)

  const W = TOWN_PAD * 2 + cols * LOT_W + (cols - 1) * LOT_GAP
  const H = TOWN_PAD * 2 + LOT_H * 2 + STREET_H
  const lotX = (i) => TOWN_PAD + i * (LOT_W + LOT_GAP)
  const bottomY = TOWN_PAD + LOT_H + STREET_H

  const lots = [
    ...top.map((building, i) => ({ building, x: lotX(i), y: TOWN_PAD, w: LOT_W, h: LOT_H, row: 0 })),
    ...bottom.map((building, i) => ({ building, x: lotX(i), y: bottomY, w: LOT_W, h: LOT_H, row: 1 })),
  ]

  const street = {
    x: 0,
    y: TOWN_PAD + LOT_H,
    w: W,
    h: STREET_H,
    lamps: Array.from({ length: cols + 1 }, (_, i) => ({
      x: TOWN_PAD - LOT_GAP / 2 + i * (LOT_W + LOT_GAP),
      y: TOWN_PAD + LOT_H + STREET_H / 2,
    })),
  }

  // Seeded from the town itself: varied, but stable across renders and viewers.
  let seed = hash(buildings.map((b) => b.slug).join('|') || 'empty-town')
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const TYPES = ['tree', 'tree', 'planter', 'bench', 'fence']
  const scenery = []
  for (let i = 0; i < cols * 3 + 4; i++) {
    const onTopVerge = next() < 0.5
    scenery.push({
      type: TYPES[Math.floor(next() * TYPES.length)],
      x: Math.round(next() * (W - TOWN_PAD)) + TOWN_PAD / 2,
      y: Math.round(onTopVerge ? street.y - 14 - next() * 18 : street.y + street.h + 4 + next() * 18),
      variant: Math.floor(next() * 3),
    })
  }

  return { W, H, lots, street, scenery }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 21 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/world.js tests/townLayout.test.js
git commit -m "feat: layoutTown derives the whole map from the building list"
```

---

### Task 8: BuildingSprite component

**Files:**
- Create: `src/components/BuildingSprite.jsx`

**Interfaces:**
- Consumes: `themeOf` from `src/world.js`; `BUILDING_SPRITES` names from Task 1 (`market`, `lab`, `studio`, `cafe`, `gym`, `library`, `post`, `tower`).
- Produces: `<BuildingSprite building={building} w={number} h={number} />` — draws a facade with a hanging sign inside a `w × h` box, origin at its top-left.

No unit test: this is artwork with no logic worth pinning, and the spec chose browser verification for visuals. It is exercised by Task 9.

- [ ] **Step 1: Write the component**

Create `src/components/BuildingSprite.jsx`:

```jsx
import { THEMES } from '../world.js'

// One facade, parameterised by sprite + theme. A new building kind is a
// variant entry here, never a new file.
const SPRITE = {
  market:  { roof: 'flat',   storeys: 3, accent: '#e9b949', icon: '📈' },
  lab:     { roof: 'flat',   storeys: 2, accent: '#7fb4ff', icon: '🧪' },
  studio:  { roof: 'gable',  storeys: 2, accent: '#c7a2ff', icon: '🎨' },
  cafe:    { roof: 'awning', storeys: 1, accent: '#ff8a7a', icon: '☕' },
  gym:     { roof: 'gable',  storeys: 1, accent: '#5ee08a', icon: '🏋' },
  library: { roof: 'gable',  storeys: 2, accent: '#d9a441', icon: '📚' },
  post:    { roof: 'awning', storeys: 1, accent: '#ff9ec4', icon: '✉' },
  tower:   { roof: 'flat',   storeys: 4, accent: '#c9d4e0', icon: '🏢' },
}

export default function BuildingSprite({ building, w = 200, h = 160 }) {
  const s = SPRITE[building.sprite] || SPRITE.tower
  const t = THEMES[building.theme] || THEMES.slate
  const bodyH = h * 0.62
  const bodyY = h - bodyH
  const roofH = 26

  return (
    <g className="bsprite">
      {/* ground shadow */}
      <ellipse cx={w / 2} cy={h - 4} rx={w * 0.42} ry={9} fill="#000" opacity={0.22} />

      {/* roof */}
      {s.roof === 'gable' ? (
        <path d={`M4,${bodyY} L${w / 2},${bodyY - roofH - 8} L${w - 4},${bodyY} Z`} fill={t.trim} />
      ) : s.roof === 'awning' ? (
        <>
          <rect x={2} y={bodyY - roofH} width={w - 4} height={roofH} rx={6} fill={t.trim} />
          {Array.from({ length: 6 }).map((_, i) => (
            <rect key={i} x={2 + i * ((w - 4) / 6)} y={bodyY - roofH} width={(w - 4) / 12} height={roofH} fill={s.accent} opacity={0.55} />
          ))}
        </>
      ) : (
        <rect x={0} y={bodyY - roofH} width={w} height={roofH} rx={4} fill={t.trim} />
      )}

      {/* walls */}
      <rect x={10} y={bodyY} width={w - 20} height={bodyH} rx={8} fill={t.wall} />
      <rect x={10} y={bodyY} width={w - 20} height={bodyH} rx={8} fill="#000" opacity={0.12} />

      {/* windows, one band per storey */}
      {Array.from({ length: s.storeys }).map((_, row) => {
        const y = bodyY + 16 + row * ((bodyH - 46) / s.storeys)
        return Array.from({ length: 3 }).map((__, col) => (
          <rect
            key={`${row}-${col}`}
            x={28 + col * ((w - 66) / 3)}
            y={y}
            width={(w - 76) / 3}
            height={18}
            rx={3}
            fill="#8cc8f0"
            opacity={0.85}
          />
        ))
      })}

      {/* door */}
      <rect x={w / 2 - 16} y={h - 34} width={32} height={34} rx={4} fill={t.rug} />

      {/* hanging sign */}
      <g transform={`translate(${w / 2}, ${bodyY - roofH - 14})`}>
        <rect x={-4} y={-2} width={8} height={14} fill="#6e4a2b" />
        <rect x={-56} y={-30} width={112} height={30} rx={5} fill="#efe6cf" stroke={s.accent} strokeWidth={2.5} />
        <text x={0} y={-10} textAnchor="middle" className="bsign">
          {building.name}
        </text>
      </g>
    </g>
  )
}
```

- [ ] **Step 2: Add the sign style**

Append to `src/styles.css`:

```css
/* ------------------------------------------------ town map */
.bsign { font-family: var(--pixel); font-weight: 700; font-size: 13px; fill: #2a1d12; pointer-events: none; }
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (the component is not mounted yet — Task 9 mounts it).

- [ ] **Step 4: Commit**

```bash
git add src/components/BuildingSprite.jsx src/styles.css
git commit -m "feat: parameterised building facade sprite"
```

---

### Task 9: TownMap component

**Files:**
- Create: `src/components/TownMap.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `layoutTown` (Task 7), `BuildingSprite` (Task 8), `STATUS_COLORS` from `src/world.js`.
- Produces: `<TownMap buildings={[]} onOpen={(slug) => {}} onAddBuilding={() => {}} canAdd={bool} zoom={number} />`.

No unit test — visual; verified in the browser per the spec.

- [ ] **Step 1: Write the component**

Create `src/components/TownMap.jsx`:

```jsx
import { layoutTown, STATUS_COLORS } from '../world.js'
import BuildingSprite from './BuildingSprite.jsx'

// The world above the buildings. Everything here is derived from layoutTown —
// no stored coordinates, so adding a building just re-derives the scene.
export default function TownMap({ buildings, onOpen, onAddBuilding, canAdd, zoom = 1 }) {
  const L = layoutTown(buildings)

  return (
    <svg className="town" viewBox={`0 0 ${L.W} ${L.H}`} width={L.W * zoom} height={L.H * zoom} shapeRendering="crispEdges">
      <defs>
        <linearGradient id="town-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1a3a" />
          <stop offset="0.55" stopColor="#3a3466" />
          <stop offset="1" stopColor="#e8a668" />
        </linearGradient>
        <radialGradient id="town-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
        <filter id="town-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <rect width={L.W} height={L.H} fill="url(#town-sky)" />
      <g filter="url(#town-blur)">
        <circle cx={L.W * 0.82} cy={L.H * 0.12} r={120} fill="#ffd88a" opacity={0.22} />
        <circle cx={L.W * 0.82} cy={L.H * 0.12} r={24} fill="#fff6de" opacity={0.9} />
      </g>

      {/* grass */}
      <rect y={L.H * 0.18} width={L.W} height={L.H} fill="#3f7d4f" />

      {/* street */}
      <rect x={L.street.x} y={L.street.y} width={L.street.w} height={L.street.h} fill="#6b6152" />
      <rect x={L.street.x} y={L.street.y} width={L.street.w} height={5} fill="#847a68" />
      {Array.from({ length: Math.ceil(L.W / 60) }).map((_, i) => (
        <rect key={i} x={i * 60 + 18} y={L.street.y + L.street.h / 2 - 2} width={28} height={4} fill="#e9d36b" opacity={0.6} />
      ))}
      {L.street.lamps.map((lamp, i) => (
        <g key={i} transform={`translate(${lamp.x},${lamp.y - 46})`}>
          <rect x={-2} y={0} width={4} height={46} fill="#3a3f47" />
          <circle cx={0} cy={-2} r={7} fill="#ffe9b8" opacity={0.9} />
        </g>
      ))}

      {/* scenery */}
      <g shapeRendering="auto">
        {L.scenery.map((s, i) => (
          <Scenery key={i} {...s} />
        ))}
      </g>

      {/* buildings */}
      {L.lots.map((lot) => {
        const b = lot.building
        const needsAttention = (b.stats?.error || 0) > 0
        return (
          <g
            key={b.id}
            className="lot"
            transform={`translate(${lot.x},${lot.y})`}
            onClick={() => onOpen(b.slug)}
            shapeRendering="auto"
          >
            <title>{`${b.name}${b.kind === 'landmark' ? ' (landmark)' : ` — ${b.numberOfFloors} floors, ${b.numberOfAgents} agents`}`}</title>
            <BuildingSprite building={b} w={lot.w} h={lot.h} />
            {b.kind === 'workspace' && (
              <text x={lot.w / 2} y={lot.h + 18} textAnchor="middle" className="lot-sub">
                {b.numberOfFloors} floor{b.numberOfFloors === 1 ? '' : 's'} · {b.numberOfAgents} agent
                {b.numberOfAgents === 1 ? '' : 's'}
              </text>
            )}
            {needsAttention && <circle cx={lot.w - 16} cy={14} r={6} fill={STATUS_COLORS.error} className="lot-alert" />}
          </g>
        )
      })}

      {/* empty lot for adding */}
      {canAdd && (
        <g className="lot add-lot" transform={`translate(${TOWN_ADD_X(L)},${TOWN_ADD_Y(L)})`} onClick={onAddBuilding} shapeRendering="auto">
          <rect width={180} height={120} rx={10} fill="#ffffff10" stroke="#ffffff55" strokeWidth={2} strokeDasharray="8 6" />
          <text x={90} y={66} textAnchor="middle" className="lot-sub">＋ Add building</text>
        </g>
      )}

      <rect width={L.W} height={L.H} fill="url(#town-vignette)" pointerEvents="none" />
    </svg>
  )
}

const TOWN_ADD_X = (L) => L.W - 180 - 40
const TOWN_ADD_Y = (L) => L.H - 120 - 24

function Scenery({ type, x, y, variant }) {
  if (type === 'planter') {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect x={-8} y={0} width={16} height={10} rx={2} fill="#b5543a" />
        <circle cx={0} cy={-3} r={7} fill="#4fb862" />
      </g>
    )
  }
  if (type === 'bench') {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect x={-14} y={0} width={28} height={5} rx={2} fill="#9a6a3f" />
        <rect x={-12} y={5} width={4} height={7} fill="#6e4a2b" />
        <rect x={8} y={5} width={4} height={7} fill="#6e4a2b" />
      </g>
    )
  }
  if (type === 'fence') {
    return (
      <g transform={`translate(${x},${y})`}>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 9} y={-10} width={3} height={14} fill="#cbbba0" />
        ))}
        <rect x={0} y={-6} width={30} height={3} fill="#cbbba0" />
      </g>
    )
  }
  const scale = 1 + variant * 0.25
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <rect x={-2} y={0} width={4} height={10} fill="#6e4a2b" />
      <circle cx={0} cy={-6} r={10} fill="#2f7a3d" />
      <circle cx={-5} cy={-2} r={7} fill="#3e9a4f" />
      <circle cx={5} cy={-3} r={6} fill="#3e9a4f" />
    </g>
  )
}
```

- [ ] **Step 2: Add the map styles**

Append to `src/styles.css`:

```css
.town { display: block; filter: drop-shadow(0 6px 14px #0007); }
.lot { cursor: pointer; }
.lot:hover .bsprite { filter: brightness(1.08); }
.lot-sub { font-family: var(--body); font-size: 13px; fill: #efe6cf; paint-order: stroke; stroke: #0009; stroke-width: 3px; }
.lot-alert { animation: blink 1s steps(2) infinite; }
.add-lot:hover rect { stroke: var(--accent); }
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/TownMap.jsx src/styles.css
git commit -m "feat: town map scene"
```

---

### Task 10: Three-state navigation in App.jsx

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `TownMap` (Task 9); `buildings` from `/api/state` (Task 3).
- Produces: view state `'map' | { building: slug } | { office: slug }`, persisted to `localStorage['hq:view']`; `openBuilding(slug)`, `openOffice(slug)`, `goMap()`.

Verified in the browser per the spec.

- [ ] **Step 1: Replace the view state**

In `src/App.jsx`, replace the existing `view` state initialiser with one that migrates old stored values:

```jsx
  // Old worlds stored 'campus' or a bare office slug. Map them forward so a
  // returning session lands somewhere sensible instead of a blank view.
  const [view, setView] = useState(() => {
    const raw = localStorage.getItem('hq:view')
    if (!raw || raw === 'campus') return 'map'
    try {
      const parsed = JSON.parse(raw)
      if (parsed && (parsed.building || parsed.office)) return parsed
    } catch {
      return { office: raw }   // legacy: a bare office slug
    }
    return 'map'
  })
```

and the persistence effect:

```jsx
  useEffect(() => {
    try {
      localStorage.setItem('hq:view', typeof view === 'string' ? view : JSON.stringify(view))
    } catch {}
  }, [view])
```

- [ ] **Step 2: Derive the current building and office**

Add below the existing `offices`/`agents` memos:

```jsx
  const buildings = useMemo(
    () => (hub.buildings || []).filter((b) => (real ? !!b.sourceId : !b.sourceId)),
    [hub.buildings, real],
  )
  const office = view.office ? offices.find((o) => o.slug === view.office) : null
  const building = useMemo(() => {
    if (view.building) return buildings.find((b) => b.slug === view.building) || null
    if (office) return buildings.find((b) => b.id === office.buildingId) || null
    return null
  }, [view, buildings, office])
  const buildingOffices = useMemo(
    () => (building ? offices.filter((o) => o.buildingId === building.id) : []),
    [building, offices],
  )

  const goMap = () => { setSelectedId(null); setView('map') }
  const openBuilding = (slug) => setView({ building: slug })
  const openOffice = (slug) => setView({ office: slug })
```

- [ ] **Step 3: Render the three views**

In the `.viewport` block, replace the existing `office ? <OfficeFloor…/> : <Building…/>` branch with:

```jsx
          {view === 'map' ? (
            <TownMap
              buildings={buildings}
              onOpen={openBuilding}
              onAddBuilding={() => setModal({ type: 'building' })}
              canAdd={!!token}
              zoom={zoom}
            />
          ) : office ? (
            <OfficeFloor
              key={office.id}
              office={office}
              offices={offices}
              agents={officeAgents}
              connections={connections}
              messages={messages}
              selectedId={selectedId}
              onSelect={select}
              showLinks={showLinks}
              zoom={zoom * 1.6}
            />
          ) : (
            <Building
              building={building}
              offices={buildingOffices}
              agents={agents}
              messages={messages}
              onOpen={openOffice}
              onSelectAgent={(id) => select(id, true)}
              onAddFloor={() => setModal({ type: 'office', buildingSlug: building?.slug })}
              addLabel="＋ ADD FLOOR"
              title={building?.name || ''}
              zoom={zoom * 1.15}
            />
          )}
```

Add the import at the top: `import TownMap from './components/TownMap.jsx'`.

- [ ] **Step 4: Make the topbar contextual and rename the brand**

Replace the brand and `.tabs` nav with:

```jsx
        <div className="brand" onClick={goMap}>
          <span className="logo">▣</span> WORLD OF WONDERS
        </div>
        <nav className="tabs">
          <button className={view === 'map' ? 'on' : ''} onClick={goMap}>🗺 Map</button>
          {building && (
            <>
              <span className="crumb">›</span>
              <button className={view.building ? 'on' : ''} onClick={() => openBuilding(building.slug)}>
                {building.name}
              </button>
            </>
          )}
          {building &&
            buildingOffices.map((o, i) => (
              <button key={o.id} className={view.office === o.slug ? 'on' : ''} onClick={() => openOffice(o.slug)} style={{ '--tab': themeOf(o).wall }}>
                <i className="swatch" />
                <span className="floor-no">F{i + 1}</span>
                {o.name}
              </button>
            ))}
          {view === 'map' && token && (
            <button className="add" onClick={() => setModal({ type: 'building' })} title="Add a building">＋</button>
          )}
        </nav>
```

- [ ] **Step 5: Add the crumb style**

Append to `src/styles.css`:

```css
.crumb { color: var(--muted); align-self: center; padding: 0 2px; }
```

- [ ] **Step 6: Verify in the browser**

Run `npm run build` (expect success), then `npm run dev` and open `localhost:3000`.

Check, at 1400px wide:
1. The app lands on the **map**, not a building.
2. The brand reads **WORLD OF WONDERS**.
3. The workforce building appears with its floor/agent counts on the sign.
4. Clicking it opens that building's tower; the breadcrumb shows `Map › <name>` plus its floor tabs.
5. Clicking a floor tab opens the floor; people render as before.
6. Clicking the brand returns to the map.

Then resize to 400px wide and confirm the topbar scrolls horizontally rather than pushing the page wider, and the map pans inside `.viewport`.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "feat: map -> building -> floor navigation"
```

---

### Task 11: Scope Building.jsx to one building

**Files:**
- Modify: `src/components/Building.jsx`

**Interfaces:**
- Consumes: props from Task 10 — `building`, `offices` (already scoped), `title`.
- Produces: the same tower, rendering only the passed offices.

- [ ] **Step 1: Change the props**

In `src/components/Building.jsx`, change the component signature from `offices, agents, …` to accept `building` as well, and use the passed `offices` directly — it is already scoped by `App.jsx`, so the internal `layout(offices, agents)` call needs no change.

Replace the roof sign text so it names the building instead of the mode:

```jsx
        <text x={BX + 100} y={roofY + 54} textAnchor="middle" className="roof-sign">
          {title}
        </text>
```

(`title` is already a prop; Task 10 now passes `building.name`.)

- [ ] **Step 2: Handle the empty building**

Immediately inside the component body, before computing the layout, add:

```jsx
  if (!offices.length) {
    return (
      <div className="empty">
        <p>No floors in {building?.name || 'this building'} yet.</p>
        {addLabel && <button className="primary" onClick={onAddFloor}>{addLabel}</button>}
      </div>
    )
  }
```

- [ ] **Step 3: Verify in the browser**

Run `npm run build`, then `npm run dev`.

1. Open the workforce building — it shows exactly its own floors, no others.
2. Create an empty building (topbar `＋` on the map), open it, and confirm the "No floors yet" state with the add button appears instead of an empty tower.

- [ ] **Step 4: Commit**

```bash
git add src/components/Building.jsx
git commit -m "feat: the tower renders one building's floors"
```

---

### Task 12: Add-building modal and landmark cards

**Files:**
- Modify: `src/components/Modals.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `POST /api/buildings` (Task 4); `BUILDING_SPRITES` names.
- Produces: `<NewBuildingModal api onClose onCreated />`; landmark buildings open a card instead of a tower.

- [ ] **Step 1: Add the modal**

Append to `src/components/Modals.jsx`:

```jsx
const SPRITES = ['market', 'lab', 'studio', 'cafe', 'gym', 'library', 'post', 'tower']

export function NewBuildingModal({ api, onClose, onCreated }) {
  const [f, setF] = useState({ name: '', kind: 'workspace', sprite: 'tower', description: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  return (
    <Modal title="Add a building" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          api('POST', '/api/buildings', f)
            .then((b) => { onCreated?.(b); onClose() })
            .catch((x) => setErr(x.message))
        }}
      >
        <label>Name</label>
        <input value={f.name} onChange={set('name')} placeholder="Research Lab" autoFocus />

        <label>Kind</label>
        <select value={f.kind} onChange={set('kind')}>
          <option value="workspace">Workspace — holds floors and agents</option>
          <option value="landmark">Landmark — scenery only</option>
        </select>

        <label>Look</label>
        <select value={f.sprite} onChange={set('sprite')}>
          {SPRITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label>Description</label>
        <input value={f.description} onChange={set('description')} placeholder="What happens here?" />

        {err && <p className="error">{err}</p>}
        <button className="primary">Add building</button>
      </form>
    </Modal>
  )
}
```

Match the existing modal helper/import style already used by `NewOfficeModal` in this file — reuse its `Modal` wrapper and `useState` import rather than adding new ones.

- [ ] **Step 2: Mount it**

In `src/App.jsx`, add to the imports and render it beside the other modals:

```jsx
      {modal?.type === 'building' && (
        <NewBuildingModal api={api} onClose={() => setModal(null)} onCreated={(b) => openBuilding(b.slug)} />
      )}
```

- [ ] **Step 3: Landmarks open a card, not a tower**

In `App.jsx`, change `openBuilding` so landmarks never enter the tower view:

```jsx
  const openBuilding = (slug) => {
    const b = buildings.find((x) => x.slug === slug)
    if (b?.kind === 'landmark') return setModal({ type: 'landmark', building: b })
    setView({ building: slug })
  }
```

and render the card:

```jsx
      {modal?.type === 'landmark' && (
        <Modal title={modal.building.name} onClose={() => setModal(null)}>
          <div className="pad">
            <p className="muted">{modal.building.description || 'A landmark. Nothing runs here.'}</p>
          </div>
        </Modal>
      )}
```

Import `Modal` from `./components/Modals.jsx` — export it from that file if it is not already exported.

- [ ] **Step 4: Verify in the browser**

Run `npm run build`, then `npm run dev`:

1. On the map, click `＋` → add a **workspace** called "Research Lab" → it appears on the map and opens to the empty-tower state.
2. Add a **landmark** called "Cafe" with sprite `cafe` → it appears on the map; clicking it opens a name/description card, not a tower.
3. Reload — both survive.

- [ ] **Step 5: Commit**

```bash
git add src/components/Modals.jsx src/App.jsx
git commit -m "feat: add buildings from the map; landmarks open a card"
```

---

### Task 13: Full-journey verification

**Files:** none modified — this task is verification and fixes only.

- [ ] **Step 1: Run the whole logic suite**

Run: `npm test`
Expected: PASS — 21 tests, no skips.

- [ ] **Step 2: Production build**

Run: `rm -rf .next && npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Walk the journey in a browser at 1400px**

Run `npm run start -- -p 3002`, then check:

| # | Step | Expect |
|---|---|---|
| 1 | Open the app | lands on the map; brand reads WORLD OF WONDERS |
| 2 | Workforce building sign | correct floor and agent counts |
| 3 | A floor with an erroring agent | red alert pip on that building |
| 4 | Click the building | its tower, only its floors |
| 5 | Click a floor | desks and people render as before |
| 6 | Click an agent | side panel opens with the agent's details |
| 7 | Breadcrumb `Map` | back to the map |
| 8 | Toggle MOCK | the mock town appears (Head Office + Cafe), not the real one |
| 9 | Toggle REALTIME | back to the real town |
| 10 | Reload | returns to the last view |

- [ ] **Step 4: Re-check at 400px wide**

Confirm: the map pans inside its viewport without widening the page, the topbar tab strip scrolls horizontally, and the agent panel still opens as a bottom sheet.

- [ ] **Step 5: Confirm no console errors**

With DevTools open, repeat steps 1–7. Expected: no errors or React warnings.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: issues found in full-journey verification"
```

---

## Self-review notes

Checked against the spec:

- **Data model** → Tasks 1, 2 (entity, `buildingId`, hub-owned rule, `sourceId` link, migration, seed).
- **API surface** → Tasks 3, 4, 5 (`buildingView`, `/api/state`, CRUD, both invariants, `buildingSlug` on office routes).
- **Navigation** → Tasks 10, 11, 12 (three states, contextual topbar, breadcrumb, brand, stored-view migration, empty building, landmark card).
- **Map rendering** → Tasks 7, 8, 9 (`layoutTown`, `BuildingSprite`, scene, sign rollups, alert pip, existing sky/vignette language).
- **Migration** → Task 2, with idempotency pinned by a test in Task 1.
- **Edge cases** → source adopt/purge (Task 6), delete-with-floors 409 and landmark 400 (Tasks 4, 5), empty building (Task 11), no buildings (Task 9's add-lot), mock⇄real (Tasks 10, 13 step 3).
- **Testing** → `node:test` for logic (Tasks 1–7), browser verification for visuals (Tasks 10–13).
- **Out of scope** held: no auth, no URL routing, no drag placement, no follow-up art passes.
