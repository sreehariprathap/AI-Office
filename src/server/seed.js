// Demo world used on first boot (and by POST /api/reset).
import { randomUUID } from 'node:crypto'
import { createBuilding } from './buildings.js'

const key = () => 'ofk_' + randomUUID().replace(/-/g, '')

export function buildSeed() {
  const now = Date.now()
  const offices = [
    { slug: 'finance', name: 'Finance', theme: 'emerald', floor: 'carpet', description: 'Ledgers, forecasts, invoice reconciliation.' },
    { slug: 'development', name: 'Development', theme: 'cobalt', floor: 'tile', description: 'Code agents shipping PRs around the clock.' },
    { slug: 'sales', name: 'Sales', theme: 'crimson', floor: 'checker', description: 'Outreach, lead scoring and CRM hygiene.' },
  ].map((o) => ({ id: randomUUID(), apiKey: key(), createdAt: now, ...o }))

  // Mock mode is a town too: one workspace building holding the demo floors,
  // plus a landmark so the map shows both kinds from first boot.
  const seedWorld = { buildings: [], offices, sources: [] }
  const headquarters = createBuilding(seedWorld, {
    name: 'Head Office',
    sprite: 'tower',
    theme: 'slate',
    description: 'Where the demo team works.',
  })
  createBuilding(seedWorld, {
    name: 'Cafe',
    kind: 'landmark',
    sprite: 'cafe',
    theme: 'amber',
    description: 'Nothing runs here. It just makes the street feel lived-in.',
  })
  offices.forEach((o) => { o.buildingId = headquarters.id })
  const buildings = seedWorld.buildings

  const [fin, dev, sales] = offices
  const agents = []
  const add = (office, a) => {
    const agent = {
      id: randomUUID(),
      officeId: office.id,
      role: 'worker',
      status: 'working',
      model: 'claude-sonnet-5',
      host: 'local',
      skills: [],
      task: '',
      metrics: { tasksDone: Math.floor(Math.random() * 200), tokens: Math.floor(Math.random() * 4e6), costUsd: +(Math.random() * 40).toFixed(2), uptimeSec: Math.floor(Math.random() * 86400) },
      heartbeatTtlSec: 0, // 0 = never auto-offline (demo agents)
      createdAt: now,
      lastSeen: now,
      meta: {},
      ...a,
    }
    agents.push(agent)
    return agent
  }

  const finBoss = add(fin, { name: 'Ledger Prime', role: 'boss', title: 'CFO Agent', model: 'claude-opus-5', host: 'aws · us-east-1', skills: ['planning', 'approvals', 'forecasting'], task: 'Approving Q3 budget' })
  const finW = [
    add(fin, { name: 'Penny', title: 'Invoice Parser', host: 'macbook-pro', skills: ['ocr', 'pdf'], task: 'Parsing 42 vendor invoices' }),
    add(fin, { name: 'Abacus', title: 'Reconciler', host: 'gcp · run', skills: ['sql', 'matching'], task: 'Matching bank txns' }),
    add(fin, { name: 'Tally', title: 'Expense Auditor', host: 'raspberry-pi', skills: ['policy', 'anomaly'], status: 'idle' }),
    add(fin, { name: 'Quant', title: 'Forecaster', model: 'claude-opus-5', host: 'aws · lambda', skills: ['timeseries'], task: 'Cashflow forecast v7' }),
    add(fin, { name: 'Mint', title: 'Payroll Runner', host: 'on-prem', skills: ['payroll'], status: 'meeting', task: 'Syncing with Ledger Prime' }),
    add(fin, { name: 'Vault', title: 'Compliance Bot', model: 'claude-haiku-4-5', host: 'azure', skills: ['kyc', 'sox'], status: 'error', task: 'Auth token expired' }),
    add(fin, { name: 'Coin', title: 'FX Watcher', model: 'claude-haiku-4-5', host: 'cloudflare · worker', skills: ['fx', 'alerts'], status: 'offline' }),
  ]

  const devBoss = add(dev, { name: 'Architect', role: 'boss', title: 'Tech Lead Agent', model: 'claude-opus-5', host: 'claude.ai/code', skills: ['review', 'design'], task: 'Reviewing PR #812' })
  const devW = [
    add(dev, { name: 'Forge', title: 'Backend Coder', host: 'devbox-01', skills: ['node', 'postgres'], task: 'Implementing /invoices API' }),
    add(dev, { name: 'Pixel', title: 'Frontend Coder', host: 'devbox-02', skills: ['react', 'css'], task: 'Building dashboard' }),
    add(dev, { name: 'Sentinel', title: 'Test Runner', model: 'claude-haiku-4-5', host: 'github actions', skills: ['ci', 'e2e'], task: 'Running 1,204 tests' }),
    add(dev, { name: 'Patch', title: 'Bug Hunter', host: 'macbook-pro', skills: ['debugging'], status: 'idle' }),
    add(dev, { name: 'Docker', title: 'DevOps', host: 'k8s · prod', skills: ['deploy', 'infra'], status: 'meeting', task: 'Deploy window sync' }),
  ]

  const salesBoss = add(sales, { name: 'Closer', role: 'boss', title: 'VP Sales Agent', model: 'claude-opus-5', host: 'hubspot app', skills: ['strategy'], task: 'Pipeline review' })
  const salesW = [
    add(sales, { name: 'Scout', title: 'Lead Researcher', host: 'n8n', skills: ['web', 'enrich'], task: 'Enriching 300 leads' }),
    add(sales, { name: 'Pitch', title: 'Email Writer', host: 'zapier', skills: ['copy'], status: 'idle' }),
    add(sales, { name: 'Ringo', title: 'Call Summarizer', model: 'claude-haiku-4-5', host: 'twilio', skills: ['asr', 'summaries'], task: 'Summarizing call #1182' }),
  ]

  const connections = []
  const link = (from, to, kind, label = '') => connections.push({ id: randomUUID(), from: from.id, to: to.id, kind, label, createdAt: now })
  finW.forEach((w) => link(w, finBoss, 'reports_to'))
  devW.forEach((w) => link(w, devBoss, 'reports_to'))
  salesW.forEach((w) => link(w, salesBoss, 'reports_to'))
  link(finW[0], finW[1], 'data', 'parsed invoices')
  link(finW[1], finW[3], 'data', 'ledger feed')
  link(devW[0], devW[2], 'collab', 'PR checks')
  link(devW[1], devW[2], 'collab')
  link(salesW[0], salesW[1], 'data', 'lead dossiers')
  // cross-office bridges
  link(salesBoss, finBoss, 'bridge', 'deal approvals')
  link(devW[0], finW[1], 'bridge', 'invoices API')
  link(salesW[2], devW[3], 'bridge', 'bug reports from calls')

  return { buildings, offices, agents, connections, messages: [] }
}
