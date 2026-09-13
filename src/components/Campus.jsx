import { useEffect, useMemo, useRef, useState } from 'react'
import { themeOf, STATUS_COLORS } from '../world.js'
import { Plant } from '../sprites.jsx'

const BW = 170 // building width
const GAP_X = 90
const GROUND = 300 // y of the street line
const PER_FLOOR = 5

const WINDOW = { working: '#ffe28a', meeting: '#9fd0ff', idle: '#ffb86b', error: '#ff5d5d', offline: '#2a2f38' }

function Building({ office, agents, x, onOpen, activity }) {
  const t = themeOf(office)
  const floors = Math.max(2, Math.ceil(agents.length / PER_FLOOR))
  const h = floors * 30 + 34
  const y = GROUND - h
  const boss = agents.find((a) => a.role === 'boss')
  const ordered = [...agents].sort((a, b) => (a.role === 'boss' ? -1 : b.role === 'boss' ? 1 : 0))
  return (
    <g className={`building ${activity ? 'buzz' : ''}`} onClick={() => onOpen(office.id)}>
      <rect x={x + 6} y={y + 6} width={BW} height={h} fill="#000" opacity={0.25} />
      <rect x={x} y={y} width={BW} height={h} fill={t.wall} />
      <rect x={x} y={y} width={BW} height={10} fill={t.trim} />
      <rect x={x - 6} y={y - 6} width={BW + 12} height={8} fill={t.trim} />
      {/* rooftop: antenna blinks when office is talking */}
      <rect x={x + BW - 30} y={y - 26} width={3} height={20} fill="#9aa0a8" />
      <rect x={x + BW - 33} y={y - 30} width={9} height={5} fill={activity ? '#ff8ad8' : '#555'} className={activity ? 'blink' : ''} />
      {boss && <rect x={x + 10} y={y - 19} width={boss.name.length * 5 + 20} height={13} fill="#e9e1c9" stroke="#3a2a1a" />}
      {boss && (
        <text x={x + 16} y={y - 9} className="tag">
          ★ {boss.name}
        </text>
      )}
      {Array.from({ length: floors * PER_FLOOR }).map((_, i) => {
        const a = ordered[i]
        const col = i % PER_FLOOR
        const row = Math.floor(i / PER_FLOOR)
        const wx = x + 12 + col * 31
        const wy = GROUND - 46 - row * 30
        return (
          <g key={i}>
            <rect x={wx} y={wy} width={22} height={18} fill="#e9e1c9" />
            <rect x={wx + 2} y={wy + 2} width={18} height={14} fill={a ? WINDOW[a.status] : '#1b2330'} className={a?.status === 'working' ? 'flicker' : ''} style={{ animationDelay: `${(i * 173) % 2000}ms` }} />
            {a && a.status !== 'offline' && <rect x={wx + 7} y={wy + 8} width={8} height={8} fill="#000" opacity={0.35} />}
          </g>
        )
      })}
      {/* door + sign */}
      <rect x={x + BW / 2 - 12} y={GROUND - 22} width={24} height={22} fill="#5a3c22" />
      <rect x={x + BW / 2 - 1} y={GROUND - 22} width={2} height={22} fill="#3a2715" />
      <rect x={x + 10} y={GROUND + 10} width={BW - 20} height={18} fill="#efe6cf" stroke="#3a2a1a" strokeWidth={2} />
      <text x={x + BW / 2} y={GROUND + 23} textAnchor="middle" className="sign big">
        {office.name.toUpperCase()}
      </text>
      <text x={x + BW / 2} y={GROUND + 42} textAnchor="middle" className="tag light">
        {agents.filter((a) => a.status !== 'offline').length}/{agents.length} online
      </text>
    </g>
  )
}

export default function Campus({ offices, agents, connections, messages, onOpen, onNewOffice, zoom }) {
  const W = Math.max(900, 80 + (offices.length + 1) * (BW + GAP_X))
  const H = 420
  const xs = useMemo(() => Object.fromEntries(offices.map((o, i) => [o.id, 60 + i * (BW + GAP_X)])), [offices])
  const agentOffice = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.officeId])), [agents])
  const byOffice = useMemo(() => {
    const m = {}
    offices.forEach((o) => (m[o.id] = []))
    agents.forEach((a) => m[a.officeId]?.push(a))
    return m
  }, [offices, agents])

  // aggregate cross-office bridges per office pair
  const pairs = useMemo(() => {
    const m = new Map()
    for (const c of connections) {
      const a = agentOffice[c.from]
      const b = agentOffice[c.to]
      if (!a || !b || a === b) continue
      const k = [a, b].sort().join('|')
      m.set(k, { a, b, count: (m.get(k)?.count || 0) + 1, label: c.label })
    }
    return [...m.values()]
  }, [connections, agentOffice])

  const arc = (a, b) => {
    const x1 = xs[a] + BW / 2
    const x2 = xs[b] + BW / 2
    const top = (id) => GROUND - (Math.max(2, Math.ceil(byOffice[id].length / PER_FLOOR)) * 30 + 34) - 32
    const y1 = top(a)
    const y2 = top(b)
    const lift = 40 + Math.abs(x2 - x1) * 0.18
    return `M${x1},${y1} C${x1},${Math.min(y1, y2) - lift} ${x2},${Math.min(y1, y2) - lift} ${x2},${y2}`
  }

  // packets for cross-office messages
  const [packets, setPackets] = useState([])
  const [activeOffices, setActive] = useState({})
  const seen = useRef(null)
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id))
      return
    }
    const fresh = messages.filter((m) => !seen.current.has(m.id))
    fresh.forEach((m) => seen.current.add(m.id))
    const add = []
    const act = {}
    for (const m of fresh) {
      const a = agentOffice[m.from]
      const b = agentOffice[m.to]
      if (a) act[a] = Date.now()
      if (b) act[b] = Date.now()
      if (a && b && a !== b && xs[a] != null && xs[b] != null) {
        const [p, q] = [a, b].sort()
        add.push({ id: m.id, d: arc(p, q), reverse: p !== a, born: Date.now() })
      }
    }
    if (add.length) setPackets((s) => [...s, ...add])
    if (Object.keys(act).length) setActive((s) => ({ ...s, ...act }))
  }, [messages])
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setPackets((s) => (s.length ? s.filter((p) => now - p.born < 1800) : s))
      setActive((s) => Object.fromEntries(Object.entries(s).filter(([, ts]) => now - ts < 2500)))
    }, 600)
    return () => clearInterval(t)
  }, [])

  const lotX = 60 + offices.length * (BW + GAP_X)

  return (
    <svg className="campus" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} shapeRendering="crispEdges">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16213a" />
          <stop offset="1" stopColor="#2c3f5c" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#sky)" />
      {Array.from({ length: 40 }).map((_, i) => (
        <rect key={i} x={(i * 97) % W} y={(i * 53) % 160} width={2} height={2} fill="#fff" opacity={0.3 + ((i * 7) % 5) / 10} className={i % 4 === 0 ? 'twinkle' : ''} />
      ))}
      {/* distant skyline */}
      {Array.from({ length: Math.ceil(W / 40) }).map((_, i) => {
        const h = 40 + ((i * 37) % 70)
        return <rect key={i} x={i * 40} y={GROUND - h - 20} width={38} height={h + 20} fill="#1d2b44" />
      })}
      <rect y={GROUND} width={W} height={H - GROUND} fill="#3b4a3a" />
      <rect y={GROUND + 52} width={W} height={34} fill="#2b2f36" />
      {Array.from({ length: Math.ceil(W / 40) }).map((_, i) => (
        <rect key={i} x={i * 40 + 10} y={GROUND + 68} width={20} height={2} fill="#e9d36b" opacity={0.6} />
      ))}

      {/* bridges (behind buildings' fronts, above skyline) */}
      <g shapeRendering="auto">
        {pairs.map((p) => (
          <g key={p.a + p.b}>
            <path d={arc(p.a, p.b)} className="bridge-cable" strokeWidth={2 + Math.min(4, p.count)} />
            <path d={arc(p.a, p.b)} className="bridge-flow" />
          </g>
        ))}
      </g>

      {offices.map((o) => (
        <Building key={o.id} office={o} agents={byOffice[o.id] || []} x={xs[o.id]} onOpen={onOpen} activity={!!activeOffices[o.id]} />
      ))}

      {pairs.map((p) => {
        const x = (xs[p.a] + xs[p.b]) / 2 + BW / 2
        return (
          <text key={'l' + p.a + p.b} x={x} y={40 + (Math.abs(xs[p.a] - xs[p.b]) > BW + GAP_X ? 0 : 30)} textAnchor="middle" className="tag bridge-label">
            ⇄ {p.count} link{p.count > 1 ? 's' : ''}
          </text>
        )
      })}

      <g shapeRendering="auto">
        {packets.map((p) => (
          <circle key={p.id} r={5} className={`packet ${p.reverse ? 'rev' : ''}`} style={{ offsetPath: `path('${p.d}')` }} />
        ))}
      </g>

      {/* empty lot: build a new office */}
      <g className="lot" onClick={onNewOffice}>
        <rect x={lotX} y={GROUND - 110} width={BW} height={110} fill="none" stroke="#e9d36b" strokeWidth={2} strokeDasharray="6 6" />
        <rect x={lotX + BW / 2 - 2} y={GROUND - 70} width={4} height={70} fill="#6e4a2b" />
        <rect x={lotX + 20} y={GROUND - 96} width={BW - 40} height={30} fill="#efe6cf" stroke="#3a2a1a" strokeWidth={2} />
        <text x={lotX + BW / 2} y={GROUND - 77} textAnchor="middle" className="sign big">
          + BUILD OFFICE
        </text>
      </g>

      {Array.from({ length: offices.length + 2 }).map((_, i) => (
        <Plant key={i} x={20 + i * (BW + GAP_X) + (i ? -40 : 0)} y={GROUND - 12} s={1.2} />
      ))}

      <g transform={`translate(20,${H - 18})`}>
        {Object.entries(STATUS_COLORS).map(([k, c], i) => (
          <g key={k} transform={`translate(${i * 90},0)`}>
            <rect width={10} height={10} fill={WINDOW[k] || c} stroke="#000" />
            <text x={14} y={9} className="tag light">
              {k}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}
