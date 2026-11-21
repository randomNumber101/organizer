import { useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'

export default function Login() {
  const login = useStore((s) => s.login)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await login(password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Organizer</h1>
        {/* verstecktes Benutzerfeld, damit Passwort-Manager den Login speichern */}
        <input type="text" name="username" autoComplete="username" value="organizer" readOnly hidden />
        <label>
          Passwort
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
