import { useState } from 'react'
import { THEMES } from '../world.js'

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function useSubmit(onClose) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (fn) => async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await fn()
      onClose()
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }
  return { err, busy, submit }
}

export function NewOfficeModal({ api, onClose, onCreated }) {
  const [f, setF] = useState({ name: '', theme: 'amber', floor: 'carpet', description: '' })
  const { err, busy, submit } = useSubmit(onClose)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="Build a new office" onClose={onClose}>
      <form
        className="form"
        onSubmit={submit(async () => {
          const o = await api('POST', '/api/offices', f)
          onCreated?.(o)
        })}
      >
        <label>Office name</label>
        <input autoFocus required value={f.name} onChange={set('name')} placeholder="e.g. Research, Support, Marketing" />
        <label>Description</label>
        <input value={f.description} onChange={set('description')} placeholder="What does this office do?" />
        <label>Wall paint</label>
        <div className="swatches">
          {Object.entries(THEMES).map(([k, t]) => (
            <button type="button" key={k} className={f.theme === k ? 'on' : ''} style={{ background: t.wall }} onClick={() => setF({ ...f, theme: k })} title={k} />
          ))}
        </div>
        <label>Floor</label>
        <select value={f.floor} onChange={set('floor')}>
          {['carpet', 'tile', 'checker', 'wood'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>
          Build office
        </button>
        <p className="muted small">You get an endpoint + API key. Agents that register with it appear on the new floor.</p>
      </form>
    </Modal>
  )
}

export function HireModal({ api, office, onClose, onCreated }) {
  const [f, setF] = useState({ name: '', role: 'worker', title: '', model: 'claude-sonnet-5', host: '', skills: '', heartbeatTtlSec: 0 })
  const { err, busy, submit } = useSubmit(onClose)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title={`Hire into ${office.name}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={submit(async () => {
          const a = await api('POST', `/api/offices/${office.slug}/agents`, {
            ...f,
            skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
            heartbeatTtlSec: Number(f.heartbeatTtlSec) || 0,
            status: Number(f.heartbeatTtlSec) ? 'offline' : 'working',
          })
          onCreated?.(a)
        })}
      >
        <div className="grid2">
          <div>
            <label>Name</label>
            <input autoFocus required value={f.name} onChange={set('name')} placeholder="Ada" />
          </div>
          <div>
            <label>Role</label>
            <select value={f.role} onChange={set('role')}>
              <option value="worker">worker</option>
              <option value="boss">boss (gets a suite)</option>
            </select>
          </div>
          <div>
            <label>Title</label>
            <input value={f.title} onChange={set('title')} placeholder="Invoice Parser" />
          </div>
          <div>
            <label>Model</label>
            <input value={f.model} onChange={set('model')} />
          </div>
          <div>
            <label>Runs on</label>
            <input value={f.host} onChange={set('host')} placeholder="macbook / aws lambda / n8n" />
          </div>
          <div>
            <label>Heartbeat TTL (s)</label>
            <input type="number" min="0" value={f.heartbeatTtlSec} onChange={set('heartbeatTtlSec')} title="0 = placeholder agent that never goes offline" />
          </div>
        </div>
        <label>Skills (comma separated)</label>
        <input value={f.skills} onChange={set('skills')} placeholder="sql, pdf, forecasting" />
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>
          Hire agent
        </button>
        <p className="muted small">Set a heartbeat TTL for a real remote agent — it shows offline until it checks in via the API.</p>
      </form>
    </Modal>
  )
}

export function ConnectModal({ api, agents, offices, fromId, onClose }) {
  const [f, setF] = useState({ from: fromId || agents[0]?.id, to: '', kind: 'collab', label: '' })
  const { err, busy, submit } = useSubmit(onClose)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const from = agents.find((a) => a.id === f.from)
  const to = agents.find((a) => a.id === f.to)
  const cross = from && to && from.officeId !== to.officeId
  const group = (list) =>
    offices.map((o) => (
      <optgroup key={o.id} label={o.name}>
        {list
          .filter((a) => a.officeId === o.id)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.role === 'boss' ? '★ ' : ''}
              {a.name}
            </option>
          ))}
      </optgroup>
    ))
  return (
    <Modal title="Wire a connection" onClose={onClose}>
      <form className="form" onSubmit={submit(() => api('POST', '/api/connections', f))}>
        <label>From</label>
        <select value={f.from} onChange={set('from')}>
          {group(agents)}
        </select>
        <label>To</label>
        <select required value={f.to} onChange={set('to')}>
          <option value="">— pick an agent (any office) —</option>
          {group(agents.filter((a) => a.id !== f.from))}
        </select>
        <label>Kind</label>
        <select value={cross ? 'bridge' : f.kind} onChange={set('kind')} disabled={cross}>
          <option value="reports_to">reports to</option>
          <option value="collab">collaborates</option>
          <option value="data">data handoff</option>
          <option value="bridge">bridge (cross-office)</option>
        </select>
        {cross && <p className="muted small">Different offices → this becomes a bridge and shows up on the campus map.</p>}
        <label>Label</label>
        <input value={f.label} onChange={set('label')} placeholder="e.g. invoice feed" />
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>
          Connect
        </button>
      </form>
    </Modal>
  )
}
