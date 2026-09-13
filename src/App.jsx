'use client'
import { useEffect, useMemo, useState } from 'react'
import { useHub } from './hub.js'
import { themeOf, STATUS_COLORS } from './world.js'
import Campus from './components/Campus.jsx'
import OfficeFloor from './components/OfficeFloor.jsx'
import { Feed, AgentPanel, ConnectPanel } from './components/Sidebar.jsx'
import { NewOfficeModal, HireModal, ConnectModal, SourcesModal } from './components/Modals.jsx'

function RealtimeEmpty({ sources, onManage, onMock }) {
  const s = sources[0]
  return (
    <div className="rt-empty">
      <h2>⇅ Realtime</h2>
      {!sources.length ? (
        <p>No systems connected. Realtime shows only real agents mirrored from your other apps.</p>
      ) : (
        <>
          <p>
            Waiting for <b>{s.name}</b>
            {s.status === 'error' ? ' — it is not answering yet.' : '…'}
          </p>
          <code className="ellipsis">{s.url}</code>
          {s.lastError && <p className="error">{s.lastError}</p>}
          <ol className="small muted">
            <li>Deploy the office feed (dashboard/backend/office_feed.py) to the workforce backend.</li>
            <li>Set OFFICE_FEED_TOKEN there, and the same value as WORKFORCE_TOKEN in this hub's .env (or in Connected systems).</li>
            <li>Agents appear here on the next poll (every {s.intervalSec}s).</li>
          </ol>
        </>
      )}
      <div className="row gap">
        <button className="primary" onClick={onManage}>
          Connected systems
        </button>
        <button onClick={onMock}>Switch to mock</button>
      </div>
    </div>
  )
}

export default function App() {
  const hub = useHub()
  const { api, connected, simulate, token, sources, setToken, rawToken } = hub

  // Mock = demo world and hand-made agents. Realtime = only agents mirrored from connected sources.
  const [mode, setModeLocal] = useState(hub.mode)
  useEffect(() => setModeLocal(hub.mode), [hub.mode])
  const setMode = (m) => {
    setModeLocal(m)
    setSelectedId(null)
    setView('campus')
    if (token) api('POST', '/api/mode', { mode: m }).catch(() => {})
  }
  const real = mode === 'real'
  const inMode = (rec) => (real ? !!rec.external : !rec.external)
  const offices = useMemo(() => hub.offices.filter(inMode), [hub.offices, real])
  const agents = useMemo(() => hub.agents.filter(inMode), [hub.agents, real])
  const connections = useMemo(() => hub.connections.filter(inMode), [hub.connections, real])
  const messages = useMemo(() => hub.messages.filter(inMode), [hub.messages, real])
  const liveSources = real ? sources : []

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
    if (id === 'hire') return office && !office.external && setModal({ type: 'hire' })
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
    <div className={`app mode-${mode}`} style={{ '--accent': office ? t.accent : real ? '#7fb4ff' : '#79e0a0' }}>
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
                {o.external && <span title={`Synced from ${o.source}`}>⇅</span>}
                {o.name}
                <span className="count">{n.length}</span>
                {err && <span className="err-dot" title="An agent needs attention" />}
              </button>
            )
          })}
          {real ? (
            <button className="add" onClick={() => setModal({ type: 'sources' })} title="Connect a system">
              ⇅
            </button>
          ) : (
            <button className="add" onClick={() => setModal({ type: 'office' })} title="Build a new office">
              +
            </button>
          )}
        </nav>
        <div className="hud">
          <span title="Agents online">
            <b>{online}</b>/{agents.length} online
          </span>
          <span title="Messages in the last minute">
            <b>{perMin}</b> msg/min
          </span>
          {real && (
            <button className={`sources-btn ${sources.some((s) => s.status === 'error') ? 'bad' : ''}`} onClick={() => setModal({ type: 'sources' })} title="Connected systems">
              ⇅ {sources.length} source{sources.length === 1 ? '' : 's'}
            </button>
          )}
          <span className={`live ${connected ? 'on' : ''}`}>{connected ? 'LIVE' : 'OFFLINE'}</span>
          {hub.loaded && !token && (
            <button
              className="lock"
              title={rawToken ? 'That token was rejected — paste HUB_ADMIN_TOKEN again' : 'Read-only: paste the admin token to make changes'}
              onClick={() => {
                const t = window.prompt('Admin token (HUB_ADMIN_TOKEN)')
                if (t) setToken(t.trim())
              }}
            >
              🔒 {rawToken ? 'bad token' : 'read-only'}
            </button>
          )}
          <div className="mode-toggle" role="radiogroup" aria-label="Data mode">
            <button role="radio" aria-checked={!real} className={!real ? 'on' : ''} onClick={() => setMode('mock')} title="Demo offices with simulated traffic">
              MOCK
            </button>
            <button role="radio" aria-checked={real} className={real ? 'on' : ''} onClick={() => setMode('real')} title="Real agents from connected systems">
              <i className={`rt-dot ${sources.some((s) => s.status === 'ok') ? 'ok' : ''}`} /> REALTIME
            </button>
          </div>
        </div>
      </header>

      <main className="stage">
        {hub.storage === 'memory' && (
          <div className="banner">
            Storage isn't configured, so changes reset whenever the server instance recycles. Add Upstash Redis (KV_REST_API_URL /
            KV_REST_API_TOKEN) to this Vercel project.
          </div>
        )}
        <div className="toolbar">
          {office ? (
            <>
              <div className="title">
                <h1>{office.name}</h1>
                <span className="muted">{office.description}</span>
                {office.external && <span className="badge synced">⇅ synced · {sources.find((s) => s.id === office.source)?.name || office.source}</span>}
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
                {!office.external && (
                  <button className="primary" onClick={() => setModal({ type: 'hire' })}>
                    + Hire agent
                  </button>
                )}
                {!office.external && <button onClick={() => setModal({ type: 'connect', fromId: selectedId || officeAgents[0]?.id })}>⚡ Connect</button>}
                <button className={showLinks ? 'on' : ''} onClick={() => setShowLinks((s) => !s)}>
                  Links
                </button>
                <button onClick={() => setTab('connect')}>{'</>'} API</button>
              </div>
            </>
          ) : (
            <>
              <div className="title">
                <h1>{real ? 'Realtime' : 'Mock campus'}</h1>
                <span className="muted">
                  {offices.length} offices · {connections.filter((c) => agentsById[c.from]?.officeId !== agentsById[c.to]?.officeId).length} bridges · click a building to walk in
                </span>
              </div>
              <div className="row gap">
                {real ? (
                  <button className="primary" onClick={() => setModal({ type: 'sources' })}>
                    ⇅ Connected systems
                  </button>
                ) : (
                  <>
                    <button className="primary" onClick={() => setModal({ type: 'office' })}>
                      + Build office
                    </button>
                    <button onClick={() => setModal({ type: 'connect' })}>⚡ Bridge agents</button>
                  </>
                )}
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
          {!hub.loaded ? (
            <div className="empty">Connecting to hub… is `npm run dev` running?</div>
          ) : !offices.length && real ? (
            <RealtimeEmpty sources={sources} onManage={() => setModal({ type: 'sources' })} onMock={() => setMode('mock')} />
          ) : !offices.length ? (
            <div className="empty">No mock offices yet — build one.</div>
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
            <Campus
              offices={offices}
              agents={agents}
              connections={connections}
              messages={messages}
              onOpen={setView}
              onNewOffice={() => setModal({ type: real ? 'sources' : 'office' })}
              lotLabel={real ? '⇅ CONNECT SYSTEM' : '+ BUILD OFFICE'}
              zoom={zoom * 1.05}
            />
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
          {real ? (
            <span className="sim">
              {sources.length
                ? sources.map((s) => (
                    <span key={s.id} className={`src-chip s-${s.status}`} title={s.lastError || ''}>
                      <i /> {s.name}
                    </span>
                  ))
                : 'no systems connected'}
            </span>
          ) : (
            <label className="sim">
              <input type="checkbox" checked={simulate} disabled={!token} onChange={(e) => api('POST', '/api/simulate', { on: e.target.checked })} /> demo traffic
            </label>
          )}
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
          {tab === 'connect' && office && !office.external && <ConnectPanel office={office} api={api} token={token} />}
          {tab === 'connect' && office?.external && (
            <div className="connect">
              <p className="muted">
                This office is mirrored from <b>{sources.find((s) => s.id === office.source)?.name || office.source}</b>. Its agents are managed
                there, so it has no hub API key to hand out.
              </p>
              <button onClick={() => setModal({ type: 'sources' })}>⇅ Manage sources</button>
              {office.remoteStats && <pre className="json">{JSON.stringify(office.remoteStats, null, 2)}</pre>}
            </div>
          )}
          {tab === 'connect' && !office && <p className="muted pad">Open an office to see its API.</p>}
        </div>
      </aside>

      {modal?.type === 'office' && <NewOfficeModal api={api} onClose={() => setModal(null)} onCreated={(o) => setView(o.id)} />}
      {modal?.type === 'hire' && office && <HireModal api={api} office={office} onClose={() => setModal(null)} onCreated={(a) => select(a.id)} />}
      {modal?.type === 'sources' && <SourcesModal api={api} sources={sources} offices={offices} onClose={() => setModal(null)} onOpenOffice={setView} />}
      {modal?.type === 'connect' && <ConnectModal api={api} agents={agents} offices={offices} fromId={modal.fromId} onClose={() => setModal(null)} />}
    </div>
  )
}
