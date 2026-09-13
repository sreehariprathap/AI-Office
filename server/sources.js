// Connected sources: pull-based adapters that mirror another system's agents into the hub.
//
// A source is any HTTP endpoint speaking the "agent-hq/v1" snapshot protocol:
//   { protocol, source: {id, name}, generatedAt,
//     offices: [{ slug, name, theme, floor, description, agents: [...], connections: [{from, to, kind, label}], stats }],
//     messages: [{ id, from, to, type, text, ts, data }] }
// The hub polls it, namespaces every id by source, and upserts offices/agents/connections/messages.
// Synced records are marked `external` + `source` — the source stays the owner, the hub never edits them.

import { randomUUID } from 'node:crypto'

const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']
const KINDS = ['reports_to', 'collab', 'data', 'bridge']
const THEMES = ['emerald', 'cobalt', 'crimson', 'amber', 'violet', 'teal', 'slate', 'rose']
const FAILS_BEFORE_OFFLINE = 3
const MAX_MESSAGES_PER_SYNC = 200

export const publicSource = ({ token, ...s }) => ({ ...s, hasToken: !!token })

export function createSources({ getState, emit, save }) {
  const timers = new Map()
  const inflight = new Set()

  const ns = (src, id) => `${src.id}:${id}`
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  function setStatus(src, patch) {
    Object.assign(src, patch)
    save()
    emit('source', publicSource(src))
  }

  async function fetchSnapshot(src) {
    const url = new URL(src.url)
    if (src.since) url.searchParams.set('since', src.since)
    const headers = { accept: 'application/json' }
    if (src.token) headers['x-office-feed-token'] = src.token
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 20000)
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(`${r.status} ${body?.detail || body?.error || r.statusText}`)
      if (!body || !Array.isArray(body.offices)) throw new Error('response is not an agent-hq/v1 snapshot')
      return body
    } finally {
      clearTimeout(timeout)
    }
  }

  function apply(src, snap) {
    const state = getState()
    const now = Date.now()
    const seenOffices = new Set()
    const seenAgents = new Set()
    const seenLinks = new Set()

    for (const o of snap.offices) {
      if (!o?.slug) continue
      const id = ns(src, o.slug)
      seenOffices.add(id)
      let office = state.offices.find((x) => x.id === id)
      const next = {
        id,
        slug: office?.slug || uniqueSlug(state, o.slug),
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
      if (!office) state.offices.push((office = next)), emit('office', next)
      else if (!same({ ...office }, next)) Object.assign(office, next), emit('office', office)

      for (const a of o.agents || []) {
        if (!a?.id) continue
        const aid = ns(src, a.id)
        seenAgents.add(aid)
        const existing = state.agents.find((x) => x.id === aid)
        const status = STATUSES.includes(a.status) ? a.status : 'idle'
        const agent = {
          id: aid,
          officeId: id,
          name: String(a.name || a.id).slice(0, 60),
          role: a.role === 'boss' ? 'boss' : 'worker',
          title: a.title || '',
          status,
          task: a.task || '',
          model: a.model || '',
          host: a.host || '',
          skills: Array.isArray(a.skills) ? a.skills.slice(0, 12).map(String) : [],
          metrics: { tasksDone: 0, tokens: 0, costUsd: 0, ...(a.metrics || {}) },
          meta: a.meta || {},
          heartbeatTtlSec: 0,
          createdAt: existing?.createdAt || now,
          // lastSeen only moves when the agent's visible state changes, so "last seen" stays meaningful.
          lastSeen: existing?.lastSeen || now,
          external: true,
          source: src.id,
        }
        if (!existing) state.agents.push(agent), emit('agent', agent)
        else {
          const { lastSeen, ...cmpA } = existing
          const { lastSeen: _, ...cmpB } = agent
          if (!same(cmpA, cmpB)) {
            agent.lastSeen = existing.status !== agent.status || existing.task !== agent.task ? now : existing.lastSeen
            Object.assign(existing, agent)
            emit('agent', existing)
          }
        }
      }

      for (const c of o.connections || []) {
        if (!c?.from || !c?.to) continue
        const cid = ns(src, `${c.from}->${c.to}`)
        seenLinks.add(cid)
        const link = {
          id: cid,
          from: ns(src, c.from),
          to: ns(src, c.to),
          kind: KINDS.includes(c.kind) ? c.kind : 'collab',
          label: String(c.label || '').slice(0, 60),
          createdAt: now,
          external: true,
          source: src.id,
        }
        const existing = state.connections.find((x) => x.id === cid)
        if (!existing) state.connections.push(link), emit('connection', link)
        else if (existing.kind !== link.kind || existing.label !== link.label || existing.from !== link.from || existing.to !== link.to) {
          Object.assign(existing, { ...link, createdAt: existing.createdAt })
          emit('connection', existing)
        }
      }
    }

    // Anything this source used to report but no longer does is gone (killed, retired, market removed).
    state.connections = state.connections.filter((c) => {
      const keep = c.source !== src.id || (seenLinks.has(c.id) && seenAgents.has(c.from) && seenAgents.has(c.to))
      if (!keep) emit('connection:delete', { id: c.id })
      return keep
    })
    state.agents = state.agents.filter((a) => {
      const keep = a.source !== src.id || seenAgents.has(a.id)
      if (!keep) emit('agent:delete', { id: a.id })
      return keep
    })
    state.offices = state.offices.filter((o) => {
      const keep = o.source !== src.id || seenOffices.has(o.id)
      if (!keep) emit('office:delete', { id: o.id })
      return keep
    })

    // Messages: append unseen ones in time order; `since` advances to the newest remote timestamp.
    const known = new Set(state.messages.filter((m) => m.source === src.id).map((m) => m.id))
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
      const msg = {
        id: mid,
        from,
        to,
        officeId: state.agents.find((a) => a.id === from)?.officeId || state.agents.find((a) => a.id === to)?.officeId || null,
        type: m.type || 'message',
        text: String(m.text).slice(0, 4000),
        data: m.data,
        ts: m._ts,
        external: true,
        source: src.id,
      }
      state.messages.push(msg)
      emit('message', msg)
    }
    if (state.messages.length > 2000) state.messages.splice(0, state.messages.length - 2000)
    const since = newest ? new Date(newest).toISOString() : src.since

    setStatus(src, {
      status: 'ok',
      lastError: null,
      failures: 0,
      lastSyncAt: now,
      since,
      remoteName: snap.source?.name || src.remoteName || null,
      counts: { offices: seenOffices.size, agents: seenAgents.size, connections: seenLinks.size },
    })
  }

  async function sync(src) {
    if (inflight.has(src.id) || !src.enabled) return
    inflight.add(src.id)
    try {
      apply(src, await fetchSnapshot(src))
    } catch (err) {
      const failures = (src.failures || 0) + 1
      setStatus(src, { status: 'error', lastError: err.name === 'AbortError' ? 'timed out' : err.message, failures })
      if (failures === FAILS_BEFORE_OFFLINE) {
        // Unreachable source: keep its floor plan, but stop pretending its agents are alive.
        for (const a of getState().agents) {
          if (a.source === src.id && a.status !== 'offline') {
            a.status = 'offline'
            a.task = `Source unreachable: ${src.lastError}`
            emit('agent', a)
          }
        }
        save()
      }
    } finally {
      inflight.delete(src.id)
    }
  }

  function schedule(src) {
    clearInterval(timers.get(src.id))
    timers.delete(src.id)
    if (!src.enabled) return
    const every = Math.max(3, Number(src.intervalSec) || 10) * 1000
    timers.set(src.id, setInterval(() => sync(src), every))
    sync(src)
  }

  function add({ name, url, token = '', intervalSec = 10, id }) {
    const state = getState()
    new URL(url) // throws on garbage
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
      since: null,
      failures: 0,
      createdAt: Date.now(),
    }
    state.sources.push(src)
    save()
    emit('source', publicSource(src))
    schedule(src)
    return src
  }

  function update(src, patch) {
    for (const k of ['name', 'url', 'token', 'intervalSec', 'enabled']) if (patch[k] !== undefined) src[k] = patch[k]
    if (patch.url) new URL(patch.url)
    if (patch.url || patch.token !== undefined) src.since = null
    save()
    emit('source', publicSource(src))
    schedule(src)
    return src
  }

  function remove(src) {
    const state = getState()
    clearInterval(timers.get(src.id))
    timers.delete(src.id)
    for (const c of state.connections.filter((c) => c.source === src.id)) emit('connection:delete', { id: c.id })
    for (const a of state.agents.filter((a) => a.source === src.id)) emit('agent:delete', { id: a.id })
    for (const o of state.offices.filter((o) => o.source === src.id)) emit('office:delete', { id: o.id })
    state.connections = state.connections.filter((c) => c.source !== src.id)
    state.agents = state.agents.filter((a) => a.source !== src.id)
    state.offices = state.offices.filter((o) => o.source !== src.id)
    state.messages = state.messages.filter((m) => m.source !== src.id)
    state.sources = state.sources.filter((s) => s.id !== src.id)
    save()
    emit('source:delete', { id: src.id })
  }

  function start() {
    const state = getState()
    state.sources ||= []
    // Env bootstrap, so a deployment can wire its first source without the UI.
    if (process.env.WORKFORCE_URL && !state.sources.some((s) => s.id === 'ai-workforce')) {
      add({ id: 'ai-workforce', name: "Sreehari's AI Workforce", url: process.env.WORKFORCE_URL, token: process.env.WORKFORCE_TOKEN || '' })
    } else if (process.env.WORKFORCE_URL) {
      const s = state.sources.find((x) => x.id === 'ai-workforce')
      if (s.url !== process.env.WORKFORCE_URL || (process.env.WORKFORCE_TOKEN && s.token !== process.env.WORKFORCE_TOKEN)) {
        update(s, { url: process.env.WORKFORCE_URL, token: process.env.WORKFORCE_TOKEN || s.token })
      }
    }
    state.sources.forEach(schedule)
  }

  return { start, add, update, remove, sync: (src) => sync(src) }
}

function uniqueSlug(state, base) {
  let slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'office'
  while (state.offices.some((o) => o.slug === slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  return slug
}
