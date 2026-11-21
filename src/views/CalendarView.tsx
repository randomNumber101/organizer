import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, RefreshCw, CalendarPlus } from 'lucide-react'
import { useStore } from '../store'
import { addDaysStr, daysFrom, monthLabel, todayStr, weekStart } from '../lib/dates'
import { matchesSearch } from '../lib/compose'
import { useIsMobile } from '../hooks/useMedia'
import { PlanDnd } from '../components/PlanDnd'
import Timeline from '../components/Timeline'
import DraggableCard from '../components/DraggableCard'
import Segmented from '../components/Segmented'
import { api } from '../lib/api'

/** Woche (Handy: 3 Tage) mit Google-Terminen; links ein Fach mit Aufgaben zum Reinziehen */
export default function CalendarView() {
  const isMobile = useIsMobile()
  const focusDay = useStore((s) => s.focusDay)
  const setFocusDay = useStore((s) => s.setFocusDay)
  const setView = useStore((s) => s.setView)
  const google = useStore((s) => s.google)
  const loadEvents = useStore((s) => s.loadEvents)
  const connectGoogle = useStore((s) => s.connectGoogle)
  const setSettings = useStore((s) => s.setSettings)
  const eventsLoading = useStore((s) => s.eventsLoading)
  const today = todayStr()
  const n = isMobile ? 3 : 7
  const start = isMobile ? focusDay : weekStart(focusDay)
  const days = daysFrom(start, n)
  const step = isMobile ? 1 : 7

  const refresh = async () => {
    await api.googleRefresh().catch(() => undefined)
    void loadEvents(days[0], days[days.length - 1], true)
  }

  return (
    <div className="view">
      <div className="cal-toolbar">
        <h1 className="cal-title">{monthLabel(start)}</h1>
        <button className="icon-btn sm" aria-label="Zurück" onClick={() => setFocusDay(addDaysStr(focusDay, -step))}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn sm" aria-label="Weiter" onClick={() => setFocusDay(addDaysStr(focusDay, step))}>
          <ChevronRight size={18} />
        </button>
        {!days.includes(today) && (
          <button className="btn sm ghost" onClick={() => setFocusDay(today)}>
            Heute
          </button>
        )}
        <span style={{ flex: 1 }} />
        {google?.connected && google.status === 'ok' && (
          <button className="icon-btn sm" aria-label="Google-Termine neu laden" onClick={() => void refresh()} title="Neu laden">
            <RefreshCw size={16} style={{ animation: eventsLoading ? 'spin 1s linear infinite' : undefined }} />
          </button>
        )}
        {google && (!google.connected || google.status === 'reauth') && (
          <button className="btn sm" onClick={() => (google.configured ? connectGoogle() : setSettings(true))}>
            <CalendarPlus size={15} /> {google.status === 'reauth' ? 'Google neu verbinden' : 'Google Kalender verbinden'}
          </button>
        )}
      </div>
      <PlanDnd hourPx={isMobile ? 56 : 48}>
        <div className="cal-wrap">
          {!isMobile && <Tray />}
          <Timeline
            days={days}
            hourPx={isMobile ? 56 : 48}
            onDayHeaderClick={(d) => {
              setFocusDay(d)
              setView('today')
            }}
          />
        </div>
      </PlanDnd>
    </div>
  )
}

function Tray() {
  const tasks = useStore((s) => s.tasks)
  const search = useStore((s) => s.search)
  const [tab, setTab] = useState<'inbox' | 'nodate'>('inbox')
  const { setNodeRef, isOver } = useDroppable({ id: 'unplan:none' })
  const items = useMemo(() => {
    const open = Object.values(tasks).filter((t) => t.status === 'open' && !t.parent_id && !t.start_at && matchesSearch(t, search))
    return (tab === 'inbox' ? open.filter((t) => !t.list_id) : open.filter((t) => !t.due_date)).sort((a, b) => a.priority - b.priority || a.sort - b.sort)
  }, [tasks, search, tab])
  return (
    <aside className="tray">
      <div className="tray-head">Zum Einplanen</div>
      <div className="tray-tabs">
        <Segmented
          group="tray"
          value={tab}
          onChange={(v) => setTab(v as 'inbox' | 'nodate')}
          options={[
            { value: 'inbox', label: 'Unsortiert' },
            { value: 'nodate', label: 'Ohne Datum' },
          ]}
        />
      </div>
      <div ref={setNodeRef} className="tray-body" style={isOver ? { background: 'var(--accent-soft)' } : undefined}>
        {items.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nichts da. Zieh einen Block hierher, um ihn aus dem Kalender zu nehmen.</p>}
        {items.map((t) => (
          <DraggableCard key={t.id} task={t} showDate />
        ))}
      </div>
    </aside>
  )
}
