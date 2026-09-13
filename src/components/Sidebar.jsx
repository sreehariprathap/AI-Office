import { Fragment, useEffect, useMemo, useState } from 'react'
import { lookOf, STATUS_COLORS, timeAgo, compact } from '../world.js'
import { Portrait } from '../sprites.jsx'

const STATUSES = ['working', 'idle', 'meeting', 'error', 'offline']

export function StatusPill({ status }) {
  return (
    <span className="pill" style={{ '--c': STATUS_COLORS[status] }}>
      <i /> {status}
    </span>
  )
}

function useCopy() {
  const [copied, setCopied] = useState(null)
  const copy = (text, key) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1200)
  }
  return [copied, copy]
}

// ---------------------------------------------------------------- feed
export function Feed({ messages, agentsById, onSelect, scopeIds }) {
  const list = useMemo(() => {
    const l = scopeIds ? messages.filter((m) => scopeIds.has(m.from) || scopeIds.has(m.to)) : messages
    return l.slice(-120).reverse()
  }, [messages, scopeIds])
  const name = (id) => (id === 'hub' ? 'YOU' : agentsById[id]?.name || (id ? '?' : 'all'))
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (!list.length) return <p className="muted pad">No chatter yet. Messages between agents stream in here live.</p>
  return (
    <ul className="feed">
      {list.map((m) => {
        const from = agentsById[m.from]
        const to = agentsById[m.to]
        const cross = from && to && from.officeId !== to.officeId
        return (
          <li key={m.id} className={`feed-item t-${m.type} ${cross ? 'cross' : ''}`}>
            <div className="feed-head">
              <button className="link" onClick={() => from && onSelect(from.id, true)}>
                {name(m.from)}
              </button>
              <span className="arrow">{m.type === 'handoff' ? '⇢' : '→'}</span>
              <button className="link" onClick={() => to && onSelect(to.id, true)}>
                {name(m.to)}
              </button>
              {cross && <span className="badge bridge">bridge</span>}
              <span className="time">{timeAgo(m.ts)}</span>
            </div>
            <div className="feed-text">{m.text}</div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- agent panel
export function AgentPanel({ agent, agents, offices, connections, messages, api, onSelect, onConnect }) {
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const look = useMemo(() => lookOf(agent), [agent.id, agent.name, agent.role])
  const office = offices.find((o) => o.id === agent.officeId)
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const links = connections.filter((c) => c.from === agent.id || c.to === agent.id)
  const convo = messages.filter((m) => m.from === agent.id || m.to === agent.id).slice(-30).reverse()
  const run = (p) => p.catch((e) => setErr(e.message))
  const patch = (body) => run(api('PATCH', `/api/agents/${agent.id}`, body))

  return (
    <div className="agent-panel">
      <div className="agent-hero">
        <Portrait look={look} size={84} />
        <div>
          <h2>
            {agent.role === 'boss' && <span className="crown">★</span>} {agent.name}
          </h2>
          <div className="muted">{agent.title || (agent.role === 'boss' ? 'Boss' : 'Worker')}</div>
          <div className="row gap">
            <StatusPill status={agent.status} />
            <span className="badge">{office?.name}</span>
          </div>
        </div>
      </div>

      {agent.task && (
        <div className="task">
          <span className="muted">current task</span>
          <div>{agent.task}</div>
        </div>
      )}

      <dl className="kv">
        <dt>model</dt>
        <dd>{agent.model || '—'}</dd>
        <dt>running on</dt>
        <dd>{agent.host || '—'}</dd>
        <dt>last seen</dt>
        <dd>{timeAgo(agent.lastSeen)}</dd>
        <dt>heartbeat</dt>
        <dd>{agent.heartbeatTtlSec ? `every <${agent.heartbeatTtlSec}s` : 'manual'}</dd>
        <dt>id</dt>
        <dd className="mono small">{agent.id}</dd>
      </dl>

      <div className="stats">
        <div>
          <b>{compact(agent.metrics?.tasksDone)}</b>
          <span>tasks</span>
        </div>
        <div>
          <b>{compact(agent.metrics?.tokens)}</b>
          <span>tokens</span>
        </div>
        <div>
          <b>${(agent.metrics?.costUsd || 0).toFixed(2)}</b>
          <span>cost</span>
        </div>
      </div>

      {!!agent.skills?.length && (
        <div className="chips">
          {agent.skills.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
      )}

      {agent.external && <MetaDetails meta={agent.meta} />}

      {agent.external ? (
        <p className="synced-note">⇅ Synced from <b>{agent.source}</b>. Read-only here; manage this agent in its own app.</p>
      ) : (
      <>
      <h3>Controls</h3>
      <div className="row gap wrap">
        <select value={agent.status} onChange={(e) => patch({ status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button onClick={() => patch({ role: agent.role === 'boss' ? 'worker' : 'boss' })}>{agent.role === 'boss' ? 'Demote' : 'Promote to boss'}</button>
        <select value={office?.slug} onChange={(e) => patch({ officeSlug: e.target.value })} title="Transfer to office">
          {offices.map((o) => (
            <option key={o.id} value={o.slug}>
              → {o.name}
            </option>
          ))}
        </select>
        <button onClick={() => onConnect(agent.id)}>+ Connect</button>
        <button
          className="danger"
          onClick={() => confirm(`Fire ${agent.name}? This removes the agent and its connections.`) && run(api('DELETE', `/api/agents/${agent.id}`).then(() => onSelect(null)))}
        >
          Fire
        </button>
      </div>
      </>
      )}

      <h3>Connections ({links.length})</h3>
      <ul className="links-list">
        {links.map((c) => {
          const other = byId[c.from === agent.id ? c.to : c.from]
          const out = c.from === agent.id
          const cross = other && other.officeId !== agent.officeId
          return (
            <li key={c.id}>
              <span className={`kind k-${c.kind}`}>{c.kind.replace('_', ' ')}</span>
              <span>{out ? '→' : '←'}</span>
              <button className="link" onClick={() => other && onSelect(other.id, true)}>
                {other?.name || '?'}
              </button>
              {cross && <span className="badge bridge">{offices.find((o) => o.id === other.officeId)?.name}</span>}
              {c.label && <span className="muted small">“{c.label}”</span>}
              {!c.external && <button className="x" title="Remove" onClick={() => run(api('DELETE', `/api/connections/${c.id}`))}>
                ×
              </button>}
            </li>
          )
        })}
        {!links.length && <li className="muted">No connections yet.</li>}
      </ul>

      {!agent.external && <h3>Talk to {agent.name}</h3>}
      {!agent.external && (
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          run(api('POST', '/api/messages', { from: 'hub', to: agent.id, text: draft.trim(), type: 'instruction' }).then(() => setDraft('')))
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Send an instruction (lands in its inbox)…" />
        <button className="primary">Send</button>
      </form>
      )}
      {agent.external && <h3>Recent activity</h3>}
      {err && <p className="error">{err}</p>}

      <ul className="feed compact">
        {convo.map((m) => (
          <li key={m.id} className={`feed-item t-${m.type}`}>
            <div className="feed-head">
              <b>{m.from === 'hub' ? 'YOU' : byId[m.from]?.name || '?'}</b>
              <span className="arrow">→</span>
              <b>{m.to === 'hub' ? 'YOU' : byId[m.to]?.name || '—'}</b>
              <span className="time">{timeAgo(m.ts)}</span>
            </div>
            <div className="feed-text">{m.text}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Source-provided details (e.g. seed capital, book value, state) — rendered generically.
function MetaDetails({ meta }) {
  if (!meta) return null
  const label = (k) => k.replace(/([A-Z])/g, ' $1').toLowerCase()
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v))
  const entries = Object.entries(meta).filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object' && k !== 'description')
  return (
    <>
      <h3>Details</h3>
      {meta.description && <p className="small muted">{meta.description}</p>}
      <dl className="kv">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{label(k)}</dt>
            <dd>{fmt(v)}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  )
}

// ---------------------------------------------------------------- connect / API panel
export function ConnectPanel({ office, api, token }) {
  const [copied, copy] = useCopy()
  const [preview, setPreview] = useState(null)
  const [reveal, setReveal] = useState(false)
  const origin = window.location.origin
  const url = `${origin}/api/offices/${office.slug}`

  useEffect(() => {
    let alive = true
    const load = () => api('GET', `/api/offices/${office.slug}`).then((d) => alive && setPreview(d)).catch(() => {})
    load()
    const t = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [office.slug])

  const key = office.apiKey || '<office-api-key>'
  const shown = reveal ? key : key.slice(0, 8) + '•'.repeat(16)

  const snippets = {
    'office (GET)': `curl ${url}`,
    'register agent': `curl -X POST ${url}/agents \\
  -H "x-office-key: ${key}" -H "content-type: application/json" \\
  -d '{"name":"Ada","role":"worker","title":"Analyst","model":"claude-sonnet-5","host":"my-laptop","skills":["sql"],"heartbeatTtlSec":60}'`,
    heartbeat: `curl -X POST ${origin}/api/agents/<AGENT_ID>/heartbeat \\
  -H "x-office-key: ${key}" -H "content-type: application/json" \\
  -d '{"status":"working","task":"Reconciling March","metrics":{"tasksDone":12}}'`,
    'send message': `curl -X POST ${origin}/api/messages \\
  -H "x-office-key: ${key}" -H "content-type: application/json" \\
  -d '{"from":"<AGENT_ID>","to":"<OTHER_AGENT_ID>","text":"Handoff ready","type":"handoff"}'`,
    'read inbox': `curl "${origin}/api/agents/<AGENT_ID>/inbox?since=0" -H "x-office-key: ${key}"`,
    'node client': `// npm run agent:demo -- ${office.slug} ${key}
import { connectAgent } from './examples/hq-client.js'
const agent = await connectAgent({
  hub: '${origin}', office: '${office.slug}', key: '${key}',
  name: 'Ada', title: 'Analyst', model: 'claude-sonnet-5',
})
agent.status('working', 'Crunching numbers')
agent.onMessage((m) => agent.send(m.from, 'On it!'))`,
  }

  return (
    <div className="connect">
      <p className="muted">
        Every office is an API. Point any agent — local script, cloud function, n8n flow, Claude Code session — at this endpoint and it
        takes a seat on the floor.
      </p>
      <label>Endpoint</label>
      <div className="copyline">
        <code>{url}</code>
        <button onClick={() => copy(url, 'url')}>{copied === 'url' ? '✓' : 'copy'}</button>
      </div>
      <label>Office API key</label>
      <div className="copyline">
        <code>{office.apiKey ? shown : 'hidden (open the hub from localhost)'}</code>
        {office.apiKey && <button onClick={() => setReveal((r) => !r)}>{reveal ? 'hide' : 'show'}</button>}
        {office.apiKey && <button onClick={() => copy(key, 'key')}>{copied === 'key' ? '✓' : 'copy'}</button>}
        {token && (
          <button className="danger" onClick={() => confirm('Rotate key? Connected agents will need the new key.') && api('POST', `/api/offices/${office.slug}/keys/rotate`)}>
            rotate
          </button>
        )}
      </div>

      {Object.entries(snippets).map(([k, v]) => (
        <details key={k} open={k === 'office (GET)'}>
          <summary>
            {k}
            <button
              onClick={(e) => {
                e.preventDefault()
                copy(v, k)
              }}
            >
              {copied === k ? '✓' : 'copy'}
            </button>
          </summary>
          <pre>{v}</pre>
        </details>
      ))}

      <label>
        Live response · <span className="muted">GET {`/api/offices/${office.slug}`}</span>
      </label>
      <pre className="json">{preview ? JSON.stringify(trimPreview(preview), null, 2) : 'loading…'}</pre>
    </div>
  )
}

// Keep the preview readable: summarize agents to the fields people scan for.
function trimPreview(p) {
  const brief = (a) => a && { id: a.id, name: a.name, role: a.role, title: a.title, status: a.status, model: a.model, host: a.host, task: a.task }
  const { apiKey, ...rest } = p
  return {
    officeName: rest.officeName,
    numberOfAgents: rest.numberOfAgents,
    online: rest.online,
    boss: brief(rest.boss),
    workers: rest.workers.map(brief),
    connections: rest.connections.map((c) => ({ from: c.fromName, to: c.toName, kind: c.kind, crossOffice: c.crossOffice, label: c.label })),
    stats: rest.stats,
    agents: `[${rest.agents.length} full agent records]`,
  }
}
