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
