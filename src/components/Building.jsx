import { useEffect, useMemo, useRef, useState } from 'react'
import { themeOf, lookOf, STATUS_COLORS, deskLabel } from '../world.js'
import { Person, Plant } from '../sprites.jsx'

// One tower, cut away: every office (domain) is a floor. Floor 1 sits on the lobby, new floors stack on top.
// The elevator shaft is the building's backbone — messages between floors ride it.

const W = 1040
const BX = 150 // building left edge
const BW = 760 // building width
const WALL = 14 // outer wall thickness
const SHAFT_W = 64
const SUITE_W = 150
const CELL_W = 60
const ROW_H = 54
const BAND_H = 30 // back wall with windows
const SLAB = 8
const LOBBY_H = 120
const ROOF_H = 96
const GROUND_PAD = 70

const SCREEN = { working: '#79e0a0', idle: '#2f5a7a', meeting: '#7fb4ff', error: '#ff5d5d', offline: '#1b1f24' }

function layout(offices, agents) {
  const innerX = BX + WALL
  const shaftX = BX + BW - WALL - SHAFT_W
  const deskX = innerX + SUITE_W + 18
  const perRow = Math.max(1, Math.floor((shaftX - 12 - deskX) / CELL_W))
  const byOffice = Object.fromEntries(offices.map((o) => [o.id, []]))
  agents.forEach((a) => byOffice[a.officeId]?.push(a))

  // Heights first (bottom-up order), then y positions top-down.
  const floors = offices.map((o, i) => {
    const list = byOffice[o.id]
    const bosses = list.filter((a) => a.role === 'boss')
    const workers = list.filter((a) => a.role !== 'boss')
    const rows = Math.max(1, Math.ceil(workers.length / perRow))
    return { office: o, number: i + 1, bosses, workers, rows, h: BAND_H + rows * ROW_H + 14 + SLAB }
  })
  const floorsH = floors.reduce((s, f) => s + f.h, 0)
  const top = 60 + ROOF_H
  let y = top + floorsH
  for (const f of floors) {
    y -= f.h
    f.y = y
  }
  const lobbyY = top + floorsH
  const H = lobbyY + LOBBY_H + GROUND_PAD
  return { floors, innerX, shaftX, deskX, perRow, top, lobbyY, H, byOffice }
}

function FloorView({ f, L, onOpen, onSelectAgent, buzz }) {
  const t = themeOf(f.office)
  const { innerX, shaftX, deskX, perRow } = L
  const innerW = shaftX - innerX
  const floorY = f.y + BAND_H
  const errors = [...f.bosses, ...f.workers].filter((a) => a.status === 'error').length
  const online = [...f.bosses, ...f.workers].filter((a) => a.status !== 'offline').length
  const total = f.bosses.length + f.workers.length
  const boss = f.bosses[0]

  return (
    <g className={`bfloor ${buzz ? 'buzz' : ''}`} onClick={() => onOpen(f.office.id)}>
      {/* back wall + windows */}
      <rect x={innerX} y={f.y} width={innerW} height={BAND_H} fill="#e9e1c9" />
      <rect x={innerX} y={f.y + BAND_H - 6} width={innerW} height={6} fill={t.wall} />
      {Array.from({ length: Math.floor(innerW / 110) }).map((_, i) => (
        <g key={i} transform={`translate(${innerX + 40 + i * 110},${f.y + 4})`}>
          <rect width={44} height={18} fill="#cfc6ad" />
          <rect x={2} y={2} width={40} height={14} fill="#7fc4ec" />
          <rect x={4} y={3} width={5} height={12} fill="#b8e2fa" />
          <rect x={21} y={2} width={2} height={14} fill="#cfc6ad" />
        </g>
      ))}
      {/* floor */}
      <rect x={innerX} y={floorY} width={innerW} height={f.h - BAND_H - SLAB} fill={t.floor} />
      <rect x={innerX} y={floorY} width={innerW} height={f.h - BAND_H - SLAB} fill={`url(#tex-${f.office.floor || 'carpet'})`} />

      {/* boss suite behind glass */}
      <rect x={innerX} y={floorY} width={SUITE_W} height={f.h - BAND_H - SLAB} fill="#6b3a34" opacity={0.85} />
      <rect x={innerX + SUITE_W} y={floorY} width={4} height={f.h - BAND_H - SLAB} fill="#a8d8f0" opacity={0.55} />
      <rect x={innerX + 20} y={floorY + 22} width={SUITE_W - 40} height={f.h - BAND_H - SLAB - 34} fill={t.rug} opacity={0.8} />
      {boss ? (
        <g
          className="bagent"
          onClick={(e) => (e.stopPropagation(), onSelectAgent(boss.id))}
          transform={`translate(${innerX + SUITE_W / 2 - 12},${floorY + 4})`}
        >
          <title>{`${boss.name} — ${boss.status}${boss.task ? `\n${boss.task}` : ''}`}</title>
          {/* shapeRendering="auto" overrides the whole building svg's
              crispEdges (right for the blocky furniture/walls, wrong for
              Person's circles and curves -- crispEdges aliases them). */}
          <g transform="scale(1.5)" shapeRendering="auto" opacity={boss.status === 'offline' ? 0.3 : 1}>
            <Person look={lookOf(boss)} seated typing={boss.status === 'working'} />
          </g>
          <rect x={-14} y={16} width={52} height={12} fill="#9a6a3f" />
          <rect x={20} y={8} width={12} height={9} fill="#c9ccd1" />
          <rect x={21} y={9} width={10} height={7} fill={SCREEN[boss.status]} className={boss.status === 'working' ? 'screen-glow' : ''} />
        </g>
      ) : (
        <text x={innerX + SUITE_W / 2} y={floorY + 34} textAnchor="middle" className="tag light">
          no boss
        </text>
      )}
      <Plant x={innerX + 6} y={floorY + f.h - BAND_H - SLAB - 20} />

      {/* workers */}
      {f.workers.map((a, i) => {
        const x = deskX + (i % perRow) * CELL_W
        const y = floorY + 4 + Math.floor(i / perRow) * ROW_H
        return (
          <g key={a.id} className="bagent" transform={`translate(${x},${y})`} onClick={(e) => (e.stopPropagation(), onSelectAgent(a.id))}>
            <title>{`${a.name}${a.title ? ` (${a.title})` : ''} — ${a.status}${a.task ? `\n${a.task}` : ''}`}</title>
            <g transform="translate(10,0) scale(1.5)" shapeRendering="auto" opacity={a.status === 'offline' ? 0.25 : a.status === 'idle' ? 0.7 : 1}>
              <Person look={lookOf(a)} seated typing={a.status === 'working'} />
            </g>
            <rect x={4} y={18} width={42} height={10} fill="#9a6a3f" />
            <rect x={4} y={18} width={42} height={2} fill="#b98452" />
            <rect x={30} y={10} width={12} height={9} fill="#c9ccd1" />
            <rect x={31} y={11} width={10} height={7} fill={SCREEN[a.status]} className={a.status === 'working' ? 'screen-glow' : ''} />
            <circle cx={6} cy={37} r={2.5} fill={STATUS_COLORS[a.status]} shapeRendering="auto" />
            <text x={11} y={40} className="tag light tiny">
              {deskLabel(a, 9)}
            </text>
          </g>
        )
      })}
      {!total && (
        <text x={deskX} y={floorY + 30} className="tag light">
          empty floor
        </text>
      )}

      {/* slab */}
      <rect x={BX} y={f.y + f.h - SLAB} width={BW} height={SLAB} fill="#8a8f96" />
      <rect x={BX} y={f.y + f.h - SLAB} width={BW} height={2} fill="#b3b8bf" />

      {/* floor plaque, outside the left wall */}
      <g transform={`translate(${BX - 136},${f.y + 8})`}>
        <rect width={124} height={f.h - SLAB - 16} fill="#1f1814" stroke={t.accent} strokeWidth={2} />
        <rect width={8} height={f.h - SLAB - 16} fill={t.wall} />
        <text x={18} y={20} className="plaque-num" style={{ fill: t.accent }}>
          F{f.number}
        </text>
        <text x={18} y={36} className="plaque-name">
          {f.office.name.toUpperCase().slice(0, 16)}
        </text>
        <text x={18} y={52} className="tag light">
          {online}/{total} online
        </text>
        {errors > 0 && (
          <text x={18} y={66} className="tag" style={{ fill: '#ff5d5d' }}>
            ! {errors} need attention
          </text>
        )}
        {f.office.external && (
          <text x={112} y={20} textAnchor="end" className="tag" style={{ fill: '#7fb4ff' }}>
            ⇅
          </text>
        )}
      </g>
    </g>
  )
}

export default function Building({ offices, agents, messages, onOpen, onSelectAgent, onAddFloor, addLabel, title, zoom }) {
  const L = useMemo(() => layout(offices, agents), [offices, agents])
  const floorOf = useMemo(() => {
    const map = {}
    for (const f of L.floors) for (const a of [...f.bosses, ...f.workers]) map[a.id] = f
    return map
  }, [L])

  // Live traffic: messages between floors ride the elevator; same-floor chatter lights the floor up.
  const [packets, setPackets] = useState([])
  const [buzz, setBuzz] = useState({})
  const [car, setCar] = useState(null)
  const seen = useRef(null)
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id))
      return
    }
    const fresh = messages.filter((m) => !seen.current.has(m.id))
    fresh.forEach((m) => seen.current.add(m.id))
    const now = Date.now()
    const add = []
    const lit = {}
    let last = null
    for (const m of fresh) {
      const a = floorOf[m.from]
      const b = floorOf[m.to]
      if (a) lit[a.office.id] = now
      if (b) lit[b.office.id] = now
      if (a && b && a !== b) {
        const x = L.shaftX + SHAFT_W / 2
        add.push({ id: m.id, d: `M${x},${a.y + a.h / 2} L${x},${b.y + b.h / 2}`, born: now })
        last = b
      } else if (a || b) last = a || b
    }
    if (add.length) setPackets((s) => [...s, ...add])
    if (Object.keys(lit).length) setBuzz((s) => ({ ...s, ...lit }))
    if (last) setCar(last.office.id)
  }, [messages])
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setPackets((s) => (s.length ? s.filter((p) => now - p.born < 1600) : s))
      setBuzz((s) => {
        const keep = Object.entries(s).filter(([, ts]) => now - ts < 1800)
        return keep.length === Object.keys(s).length ? s : Object.fromEntries(keep)
      })
    }, 500)
    return () => clearInterval(t)
  }, [])

  const carFloor = L.floors.find((f) => f.office.id === car)
  const carY = carFloor ? carFloor.y + carFloor.h - SLAB - 46 : L.lobbyY + LOBBY_H - 50
  const busy = Object.keys(buzz).length > 0
  const roofY = L.top - ROOF_H
  const H = L.H

  return (
    <svg className="building" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} shapeRendering="crispEdges">
      <defs>
        {/* Warm dusk instead of a flat cool night -- the "diorama" read
            (Link's Awakening remake style) leans on a warm light source
            and soft depth, not a uniform dark backdrop. */}
        <linearGradient id="bsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1a3a" />
          <stop offset="0.55" stopColor="#3a3466" />
          <stop offset="0.8" stopColor="#8a5a72" />
          <stop offset="1" stopColor="#e8a668" />
        </linearGradient>
        <radialGradient id="moonglow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9b8" stopOpacity="0.9" />
          <stop offset="0.6" stopColor="#ffd88a" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffd88a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vignette" cx="0.5" cy="0.42" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
        {/* Soft depth-of-field on the far background only -- the building
            itself (and everyone in it) stays crisp, same trick a tilt-
            shift diorama shot uses to read as "miniature and cozy." */}
        <filter id="soft-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <pattern id="tex-carpet" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect x="4" y="7" width="1" height="1" fill="#000" opacity=".25" />
          <rect x="9" y="2" width="1" height="1" fill="#fff" opacity=".08" />
        </pattern>
        <pattern id="tex-tile" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 0H16V1H1V16H0Z" fill="#000" opacity=".15" />
        </pattern>
        <pattern id="tex-checker" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#fff" opacity=".06" />
          <rect x="8" y="8" width="8" height="8" fill="#fff" opacity=".06" />
        </pattern>
        <pattern id="tex-wood" width="24" height="8" patternUnits="userSpaceOnUse">
          <rect y="7" width="24" height="1" fill="#000" opacity=".2" />
          <rect x="11" width="1" height="8" fill="#000" opacity=".12" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill="url(#bsky)" />
      <g filter="url(#soft-blur)">
        <circle cx={W * 0.78} cy={H * 0.16} r={140} fill="url(#moonglow)" />
        <circle cx={W * 0.78} cy={H * 0.16} r={26} fill="#fff6de" opacity={0.9} />
        {Array.from({ length: 50 }).map((_, i) => (
          <rect key={i} x={(i * 131) % W} y={(i * 71) % Math.max(200, H - 300)} width={2} height={2} fill="#fff" opacity={0.25 + ((i * 7) % 5) / 10} className={i % 5 === 0 ? 'twinkle' : ''} />
        ))}
        {/* distant skyline on both sides */}
        {Array.from({ length: Math.ceil(W / 36) }).map((_, i) => {
          const h = 60 + ((i * 53) % 160)
          const x = i * 36
          if (x > BX - 30 && x < BX + BW) return null
          return <rect key={i} x={x} y={H - GROUND_PAD - h} width={34} height={h} fill="#2a2450" />
        })}
      </g>

      {/* roof */}
      <g>
        <rect x={BX - 8} y={L.top - 12} width={BW + 16} height={12} fill="#3a3f47" />
        <rect x={BX + 40} y={roofY + 30} width={120} height={36} fill="#efe6cf" stroke="#3a2a1a" strokeWidth={3} />
        <text x={BX + 100} y={roofY + 54} textAnchor="middle" className="roof-sign">
          {title}
        </text>
        <rect x={BX + 95} y={roofY + 66} width={4} height={18} fill="#6e4a2b" />
        {/* water tank */}
        <rect x={BX + 230} y={roofY + 40} width={40} height={32} fill="#8a5a3b" />
        <rect x={BX + 230} y={roofY + 46} width={40} height={3} fill="#5a3c22" />
        <rect x={BX + 236} y={roofY + 72} width={4} height={12} fill="#5a3c22" />
        <rect x={BX + 260} y={roofY + 72} width={4} height={12} fill="#5a3c22" />
        {/* antenna over the shaft blinks with traffic */}
        <rect x={L.shaftX + SHAFT_W / 2 - 2} y={roofY + 8} width={4} height={76} fill="#9aa0a8" />
        <rect x={L.shaftX + SHAFT_W / 2 - 6} y={roofY + 2} width={12} height={8} fill={busy ? '#ff8ad8' : '#555'} className={busy ? 'blink' : ''} />
        {/* crane: add a floor */}
        <g className="crane" onClick={onAddFloor}>
          <rect x={BX + 420} y={roofY - 4} width={6} height={88} fill="#e9b949" />
          <rect x={BX + 380} y={roofY - 4} width={170} height={6} fill="#e9b949" />
          <rect x={BX + 540} y={roofY + 2} width={2} height={34} fill="#9aa0a8" />
          <rect x={BX + 470} y={roofY + 36} width={140} height={26} fill="#efe6cf" stroke="#3a2a1a" strokeWidth={2} />
          <text x={BX + 540} y={roofY + 54} textAnchor="middle" className="sign big">
            {addLabel}
          </text>
        </g>
      </g>

      {/* outer walls */}
      <rect x={BX} y={L.top} width={WALL} height={L.lobbyY + LOBBY_H - L.top} fill="#4a4f57" />
      <rect x={BX + BW - WALL} y={L.top} width={WALL} height={L.lobbyY + LOBBY_H - L.top} fill="#4a4f57" />

      {L.floors.map((f) => (
        <FloorView key={f.office.id} f={f} L={L} onOpen={onOpen} onSelectAgent={onSelectAgent} buzz={!!buzz[f.office.id]} />
      ))}

      {/* elevator shaft */}
      <rect x={L.shaftX} y={L.top} width={SHAFT_W} height={L.lobbyY + LOBBY_H - L.top} fill="#20242c" />
      <rect x={L.shaftX + 6} y={L.top} width={2} height={L.lobbyY + LOBBY_H - L.top} fill="#3a3f47" />
      <rect x={L.shaftX + SHAFT_W - 8} y={L.top} width={2} height={L.lobbyY + LOBBY_H - L.top} fill="#3a3f47" />
      {L.floors.map((f) => (
        <g key={'door' + f.office.id}>
          <rect x={L.shaftX} y={f.y + f.h - SLAB} width={SHAFT_W} height={SLAB} fill="#8a8f96" />
          <rect x={L.shaftX - 3} y={f.y + f.h - SLAB - 44} width={3} height={44} fill="#c9ccd1" />
        </g>
      ))}
      <g className="car" style={{ transform: `translate(${L.shaftX + 10}px, ${carY}px)` }}>
        <rect width={SHAFT_W - 20} height={44} fill="#c9ccd1" />
        <rect x={3} y={4} width={SHAFT_W - 26} height={36} fill="#8a9099" />
        <rect x={(SHAFT_W - 20) / 2 - 1} y={4} width={2} height={36} fill="#5b6069" />
        <rect x={(SHAFT_W - 20) / 2 - 4} y={-6} width={8} height={6} fill="#5b6069" />
      </g>
      <g shapeRendering="auto">
        {packets.map((p) => (
          <circle key={p.id} r={6} className="packet" style={{ offsetPath: `path('${p.d}')` }} />
        ))}
      </g>

      {/* lobby */}
      <g>
        <rect x={BX + WALL} y={L.lobbyY} width={L.shaftX - BX - WALL} height={LOBBY_H} fill="#d9d2bd" />
        <rect x={BX + WALL} y={L.lobbyY + LOBBY_H - 40} width={L.shaftX - BX - WALL} height={40} fill="#8f8a7a" />
        <rect x={BX + WALL} y={L.lobbyY + LOBBY_H - 40} width={L.shaftX - BX - WALL} height={3} fill="#6e6a5d" />
        <text x={BX + 40} y={L.lobbyY + 26} className="sign big">
          LOBBY
        </text>
        {/* reception: you */}
        <g transform={`translate(${BX + 60},${L.lobbyY + 44})`}>
          <rect width={110} height={30} fill="#6e4a2b" />
          <rect width={110} height={5} fill="#9a6a3f" />
          <rect x={40} y={-26} width={34} height={24} fill="#20242c" stroke="#79e0a0" />
          <rect x={44} y={-22} width={20} height={3} fill="#79e0a0" className="screen-glow" />
          <text x={55} y={22} textAnchor="middle" className="tag light">
            YOU
          </text>
        </g>
        {/* glass doors */}
        <g transform={`translate(${(BX + L.shaftX) / 2 - 40},${L.lobbyY + 30})`}>
          <rect width={80} height={LOBBY_H - 30} fill="#3a3f47" />
          <rect x={4} y={4} width={34} height={LOBBY_H - 34} fill="#a8d8f0" opacity={0.7} />
          <rect x={42} y={4} width={34} height={LOBBY_H - 34} fill="#a8d8f0" opacity={0.7} />
        </g>
        <Plant x={L.shaftX - 40} y={L.lobbyY + LOBBY_H - 56} s={1.6} />
        <text x={L.shaftX - 150} y={L.lobbyY + 26} className="tag">
          {offices.length} floor{offices.length === 1 ? '' : 's'} · {agents.length} agents
        </text>
      </g>

      {/* street */}
      <rect y={L.lobbyY + LOBBY_H} width={W} height={GROUND_PAD} fill="#2b2f36" />
      <rect y={L.lobbyY + LOBBY_H} width={W} height={6} fill="#6e6a5d" />
      {Array.from({ length: Math.ceil(W / 48) }).map((_, i) => (
        <rect key={i} x={i * 48 + 12} y={L.lobbyY + LOBBY_H + 34} width={24} height={3} fill="#e9d36b" opacity={0.6} />
      ))}

      {/* Painted-corner vignette, drawn last so it frames the whole
          scene -- the other half of the diorama read alongside the
          background blur above. pointer-events:none so it never eats a
          click meant for a desk/floor underneath it. */}
      <rect width={W} height={H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  )
}
