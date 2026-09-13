// Buildings — the layer above offices. A building holds floors (offices);
// a floor holds agents.
//
// Buildings are ALWAYS hub-owned, even when linked to a connected source:
// the agent-hq/v1 snapshot protocol has no concept of buildings, so nothing
// upstream can overwrite one. `sourceId` is only a link — used to auto-adopt
// that source's floors and for mock/real filtering — never an edit lock.
import { randomUUID } from 'node:crypto'

export const BUILDING_KINDS = ['workspace', 'landmark']
export const BUILDING_SPRITES = ['market', 'lab', 'studio', 'cafe', 'gym', 'library', 'post', 'tower']
export const DEFAULT_SPRITE = 'tower'

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building'

export const buildingBySlug = (world, slug) =>
  world.buildings.find((b) => b.slug === slug || b.id === slug)

export const floorsOf = (world, building) =>
  world.offices.filter((o) => o.buildingId === building.id)

function uniqueSlug(world, base) {
  let slug = slugify(base)
  while (world.buildings.some((b) => b.slug === slug)) slug += '-' + Math.floor(Math.random() * 90 + 10)
  return slug
}

export function createBuilding(world, { name, kind, sprite, theme, description, sourceId = null }) {
  const building = {
    id: randomUUID(),
    slug: uniqueSlug(world, name),
    name: String(name).slice(0, 40),
    kind: BUILDING_KINDS.includes(kind) ? kind : 'workspace',
    sprite: BUILDING_SPRITES.includes(sprite) ? sprite : DEFAULT_SPRITE,
    theme: theme || 'slate',
    description: String(description || '').slice(0, 200),
    sourceId,
    createdAt: Date.now(),
  }
  world.buildings.push(building)
  return building
}

/** The one building that owns a connected source's floors. Created on demand. */
export function buildingForSource(world, src) {
  const existing = world.buildings.find((b) => b.sourceId === src.id)
  if (existing) return existing
  return createBuilding(world, {
    name: src.remoteName || src.name || 'Connected System',
    sprite: 'market',
    theme: 'amber',
    sourceId: src.id,
  })
}

/**
 * Adopt every office that has no buildingId. Idempotent: once each office is
 * adopted this is a no-op, so it is safe to call on every world load.
 * Synced offices go to their source's building; hand-made ones share a single
 * "Head Office".
 */
export function ensureBuildings(world) {
  world.buildings ||= []
  const orphans = world.offices.filter((o) => !o.buildingId)
  if (!orphans.length) return world

  let headOffice = null
  for (const office of orphans) {
    if (office.source) {
      const src = world.sources.find((s) => s.id === office.source)
      if (src) {
        office.buildingId = buildingForSource(world, src).id
        continue
      }
    }
    headOffice ||=
      world.buildings.find((b) => !b.sourceId && b.kind === 'workspace') ||
      createBuilding(world, { name: 'Head Office', sprite: 'tower', theme: 'slate' })
    office.buildingId = headOffice.id
  }
  return world
}
