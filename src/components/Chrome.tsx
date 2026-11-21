import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CalendarDays, Columns3, Search, Settings, Sun, X } from 'lucide-react'
import { useStore } from '../store'
import type { ViewName } from '../lib/types'
import { dayLabel, todayStr } from '../lib/dates'
import Segmented from './Segmented'

const VIEWS: { value: ViewName; label: string; icon: React.ReactNode }[] = [
  { value: 'board', label: 'Board', icon: <Columns3 /> },
  { value: 'today', label: 'Heute', icon: <Sun /> },
  { value: 'calendar', label: 'Kalender', icon: <CalendarDays /> },
]

export function TopBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const connected = useStore((s) => s.connected)
  const google = useStore((s) => s.google)
  const setSettings = useStore((s) => s.setSettings)
  const focusDay = useStore((s) => s.focusDay)
  const boardMode = useStore((s) => s.boardMode)
  const [searchOpen, setSearchOpen] = useState(false)

  const mobileTitle = view === 'board' ? (boardMode === 'lists' ? 'Board' : 'Woche') : view === 'today' ? (focusDay === todayStr() ? 'Heute' : dayLabel(focusDay)) : 'Kalender'
  const gColor = !google?.configured ? null : google.connected && google.status === 'ok' ? '#3aa76d' : google.connected ? 'var(--danger)' : 'var(--line-2)'

  return (
    <header className="topbar">
      <div className="brand desktop-only">
        <img src="/icon.svg" alt="" />
        Organizer
      </div>
      <MobileTitle text={mobileTitle} hidden={searchOpen} />
      <div className="topbar-center">
        <Segmented group="views" value={view} onChange={(v) => setView(v as ViewName)} options={VIEWS} />
      </div>
      <span className="grow" />
      <SearchBox open={searchOpen} setOpen={setSearchOpen} />
      <span className={`live-dot desktop-only ${connected ? 'on' : ''}`} title={connected ? 'Live-Sync aktiv' : 'Keine Live-Verbindung'} />
      <button className="icon-btn g-btn" aria-label="Einstellungen" onClick={() => setSettings(true)}>
        <Settings size={18} />
        {gColor && <span className="badge" style={{ background: gColor }} />}
      </button>
    </header>
  )
}

function MobileTitle({ text, hidden }: { text: string; hidden: boolean }) {
  return (
    <motion.span key={text} className="mobile-title only-mobile" initial={{ opacity: 0, y: 4 }} animate={{ opacity: hidden ? 0 : 1, y: 0 }} transition={{ duration: 0.18 }}>
      {text}
    </motion.span>
  )
}

function SearchBox({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select')) {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => ref.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setOpen])

  return (
    <>
      <button
        className="icon-btn only-mobile"
        aria-label="Suchen"
        onClick={() => {
          setOpen(true)
          setTimeout(() => ref.current?.focus(), 0)
        }}
      >
        <Search size={19} />
      </button>
      <div className={`search ${open ? 'mobile-open' : 'desktop-search'}`}>
        <Search />
        <input
          ref={ref}
          value={search}
          placeholder="Suchen  ( / )"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch('')
              setOpen(false)
              ref.current?.blur()
            }
          }}
          onBlur={() => !search && setOpen(false)}
        />
        {(search || open) && (
          <button
            className="icon-btn sm clear"
            aria-label="Suche leeren"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSearch('')
              setOpen(false)
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </>
  )
}

export function TabBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  return (
    <nav className="tabbar">
      {VIEWS.map((v) => (
        <button key={v.value} className={view === v.value ? 'on' : ''} onClick={() => setView(v.value)}>
          {view === v.value && <motion.span layoutId="tab-ind" className="tab-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          {v.icon}
          {v.label}
        </button>
      ))}
    </nav>
  )
}
