import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createBuilding, buildingForSource, ensureBuildings, floorsOf, buildingBySlug, buildingSummary, canBecomeLandmark,
  resolveBuilding,
} from '../src/server/buildings.js'
import { buildSeed } from '../src/server/seed.js'
import { applySnapshot, purgeSource } from '../src/server/sources.js'

const emptyWorld = (over = {}) => ({ buildings: [], offices: [], agents: [], sources: [], ...over })

test('createBuilding defaults to a workspace with a unique slug', () => {
  const world = emptyWorld()
  const a = createBuilding(world, { name: 'Financial Market' })
  const b = createBuilding(world, { name: 'Financial Market' })
  assert.equal(a.kind, 'workspace')
  assert.equal(a.slug, 'financial-market')
  assert.notEqual(b.slug, a.slug, 'second building with the same name gets a distinct slug')
  assert.equal(world.buildings.length, 2)
})

test('createBuilding rejects unknown kind and sprite by falling back', () => {
  const world = emptyWorld()
  const b = createBuilding(world, { name: 'X', kind: 'nonsense', sprite: 'nonsense' })
  assert.equal(b.kind, 'workspace')
  assert.equal(b.sprite, 'tower')
})

test('buildingForSource creates one building per source and reuses it', () => {
  const world = emptyWorld({ sources: [{ id: 'src-1', name: 'Workforce', remoteName: "Sreehari's AI Workforce" }] })
  const first = buildingForSource(world, world.sources[0])
  const second = buildingForSource(world, world.sources[0])
  assert.equal(first.id, second.id)
  assert.equal(first.name, "Sreehari's AI Workforce")
  assert.equal(first.sourceId, 'src-1')
  assert.equal(world.buildings.length, 1)
})

test('ensureBuildings adopts synced offices into their source building', () => {
  const world = emptyWorld({
    sources: [{ id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }],
    offices: [{ id: 'o1', slug: 'crypto', external: true, source: 'src-1' }],
  })
  ensureBuildings(world)
  const building = world.buildings.find((b) => b.sourceId === 'src-1')
  assert.ok(building, 'source building created')
  assert.equal(world.offices[0].buildingId, building.id)
})

test('ensureBuildings puts hand-made offices in one shared Head Office', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }, { id: 'o2', slug: 'b' }] })
  ensureBuildings(world)
  assert.equal(world.buildings.length, 1)
  assert.equal(world.buildings[0].name, 'Head Office')
  assert.equal(world.offices[0].buildingId, world.offices[1].buildingId)
})

test('ensureBuildings is idempotent', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const snapshot = JSON.stringify(world)
  ensureBuildings(world)
  ensureBuildings(world)
  assert.equal(JSON.stringify(world), snapshot, 'repeat runs change nothing')
})

test('floorsOf and buildingBySlug read back what was written', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const b = buildingBySlug(world, world.buildings[0].slug)
  assert.equal(floorsOf(world, b).length, 1)
  assert.equal(buildingBySlug(world, 'nope'), undefined)
})

test('buildingSummary rolls floor and agent counts up from offices', () => {
  const world = emptyWorld({
    offices: [{ id: 'o1', slug: 'a', name: 'A', theme: 'teal' }, { id: 'o2', slug: 'b', name: 'B', theme: 'teal' }],
    agents: [
      { id: 'a1', officeId: 'o1', status: 'working' },
      { id: 'a2', officeId: 'o1', status: 'error' },
      { id: 'a3', officeId: 'o2', status: 'offline' },
    ],
  })
  ensureBuildings(world)
  const view = buildingSummary(world, world.buildings[0])
  assert.equal(view.numberOfFloors, 2)
  assert.equal(view.numberOfAgents, 3)
  assert.equal(view.online, 2, 'offline agents are not online')
  assert.equal(view.stats.error, 1)
  assert.equal(view.floors[0].numberOfAgents, 2)
})

test('a populated workspace cannot become a landmark; an empty one can', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  const populated = world.buildings[0]
  assert.equal(canBecomeLandmark(world, populated), false)

  const empty = createBuilding(world, { name: 'Gym', sprite: 'gym' })
  assert.equal(canBecomeLandmark(world, empty), true)
})

test('resolveBuilding falls back to the only workspace when no slug is given', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  assert.equal(resolveBuilding(world, undefined).building.id, world.buildings[0].id)
})

test('resolveBuilding demands a slug once there are several workspaces', () => {
  const world = emptyWorld({ offices: [{ id: 'o1', slug: 'a' }] })
  ensureBuildings(world)
  createBuilding(world, { name: 'Research Lab', sprite: 'lab' })
  assert.match(resolveBuilding(world, undefined).error, /buildingSlug required/)
})

test('resolveBuilding refuses landmarks and unknown slugs', () => {
  const world = emptyWorld()
  const cafe = createBuilding(world, { name: 'Cafe', kind: 'landmark', sprite: 'cafe' })
  assert.match(resolveBuilding(world, cafe.slug).error, /landmark/)
  assert.match(resolveBuilding(world, 'nope').error, /not found/)
})

test('buildSeed produces buildings and every office belongs to one', () => {
  const seed = buildSeed()
  assert.ok(seed.buildings.length > 0, 'seed has buildings')
  for (const office of seed.offices) {
    assert.ok(office.buildingId, `office ${office.slug} has a buildingId`)
    assert.ok(seed.buildings.some((b) => b.id === office.buildingId), 'buildingId resolves')
  }
})

const snapshot = (offices) => ({
  protocol: 'agent-hq/v1',
  source: { id: 'ai-workforce', name: 'Workforce' },
  offices,
  messages: [],
})

test('applySnapshot puts every synced office in the source building', () => {
  const world = { buildings: [], offices: [], agents: [], connections: [], messages: [], sources: [] }
  const src = { id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }
  world.sources.push(src)
  applySnapshot(world, src, snapshot([
    { slug: 'crypto', name: 'Crypto Desk', agents: [], connections: [] },
    { slug: 'india', name: 'India Desk', agents: [], connections: [] },
  ]))
  const building = world.buildings.find((b) => b.sourceId === 'src-1')
  assert.ok(building)
  assert.equal(floorsOf(world, building).length, 2)
})

test('purgeSource removes the source building when nothing hand-made is left', () => {
  const world = { buildings: [], offices: [], agents: [], connections: [], messages: [], sources: [] }
  const src = { id: 'src-1', name: 'Workforce', remoteName: 'Workforce' }
  world.sources.push(src)
  applySnapshot(world, src, snapshot([{ slug: 'crypto', name: 'Crypto Desk', agents: [], connections: [] }]))
  purgeSource(world, src)
  assert.equal(world.buildings.filter((b) => b.sourceId === 'src-1').length, 0)
  assert.equal(world.offices.length, 0)
})
