import { THEMES } from '../world.js'

// One facade, parameterised by sprite + theme. A new building kind is a
// variant entry here, never a new file.
const SPRITE = {
  market:  { roof: 'flat',   storeys: 3, accent: '#e9b949' },
  lab:     { roof: 'flat',   storeys: 2, accent: '#7fb4ff' },
  studio:  { roof: 'gable',  storeys: 2, accent: '#c7a2ff' },
  cafe:    { roof: 'awning', storeys: 1, accent: '#ff8a7a' },
  gym:     { roof: 'gable',  storeys: 1, accent: '#5ee08a' },
  library: { roof: 'gable',  storeys: 2, accent: '#d9a441' },
  post:    { roof: 'awning', storeys: 1, accent: '#ff9ec4' },
  tower:   { roof: 'flat',   storeys: 4, accent: '#c9d4e0' },
}

export default function BuildingSprite({ building, w = 200, h = 160 }) {
  const s = SPRITE[building.sprite] || SPRITE.tower
  const t = THEMES[building.theme] || THEMES.slate
  const bodyH = h * 0.62
  const bodyY = h - bodyH
  const roofH = 26

  return (
    <g className="bsprite">
      {/* ground shadow */}
      <ellipse cx={w / 2} cy={h - 4} rx={w * 0.42} ry={9} fill="#000" opacity={0.22} />

      {/* roof */}
      {s.roof === 'gable' ? (
        <path d={`M4,${bodyY} L${w / 2},${bodyY - roofH - 8} L${w - 4},${bodyY} Z`} fill={t.trim} />
      ) : s.roof === 'awning' ? (
        <>
          <rect x={2} y={bodyY - roofH} width={w - 4} height={roofH} rx={6} fill={t.trim} />
          {Array.from({ length: 6 }).map((_, i) => (
            <rect key={i} x={2 + i * ((w - 4) / 6)} y={bodyY - roofH} width={(w - 4) / 12} height={roofH} fill={s.accent} opacity={0.55} />
          ))}
        </>
      ) : (
        <rect x={0} y={bodyY - roofH} width={w} height={roofH} rx={4} fill={t.trim} />
      )}

      {/* walls */}
      <rect x={10} y={bodyY} width={w - 20} height={bodyH} rx={8} fill={t.wall} />
      <rect x={10} y={bodyY} width={w - 20} height={bodyH} rx={8} fill="#000" opacity={0.12} />

      {/* windows, one band per storey */}
      {Array.from({ length: s.storeys }).map((_, row) => {
        const y = bodyY + 16 + row * ((bodyH - 46) / s.storeys)
        return Array.from({ length: 3 }).map((__, col) => (
          <rect
            key={`${row}-${col}`}
            x={28 + col * ((w - 66) / 3)}
            y={y}
            width={(w - 76) / 3}
            height={18}
            rx={3}
            fill="#8cc8f0"
            opacity={0.85}
          />
        ))
      })}

      {/* door */}
      <rect x={w / 2 - 16} y={h - 34} width={32} height={34} rx={4} fill={t.rug} />

      {/* hanging sign */}
      <g transform={`translate(${w / 2}, ${bodyY - roofH - 14})`}>
        <rect x={-4} y={-2} width={8} height={14} fill="#6e4a2b" />
        <rect x={-56} y={-30} width={112} height={30} rx={5} fill="#efe6cf" stroke={s.accent} strokeWidth={2.5} />
        <text x={0} y={-10} textAnchor="middle" className="bsign">
          {building.name}
        </text>
      </g>
    </g>
  )
}
