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
