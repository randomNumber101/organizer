import { useState } from 'react'
import type { FormEvent } from 'react'
import { motion } from 'motion/react'
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
    <div className="login-screen">
      <motion.form className="login" onSubmit={submit} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
        <img src="/icon.svg" alt="" width={48} height={48} style={{ borderRadius: 12 }} />
        <div>
          <h1>Organizer</h1>
          <p>Dein Board, dein Tag, dein Kalender.</p>
        </div>
        <input type="text" name="username" autoComplete="username" value="organizer" readOnly hidden />
        <input className="field-input" type="password" autoComplete="current-password" placeholder="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        {error && (
          <motion.p className="error" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -5, 5, -3, 3, 0] }} transition={{ duration: 0.35 }}>
            {error}
          </motion.p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Einen Moment …' : 'Anmelden'}
        </button>
        <p className="muted small" style={{ marginTop: 18 }}>
          <a href="/datenschutz" style={{ color: 'inherit' }}>Datenschutz</a> · <a href="/nutzungsbedingungen" style={{ color: 'inherit' }}>Nutzungsbedingungen</a>
        </p>
      </motion.form>
    </div>
  )
}
