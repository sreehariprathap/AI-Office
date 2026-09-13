import { useEffect, useMemo, useRef, useState } from 'react'
import { layoutFloor, lookOf, themeOf, STATUS_COLORS, deskLabel } from '../world.js'
import { Person, Desk, Chair, Plant, WaterCooler, Vending, Bookshelf, Cabinet, Couch, Window, Board } from '../sprites.jsx'

const KIND_COLORS = { reports_to: '#f2c14e', collab: '#7fb4ff', data: '#5ee08a', bridge: '#ff8ad8' }
const WALL_H = 26

function Wall({ x, y, w, theme, windows = 0, board = false }) {
  const slots = Math.max(0, windows)
  return (
    <g>
      <rect x={x} y={y} width={w} height={WALL_H} fill="#e9e1c9" />
      <rect x={x} y={y + WALL_H - 8} width={w} height={8} fill={theme.wall} />
      <rect x={x} y={y + WALL_H - 2} width={w} height={2} fill={theme.trim} />
      {Array.from({ length: slots }).map((_, i) => (
        <Window key={i} x={x + ((i + 1) * w) / (slots + 1) - 18} y={y + 2} />
      ))}
      {board && <Board x={x + 10} y={y + 2} w={34} />}
    </g>
  )
}

function Room({ room, theme, children, label }) {
  return (
    <g>
      <rect x={room.x} y={room.y} width={room.w} height={room.h} fill={`url(#floor-${room.kind})`} />
      <Wall x={room.x} y={room.y} w={room.w} theme={theme} windows={Math.floor(room.w / 90)} board={room.kind === 'work'} />
      {children}
      <rect x={room.x} y={room.y} width={room.w} height={room.h} fill="none" stroke="#1a1410" strokeWidth={4} />
      {label && (
        <g transform={`translate(${room.x + room.w / 2},${room.y + room.h - 3})`}>
          <rect x={-label.length * 3.2 - 6} y={-14} width={label.length * 6.4 + 12} height={13} fill="#efe6cf" stroke="#3a2a1a" strokeWidth={1.5} />
          <text className="sign" y={-4.5} textAnchor="middle">
            {label}
          </text>
        </g>
      )}
    </g>
  )
}

// 8x7 pixel glyphs centered in the status badge
function StatusGlyph({ status }) {
  const c = STATUS_COLORS[status]
  if (status === 'error') return <g fill={c}><rect x={-1} y={-5} width={2} height={5} /><rect x={-1} y={1} width={2} height={2} /></g>
  if (status === 'meeting') return <g fill={c}><rect x={-4} y={-1} width={2} height={2} /><rect x={-1} y={-1} width={2} height={2} /><rect x={2} y={-1} width={2} height={2} /></g>
  return (
    <g fill="#8a5a2b">
      <rect x={-4} y={-3} width={6} height={5} />
      <rect x={2} y={-2} width={2} height={1} />
      <rect x={3} y={-2} width={1} height={3} />
      <rect x={-3} y={-3} width={4} height={1} fill={c} />
    </g>
  )
}

function Sprite({ agent, p, selected, onSelect, atHome }) {
  const look = useMemo(() => lookOf(agent), [agent.id, agent.name, agent.role])
  const [walking, setWalking] = useState(false)
  const last = useRef(p)
  useEffect(() => {
    if (last.current.x !== p.x || last.current.y !== p.y) {
      setWalking(true)
      const t = setTimeout(() => setWalking(false), 1500)
      last.current = p
      return () => clearTimeout(t)
    }
  }, [p.x, p.y])
  const seated = p.seated && !walking
  const icon = ['error', 'meeting', 'idle'].includes(agent.status)
  return (
    <g
      className={`sprite ${p.away ? 'away' : ''} ${selected ? 'selected' : ''}`}
      style={{ transform: `translate(${p.x - 8}px, ${p.y - 10}px)` }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(agent.id)
      }}
    >
      <rect x={0} y={-6} width={32} height={46} fill="transparent" />
      <g transform="scale(2)">
        <Person look={look} seated={seated} typing={agent.status === 'working' && seated} walking={walking} />
      </g>
      {icon && !walking && (
        <g transform="translate(26,-8)"><g className={`status-icon s-${agent.status}`}>
          <rect x={-6} y={-7} width={12} height={11} rx={1} fill="#fff" stroke="#1a1410" strokeWidth={1} />
          <StatusGlyph status={agent.status} />
        </g></g>
      )}
      {p.away && !walking && <text x={28} y={-2} className="zzz">z</text>}
      {selected && <polygon className="pointer" points="10,-16 22,-16 16,-9" fill="#ffe066" stroke="#1a1410" />}
      {!atHome && (
        <text x={16} y={44} textAnchor="middle" className="tag light">
          {deskLabel(agent, 10)}
        </text>
      )}
    </g>
  )
}

export default function OfficeFloor({ office, agents, connections, messages, offices, selectedId, onSelect, showLinks, zoom }) {
  const theme = themeOf(office)
  const L = useMemo(() => layoutFloor(office, agents), [office, agents])
  const ids = useMemo(() => new Set(agents.map((a) => a.id)), [agents])
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])

  // live message flights + speech bubbles
  const [flights, setFlights] = useState([])
  const [bubbles, setBubbles] = useState({})
  const seen = useRef(null)
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id))
      return
    }
    const fresh = messages.filter((m) => !seen.current.has(m.id))
    fresh.forEach((m) => seen.current.add(m.id))
    const center = (id) => {
      const p = L.pos[id]
      return p ? { x: p.x + 8, y: p.y + 8 } : null
    }
    const portal = { x: L.portal.x + 16, y: L.portal.y + 22 }
    const hub = { x: L.console.x + 14, y: L.console.y + 20 }
    const newFlights = []
    for (const m of fresh) {
      const inFrom = ids.has(m.from)
      const inTo = ids.has(m.to)
      if (!inFrom && !inTo) continue
      const a = inFrom ? center(m.from) : m.from === 'hub' ? hub : portal
      const b = inTo ? center(m.to) : m.to === 'hub' || !m.to ? hub : portal
      newFlights.push({ id: m.id, a, b, kind: inFrom && inTo ? m.type : 'bridge', born: Date.now() })
      if (inFrom) setBubbles((s) => ({ ...s, [m.from]: { text: m.text, id: m.id, born: Date.now() } }))
      if (m.from === 'hub' && inTo) setBubbles((s) => ({ ...s, hub: { text: m.text, id: m.id, born: Date.now() } }))
    }
    if (newFlights.length) setFlights((f) => [...f, ...newFlights])
  }, [messages])

  useEffect(() => {
    if (!flights.length) return
    const t = setTimeout(() => setFlights((f) => f.filter((x) => Date.now() - x.born < 1300)), 1400)
    return () => clearTimeout(t)
  }, [flights])
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setBubbles((s) => {
        const keep = Object.entries(s).filter(([, b]) => now - b.born < 3500)
        return keep.length === Object.keys(s).length ? s : Object.fromEntries(keep)
      })
    }, 500)
    return () => clearInterval(t)
  }, [])

  const officeLinks = connections.filter((c) => ids.has(c.from) || ids.has(c.to))
  const bridges = officeLinks.filter((c) => !(ids.has(c.from) && ids.has(c.to)))
  const bridgeTargets = [...new Set(bridges.map((c) => byId[c.from] ? c.to : c.from))]
  const otherOfficeNames = offices.length > 1 ? `${bridgeTargets.length} bridge${bridgeTargets.length === 1 ? '' : 's'}` : 'no bridges'

  const sorted = [...agents].sort((a, b) => L.pos[a.id].y - L.pos[b.id].y)
  const work = L.rooms.find((r) => r.kind === 'work')
  const meet = L.rooms.find((r) => r.kind === 'meeting')
  const brk = L.rooms.find((r) => r.kind === 'break')

  return (
    <svg
      className="floor"
      viewBox={`0 0 ${L.W} ${L.H}`}
      width={L.W * zoom}
      height={L.H * zoom}
      shapeRendering="crispEdges"
      onClick={() => onSelect(null)}
    >
      <defs>
        <pattern id="floor-work" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={theme.floor} />
          {office.floor === 'checker' && <rect width="8" height="8" fill={theme.floor2} />}
          {office.floor === 'checker' && <rect x="8" y="8" width="8" height="8" fill={theme.floor2} />}
          {office.floor === 'tile' && <path d="M0 0H16V1H1V16H0Z" fill="#000" opacity=".15" />}
          {office.floor === 'wood' && <rect y="7" width="16" height="1" fill="#000" opacity=".2" />}
          {(office.floor === 'carpet' || !office.floor) && <rect x="5" y="9" width="1" height="1" fill="#000" opacity=".25" />}
          {(office.floor === 'carpet' || !office.floor) && <rect x="12" y="3" width="1" height="1" fill="#fff" opacity=".08" />}
        </pattern>
        <pattern id="floor-suite" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#6b3a34" />
          <rect x="3" y="5" width="1" height="1" fill="#000" opacity=".2" />
        </pattern>
        <pattern id="floor-meeting" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={theme.floor2} />
          <path d="M0 0H16V1H1V16H0Z" fill="#000" opacity=".12" />
        </pattern>
        <pattern id="floor-break" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#6f6a8c" />
          <rect width="8" height="8" fill="#5d587a" />
          <rect x="8" y="8" width="8" height="8" fill="#5d587a" />
        </pattern>
        <pattern id="corridor" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#2a7f7a" />
          <rect x="7" y="13" width="1" height="1" fill="#000" opacity=".2" />
          <rect x="18" y="4" width="1" height="1" fill="#fff" opacity=".1" />
        </pattern>
      </defs>

      <rect width={L.W} height={L.H} fill="#1a1410" />
      {/* corridor */}
      <rect x={L.corridor.x} y={L.corridor.y} width={L.corridor.w} height={L.corridor.h} fill="url(#corridor)" />
      {Array.from({ length: Math.floor(L.corridor.w / 120) }).map((_, i) => (
        <Plant key={i} x={L.corridor.x + 90 + i * 120} y={L.corridor.y + 4} />
      ))}

      {/* hub console = you */}
      <g className="console" transform={`translate(${L.console.x},${L.console.y})`}>
        <rect width={30} height={40} fill="#20242c" stroke="#79e0a0" strokeWidth={1} />
        <rect x={3} y={3} width={24} height={14} fill="#0b1a12" />
        <rect x={5} y={6} width={14} height={2} fill="#79e0a0" className="screen-glow" />
        <rect x={5} y={10} width={9} height={2} fill="#79e0a0" />
        <text x={15} y={32} textAnchor="middle" className="tag light">
          YOU
        </text>
        {bubbles.hub && <Bubble x={15} y={-4} text={bubbles.hub.text} />}
      </g>

      {/* elevator / bridge portal to other offices */}
      <g className="portal" transform={`translate(${L.portal.x},${L.portal.y})`}>
        <rect width={32} height={46} fill="#8a9099" />
        <rect x={3} y={6} width={12} height={40} fill="#c9ccd1" />
        <rect x={17} y={6} width={12} height={40} fill="#c9ccd1" />
        <rect x={15} y={6} width={2} height={40} fill="#5b6069" />
        <rect x={12} y={1} width={8} height={4} fill={bridges.length ? '#ff8ad8' : '#3a3f47'} className={bridges.length ? 'blink' : ''} />
        <text x={-6} y={30} textAnchor="end" className="tag light">
          ⇄ {otherOfficeNames}
        </text>
      </g>

      {/* rooms */}
      {L.rooms
        .filter((r) => r.kind === 'suite')
        .map((r, i) => (
          <Room key={'s' + i} room={r} theme={theme} label={r.boss ? `BOSS · ${deskLabel(r.boss, 20)}` : 'BOSS (vacant)'}>
            <Bookshelf x={r.x + r.w - 36} y={r.y + 30} />
            <Plant x={r.x + 8} y={r.y + 32} />
            <Plant x={r.x + r.w - 16} y={r.y + r.h - 34} />
            <rect x={r.x + 22} y={r.y + 96} width={r.w - 44} height={40} fill={theme.rug} />
            <rect x={r.x + 26} y={r.y + 100} width={r.w - 52} height={32} fill="none" stroke={theme.accent} strokeWidth={1} opacity={0.5} />
            <Chair x={r.x + r.w / 2 - 8} y={r.y + 58} color="#1c1f27" />
          </Room>
        ))}
      <Room room={meet} theme={theme} label="MEETING">
        <Plant x={meet.x + 8} y={meet.y + 30} />
        <Cabinet x={meet.x + meet.w - 22} y={meet.y + 30} />
      </Room>
      <Room room={brk} theme={theme} label="BREAK ROOM">
        <Vending x={brk.x + 8} y={brk.y + 28} />
        <WaterCooler x={brk.x + brk.w - 22} y={brk.y + 30} />
        <Couch x={brk.x + brk.w / 2 - 22} y={brk.y + 34} />
      </Room>
      <Room room={work} theme={theme} label={office.name.toUpperCase()}>
        <Cabinet x={work.x + work.w - 22} y={work.y + 30} />
        <WaterCooler x={work.x + work.w - 40} y={work.y + 30} />
        <Plant x={work.x + 8} y={work.y + work.h - 20} />
      </Room>

      {/* door gaps */}
      {L.rooms.map((r, i) => (
        <rect key={'d' + i} x={r.x + r.w / 2 - 14} y={r.kind === 'work' ? r.y - 2 : r.y + r.h - 2} width={28} height={4} fill="#2a7f7a" />
      ))}

      {/* meeting table */}
      <rect x={L.table.x} y={L.table.y} width={L.table.w} height={L.table.h} fill="#9a6a3f" />
      <rect x={L.table.x} y={L.table.y} width={L.table.w} height={3} fill="#b98452" />
      <rect x={L.table.x} y={L.table.y + L.table.h} width={L.table.w} height={4} fill="#6e4a2b" />

      {/* desks & chairs behind agents */}
      {L.desks.map((d, i) => (
        <g key={'c' + i}>
          <Chair x={d.x + 29} y={d.y + 14} />
        </g>
      ))}

      {/* links under sprites */}
      {showLinks && (
        <g className="links" shapeRendering="auto">
          {officeLinks.map((c) => {
            const a = L.pos[c.from]
            const b = L.pos[c.to]
            const pa = a ? { x: a.x + 8, y: a.y + 12 } : { x: L.portal.x + 16, y: L.portal.y + 24 }
            const pb = b ? { x: b.x + 8, y: b.y + 12 } : { x: L.portal.x + 16, y: L.portal.y + 24 }
            const color = KIND_COLORS[c.kind] || '#fff'
            const mx = (pa.x + pb.x) / 2
            const my = Math.min(pa.y, pb.y) - 30
            return <path key={c.id} d={`M${pa.x},${pa.y} Q${mx},${my} ${pb.x},${pb.y}`} stroke={color} className={`link k-${c.kind}`} />
          })}
        </g>
      )}

      {/* agents */}
      {sorted.map((a) => {
        const p = L.pos[a.id]
        const atHome = p.x === p.home.x && p.y === p.home.y
        return <Sprite key={a.id} agent={a} p={p} atHome={atHome} selected={a.id === selectedId} onSelect={onSelect} />
      })}

      {/* desks in front of seated agents */}
      {L.desks.map((d, i) => {
        const a = d.agent
        const screen = !a ? '#1b1f24' : a.status === 'error' ? '#ff5d5d' : a.status === 'offline' ? '#1b1f24' : a.status === 'working' ? '#79e0a0' : '#2f5a7a'
        return (
          <g key={'k' + i} className={a ? 'desk' : 'desk open'} onClick={(e) => (e.stopPropagation(), onSelect(a ? a.id : 'hire'))}>
            <Desk x={d.x + 14} y={d.y + 22} screen={screen} glow={a?.status === 'working'} />
            {a ? (
              <g transform={`translate(${d.x + 37},${d.y + 60})`}>
                <circle cx={-deskLabel(a).length * 2.6 - 6} cy={-3} r={2.5} fill={STATUS_COLORS[a.status]} shapeRendering="auto" />
                <text textAnchor="middle" className="tag light">
                  {deskLabel(a)}
                </text>
              </g>
            ) : (
              <text x={d.x + 37} y={d.y + 60} textAnchor="middle" className="tag hire">
                + open seat
              </text>
            )}
          </g>
        )
      })}
      {L.rooms
        .filter((r) => r.kind === 'suite')
        .map((r, i) => {
          const a = r.boss
          const cx = r.x + r.w / 2
          return (
            <g key={'bd' + i} onClick={(e) => (e.stopPropagation(), onSelect(a ? a.id : 'hire'))} className="desk">
              <Desk x={cx - 34} y={r.y + 76} w={68} screen={a?.status === 'working' ? '#79e0a0' : a?.status === 'error' ? '#ff5d5d' : '#1b1f24'} glow={a?.status === 'working'} />
              {a && (
                <text x={cx} y={r.y + 116} textAnchor="middle" className="tag light">
                  <tspan fill={STATUS_COLORS[a.status]}>● </tspan>
                  {a.title || 'Boss'}
                </text>
              )}
            </g>
          )
        })}

      {/* message flights */}
      <g shapeRendering="auto">
        {flights.map((f) => (
          <g key={f.id} className="flight" style={{ '--x1': `${f.a.x}px`, '--y1': `${f.a.y}px`, '--x2': `${f.b.x}px`, '--y2': `${f.b.y}px` }}>
            <rect x={-5} y={-4} width={10} height={8} fill="#fff" stroke={KIND_COLORS[f.kind] || '#7fb4ff'} strokeWidth={1.5} />
            <path d="M-5,-4 L0,1 L5,-4" fill="none" stroke={KIND_COLORS[f.kind] || '#7fb4ff'} strokeWidth={1} />
          </g>
        ))}
      </g>

      {/* speech bubbles on top */}
      {Object.entries(bubbles).map(([id, b]) => {
        const p = L.pos[id]
        if (!p) return null
        return <Bubble key={b.id} x={p.x + 8} y={p.y - 16} text={b.text} />
      })}
    </svg>
  )
}

function Bubble({ x, y, text }) {
  const t = text.length > 34 ? text.slice(0, 33) + '…' : text
  const w = t.length * 4.6 + 12
  return (
    <g transform={`translate(${x},${y})`}><g className="bubble">
      <rect x={-w / 2} y={-16} width={w} height={14} fill="#fffdf4" stroke="#1a1410" strokeWidth={1.5} />
      <polygon points="-3,-2 3,-2 0,3" fill="#fffdf4" stroke="#1a1410" strokeWidth={1} />
      <text textAnchor="middle" y={-6} className="bubble-text">
        {t}
      </text>
    </g></g>
  )
}
