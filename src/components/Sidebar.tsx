import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'
import { counts } from '../lib/sections'
import type { View } from '../lib/types'
import { LIST_COLORS } from '../lib/types'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

export default function Sidebar() {
  const { view, setView, lists, tasks, drawerOpen, signOut, connected, createList } = useStore()
  const c = useMemo(() => counts(tasks), [tasks])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  const sortedLists = Object.values(lists)
    .filter((l) => !l.archived)
    .sort((a, b) => a.sort - b.sort)
  const tags = Object.entries(c.tags).sort((a, b) => a[0].localeCompare(b[0]))

  const is = (v: View) => JSON.stringify(v) === JSON.stringify(view)
  const Item = ({ v, label, icon, count }: { v: View; label: string; icon: string; count?: number }) => (
    <button className={`nav-item ${is(v) ? 'active' : ''}`} onClick={() => setView(v)}>
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      <span className="nav-label">{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </button>
  )

  async function addList(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const color = LIST_COLORS[sortedLists.length % LIST_COLORS.length]
    const l = await createList(n, color)
    setName('')
    setAdding(false)
    if (l) setView({ kind: 'list', listId: l.id })
  }

  return (
    <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
      <div className="sidebar-head">
        <img src="/icon.svg" alt="" width={28} height={28} />
        <strong>Organizer</strong>
        <span className={`sync-dot ${connected ? 'on' : ''}`} title={connected ? 'Live-Sync aktiv' : 'Keine Live-Verbindung'} />
      </div>

      <nav>
        <Item v={{ kind: 'today' }} label="Heute" icon="☀" count={c.today} />
        <Item v={{ kind: 'upcoming' }} label="Demnächst" icon="📅" count={c.upcoming} />
        <div className="nav-group">Ohne Datum</div>
        <Item v={{ kind: 'horizon', horizon: 'short' }} label="Kurzfristig" icon="⚡" count={c.short} />
        <Item v={{ kind: 'horizon', horizon: 'long' }} label="Langfristig" icon="🧭" count={c.long} />
        <Item v={{ kind: 'horizon', horizon: 'backlog' }} label="Backlog" icon="📥" count={c.backlog} />

        <div className="nav-group">
          Listen
          <button className="icon-btn small" aria-label="Neue Liste" onClick={() => setAdding((a) => !a)}>
            +
          </button>
        </div>
        {sortedLists.map((l) => (
          <button key={l.id} className={`nav-item ${is({ kind: 'list', listId: l.id }) ? 'active' : ''}`} onClick={() => setView({ kind: 'list', listId: l.id })}>
            <span className="dot" style={{ background: l.color }} />
            <span className="nav-label">{l.name}</span>
            {!!c.lists[l.id] && <span className="nav-count">{c.lists[l.id]}</span>}
          </button>
        ))}
        {adding && (
          <form onSubmit={addList} className="inline-form">
            <input autoFocus placeholder="Name der Liste" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} />
          </form>
        )}
        {!sortedLists.length && !adding && (
          <button className="nav-item muted" onClick={() => setAdding(true)}>
            <span className="nav-icon">＋</span>
            <span className="nav-label">Erste Liste anlegen</span>
          </button>
        )}

        {!!tags.length && <div className="nav-group">Tags</div>}
        {tags.map(([tag, n]) => (
          <Item key={tag} v={{ kind: 'tag', tag }} label={`#${tag}`} icon="" count={n} />
        ))}

        <div className="nav-group" />
        <Item v={{ kind: 'done' }} label="Erledigt" icon="✓" />
      </nav>

      <div className="sidebar-foot">
        {installEvt && (
          <button className="btn small" onClick={() => void installEvt.prompt().then(() => setInstallEvt(null))}>
            App installieren
          </button>
        )}
        <button className="link small" onClick={() => void signOut()}>
          Abmelden
        </button>
      </div>
    </aside>
  )
}
