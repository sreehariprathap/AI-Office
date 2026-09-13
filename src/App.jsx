'use client'
import { useEffect, useMemo, useState } from 'react'
import { useHub } from './hub.js'
import { themeOf, STATUS_COLORS } from './world.js'
import TownMap from './components/TownMap.jsx'
import Building from './components/Building.jsx'
import OfficeFloor from './components/OfficeFloor.jsx'
import { Feed, AgentPanel, ConnectPanel } from './components/Sidebar.jsx'
import { Modal, NewOfficeModal, NewBuildingModal, HireModal, ConnectModal, SourcesModal } from './components/Modals.jsx'

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
    setView('map')
    if (token) api('POST', '/api/mode', { mode: m }).catch(() => {})
  }
  const real = mode === 'real'
  const inMode = (rec) => (real ? !!rec.external : !rec.external)
  const offices = useMemo(() => hub.offices.filter(inMode), [hub.offices, real])
  const agents = useMemo(() => hub.agents.filter(inMode), [hub.agents, real])
  const connections = useMemo(() => hub.connections.filter(inMode), [hub.connections, real])
  const messages = useMemo(() => hub.messages.filter(inMode), [hub.messages, real])
  const liveSources = real ? sources : []
  // A building is "real" when it's linked to a connected source, same rule
  // offices/agents already use via `external`.
  const buildings = useMemo(
    () => (hub.buildings || []).filter((b) => (real ? !!b.sourceId : !b.sourceId)),
    [hub.buildings, real],
  )

  // view is one flat id space, matching how office ids already worked here:
  // 'map' | a building's id | an office's id. Old sessions stored 'campus'
  // or a bare office id -- 'campus' maps forward to 'map', a bare office id
  // is already a value this scheme understands as-is.
  const [view, setView] = useState(() => {
    const raw = localStorage.getItem('hq:view')
    return !raw || raw === 'campus' ? 'map' : raw
  })
  const [selectedId, setSelectedId] = useState(null)
  const [tab, setTab] = useState('feed')
  const [modal, setModal] = useState(null) // {type, ...}
  const [showLinks, setShowLinks] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [, tick] = useState(0)
  // Mobile only (see the .side rules under the 1000px breakpoint in
  // styles.css) — on desktop .side is always visible in its own grid
  // column and this flag is never read. On mobile it's an off-canvas
  // bottom sheet: closed by default so the floor plan gets the full
  // screen, opened either by the toolbar toggle or by tapping a desk.
  const [sideOpen, setSideOpen] = useState(false)

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
  // Viewing a floor derives its building from the floor; viewing a building
  // directly (view holds the building's own id) looks it up straight.
  const building = office
    ? buildings.find((b) => b.id === office.buildingId) || null
    : buildings.find((b) => b.id === view) || null
  const buildingOffices = useMemo(
    () => (building ? offices.filter((o) => o.buildingId === building.id) : []),
    [building, offices],
  )
  useEffect(() => {
    if (view !== 'map' && offices.length && buildings.length && !office && !building) setView('map')
  }, [offices, buildings, office, building, view])

  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const officeAgents = useMemo(() => (office ? agents.filter((a) => a.officeId === office.id) : []), [agents, office])
  const scopeIds = useMemo(() => (office ? new Set(officeAgents.map((a) => a.id)) : null), [office, officeAgents])
  const selected = agentsById[selectedId]

  const goMap = () => { setSelectedId(null); setView('map') }
  // Shared by TownMap (building ids) and Building.jsx (office ids) -- both
  // live in the same id space, so one function routes either kind of click.
  // A landmark has nothing inside it, so it opens a card instead of a tower.
  const open = (id) => {
    const b = buildings.find((x) => x.id === id)
    if (b?.kind === 'landmark') return setModal({ type: 'landmark', building: b })
    setView(id)
  }

  const select = (id, jump = false) => {
    if (id === 'hire') return office && !office.external && setModal({ type: 'hire' })
    setSelectedId(id)
    if (id) {
      setTab('agent')
      // Tapping a desk on mobile should surface the panel immediately,
      // not require a second tap on the toolbar toggle to see who you
      // just picked.
      setSideOpen(true)
      if (jump && agentsById[id]) setView(agentsById[id].officeId)
    } else if (tab === 'agent') setTab('feed')
  }

  const online = agents.filter((a) => a.status !== 'offline').length
  const perMin = messages.filter((m) => Date.now() - m.ts < 60000).length
  const t = themeOf(office)

  return (
    <div className={`app mode-${mode}`} style={{ '--accent': office ? t.accent : real ? '#7fb4ff' : '#79e0a0' }}>
      <header className="topbar">
        <div className="brand" onClick={goMap}>
          <span className="logo">▣</span> WORLD OF WONDERS
        </div>
        <nav className="tabs">
          <button className={view === 'map' ? 'on' : ''} onClick={goMap}>
            🗺 Map
          </button>
          {building && (
            <>
              <span className="crumb">›</span>
              <button className={!office ? 'on' : ''} onClick={() => open(building.id)}>
                {building.name}
              </button>
            </>
          )}
          {building &&
            buildingOffices.map((o, i) => {
              const n = agents.filter((a) => a.officeId === o.id)
              const err = n.some((a) => a.status === 'error')
              return (
                <button key={o.id} className={view === o.id ? 'on' : ''} onClick={() => open(o.id)} style={{ '--tab': themeOf(o).wall }}>
                  <i className="swatch" />
                  <span className="floor-no">F{i + 1}</span>
                  {o.external && <span title={`Synced from ${o.source}`}>⇅</span>}
                  {o.name}
                  <span className="count">{n.length}</span>
                  {err && <span className="err-dot" title="An agent needs attention" />}
                </button>
              )
            })}
          {real && (
            <button className="add" onClick={() => setModal({ type: 'sources' })} title="Connect a system">
              ⇅
            </button>
          )}
          {!real && view === 'map' && token && (
            <button className="add" onClick={() => setModal({ type: 'building' })} title="Add a building">
              ＋
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
            <button role="radio" aria-checked={!real} className={!real ? 'on' : ''} disabled={!hub.loaded} onClick={() => setMode('mock')} title="Demo offices with simulated traffic">
              MOCK
            </button>
            <button role="radio" aria-checked={real} className={real ? 'on' : ''} disabled={!hub.loaded} onClick={() => setMode('real')} title="Real agents from connected systems">
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
                <h1>
                  F{buildingOffices.indexOf(office) + 1} · {office.name}
                </h1>
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
          ) : building ? (
            <>
              <div className="title">
                <h1>{building.name}</h1>
                <span className="muted">
                  {buildingOffices.length} floor{buildingOffices.length === 1 ? '' : 's'} ·{' '}
                  {connections.filter((c) => {
                    const a = agentsById[c.from]
                    const b = agentsById[c.to]
                    return a && b && a.officeId !== b.officeId && buildingOffices.some((o) => o.id === a.officeId)
                  }).length}{' '}
                  cross-floor links
                </span>
                {building.sourceId && <span className="badge synced">⇅ synced · {sources.find((s) => s.id === building.sourceId)?.name || 'connected system'}</span>}
              </div>
              <div className="row gap">
                {!building.sourceId && token && (
                  <>
                    <button className="primary" onClick={() => setModal({ type: 'office', buildingSlug: building.slug })}>
                      + Add floor
                    </button>
                    <button onClick={() => setModal({ type: 'connect' })}>⚡ Bridge agents</button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="title">
                <h1>{real ? 'World of Wonders' : 'Mock Town'}</h1>
                <span className="muted">
                  {buildings.length} building{buildings.length === 1 ? '' : 's'} · click one to walk in
                </span>
              </div>
              <div className="row gap">
                {real ? (
                  <button className="primary" onClick={() => setModal({ type: 'sources' })}>
                    ⇅ Connected systems
                  </button>
                ) : (
                  <button className="primary" onClick={() => setModal({ type: 'building' })} disabled={!token}>
                    + Add building
                  </button>
                )}
              </div>
            </>
          )}
          <div className="row gap zoom">
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
          </div>
          {/* Mobile-only (styles.css hides this above the 1000px breakpoint) --
              the desktop layout already shows .side as a permanent column. */}
          <button className="mobile-panel-toggle" onClick={() => setSideOpen((o) => !o)}>
            💬 Panel{selected && tab === 'agent' ? `: ${selected.name}` : ''}
          </button>
        </div>

        <div className="viewport">
          {!hub.loaded ? (
            <div className="empty">Connecting to hub… is `npm run dev` running?</div>
          ) : view === 'map' && !buildings.length && real ? (
            <RealtimeEmpty sources={sources} onManage={() => setModal({ type: 'sources' })} onMock={() => setMode('mock')} />
          ) : view === 'map' ? (
            <TownMap
              buildings={buildings}
              onOpen={open}
              onAddBuilding={() => setModal({ type: 'building' })}
              canAdd={!real && !!token}
              zoom={zoom}
            />
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
          ) : building ? (
            <Building
              key={building.id}
              building={building}
              offices={buildingOffices}
              agents={agents}
              messages={messages}
              onOpen={open}
              onSelectAgent={(id) => select(id, true)}
              onAddFloor={() => setModal({ type: 'office', buildingSlug: building.slug })}
              addLabel="+ ADD FLOOR"
              title={building.name}
              zoom={zoom * 1.15}
            />
          ) : (
            <div className="empty">Not found — <button className="link" onClick={goMap}>back to the map</button>.</div>
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

      {/* Mobile-only backdrop -- styles.css only ever shows .side-backdrop
          below the 1000px breakpoint, and only while sideOpen (this is
          conditionally rendered, not just CSS-hidden, so it can never
          eat a click on desktop). Tapping it closes the sheet, same as
          the explicit × button inside. */}
      {sideOpen && <div className="side-backdrop" onClick={() => setSideOpen(false)} />}

      <aside className={`side ${sideOpen ? 'open' : ''}`}>
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
          <button className="side-close" onClick={() => setSideOpen(false)} aria-label="Close panel">
            ×
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

      {modal?.type === 'office' && (
        <NewOfficeModal api={api} buildingSlug={modal.buildingSlug} onClose={() => setModal(null)} onCreated={(o) => setView(o.id)} />
      )}
      {modal?.type === 'hire' && office && <HireModal api={api} office={office} onClose={() => setModal(null)} onCreated={(a) => select(a.id)} />}
      {modal?.type === 'sources' && <SourcesModal api={api} sources={sources} offices={offices} onClose={() => setModal(null)} onOpenOffice={setView} />}
      {modal?.type === 'connect' && <ConnectModal api={api} agents={agents} offices={offices} fromId={modal.fromId} onClose={() => setModal(null)} />}
      {modal?.type === 'building' && (
        <NewBuildingModal
          api={api}
          onClose={() => setModal(null)}
          // `open(b.id)` would re-look-up the building in `buildings`, which
          // can still be the pre-creation snapshot at this exact instant
          // (this closure was captured when the modal was opened, before
          // the POST resolved) -- use the freshly created object directly.
          onCreated={(b) => (b.kind === 'landmark' ? setModal({ type: 'landmark', building: b }) : setView(b.id))}
        />
      )}
      {modal?.type === 'landmark' && (
        <Modal title={modal.building.name} onClose={() => setModal(null)}>
          <div className="pad">
            <p className="muted">{modal.building.description || 'A landmark. Nothing runs here.'}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
