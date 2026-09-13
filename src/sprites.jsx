// Hand-placed pixel art rendered as SVG rects (crispEdges). 1 unit = 1 art pixel.
const R = ({ x, y, w = 1, h = 1, f, o }) => <rect x={x} y={y} width={w} height={h} fill={f} opacity={o} />

export function Person({ look, seated = false, typing = false, walking = false }) {
  const { skin, hair, shirt, jacket, pants, style, tie } = look
  const body = jacket || shirt
  return (
    <g className={`person ${typing ? 'typing' : ''} ${walking ? 'walking' : ''}`}>
      <R x={3} y={seated ? 13 : 17} w={10} h={2} f="#000" o={0.25} />
      {/* legs */}
      {!seated && (
        <g className="legs">
          <R x={5} y={12} w={6} h={3} f={pants} />
          <R x={5} y={15} w={2} h={1} f={pants} />
          <R x={9} y={15} w={2} h={1} f={pants} />
          <R x={4} y={16} w={3} h={1} f="#1b1b1b" />
          <R x={9} y={16} w={3} h={1} f="#1b1b1b" />
        </g>
      )}
      {/* torso */}
      <R x={4} y={7} w={8} h={5} f={body} />
      {jacket && <R x={6} y={7} w={4} h={3} f={shirt} />}
      {tie && <R x={7} y={7} w={2} h={4} f={tie} />}
      {/* arms */}
      <g className="arm-l">
        <R x={3} y={7} w={1} h={4} f={body} />
        <R x={3} y={11} w={1} h={1} f={skin} />
      </g>
      <g className="arm-r">
        <R x={12} y={7} w={1} h={4} f={body} />
        <R x={12} y={11} w={1} h={1} f={skin} />
      </g>
      {/* head */}
      <R x={7} y={6} w={2} h={1} f={skin} />
      <R x={5} y={1} w={6} h={5} f={skin} />
      <R x={6} y={3} w={1} h={1} f="#1b1b1b" />
      <R x={9} y={3} w={1} h={1} f="#1b1b1b" />
      {/* hair */}
      <R x={5} y={0} w={6} h={1} f={hair} />
      <R x={4} y={1} w={8} h={1} f={hair} />
      <R x={4} y={2} w={1} h={2} f={hair} />
      <R x={11} y={2} w={1} h={2} f={hair} />
      {style === 1 && (
        <>
          <R x={4} y={4} w={1} h={4} f={hair} />
          <R x={11} y={4} w={1} h={4} f={hair} />
        </>
      )}
      {style === 2 && <R x={6} y={-2} w={4} h={2} f={hair} />}
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
    <svg width={size} height={size} viewBox="-2 -4 20 22" shapeRendering="crispEdges" className="portrait">
      <Person look={look} />
    </svg>
  )
}
