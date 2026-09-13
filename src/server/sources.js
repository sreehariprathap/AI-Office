// Connected sources: pull-based adapters that mirror another system's agents into the hub.
//
// A source is any HTTP endpoint speaking the "agent-hq/v1" snapshot protocol:
//   { protocol, source: {id, name}, generatedAt,
//     offices: [{ slug, name, theme, floor, description, agents: [...], connections: [{from, to, kind, label}], stats }],
//     messages: [{ id, from, to, type, text, ts, data }] }
// There are no background timers (serverless): a request that finds a source older than its interval syncs it
// before answering. Every id is namespaced by source; synced records are marked `external` + `source`, so the source
// stays their owner and the hub never edits them.
import { randomUUID } from 'node:crypto'

const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']
const KINDS = ['reports_to', 'collab', 'data', 'bridge']
const THEMES = ['emerald', 'cobalt', 'crimson', 'amber', 'violet', 'teal', 'slate', 'rose']
const FAILS_BEFORE_OFFLINE = 3
const MAX_MESSAGES_PER_SYNC = 200
const SINCE_OVERLAP_MS = 2 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
export const ENV_SOURCE_ID = 'ai-workforce'

export const publicSource = ({ token, ...s }) => ({ ...s, hasToken: !!token })

const ns = (src, id) => `${src.id}:${id}`
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function fetchSnapshot(src) {
  const url = new URL(src.url)
  // Re-read a small overlap: a row committed late with an earlier timestamp would otherwise be skipped.
  // Message ids are deduped in apply(), so the overlap never double-posts.
  if (src.since) url.searchParams.set('since', new Date(Date.parse(src.since) - SINCE_OVERLAP_MS).toISOString())
  const headers = { accept: 'application/json' }
  if (src.token) headers['x-office-feed-token'] = src.token
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  const body = await r.json().catch(() => null)
  if (r.status === 401) {
    throw new Error(
      src.token
        ? '401 unauthorized: token rejected, or the source has not deployed its office feed yet'
        : '401 unauthorized: no feed token set for this source (WORKFORCE_TOKEN / Sources panel)',
    )
  }
  if (!r.ok) throw new Error(`${r.status} ${body?.detail || body?.error || r.statusText}`)
  if (!body || !Array.isArray(body.offices)) throw new Error('response is not an agent-hq/v1 snapshot')
  return body
}

function uniqueSlug(world, base) {
  let slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'office'
  while (world.offices.some((o) => o.slug === slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  return slug
}

export function applySnapshot(world, src, snap, now = Date.now()) {
  const seenOffices = new Set()
  const seenAgents = new Set()
  const seenLinks = new Set()

  for (const o of snap.offices) {
    if (!o?.slug) continue
    const id = ns(src, o.slug)
    seenOffices.add(id)
    const office = world.offices.find((x) => x.id === id)
    const next = {
      id,
      slug: office?.slug || uniqueSlug(world, o.slug),
      name: String(o.name || o.slug).slice(0, 40),
      theme: THEMES.includes(o.theme) ? o.theme : office?.theme || 'slate',
      floor: ['carpet', 'tile', 'checker', 'wood'].includes(o.floor) ? o.floor : 'carpet',
      description: o.description || '',
      apiKey: office?.apiKey || 'ofk_' + randomUUID().replace(/-/g, ''),
      createdAt: office?.createdAt || now,
      external: true,
      source: src.id,
      remoteSlug: o.slug,
      remoteStats: o.stats || null,
    }
    if (!office) world.offices.push(next)
    else if (!same(office, next)) Object.assign(office, next)

    for (const a of o.agents || []) {
      if (!a?.id) continue
      const aid = ns(src, a.id)
      seenAgents.add(aid)
      const existing = world.agents.find((x) => x.id === aid)
      const agent = {
        id: aid,
        officeId: id,
        name: String(a.name || a.id).slice(0, 60),
        shortName: a.shortName ? String(a.shortName).slice(0, 16) : undefined,
        role: a.role === 'boss' ? 'boss' : 'worker',
        title: a.title || '',
        status: STATUSES.includes(a.status) ? a.status : 'idle',
        task: a.task || '',
        model: a.model || '',
        host: a.host || '',
        skills: Array.isArray(a.skills) ? a.skills.slice(0, 12).map(String) : [],
        metrics: { tasksDone: 0, tokens: 0, costUsd: 0, ...(a.metrics || {}) },
        meta: a.meta || {},
        heartbeatTtlSec: 0,
        createdAt: existing?.createdAt || now,
        // lastSeen only moves when visible state changes, so "last seen" stays meaningful.
        lastSeen: existing && existing.status === a.status && existing.task === (a.task || '') ? existing.lastSeen : now,
        external: true,
        source: src.id,
      }
      if (agent.shortName === undefined) delete agent.shortName
      if (!existing) world.agents.push(agent)
      else if (!same(existing, agent)) {
        for (const k of Object.keys(existing)) if (!(k in agent)) delete existing[k]
        Object.assign(existing, agent)
      }
    }

    for (const c of o.connections || []) {
      if (!c?.from || !c?.to) continue
      const cid = ns(src, `${c.from}->${c.to}`)
      seenLinks.add(cid)
      const existing = world.connections.find((x) => x.id === cid)
      const link = {
        id: cid,
        from: ns(src, c.from),
        to: ns(src, c.to),
        kind: KINDS.includes(c.kind) ? c.kind : 'collab',
        label: String(c.label || '').slice(0, 60),
        createdAt: existing?.createdAt || now,
        external: true,
        source: src.id,
      }
      if (!existing) world.connections.push(link)
      else if (!same(existing, link)) Object.assign(existing, link)
    }
  }

  // Anything this source used to report but no longer does is gone (killed, retired, market removed).
  world.connections = world.connections.filter(
    (c) => c.source !== src.id || (seenLinks.has(c.id) && seenAgents.has(c.from) && seenAgents.has(c.to)),
  )
  world.agents = world.agents.filter((a) => a.source !== src.id || seenAgents.has(a.id))
  world.offices = world.offices.filter((o) => o.source !== src.id || seenOffices.has(o.id))
  const alive = new Set(world.agents.map((a) => a.id))
  world.connections = world.connections.filter((c) => alive.has(c.from) && alive.has(c.to))

  // Messages: append unseen ones in time order; `since` advances to the newest remote timestamp.
  const known = new Set(world.messages.filter((m) => m.source === src.id).map((m) => m.id))
  const incoming = (snap.messages || [])
    .filter((m) => m?.id && m.text)
    .map((m) => ({ ...m, _ts: Date.parse(m.ts) || now }))
    .sort((a, b) => a._ts - b._ts)
    .slice(-MAX_MESSAGES_PER_SYNC)
  let newest = src.since ? Date.parse(src.since) : 0
  for (const m of incoming) {
    const mid = ns(src, m.id)
    newest = Math.max(newest, m._ts)
    if (known.has(mid)) continue
    const from = ns(src, m.from)
    const to = m.to ? ns(src, m.to) : null
    world.messages.push({
      id: mid,
      from,
      to,
      officeId: world.agents.find((a) => a.id === from)?.officeId || world.agents.find((a) => a.id === to)?.officeId || null,
      type: m.type || 'message',
      text: String(m.text).slice(0, 4000),
      data: m.data,
      ts: m._ts,
      external: true,
      source: src.id,
    })
  }
  world.messages.sort((a, b) => a.ts - b.ts)

  Object.assign(src, {
    status: 'ok',
    lastError: null,
    failures: 0,
    lastSyncAt: now,
    since: newest ? new Date(newest).toISOString() : src.since,
    remoteName: snap.source?.name || src.remoteName || null,
    counts: { offices: seenOffices.size, agents: seenAgents.size, connections: seenLinks.size },
  })
}

export async function syncSource(world, src, now = Date.now()) {
  if (!src.enabled) return
  src.lastAttemptAt = now
  try {
    applySnapshot(world, src, await fetchSnapshot(src), now)
  } catch (err) {
    const failures = (src.failures || 0) + 1
    const lastError = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.message
    Object.assign(src, { status: 'error', lastError, failures })
    if (failures >= FAILS_BEFORE_OFFLINE) {
      // Unreachable source: keep its floor plan, but stop pretending its agents are alive.
      for (const a of world.agents) {
        if (a.source === src.id && a.status !== 'offline') {
          a.status = 'offline'
          a.task = `Source unreachable: ${lastError}`
        }
      }
    }
  }
}

/** Sync every enabled source whose interval has elapsed. Runs sources in parallel. */
export async function syncDueSources(world, now = Date.now(), { force = false } = {}) {
  const due = world.sources.filter((s) => s.enabled && (force || !s.lastAttemptAt || now - s.lastAttemptAt >= (s.intervalSec || 10) * 1000))
  await Promise.all(due.map((s) => syncSource(world, s, now)))
  return due.length
}

// Drop everything a source mirrored, so a different system never inherits the previous one's agents.
export function purgeSource(world, src) {
  const mine = (x) => x.source === src.id
  world.connections = world.connections.filter((c) => !mine(c))
  world.agents = world.agents.filter((a) => !mine(a))
  world.offices = world.offices.filter((o) => !mine(o))
  world.messages = world.messages.filter((m) => !mine(m))
  const alive = new Set(world.agents.map((a) => a.id))
  world.connections = world.connections.filter((c) => alive.has(c.from) && alive.has(c.to))
}

export function addSource(world, { name, url, token = '', intervalSec = 10, id }) {
  new URL(url) // throws on garbage
  if (id && world.sources.some((s) => s.id === id)) throw new Error(`source "${id}" already exists`)
  const src = {
    id: id || 'src-' + randomUUID().slice(0, 8),
    name: String(name || new URL(url).host).slice(0, 40),
    url,
    token,
    intervalSec: Math.max(3, Number(intervalSec) || 10),
    enabled: true,
    status: 'pending',
    lastError: null,
    lastSyncAt: null,
    lastAttemptAt: null,
    since: null,
    failures: 0,
    createdAt: Date.now(),
  }
  world.sources.push(src)
  return src
}

export function updateSource(world, src, patch) {
  if (patch.url) new URL(patch.url)
  const moved = patch.url !== undefined && patch.url !== src.url
  for (const k of ['name', 'url', 'token', 'enabled']) if (patch[k] !== undefined) src[k] = patch[k]
  if (patch.intervalSec !== undefined) src.intervalSec = Math.max(3, Number(patch.intervalSec) || 10)
  if (moved) {
    purgeSource(world, src)
    Object.assign(src, { status: 'pending', lastError: null, lastSyncAt: null, failures: 0, counts: null })
  }
  if (moved || patch.token !== undefined) Object.assign(src, { since: null, lastAttemptAt: null })
  return src
}

export function removeSource(world, src) {
  purgeSource(world, src)
  world.sources = world.sources.filter((s) => s.id !== src.id)
}

/** WORKFORCE_URL / WORKFORCE_TOKEN in the environment define (and keep in step) the AI Workforce source. */
export function ensureEnvSource(world) {
  const url = process.env.WORKFORCE_URL
  if (!url) return
  const token = process.env.WORKFORCE_TOKEN || ''
  const existing = world.sources.find((s) => s.id === ENV_SOURCE_ID)
  if (!existing) addSource(world, { id: ENV_SOURCE_ID, name: "Sreehari's AI Workforce", url, token })
  else if (existing.url !== url || (token && existing.token !== token)) updateSource(world, existing, { url, token: token || existing.token })
}
