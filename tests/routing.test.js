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
