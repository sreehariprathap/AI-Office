// Every /api/* request lands here and is dispatched by the hub's own router (src/server/hub.js).
import { handle } from '@/server/hub'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Source syncs fetch a remote feed inside the request; leave headroom over the 8s fetch timeout.
export const maxDuration = 30

const dispatch = async (req, { params }) => handle(req, (await params).path)

export const GET = dispatch
export const POST = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
