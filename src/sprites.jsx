// Hand-placed pixel art rendered as SVG rects (crispEdges). 1 unit = 1 art pixel.
const R = ({ x, y, w = 1, h = 1, f, o }) => <rect x={x} y={y} width={w} height={h} fill={f} opacity={o} />

// Flat-illustration people (rounded shapes, not 1px "pixel" rects) --
// same look-object contract (skin/hair/shirt/jacket/pants/style/tie) and
// the same .person/.arm-l/.arm-r/.legs classnames the CSS tap/walk/legs
// keyframes already target, so callers and animations are untouched.
// Roughly the same 0..16 x / -3..18 y footprint the old figure used, so
// OfficeFloor.jsx's hitbox/tag/status-icon offsets (tuned against that
// box) still line up without needing their own changes.
function darken(hex, amt) {
  if (typeof hex !== 'string' || hex[0] !== '#') return '#00000030'
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp(((n >> 16) & 255) - amt)
  const g = clamp(((n >> 8) & 255) - amt)
  const b = clamp((n & 255) - amt)
  return `rgb(${r},${g},${b})`
}

export function Person({ look, seated = false, typing = false, walking = false }) {
  const { skin, hair, shirt, jacket, pants, style, tie } = look
  const body = jacket || shirt
  const bodyShade = darken(body, 28)
  return (
    <g className={`person ${typing ? 'typing' : ''} ${walking ? 'walking' : ''}`}>
      <ellipse cx={8} cy={seated ? 13.5 : 17.5} rx={6} ry={1.3} fill="#000" opacity={0.22} />

      {/* legs -- omitted seated (the chair + desk read as "sitting" on
          their own; bent seated legs at this scale just look like noise) */}
      {!seated && (
        <g className="legs">
          <rect x={4.6} y={11.5} width={2.6} height={5} rx={1.2} fill={pants} />
          <rect x={8.8} y={11.5} width={2.6} height={5} rx={1.2} fill={pants} />
          <rect x={4.2} y={15.5} width={3.2} height={1.6} rx={0.8} fill="#20242c" />
          <rect x={8.6} y={15.5} width={3.2} height={1.6} rx={0.8} fill="#20242c" />
        </g>
      )}

      {/* torso */}
      <rect x={3.2} y={8.6} width={9.6} height={6.6} rx={3.2} fill={body} />
      {jacket && (
        <>
          {/* lapels: two shaded triangles framing the shirt underneath */}
          <path d="M6.6,8.9 L8,11.4 L6.9,13.4 L5.6,10.4 Z" fill={bodyShade} />
          <path d="M9.4,8.9 L8,11.4 L9.1,13.4 L10.4,10.4 Z" fill={bodyShade} />
          <path d="M6.7,8.7 L8,9.8 L9.3,8.7 L9.3,11.6 L8,15 L6.7,11.6 Z" fill={shirt} />
        </>
      )}
      {tie && <path d="M7.4,9.6 L8.6,9.6 L9,12 L8,14.4 L7,12 Z" fill={tie} />}

      {/* arms */}
      <g className="arm-l">
        <rect x={1.6} y={9} width={2.3} height={5.6} rx={1.15} fill={body} />
        <circle cx={2.75} cy={15} r={1.15} fill={skin} />
      </g>
      <g className="arm-r">
        <rect x={12.1} y={9} width={2.3} height={5.6} rx={1.15} fill={body} />
        <circle cx={13.25} cy={15} r={1.15} fill={skin} />
      </g>

      {/* neck + head */}
      <rect x={6.9} y={7.4} width={2.2} height={1.8} fill={skin} />
      <circle cx={8} cy={4.4} r={4.05} fill={skin} />
      <ellipse cx={6.35} cy={4.6} rx={0.5} ry={0.6} fill="#20242c" />
      <ellipse cx={9.65} cy={4.6} rx={0.5} ry={0.6} fill="#20242c" />
      <path d="M6.5,6.35 q1.5,1.15 3,0" stroke="#00000050" strokeWidth={0.5} fill="none" strokeLinecap="round" />

      {/* hair -- a back cap (drawn first, peeks past the face circle) plus
          a style-specific silhouette (short sides / long / bun) */}
      <path d="M3.85,4.6 a4.15,4.15 0 0 1 8.3,0 v-0.5 a4.15,4.3 0 0 0 -8.3,0 z" fill={hair} />
      {style === 0 && (
        <>
          <path d="M3.85,3.6 a4.15,3.4 0 0 1 8.3,0 l-0.5,1.6 q-3.65,-1.5 -7.3,0 z" fill={hair} />
        </>
      )}
      {style === 1 && (
        <>
          <path d="M3.85,3.6 a4.15,3.4 0 0 1 8.3,0 l-0.5,1.6 q-3.65,-1.5 -7.3,0 z" fill={hair} />
          <path d="M3.5,3.6 q-1.1,3 -0.4,7.4 q1.1,0.3 1.3,-0.6 q-0.9,-3.4 0,-6.6 z" fill={hair} />
          <path d="M12.5,3.6 q1.1,3 0.4,7.4 q-1.1,0.3 -1.3,-0.6 q0.9,-3.4 0,-6.6 z" fill={hair} />
        </>
      )}
      {style === 2 && (
        <>
          <path d="M3.85,3.7 a4.15,3.3 0 0 1 8.3,0 l-0.4,1.3 q-3.75,-1.3 -7.5,0 z" fill={hair} />
          <circle cx={8} cy={0.15} r={1.55} fill={hair} />
        </>
      )}
    </g>
  )
}

export function Chair({ x, y, color = '#2b2f3a' }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={16} h={12} f={color} />
      <R x={1} y={1} w={14} h={2} f="#ffffff" o={0.12} />
      <R x={2} y={12} w={12} h={4} f="#1c1f27" />
    </g>
  )
}

export function Desk({ x, y, w = 46, screen = '#1b2a22', glow = false }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={w} h={16} f="#9a6a3f" />
      <R x={0} y={0} w={w} h={3} f="#b98452" />
      <R x={0} y={16} w={w} h={4} f="#6e4a2b" />
      <R x={2} y={20} w={3} h={5} f="#5a3c22" />
      <R x={w - 5} y={20} w={3} h={5} f="#5a3c22" />
      {/* monitor (back) */}
      <R x={w - 18} y={-9} w={14} h={10} f="#c9ccd1" />
      <R x={w - 17} y={-8} w={12} h={8} f={screen} className={glow ? 'screen-glow' : ''} />
      <R x={w - 13} y={1} w={4} h={2} f="#9aa0a8" />
      {/* keyboard + mug */}
      <R x={8} y={5} w={14} h={4} f="#d9dde2" />
      <R x={9} y={6} w={12} h={1} f="#9aa0a8" />
      <R x={4} y={3} w={3} h={4} f="#f2f2f2" />
    </g>
  )
}

export function Plant({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <R x={3} y={0} w={4} h={3} f="#3e9a4f" />
      <R x={0} y={3} w={10} h={5} f="#4fb862" />
      <R x={2} y={1} w={2} h={3} f="#2f7a3d" />
      <R x={6} y={2} w={3} h={4} f="#2f7a3d" />
      <R x={2} y={8} w={6} h={6} f="#b5543a" />
      <R x={2} y={8} w={6} h={1} f="#d0704f" />
    </g>
  )
}

export function WaterCooler({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={2} y={0} w={8} h={8} f="#8cc8f0" />
      <R x={3} y={1} w={2} h={5} f="#c8e8ff" />
      <R x={0} y={8} w={12} h={16} f="#e6e8eb" />
      <R x={2} y={12} w={3} h={2} f="#3b82f6" />
      <R x={7} y={12} w={3} h={2} f="#ef4444" />
    </g>
  )
}

export function Vending({ x, y }) {
  const c = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={22} h={34} f="#2b2f3a" />
      <R x={2} y={2} w={13} h={24} f="#10151c" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((k) => <R key={`${r}${k}`} x={3 + k * 4} y={4 + r * 6} w={3} h={3} f={c[(r + k) % c.length]} />))}
      <R x={17} y={6} w={3} h={8} f="#79e0a0" />
      <R x={3} y={28} w={12} h={3} f="#000" />
    </g>
  )
}

export function Bookshelf({ x, y }) {
  const c = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085']
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={26} h={30} f="#6e4a2b" />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <R x={2} y={2 + r * 9} w={22} h={7} f="#3a2715" />
          {[0, 1, 2, 3, 4, 5, 6].map((k) => <R key={k} x={3 + k * 3} y={3 + r * 9 + (k % 3)} w={2} h={6 - (k % 3)} f={c[(k + r) % c.length]} />)}
        </g>
      ))}
    </g>
  )
}

export function Cabinet({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={14} h={24} f="#8a9099" />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <R x={1} y={1 + r * 8} w={12} h={7} f="#a3a9b1" />
          <R x={5} y={3 + r * 8} w={4} h={1} f="#5b6069" />
        </g>
      ))}
    </g>
  )
}

export function Couch({ x, y, color = '#4a5a8c' }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={44} h={8} f={color} />
      <R x={0} y={8} w={44} h={8} f={color} o={0.8} />
      <R x={0} y={0} w={5} h={16} f="#000" o={0.2} />
      <R x={39} y={0} w={5} h={16} f="#000" o={0.2} />
      <R x={21} y={8} w={1} h={8} f="#000" o={0.25} />
    </g>
  )
}

export function Window({ x, y, w = 36 }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={w} h={14} f="#e8e2cf" />
      <R x={2} y={2} w={w - 4} h={10} f="#7fc4ec" />
      <R x={4} y={3} w={4} h={8} f="#b8e2fa" />
      <R x={w / 2 - 1} y={2} w={2} h={10} f="#e8e2cf" />
    </g>
  )
}

export function Board({ x, y, w = 40 }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <R x={0} y={0} w={w} h={16} f="#9aa0a8" />
      <R x={1} y={1} w={w - 2} h={14} f="#f4f6f8" />
      {[0, 1, 2, 3].map((i) => <R key={i} x={4} y={3 + i * 3} w={(w - 10) * (0.4 + ((i * 37) % 50) / 100)} h={1} f={['#3b82f6', '#22c55e', '#ef4444', '#64748b'][i]} />)}
    </g>
  )
}

// Big portrait used in the side panel
export function Portrait({ look, size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="-3 -3.5 22 24" className="portrait">
      <Person look={look} />
    </svg>
  )
}
