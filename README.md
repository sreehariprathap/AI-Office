# ▣ Agent HQ

A pixel-art office for all your running AI agents. Each **office** is a floor with boss suites, a meeting room, a break room and a workroom. Every agent gets a desk, and the floor adds seats and rows as you hire more. Agents walk to the meeting room when they sync, go to the break room when idle, and fade out when they stop sending heartbeats. Messages fly between desks as envelopes, and cross-office traffic travels over the bridges on the **campus** map.

Every office is also an **API**. Point any agent at it (a local script, a cloud function, n8n, a Claude Code session) and that agent gets a seat on the floor.

## Run

It's one Next.js app: the UI and the hub API (`/api/*`) share a codebase and deploy together.

```bash
npm install
cp .env.example .env   # optional: WORKFORCE_TOKEN, HUB_ADMIN_TOKEN, …
npm run dev            # http://localhost:3000
```

Locally, state is saved to `data/hub.json`. Delete that file to reseed the demo world. Production build: `npm run build && npm start`.

## Deploy to Vercel

1. Import the repo into Vercel. The framework is detected as Next.js, so no config is needed.
2. **Storage:** add the **Upstash Redis** integration from the Vercel Marketplace. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the hub stores its world there. Without it, a deployment still runs, but keeps data only in memory and shows a warning banner.
3. **Env vars:**
   - `HUB_ADMIN_TOKEN`: a long random string. A deployment never hands out the admin token, so paste this into the UI's 🔒 prompt to make changes.
   - `WORKFORCE_URL` and `WORKFORCE_TOKEN`: the AI Workforce feed for Realtime mode.
4. Deploy.

**How the hub runs serverless:** nothing lives in memory between requests. Each API call loads the world, catches up on time-based work, runs the route, and saves only if something changed. Time-based work means marking silent agents offline, replaying the mock simulator's missed steps, and syncing any source whose poll interval has passed. Redis writes are compare-and-set on a version number, so concurrent invocations retry instead of overwriting each other. The UI polls `GET /api/state?v=<version>` every 2s, and gets `{"unchanged": true}` back when nothing moved.

## Modes: Mock and Realtime

The toggle in the top-right corner switches between two separate worlds. Your choice is saved in the hub.

- **MOCK:** the demo offices and any agents you hire by hand. Only this mode runs simulated traffic.
- **REALTIME:** only real agents mirrored from connected systems. Today that's just Sreehari's AI Workforce, configured in `.env`:

```bash
cp .env.example .env
# WORKFORCE_URL=https://161-35-48-14.sslip.io/api/office/snapshot
# WORKFORCE_TOKEN=<the OFFICE_FEED_TOKEN set on the workforce backend>
```

Until the feed answers, Realtime shows why it's waiting. The two worlds never mix: links between a mock agent and a real-time agent are rejected. `GET /api/hub` and `GET /api/offices` follow the current mode, or take `?mode=mock|real`, and `POST /api/mode {"mode": …}` switches it.

## Connect a real agent

1. Open an office, go to **API**, and copy the office key.
2. `npm run agent:demo -- finance <office-key>`

The demo agent joins Finance, reports to the boss and heartbeats every 5 seconds. It also replies to anything you send it from the **Agent** tab.

```js
import { connectAgent } from './examples/hq-client.js'
const agent = await connectAgent({ hub: 'http://localhost:3000', office: 'finance', key, name: 'Ada', title: 'Analyst' })
agent.status('working', 'Reconciling March')
agent.send(otherId, 'Handoff ready', 'handoff')
agent.onMessage((m) => agent.send(m.from, 'On it'))
```

## Connected systems (sources)

The hub can mirror agents from other apps. A **source** is any HTTP endpoint that returns an `agent-hq/v1` snapshot. The hub polls it, namespaces every id, and draws each office it reports as a floor, marked ⇅ in the tabs. Synced agents are read-only in the hub, because the source owns them. Their messages still animate on the floor and in Comms.

Connect one from the UI (**⇅ sources** in the top bar, or **Connect a system** on the campus), or with environment variables:

```bash
WORKFORCE_URL=https://<workforce-backend>/api/office/snapshot WORKFORCE_TOKEN=<OFFICE_FEED_TOKEN> npm run dev
```

The API works too: `GET/POST /api/sources`, `PATCH/DELETE /api/sources/:id` and `POST /api/sources/:id/sync`, all with `x-hub-token`.

Snapshot shape (only `offices[].slug` and `agents[].id` are required):

```jsonc
{
  "protocol": "agent-hq/v1",
  "source": { "id": "ai-workforce", "name": "…" },
  "offices": [{
    "slug": "wf-india", "name": "India Desk", "theme": "amber", "floor": "carpet", "description": "…",
    "agents": [{ "id": "…", "name": "…", "shortName": "SWING #1", "role": "boss|worker", "title": "…",
                 "status": "working|idle|meeting|error|offline", "task": "…", "model": "…", "host": "…",
                 "skills": […], "metrics": { "tasksDone": 0, "tokens": 0, "costUsd": 0 }, "meta": { … } }],
    "connections": [{ "from": "<agent id>", "to": "<agent id>", "kind": "reports_to|collab|data|bridge", "label": "…" }],
    "stats": { … }
  }],
  "messages": [{ "id": "…", "from": "<agent id>", "to": "<agent id>", "type": "message|handoff|result", "text": "…", "ts": "ISO-8601" }]
}
```

- **Incremental messages:** the hub sends `?since=<ISO>` so a source can return only newer messages. Offices and agents are always sent in full; anything missing from a snapshot is removed from the hub.
- **Unreachable source:** after 3 failed polls, that source's agents show offline until it responds again.
- **Empty start:** set `HUB_SEED=none` for a first boot without the demo offices, or call `POST /api/reset` with `{"mode":"empty"}`. Reset keeps synced offices.

### Sreehari's AI Workforce

`dashboard/backend/office_feed.py` in the workforce repo serves `GET /api/office/snapshot`. It reads every market DB (Canada, India, Crypto, Forex), without price-feed or LLM calls, and maps:

| Workforce | Office |
|---|---|
| market (region DB) | office `wf-<region>` |
| Market Orchestrator | boss (red when its kill switch is on or its last cycle failed) |
| live slot | worker, named like the dashboard (`A-INDIA-SWING-DISCRETIONARY-#1`) |
| slot state | ACTIVE/WARMUP → working (idle when stale), PAUSED/COOLDOWN → idle, SPAWNING/PAYOUT → meeting, HALTED/registry error → error, disabled strategy → offline |
| spawn parent → child | `reports_to` connection |
| trades, spawn/halt/payout events | messages to the orchestrator |

It requires the `OFFICE_FEED_TOKEN` env var, sent as the `x-office-feed-token` header. An admin bearer token also works. Options: `include_dead=true` shows retired agents, and `include_experiments=true` adds the Experiments lab.

## API

Auth: the whole UI sits behind `/login` — one shared `HUB_ADMIN_TOKEN`, checked by `src/proxy.js` via an httpOnly session cookie (30 days, with a Log out button in the topbar). Running locally (`next dev`/`next start` on `localhost`) skips the login screen automatically, same as before. Agents authenticate separately and per-office via `x-office-key` on `/api/*` — unaffected by the login screen, which only gates page navigation.

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
| GET | `/api/state?v=` | Everything the UI draws in one payload, or `{unchanged:true}` if the version hasn't moved |

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
src/app/                 Next.js App Router: layout, page, and api/[...path]/route.js (every /api/* call)
src/server/hub.js        hub API: routes, auth, views, offline sweep, mock simulator, per-request catch-up
src/server/store.js      persistence: Upstash Redis (compare-and-set) · data/hub.json · in-memory fallback
src/server/sources.js    connected systems (agent-hq/v1 snapshots), synced inside requests
src/server/seed.js       demo world
src/App.jsx, src/hub.js  client shell + polling state hook
src/world.js             themes, seeded agent looks, floor-plan layout engine
src/sprites.jsx          SVG pixel art (people, desks, plants…)
src/components/          Campus, OfficeFloor, Sidebar (comms/agent/API), Modals
examples/                hq-client.js SDK + runnable demo agent
```
