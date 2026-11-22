import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, BellOff, CalendarDays, Check as CheckIcon, ChevronRight, Download, LayoutTemplate, LogOut, RefreshCw, Send, Unplug, X } from 'lucide-react'
import LangHelp from './LangHelp'
import { useStore } from '../store'
import { useIsMobile } from '../hooks/useMedia'
import { api } from '../lib/api'
import type { PushPrefs } from '../lib/types'
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '../lib/push'

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
              <NotifySection />
              <GoogleSection />
              <OrganizeSection />
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

const DEFAULT_PUSH: PushPrefs = { morning: '08:00', evening: null, lead: 10 }
const MORNING = ['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00']
const EVENING = ['17:00', '18:00', '19:00', '20:00', '21:00', '21:30', '22:00']

function NotifySection() {
  const prefs = useStore((s) => s.prefs.push)
  const setPref = useStore((s) => s.setPref)
  const showToast = useStore((s) => s.showToast)
  const p = { ...DEFAULT_PUSH, ...(prefs ?? {}) }
  const [state, setState] = useState<'loading' | 'unsupported' | 'off' | 'on' | 'blocked' | 'ios-install'>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pushSupported()) {
      setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') return setState('blocked')
    void currentSubscription().then((s) => setState(s && Notification.permission === 'granted' ? 'on' : 'off'))
  }, [])

  const set = (patch: Partial<PushPrefs>) => setPref('push', { ...p, ...patch })
  const run = async (fn: () => Promise<void>, next: typeof state, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      setState(next)
      if (ok) showToast(ok)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setState('blocked')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-sec">
      <h3>
        <Bell size={18} /> Erinnerungen
      </h3>
      <div className="settings-card">
        {state === 'ios-install' && <p>Auf dem iPhone gehen Benachrichtigungen nur, wenn die App auf dem Home-Bildschirm installiert ist (Teilen → „Zum Home-Bildschirm“).</p>}
        {state === 'unsupported' && <p className="muted">Dieser Browser unterstützt keine Push-Benachrichtigungen.</p>}
        {state === 'blocked' && <p>Benachrichtigungen sind für diese Seite blockiert. Erlaube sie in den Browser- bzw. App-Einstellungen und lade die Seite neu.</p>}
        {state === 'off' && (
          <>
            <p>Lass dich vor Aufgaben mit Uhrzeit erinnern und bekomm morgens eine kurze Übersicht über deinen Tag.</p>
            <div>
              <button className="btn primary" disabled={busy} onClick={() => void run(enablePush, 'on', 'Benachrichtigungen sind an')}>
                <Bell size={15} /> Auf diesem Gerät aktivieren
              </button>
            </div>
          </>
        )}
        {state === 'on' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="live-dot on" />
            <span>Aktiv auf diesem Gerät</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm ghost" disabled={busy} onClick={() => void run(async () => void (await api.pushTest()), 'on', 'Test verschickt – kommt gleich')}>
              <Send size={14} /> Test
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={() => void run(disablePush, 'off')}>
              <BellOff size={14} /> Aus
            </button>
          </div>
        )}
        {state !== 'loading' && state !== 'unsupported' && (
          <div className="notify-grid">
            <label>
              <span>Vor Aufgaben mit Uhrzeit</span>
              <select value={p.lead} onChange={(e) => set({ lead: Number(e.target.value) })}>
                <option value={0}>beim Start</option>
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} Min. vorher
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Morgens: Tagesübersicht</span>
              <select value={p.morning ?? ''} onChange={(e) => set({ morning: e.target.value || null })}>
                <option value="">aus</option>
                {MORNING.map((t) => (
                  <option key={t} value={t}>
                    {t} Uhr
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Abends: „Tag abschließen?“</span>
              <select value={p.evening ?? ''} onChange={(e) => set({ evening: e.target.value || null })}>
                <option value="">aus</option>
                {EVENING.map((t) => (
                  <option key={t} value={t}>
                    {t} Uhr
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <p className="muted small">Gilt für alle Geräte, auf denen du Benachrichtigungen aktiviert hast. Solange Push an ist, setzt die App bei Google-Terminen keine eigene Erinnerung mehr – so kommt nichts doppelt.</p>
      </div>
    </section>
  )
}

function OrganizeSection() {
  const templates = useStore((s) => s.templates)
  const showSubtasks = useStore((s) => s.showSubtasks)
  const setShowSubtasks = useStore((s) => s.setShowSubtasks)
  const showNums = useStore((s) => s.showNums)
  const setShowNums = useStore((s) => s.setShowNums)
  const [help, setHelp] = useState(false)
  const openTemplatePicker = useStore((s) => s.openTemplatePicker)
  const setSettings = useStore((s) => s.setSettings)
  const n = Object.keys(templates).length
  return (
    <section className="settings-sec">
      <h3>
        <LayoutTemplate size={18} /> Ordnen
      </h3>
      <div className="settings-card">
        <label className="switch-row">
          <span>
            Unteraufgaben auf Karten zeigen
            <span className="muted small"> · Taste U</span>
          </span>
          <input type="checkbox" className="switch" checked={showSubtasks} onChange={(e) => setShowSubtasks(e.target.checked)} />
        </label>
        <label className="switch-row">
          <span>
            Nummern auf Karten zeigen
            <span className="muted small"> · für „warte auf 4“</span>
          </span>
          <input type="checkbox" className="switch" checked={showNums} onChange={(e) => setShowNums(e.target.checked)} />
        </label>
        <div>
          <button className={`done-toggle ${help ? 'open' : ''}`} onClick={() => setHelp((h) => !h)} style={{ paddingLeft: 0 }}>
            <ChevronRight /> Was die Eingabe versteht
          </button>
          {help && <LangHelp />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>
            {n === 0 ? 'Noch keine Vorlagen' : `${n} ${n === 1 ? 'Vorlage' : 'Vorlagen'}`}
            <span className="muted small"> · speichern über „Als Vorlage“ in einer Aufgabe</span>
          </span>
          <span style={{ flex: 1 }} />
          {n > 0 && (
            <button
              className="btn sm ghost"
              onClick={() => {
                setSettings(false)
                openTemplatePicker({})
              }}
            >
              Verwalten
            </button>
          )}
        </div>
      </div>
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
          Tastatur: <kbd>Strg</kbd>+<kbd>K</kbd> Befehle · <kbd>N</kbd> neue Aufgabe · <kbd>/</kbd> suchen · <kbd>F</kbd> Filter · <kbd>U</kbd> Unteraufgaben · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> Ansicht wechseln · <kbd>Esc</kbd> schließen
        </p>
        <p className="muted small">
          <a href="/datenschutz" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Datenschutz</a> ·{' '}
          <a href="/nutzungsbedingungen" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Nutzungsbedingungen</a>
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
