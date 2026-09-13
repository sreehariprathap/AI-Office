import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutTown } from '../src/world.js'

const buildings = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, slug: `b-${i}`, name: `B${i}`, kind: 'workspace', sprite: 'tower' }))

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('every building gets exactly one lot', () => {
  const { lots } = layoutTown(buildings(5))
  assert.equal(lots.length, 5)
  assert.equal(new Set(lots.map((l) => l.building.id)).size, 5)
})

test('lots never overlap', () => {
  const { lots } = layoutTown(buildings(9))
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      assert.ok(!overlaps(lots[i], lots[j]), `lot ${i} overlaps lot ${j}`)
    }
  }
})

test('buildings alternate rows so the town stays balanced', () => {
  const { lots } = layoutTown(buildings(4))
  assert.equal(lots.filter((l) => l.row === 0).length, 2)
  assert.equal(lots.filter((l) => l.row === 1).length, 2)
})

test('the canvas grows with the town and never collapses when empty', () => {
  const small = layoutTown(buildings(2))
  const big = layoutTown(buildings(8))
  assert.ok(big.W > small.W, 'wider with more buildings')
  const empty = layoutTown([])
  assert.ok(empty.W > 0 && empty.H > 0, 'an empty town still has a canvas')
  assert.deepEqual(empty.lots, [])
})

test('layout is deterministic for the same buildings', () => {
  assert.deepEqual(layoutTown(buildings(6)), layoutTown(buildings(6)))
})

test('scenery is seeded by the town, so it changes only when the town does', () => {
  const a = layoutTown(buildings(3))
  const b = layoutTown(buildings(3))
  assert.deepEqual(a.scenery, b.scenery)
  const c = layoutTown(buildings(4))
  assert.notDeepEqual(a.scenery, c.scenery)
})
