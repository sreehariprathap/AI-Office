// Palettes, seeded looks, and the floor-plan layout engine.
// The floor grows with the team: more workers -> more desk rows, more bosses -> more suites.

export const THEMES = {
  emerald: { wall: '#3d6b52', trim: '#2a4a39', floor: '#2f4a3b', floor2: '#35523f', accent: '#79e0a0', rug: '#7a3b33' },
  cobalt: { wall: '#3a5a8c', trim: '#26406a', floor: '#34466b', floor2: '#3a4e76', accent: '#7fb4ff', rug: '#2f3f63' },
  crimson: { wall: '#9c3c3c', trim: '#6e2626', floor: '#4a4560', floor2: '#544e6c', accent: '#ff8a7a', rug: '#5b2a2a' },
  amber: { wall: '#c89a3a', trim: '#8a6420', floor: '#56606a', floor2: '#5e6973', accent: '#ffd36b', rug: '#6b4a1f' },
  violet: { wall: '#6a4a9c', trim: '#46306e', floor: '#3f3a58', floor2: '#474163', accent: '#c7a2ff', rug: '#3b2a5c' },
  teal: { wall: '#2f8a86', trim: '#1f5e5b', floor: '#2d5452', floor2: '#335c5a', accent: '#6ff0e0', rug: '#1f4745' },
  slate: { wall: '#5d6673', trim: '#3f4650', floor: '#3b4048', floor2: '#434952', accent: '#c9d4e0', rug: '#2e333a' },
  rose: { wall: '#b0587a', trim: '#7a3a55', floor: '#4b4050', floor2: '#544858', accent: '#ffa3c8', rug: '#5e2f45' },
}
export const themeOf = (office) => THEMES[office?.theme] || THEMES.emerald

export const STATUS_COLORS = {
  working: '#5ee08a',
  idle: '#f2c14e',
  meeting: '#7fb4ff',
  error: '#ff5d5d',
  offline: '#6b7280',
}

const SKIN = ['#f5d0a9', '#e8b58c', '#c68a5a', '#8d5a3b', '#5e3a24', '#f0c8a0']
const HAIR = ['#2b1d14', '#5a3a1e', '#a0522d', '#d9b35b', '#1a1a1a', '#8a8a8a', '#c0392b', '#3b2f5c']
const SHIRT = ['#e8e8e8', '#4a78c2', '#c24a4a', '#4aa36b', '#d9a441', '#7a5ac2', '#3a9aa3', '#d46aa0']
const PANTS = ['#2f3542', '#3b3b58', '#4a3b2f', '#2b3a4a']

export function hash(str = '') {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

export function lookOf(agent) {
  const h = hash(agent.id + agent.name)
  const boss = agent.role === 'boss'
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >> 4) % HAIR.length],
    shirt: boss ? '#e8e8e8' : SHIRT[(h >> 8) % SHIRT.length],
    jacket: boss ? '#2f3542' : null,
    pants: PANTS[(h >> 12) % PANTS.length],
    style: (h >> 16) % 3, // 0 short, 1 long, 2 bun
    tie: boss ? '#c0392b' : (h >> 20) % 4 === 0 ? '#2b4a7a' : null,
  }
}

// ---------------------------------------------------------------- layout
const PAD = 12
const TOP_H = 170
const CORRIDOR_H = 64
const SUITE_W = 170
const MEET_W = 230
const BREAK_W = 190
const CELL_W = 74
const CELL_H = 76

export function layoutFloor(office, agents) {
  const bosses = agents.filter((a) => a.role === 'boss')
  const workers = agents.filter((a) => a.role !== 'boss')

  const suites = Math.max(1, bosses.length)
  const topW = PAD * 2 + suites * SUITE_W + MEET_W + BREAK_W
  // Synced offices are managed by their source, so there is no open seat to hire into.
  const seats = workers.length + (office?.external ? 0 : 1)
  const wantCols = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(seats * 2.2))))
  const W = Math.max(topW, PAD * 2 + wantCols * CELL_W + 24)
  const cols = Math.floor((W - PAD * 2 - 24) / CELL_W)
  const rows = Math.max(1, Math.ceil(seats / cols))
  const workY = PAD + TOP_H + CORRIDOR_H
  const workH = 44 + rows * CELL_H + 18
  const H = workY + workH + PAD

  const rooms = []
  let x = PAD
  for (let i = 0; i < suites; i++) {
    rooms.push({ kind: 'suite', x, y: PAD, w: SUITE_W, h: TOP_H, boss: bosses[i] || null })
    x += SUITE_W
  }
  const meet = { kind: 'meeting', x, y: PAD, w: MEET_W, h: TOP_H }
  rooms.push(meet)
  x += MEET_W
  const brk = { kind: 'break', x, y: PAD, w: W - PAD - x, h: TOP_H }
  rooms.push(brk)
  const work = { kind: 'work', x: PAD, y: workY, w: W - PAD * 2, h: workH, cols, rows }
  rooms.push(work)
  const corridor = { x: PAD, y: PAD + TOP_H, w: W - PAD * 2, h: CORRIDOR_H }

  // desks: every worker gets a seat, plus one open seat to "hire" into.
  const gridW = cols * CELL_W
  const gx = work.x + (work.w - gridW) / 2
  const desks = []
  for (let i = 0; i < seats; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    desks.push({ x: gx + c * CELL_W, y: work.y + 40 + r * CELL_H, agent: workers[i] || null })
  }

  // meeting seats around a table, idle spots in the break room
  const tableX = meet.x + 45
  const tableY = meet.y + 78
  const tableW = meet.w - 90
  const meetSpots = []
  const perSide = 4
  for (let i = 0; i < perSide; i++) meetSpots.push({ x: tableX + 8 + i * ((tableW - 16) / (perSide - 1)) - 8, y: tableY - 26, seated: true })
  for (let i = 0; i < perSide; i++) meetSpots.push({ x: tableX + 8 + i * ((tableW - 16) / (perSide - 1)) - 8, y: tableY + 22, seated: false })
  for (let i = 0; i < 6; i++) meetSpots.push({ x: meet.x + 14 + i * 34, y: meet.y + meet.h - 30, seated: false })

  const breakSpots = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) breakSpots.push({ x: brk.x + 20 + c * 30 + (r % 2) * 14, y: brk.y + 60 + r * 34, seated: false })

  const portal = { x: W - PAD - 40, y: corridor.y + 8 } // elevator to other offices
  const console_ = { x: PAD + 8, y: corridor.y + 8 } // the hub (you)

  // resolve a position for every agent
  const pos = {}
  const place = (spots, i, fallback) => spots[i] || { ...fallback, x: fallback.x + (i % 6) * 18, y: fallback.y }
  let mi = 0
  let bi = 0
  const deskOf = new Map(desks.filter((d) => d.agent).map((d) => [d.agent.id, d]))
  const suiteOf = new Map(rooms.filter((r) => r.boss).map((r) => [r.boss.id, r]))
  for (const a of agents) {
    const home = a.role === 'boss' ? suiteOf.get(a.id) : deskOf.get(a.id)
    const homePos = a.role === 'boss' ? { x: home.x + home.w / 2 - 8, y: home.y + 60, seated: true } : { x: home.x + CELL_W / 2 - 8, y: home.y + 6, seated: true }
    let p
    if (a.status === 'meeting') p = place(meetSpots, mi++, { x: meet.x + 20, y: meet.y + meet.h - 34 })
    else if (a.status === 'idle') p = place(breakSpots, bi++, { x: brk.x + 20, y: brk.y + 130 })
    else p = homePos
    pos[a.id] = { ...p, home: homePos, away: a.status === 'offline' }
  }

  return { W, H, rooms, corridor, desks, pos, portal, console: console_, table: { x: tableX, y: tableY, w: tableW, h: 22 }, CELL_W, CELL_H }
}

export const timeAgo = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n ?? 0))

// Label that fits a desk tag: a source-provided shortName, else the name clipped to ~12 characters.
export const deskLabel = (agent, max = 12) => {
  const n = agent.shortName || agent.name || ''
  return n.length > max ? n.slice(0, max - 1) + '…' : n
}
