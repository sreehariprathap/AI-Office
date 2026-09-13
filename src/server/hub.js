// Agent HQ hub — the API behind /api/*, written for serverless.
//
// Each request: load the world from the store → catch up on time-based work (offline sweep, mock simulator,
// due source syncs) → run the route → save if anything changed. No timers, no sockets, no in-memory state
// that has to survive between requests — so it runs the same under `next dev` and on Vercel.
import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { buildSeed } from './seed.js'
import {
  ensureBuildings, buildingSummary, createBuilding, buildingBySlug, floorsOf, canBecomeLandmark,
  BUILDING_KINDS, BUILDING_SPRITES, resolveBuilding,
} from './buildings.js'
import { withWorld, storageKind } from './store.js'
import {
  publicSource, syncSource, addSource, updateSource, removeSource, ensureEnvSource, fetchSnapshot, applySnapshot,
  recordSyncFailure, isDue,
} from './sources.js'
import { adminToken, isHttps, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './session.js'

const MAX_MESSAGES = 1000
const CLIENT_MESSAGES = 300
const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']
const KINDS = ['reports_to', 'collab', 'data', 'bridge']
const MODES = ['mock', 'real']
const THEMES = ['emerald', 'cobalt', 'crimson', 'amber', 'violet', 'teal', 'slate', 'rose']
const SIM_STEP_MS = 1600
const SIM_MAX_STEPS = 12

// Which records belong to a mode: real-time data is exactly what connected sources sync in.
const inMode = (rec, mode) => (mode === 'real' ? !!rec.external : !rec.external)
const emptyWorld = () => ({ offices: [], agents: [], connections: [], messages: [] })
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'office'
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)]
const stripOffice = ({ apiKey, ...o }) => o

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message)
}

// ---------------------------------------------------------------- world
export function initWorld(stored) {
  const world =
    stored ||
    (process.env.HUB_SEED === 'none' ? { ...emptyWorld(), simulate: false } : { ...buildSeed(), simulate: true })
  world.buildings ||= []
  world.offices ||= []
  world.agents ||= []
  world.connections ||= []
  world.messages ||= []
  world.sources ||= []
  world.hubToken ||= 'hub_' + randomUUID().replace(/-/g, '')
  world.simulate ??= true
  // mock = demo world + hand-made agents; real = only agents mirrored from connected sources.
  world.mode = MODES.includes(world.mode) ? world.mode : 'real'
  ensureEnvSource(world)
  ensureBuildings(world)   // adopts any office that predates buildings; no-op afterwards
  return world
}

// Queries against one world snapshot.
function q(world) {
  const officeBySlug = (slug) => world.offices.find((o) => o.slug === slug || o.id === slug)
  const agentById = (id) => world.agents.find((a) => a.id === id)
  const officeOf = (agent) => world.offices.find((o) => o.id === agent?.officeId)

  const agentView = (a) => {
    const o = officeOf(a)
    return { ...a, office: o ? { id: o.id, slug: o.slug, name: o.name } : null }
  }
  const connectionView = (c) => {
    const from = agentById(c.from)
    const to = agentById(c.to)
    const fo = officeOf(from)
    const tofc = officeOf(to)
    return { ...c, fromName: from?.name, toName: to?.name, fromOffice: fo?.slug, toOffice: tofc?.slug, crossOffice: !!fo && !!tofc && fo.id !== tofc.id }
  }
  // The contract an office exposes: everything about the office in one payload.
  const officeView = (o, { withKey = false } = {}) => {
    const agents = world.agents.filter((a) => a.officeId === o.id)
    const ids = new Set(agents.map((a) => a.id))
    const bosses = agents.filter((a) => a.role === 'boss')
    const workers = agents.filter((a) => a.role !== 'boss')
    const dayAgo = Date.now() - 864e5
    const count = (s) => agents.filter((a) => a.status === s).length
    return {
      ...(withKey ? o : stripOffice(o)),
      officeName: o.name,
      endpoint: `/api/offices/${o.slug}`,
      numberOfAgents: agents.length,
      online: agents.length - count('offline'),
      boss: bosses[0] ? agentView(bosses[0]) : null,
      bosses: bosses.map(agentView),
      workers: workers.map(agentView),
      agents: agents.map(agentView),
      connections: world.connections.filter((c) => ids.has(c.from) || ids.has(c.to)).map(connectionView),
      stats: {
        working: count('working'),
        idle: count('idle'),
        meeting: count('meeting'),
        error: count('error'),
        offline: count('offline'),
        tasksDone: agents.reduce((s, a) => s + (a.metrics?.tasksDone || 0), 0),
        tokens: agents.reduce((s, a) => s + (a.metrics?.tokens || 0), 0),
        costUsd: +agents.reduce((s, a) => s + (a.metrics?.costUsd || 0), 0).toFixed(2),
        messages24h: world.messages.filter((m) => m.ts > dayAgo && (ids.has(m.from) || ids.has(m.to))).length,
      },
    }
  }
  const buildingView = (b) => buildingSummary(world, b)
  return { officeBySlug, agentById, officeOf, agentView, connectionView, officeView, buildingView }
}

// ---------------------------------------------------------------- mutations
function upsertAgent(world, office, body, existing) {
  const now = Date.now()
  const base = existing || {
    id: randomUUID(),
    role: 'worker',
    status: 'working',
    model: '',
    host: '',
    title: '',
    task: '',
    skills: [],
    metrics: { tasksDone: 0, tokens: 0, costUsd: 0, uptimeSec: 0 },
    heartbeatTtlSec: 90,
    createdAt: now,
    meta: {},
  }
  const next = { ...base }
  for (const k of ['name', 'role', 'title', 'model', 'host', 'task', 'skills', 'heartbeatTtlSec', 'avatar']) if (body[k] !== undefined) next[k] = body[k]
  if (body.status !== undefined && STATUSES.includes(body.status)) next.status = body.status
  if (body.metrics) next.metrics = { ...base.metrics, ...body.metrics }
  if (body.meta) next.meta = { ...base.meta, ...body.meta }
  next.role = next.role === 'boss' ? 'boss' : 'worker'
  next.officeId = office.id
  next.lastSeen = now
  if (!next.name) next.name = 'Agent-' + next.id.slice(0, 4)
  if (existing) Object.assign(existing, next)
  else world.agents.push(next)
  return next
}

function removeAgent(world, agent) {
  world.agents = world.agents.filter((a) => a.id !== agent.id)
  world.connections = world.connections.filter((c) => c.from !== agent.id && c.to !== agent.id)
}

function addMessage(world, { from, to = null, text, type = 'message', data }) {
  const { agentById } = q(world)
  const fromAgent = agentById(from)
  const toAgent = to && to !== 'hub' ? agentById(to) : null
  const msg = {
    id: randomUUID(),
    from,
    to,
    officeId: fromAgent?.officeId || toAgent?.officeId || null,
    type,
    text: String(text ?? '').slice(0, 4000),
    data,
    ts: Date.now(),
  }
  world.messages.push(msg)
  if (fromAgent) fromAgent.lastSeen = msg.ts
  return msg
}

// ---------------------------------------------------------------- time-based catch-up
function sweepOffline(world, now) {
  for (const a of world.agents) {
    if (a.heartbeatTtlSec > 0 && a.status !== 'offline' && now - a.lastSeen > a.heartbeatTtlSec * 1000) a.status = 'offline'
  }
}

const TASKS = {
  worker: ['Parsing batch #%', 'Writing summary for #%', 'Refactoring module %', 'Crunching dataset %', 'Drafting reply to ticket %', 'Calling tool: search (%)', 'Waiting on rate limit', 'Validating output %', 'Embedding %k docs'],
  boss: ['Reviewing plan v%', 'Delegating sprint %', 'Approving request #%', 'Weekly sync with team', 'Escalation #% triage'],
}
const LINES = {
  reports_to: ['Done with #%. Output attached.', 'Blocked on credentials, need approval.', 'Status: most of batch % done.', 'Can I get priority on #%?'],
  collab: ['Pushed changes to branch fix-%.', 'Can you re-run checks on #%?', 'Looks good, merging.', 'Pairing on issue %?'],
  data: ['Handoff: % records ready.', 'Feed updated (% rows).', 'Schema changed, heads up.', 'Delta sync complete.'],
  bridge: ['Cross-office request #% filed.', 'Need numbers for deal %.', 'API contract v% shared.', 'Escalating to your office.'],
  down: ['Go ahead with #%.', 'Approved.', 'Reprioritize: % first.', 'Nice work — ship it.'],
}
const fill = (s) => s.replace(/%/g, () => String(Math.floor(Math.random() * 900) + 100))

function simulateStep(world) {
  const { agentById } = q(world)
  const roll = Math.random()
  if (roll < 0.5) {
    const internal = world.connections.filter((x) => !x.external)
    if (!internal.length) return
    const c = rnd(internal)
    const reverse = Math.random() < 0.35
    const from = agentById(reverse ? c.to : c.from)
    const to = agentById(reverse ? c.from : c.to)
    if (!from || !to || from.status === 'offline' || to.status === 'offline') return
    const pool = reverse && c.kind === 'reports_to' ? LINES.down : LINES[c.kind] || LINES.collab
    addMessage(world, { from: from.id, to: to.id, text: fill(rnd(pool)), type: c.kind === 'data' ? 'handoff' : 'message' })
  } else if (roll < 0.72) {
    const a = rnd(world.agents)
    if (!a || a.heartbeatTtlSec > 0 || a.external) return // leave real agents alone
    const r = Math.random()
    a.status = r < 0.55 ? 'working' : r < 0.78 ? 'idle' : r < 0.9 ? 'meeting' : r < 0.95 ? 'error' : 'offline'
    if (a.status === 'error') a.task = rnd(['Tool call failed (429)', 'Timeout from upstream', 'Context overflow'])
    a.lastSeen = Date.now()
  } else {
    const a = rnd(world.agents.filter((x) => x.status === 'working' && x.heartbeatTtlSec === 0 && !x.external))
    if (!a) return
    a.task = fill(rnd(TASKS[a.role] || TASKS.worker))
    a.metrics.tasksDone += 1
    a.metrics.tokens += Math.floor(Math.random() * 40000)
    a.metrics.costUsd = +(a.metrics.costUsd + Math.random() * 0.4).toFixed(2)
    a.lastSeen = Date.now()
  }
}

// The simulator "ran" while nobody was asking: replay the steps owed since the last request, capped.
function simulateCatchUp(world, now) {
  // Paused/real mode: leave lastSimAt alone (touching it would make every poll a write).
  // Turning the simulator or mock mode back on resets it, so no backlog replays.
  if (world.mode !== 'mock' || !world.simulate || !world.agents.length) return
  if (!world.lastSimAt) {
    world.lastSimAt = now
    return
  }
  const owed = Math.floor((now - world.lastSimAt) / SIM_STEP_MS)
  if (owed <= 0) return
  for (let i = 0; i < Math.min(owed, SIM_MAX_STEPS); i++) simulateStep(world)
  world.lastSimAt = now
}

async function catchUp(world) {
  const now = Date.now()
  sweepOffline(world, now)
  simulateCatchUp(world, now)
  if (world.messages.length > MAX_MESSAGES) world.messages.splice(0, world.messages.length - MAX_MESSAGES)
}

// Remote feeds can take seconds, so they never run inside a request's world transaction:
// read which sources are due → fetch them with no lock held → apply the results in a short second transaction.
// Scheduled with next/server's after(), i.e. once the response is already on its way (waitUntil on Vercel).
const syncing = (globalThis.__agentHqSyncing ||= new Set())
async function syncDueInBackground() {
  const now = Date.now()
  const { result: due } = await withWorld(initWorld, (world) =>
    world.sources.filter((s) => isDue(s, now) && !syncing.has(s.id)).map((s) => ({ ...s })),
  )
  if (!due.length) return
  due.forEach((s) => syncing.add(s.id))
  try {
    const results = await Promise.all(
      due.map((s) => fetchSnapshot(s).then((snap) => ({ s, snap }), (error) => ({ s, error }))),
    )
    await withWorld(initWorld, (world) => {
      for (const { s, snap, error } of results) {
        const src = world.sources.find((x) => x.id === s.id)
        if (!src || src.url !== s.url || src.token !== s.token) continue // edited meanwhile — result is stale
        if (error) recordSyncFailure(world, src, error, now)
        else {
          src.lastAttemptAt = now
          applySnapshot(world, src, snap, now)
        }
      }
    })
  } finally {
    due.forEach((s) => syncing.delete(s.id))
  }
}

// ---------------------------------------------------------------- routing
const routes = []
const route = (method, pattern, handler) => {
  const keys = []
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
  routes.push({ method, re, keys, handler })
}

// The UI's single poll: everything it draws, in one payload. `v` short-circuits when nothing changed.
// (`?v=` short-circuiting happens in handle(), once the saved version is known.)
route('GET', '/api/state', ({ world, admin }) => {
  return {
    storage: storageKind,
    admin,
    buildings: world.buildings.map((b) => q(world).buildingView(b)),
    offices: world.offices.map((o) => (admin ? o : stripOffice(o))),
    agents: world.agents,
    connections: world.connections,
    messages: world.messages.slice(-CLIENT_MESSAGES),
    simulate: world.simulate,
    mode: world.mode,
    sources: world.sources.map(publicSource),
  }
})

route('GET', '/api/health', ({ world }) => ({ ok: true, storage: storageKind, offices: world.offices.length, agents: world.agents.length }))

route('POST', '/api/login', ({ world, req, body }) => {
  const token = adminToken(world)
  if (!body.token || body.token !== token) fail(401, 'invalid token')
  return [200, { ok: true }, { name: SESSION_COOKIE, value: token, maxAge: SESSION_MAX_AGE_SEC, secure: isHttps(req) }]
})

route('POST', '/api/logout', ({ req }) => [
  200,
  { ok: true },
  { name: SESSION_COOKIE, value: '', maxAge: 0, secure: isHttps(req) },
])

route('GET', '/api/hub', ({ world, url }) => {
  const { officeView, connectionView } = q(world)
  const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : world.mode
  const offices = world.offices.filter((o) => inMode(o, mode))
  const agents = world.agents.filter((a) => inMode(a, mode))
  return {
    mode,
    numberOfOffices: offices.length,
    numberOfAgents: agents.length,
    online: agents.filter((a) => a.status !== 'offline').length,
    offices: offices.map((o) => {
      const v = officeView(o)
      return { slug: v.slug, name: v.name, endpoint: v.endpoint, numberOfAgents: v.numberOfAgents, online: v.online, boss: v.boss?.name || null }
    }),
    bridges: world.connections.filter((c) => inMode(c, mode)).map(connectionView).filter((c) => c.crossOffice),
  }
})

route('GET', '/api/mode', ({ world }) => ({ mode: world.mode }))

route('POST', '/api/mode', ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  if (!MODES.includes(body.mode)) fail(400, `mode must be one of ${MODES.join(', ')}`)
  world.mode = body.mode
  world.lastSimAt = Date.now()
  return { mode: world.mode }
})

route('GET', '/api/offices', ({ world, admin, url }) => {
  const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : world.mode
  return world.offices.filter((o) => inMode(o, mode)).map((o) => q(world).officeView(o, { withKey: admin }))
})

route('POST', '/api/offices', ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  if (!body.name) fail(400, 'name required')
  const target = resolveBuilding(world, body.buildingSlug)
  if (target.error) fail(400, target.error)
  const { officeBySlug, officeView } = q(world)
  let slug = slugify(body.slug || body.name)
  while (officeBySlug(slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  const office = {
    id: randomUUID(),
    slug,
    buildingId: target.building.id,
    name: String(body.name).slice(0, 40),
    theme: THEMES.includes(body.theme) ? body.theme : rnd(THEMES),
    floor: ['carpet', 'tile', 'checker', 'wood'].includes(body.floor) ? body.floor : 'carpet',
    description: body.description || '',
    apiKey: 'ofk_' + randomUUID().replace(/-/g, ''),
    createdAt: Date.now(),
  }
  world.offices.push(office)
  return [201, officeView(office, { withKey: true })]
})

const officeOr404 = (world, slug) => q(world).officeBySlug(slug) || fail(404, 'office not found')
const agentOr404 = (world, id) => q(world).agentById(id) || fail(404, 'agent not found')
// Records mirrored from a connected source are owned by that source — hub edits would be overwritten anyway.
const notManaged = (rec) => rec?.external && fail(409, `managed by source "${rec.source}" — change it there`)

route('GET', '/api/offices/:slug', ({ world, can, params }) => {
  const o = officeOr404(world, params.slug)
  return q(world).officeView(o, { withKey: can(o) })
})

route('PATCH', '/api/offices/:slug', ({ world, admin, params, body }) => {
  const o = officeOr404(world, params.slug)
  if (!admin) fail(401, 'x-hub-token required')
  notManaged(o)
  if (body.buildingSlug !== undefined) {
    const moved = resolveBuilding(world, body.buildingSlug)
    if (moved.error) fail(400, moved.error)
    o.buildingId = moved.building.id
  }
  for (const k of ['name', 'description', 'floor']) if (body[k] !== undefined) o[k] = body[k]
  if (THEMES.includes(body.theme)) o.theme = body.theme
  return q(world).officeView(o, { withKey: true })
})

route('DELETE', '/api/offices/:slug', ({ world, admin, params }) => {
  const o = officeOr404(world, params.slug)
  if (!admin) fail(401, 'x-hub-token required')
  notManaged(o)
  world.agents.filter((a) => a.officeId === o.id).forEach((a) => removeAgent(world, a))
  world.offices = world.offices.filter((x) => x.id !== o.id)
  return { ok: true }
})

route('POST', '/api/offices/:slug/keys/rotate', ({ world, admin, params }) => {
  const o = officeOr404(world, params.slug)
  if (!admin) fail(401, 'x-hub-token required')
  o.apiKey = 'ofk_' + randomUUID().replace(/-/g, '')
  return { apiKey: o.apiKey }
})

route('GET', '/api/offices/:slug/agents', ({ world, params }) => {
  const o = officeOr404(world, params.slug)
  return world.agents.filter((a) => a.officeId === o.id).map(q(world).agentView)
})

// Register (idempotent by name within an office) — this is what a remote agent calls on boot.
route('POST', '/api/offices/:slug/agents', ({ world, can, params, body }) => {
  const o = officeOr404(world, params.slug)
  if (!can(o)) fail(401, 'x-office-key required')
  notManaged(o)
  const existing = body.name && world.agents.find((a) => a.officeId === o.id && a.name === body.name)
  const agent = upsertAgent(world, o, body, existing)
  return [existing ? 200 : 201, q(world).agentView(agent)]
})

// ---------------------------------------------------------------- buildings
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

route('GET', '/api/agents/:id', ({ world, params }) => {
  const a = agentOr404(world, params.id)
  const { agentView, connectionView } = q(world)
  const connections = world.connections.filter((c) => c.from === a.id || c.to === a.id).map(connectionView)
  const messages = world.messages.filter((m) => m.from === a.id || m.to === a.id).slice(-50)
  return { ...agentView(a), connections, messages }
})

const agentUpdate = ({ world, admin, can, params, body }) => {
  const a = agentOr404(world, params.id)
  const { officeOf, officeBySlug, agentView } = q(world)
  const from = officeOf(a)
  if (!can(from)) fail(401, 'x-office-key required')
  notManaged(a)
  const target = body.officeSlug && admin ? officeBySlug(body.officeSlug) || from : from
  return agentView(upsertAgent(world, target, body, a))
}
route('PATCH', '/api/agents/:id', agentUpdate)
route('POST', '/api/agents/:id/heartbeat', agentUpdate)

route('DELETE', '/api/agents/:id', ({ world, can, params }) => {
  const a = agentOr404(world, params.id)
  if (!can(q(world).officeOf(a))) fail(401, 'x-office-key required')
  notManaged(a)
  removeAgent(world, a)
  return { ok: true }
})

// Inbox: an agent polls for messages addressed to it (e.g. instructions sent from the hub UI).
route('GET', '/api/agents/:id/inbox', ({ world, can, params, url }) => {
  const a = agentOr404(world, params.id)
  if (!can(q(world).officeOf(a))) fail(401, 'x-office-key required')
  const since = Number(url.searchParams.get('since') || 0)
  a.lastSeen = Date.now()
  return world.messages.filter((m) => m.to === a.id && m.ts > since)
})

route('GET', '/api/connections', ({ world }) => world.connections.map(q(world).connectionView))

route('POST', '/api/connections', ({ world, can, body }) => {
  const { agentById, officeOf, connectionView } = q(world)
  const from = agentById(body.from)
  const to = agentById(body.to)
  if (!from || !to || from.id === to.id) fail(400, 'valid, distinct from/to agent ids required')
  if (!!from.external !== !!to.external) fail(400, 'cannot link a mock agent to a real-time agent')
  if (!can(officeOf(from))) fail(401, 'x-office-key of the source office required')
  const dup = world.connections.find((c) => c.from === from.id && c.to === to.id)
  if (dup) return connectionView(dup)
  const c = {
    id: randomUUID(),
    from: from.id,
    to: to.id,
    kind: from.officeId !== to.officeId ? 'bridge' : KINDS.includes(body.kind) ? body.kind : 'collab',
    label: String(body.label || '').slice(0, 60),
    createdAt: Date.now(),
  }
  world.connections.push(c)
  return [201, connectionView(c)]
})

route('DELETE', '/api/connections/:id', ({ world, can, params }) => {
  const c = world.connections.find((x) => x.id === params.id) || fail(404, 'connection not found')
  notManaged(c)
  const { officeOf, agentById } = q(world)
  if (!can(officeOf(agentById(c.from)))) fail(401, 'x-office-key required')
  world.connections = world.connections.filter((x) => x.id !== c.id)
  return { ok: true }
})

route('GET', '/api/messages', ({ world, url }) => {
  const { officeBySlug, agentById } = q(world)
  const office = url.searchParams.get('office')
  const agent = url.searchParams.get('agent')
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)
  const o = office && officeBySlug(office)
  let list = world.messages
  if (o) list = list.filter((m) => m.officeId === o.id || agentById(m.to)?.officeId === o.id)
  if (agent) list = list.filter((m) => m.from === agent || m.to === agent)
  return list.slice(-limit)
})

// from: agent id, or "hub" (you, via the UI / admin token).
route('POST', '/api/messages', ({ world, admin, can, body }) => {
  if (!body.text) fail(400, 'text required')
  const { agentById, officeOf } = q(world)
  if (body.from === 'hub' || !body.from) {
    if (!admin) fail(401, 'x-hub-token required to send as hub')
    if (!agentById(body.to)) fail(400, 'to must be an agent id')
    return [201, addMessage(world, { ...body, from: 'hub' })]
  }
  const from = agentById(body.from) || fail(400, 'unknown sender')
  if (!can(officeOf(from))) fail(401, 'x-office-key of the sender office required')
  return [201, addMessage(world, body)]
})

route('POST', '/api/simulate', ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  world.simulate = !!body.on
  world.lastSimAt = Date.now()
  return { on: world.simulate }
})

route('POST', '/api/reset', ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  const keep = (list) => list.filter((x) => x.external)
  const fresh = body?.mode === 'empty' ? emptyWorld() : buildSeed()
  Object.assign(world, {
    offices: [...fresh.offices, ...keep(world.offices)],
    agents: [...fresh.agents, ...keep(world.agents)],
    connections: [...fresh.connections, ...keep(world.connections)],
    messages: [...fresh.messages, ...keep(world.messages)],
  })
  if (body?.mode === 'empty') world.simulate = false
  return { ok: true }
})

// ---------------------------------------------------------------- connected sources
const sourceOr404 = (world, id) => world.sources.find((s) => s.id === id) || fail(404, 'source not found')

route('GET', '/api/sources', ({ world, admin }) => {
  if (!admin) fail(401, 'x-hub-token required')
  return world.sources.map(publicSource)
})

route('POST', '/api/sources', async ({ world, admin, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  if (!body.url) fail(400, 'url required')
  const src = addSource(world, body)
  await syncSource(world, src)
  return [201, publicSource(src)]
})

route('PATCH', '/api/sources/:id', async ({ world, admin, params, body }) => {
  if (!admin) fail(401, 'x-hub-token required')
  const src = updateSource(world, sourceOr404(world, params.id), body)
  if (src.enabled) await syncSource(world, src)
  return publicSource(src)
})

route('POST', '/api/sources/:id/sync', async ({ world, admin, params }) => {
  if (!admin) fail(401, 'x-hub-token required')
  const src = sourceOr404(world, params.id)
  await syncSource(world, src)
  return publicSource(src)
})

route('DELETE', '/api/sources/:id', ({ world, admin, params }) => {
  if (!admin) fail(401, 'x-hub-token required')
  removeSource(world, sourceOr404(world, params.id))
  return { ok: true }
})

// ---------------------------------------------------------------- entry point
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-office-key, x-hub-token',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}
// `cookie`, when given, is `{ name, value, maxAge, secure }` -- the shape
// /api/login and /api/logout return. NextResponse (not the plain Response
// used before) is what exposes `.cookies.set(...)`.
const json = (status, body, cookie) => {
  const res = NextResponse.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } })
  if (cookie) res.cookies.set(cookie.name, cookie.value, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: cookie.maxAge, secure: cookie.secure })
  return res
}

export async function handle(req, segments) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)
  const pathname = '/api/' + (segments || []).map(encodeURIComponent).join('/')

  let match
  for (const r of routes) {
    if (r.method !== req.method) continue
    const m = pathname.match(r.re)
    if (m) {
      match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
      break
    }
  }
  if (!match) return json(404, { error: 'no such route' })

  let body = {}
  if (['POST', 'PATCH'].includes(req.method)) {
    const raw = await req.text()
    if (raw.length > 1e6) return json(413, { error: 'body too large' })
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return json(400, { error: 'invalid JSON' })
    }
  }

  try {
    // The UI poll and hub views keep remote sources fresh — after responding, so they never wait on a feed.
    const syncSources = req.method === 'GET' && ['/api/state', '/api/hub', '/api/offices'].some((p) => pathname === p || pathname.startsWith('/api/offices/'))
    if (syncSources) after(() => syncDueInBackground().catch((err) => console.error('[agent-hq] source sync', err)))
    const { result, version } = await withWorld(initWorld, async (world) => {
      await catchUp(world)
      const token = req.headers.get('x-hub-token') || url.searchParams.get('token') || req.cookies.get(SESSION_COOKIE)?.value
      const admin = !!token && token === adminToken(world)
      const officeKey = req.headers.get('x-office-key')
      const can = (office) => admin || (!!office && !!officeKey && officeKey === office.apiKey)
      return match.r.handler({ world, admin, can, req, url, params: match.params, body })
    })
    if (pathname === '/api/state') {
      const known = Number(url.searchParams.get('v'))
      return json(200, known && known === version ? { version, unchanged: true } : { ...result, version })
    }
    const [status, payload, cookie] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result]
    return json(status, payload, cookie)
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message })
    console.error('[agent-hq]', req.method, pathname, err)
    return json(500, { error: err.message || 'internal error' })
  }
}
