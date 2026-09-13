// Agent HQ hub — zero-dependency Node server.
// REST for agents + UI, Server-Sent Events for live updates, JSON file persistence.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildSeed } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'hub.json')
const DIST_DIR = path.join(__dirname, '..', 'dist')
const MAX_MESSAGES = 2000
const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']
const KINDS = ['reports_to', 'collab', 'data', 'bridge']
const THEMES = ['emerald', 'cobalt', 'crimson', 'amber', 'violet', 'teal', 'slate', 'rose']

// ---------------------------------------------------------------- state
let state
function load() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    state = { ...buildSeed(), simulate: true }
  }
  state.hubToken ||= 'hub_' + randomUUID().replace(/-/g, '')
  state.simulate ??= true
  save()
}
let saveTimer
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2))
  }, 400)
}

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'office'
const officeBySlug = (slug) => state.offices.find((o) => o.slug === slug || o.id === slug)
const agentById = (id) => state.agents.find((a) => a.id === id)
const officeOf = (agent) => state.offices.find((o) => o.id === agent?.officeId)
const stripOffice = ({ apiKey, ...o }) => o

// ---------------------------------------------------------------- views
function agentView(a) {
  const o = officeOf(a)
  return { ...a, office: o ? { id: o.id, slug: o.slug, name: o.name } : null }
}

function connectionView(c) {
  const from = agentById(c.from)
  const to = agentById(c.to)
  const fo = officeOf(from)
  const tofc = officeOf(to)
  return {
    ...c,
    fromName: from?.name,
    toName: to?.name,
    fromOffice: fo?.slug,
    toOffice: tofc?.slug,
    crossOffice: !!fo && !!tofc && fo.id !== tofc.id,
  }
}

// The contract an office exposes: everything about the office in one payload.
function officeView(o, { withKey = false } = {}) {
  const agents = state.agents.filter((a) => a.officeId === o.id)
  const ids = new Set(agents.map((a) => a.id))
  const bosses = agents.filter((a) => a.role === 'boss')
  const workers = agents.filter((a) => a.role !== 'boss')
  const connections = state.connections.filter((c) => ids.has(c.from) || ids.has(c.to)).map(connectionView)
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
    connections,
    stats: {
      working: count('working'),
      idle: count('idle'),
      meeting: count('meeting'),
      error: count('error'),
      offline: count('offline'),
      tasksDone: agents.reduce((s, a) => s + (a.metrics?.tasksDone || 0), 0),
      tokens: agents.reduce((s, a) => s + (a.metrics?.tokens || 0), 0),
      costUsd: +agents.reduce((s, a) => s + (a.metrics?.costUsd || 0), 0).toFixed(2),
      messages24h: state.messages.filter((m) => m.ts > dayAgo && (ids.has(m.from) || ids.has(m.to))).length,
    },
  }
}

function snapshot(admin) {
  return {
    offices: state.offices.map((o) => (admin ? o : stripOffice(o))),
    agents: state.agents,
    connections: state.connections,
    messages: state.messages.slice(-200),
    simulate: state.simulate,
  }
}

// ---------------------------------------------------------------- SSE
const clients = new Set()
function emit(type, data) {
  for (const c of clients) {
    const payload = type.startsWith('office') && !c.admin && data?.apiKey ? stripOffice(data) : data
    c.res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
  }
}
setInterval(() => clients.forEach((c) => c.res.write(': ping\n\n')), 20000)

// ---------------------------------------------------------------- mutations
function upsertAgent(office, body, existing) {
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
  const pick = ['name', 'role', 'title', 'model', 'host', 'task', 'skills', 'heartbeatTtlSec', 'avatar']
  const next = { ...base }
  for (const k of pick) if (body[k] !== undefined) next[k] = body[k]
  if (body.status !== undefined && STATUSES.includes(body.status)) next.status = body.status
  if (body.metrics) next.metrics = { ...base.metrics, ...body.metrics }
  if (body.meta) next.meta = { ...base.meta, ...body.meta }
  next.role = next.role === 'boss' ? 'boss' : 'worker'
  next.officeId = office.id
  next.lastSeen = now
  if (!next.name) next.name = 'Agent-' + next.id.slice(0, 4)
  if (existing) Object.assign(existing, next)
  else state.agents.push(next)
  save()
  emit('agent', next)
  return next
}

function removeAgent(agent) {
  state.agents = state.agents.filter((a) => a.id !== agent.id)
  const dropped = state.connections.filter((c) => c.from === agent.id || c.to === agent.id)
  state.connections = state.connections.filter((c) => !dropped.includes(c))
  dropped.forEach((c) => emit('connection:delete', { id: c.id }))
  emit('agent:delete', { id: agent.id })
  save()
}

function addMessage({ from, to = null, text, type = 'message', data }) {
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
  state.messages.push(msg)
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES)
  if (fromAgent) fromAgent.lastSeen = msg.ts
  save()
  emit('message', msg)
  return msg
}

// Mark silent agents offline.
setInterval(() => {
  const now = Date.now()
  for (const a of state.agents) {
    if (a.heartbeatTtlSec > 0 && a.status !== 'offline' && now - a.lastSeen > a.heartbeatTtlSec * 1000) {
      a.status = 'offline'
      emit('agent', a)
      save()
    }
  }
}, 5000)

// ---------------------------------------------------------------- simulator
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
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)]
const fill = (s) => s.replace(/%/g, () => String(Math.floor(Math.random() * 900) + 100))

setInterval(() => {
  if (!state.simulate || !state.agents.length) return
  const roll = Math.random()
  if (roll < 0.5 && state.connections.length) {
    const c = rnd(state.connections)
    const reverse = Math.random() < 0.35
    const from = agentById(reverse ? c.to : c.from)
    const to = agentById(reverse ? c.from : c.to)
    if (!from || !to || from.status === 'offline' || to.status === 'offline') return
    const pool = reverse && c.kind === 'reports_to' ? LINES.down : LINES[c.kind] || LINES.collab
    addMessage({ from: from.id, to: to.id, text: fill(rnd(pool)), type: c.kind === 'data' ? 'handoff' : 'message' })
  } else if (roll < 0.72) {
    const a = rnd(state.agents)
    if (a.heartbeatTtlSec > 0) return // leave real agents alone
    const r = Math.random()
    a.status = r < 0.55 ? 'working' : r < 0.78 ? 'idle' : r < 0.9 ? 'meeting' : r < 0.95 ? 'error' : 'offline'
    if (a.status === 'error') a.task = rnd(['Tool call failed (429)', 'Timeout from upstream', 'Context overflow'])
    a.lastSeen = Date.now()
    emit('agent', a)
    save()
  } else {
    const a = rnd(state.agents.filter((x) => x.status === 'working' && x.heartbeatTtlSec === 0))
    if (!a) return
    a.task = fill(rnd(TASKS[a.role] || TASKS.worker))
    a.metrics.tasksDone += 1
    a.metrics.tokens += Math.floor(Math.random() * 40000)
    a.metrics.costUsd = +(a.metrics.costUsd + Math.random() * 0.4).toFixed(2)
    a.lastSeen = Date.now()
    emit('agent', a)
    save()
  }
}, 1600)

// ---------------------------------------------------------------- http helpers
function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const fail = (res, code, error) => send(res, code, { error })

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
  })
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
const isAdmin = (req, url) => (req.headers['x-hub-token'] || url.searchParams.get('token')) === state.hubToken
const canWrite = (req, url, office) => isAdmin(req, url) || (office && req.headers['x-office-key'] === office.apiKey)

// ---------------------------------------------------------------- routes
const routes = []
const route = (method, pattern, handler) => {
  const keys = []
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
  routes.push({ method, re, keys, handler })
}

route('GET', '/api/health', (ctx) => send(ctx.res, 200, { ok: true, offices: state.offices.length, agents: state.agents.length }))

// UI bootstrap: hands the admin token to local browsers only.
route('GET', '/api/session', ({ req, res }) => {
  if (!isLoopback(req)) return fail(res, 403, 'session token only available from localhost; set x-hub-token manually')
  send(res, 200, { hubToken: state.hubToken })
})

route('GET', '/api/events', ({ req, res, url }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.flushHeaders?.()
  const client = { res, admin: isAdmin(req, url) }
  clients.add(client)
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(client.admin))}\n\n`)
  req.on('close', () => clients.delete(client))
})

route('GET', '/api/hub', ({ res }) => {
  send(res, 200, {
    numberOfOffices: state.offices.length,
    numberOfAgents: state.agents.length,
    online: state.agents.filter((a) => a.status !== 'offline').length,
    offices: state.offices.map((o) => {
      const v = officeView(o)
      return { slug: v.slug, name: v.name, endpoint: v.endpoint, numberOfAgents: v.numberOfAgents, online: v.online, boss: v.boss?.name || null }
    }),
    bridges: state.connections.map(connectionView).filter((c) => c.crossOffice),
  })
})

route('GET', '/api/offices', ({ req, res, url }) => send(res, 200, state.offices.map((o) => officeView(o, { withKey: isAdmin(req, url) }))))

route('POST', '/api/offices', async ({ req, res, url, body }) => {
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  if (!body.name) return fail(res, 400, 'name required')
  let slug = slugify(body.slug || body.name)
  while (officeBySlug(slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  const office = {
    id: randomUUID(),
    slug,
    name: String(body.name).slice(0, 40),
    theme: THEMES.includes(body.theme) ? body.theme : rnd(THEMES),
    floor: ['carpet', 'tile', 'checker', 'wood'].includes(body.floor) ? body.floor : 'carpet',
    description: body.description || '',
    apiKey: 'ofk_' + randomUUID().replace(/-/g, ''),
    createdAt: Date.now(),
  }
  state.offices.push(office)
  save()
  emit('office', office)
  send(res, 201, officeView(office, { withKey: true }))
})

route('GET', '/api/offices/:slug', ({ req, res, url, params }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  send(res, 200, officeView(o, { withKey: canWrite(req, url, o) }))
})

route('PATCH', '/api/offices/:slug', ({ req, res, url, params, body }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  for (const k of ['name', 'description', 'floor']) if (body[k] !== undefined) o[k] = body[k]
  if (THEMES.includes(body.theme)) o.theme = body.theme
  save()
  emit('office', o)
  send(res, 200, officeView(o, { withKey: true }))
})

route('DELETE', '/api/offices/:slug', ({ req, res, url, params }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  state.agents.filter((a) => a.officeId === o.id).forEach(removeAgent)
  state.offices = state.offices.filter((x) => x.id !== o.id)
  save()
  emit('office:delete', { id: o.id })
  send(res, 200, { ok: true })
})

route('POST', '/api/offices/:slug/keys/rotate', ({ req, res, url, params }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  o.apiKey = 'ofk_' + randomUUID().replace(/-/g, '')
  save()
  emit('office', o)
  send(res, 200, { apiKey: o.apiKey })
})

route('GET', '/api/offices/:slug/agents', ({ res, params }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  send(res, 200, state.agents.filter((a) => a.officeId === o.id).map(agentView))
})

// Register (idempotent by name within an office) — this is what a remote agent calls on boot.
route('POST', '/api/offices/:slug/agents', ({ req, res, url, params, body }) => {
  const o = officeBySlug(params.slug)
  if (!o) return fail(res, 404, 'office not found')
  if (!canWrite(req, url, o)) return fail(res, 401, 'x-office-key required')
  const existing = body.name && state.agents.find((a) => a.officeId === o.id && a.name === body.name)
  const agent = upsertAgent(o, body, existing)
  send(res, existing ? 200 : 201, agentView(agent))
})

route('GET', '/api/agents/:id', ({ res, params }) => {
  const a = agentById(params.id)
  if (!a) return fail(res, 404, 'agent not found')
  const connections = state.connections.filter((c) => c.from === a.id || c.to === a.id).map(connectionView)
  const messages = state.messages.filter((m) => m.from === a.id || m.to === a.id).slice(-50)
  send(res, 200, { ...agentView(a), connections, messages })
})

const agentUpdate = ({ req, res, url, params, body }) => {
  const a = agentById(params.id)
  if (!a) return fail(res, 404, 'agent not found')
  const from = officeOf(a)
  if (!canWrite(req, url, from)) return fail(res, 401, 'x-office-key required')
  let target = from
  if (body.officeSlug && isAdmin(req, url)) target = officeBySlug(body.officeSlug) || from
  send(res, 200, agentView(upsertAgent(target, body, a)))
}
route('PATCH', '/api/agents/:id', agentUpdate)
route('POST', '/api/agents/:id/heartbeat', agentUpdate)

route('DELETE', '/api/agents/:id', ({ req, res, url, params }) => {
  const a = agentById(params.id)
  if (!a) return fail(res, 404, 'agent not found')
  if (!canWrite(req, url, officeOf(a))) return fail(res, 401, 'x-office-key required')
  removeAgent(a)
  send(res, 200, { ok: true })
})

// Inbox: an agent polls for messages addressed to it (e.g. instructions sent from the hub UI).
route('GET', '/api/agents/:id/inbox', ({ req, res, url, params }) => {
  const a = agentById(params.id)
  if (!a) return fail(res, 404, 'agent not found')
  if (!canWrite(req, url, officeOf(a))) return fail(res, 401, 'x-office-key required')
  const since = Number(url.searchParams.get('since') || 0)
  a.lastSeen = Date.now()
  send(res, 200, state.messages.filter((m) => m.to === a.id && m.ts > since))
})

route('GET', '/api/connections', ({ res }) => send(res, 200, state.connections.map(connectionView)))

route('POST', '/api/connections', ({ req, res, url, body }) => {
  const from = agentById(body.from)
  const to = agentById(body.to)
  if (!from || !to || from.id === to.id) return fail(res, 400, 'valid, distinct from/to agent ids required')
  if (!canWrite(req, url, officeOf(from))) return fail(res, 401, 'x-office-key of the source office required')
  const dup = state.connections.find((c) => c.from === from.id && c.to === to.id)
  if (dup) return send(res, 200, connectionView(dup))
  const crossOffice = from.officeId !== to.officeId
  const c = {
    id: randomUUID(),
    from: from.id,
    to: to.id,
    kind: crossOffice ? 'bridge' : KINDS.includes(body.kind) ? body.kind : 'collab',
    label: String(body.label || '').slice(0, 60),
    createdAt: Date.now(),
  }
  state.connections.push(c)
  save()
  emit('connection', c)
  send(res, 201, connectionView(c))
})

route('DELETE', '/api/connections/:id', ({ req, res, url, params }) => {
  const c = state.connections.find((x) => x.id === params.id)
  if (!c) return fail(res, 404, 'connection not found')
  if (!canWrite(req, url, officeOf(agentById(c.from)))) return fail(res, 401, 'x-office-key required')
  state.connections = state.connections.filter((x) => x.id !== c.id)
  save()
  emit('connection:delete', { id: c.id })
  send(res, 200, { ok: true })
})

route('GET', '/api/messages', ({ res, url }) => {
  const office = url.searchParams.get('office')
  const agent = url.searchParams.get('agent')
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)
  const o = office && officeBySlug(office)
  let list = state.messages
  if (o) list = list.filter((m) => m.officeId === o.id || agentById(m.to)?.officeId === o.id)
  if (agent) list = list.filter((m) => m.from === agent || m.to === agent)
  send(res, 200, list.slice(-limit))
})

// from: agent id, or "hub" (you, via the UI / admin token).
route('POST', '/api/messages', ({ req, res, url, body }) => {
  if (!body.text) return fail(res, 400, 'text required')
  if (body.from === 'hub' || !body.from) {
    if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required to send as hub')
    if (!agentById(body.to)) return fail(res, 400, 'to must be an agent id')
    return send(res, 201, addMessage({ ...body, from: 'hub' }))
  }
  const from = agentById(body.from)
  if (!from) return fail(res, 400, 'unknown sender')
  if (!canWrite(req, url, officeOf(from))) return fail(res, 401, 'x-office-key of the sender office required')
  send(res, 201, addMessage(body))
})

route('POST', '/api/simulate', ({ req, res, url, body }) => {
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  state.simulate = !!body.on
  save()
  emit('simulate', { on: state.simulate })
  send(res, 200, { on: state.simulate })
})

route('POST', '/api/reset', ({ req, res, url }) => {
  if (!isAdmin(req, url)) return fail(res, 401, 'x-hub-token required')
  Object.assign(state, buildSeed())
  save()
  for (const c of clients) c.res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(c.admin))}\n\n`)
  send(res, 200, { ok: true })
})

// ---------------------------------------------------------------- server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, x-office-key, x-hub-token')
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue
      const m = url.pathname.match(r.re)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      try {
        const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {}
        return await r.handler({ req, res, url, params, body })
      } catch (err) {
        return fail(res, 400, err.message)
      }
    }
    return fail(res, 404, 'no such route')
  }

  // Serve the built UI in production (npm run build && npm start).
  const file = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname)
  const safe = file.startsWith(DIST_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()
  const target = safe ? file : path.join(DIST_DIR, 'index.html')
  if (!fs.existsSync(target)) return fail(res, 404, 'UI not built — run `npm run dev` or `npm run build`')
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' })
  fs.createReadStream(target).pipe(res)
})

load()
server.listen(PORT, () => {
  console.log(`\n  ▣ Agent HQ hub  http://localhost:${PORT}`)
  console.log(`    offices: ${state.offices.map((o) => o.slug).join(', ')}`)
  console.log(`    try:     curl http://localhost:${PORT}/api/offices/finance\n`)
})
