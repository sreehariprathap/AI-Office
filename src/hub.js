'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// The hub is serverless, so there is no socket to push updates: the UI polls /api/state.
// `v` lets the server answer "unchanged" cheaply; a mutation triggers an immediate refresh.
const POLL_MS = 2000
const HIDDEN_POLL_MS = 15000

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

export function useHub() {
  const [state, setState] = useState(initial)
  const [connected, setConnected] = useState(false)
  const versionRef = useRef(0)
  const timer = useRef(null)
  const inflight = useRef(null)

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current
    inflight.current = (async () => {
      try {
        const r = await fetch(`/api/state?v=${versionRef.current}`, { cache: 'no-store' })
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

  useEffect(() => {
    let stopped = false
    const loop = async () => {
      if (stopped) return
      await refresh()
      timer.current = setTimeout(loop, document.hidden ? HIDDEN_POLL_MS : POLL_MS)
    }
    loop()
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
      const r = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || r.statusText)
      // Awaited (not fire-and-forget): callers that navigate to what they
      // just created (e.g. opening a freshly built building or office)
      // need `buildings`/`offices` to already include it before that
      // navigation's lookup runs.
      if (method !== 'GET') await refresh()
      return json
    },
    [refresh],
  )

  return { ...state, connected, api, refresh }
}
