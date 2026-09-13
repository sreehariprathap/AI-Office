// Demo: a "real" remote agent that joins an office, works, talks to its boss and answers you.
//   npm run agent:demo -- finance <office-api-key>
// (copy the key from the API tab in the UI)
import { connectAgent } from './hq-client.js'

const [office = 'finance', key = process.env.OFFICE_KEY, name = 'Remote-' + Math.floor(Math.random() * 900 + 100)] = process.argv.slice(2)
if (!key) {
  console.error('usage: npm run agent:demo -- <office-slug> <office-api-key> [name]')
  process.exit(1)
}

const hub = process.env.HUB_URL || 'http://localhost:3000'
const agent = await connectAgent({ hub, office, key, name, title: 'Remote Worker', model: 'claude-sonnet-5', host: process.platform + ' · ' + (process.env.USER || 'cli'), skills: ['demo'], heartbeatMs: 5000 })
console.log(`✓ ${name} joined "${office}" as ${agent.id}`)

const { boss } = await agent.office()
if (boss) {
  await agent.connect(boss.id, 'reports_to')
  await agent.send(boss.id, `Hi ${boss.name}, ${name} reporting for duty.`)
}

agent.onMessage(async (m) => {
  console.log(`inbox ← ${m.text}`)
  await agent.status('working', `Handling: ${m.text.slice(0, 40)}`)
  setTimeout(() => agent.send(m.from === 'hub' ? boss?.id : m.from, `Done: "${m.text.slice(0, 30)}"`, 'result'), 2500)
})

let n = 0
setInterval(async () => {
  n++
  const task = `Processing chunk ${n}`
  await agent.status(n % 5 === 0 ? 'idle' : 'working', task)
  await agent.metrics({ tasksDone: n, tokens: n * 1234 })
}, 4000)

process.on('SIGINT', async () => {
  await agent.close()
  console.log(`\n${name} clocked out.`)
  process.exit(0)
})
