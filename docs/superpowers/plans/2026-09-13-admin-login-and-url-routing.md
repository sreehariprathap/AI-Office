# Admin Login + URL Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the whole AI-Office hub behind a real `/login` screen (shared `HUB_ADMIN_TOKEN`, httpOnly cookie session, Next.js middleware), and give the town map real URLs (`/gym`, `/gym/canada-desk`) instead of pure client-state navigation.

**Architecture:** The server's existing admin check (`token === adminToken(world)`) gains the session cookie as a third source alongside the `x-hub-token` header and `?token=` — every existing `if (!admin) fail(401, ...)` guard keeps working unmodified. A root `middleware.js` redirects any page request without a valid cookie to `/login` (except on `localhost`, where it transparently issues one, matching today's dev convenience) — it never touches `/api/*`, which keeps its own per-route admin/office-key checks untouched, since those are called by remote agent processes, not browsers. Real App Router segments (`/`, `/login`, `/[building]`, `/[building]/[floor]`) replace the single catch-all page; `App.jsx` derives what to show from the URL instead of local `view` state, and navigates via `router.push(...)`.

**Tech Stack:** Next.js 16 App Router (middleware, dynamic route segments, `next/navigation`), `node:test` for pure logic, browser verification (chrome-devtools) for routing/auth flows — same hybrid split used throughout this codebase's test suite.

**Spec:** `docs/superpowers/specs/2026-09-13-admin-login-and-url-routing-design.md`

## Global Constraints

- Session cookie name: `hub_session`. Lifetime: 30 days (`SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30`).
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request is actually HTTPS (checked via the request's own URL scheme, not host — this is a small, deliberate refinement over the spec's "Secure except on localhost" wording: it's more correct for edge cases and it's what makes the "simulated deployed" verification steps below work at all over local `http://`, since a real `Secure` cookie would never be stored by a browser over plain HTTP).
- The admin credential stays the single shared secret already in use today: `HUB_ADMIN_TOKEN` env var, falling back to the auto-generated `world.hubToken`. No usernames, no per-user accounts.
- `middleware.js` never gates `/api/*` — only page navigation. Agents keep authenticating per-office via `x-office-key`, unaffected by the login screen.
- Unknown building/floor slugs render the existing in-app "Not found — back to the map" panel, not a hard Next.js 404 boundary.
- Nothing in this plan changes `TownMap.jsx`, `Building.jsx`, `OfficeFloor.jsx`, `BuildingSprite.jsx`, `Modals.jsx`'s form components, or any `/api/*` route's business logic beyond the admin-token extraction line.

---

### Task 1: Session helpers module

**Files:**
- Create: `src/server/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `cleanEnv` from `src/server/sources.js` (already exported there).
- Produces: `SESSION_COOKIE` (string, `'hub_session'`), `SESSION_MAX_AGE_SEC` (number, `2592000`), `adminToken(world)`, `isLocalHost(host)`, `hostOf(req)`, `isHttps(req)` — all pure functions, used by Task 2 (routes) and Task 3 (middleware).

- [ ] **Step 1: Write the failing tests**

Create `tests/session.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminToken, isLocalHost, hostOf, isHttps, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '../src/server/session.js'

test('adminToken prefers HUB_ADMIN_TOKEN over the world-generated token', () => {
  const prev = process.env.HUB_ADMIN_TOKEN
  process.env.HUB_ADMIN_TOKEN = '  secret-123  \n'
  try {
    assert.equal(adminToken({ hubToken: 'hub_generated' }), 'secret-123')
  } finally {
    if (prev === undefined) delete process.env.HUB_ADMIN_TOKEN
    else process.env.HUB_ADMIN_TOKEN = prev
  }
})

test('adminToken falls back to world.hubToken when the env var is unset', () => {
  const prev = process.env.HUB_ADMIN_TOKEN
  delete process.env.HUB_ADMIN_TOKEN
  try {
    assert.equal(adminToken({ hubToken: 'hub_generated' }), 'hub_generated')
  } finally {
    if (prev !== undefined) process.env.HUB_ADMIN_TOKEN = prev
  }
})

test('isLocalHost accepts localhost, 127.0.0.1 and [::1] when not on Vercel', () => {
  const prev = process.env.VERCEL
  delete process.env.VERCEL
  try {
    assert.equal(isLocalHost('localhost'), true)
    assert.equal(isLocalHost('127.0.0.1'), true)
    assert.equal(isLocalHost('[::1]'), true)
    assert.equal(isLocalHost('example.com'), false)
  } finally {
    if (prev !== undefined) process.env.VERCEL = prev
  }
})

test('isLocalHost is always false on a real deployment, even for a localhost-looking host', () => {
  const prev = process.env.VERCEL
  process.env.VERCEL = '1'
  try {
    assert.equal(isLocalHost('localhost'), false)
  } finally {
    if (prev === undefined) delete process.env.VERCEL
    else process.env.VERCEL = prev
  }
})

test('hostOf strips the port from the Host header', () => {
  const req = { headers: { get: (k) => (k === 'host' ? 'localhost:3001' : null) } }
  assert.equal(hostOf(req), 'localhost')
})

test('isHttps checks the request URL scheme, not the host', () => {
  assert.equal(isHttps({ url: 'http://localhost:3000/api/login' }), false)
  assert.equal(isHttps({ url: 'https://example.com/api/login' }), true)
})

test('SESSION_COOKIE and SESSION_MAX_AGE_SEC are stable constants', () => {
  assert.equal(SESSION_COOKIE, 'hub_session')
  assert.equal(SESSION_MAX_AGE_SEC, 60 * 60 * 24 * 30)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `tests/session.test.js` errors with something like `Cannot find module '../src/server/session.js'`. The two existing files (`tests/buildings.test.js`, `tests/townLayout.test.js`, 21 tests) still pass.

- [ ] **Step 3: Write the implementation**

Create `src/server/session.js`:

```js
// Cookie-based admin session -- the token is the exact same shared secret
// every /api/* route has always accepted via the `x-hub-token` header; a
// cookie is just one more place it can come from, so a login screen can
// gate whole pages instead of only individual write requests.
import { cleanEnv } from './sources.js'

export const SESSION_COOKIE = 'hub_session'
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days

export const adminToken = (world) => cleanEnv(process.env.HUB_ADMIN_TOKEN) || world.hubToken

// Local dev only, and never on a real deployment -- the same rule
// GET /api/session used to decide whether to hand the token to the
// browser automatically (that route is retired in Task 5; middleware
// now makes this same call directly).
export const isLocalHost = (host) => !process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(host)

export const hostOf = (req) => (req.headers.get('host') || '').split(':')[0]

// Whether to mark the session cookie `Secure`. Checked from the request's
// own URL scheme (not `isLocalHost`) so a real deployment (always HTTPS)
// gets a Secure cookie and local `http://` dev never does -- including
// when *simulating* a deployment locally for testing (see the verification
// steps in this plan), where the host can look non-local but the
// connection is still plain HTTP.
export const isHttps = (req) => new URL(req.url).protocol === 'https:'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 21 existing + 7 new = 28 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/server/session.js tests/session.test.js
git commit -m "feat: cookie-session helpers (adminToken, isLocalHost, isHttps)"
```

---

### Task 2: Cookie-aware admin auth + login/logout routes

**Files:**
- Modify: `src/server/hub.js`

**Interfaces:**
- Consumes: `adminToken`, `isLocalHost`, `hostOf`, `isHttps`, `SESSION_COOKIE`, `SESSION_MAX_AGE_SEC` from `./session.js` (Task 1).
- Produces: `POST /api/login` (`{token}` → `{ok:true}` + sets the session cookie, or 401), `POST /api/logout` (clears it). A route handler may now return a 3rd tuple element, `[status, payload, cookie]`, where `cookie` is `{name, value, maxAge, secure}` — later tasks don't need this shape, it's purely internal to these two new routes and `json()`/`handle()`.

- [ ] **Step 1: Replace the local `adminToken` with the shared one, and read the cookie**

In `src/server/hub.js`, remove the local definition (currently around line 65):

```js
const adminToken = (world) => cleanEnv(process.env.HUB_ADMIN_TOKEN) || world.hubToken
```

and remove `cleanEnv` from the `./sources.js` import list (it's no longer used directly in this file):

```js
import {
  publicSource, syncSource, addSource, updateSource, removeSource, ensureEnvSource, fetchSnapshot, applySnapshot,
  recordSyncFailure, isDue, cleanEnv,
} from './sources.js'
```
becomes
```js
import {
  publicSource, syncSource, addSource, updateSource, removeSource, ensureEnvSource, fetchSnapshot, applySnapshot,
  recordSyncFailure, isDue,
} from './sources.js'
```

Add, near the top imports:

```js
import { adminToken, isLocalHost, hostOf, isHttps, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './session.js'
```

In `handle()`, extend the token extraction (currently `req.headers.get('x-hub-token') || url.searchParams.get('token')`):

```js
      const token = req.headers.get('x-hub-token') || url.searchParams.get('token') || req.cookies.get(SESSION_COOKIE)?.value
```

- [ ] **Step 2: Add the login and logout routes**

Add these next to the existing `GET /api/session` route:

```js
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
```

Also simplify `GET /api/session` to use the shared helper (it still exists for now — Task 5 retires it once nothing calls it):

```js
route('GET', '/api/session', ({ world, req }) => {
  const host = (req.headers.get('host') || '').split(':')[0]
  const local = !process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(host)
  return local ? { hubToken: adminToken(world) } : { hubToken: null, reason: 'paste HUB_ADMIN_TOKEN into the UI' }
})
```
becomes
```js
route('GET', '/api/session', ({ world, req }) => {
  return isLocalHost(hostOf(req)) ? { hubToken: adminToken(world) } : { hubToken: null, reason: 'paste HUB_ADMIN_TOKEN into the UI' }
})
```

- [ ] **Step 3: Make `json()`/`handle()` able to set the cookie a route returns**

Find (near the bottom of the file):

```js
const json = (status, body) => Response.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } })
```

Replace with:

```js
// `cookie`, when given, is `{ name, value, maxAge, secure }` -- the shape
// /api/login and /api/logout return (see above). NextResponse (not the
// plain Response used before) is what exposes `.cookies.set(...)`.
const json = (status, body, cookie) => {
  const res = NextResponse.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } })
  if (cookie) res.cookies.set(cookie.name, cookie.value, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: cookie.maxAge, secure: cookie.secure })
  return res
}
```

Add `NextResponse` to the existing `next/server` import at the top of the file:

```js
import { after } from 'next/server'
```
becomes
```js
import { after, NextResponse } from 'next/server'
```

Find, further down in `handle()`:

```js
    const [status, payload] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result]
    return json(status, payload)
```

Replace with:

```js
    const [status, payload, cookie] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result]
    return json(status, payload, cookie)
```

- [ ] **Step 4: Run the existing test suite**

Run: `npm test`
Expected: PASS — 28 tests (unchanged from Task 1), 0 failures. This task's behavior is verified live in the next step, not by `node:test` — there's no existing precedent in this codebase for unit-testing the HTTP route dispatch itself (`tests/buildings.test.js` and `tests/townLayout.test.js` both test pure logic modules directly, not routes).

- [ ] **Step 5: Verify live**

```bash
npm run dev &
sleep 2
TOKEN=$(grep HUB_ADMIN_TOKEN .env | cut -d= -f2)

# Wrong token: 401, no cookie set
curl -si -X POST http://localhost:3000/api/login -H 'content-type: application/json' -d '{"token":"wrong"}' | head -5

# Right token: 200, Set-Cookie present, no Secure flag (plain http)
curl -si -X POST http://localhost:3000/api/login -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}" | head -8

# Logout: 200, cookie cleared (Max-Age=0)
curl -si -X POST http://localhost:3000/api/logout | head -8

kill %1
```

Expected: the wrong-token request is `401 {"error":"invalid token"}` with no `Set-Cookie` header. The right-token request is `200 {"ok":true}` with a header like `Set-Cookie: hub_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` (no `Secure`, since this is plain `http://localhost`). The logout request has `Set-Cookie: hub_session=; ... Max-Age=0`.

- [ ] **Step 6: Commit**

```bash
git add src/server/hub.js
git commit -m "feat: cookie-based admin login/logout routes"
```

---

### Task 3: Middleware — page login gate

**Files:**
- Create: `src/middleware.js`
- Modify: `src/server/hub.js:46` (export `initWorld`)

**Interfaces:**
- Consumes: `initWorld` from `./server/hub.js` (needs `export`), `withWorld` from `./server/store.js`, `adminToken`, `isLocalHost`, `hostOf`, `isHttps`, `SESSION_COOKIE`, `SESSION_MAX_AGE_SEC` from `./server/session.js` (Task 1).
- Produces: every page request either passes through (valid cookie, or `/login`, or `/api/*`), gets a cookie silently issued (local host, no cookie yet), or gets redirected to `/login?next=<original path>`.

- [ ] **Step 1: Export `initWorld`**

In `src/server/hub.js`, find:

```js
function initWorld(stored) {
```

Change to:

```js
export function initWorld(stored) {
```

- [ ] **Step 2: Write the middleware**

Create `src/middleware.js`:

```js
// Gates every page behind a logged-in admin session -- but never /api/*,
// which agents call directly with their own per-office `x-office-key`
// (see src/server/hub.js) and must keep working regardless of whether a
// browser has logged in. The matcher below excludes /api entirely, so
// this function never even runs for it.
import { NextResponse } from 'next/server'
import { withWorld } from './server/store.js'
import { initWorld } from './server/hub.js'
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC, adminToken, isLocalHost, hostOf, isHttps } from './server/session.js'

export const runtime = 'nodejs'

export async function middleware(req) {
  if (req.nextUrl.pathname === '/login') return NextResponse.next()

  const { result: token } = await withWorld(initWorld, async (world) => adminToken(world))
  const cookie = req.cookies.get(SESSION_COOKIE)?.value
  if (cookie && cookie === token) return NextResponse.next()

  if (isLocalHost(hostOf(req))) {
    const res = NextResponse.next()
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SEC, secure: isHttps(req) })
    return res
  }

  const url = new URL('/login', req.url)
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 3: Verify local-dev auto-bypass**

```bash
npm run dev &
sleep 2
curl -si http://localhost:3000/ | head -10
kill %1
```

Expected: `HTTP/1.1 200` (not a redirect), with a `Set-Cookie: hub_session=...` header on this very first response — the local-host shortcut issuing the cookie transparently, matching today's `/api/session` convenience.

- [ ] **Step 4: Verify the gate on a simulated deployment**

`VERCEL=1` forces `isLocalHost` to false regardless of the host, letting you exercise the "real deployment" branch without actually deploying:

```bash
VERCEL=1 npm run dev &
sleep 2
curl -si http://localhost:3000/ | head -10          # expect a 307/308 redirect to /login?next=%2F
curl -si http://localhost:3000/gym/canada-desk | head -10  # expect a redirect to /login?next=%2Fgym%2Fcanada-desk
curl -si http://localhost:3000/api/health | head -5  # expect 200 -- /api/* is never gated
curl -si http://localhost:3000/login | head -5       # expect Next's own 404 for now -- the /login PAGE doesn't exist until Task 4, only the routes it'll post to
kill %1
```

Expected: the first two commands each show a `Location: /login?next=...` header; the third is a plain `200` (API untouched); the fourth 404s because there's no page at `/login` yet — that's expected and gets fixed in Task 4, not a bug in this task.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.js src/server/hub.js
git commit -m "feat: middleware gates every page behind the admin session cookie"
```

---

### Task 4: Login screen

**Files:**
- Create: `src/app/login/page.jsx`
- Create: `src/app/login/LoginForm.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `POST /api/login` (Task 2).
- Produces: a real page at `/login` that Task 3's middleware can redirect to (closing the gap noted in Task 3 Step 4).

- [ ] **Step 1: Write the login page**

Create `src/app/login/page.jsx`:

```jsx
import { Suspense } from 'react'
import LoginForm from './LoginForm.jsx'

export const metadata = { title: 'Log in — World of Wonders' }

export default function LoginPage() {
  return (
    <div className="login-screen">
      {/* useSearchParams (for `?next=`) requires a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
```

Create `src/app/login/LoginForm.jsx`:

```jsx
'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function LoginForm() {
  const params = useSearchParams()
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: value }),
      })
      if (!r.ok) throw new Error()
      // Full navigation, not client-side routing: the app's own state
      // (hub.js, App.jsx) should mount fresh under the now-valid cookie
      // rather than reuse anything from the logged-out render.
      window.location.href = params.get('next') || '/'
    } catch {
      setErr('That token was rejected — paste HUB_ADMIN_TOKEN again.')
      setValue('')
      setBusy(false)
    }
  }

  return (
    <form className="login-card form" onSubmit={submit}>
      <div className="brand">
        <span className="logo">▣</span> WORLD OF WONDERS
      </div>
      <label>Admin token</label>
      <input
        autoFocus
        required
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="HUB_ADMIN_TOKEN"
      />
      {err && <p className="error">{err}</p>}
      <button className="primary" disabled={busy || !value}>
        Log in
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Add the CSS**

Append to `src/styles.css`:

```css
.login-screen { min-height: 100dvh; display: grid; place-items: center; padding: 16px; }
.login-card { width: min(360px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 16px 40px #000a; padding: 20px; }
.login-card .brand { justify-content: center; display: flex; gap: 6px; margin-bottom: 8px; cursor: default; }
```

- [ ] **Step 3: Verify in the browser**

```bash
VERCEL=1 npm run dev
```

1. Open `http://localhost:3000/` — redirected to `/login?next=%2F`; the screen shows the "WORLD OF WONDERS" brand, an "Admin token" field, and a "Log in" button, styled consistently with the rest of the app (dark panel, same fonts).
2. Submit a wrong value — inline error "That token was rejected — paste HUB_ADMIN_TOKEN again.", field cleared, still on `/login`.
3. Submit the real token (`grep HUB_ADMIN_TOKEN .env`) — redirected to `/` (the map). Since the cookie isn't `Secure` over plain `http://` (Task 1/2's `isHttps` check), the browser keeps it and you stay logged in on reload.
4. Visit `http://localhost:3000/gym/canada-desk` directly with a fresh private/incognito window (no cookie) — redirected to `/login?next=%2Fgym%2Fcanada-desk`; logging in lands you back on that exact URL (note: `/gym/canada-desk` doesn't resolve to anything yet — that's fine here, this step only checks the *redirect target*, not the destination page, which Task 7 builds).
5. Check the browser console: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.jsx src/app/login/LoginForm.jsx src/styles.css
git commit -m "feat: admin login screen"
```

---

### Task 5: Retire the old client-side token flow

**Files:**
- Modify: `src/hub.js`
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: `src/server/hub.js` (remove `GET /api/session`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `admin` (boolean) already present in `/api/state`'s response (`src/server/hub.js`'s `route('GET', '/api/state', ...)`, unchanged) — this task just stops shadowing it with the old client-managed `token`/`rawToken` naming.
- Produces: `useHub()` returns `{ ...state, connected, api, refresh }` — no more `token`, `rawToken`, `setToken`. `admin` reaches callers as `hub.admin` (from `state.admin`, i.e. `...state` spread) instead of the old `hub.token`.

- [ ] **Step 1: Simplify `src/hub.js`**

Replace the whole file with:

```js
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
```

What's gone: `TOKEN_KEY`, `readToken`, the `token`/`rawToken` state and the `tokenRef`, `setToken`, the `headers()` helper (the browser now attaches the session cookie to every same-origin `fetch` automatically — no header to build), and the startup dance that fetched `/api/session` or read `localStorage` before the poll loop could start (the loop just starts immediately now).

- [ ] **Step 2: Update `src/App.jsx`**

Change the destructure (currently):

```js
  const { api, connected, simulate, token, sources, setToken, rawToken } = hub
```

to:

```js
  const { api, connected, simulate, sources, admin } = hub
```

In the `setMode` function, change:

```js
    if (token) api('POST', '/api/mode', { mode: m }).catch(() => {})
```

to:

```js
    if (admin) api('POST', '/api/mode', { mode: m }).catch(() => {})
```

Change the "+ Add building" nav button guard:

```jsx
          {!real && view === 'map' && token && (
```

to:

```jsx
          {!real && view === 'map' && admin && (
```

Replace the whole 🔒 lock button block:

```jsx
          {hub.loaded && !token && (
            <button
              className="lock"
              title={rawToken ? 'That token was rejected — paste HUB_ADMIN_TOKEN again' : 'Read-only: paste the admin token to make changes'}
              onClick={() => {
                const t = window.prompt('Admin token (HUB_ADMIN_TOKEN)')
                if (t) setToken(t.trim())
              }}
            >
              🔒 {rawToken ? 'bad token' : 'read-only'}
            </button>
          )}
```

with:

```jsx
          {hub.loaded && (
            <button
              className="lock"
              title="Log out"
              onClick={async () => {
                await fetch('/api/logout', { method: 'POST' })
                window.location.href = '/login'
              }}
            >
              🔓 Log out
            </button>
          )}
```

Change the building toolbar's admin guard:

```jsx
                {!building.sourceId && token && (
```
to
```jsx
                {!building.sourceId && admin && (
```

Change the "+ Add building" primary button and the town map's `canAdd`:

```jsx
                  <button className="primary" onClick={() => setModal({ type: 'building' })} disabled={!token}>
```
to
```jsx
                  <button className="primary" onClick={() => setModal({ type: 'building' })} disabled={!admin}>
```
and
```jsx
              canAdd={!real && !!token}
```
to
```jsx
              canAdd={!real && admin}
```

Change the demo-traffic checkbox:

```jsx
              <input type="checkbox" checked={simulate} disabled={!token} onChange={(e) => api('POST', '/api/simulate', { on: e.target.checked })} /> demo traffic
```
to
```jsx
              <input type="checkbox" checked={simulate} disabled={!admin} onChange={(e) => api('POST', '/api/simulate', { on: e.target.checked })} /> demo traffic
```

Change the `ConnectPanel` call:

```jsx
          {tab === 'connect' && office && !office.external && <ConnectPanel office={office} api={api} token={token} />}
```
to
```jsx
          {tab === 'connect' && office && !office.external && <ConnectPanel office={office} api={api} admin={admin} />}
```

- [ ] **Step 3: Rename the `token` prop in `ConnectPanel`**

In `src/components/Sidebar.jsx`, change:

```js
export function ConnectPanel({ office, api, token }) {
```
to
```js
export function ConnectPanel({ office, api, admin }) {
```

and:

```jsx
        {token && (
```
to
```jsx
        {admin && (
```

- [ ] **Step 4: Retire `GET /api/session`**

In `src/server/hub.js`, delete the whole route (nothing calls it anymore now that Step 1 removed the client's fallback fetch):

```js
route('GET', '/api/session', ({ world, req }) => {
  return isLocalHost(hostOf(req)) ? { hubToken: adminToken(world) } : { hubToken: null, reason: 'paste HUB_ADMIN_TOKEN into the UI' }
})
```

Since `isLocalHost`/`hostOf` are no longer used in this file (only `middleware.js` needs them now), trim the import added in Task 2:

```js
import { adminToken, isLocalHost, hostOf, isHttps, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './session.js'
```
becomes
```js
import { adminToken, isHttps, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './session.js'
```

- [ ] **Step 5: Update the README's auth section**

In `README.md`, replace:

```
Auth: `x-office-key` for office-scoped writes. The `x-hub-token` admin token is handed to browsers only by a local dev server, via `/api/session`. On a deployment, set `HUB_ADMIN_TOKEN` and paste it into the UI. GETs are open, but office keys are hidden unless you authenticate.
```

with:

```
Auth: the whole UI sits behind `/login` — one shared `HUB_ADMIN_TOKEN`, checked by `src/middleware.js` via an httpOnly session cookie (30 days, with a Log out button in the topbar). Running locally (`next dev`/`next start` on `localhost`) skips the login screen automatically, same as before. Agents authenticate separately and per-office via `x-office-key` on `/api/*` — unaffected by the login screen, which only gates page navigation.
```

- [ ] **Step 6: Run the tests and build**

Run: `npm test`
Expected: PASS — 28 tests, 0 failures (unchanged from Task 1/2 — this task is a pure client/docs refactor).

Run: `rm -rf .next && npm run build`
Expected: compiles with no errors.

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev
```

1. Open `http://localhost:3000/` (local host, so middleware auto-issues the cookie) — the app loads exactly as before, with a "🔓 Log out" button where the old 🔒 read-only icon used to be.
2. Click "Log out" — redirected to `/login`.
3. Reload `http://localhost:3000/` — middleware auto-issues a fresh cookie again (still on localhost), so the app loads without being asked to log in — this is the intended local-dev convenience, not a bug.
4. Open the sidebar's API tab for an office (click a floor, then a desk isn't needed — the API tab is available whenever an office is open) and confirm the "rotate" button next to the office API key still appears (it's gated on `admin`, which is `true` here).

- [ ] **Step 8: Commit**

```bash
git add src/hub.js src/App.jsx src/components/Sidebar.jsx src/server/hub.js README.md
git commit -m "feat: retire the token-prompt flow now that login is cookie-based"
```

---

### Task 6: Pure routing-resolution helpers

**Files:**
- Create: `src/routing.js`
- Test: `tests/routing.test.js`

**Interfaces:**
- Produces: `resolveOpenPath({ buildings, offices, id })` → a path string or `null`; `crossModeTarget({ buildingSlug, currentBuildings, allBuildings })` → `'mock' | 'real' | null`. Both consumed by `App.jsx` in Task 7.

- [ ] **Step 1: Write the failing tests**

Create `tests/routing.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOpenPath, crossModeTarget } from '../src/routing.js'

const buildings = [
  { id: 'b1', slug: 'gym', sourceId: null },
  { id: 'b2', slug: 'sreeharis-ai-workforce', sourceId: 'src-1' },
]
const offices = [
  { id: 'o1', slug: 'weights-room', buildingId: 'b1' },
  { id: 'o2', slug: 'crypto-desk', buildingId: 'b2' },
]

test('resolveOpenPath resolves an office id to its building/floor path', () => {
  assert.equal(resolveOpenPath({ buildings, offices, id: 'o1' }), '/gym/weights-room')
})

test('resolveOpenPath resolves a building id to its building path', () => {
  assert.equal(resolveOpenPath({ buildings, offices, id: 'b2' }), '/sreeharis-ai-workforce')
})

test('resolveOpenPath returns null for an office whose building is not in the given list', () => {
  assert.equal(resolveOpenPath({ buildings: [], offices, id: 'o1' }), null)
})

test('resolveOpenPath returns null for an unknown id', () => {
  assert.equal(resolveOpenPath({ buildings, offices, id: 'nope' }), null)
})

test('crossModeTarget returns null when the slug is already visible in the current mode', () => {
  assert.equal(crossModeTarget({ buildingSlug: 'gym', currentBuildings: buildings, allBuildings: buildings }), null)
})

test('crossModeTarget returns "real" for a synced building only visible in real mode', () => {
  assert.equal(
    crossModeTarget({ buildingSlug: 'sreeharis-ai-workforce', currentBuildings: [buildings[0]], allBuildings: buildings }),
    'real',
  )
})

test('crossModeTarget returns "mock" for a hand-made building only visible in mock mode', () => {
  assert.equal(crossModeTarget({ buildingSlug: 'gym', currentBuildings: [buildings[1]], allBuildings: buildings }), 'mock')
})

test('crossModeTarget returns null for a slug that does not exist anywhere', () => {
  assert.equal(crossModeTarget({ buildingSlug: 'nope', currentBuildings: [], allBuildings: buildings }), null)
})

test('crossModeTarget returns null when there is no building slug (map view)', () => {
  assert.equal(crossModeTarget({ buildingSlug: undefined, currentBuildings: [], allBuildings: buildings }), null)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `tests/routing.test.js` errors with `Cannot find module '../src/routing.js'`. The 28 tests from Tasks 1-2 still pass.

- [ ] **Step 3: Write the implementation**

Create `src/routing.js`:

```js
// Pure helpers for turning a click (an office/building id, from App.jsx's
// flat id space) or a URL (building/floor slugs) into the other -- kept
// free of React so this resolution logic is unit-testable without a
// browser.

// A click on a floor tab or a building lot always hands App.jsx an id.
// This resolves it to the route that shows it -- an office resolves to
// its building's floor, a building resolves to itself. Kind (workspace vs
// landmark) doesn't matter here: every building gets a real URL, and
// App.jsx decides how to render what's at it.
export function resolveOpenPath({ buildings, offices, id }) {
  const office = offices.find((o) => o.id === id)
  if (office) {
    const parent = buildings.find((b) => b.id === office.buildingId)
    return parent ? `/${parent.slug}/${office.slug}` : null
  }
  const building = buildings.find((b) => b.id === id)
  return building ? `/${building.slug}` : null
}

// Building slugs are unique across mock and real data, so a URL for a
// building that exists only in the *other* mode should switch modes
// instead of showing "not found" -- a shared link works no matter which
// mode the visitor's browser last had selected. Returns the mode to
// switch to, or null if no switch is needed (already in the right mode,
// or the slug doesn't exist in either mode -- a genuine not-found).
export function crossModeTarget({ buildingSlug, currentBuildings, allBuildings }) {
  if (!buildingSlug) return null
  if (currentBuildings.some((b) => b.slug === buildingSlug)) return null
  const elsewhere = allBuildings.find((b) => b.slug === buildingSlug)
  if (!elsewhere) return null
  return elsewhere.sourceId ? 'real' : 'mock'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 28 + 9 = 37 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/routing.js tests/routing.test.js
git commit -m "feat: pure slug/id routing-resolution helpers"
```

---

### Task 7: Real routes + App.jsx navigation rewrite

**Files:**
- Create: `src/app/_app-entry.jsx`
- Modify: `src/app/page.jsx`
- Create: `src/app/[building]/page.jsx`
- Create: `src/app/[building]/[floor]/page.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `resolveOpenPath`, `crossModeTarget` from `src/routing.js` (Task 6); `admin` from `hub` (Task 5).
- Produces: `App.jsx` no longer owns `view` state; it derives `building`/`office`/`showMap` from `useParams()` and navigates via `router.push(...)`. `TownMap.jsx`, `Building.jsx`, `OfficeFloor.jsx` are untouched — their props (`onOpen`, ids, etc.) mean exactly what they did before.

- [ ] **Step 1: Extract the shared client-entry component**

Create `src/app/_app-entry.jsx` (the leading underscore keeps Next.js from treating it as a route):

```jsx
'use client'
// The office is a live, browser-only canvas (localStorage, polling, SVG
// animation) -- render it on the client. Every route (/, /:building,
// /:building/:floor) mounts this same component; App.jsx itself reads the
// URL (useParams) to decide what to show.
import dynamic from 'next/dynamic'

const App = dynamic(() => import('../App.jsx'), { ssr: false })

export default function AppEntry() {
  return <App />
}
```

Replace `src/app/page.jsx` (currently the `dynamic(...)` call directly) with:

```jsx
export { default } from './_app-entry.jsx'
```

Create `src/app/[building]/page.jsx`:

```jsx
export { default } from '../_app-entry.jsx'
```

Create `src/app/[building]/[floor]/page.jsx`:

```jsx
export { default } from '../../_app-entry.jsx'
```

- [ ] **Step 2: Import routing hooks and helpers in `App.jsx`**

Add to the top imports:

```js
import { useRouter, useParams } from 'next/navigation'
import { resolveOpenPath, crossModeTarget } from './routing.js'
```

- [ ] **Step 3: Replace the mode-setting functions**

Find:

```js
  const setMode = (m) => {
    setModeLocal(m)
    setSelectedId(null)
    setView('map')
    if (admin) api('POST', '/api/mode', { mode: m }).catch(() => {})
  }
```

Replace with:

```js
  const router = useRouter()
  // Sets the mode without navigating -- used both by the explicit
  // MOCK/REALTIME toggle below (which also jumps to the map) and by the
  // cross-mode-link effect further down (which must NOT navigate away
  // from the URL a visitor actually followed).
  const applyMode = (m) => {
    setModeLocal(m)
    if (admin) api('POST', '/api/mode', { mode: m }).catch(() => {})
  }
  const setMode = (m) => {
    applyMode(m)
    setSelectedId(null)
    router.push('/')
  }
```

- [ ] **Step 4: Replace the `view` state with URL-derived state**

Find:

```js
  // view is one flat id space, matching how office ids already worked here:
  // 'map' | a building's id | an office's id. Old sessions stored 'campus'
  // or a bare office id -- 'campus' maps forward to 'map', a bare office id
  // is already a value this scheme understands as-is.
  const [view, setView] = useState(() => {
    const raw = localStorage.getItem('hq:view')
    return !raw || raw === 'campus' ? 'map' : raw
  })
  const [selectedId, setSelectedId] = useState(null)
```

Replace with:

```js
  const params = useParams() // {} on '/', {building} on '/:building', {building, floor} on '/:building/:floor'
  const buildingSlug = params.building
  const floorSlug = params.floor
  const [selectedId, setSelectedId] = useState(null)
```

Find:

```js
  useEffect(() => {
    try {
      localStorage.setItem('hq:view', view)
    } catch {}
  }, [view])
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const office = offices.find((o) => o.id === view)
  // Viewing a floor derives its building from the floor; viewing a building
  // directly (view holds the building's own id) looks it up straight.
  const building = office
    ? buildings.find((b) => b.id === office.buildingId) || null
    : buildings.find((b) => b.id === view) || null
  const buildingOffices = useMemo(
    () => (building ? offices.filter((o) => o.buildingId === building.id) : []),
    [building, offices],
  )
  useEffect(() => {
    if (view !== 'map' && offices.length && buildings.length && !office && !building) setView('map')
  }, [offices, buildings, office, building, view])
```

Replace with:

```js
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  // The URL is the source of truth now -- no local `view` state, nothing
  // persisted to localStorage. Reload/back/forward/shared links all just
  // re-derive this from the path.
  const building = buildingSlug ? buildings.find((b) => b.slug === buildingSlug) || null : null
  const buildingOffices = useMemo(
    () => (building ? offices.filter((o) => o.buildingId === building.id) : []),
    [building, offices],
  )
  const office = building && floorSlug ? buildingOffices.find((o) => o.slug === floorSlug) || null : null
  // A landmark has nothing inside it -- it shows the map with its
  // description card open over it, not a tower (see the viewport below).
  const showMap = !buildingSlug || building?.kind === 'landmark'
  // A floor slug was given but doesn't belong to this building -- distinct
  // from "no floor slug at all" (a bare building URL, which shows the
  // tower), and from "no such building" (falls through to Not Found below).
  const floorMissing = !!(building && floorSlug && !office)

  // Building slugs are unique across mock/real data; a link to a building
  // that only exists in the other mode should switch modes to reveal it
  // instead of showing "not found".
  useEffect(() => {
    if (!hub.loaded) return
    const target = crossModeTarget({ buildingSlug, currentBuildings: buildings, allBuildings: hub.buildings || [] })
    if (target) applyMode(target)
  }, [hub.loaded, buildingSlug, buildings, hub.buildings])

  // Visiting a landmark's URL directly (not just clicking it from the map)
  // shows the same description card clicking it does.
  useEffect(() => {
    if (building?.kind === 'landmark') setModal({ type: 'landmark', building })
  }, [building])
```

- [ ] **Step 5: Rewrite `goMap`, `open`, and the agent-jump in `select`**

Find:

```js
  const goMap = () => { setSelectedId(null); setView('map') }
  // Shared by TownMap (building ids) and Building.jsx (office ids) -- both
  // live in the same id space, so one function routes either kind of click.
  // A landmark has nothing inside it, so it opens a card instead of a tower.
  const open = (id) => {
    const b = buildings.find((x) => x.id === id)
    if (b?.kind === 'landmark') return setModal({ type: 'landmark', building: b })
    setView(id)
  }

  const select = (id, jump = false) => {
    if (id === 'hire') return office && !office.external && setModal({ type: 'hire' })
    setSelectedId(id)
    if (id) {
      setTab('agent')
      // Tapping a desk on mobile should surface the panel immediately,
      // not require a second tap on the toolbar toggle to see who you
      // just picked.
      setSideOpen(true)
      if (jump && agentsById[id]) setView(agentsById[id].officeId)
    } else if (tab === 'agent') setTab('feed')
  }
```

Replace with:

```js
  const goMap = () => { setSelectedId(null); router.push('/') }
  // Shared by TownMap (building ids) and Building.jsx (office ids) -- both
  // live in the same id space, so one function routes either kind of
  // click. Landmarks get a real URL too now; the effect above is what
  // actually opens their card once the URL points at one.
  const open = (id) => {
    const path = resolveOpenPath({ buildings, offices, id })
    if (path) router.push(path)
  }

  const select = (id, jump = false) => {
    if (id === 'hire') return office && !office.external && setModal({ type: 'hire' })
    setSelectedId(id)
    if (id) {
      setTab('agent')
      // Tapping a desk on mobile should surface the panel immediately,
      // not require a second tap on the toolbar toggle to see who you
      // just picked.
      setSideOpen(true)
      if (jump && agentsById[id]) open(agentsById[id].officeId)
    } else if (tab === 'agent') setTab('feed')
  }
```

- [ ] **Step 6: Fix up every remaining `view`/`setView` reference**

Topbar Map button — find:

```jsx
          <button className={view === 'map' ? 'on' : ''} onClick={goMap}>
```
replace with
```jsx
          <button className={showMap ? 'on' : ''} onClick={goMap}>
```

Floor tab button — find:

```jsx
                <button key={o.id} className={view === o.id ? 'on' : ''} onClick={() => open(o.id)} style={{ '--tab': themeOf(o).wall }}>
```
replace with
```jsx
                <button key={o.id} className={office?.id === o.id ? 'on' : ''} onClick={() => open(o.id)} style={{ '--tab': themeOf(o).wall }}>
```

"+ Add building" nav button — find:

```jsx
          {!real && view === 'map' && admin && (
```
replace with
```jsx
          {!real && showMap && admin && (
```

Toolbar ternary — find:

```jsx
          ) : building ? (
            <>
              <div className="title">
                <h1>{building.name}</h1>
```
replace with
```jsx
          ) : building && building.kind === 'workspace' ? (
            <>
              <div className="title">
                <h1>{building.name}</h1>
```

(only the condition changes — everything inside that branch stays exactly as it is; a landmark now falls through to the map's title/subtitle branch instead, which is correct since its card is shown as an overlay on the map).

Viewport ternary — find:

```jsx
          {!hub.loaded ? (
            <div className="empty">Connecting to hub… is `npm run dev` running?</div>
          ) : view === 'map' && !buildings.length && real ? (
            <RealtimeEmpty sources={sources} onManage={() => setModal({ type: 'sources' })} onMock={() => setMode('mock')} />
          ) : view === 'map' ? (
            <TownMap
              buildings={buildings}
              onOpen={open}
              onAddBuilding={() => setModal({ type: 'building' })}
              canAdd={!real && admin}
              zoom={zoom}
            />
          ) : office ? (
```
replace with
```jsx
          {!hub.loaded ? (
            <div className="empty">Connecting to hub… is `npm run dev` running?</div>
          ) : showMap && !buildings.length && real ? (
            <RealtimeEmpty sources={sources} onManage={() => setModal({ type: 'sources' })} onMock={() => setMode('mock')} />
          ) : showMap ? (
            <TownMap
              buildings={buildings}
              onOpen={open}
              onAddBuilding={() => setModal({ type: 'building' })}
              canAdd={!real && admin}
              zoom={zoom}
            />
          ) : office ? (
```

and, right after the `<Building ... />` block, find:

```jsx
          ) : building ? (
            <Building
              key={building.id}
              building={building}
              offices={buildingOffices}
              agents={agents}
              messages={messages}
              onOpen={open}
              onSelectAgent={(id) => select(id, true)}
              onAddFloor={() => setModal({ type: 'office', buildingSlug: building.slug })}
              addLabel="+ ADD FLOOR"
              title={building.name}
              zoom={zoom * 1.15}
            />
          ) : (
            <div className="empty">Not found — <button className="link" onClick={goMap}>back to the map</button>.</div>
          )}
```
replace with
```jsx
          ) : floorMissing ? (
            <div className="empty">Not found — <button className="link" onClick={goMap}>back to the map</button>.</div>
          ) : building ? (
            <Building
              key={building.id}
              building={building}
              offices={buildingOffices}
              agents={agents}
              messages={messages}
              onOpen={open}
              onSelectAgent={(id) => select(id, true)}
              onAddFloor={() => setModal({ type: 'office', buildingSlug: building.slug })}
              addLabel="+ ADD FLOOR"
              title={building.name}
              zoom={zoom * 1.15}
            />
          ) : (
            <div className="empty">Not found — <button className="link" onClick={goMap}>back to the map</button>.</div>
          )}
```

- [ ] **Step 7: Fix up the modal `onCreated`/`onOpenOffice` call sites**

Find:

```jsx
      {modal?.type === 'office' && (
        <NewOfficeModal api={api} buildingSlug={modal.buildingSlug} onClose={() => setModal(null)} onCreated={(o) => setView(o.id)} />
      )}
      {modal?.type === 'hire' && office && <HireModal api={api} office={office} onClose={() => setModal(null)} onCreated={(a) => select(a.id)} />}
      {modal?.type === 'sources' && <SourcesModal api={api} sources={sources} offices={offices} onClose={() => setModal(null)} onOpenOffice={setView} />}
      {modal?.type === 'connect' && <ConnectModal api={api} agents={agents} offices={offices} fromId={modal.fromId} onClose={() => setModal(null)} />}
      {modal?.type === 'building' && (
        <NewBuildingModal
          api={api}
          onClose={() => setModal(null)}
          // `open(b.id)` would re-look-up the building in `buildings`, which
          // can still be the pre-creation snapshot at this exact instant
          // (this closure was captured when the modal was opened, before
          // the POST resolved) -- use the freshly created object directly.
          onCreated={(b) => (b.kind === 'landmark' ? setModal({ type: 'landmark', building: b }) : setView(b.id))}
        />
      )}
```

replace with

```jsx
      {modal?.type === 'office' && (
        <NewOfficeModal
          api={api}
          buildingSlug={modal.buildingSlug}
          onClose={() => setModal(null)}
          onCreated={(o) => router.push(`/${modal.buildingSlug}/${o.slug}`)}
        />
      )}
      {modal?.type === 'hire' && office && <HireModal api={api} office={office} onClose={() => setModal(null)} onCreated={(a) => select(a.id)} />}
      {modal?.type === 'sources' && <SourcesModal api={api} sources={sources} offices={offices} onClose={() => setModal(null)} onOpenOffice={open} />}
      {modal?.type === 'connect' && <ConnectModal api={api} agents={agents} offices={offices} fromId={modal.fromId} onClose={() => setModal(null)} />}
      {modal?.type === 'building' && (
        <NewBuildingModal api={api} onClose={() => setModal(null)} onCreated={(b) => router.push(`/${b.slug}`)} />
      )}
```

(the landmark special-case is gone from here entirely — `router.push` doesn't depend on `buildings` state being fresh at all, and the Step 4 effect now uniformly opens the card whenever the URL points at a landmark, whether you clicked it or created it).

- [ ] **Step 8: Run the test suite and build**

Run: `npm test`
Expected: PASS — 37 tests (unchanged from Task 6), 0 failures.

Run: `rm -rf .next && npm run build`
Expected: compiles with no errors. If Next.js complains about `[building]` conflicting with `login` at the same level, that's a sign a route file was misplaced — `app/login/page.jsx` and `app/[building]/page.jsx` are siblings under `app/`, and Next.js resolves the static `login` segment first; there should be no actual conflict if the files are where Step 1 put them.

- [ ] **Step 9: Verify in the browser**

```bash
npm run dev   # plain, local host -- login auto-bypassed, so this step is purely about routing
```

1. Open `http://localhost:3000/` — map renders at `/`.
2. Click a building — URL becomes `/<its-slug>`, the tower renders.
3. Click a floor tab — URL becomes `/<building-slug>/<floor-slug>`, that floor renders.
4. Click the brand ("WORLD OF WONDERS") — URL returns to `/`.
5. Navigate back into a floor, then reload the page — same floor renders (no bounce to the map).
6. Visit `http://localhost:3000/does-not-exist` — "Not found — back to the map" panel; the topbar/mode toggle are still usable.
7. Visit `http://localhost:3000/<a-real-building-slug>/does-not-exist` — "Not found" panel too (not silently the tower).
8. Toggle MOCK ⇄ REALTIME — each jumps to `/`.
9. In MOCK mode, use "+ Add building" to create a workspace — URL updates to its new slug, the (empty) tower opens.
10. Create a landmark — URL updates to its slug, the description card opens over the map.
11. Cross-mode link: note a MOCK-town building's URL (e.g. `/head-office`), switch to REALTIME, then paste that exact URL into the address bar — the app switches back to MOCK automatically and shows that building (not "not found").
12. Check the console throughout: no errors.
13. Clean up any test buildings created in step 9/10 (`curl -X DELETE http://localhost:3000/api/buildings/<slug> -H "x-hub-token: $(grep HUB_ADMIN_TOKEN .env | cut -d= -f2)"`) so the world isn't left polluted.

- [ ] **Step 10: Commit**

```bash
git add src/app/_app-entry.jsx src/app/page.jsx src/app/[building] src/App.jsx
git commit -m "feat: real URL routes for map/building/floor"
```

---

### Task 8: Full-journey verification

**Files:** none modified — this task is verification and fixes only.

- [ ] **Step 1: Run the whole logic suite**

Run: `npm test`
Expected: PASS — 37 tests, no skips.

- [ ] **Step 2: Production build**

Run: `rm -rf .next && npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Walk the login + deep-link journey under a simulated deployment**

```bash
VERCEL=1 npm run build && VERCEL=1 npm run start -- -p 3002
```

| # | Step | Expect |
|---|---|---|
| 1 | Open `http://localhost:3002/` in a fresh/incognito window | redirected to `/login?next=%2F` |
| 2 | Submit a wrong token | inline error, still on `/login`, field cleared |
| 3 | Submit the real token (`.env`'s `HUB_ADMIN_TOKEN`) | redirected to `/`, map renders |
| 4 | In the same fresh window, visit `/gym/canada-desk`-style URL for a real building/floor you noted from Task 7 | redirected to `/login?next=/that/exact/path` (not logged in yet in this window) |
| 5 | Log in from that redirect | lands back on the exact floor you deep-linked to, not `/` |
| 6 | Click "Log out" | redirected to `/login` |
| 7 | Revisit `/` | redirected to `/login` again (session truly cleared, not just hidden client-side) |
| 8 | Reload after logging back in | stays logged in (cookie persists) |

- [ ] **Step 4: Re-verify the local-dev bypass still works**

```bash
# stop the VERCEL=1 server, then:
npm run dev &
sleep 2
curl -si http://localhost:3000/ | head -5   # expect 200, with a fresh Set-Cookie
kill %1
```

- [ ] **Step 5: Re-check at 400px wide**

With `npm run dev` running (any mode), resize the browser to 400px width and confirm:
- The login screen's card stays within the viewport with no horizontal scroll on the page body.
- A building/floor URL's topbar tab strip still scrolls horizontally inside itself (not the whole page) — this behavior predates this plan (world-of-wonders-map plan, Task 10) and should be unaffected; this step just confirms the routing change didn't regress it.

- [ ] **Step 6: Fix anything found, then commit**

If any of the above steps surfaced a bug, fix it and commit the fix with a message describing what was wrong and why. If nothing was found, no commit is needed for this task — the 8 preceding commits already carry the whole feature.
