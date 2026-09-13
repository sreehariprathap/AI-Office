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
// when *simulating* a deployment locally for testing, where the host can
// look non-local but the connection is still plain HTTP.
export const isHttps = (req) => new URL(req.url).protocol === 'https:'
