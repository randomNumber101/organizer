/**
 * „Heute“: den Tag gestalten – Reihenfolge, Überblick, Fokus. Der Kalender ist nur seitlich einblendbar.
 */
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, Flag, Hourglass, ListOrdered, Lock, Moon, Sun, Timer, X } from 'lucide-react'
import { useStore, eventsFor } from '../store'
import type { Task, TodayMode } from '../lib/types'
import { addDaysStr, dayLabel, dayNum, daysFrom, longDayLabel, timeLabel, todayStr, weekStart, weekdayShort } from '../lib/dates'
import { BUCKETS, bucketOf, freeMinutes, minutesText, nextEvent, planDay } from '../lib/dayplan'
import { deadlineDay } from '../lib/filter'
import { matchesSearch } from '../lib/compose'
import { useIsMobile } from '../hooks/useMedia'
import { haptic } from '../lib/haptics'
import { PlanDnd } from '../components/PlanDnd'
import Timeline from '../components/Timeline'
import QuickLine from '../components/QuickLine'
import Segmented from '../components/Segmented'
import { RitualBanner } from '../components/Ritual'
import { DayList, DayRow } from '../components/DayList'
import { FocusCard } from '../components/FocusCard'

const MODES: { value: TodayMode; label: string; icon: React.ReactNode }[] = [
  { value: 'order', label: 'Reihenfolge', icon: <ListOrdered /> },
  { value: 'duration', label: 'Dauer', icon: <Hourglass /> },
  { value: 'prio', label: 'Priorität', icon: <Flag /> },
]

export default function TodayView() {
  const isMobile = useIsMobile()
  const focusDay = useStore((s) => s.focusDay)
  const tasks = useStore((s) => s.tasks)
  const search = useStore((s) => s.search)
  const events = useStore((s) => s.events)
  const google = useStore((s) => s.google)
  const loadEvents = useStore((s) => s.loadEvents)
  const mode = useStore((s) => s.todayMode)
  const setMode = useStore((s) => s.setTodayMode)
  const calendarPanel = useStore((s) => s.calendarPanel)
  const setCalendarPanel = useStore((s) => s.setCalendarPanel)
  const today = todayStr()
  const isToday = focusDay === today

  useEffect(() => {
    if (google?.connected) void loadEvents(focusDay, focusDay)
  }, [focusDay, google?.connected, google?.status, loadEvents])

  const plan = useMemo(() => planDay(tasks, focusDay, search), [tasks, focusDay, search])
  const dayEvents = useMemo(() => eventsFor(events, focusDay, focusDay), [events, focusDay])
  const total = plan.rows.length + plan.blocked.length + plan.done.length

  return (
    <div className="view">
      <div className={`today ${calendarPanel && !isMobile ? 'with-cal' : ''}`}>
        <div className="today-main">
          <div className="today-inner">
            <DayHeader />
            <RitualBanner />
            <div className="today-body">
              <div className="today-side">
                <DayProgress rows={plan.rows} done={plan.done.length} total={total} minutes={plan.minutes} events={dayEvents} />
                {isToday && <FocusCard rows={plan.rows} total={plan.rows.length} />}
                {isToday && <GapHint rows={plan.rows} events={dayEvents} />}
              </div>

              <div className="today-list">
                <div className="today-toolbar">
                  <Segmented group="today-mode" value={mode} onChange={(v) => setMode(v as TodayMode)} options={MODES} className="today-modes" />
                </div>

                <QuickLine defaults={{ due_date: focusDay }} placeholder={isToday ? 'Aufgabe für heute' : `Aufgabe für ${dayLabel(focusDay)}`} />

                {plan.rows.length > 0 ? (
                  <DayList rows={plan.rows} day={focusDay} mode={mode} />
                ) : (
                  <EmptyDay hasDone={plan.done.length > 0} />
                )}

                {isToday && <Leftovers />}
                {plan.blocked.length > 0 && (
                  <Fold title="Wartet noch" icon={<Lock size={14} />} count={plan.blocked.length}>
                    {plan.blocked.map((t) => (
                      <DayRow key={t.id} task={t} day={focusDay} rows={plan.rows} muted />
                    ))}
                  </Fold>
                )}
                <SoonDeadlines day={focusDay} />
                {plan.done.length > 0 && (
                  <Fold title="Erledigt" count={plan.done.length}>
                    {plan.done.map((t) => (
                      <DayRow key={t.id} task={t} day={focusDay} rows={plan.rows} />
                    ))}
                  </Fold>
                )}
              </div>
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {calendarPanel && !isMobile && (
            <motion.aside className="today-cal" initial={{ width: 0, opacity: 0 }} animate={{ width: 380, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
              <div className="today-cal-head">
                <CalendarDays size={16} /> {dayLabel(focusDay)}
                <span style={{ flex: 1 }} />
                <button className="icon-btn sm" aria-label="Kalender ausblenden" onClick={() => setCalendarPanel(false)}>
                  <X size={15} />
                </button>
              </div>
              <PlanDnd hourPx={52}>
                <Timeline days={[focusDay]} hourPx={52} showHeader={false} allDayTasks={false} />
              </PlanDnd>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      {isMobile && <CalendarSheet open={calendarPanel} day={focusDay} onClose={() => setCalendarPanel(false)} />}
    </div>
  )
}

function DayHeader() {
  const focusDay = useStore((s) => s.focusDay)
  const setFocusDay = useStore((s) => s.setFocusDay)
  const openRitual = useStore((s) => s.openRitual)
  const calendarPanel = useStore((s) => s.calendarPanel)
  const setCalendarPanel = useStore((s) => s.setCalendarPanel)
  const today = todayStr()
  const title = focusDay === today ? 'Heute' : dayLabel(focusDay, today)
  return (
    <header className="today-head">
      <div className="today-titles">
        <motion.h1 key={focusDay} className="day-title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {title}
        </motion.h1>
        <div className="today-sub">
          <button className="icon-btn sm" aria-label="Vorheriger Tag" onClick={() => setFocusDay(addDaysStr(focusDay, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span>{longDayLabel(focusDay)}</span>
          <button className="icon-btn sm" aria-label="Nächster Tag" onClick={() => setFocusDay(addDaysStr(focusDay, 1))}>
            <ChevronRight size={16} />
          </button>
          {focusDay !== today && (
            <button className="btn sm ghost" onClick={() => setFocusDay(today)}>
              Zurück zu heute
            </button>
          )}
        </div>
      </div>
      <DayStrip />
      <div className="today-actions">
        {focusDay === today && (
          <>
            <button className="icon-btn" aria-label="Tag planen" title="Tag planen" onClick={() => openRitual('plan')}>
              <Sun size={17} />
            </button>
            <button className="icon-btn" aria-label="Tag abschließen" title="Tag abschließen" onClick={() => openRitual('review')}>
              <Moon size={17} />
            </button>
          </>
        )}
        <button className={`icon-btn ${calendarPanel ? 'on' : ''}`} aria-label={calendarPanel ? 'Kalender ausblenden' : 'Kalender einblenden'} title="Kalender" aria-pressed={calendarPanel} onClick={() => setCalendarPanel(!calendarPanel)}>
          <CalendarDays size={17} />
        </button>
      </div>
    </header>
  )
}

function DayStrip() {
  const focusDay = useStore((s) => s.focusDay)
  const setFocusDay = useStore((s) => s.setFocusDay)
  const tasks = useStore((s) => s.tasks)
  const today = todayStr()
  const days = daysFrom(weekStart(focusDay), 7)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of Object.values(tasks)) if (t.status === 'open' && t.due_date && !t.parent_id) c[t.due_date] = (c[t.due_date] ?? 0) + 1
    return c
  }, [tasks])
  return (
    <div className="daystrip">
      {days.map((d) => (
        <button key={d} className={`${d === focusDay ? 'on' : ''} ${d === today ? 'is-today' : ''}`} onClick={() => setFocusDay(d)}>
          {weekdayShort(d)}
          <b>{dayNum(d)}</b>
          {!!counts[d] && (
            <span className="marks">
              {Array.from({ length: Math.min(3, counts[d]) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Fortschritt + wie viel Zeit neben den Terminen noch bleibt */
function DayProgress({ rows, done, total, minutes, events }: { rows: Task[]; done: number; total: number; minutes: number; events: ReturnType<typeof eventsFor> }) {
  const focusDay = useStore((s) => s.focusDay)
  const end = useStore((s) => s.prefs.day?.end ?? '20:00')
  const setPref = useStore((s) => s.setPref)
  const setMode = useStore((s) => s.setTodayMode)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const today = todayStr()
  if (!total) return null
  const free = focusDay >= today ? freeMinutes(focusDay, today, end, events) : 0
  const p = total ? done / total : 0
  const r = 22
  const c = 2 * Math.PI * r
  const load = free > 0 ? minutes / free : minutes > 0 ? 2 : 0
  const state = load > 1 ? 'over' : load > 0.85 ? 'tight' : 'ok'
  return (
    <section className="day-progress">
      <div className={`progress-ring ${done === total ? 'all' : ''}`}>
        <svg viewBox="0 0 54 54" width="54" height="54">
          <circle cx="27" cy="27" r={r} className="track" />
          <motion.circle cx="27" cy="27" r={r} className="bar" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - p) }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        </svg>
        <b>
          {done}/{total}
        </b>
      </div>
      <div className="day-progress-text">
        <b>{done === total ? 'Alles erledigt.' : `${total - done} offen${minutes ? ` · noch ~${minutesText(minutes)}` : ''}`}</b>
        {rows.length > 0 && (
          <div className="day-buckets">
            {BUCKETS.map((b) => {
              const n = rows.filter((t) => bucketOf(t) === b.id).length
              return n ? (
                <button key={b.id} onClick={() => setMode('duration')} title={`${b.label}: ${b.hint}`}>
                  <i className={`day-group-dot ${b.id}`} />
                  {n} {b.id === 'none' ? 'ohne Dauer' : b.label}
                </button>
              ) : null
            })}
          </div>
        )}
        {focusDay >= today && (
          <span className="muted small">
            frei bis{' '}
            <select className="inline-select" value={end} onChange={(e) => setPref('day', { end: e.target.value })} aria-label="Tagesende">
              {['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            : {minutesText(free)}
          </span>
        )}
        {focusDay >= today && minutes > 0 && (
          <div className={`budget ${state}`} title={state === 'over' ? 'Mehr geplant als Zeit da ist' : undefined}>
            <motion.i initial={false} animate={{ width: `${Math.min(100, load * 100)}%` }} />
          </div>
        )}
        {focusDay >= today && state === 'over' && <span className="budget-warn">Mehr geplant als Zeit übrig – schieb etwas auf morgen.</span>}
      </div>
    </section>
  )
}

/** Bis zum nächsten Termin ist eine Lücke: was passt da rein? */
function GapHint({ rows, events }: { rows: Task[]; events: ReturnType<typeof eventsFor> }) {
  const setDayOrder = useStore((s) => s.setDayOrder)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const today = todayStr()
  const ev = nextEvent(events, today)
  if (!ev) return null
  const mins = Math.round((Date.parse(ev.start) - Date.now()) / 60_000)
  if (mins > 120) return null
  const fits = rows.filter((t) => !t.start_at && t.estimate && t.estimate <= mins - 5).slice(0, 4)
  const first = (t: Task) => {
    haptic(8)
    setDayOrder([t.id, ...rows.map((r) => r.id).filter((id) => id !== t.id)], t.id)
  }
  return (
    <motion.div className="gap-hint" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <Clock size={15} />
      <div>
        <span>
          Noch <b>{minutesText(Math.max(0, mins))}</b> bis „{ev.title}“ ({timeLabel(ev.start)}).{' '}
          {fits.length ? 'Passt dazwischen:' : mins < 15 ? 'Kurz durchatmen.' : 'Nichts Passendes geschätzt.'}
        </span>
        {fits.length > 0 && (
          <div className="gap-chips">
            {fits.map((t) => (
              <button key={t.id} className="gap-chip" onClick={() => first(t)} title="Als Nächstes">
                <Timer size={12} /> {minutesText(t.estimate!)} · {t.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function EmptyDay({ hasDone }: { hasDone: boolean }) {
  const openRitual = useStore((s) => s.openRitual)
  const focusDay = useStore((s) => s.focusDay)
  return (
    <div className="day-empty">
      {hasDone ? <p>Alles abgehakt. Gönn dir was.</p> : <p>Für {focusDay === todayStr() ? 'heute' : dayLabel(focusDay)} ist noch nichts geplant.</p>}
      {focusDay === todayStr() && !hasDone && (
        <button className="btn" onClick={() => openRitual('plan')}>
          <Sun size={15} /> Tag planen
        </button>
      )}
    </div>
  )
}

/** Aufgaben mit Uhrzeit von früheren Tagen (Tagesaufgaben wandern ja automatisch mit) */
function Leftovers() {
  const tasks = useStore((s) => s.tasks)
  const search = useStore((s) => s.search)
  const updateTask = useStore((s) => s.updateTask)
  const today = todayStr()
  const rows = Object.values(tasks).filter((t) => t.status === 'open' && t.due_date && t.due_date < today && matchesSearch(t, search))
  if (!rows.length) return null
  return (
    <Fold title="Liegen geblieben" count={rows.length} open>
      {rows.map((t) => (
        <div key={t.id} className="leftover">
          <DayRow task={t} day={today} rows={[]} />
          <button className="btn sm" onClick={() => updateTask(t.id, { due_date: today, start_at: null, end_at: null, timezone: null })}>
            Auf heute
          </button>
        </div>
      ))}
    </Fold>
  )
}

/** Fristen der nächsten Tage, die nicht ohnehin heute dran sind */
function SoonDeadlines({ day }: { day: string }) {
  const tasks = useStore((s) => s.tasks)
  const moveToDay = useStore((s) => s.moveToDay)
  const week = addDaysStr(day, 7)
  const rows = Object.values(tasks)
    .filter((t) => t.status === 'open' && t.deadline && deadlineDay(t.deadline) <= week && t.due_date !== day && !(t.due_date && t.due_date < day))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
  if (!rows.length) return null
  return (
    <Fold title="Fristen bald" icon={<Flag size={14} />} count={rows.length}>
      {rows.map((t) => (
        <div key={t.id} className="leftover">
          <DayRow task={t} day={day} rows={[]} />
          <button className="btn sm" onClick={() => moveToDay(t.id, day)}>
            {day === todayStr() ? 'Heute' : 'Diesen Tag'}
          </button>
        </div>
      ))}
    </Fold>
  )
}

function Fold({ title, count, icon, open: initial = false, children }: { title: string; count: number; icon?: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="day-fold">
      <button className={`day-fold-head ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown size={15} />
        {icon}
        {title}
        <span>{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="day-rows" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Handy: Kalender als Blatt von unten */
function CalendarSheet({ open, day, onClose }: { open: boolean; day: string; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            key="cal"
            className="sheet cal-sheet"
            role="dialog"
            aria-label="Kalender"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <div className="sheet-grab" />
            <div className="sheet-head">
              <span className="crumb" style={{ color: 'var(--text)', fontWeight: 650, fontSize: 15 }}>
                Kalender · {dayLabel(day)}
              </span>
              <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            <PlanDnd hourPx={56}>
              <Timeline days={[day]} hourPx={56} showHeader={false} allDayTasks={false} />
            </PlanDnd>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
