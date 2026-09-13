import { useEffect, useReducer, useRef, useCallback } from 'react'

const initial = { offices: [], agents: [], connections: [], messages: [], simulate: false, connected: false, token: null }

const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = { ...list[i], ...item }
  return next
}

function reducer(s, { type, data }) {
  switch (type) {
    case 'token':
      return { ...s, token: data }
    case 'connected':
      return { ...s, connected: data }
    case 'snapshot':
      return { ...s, ...data, connected: true }
    case 'office':
      return { ...s, offices: upsert(s.offices, data) }
    case 'office:delete':
      return { ...s, offices: s.offices.filter((o) => o.id !== data.id) }
    case 'agent':
      return { ...s, agents: upsert(s.agents, data) }
    case 'agent:delete':
      return { ...s, agents: s.agents.filter((a) => a.id !== data.id) }
    case 'connection':
      return { ...s, connections: upsert(s.connections, data) }
    case 'connection:delete':
      return { ...s, connections: s.connections.filter((c) => c.id !== data.id) }
    case 'message':
      return { ...s, messages: [...s.messages.slice(-299), data] }
    case 'simulate':
      return { ...s, simulate: data.on }
    default:
      return s
  }
}

const EVENTS = ['snapshot', 'office', 'office:delete', 'agent', 'agent:delete', 'connection', 'connection:delete', 'message', 'simulate']

export function useHub() {
  const [state, dispatch] = useReducer(reducer, initial)
  const tokenRef = useRef(null)

  useEffect(() => {
    let es
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/session')
        if (r.ok) {
          const { hubToken } = await r.json()
          tokenRef.current = hubToken
          dispatch({ type: 'token', data: hubToken })
        }
      } catch {}
      if (cancelled) return
      es = new EventSource('/api/events' + (tokenRef.current ? `?token=${tokenRef.current}` : ''))
      EVENTS.forEach((t) => es.addEventListener(t, (e) => dispatch({ type: t, data: JSON.parse(e.data) })))
      es.onerror = () => dispatch({ type: 'connected', data: false })
      es.onopen = () => dispatch({ type: 'connected', data: true })
    })()
    return () => {
      cancelled = true
      es?.close()
    }
  }, [])

  const api = useCallback(async (method, path, body) => {
    const r = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(tokenRef.current ? { 'x-hub-token': tokenRef.current } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(json.error || r.statusText)
    return json
  }, [])

  return { ...state, api }
}
