import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, ChevronDown, Sun, Moon } from 'lucide-react'
import { useStore, eventsFor } from '../store'
import type { Task } from '../lib/types'
import { addDaysStr, dayNum, daysFrom, longDayLabel, todayStr, weekStart, weekdayShort, dayLabel } from '../lib/dates'
import { matchesSearch } from '../lib/compose'
import { useIsMobile } from '../hooks/useMedia'
import { PlanDnd } from '../components/PlanDnd'
import Timeline from '../components/Timeline'
import DraggableCard from '../components/DraggableCard'
import QuickLine from '../components/QuickLine'
import { TaskCard } from '../components/TaskCard'
import { RitualBanner } from '../components/Ritual'
import { FilterBar } from '../components/FilterBar'
import { matchesFilter } from '../lib/filter'

const localDay = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const byPrio = (a: Task, b: Task) => a.priority - b.priority || a.sort - b.sort

/** „Heute“: Aufgaben des Tages links, Zeitraster mit Terminen rechts – reinziehen zum Einplanen */
export default function PlannerView() {
  const isMobile = useIsMobile()
  const focusDay = useStore((s) => s.focusDay)
  const tasks = useStore((s) => s.tasks)
  const search = useStore((s) => s.search)
  const filter = useStore((s) => s.filter)
  const today = todayStr()
  const hourPx = isMobile ? 60 : 56

  const { overdue, toPlan, planned, doneDay, deadlines } = useMemo(() => {
    const all = Object.values(tasks).filter((t) => matchesSearch(t, search) && matchesFilter(t, filter, tasks, today))
    const week = addDaysStr(focusDay, 7)
    return {
      // Fristen der nächsten 7 Tage, die nicht ohnehin schon für diesen Tag dran sind
      deadlines: all
        .filter((t) => t.status === 'open' && t.deadline && t.deadline.slice(0, 10) <= week && t.due_date !== focusDay && !(focusDay === today && t.due_date && t.due_date < today))
        .sort((a, b) => a.deadline!.localeCompare(b.deadline!) || byPrio(a, b)),
      overdue: focusDay === today ? all.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).sort(byPrio) : [],
      toPlan: all.filter((t) => t.status === 'open' && t.due_date === focusDay && !t.start_at).sort(byPrio),
      planned: all.filter((t) => t.start_at && localDay(t.start_at) === focusDay).sort((a, b) => a.start_at!.localeCompare(b.start_at!)),
      doneDay: all.filter((t) => t.status === 'done' && !t.start_at && t.due_date === focusDay),
    }
  }, [tasks, search, filter, focusDay, today])

  return (
    <div className="view">
      <PlanDnd hourPx={hourPx}>
        {isMobile ? (
          <>
            <div className="planner-mobile-head">
              <RitualBanner />
              <DayStrip />
            </div>
            <Timeline days={[focusDay]} hourPx={hourPx} showHeader={false} allDayTasks={false} />
            <PlanTray tasks={[...overdue, ...toPlan]} deadlines={deadlines} day={focusDay} />
          </>
        ) : (
          <div className="planner">
            <aside className="agenda">
              <div className="agenda-head">
                <DayHeader count={toPlan.length + overdue.length} planned={planned.length} />
                <DayStrip />
                <FilterBar />
              </div>
              <div className="agenda-body">
                <RitualBanner />
                {overdue.length > 0 && <AgendaSection title="Überfällig" late tasks={overdue} showDate />}
                <AgendaSection title="Zu planen" dropId={`unplan:${focusDay}`} tasks={toPlan} empty="Hierher ziehen, um die Uhrzeit zu entfernen">
                  <QuickLine defaults={{ due_date: focusDay }} placeholder={focusDay === today ? 'Aufgabe für heute' : `Aufgabe für ${dayLabel(focusDay)}`} />
                </AgendaSection>
                {planned.length > 0 && <AgendaSection title="Im Kalender" tasks={planned} />}
                {deadlines.length > 0 && <AgendaSection title="Fristen bald" tasks={deadlines} showDate />}
                {doneDay.length > 0 && <DoneSection tasks={doneDay} />}
              </div>
            </aside>
            <Timeline days={[focusDay]} hourPx={hourPx} showHeader={false} allDayTasks={false} />
          </div>
        )}
      </PlanDnd>
    </div>
  )
}

function DayHeader({ count, planned }: { count: number; planned: number }) {
  const focusDay = useStore((s) => s.focusDay)
  const setFocusDay = useStore((s) => s.setFocusDay)
  const openRitual = useStore((s) => s.openRitual)
  const events = useStore((s) => s.events)
  const today = todayStr()
  const evCount = eventsFor(events, focusDay, focusDay).filter((e) => (e.allDay ? e.start <= focusDay && focusDay < e.end : localDay(e.start) === focusDay)).length
  const title = focusDay === today ? 'Heute' : dayLabel(focusDay, today)
  const parts = [count ? `${count} zu planen` : 'nichts offen', planned ? `${planned} eingeplant` : null, evCount ? `${evCount} Termine` : null].filter(Boolean)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <motion.h1 key={focusDay} className="day-title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {title}
        </motion.h1>
        <span style={{ flex: 1 }} />
        {focusDay === today && (
          <>
            <button className="icon-btn sm" aria-label="Tag planen" title="Tag planen" onClick={() => openRitual('plan')}>
              <Sun size={16} />
            </button>
            <button className="icon-btn sm" aria-label="Tag abschließen" title="Tag abschließen" onClick={() => openRitual('review')}>
              <Moon size={16} />
            </button>
          </>
        )}
        <button className="icon-btn sm" aria-label="Vorheriger Tag" onClick={() => setFocusDay(addDaysStr(focusDay, -1))}>
          <ChevronLeft size={17} />
        </button>
        {focusDay !== today && (
          <button className="btn sm ghost" onClick={() => setFocusDay(today)}>
            Heute
          </button>
        )}
        <button className="icon-btn sm" aria-label="Nächster Tag" onClick={() => setFocusDay(addDaysStr(focusDay, 1))}>
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="day-sub">
        {longDayLabel(focusDay)} · {parts.join(' · ')}
      </div>
    </>
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
    for (const t of Object.values(tasks)) if (t.status === 'open' && t.due_date) c[t.due_date] = (c[t.due_date] ?? 0) + 1
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

function AgendaSection({ title, tasks, late, dropId, empty, showDate, children }: { title: string; tasks: Task[]; late?: boolean; dropId?: string; empty?: string; showDate?: boolean; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `none:${title}`, disabled: !dropId })
  const dragging = useStore((s) => s.dragging)
  return (
    <section className="agenda-sec">
      <h3 className={late ? 'late' : ''}>
        {title}
        {tasks.length > 0 && <span style={{ fontWeight: 600 }}>{tasks.length}</span>}
      </h3>
      <div ref={setNodeRef} className={`agenda-list ${isOver ? 'over' : ''}`}>
        {children}
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <motion.div key={t.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
              <DraggableCard task={t} showDate={showDate} />
            </motion.div>
          ))}
        </AnimatePresence>
        {dropId && dragging && tasks.length === 0 && empty && <div className="agenda-empty">{empty}</div>}
      </div>
    </section>
  )
}

function DoneSection({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="agenda-sec">
      <button className={`done-toggle ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} style={{ paddingLeft: 6 }}>
        <ChevronRight /> Erledigt ({tasks.length})
      </button>
      {open && (
        <div className="agenda-list" style={{ marginTop: 6 }}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} showDate={false} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Handy: Leiste mit Aufgaben des Tages, die man ins Raster ziehen kann */
function PlanTray({ tasks, deadlines, day }: { tasks: Task[]; deadlines: Task[]; day: string }) {
  const [open, setOpen] = useState(true)
  const { setNodeRef, isOver } = useDroppable({ id: `unplan:${day}` })
  return (
    <div ref={setNodeRef} className="plan-tray" style={isOver ? { background: 'var(--accent-soft)' } : undefined}>
      <button className="plan-tray-head" onClick={() => setOpen((o) => !o)} style={{ width: '100%' }}>
        Zu planen · {tasks.length}
        <span style={{ flex: 1 }} />
        <ChevronDown size={16} style={{ transform: open ? 'none' : 'rotate(180deg)', transition: 'transform .2s' }} />
      </button>
      {open && (
        <div className="plan-tray-list">
          {tasks.length === 0 && <span className="muted small" style={{ padding: '6px 0' }}>Nichts mehr offen – lange drücken & ziehen, um Aufgaben einzuplanen.</span>}
          {tasks.map((t) => (
            <DraggableCard key={t.id} task={t} showDate={t.due_date !== day} />
          ))}
          {deadlines.length > 0 && <div className="tray-label">Fristen bald</div>}
          {deadlines.map((t) => (
            <DraggableCard key={t.id} task={t} showDate />
          ))}
        </div>
      )}
    </div>
  )
}
