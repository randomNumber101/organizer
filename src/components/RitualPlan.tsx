/**
 * „Tag planen“: Reste klären, Aufgaben für heute wählen (gruppiert), Reihenfolge + Dauer (ohne Uhrzeiten).
 * Unteraufgaben erscheinen immer unter ihrer Aufgabe, nicht als eigene Einträge.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, CornerDownRight, GripVertical, Inbox, Lock, Plus, Search, X, Zap, Flame } from 'lucide-react'
import { useStore, eventsFor } from '../store'
import type { List, Task } from '../lib/types'
import { IMPORTANT } from '../lib/types'
import { addDaysStr, localDayOf, timeLabel } from '../lib/dates'
import { BUCKETS, bucketOf, freeMinutes, minutesText, planDay } from '../lib/dayplan'
import { DayList } from './DayList'
import { isBlocked } from '../lib/blocking'
import { ancestors, childrenOf, compareTasks } from '../lib/tree'
import { matchesSearch } from '../lib/compose'
import { deadlineDay } from '../lib/filter'
import { haptic } from '../lib/haptics'
import { TaskMeta } from './TaskCard'

const byPrio = (a: Task, b: Task) => b.priority - a.priority || (a.deadline ?? '9').localeCompare(b.deadline ?? '9') || compareTasks(a, b)
const openKids = (tasks: Record<string, Task>, id: string) => childrenOf(tasks, id).filter((k) => k.status === 'open').sort(compareTasks)

/** Aufgaben so ordnen, dass Unteraufgaben direkt unter ihrer Aufgabe stehen */
export function treeOrder(tasks: Record<string, Task>, list: Task[], sort: (a: Task, b: Task) => number = byPrio): { task: Task; depth: number; crumb: string[] }[] {
  const ids = new Set(list.map((t) => t.id))
  const out: { task: Task; depth: number; crumb: string[] }[] = []
  const visit = (t: Task, depth: number, crumb: string[]) => {
    out.push({ task: t, depth, crumb })
    for (const k of list.filter((x) => x.parent_id === t.id).sort(sort)) visit(k, depth + 1, [])
  }
  for (const t of list.filter((x) => !x.parent_id || !ids.has(x.parent_id)).sort(sort)) {
    const anc = ancestors(tasks, t).filter((a) => !ids.has(a.id))
    visit(t, 0, anc.map((a) => a.title))
  }
  return out
}

function Crumb({ path }: { path: string[] }) {
  if (!path.length) return null
  return <span className="r-crumb">{path.join(' › ')} ›</span>
}

// ---------------------------------------------------------------------------
// Schritt „Was steht heute an?“
// ---------------------------------------------------------------------------
interface Row {
  task: Task
  crumb: string[]
}

interface Groups {
  important: Row[]
  small: Row[]
  rest: { list: List | null; rows: Row[] }[]
  restCount: number
  blocked: number
}

function useGroups(today: string, query: string): Groups {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  return useMemo(() => {
    const week = addDaysStr(today, 7)
    const plannedToday = (t: Task) => t.due_date === today || ancestors(tasks, t).some((a) => a.status === 'open' && a.due_date === today)
    const soonDeadline = (t: Task) => !!t.deadline && deadlineDay(t.deadline) <= week
    let blocked = 0
    const cands = Object.values(tasks).filter((t) => {
      if (t.status !== 'open' || t.start_at || plannedToday(t)) return false
      if (t.due_date && !(soonDeadline(t) && t.due_date > today)) return false
      if (isBlocked(tasks, t)) blocked++
      return true
    })
    const set = new Set(cands.map((t) => t.id))
    const hit = (t: Task): boolean => !query || matchesSearch(t, query) || openKids(tasks, t.id).some(hit)
    // Zeilen = Aufgaben, deren Elternaufgabe selbst keine Zeile ist; Unteraufgaben hängen darunter
    const roots = cands.filter((t) => (!t.parent_id || !set.has(t.parent_id)) && hit(t))
    const crumbOf = (t: Task) => ancestors(tasks, t).map((a) => a.title)
    const important = (t: Task) => t.priority >= IMPORTANT || soonDeadline(t)
    const small = (t: Task) => (t.estimate !== null && t.estimate <= 30) || (t.estimate === null && t.horizon === 'short' && openKids(tasks, t.id).length === 0)

    const imp = roots.filter(important)
    const impIds = new Set(imp.map((t) => t.id))
    // wichtige Unteraufgaben zusätzlich oben zeigen, wenn ihre Aufgabe es nicht ist
    const impSubs = cands.filter((t) => t.parent_id && set.has(t.parent_id) && important(t) && !ancestors(tasks, t).some((a) => impIds.has(a.id)) && (!query || matchesSearch(t, query)))
    const byDeadline = (a: Task, b: Task) => (a.deadline ? deadlineDay(a.deadline) : '9').localeCompare(b.deadline ? deadlineDay(b.deadline) : '9') || byPrio(a, b)
    const importantRows = [...imp, ...impSubs].sort(byDeadline).map((t) => ({ task: t, crumb: crumbOf(t) }))

    const sm = roots.filter((t) => !impIds.has(t.id) && small(t)).sort((a, b) => (a.estimate ?? 999) - (b.estimate ?? 999) || byPrio(a, b))
    const smIds = new Set(sm.map((t) => t.id))
    const restRoots = roots.filter((t) => !impIds.has(t.id) && !smIds.has(t.id))
    const order = [null, ...Object.values(lists).filter((l) => !l.archived).sort((a, b) => a.sort - b.sort)]
    const rest = order
      .map((l) => ({ list: l, rows: restRoots.filter((t) => (t.list_id ?? null) === (l?.id ?? null)).sort(byPrio).map((t) => ({ task: t, crumb: crumbOf(t) })) }))
      .filter((g) => g.rows.length)
    // Aufgaben in archivierten/unbekannten Listen
    const known = new Set(order.map((l) => l?.id ?? null))
    const orphans = restRoots.filter((t) => !known.has(t.list_id ?? null))
    if (orphans.length) rest.push({ list: null, rows: orphans.sort(byPrio).map((t) => ({ task: t, crumb: crumbOf(t) })) })
    return { important: importantRows, small: sm.map((t) => ({ task: t, crumb: crumbOf(t) })), rest, restCount: restRoots.length, blocked }
  }, [tasks, lists, today, query])
}

export function PickStep({ today, children }: { today: string; children?: ReactNode }) {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const [query, setQuery] = useState('')
  const [showRest, setShowRest] = useState(false)
  const groups = useGroups(today, query)

  const todays = Object.values(tasks).filter((t) => t.status === 'open' && t.due_date === today)
  const todayRows = treeOrder(tasks, todays, (a, b) => (a.start_at ?? '~').localeCompare(b.start_at ?? '~') || byPrio(a, b))
  const todayEvents = eventsFor(events, today, today)
    .filter((e) => (e.allDay ? e.start <= today && today < e.end : localDayOf(e.start) === today))
    .sort((a, b) => a.start.localeCompare(b.start))
  const restOpen = showRest || !!query

  return (
    <div className="r-cols">
      <section>
        <h3 className="r-sub">
          Heute <span>{todayRows.filter((r) => r.depth === 0).length}</span>
        </h3>
        <div className="r-list">
          <AnimatePresence initial={false}>
            {todayRows.map((r) => (
              <motion.div key={r.task.id} layout="position" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, height: 0 }}>
                <TodayRow task={r.task} depth={r.depth} crumb={r.crumb} today={today} />
              </motion.div>
            ))}
          </AnimatePresence>
          {todayRows.length === 0 && <p className="muted small">Noch nichts für heute. Nimm dir etwas aus den Vorschlägen.</p>}
          {children}
        </div>
        {todayEvents.length > 0 && (
          <>
            <h3 className="r-sub" style={{ marginTop: 16 }}>
              Termine <span>{todayEvents.length}</span>
            </h3>
            <div className="r-events">
              {todayEvents.map((e) => (
                <div key={`${e.calendarId}|${e.id}`} className="r-event">
                  <i style={{ background: e.color }} />
                  <span className="r-event-time">{e.allDay ? 'ganztägig' : `${timeLabel(e.start)}–${timeLabel(e.end)}`}</span>
                  <span className="r-event-title">{e.title}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="r-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Aufgabe suchen …" aria-label="Aufgaben ohne Termin durchsuchen" />
          {query && (
            <button className="icon-btn sm" aria-label="Suche leeren" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <Group icon={<Flame size={14} />} title="Wichtig & Fristen" hint="Wichtigkeit 3–5 oder Frist in den nächsten 7 Tagen" rows={groups.important} today={today} />
        <Group icon={<Zap size={14} />} title="Kleinere Aufgaben" hint="bis 30 Min. oder kurzfristig" rows={groups.small} today={today} />

        {groups.restCount > 0 && (
          <div className="r-group">
            <button className={`r-group-toggle ${restOpen ? 'open' : ''}`} onClick={() => setShowRest((v) => !v)} aria-expanded={restOpen}>
              <ChevronDown size={15} />
              Alle anderen ohne Termin <span>{groups.restCount}</span>
            </button>
            <AnimatePresence initial={false}>
              {restOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  {groups.rest.map((g) => (
                    <div key={g.list?.id ?? 'inbox'} className="r-listgroup">
                      <div className="r-listname">
                        {g.list ? <span className="dot" style={{ background: g.list.color }} /> : <Inbox size={12} />}
                        {g.list?.name ?? 'Unsortiert'}
                      </div>
                      <div className="r-list">
                        <AnimatePresence initial={false}>
                          {g.rows.map((r) => (
                            <SuggestRow key={r.task.id} task={r.task} crumb={r.crumb} today={today} showList={false} />
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {groups.important.length + groups.small.length + groups.restCount === 0 && <p className="muted small">{query ? 'Nichts gefunden.' : 'Keine offenen Aufgaben ohne Termin.'}</p>}
      </section>
    </div>
  )
}

function Group({ icon, title, hint, rows, today }: { icon: ReactNode; title: string; hint: string; rows: Row[]; today: string }) {
  if (!rows.length) return null
  return (
    <div className="r-group">
      <h3 className="r-sub" title={hint}>
        {icon}
        {title} <span>{rows.length}</span>
      </h3>
      <div className="r-list">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <SuggestRow key={r.task.id} task={r.task} crumb={r.crumb} today={today} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Vorschlag: antippen = für heute; Unteraufgaben einzeln übernehmbar */
function SuggestRow({ task, crumb, today, showList = true }: { task: Task; crumb: string[]; today: string; showList?: boolean }) {
  const moveToDay = useStore((s) => s.moveToDay)
  const waiting = useStore((s) => isBlocked(s.tasks, task))
  const add = (id: string) => {
    haptic(8)
    moveToDay(id, today)
  }
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30, height: 0 }} className="r-tree">
      <div className={`r-row compact suggest ${waiting ? 'waiting' : ''}`} role="button" tabIndex={0} onClick={() => add(task.id)} onKeyDown={(e) => e.key === 'Enter' && add(task.id)}>
        <span className="r-plus" aria-hidden>
          <Plus size={15} />
        </span>
        <div className="r-row-main">
          <Crumb path={crumb} />
          <span className="r-row-title">
            {waiting && <Lock size={13} className="wait-lock" aria-label="wartet" />}
            {task.title}
          </span>
          <TaskMeta task={task} showList={showList} showSubs={false} />
        </div>
      </div>
      <KidLines task={task} today={today} onAdd={add} />
    </motion.div>
  )
}

/** Unteraufgaben als eingerückte Zeilen */
function KidLines({ task, today, onAdd }: { task: Task; today: string; onAdd?: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks)
  const [all, setAll] = useState(false)
  const kids = openKids(tasks, task.id)
  if (!kids.length) return null
  const shown = all ? kids : kids.slice(0, 5)
  return (
    <div className="r-kids">
      {shown.map((k) => {
        const grand = openKids(tasks, k.id).length
        const planned = k.due_date === today
        return (
          <div key={k.id} className={`r-kid ${planned ? 'planned' : ''}`}>
            <CornerDownRight size={13} className="r-kid-icon" />
            <span className="r-kid-title">{k.title}</span>
            {grand > 0 && <span className="r-kid-meta">{grand}</span>}
            {k.estimate && <span className="r-kid-meta">{k.estimate} Min.</span>}
            {k.due_date && !planned && <span className="r-kid-meta">{k.due_date.slice(8, 10)}.{k.due_date.slice(5, 7)}.</span>}
            {planned && <span className="r-kid-meta on">heute</span>}
            {onAdd && !planned && (
              <button
                className="r-kid-add"
                aria-label={`Nur „${k.title}“ für heute`}
                title="Nur diese Unteraufgabe für heute"
                onClick={(e) => {
                  e.stopPropagation()
                  onAdd(k.id)
                }}
              >
                <Plus size={13} />
              </button>
            )}
          </div>
        )
      })}
      {kids.length > 5 && (
        <button className="r-kid-more" onClick={() => setAll((v) => !v)}>
          {all ? 'weniger' : `+ ${kids.length - 5} weitere`}
        </button>
      )}
    </div>
  )
}

function TodayRow({ task, depth, crumb, today }: { task: Task; depth: number; crumb: string[]; today: string }) {
  const moveToDay = useStore((s) => s.moveToDay)
  const tasks = useStore((s) => s.tasks)
  // Unteraufgaben, die selbst für heute geplant sind, stehen als eigene (eingerückte) Zeile darunter
  const kidsWithoutDate = openKids(tasks, task.id).some((k) => k.due_date !== today)
  return (
    <div className="r-tree" style={{ marginLeft: depth * 22 }}>
      <div className={`r-row compact ${depth ? 'nested' : ''}`}>
        {depth > 0 && <CornerDownRight size={14} className="r-kid-icon" />}
        <div className="r-row-main">
          <Crumb path={crumb} />
          <span className="r-row-title">{task.title}</span>
          <TaskMeta task={task} showDate={false} showSubs={false} />
        </div>
        <button className="icon-btn sm" aria-label={`„${task.title}“ heute nicht`} title="Heute nicht" onClick={() => moveToDay(task.id, null)}>
          <X size={15} />
        </button>
      </div>
      {kidsWithoutDate && <KidLinesExcept task={task} today={today} />}
    </div>
  )
}

/** Unteraufgaben ohne eigenen Heute-Eintrag (die mit stehen als eigene Zeile darunter) */
function KidLinesExcept({ task, today }: { task: Task; today: string }) {
  const tasks = useStore((s) => s.tasks)
  const kids = openKids(tasks, task.id).filter((k) => k.due_date !== today)
  return (
    <div className="r-kids">
      {kids.slice(0, 6).map((k) => (
        <div key={k.id} className="r-kid">
          <CornerDownRight size={13} className="r-kid-icon" />
          <span className="r-kid-title">{k.title}</span>
          {k.estimate && <span className="r-kid-meta">{k.estimate} Min.</span>}
          {k.due_date && <span className="r-kid-meta">{k.due_date.slice(8, 10)}.{k.due_date.slice(5, 7)}.</span>}
        </div>
      ))}
      {kids.length > 6 && <span className="r-kid-more">+ {kids.length - 6} weitere</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schritt „In welcher Reihenfolge?“ – ohne Uhrzeiten
// ---------------------------------------------------------------------------
export function OrderStep({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const end = useStore((s) => s.prefs.day?.end ?? '20:00')
  const plan = useMemo(() => planDay(tasks, today), [tasks, today])
  const free = freeMinutes(today, today, end, eventsFor(events, today, today))
  if (!plan.rows.length) return <p className="muted">Für heute ist nichts offen. Geh einen Schritt zurück und nimm dir etwas vor.</p>
  return (
    <div>
      <p className="muted small" style={{ margin: '-8px 0 12px' }}>
        Ziehen <GripVertical size={12} style={{ verticalAlign: -2 }} /> ändert die Reihenfolge, die Dauer antippen ordnet die Aufgabe ein: Mini (5 min), zwischendurch (15 min) oder länger.
      </p>
      <DayList rows={plan.rows} day={today} mode="order" compact />
      <DayStats rows={plan.rows} minutes={plan.minutes} unknown={plan.unknown} free={free} end={end} />
    </div>
  )
}

/** Überblick: wie viele Mini-/Zwischendurch-/längere Aufgaben, wie viel Zeit */
export function DayStats({ rows, minutes, unknown, free, end }: { rows: Task[]; minutes: number; unknown: number; free: number; end: string }) {
  const count = (b: string) => rows.filter((t) => bucketOf(t) === b).length
  return (
    <div className="day-stats">
      <div className="day-stat-chips">
        {BUCKETS.filter((b) => count(b.id)).map((b) => (
          <span key={b.id} className={`dur-chip static ${b.id}`}>
            {count(b.id)} {b.label}
          </span>
        ))}
      </div>
      <span className="muted small">
        {minutes > 0 ? `zusammen ~${minutesText(minutes)}` : 'noch keine Dauer geschätzt'}
        {unknown > 0 && minutes > 0 && ` (+${unknown} ohne Dauer)`} · bis {end} frei: {minutesText(free)}
        {minutes > free && <b className="budget-warn"> – das wird knapp</b>}
      </span>
    </div>
  )
}
