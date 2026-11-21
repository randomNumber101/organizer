import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, Check as CheckIcon, Download, LogOut, RefreshCw, Unplug, X } from 'lucide-react'
import { useStore } from '../store'
import { useIsMobile } from '../hooks/useMedia'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

let installEvent: BeforeInstallPromptEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e as BeforeInstallPromptEvent
})

/** Einstellungen: Google Kalender, App installieren, Abmelden */
export default function SettingsSheet() {
  const open = useStore((s) => s.settingsOpen)
  const setSettings = useStore((s) => s.setSettings)
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setSettings(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setSettings])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSettings(false)} />
          <motion.aside
            key="sheet"
            className="sheet"
            role="dialog"
            aria-label="Einstellungen"
            initial={isMobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <div className="sheet-grab" />
            <div className="sheet-head">
              <span className="crumb" style={{ color: 'var(--text)', fontWeight: 650, fontSize: 15 }}>
                Einstellungen
              </span>
              <button className="icon-btn" aria-label="Schließen" onClick={() => setSettings(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="sheet-body">
              <GoogleSection />
              <AppSection />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function GoogleSection() {
  const google = useStore((s) => s.google)
  const loadGoogle = useStore((s) => s.loadGoogle)
  const connect = useStore((s) => s.connectGoogle)
  const disconnect = useStore((s) => s.disconnectGoogle)
  const setCalendars = useStore((s) => s.setGoogleCalendars)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    void loadGoogle()
  }, [loadGoogle])

  const redirect = `${location.origin}/api/google/callback`

  return (
    <section className="settings-sec">
      <h3>
        <CalendarDays size={18} /> Google Kalender
      </h3>
      {!google && <p className="muted">Lädt …</p>}

      {google && !google.configured && (
        <div className="settings-card">
          <p>Damit sich die App mit Google verbinden darf, braucht sie einmalig eigene Zugangsdaten von Google. Das geht kostenlos:</p>
          <ol className="steps">
            <li>
              In der <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> ein Projekt anlegen und die <b>Google Calendar API</b> aktivieren.
            </li>
            <li>
              Unter „Google Auth Platform“ den Zustimmungsbildschirm einrichten (Zielgruppe <b>Extern</b>) und auf <b>„In Produktion“</b> stellen.
            </li>
            <li>
              Einen OAuth-Client vom Typ <b>Webanwendung</b> erstellen, mit dieser Weiterleitungs-URI:
              <br />
              <span className="code">{redirect}</span>
            </li>
            <li>
              Client-ID und Client-Secret bei Cloudflare im Worker unter Variables and Secrets als <span className="code">GOOGLE_CLIENT_ID</span> und{' '}
              <span className="code">GOOGLE_CLIENT_SECRET</span> eintragen und deployen.
            </li>
          </ol>
          <button className="btn sm" onClick={() => void loadGoogle()}>
            <RefreshCw size={14} /> Erneut prüfen
          </button>
        </div>
      )}

      {google?.configured && !google.connected && (
        <div className="settings-card">
          <p>Verbinde deinen Google Kalender: Deine Termine erscheinen im Planer und Kalender, und Aufgaben mit Uhrzeit landen in einem eigenen Kalender „Organizer“ – auch auf dem Handy in der Google-Kalender-App.</p>
          <div>
            <button className="btn primary" onClick={connect}>
              Mit Google verbinden
            </button>
          </div>
          <p className="muted small">Google zeigt evtl. „App nicht überprüft“ – das ist deine eigene App. Über „Erweitert“ → „Weiter zu …“ geht’s weiter.</p>
        </div>
      )}

      {google?.connected && google.status === 'reauth' && (
        <div className="settings-card">
          <p>Die Verbindung zu Google ist abgelaufen.</p>
          <div>
            <button className="btn primary" onClick={connect}>
              Neu verbinden
            </button>
          </div>
        </div>
      )}

      {google?.connected && google.status !== 'reauth' && (
        <div className="settings-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot on" />
            <span>
              Verbunden{google.email ? ` mit ${google.email}` : ''}
            </span>
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>
              Diese Kalender anzeigen
            </div>
            {(google.calendars ?? []).map((c) => (
              <label key={c.id} className={`cal-option ${c.selected ? 'on' : ''}`} style={{ ['--cc' as string]: c.color }}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={c.selected}
                  onChange={() => {
                    const ids = (google.calendars ?? []).filter((x) => (x.id === c.id ? !x.selected : x.selected)).map((x) => x.id)
                    void setCalendars(ids)
                  }}
                />
                <span className="box">{c.selected && <CheckIcon strokeWidth={3} />}</span>
                <span>{c.name}</span>
                {c.primary && <span className="chip">Haupt</span>}
              </label>
            ))}
          </div>
          <p className="muted small">Aufgaben mit Uhrzeit stehen im Google-Kalender „Organizer“. Verschiebst du sie dort, zieht die App mit.</p>
          <div>
            <button
              className={`btn sm danger ${confirm ? 'confirm' : 'ghost'}`}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true)
                  setTimeout(() => setConfirm(false), 3000)
                } else void disconnect()
              }}
            >
              <Unplug size={14} /> {confirm ? 'Wirklich trennen?' : 'Verbindung trennen'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function AppSection() {
  const signOut = useStore((s) => s.signOut)
  const [canInstall, setCanInstall] = useState(!!installEvent)
  return (
    <section className="settings-sec">
      <h3>App</h3>
      <div className="settings-card">
        {canInstall ? (
          <button
            className="btn"
            onClick={() =>
              void installEvent?.prompt().then(() => {
                installEvent = null
                setCanInstall(false)
              })
            }
          >
            <Download size={15} /> Als App installieren
          </button>
        ) : (
          <p className="muted small">Auf dem Handy: im Browser-Menü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.</p>
        )}
        <p className="muted small">
          Tastatur: <kbd>N</kbd> neue Aufgabe · <kbd>/</kbd> suchen · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> Ansicht wechseln · <kbd>Esc</kbd> schließen
        </p>
        <div>
          <button className="btn sm ghost" onClick={() => void signOut()}>
            <LogOut size={14} /> Abmelden
          </button>
        </div>
      </div>
    </section>
  )
}
