'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function LoginForm() {
  const params = useSearchParams()
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: value }),
      })
      if (!r.ok) throw new Error()
      // Full navigation, not client-side routing: the app's own state
      // (hub.js, App.jsx) should mount fresh under the now-valid cookie
      // rather than reuse anything from the logged-out render.
      window.location.href = params.get('next') || '/'
    } catch {
      setErr('That token was rejected — paste HUB_ADMIN_TOKEN again.')
      setValue('')
      setBusy(false)
    }
  }

  return (
    <form className="login-card form" onSubmit={submit}>
      <div className="brand">
        <span className="logo">▣</span> WORLD OF WONDERS
      </div>
      <label>Admin token</label>
      <input
        autoFocus
        required
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="HUB_ADMIN_TOKEN"
      />
      {err && <p className="error">{err}</p>}
      <button className="primary" disabled={busy || !value}>
        Log in
      </button>
    </form>
  )
}
