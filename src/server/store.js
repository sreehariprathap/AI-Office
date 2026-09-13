// Persistence for the hub's world state — one JSON document, read and written per request.
//
// Drivers, picked from the environment:
//   redis  — Upstash Redis over its REST API (Vercel's KV integration sets KV_REST_API_URL/KV_REST_API_TOKEN).
//            Writes are compare-and-set on a version counter, so two serverless invocations can't clobber each other.
//   file   — data/hub.json, for local `next dev` / `next start`. Requests are serialized in-process.
//   memory — fallback on Vercel with no Redis configured. Works, but resets whenever the function instance recycles;
//            the UI shows a banner so this is never mistaken for real persistence.
import fs from 'node:fs/promises'
import path from 'node:path'

const KEY = process.env.HUB_STORE_KEY || 'agenthq:world'
const VERSION_KEY = `${KEY}:version`

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const storageKind = redisUrl && redisToken ? 'redis' : process.env.VERCEL ? 'memory' : 'file'

export class Conflict extends Error {}

// ---------------------------------------------------------------- redis (Upstash REST)
async function redis(command) {
  const r = await fetch(redisUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.error) throw new Error(`redis: ${body.error || r.status}`)
  return body.result
}

// Set both keys only if the version is still the one we read.
const CAS = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[3])
  redis.call('SET', KEYS[2], ARGV[2])
  return 1
end
return 0`

const redisDriver = {
  async read() {
    const [raw, version] = await redis(['MGET', KEY, VERSION_KEY])
    return { world: raw ? JSON.parse(raw) : null, version: Number(version || 0) }
  },
  async write(world, version) {
    const ok = await redis(['EVAL', CAS, '2', KEY, VERSION_KEY, String(version), String(version + 1), JSON.stringify(world)])
    if (ok !== 1) throw new Conflict('world changed underneath this request')
    return version + 1
  },
}

// ---------------------------------------------------------------- file
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'hub.json')

const fileDriver = {
  async read() {
    try {
      const world = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))
      return { world, version: Number(world.version || 0) }
    } catch {
      return { world: null, version: 0 }
    }
  },
  async write(world, version) {
    const next = version + 1
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
    const tmp = `${DATA_FILE}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ ...world, version: next }, null, 2))
    await fs.rename(tmp, DATA_FILE)
    return next
  },
}

// ---------------------------------------------------------------- memory
const mem = (globalThis.__agentHqMemory ||= { world: null, version: 0 })
const memoryDriver = {
  async read() {
    return { world: mem.world && structuredClone(mem.world), version: mem.version }
  },
  async write(world, version) {
    if (version !== mem.version) throw new Conflict('world changed underneath this request')
    mem.world = structuredClone(world)
    return ++mem.version
  },
}

const driver = { redis: redisDriver, file: fileDriver, memory: memoryDriver }[storageKind]

// One request at a time per process (file + memory rely on this; it also cuts redis conflicts on warm instances).
const lock = (globalThis.__agentHqLock ||= { tail: Promise.resolve() })
function serialize(fn) {
  const run = lock.tail.then(fn, fn)
  lock.tail = run.catch(() => {})
  return run
}

const withoutVersion = ({ version, ...rest }) => rest

/**
 * Load the world, let `fn` read/mutate it, persist it if it changed.
 * `fn` may run more than once on a write conflict, so it must only touch the world it's given.
 * Returns whatever `fn` returns, plus the resulting version.
 */
export function withWorld(init, fn, { retries = 4 } = {}) {
  return serialize(async () => {
    for (let attempt = 0; ; attempt++) {
      const { world: stored, version } = await driver.read()
      const before = stored ? JSON.stringify(withoutVersion(stored)) : ''
      const world = init(stored)
      const result = await fn(world)
      const clean = withoutVersion(world)
      if (JSON.stringify(clean) === before) return { result, version }
      try {
        const next = await driver.write(clean, version)
        return { result, version: next }
      } catch (err) {
        if (!(err instanceof Conflict) || attempt >= retries) throw err
      }
    }
  })
}
