// Tiny dependency-free client for Agent HQ. Works in Node 18+ and browsers.
//
//   const agent = await connectAgent({ hub, office, key, name: 'Ada', title: 'Analyst' })
//   agent.status('working', 'Reconciling March')
//   agent.send(otherAgentId, 'Handoff ready', 'handoff')
//   agent.onMessage((m) => ...)   // instructions sent from the hub UI or other agents
//   agent.close()

export async function connectAgent({ hub = 'http://localhost:8787', office, key, heartbeatMs = 20000, pollMs = 3000, ...profile }) {
  const headers = { 'content-type': 'application/json', 'x-office-key': key }
  const call = async (method, path, body) => {
    const r = await fetch(hub + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${method} ${path}: ${json.error || r.status}`)
    return json
  }

  const ttl = Math.ceil((heartbeatMs * 3) / 1000)
  const me = await call('POST', `/api/offices/${office}/agents`, { status: 'working', heartbeatTtlSec: ttl, ...profile })
  let state = { status: me.status, task: me.task }
  const listeners = new Set()
  let since = Date.now()

  const beat = setInterval(() => call('POST', `/api/agents/${me.id}/heartbeat`, state).catch(() => {}), heartbeatMs)
  const poll = setInterval(async () => {
    try {
      const inbox = await call('GET', `/api/agents/${me.id}/inbox?since=${since}`)
      for (const m of inbox) {
        since = Math.max(since, m.ts)
        listeners.forEach((fn) => fn(m))
      }
    } catch {}
  }, pollMs)

  return {
    id: me.id,
    profile: me,
    status: (status, task = state.task) => {
      state = { status, task }
      return call('POST', `/api/agents/${me.id}/heartbeat`, state)
    },
    metrics: (metrics) => call('POST', `/api/agents/${me.id}/heartbeat`, { ...state, metrics }),
    send: (to, text, type = 'message', data) => call('POST', '/api/messages', { from: me.id, to, text, type, data }),
    connect: (to, kind = 'collab', label = '') => call('POST', '/api/connections', { from: me.id, to, kind, label }),
    office: () => call('GET', `/api/offices/${office}`),
    onMessage: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    close: async () => {
      clearInterval(beat)
      clearInterval(poll)
      await call('POST', `/api/agents/${me.id}/heartbeat`, { status: 'offline' }).catch(() => {})
    },
  }
}
