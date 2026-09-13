'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// The hub is serverless, so there is no socket to push updates: the UI polls /api/state.
// `v` lets the server answer "unchanged" cheaply; a mutation triggers an immediate refresh.
const POLL_MS = 2000
const HIDDEN_POLL_MS = 15000
const TOKEN_KEY = 'hq:token'

const initial = {
  offices: [],
  agents: [],
  connections: [],
  messages: [],
  sources: [],
  mode: 'real',
  simulate: false,
  storage: null,
  admin: false,
  version: 0,
  loaded: false,
}

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function useHub() {
  const [state, setState] = useState(initial)
  const [connected, setConnected] = useState(false)
  const [token, setTokenState] = useState(null)
  const tokenRef = useRef(null)
  const versionRef = useRef(0)
  const timer = useRef(null)
  const inflight = useRef(null)

  const headers = () => ({ 'content-type': 'application/json', ...(tokenRef.current ? { 'x-hub-token': tokenRef.current } : {}) })

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current
    inflight.current = (async () => {
      try {
        const r = await fetch(`/api/state?v=${versionRef.current}`, { headers: headers(), cache: 'no-store' })
        if (!r.ok) throw new Error(r.statusText)
        const data = await r.json()
        setConnected(true)
        if (data.unchanged) return
        versionRef.current = data.version
        setState({ ...data, loaded: true })
      } catch {
        setConnected(false)
      } finally {
        inflight.current = null
      }
    })()
    return inflight.current
  }, [])

  const setToken = useCallback(
    (value) => {
      tokenRef.current = value || null
      setTokenState(value || null)
      try {
        if (value) localStorage.setItem(TOKEN_KEY, value)
        else localStorage.removeItem(TOKEN_KEY)
      } catch {}
      versionRef.current = 0 // admin sees office keys — refetch the full payload
      refresh()
    },
    [refresh],
  )

  useEffect(() => {
    let stopped = false
    ;(async () => {
      // A pasted token wins; otherwise a local dev server hands one out.
      let t = readToken()
      if (!t) {
        try {
          const r = await fetch('/api/session', { cache: 'no-store' })
          if (r.ok) t = (await r.json()).hubToken
        } catch {}
      }
      tokenRef.current = t
      setTokenState(t)
      const loop = async () => {
        if (stopped) return
        await refresh()
        timer.current = setTimeout(loop, document.hidden ? HIDDEN_POLL_MS : POLL_MS)
      }
      loop()
    })()
    const onVisible = () => !document.hidden && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const api = useCallback(
    async (method, path, body) => {
      const r = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || r.statusText)
      if (method !== 'GET') refresh()
      return json
    },
    [refresh],
  )

  // `token` is only exposed once the server confirmed it's the admin token.
  return { ...state, connected, token: state.admin ? token : null, rawToken: token, setToken, api, refresh }
}
