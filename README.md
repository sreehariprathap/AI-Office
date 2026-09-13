# ▣ Agent HQ

A pixel-art office for all your running AI agents. Each **office** is a floor with boss suites, a meeting room, a break room and a workroom. Every agent gets a desk, and the floor adds seats and rows as you hire more. Agents walk to the meeting room when they sync, go to the break room when idle, and fade out when they stop sending heartbeats. Messages fly between desks as envelopes, and cross-office traffic travels over the bridges on the **campus** map.

Every office is also an **API**. Point any agent at it (a local script, a cloud function, n8n, a Claude Code session) and that agent gets a seat on the floor.

## Run

```bash
npm install
npm run dev        # hub on :8787 + UI on :5173
```

Open http://localhost:5173. The demo world (Finance, Development, Sales) runs with simulated traffic. Turn off **demo traffic** in the footer to see only real agents.

Production: `npm run build && npm start`. The hub then serves the UI at :8787.

State is saved to `data/hub.json`. Delete that file to reseed the demo world.

## Connect a real agent

1. Open an office, go to **API**, and copy the office key.
2. `npm run agent:demo -- finance <office-key>`

The demo agent joins Finance, reports to the boss and heartbeats every 5 seconds. It also replies to anything you send it from the **Agent** tab.

```js
import { connectAgent } from './examples/hq-client.js'
const agent = await connectAgent({ hub: 'http://localhost:8787', office: 'finance', key, name: 'Ada', title: 'Analyst' })
agent.status('working', 'Reconciling March')
agent.send(otherId, 'Handoff ready', 'handoff')
agent.onMessage((m) => agent.send(m.from, 'On it'))
```

## API

Auth: `x-office-key` for office-scoped writes. The `x-hub-token` admin token is handed to browsers on localhost via `/api/session`. GETs are open, but office keys are hidden unless you authenticate.

| Method | Path | What |
|---|---|---|
| GET | `/api/hub` | All offices: counts, bosses, cross-office bridges |
| GET | `/api/offices/:slug` | **Office payload** (see below) |
| POST | `/api/offices` | Build an office `{name, theme, floor, description}` (admin) |
| PATCH/DELETE | `/api/offices/:slug` | Edit or demolish (admin) |
| POST | `/api/offices/:slug/keys/rotate` | New office key (admin) |
| POST | `/api/offices/:slug/agents` | Register an agent. Idempotent by name. `{name, role: boss\|worker, title, model, host, skills, heartbeatTtlSec}` |
| GET/PATCH/DELETE | `/api/agents/:id` | Agent detail (with connections and recent messages), update, fire |
| POST | `/api/agents/:id/heartbeat` | `{status: working\|idle\|meeting\|error\|offline, task, metrics}` |
| GET | `/api/agents/:id/inbox?since=ts` | Messages addressed to the agent |
| POST/DELETE | `/api/connections` | `{from, to, kind: reports_to\|collab\|data\|bridge, label}`. Links across offices automatically become `bridge` |
| GET/POST | `/api/messages` | `{from: agentId\|"hub", to, text, type}`. Filter the GET with `?office=` or `?agent=` |
| GET | `/api/events` | Server-Sent Events: `snapshot`, `agent`, `office`, `connection`, `message`, … |

`GET /api/offices/finance` returns:

```jsonc
{
  "officeName": "Finance",
  "numberOfAgents": 8,
  "online": 7,
  "boss":    { "id": "…", "name": "Ledger Prime", "title": "CFO Agent", "status": "working", "model": "…", "host": "…", … },
  "bosses":  [ … ],
  "workers": [ { "name": "Penny", "title": "Invoice Parser", "status": "working", "task": "…", "skills": […], "metrics": {…}, "lastSeen": … }, … ],
  "agents":  [ …every agent, full record… ],
  "connections": [ { "fromName": "Penny", "toName": "Abacus", "kind": "data", "crossOffice": false, "label": "parsed invoices" }, … ],
  "stats": { "working": 4, "idle": 1, "meeting": 1, "error": 1, "offline": 1, "tasksDone": 812, "tokens": 12400000, "costUsd": 143.2, "messages24h": 311 },
  "endpoint": "/api/offices/finance"
}
```

Agents with `heartbeatTtlSec > 0` are marked offline if they miss a heartbeat for that long.

## Layout

```
server/index.js      hub: REST, SSE, auth, offline sweeper, simulator, persistence (no deps)
server/seed.js       demo world
src/world.js         themes, seeded agent looks, floor-plan layout engine
src/sprites.jsx      SVG pixel art (people, desks, plants…)
src/components/      Campus, OfficeFloor, Sidebar (comms/agent/API), Modals
examples/            hq-client.js SDK + runnable demo agent
```
