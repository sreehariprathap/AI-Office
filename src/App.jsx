import { useEffect, useMemo, useState } from 'react'
import { useHub } from './hub.js'
import { themeOf, STATUS_COLORS } from './world.js'
import Campus from './components/Campus.jsx'
import OfficeFloor from './components/OfficeFloor.jsx'
import { Feed, AgentPanel, ConnectPanel } from './components/Sidebar.jsx'
import { NewOfficeModal, HireModal, ConnectModal } from './components/Modals.jsx'

export default function App() {
  const hub = useHub()
  const { offices, agents, connections, messages, api, connected, simulate, token } = hub

  const [view, setView] = useState(() => localStorage.getItem('hq:view') || 'campus')
  const [selectedId, setSelectedId] = useState(null)
  const [tab, setTab] = useState('feed')
  const [modal, setModal] = useState(null) // {type, ...}
  const [showLinks, setShowLinks] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [, tick] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem('hq:view', view)
    } catch {}
  }, [view])
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const office = offices.find((o) => o.id === view)
  useEffect(() => {
    if (view !== 'campus' && offices.length && !office) setView('campus')
  }, [offices, office, view])

  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const officeAgents = useMemo(() => (office ? agents.filter((a) => a.officeId === office.id) : []), [agents, office])
  const scopeIds = useMemo(() => (office ? new Set(officeAgents.map((a) => a.id)) : null), [office, officeAgents])
  const selected = agentsById[selectedId]

  const select = (id, jump = false) => {
    if (id === 'hire') return office && setModal({ type: 'hire' })
    setSelectedId(id)
    if (id) {
      setTab('agent')
      if (jump && agentsById[id]) setView(agentsById[id].officeId)
    } else if (tab === 'agent') setTab('feed')
  }

  const online = agents.filter((a) => a.status !== 'offline').length
  const perMin = messages.filter((m) => Date.now() - m.ts < 60000).length
  const t = themeOf(office)

  return (
    <div className="app" style={{ '--accent': office ? t.accent : '#79e0a0' }}>
      <header className="topbar">
        <div className="brand" onClick={() => setView('campus')}>
          <span className="logo">▣</span> AGENT HQ
        </div>
        <nav className="tabs">
          <button className={view === 'campus' ? 'on' : ''} onClick={() => setView('campus')}>
            🏙 Campus
          </button>
          {offices.map((o) => {
            const n = agents.filter((a) => a.officeId === o.id)
            const err = n.some((a) => a.status === 'error')
            return (
              <button key={o.id} className={view === o.id ? 'on' : ''} onClick={() => setView(o.id)} style={{ '--tab': themeOf(o).wall }}>
                <i className="swatch" />
                {o.name}
                <span className="count">{n.length}</span>
                {err && <span className="err-dot" title="An agent needs attention" />}
              </button>
            )
          })}
          <button className="add" onClick={() => setModal({ type: 'office' })} title="Build a new office">
            +
          </button>
        </nav>
        <div className="hud">
          <span title="Agents online">
            <b>{online}</b>/{agents.length} online
          </span>
          <span title="Messages in the last minute">
            <b>{perMin}</b> msg/min
          </span>
          <span className={`live ${connected ? 'on' : ''}`}>{connected ? 'LIVE' : 'OFFLINE'}</span>
        </div>
      </header>

      <main className="stage">
        <div className="toolbar">
          {office ? (
            <>
              <div className="title">
                <h1>{office.name}</h1>
                <span className="muted">{office.description}</span>
              </div>
              <div className="legend">
                {Object.entries(STATUS_COLORS).map(([k, c]) => (
                  <span key={k}>
                    <i style={{ background: c }} />
                    {k} {officeAgents.filter((a) => a.status === k).length}
                  </span>
                ))}
              </div>
              <div className="row gap">
                <button className="primary" onClick={() => setModal({ type: 'hire' })}>
                  + Hire agent
                </button>
                <button onClick={() => setModal({ type: 'connect', fromId: selectedId || officeAgents[0]?.id })}>⚡ Connect</button>
                <button className={showLinks ? 'on' : ''} onClick={() => setShowLinks((s) => !s)}>
                  Links
                </button>
                <button onClick={() => setTab('connect')}>{'</>'} API</button>
              </div>
            </>
          ) : (
            <>
              <div className="title">
                <h1>Campus</h1>
                <span className="muted">
                  {offices.length} offices · {connections.filter((c) => agentsById[c.from]?.officeId !== agentsById[c.to]?.officeId).length} bridges · click a building to walk in
                </span>
              </div>
              <div className="row gap">
                <button className="primary" onClick={() => setModal({ type: 'office' })}>
                  + Build office
                </button>
                <button onClick={() => setModal({ type: 'connect' })}>⚡ Bridge agents</button>
              </div>
            </>
          )}
          <div className="row gap zoom">
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
          </div>
        </div>

        <div className="viewport">
          {!offices.length ? (
            <div className="empty">{connected ? 'No offices yet — build one.' : 'Connecting to hub… is `npm run dev` running?'}</div>
          ) : office ? (
            <OfficeFloor
              key={office.id}
              office={office}
              offices={offices}
              agents={officeAgents}
              connections={connections}
              messages={messages}
              selectedId={selectedId}
              onSelect={select}
              showLinks={showLinks}
              zoom={zoom * 1.6}
            />
          ) : (
            <Campus offices={offices} agents={agents} connections={connections} messages={messages} onOpen={setView} onNewOffice={() => setModal({ type: 'office' })} zoom={zoom * 1.05} />
          )}
        </div>

        <footer className="ticker">
          <div className="ticker-track" key={messages.at(-1)?.id}>
            {messages
              .slice(-6)
              .reverse()
              .map((m) => (
                <span key={m.id}>
                  <b>{m.from === 'hub' ? 'YOU' : agentsById[m.from]?.name}</b> → <b>{agentsById[m.to]?.name || 'YOU'}</b>: {m.text}
                </span>
              ))}
          </div>
          <label className="sim">
            <input type="checkbox" checked={simulate} disabled={!token} onChange={(e) => api('POST', '/api/simulate', { on: e.target.checked })} /> demo traffic
          </label>
        </footer>
      </main>

      <aside className="side">
        <div className="side-tabs">
          <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
            Comms
          </button>
          <button className={tab === 'agent' ? 'on' : ''} onClick={() => setTab('agent')} disabled={!selected}>
            Agent
          </button>
          <button className={tab === 'connect' ? 'on' : ''} onClick={() => setTab('connect')} disabled={!office}>
            API
          </button>
        </div>
        <div className="side-body">
          {tab === 'feed' && <Feed messages={messages} agentsById={agentsById} onSelect={select} scopeIds={scopeIds} />}
          {tab === 'agent' && selected && (
            <AgentPanel
              agent={selected}
              agents={agents}
              offices={offices}
              connections={connections}
              messages={messages}
              api={api}
              onSelect={select}
              onConnect={(id) => setModal({ type: 'connect', fromId: id })}
            />
          )}
          {tab === 'agent' && !selected && <p className="muted pad">Click an agent on the floor.</p>}
          {tab === 'connect' && office && <ConnectPanel office={office} api={api} token={token} />}
          {tab === 'connect' && !office && <p className="muted pad">Open an office to see its API.</p>}
        </div>
      </aside>

      {modal?.type === 'office' && <NewOfficeModal api={api} onClose={() => setModal(null)} onCreated={(o) => setView(o.id)} />}
      {modal?.type === 'hire' && office && <HireModal api={api} office={office} onClose={() => setModal(null)} onCreated={(a) => select(a.id)} />}
      {modal?.type === 'connect' && <ConnectModal api={api} agents={agents} offices={offices} fromId={modal.fromId} onClose={() => setModal(null)} />}
    </div>
  )
}
