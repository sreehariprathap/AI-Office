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
