import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuilding, buildingForSource, ensureBuildings, floorsOf, buildingBySlug } from '../src/server/buildings.js'
import { buildSeed } from '../src/server/seed.js'

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

test('buildSeed produces buildings and every office belongs to one', () => {
  const seed = buildSeed()
  assert.ok(seed.buildings.length > 0, 'seed has buildings')
  for (const office of seed.offices) {
    assert.ok(office.buildingId, `office ${office.slug} has a buildingId`)
    assert.ok(seed.buildings.some((b) => b.id === office.buildingId), 'buildingId resolves')
  }
})
