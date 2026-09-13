'use client'
// The office is a live, browser-only canvas (localStorage, polling, SVG animation) — render it on the client.
import dynamic from 'next/dynamic'

const App = dynamic(() => import('../App.jsx'), { ssr: false })

export default function Page() {
  return <App />
}
