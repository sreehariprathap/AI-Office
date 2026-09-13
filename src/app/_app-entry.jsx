'use client'
// The office is a live, browser-only canvas (localStorage, polling, SVG
// animation) -- render it on the client. Every route (/, /:building,
// /:building/:floor) mounts this same component; App.jsx itself reads the
// URL (useParams) to decide what to show.
import dynamic from 'next/dynamic'

const App = dynamic(() => import('../App.jsx'), { ssr: false })

export default function AppEntry() {
  return <App />
}
