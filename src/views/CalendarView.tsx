/**
 * Kalender: Tag, 3 Tage, Woche, Monat, Jahr, Liste. Termine anlegen/verschieben/ändern (Google),
 * Aufgaben einplanen, Kalender ein-/ausblenden, springen und suchen.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarPlus, ChevronLeft, ChevronRight, PanelLeft, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'
import type { CalView } from '../lib/types'
import { addDaysStr, dayLabel, monthLabel, todayStr } from '../lib/dates'
import { CAL_VIEWS, fmtDayLong, stepFocus, viewRange, weekNumber, yearOf } from '../lib/calendar'
import { matchesSearch } from '../lib/compose'
import { useIsMobile } from '../hooks/useMedia'
import { PlanDnd } from '../components/PlanDnd'
import Timeline from '../components/Timeline'
import DraggableCard from '../components/DraggableCard'
import Segmented from '../components/Segmented'
import { AgendaView, CalSidebar, CalendarList, EventSearch, MiniMonth, MonthView, YearView } from '../components/CalViews'
import { api } from '../lib/api'

export default function CalendarView() {
  const isMobile = useIsMobile()
  const focusDay = useStore((s) => s.focusDay)
  const setFocusDay = useStore((s) => s.setFocusDay)
  const view = useStore((s) => s.calView)
  const setCalView = useStore((s) => s.setCalView)
  const sidebar = useStore((s) => s.calSidebar)
  const setSidebar = useStore((s) => s.setCalSidebar)
  const google = useStore((s) => s.google)
  const loadEvents = useStore((s) => s.loadEvents)
  const connectGoogle = useStore((s) => s.connectGoogle)
  const setSettings = useStore((s) => s.setSettings)
  const eventsLoading = useStore((s) => s.eventsLoading)
  const openEventEditor = useStore((s) => s.openEventEditor)
  const [search, setSearch] = useState(false)
  const [mobilePicker, setMobilePicker] = useState(false)
  const today = todayStr()
  const range = viewRange(view, focusDay, isMobile)
  const timeline = view === 'day' || view === '3day' || view === 'week'
  const hourPx = isMobile ? 56 : view === 'day' ? 56 : 48

  const go = (dir: 1 | -1) => setFocusDay(stepFocus(view, focusDay, dir, isMobile))
  const openDay = (d: string) => {
    setFocusDay(d)
    setCalView('day')
  }
  const refresh = async () => {
    await api.googleRefresh().catch(() => undefined)
    void loadEvents(range.from, range.to, true)
  }
  const newEvent = () => {
    const now = new Date()
    const start = new Date(`${focusDay}T${String(Math.min(22, now.getHours() + 1)).padStart(2, '0')}:00:00`)
    openEventEditor({ mode: 'new', draft: { allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() } })
  }

  // Tasten: ←/→ blättern, D/X/W/M/J/L Ansicht, E neuer Termin
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      const st = useStore.getState()
      if (t.closest('input, textarea, select, [contenteditable=true]') || st.eventEditor || st.selectedId || st.quickAdd.open || st.paletteOpen || st.settingsOpen || st.ritual || st.splitFor || st.templatePicker || mobilePicker) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'e') newEvent()
      else {
        const v = CAL_VIEWS.find((x) => x.key === e.key.toLowerCase())
        if (!v) return
        setCalView(v.value)
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const title =
    view === 'day'
      ? isMobile
        ? dayLabel(focusDay)
        : fmtDayLong(focusDay)
      : view === 'month'
        ? monthLabel(focusDay)
        : view === 'year'
          ? yearOf(focusDay)
          : view === 'list'
            ? `Ab ${dayLabel(focusDay)}`
            : monthLabel(range.from)
  const inRange = view === 'year' ? yearOf(today) === yearOf(focusDay) : view === 'month' ? today.slice(0, 7) === focusDay.slice(0, 7) : today >= range.from && today <= range.to
  const needsScope = google?.connected && google.status === 'ok' && !google.events?.granted

  return (
    <div className="view">
      <div className="cal-toolbar">
        {!isMobile && (
          <button className={`icon-btn sm ${sidebar ? 'on' : ''}`} aria-label="Seitenleiste" aria-pressed={sidebar} title="Seitenleiste" onClick={() => setSidebar(!sidebar)}>
            <PanelLeft size={17} />
          </button>
        )}
        <button className="cal-title" onClick={() => isMobile && setMobilePicker(true)} title={isMobile ? 'Monat & Kalender' : undefined}>
          {title}
          {(view === 'week' || view === '3day') && !isMobile && <small className="cal-kw">KW {weekNumber(range.from)}</small>}
        </button>
        <button className="icon-btn sm" aria-label="Zurück" onClick={() => go(-1)}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn sm" aria-label="Weiter" onClick={() => go(1)}>
          <ChevronRight size={18} />
        </button>
        {!inRange && (
          <button className="btn sm ghost" onClick={() => setFocusDay(today)}>
            Heute
          </button>
        )}
        <span style={{ flex: 1 }} />
        {isMobile ? (
          <select className="field-input cal-view-select" value={view} onChange={(e) => setCalView(e.target.value as CalView)} aria-label="Ansicht">
            {CAL_VIEWS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        ) : (
          <Segmented group="cal-view" value={view} onChange={(v) => setCalView(v as CalView)} options={CAL_VIEWS.map((v) => ({ value: v.value, label: v.short }))} className="cal-views" />
        )}
        {google?.connected && google.status === 'ok' && (
          <>
            <button className={`icon-btn sm ${search ? 'on' : ''}`} aria-label="Termine suchen" title="Suchen" onClick={() => setSearch((v) => !v)}>
              <Search size={16} />
            </button>
            {!isMobile && (
              <button className="icon-btn sm" aria-label="Google-Termine neu laden" onClick={() => void refresh()} title="Neu laden">
                <RefreshCw size={16} style={{ animation: eventsLoading ? 'spin 1s linear infinite' : undefined }} />
              </button>
            )}
            <button className="btn sm primary cal-new" onClick={newEvent} title="Neuer Termin (E)">
              <Plus size={15} /> {!isMobile && 'Termin'}
            </button>
          </>
        )}
        {google && (!google.connected || google.status === 'reauth') && (
          <button className="btn sm" onClick={() => (google.configured ? connectGoogle() : setSettings(true))}>
            <CalendarPlus size={15} /> {google.status === 'reauth' ? 'Google neu verbinden' : 'Google Kalender verbinden'}
          </button>
        )}
      </div>
      {needsScope && (
        <div className="cal-scope">
          <ShieldCheck size={15} />
          <span>Termine direkt hier anlegen und verschieben? Dafür einmal Google neu verbinden (neue Berechtigung „Termine bearbeiten“).</span>
          <button className="btn sm" onClick={connectGoogle}>
            Neu verbinden
          </button>
        </div>
      )}
      <AnimatePresence>{search && <EventSearch onClose={() => setSearch(false)} onGo={(d) => setFocusDay(d)} />}</AnimatePresence>

      <PlanDnd hourPx={hourPx}>
        <div className={`cal-wrap ${sidebar && !isMobile ? 'with-side' : ''}`}>
          {sidebar && !isMobile && <SidePanel focus={focusDay} range={[range.from, range.to]} onPick={(d) => setFocusDay(d)} />}
          <div className={`cal-main cal-${view}`}>
            {timeline && <Timeline days={range.days} hourPx={hourPx} onDayHeaderClick={openDay} />}
            {view === 'month' && <MonthView focus={focusDay} onOpenDay={openDay} />}
            {view === 'year' && (
              <YearView
                focus={focusDay}
                onOpenDay={openDay}
                onOpenMonth={(d) => {
                  setFocusDay(d)
                  setCalView('month')
                }}
              />
            )}
            {view === 'list' && <AgendaView focus={focusDay} onOpenDay={openDay} />}
          </div>
        </div>
      </PlanDnd>

      {isMobile && <MobilePicker open={mobilePicker} focus={focusDay} onClose={() => setMobilePicker(false)} onPick={(d) => (setFocusDay(d), setMobilePicker(false))} />}
    </div>
  )
}

function SidePanel({ focus, range, onPick }: { focus: string; range: [string, string]; onPick: (d: string) => void }) {
  const [tab, setTab] = useState<'cals' | 'tasks'>('cals')
  return (
    <div className="cal-sidepanel">
      <CalSidebar focus={focus} range={range} onPick={onPick} />
      <div className="cal-side-tabs">
        <Segmented
          group="cal-side"
          value={tab}
          onChange={(v) => setTab(v as 'cals' | 'tasks')}
          options={[
            { value: 'cals', label: 'Kalender' },
            { value: 'tasks', label: 'Einplanen' },
          ]}
        />
      </div>
      {tab === 'tasks' ? <Tray /> : <CalendarListOnly />}
    </div>
  )
}

/** Kalenderliste ohne den Mini-Monat (der steht schon oben) */
function CalendarListOnly() {
  return <CalendarList />
}

function Tray() {
  const tasks = useStore((s) => s.tasks)
  const search = useStore((s) => s.search)
  const [tab, setTab] = useState<'inbox' | 'nodate'>('nodate')
  const { setNodeRef, isOver } = useDroppable({ id: 'unplan:none' })
  const items = useMemo(() => {
    const open = Object.values(tasks).filter((t) => t.status === 'open' && !t.start_at && matchesSearch(t, search) && (!t.parent_id || t.part_index != null))
    return (tab === 'inbox' ? open.filter((t) => !t.list_id && !t.parent_id) : open.filter((t) => !t.due_date && !Object.values(tasks).some((k) => k.parent_id === t.id && k.part_index != null))).sort(
      (a, b) => b.priority - a.priority || a.sort - b.sort,
    )
  }, [tasks, search, tab])
  return (
    <div className="tray">
      <div className="tray-tabs">
        <Segmented
          group="tray"
          value={tab}
          onChange={(v) => setTab(v as 'inbox' | 'nodate')}
          options={[
            { value: 'nodate', label: 'Ohne Datum' },
            { value: 'inbox', label: 'Unsortiert' },
          ]}
        />
      </div>
      <div ref={setNodeRef} className="tray-body" style={isOver ? { background: 'var(--accent-soft)' } : undefined}>
        {items.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nichts da. Zieh einen Block hierher, um ihn aus dem Kalender zu nehmen.</p>}
        {items.map((t) => (
          <DraggableCard key={t.id} task={t} showDate />
        ))}
      </div>
      <p className="muted small tray-hint">Aufgaben ins Raster ziehen = einplanen. Mit Strg gezogen wird ein Teil abgespalten.</p>
    </div>
  )
}

function MobilePicker({ open, focus, onClose, onPick }: { open: boolean; focus: string; onClose: () => void; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(focus)
  useEffect(() => setMonth(focus), [focus, open])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside key="mp" className="sheet cal-picker-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
            <div className="sheet-grab" />
            <div className="sheet-head">
              <button className="icon-btn" aria-label="Vorheriger Monat" onClick={() => setMonth(addDaysStr(`${month.slice(0, 7)}-01`, -1))}>
                <ChevronLeft size={18} />
              </button>
              <span className="crumb" style={{ color: 'var(--text)', fontWeight: 650, fontSize: 15, textAlign: 'center' }}>
                {monthLabel(month)}
              </span>
              <button className="icon-btn" aria-label="Nächster Monat" onClick={() => setMonth(addDaysStr(`${month.slice(0, 7)}-28`, 7))}>
                <ChevronRight size={18} />
              </button>
              <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            <div className="sheet-body">
              <MiniMonth month={month} today={todayStr()} selected={focus} onPick={onPick} />
              <CalendarList />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
