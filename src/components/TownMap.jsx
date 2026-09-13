import { layoutTown, STATUS_COLORS } from '../world.js'
import BuildingSprite from './BuildingSprite.jsx'

// The world above the buildings. Everything here is derived from layoutTown —
// no stored coordinates, so adding a building just re-derives the scene.
export default function TownMap({ buildings, onOpen, onAddBuilding, canAdd, zoom = 1 }) {
  const L = layoutTown(buildings)
  const addX = L.W - 180 - 40
  const addY = L.H - 120 - 24

  return (
    <svg className="town" viewBox={`0 0 ${L.W} ${L.H}`} width={L.W * zoom} height={L.H * zoom} shapeRendering="crispEdges">
      <defs>
        <linearGradient id="town-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1a3a" />
          <stop offset="0.55" stopColor="#3a3466" />
          <stop offset="1" stopColor="#e8a668" />
        </linearGradient>
        <radialGradient id="town-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
        <filter id="town-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <rect width={L.W} height={L.H} fill="url(#town-sky)" />
      <g filter="url(#town-blur)">
        <circle cx={L.W * 0.82} cy={L.H * 0.12} r={120} fill="#ffd88a" opacity={0.22} />
        <circle cx={L.W * 0.82} cy={L.H * 0.12} r={24} fill="#fff6de" opacity={0.9} />
      </g>

      {/* grass */}
      <rect y={L.H * 0.18} width={L.W} height={L.H} fill="#3f7d4f" />

      {/* street */}
      <rect x={L.street.x} y={L.street.y} width={L.street.w} height={L.street.h} fill="#6b6152" />
      <rect x={L.street.x} y={L.street.y} width={L.street.w} height={5} fill="#847a68" />
      {Array.from({ length: Math.ceil(L.W / 60) }).map((_, i) => (
        <rect key={i} x={i * 60 + 18} y={L.street.y + L.street.h / 2 - 2} width={28} height={4} fill="#e9d36b" opacity={0.6} />
      ))}
      {L.street.lamps.map((lamp, i) => (
        <g key={i} transform={`translate(${lamp.x},${lamp.y - 46})`}>
          <rect x={-2} y={0} width={4} height={46} fill="#3a3f47" />
          <circle cx={0} cy={-2} r={7} fill="#ffe9b8" opacity={0.9} />
        </g>
      ))}

      {/* scenery */}
      <g shapeRendering="auto">
        {L.scenery.map((s, i) => (
          <Scenery key={i} {...s} />
        ))}
      </g>

      {/* buildings */}
      {L.lots.map((lot) => {
        const b = lot.building
        const needsAttention = (b.stats?.error || 0) > 0
        return (
          <g
            key={b.id}
            className="lot"
            transform={`translate(${lot.x},${lot.y})`}
            onClick={() => onOpen(b.slug)}
            shapeRendering="auto"
          >
            <title>{`${b.name}${b.kind === 'landmark' ? ' (landmark)' : ` — ${b.numberOfFloors} floors, ${b.numberOfAgents} agents`}`}</title>
            <BuildingSprite building={b} w={lot.w} h={lot.h} />
            {b.kind === 'workspace' && (
              <text x={lot.w / 2} y={lot.h + 18} textAnchor="middle" className="lot-sub">
                {b.numberOfFloors} floor{b.numberOfFloors === 1 ? '' : 's'} · {b.numberOfAgents} agent
                {b.numberOfAgents === 1 ? '' : 's'}
              </text>
            )}
            {needsAttention && <circle cx={lot.w - 16} cy={14} r={6} fill={STATUS_COLORS.error} className="lot-alert" />}
          </g>
        )
      })}

      {/* empty lot for adding */}
      {canAdd && (
        <g className="lot add-lot" transform={`translate(${addX},${addY})`} onClick={onAddBuilding} shapeRendering="auto">
          <rect width={180} height={120} rx={10} fill="#ffffff10" stroke="#ffffff55" strokeWidth={2} strokeDasharray="8 6" />
          <text x={90} y={66} textAnchor="middle" className="lot-sub">＋ Add building</text>
        </g>
      )}

      <rect width={L.W} height={L.H} fill="url(#town-vignette)" pointerEvents="none" />
    </svg>
  )
}

function Scenery({ type, x, y, variant }) {
  if (type === 'planter') {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect x={-8} y={0} width={16} height={10} rx={2} fill="#b5543a" />
        <circle cx={0} cy={-3} r={7} fill="#4fb862" />
      </g>
    )
  }
  if (type === 'bench') {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect x={-14} y={0} width={28} height={5} rx={2} fill="#9a6a3f" />
        <rect x={-12} y={5} width={4} height={7} fill="#6e4a2b" />
        <rect x={8} y={5} width={4} height={7} fill="#6e4a2b" />
      </g>
    )
  }
  if (type === 'fence') {
    return (
      <g transform={`translate(${x},${y})`}>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 9} y={-10} width={3} height={14} fill="#cbbba0" />
        ))}
        <rect x={0} y={-6} width={30} height={3} fill="#cbbba0" />
      </g>
    )
  }
  const scale = 1 + variant * 0.25
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <rect x={-2} y={0} width={4} height={10} fill="#6e4a2b" />
      <circle cx={0} cy={-6} r={10} fill="#2f7a3d" />
      <circle cx={-5} cy={-2} r={7} fill="#3e9a4f" />
      <circle cx={5} cy={-3} r={6} fill="#3e9a4f" />
    </g>
  )
}
