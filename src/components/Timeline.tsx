import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useStore, eventsFor } from '../store'
import type { CalendarEvent, Task } from '../lib/types'
import { addDaysStr, hhmm, isoFromDayMinutes, minutesBetween, todayStr, weekdayShort, dayNum } from '../lib/dates'
import { layoutDay } from '../lib/layout'
import { justDragged, markDragEnd } from '../lib/drag'
import { evColor, weekNumber } from '../lib/calendar'
import { isPart, partInfo } from '../lib/parts'
import { useNow } from '../hooks/useMedia'
import { usePlan } from './PlanDnd'
import Check from './Check'
import { Segments } from './PartBadge'

const anchorOf = (r: DOMRect) => ({ x: r.right, y: r.top })

interface Props {
  days: string[]
  hourPx: number
  showHeader?: boolean
  /** Tagesaufgaben ohne Uhrzeit in der Ganztags-Zeile zeigen */
  allDayTasks?: boolean
  onDayHeaderClick?: (day: string) => void
  /** Klick/Aufziehen legt standardmäßig eine Aufgabe statt eines Termins an (z. B. in „Heute“) */
  createTask?: boolean
}

type Item = { kind: 'task'; task: Task } | { kind: 'event'; event: CalendarEvent }

const dayStartMs = (day: string) => new Date(`${day}T00:00:00`).getTime()

/** Zeitraster für einen oder mehrere Tage: Google-Termine + Aufgaben mit Uhrzeit */
export default function Timeline({ days, hourPx, showHeader = true, allDayTasks = true, onDayHeaderClick, createTask = false }: Props) {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const google = useStore((s) => s.google)
  const loadEvents = useStore((s) => s.loadEvents)
  const lists = useStore((s) => s.lists)
  const prefs = useStore((s) => s.prefs)
  const openEventEditor = useStore((s) => s.openEventEditor)
  const scrollRef = useRef<HTMLDivElement>(null)
  const openEvent = (event: CalendarEvent, rect: DOMRect) => openEventEditor({ mode: 'edit', event, anchor: anchorOf(rect) })
  const today = todayStr()
  const from = days[0]
  const to = days[days.length - 1]

  useEffect(() => {
    if (google?.connected) void loadEvents(from, to)
  }, [from, to, google?.connected, google?.status, loadEvents])

  // beim Öffnen zur aktuellen Uhrzeit (oder 7 Uhr) scrollen
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const target = days.includes(today) ? Math.max(0, now.getHours() * 60 + now.getMinutes() - 90) : 7 * 60
    el.scrollTop = (target / 60) * hourPx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, hourPx])

  // Termine, die schon als Aufgabe übernommen wurden, nicht doppelt zeigen
  const rangeEvents = useMemo(() => {
    const imported = new Set(Object.values(tasks).map((t) => t.origin_event_id).filter(Boolean))
    return eventsFor(events, from, to).filter((e) => !imported.has(e.id))
  }, [events, from, to, tasks])

  const perDay = useMemo(() => {
    const out: Record<string, { allDay: Item[]; timed: { item: Item; start: number; end: number }[] }> = {}
    for (const d of days) out[d] = { allDay: [], timed: [] }
    for (const t of Object.values(tasks)) {
      if (t.start_at && t.end_at) {
        const ds = new Date(t.start_at)
        const d = `${ds.getFullYear()}-${String(ds.getMonth() + 1).padStart(2, '0')}-${String(ds.getDate()).padStart(2, '0')}`
        if (!out[d]) continue
        const start = ds.getHours() * 60 + ds.getMinutes()
        out[d].timed.push({ item: { kind: 'task', task: t }, start, end: Math.min(24 * 60, start + Math.max(15, minutesBetween(t.start_at, t.end_at))) })
      } else if (allDayTasks && t.due_date && out[t.due_date] && t.status === 'open') {
        out[t.due_date].allDay.push({ kind: 'task', task: t })
      }
    }
    for (const e0 of rangeEvents) {
      const e = { ...e0, color: evColor(e0, prefs) }
      if (e.allDay) {
        for (const d of days) if (e.start <= d && d < e.end) out[d].allDay.push({ kind: 'event', event: e })
        continue
      }
      const s = Date.parse(e.start)
      const en = Date.parse(e.end)
      for (const d of days) {
        const ds = dayStartMs(d)
        const de = ds + 86_400_000
        if (en <= ds || s >= de) continue
        const start = Math.max(0, Math.round((s - ds) / 60_000))
        const end = Math.min(24 * 60, Math.round((en - ds) / 60_000))
        out[d].timed.push({ item: { kind: 'event', event: e }, start, end })
      }
    }
    return out
  }, [tasks, rangeEvents, days, allDayTasks, prefs])

  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`
  const hasAllDay = days.some((d) => perDay[d].allDay.length > 0)

  return (
    <div className="tl" style={{ ['--hour' as string]: `${hourPx}px` }}>
      {showHeader && (
        <div className="tl-head" style={{ gridTemplateColumns: cols }}>
          <div className="tl-kw" title="Kalenderwoche">
            KW {weekNumber(days[0])}
          </div>
          {days.map((d) => (
            <button key={d} className={`tl-dayhead ${d === today ? 'is-today' : ''}`} onClick={() => onDayHeaderClick?.(d)}>
              {weekdayShort(d)}
              <b>{dayNum(d)}</b>
            </button>
          ))}
        </div>
      )}
      {(hasAllDay || days.length > 1) && (
        <div className="tl-allday" style={{ gridTemplateColumns: cols }}>
          <div className="tl-allday-label">ganztags</div>
          {days.map((d) => (
            <AllDayCell key={d} day={d} items={perDay[d].allDay} lists={lists} onEvent={openEvent} />
          ))}
        </div>
      )}
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-grid" style={{ gridTemplateColumns: cols, height: 24 * hourPx }}>
          <div className="tl-gutter">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="tl-hour" style={{ top: (i + 1) * hourPx }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn key={d} day={d} hourPx={hourPx} timed={perDay[d].timed} onEvent={openEvent} asTask={createTask} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AllDayCell({ day, items, lists, onEvent }: { day: string; items: Item[]; lists: Record<string, { color: string }>; onEvent: (e: CalendarEvent, r: DOMRect) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday:${day}` })
  const openEventEditor = useStore((s) => s.openEventEditor)
  return (
    <div
      ref={setNodeRef}
      className={`tl-allday-cell ${isOver ? 'over' : ''}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget || justDragged()) return
        openEventEditor({ mode: 'new', draft: { allDay: true, start: day, end: addDaysStr(day, 1) }, anchor: { x: e.clientX, y: e.clientY } })
      }}
    >
      {items.map((it) =>
        it.kind === 'event' ? (
          <EventPill key={`e-${it.event.calendarId}-${it.event.id}`} event={it.event} onOpen={onEvent} />
        ) : (
          <TaskPill key={it.task.id} task={it.task} color={it.task.list_id ? lists[it.task.list_id]?.color : undefined} />
        ),
      )}
    </div>
  )
}

function EventPill({ event, onOpen }: { event: CalendarEvent; onOpen: (e: CalendarEvent, r: DOMRect) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `pill-ev:${event.calendarId}:${event.id}`, data: { type: 'event', event }, disabled: !event.writable })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`pill event ${event.pending ? 'pending' : ''}`}
      style={{ ['--ev' as string]: event.color, opacity: isDragging ? 0.35 : 1 }}
      onClick={(e) => {
        e.stopPropagation()
        if (!justDragged()) onOpen(event, e.currentTarget.getBoundingClientRect())
      }}
    >
      {event.title}
    </button>
  )
}

function TaskPill({ task, color }: { task: Task; color?: string }) {
  const select = useStore((s) => s.select)
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `pill:${task.id}`, data: { type: 'task', taskId: task.id } })
  return (
    <button ref={setNodeRef} {...attributes} {...listeners} className={`pill task ${task.status === 'done' ? 'done' : ''}`} style={{ opacity: isDragging ? 0.35 : 1 }} onClick={() => !justDragged() && select(task.id)}>
      <span className="dot" style={{ background: color ?? 'var(--line-2)' }} />
      {task.title}
    </button>
  )
}

function DayColumn({ day, hourPx, timed, onEvent, asTask }: { day: string; hourPx: number; timed: { item: Item; start: number; end: number }[]; onEvent: (e: CalendarEvent, r: DOMRect) => void; asTask?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` })
  const { preview, activeId } = usePlan()
  const openEventEditor = useStore((s) => s.openEventEditor)
  const now = useNow()
  const isToday = day === todayStr()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const pxPerMin = hourPx / 60
  const placed = useMemo(() => layoutDay(timed), [timed])
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null)
  const byMouse = useRef(false)

  const isBackground = (t: EventTarget, cur: EventTarget) => t === cur || (t instanceof HTMLElement && t.classList.contains('past'))
  const minuteAt = (clientY: number, el: HTMLElement) => (clientY - el.getBoundingClientRect().top) / pxPerMin
  const openNew = (from: number, to: number, x: number, y: number) =>
    openEventEditor({ mode: 'new', draft: { allDay: false, start: isoFromDayMinutes(day, from), end: isoFromDayMinutes(day, to), asTask }, anchor: { x, y } })

  // Maus: Zeitraum aufziehen = neuer Eintrag in dieser Länge
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !isBackground(e.target, e.currentTarget)) return
    byMouse.current = true
    const el = e.currentTarget
    const a = Math.floor(minuteAt(e.clientY, el) / 15) * 15
    let b = a
    const y0 = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - y0) > 6) moved = true
      if (!moved) return
      b = Math.max(0, Math.min(24 * 60, Math.round(minuteAt(ev.clientY, el) / 15) * 15))
      setSel({ from: Math.min(a, b), to: Math.max(a, b, Math.min(a, b) + 15) })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setSel(null)
      if (justDragged()) return
      if (moved) {
        const from = Math.min(a, b)
        const to = Math.max(from + 15, Math.max(a, b))
        markDragEnd()
        openNew(from, to, ev.clientX, ev.clientY)
      } else {
        const start = Math.max(0, Math.min(23 * 60, Math.floor(a / 30) * 30))
        openNew(start, start + 60, ev.clientX, ev.clientY)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Finger: antippen = neuer Eintrag (1 Std.)
  const onBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (byMouse.current) {
      byMouse.current = false
      return
    }
    if (!isBackground(e.target, e.currentTarget) || justDragged()) return
    const start = Math.max(0, Math.min(23 * 60, Math.floor(minuteAt(e.clientY, e.currentTarget) / 30) * 30))
    openNew(start, start + 60, e.clientX, e.clientY)
  }

  return (
    <div ref={setNodeRef} data-tl-day={day} className={`tl-day ${isToday ? 'is-today' : ''} ${isOver ? 'over' : ''}`} onPointerDown={onPointerDown} onClick={onBackgroundClick}>
      {isToday && <div className="past" style={{ height: nowMin * pxPerMin }} />}
      {sel && (
        <div className="tl-select" style={{ top: sel.from * pxPerMin, height: (sel.to - sel.from) * pxPerMin }}>
          {hhmm(sel.from)}–{hhmm(sel.to)}
        </div>
      )}
      {placed.map((p) => {
        const style = {
          top: p.start * pxPerMin + 1,
          height: Math.max(18, (p.end - p.start) * pxPerMin - 2),
          left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
          width: `calc(${100 / p.cols}% - 4px)`,
        }
        return p.item.kind === 'task' ? (
          <TaskBlock key={p.item.task.id} task={p.item.task} day={day} start={p.start} end={p.end} style={style} pxPerMin={pxPerMin} ghost={activeId === p.item.task.id} />
        ) : (
          <EventBlock key={`${p.item.event.calendarId}-${p.item.event.id}`} event={p.item.event} day={day} start={p.start} end={p.end} style={style} onOpen={onEvent} pxPerMin={pxPerMin} ghost={activeId === `ev:${p.item.event.calendarId}:${p.item.event.id}`} />
        )
      })}
      {isToday && <div className="tl-now" style={{ top: nowMin * pxPerMin }} />}
      {preview?.kind === 'slot' && preview.day === day && (
        <div className="tl-preview" style={{ top: preview.start * pxPerMin, height: preview.dur * pxPerMin }}>
          {hhmm(preview.start)}–{hhmm(preview.start + preview.dur)}
        </div>
      )}
    </div>
  )
}

function EventBlock({
  event,
  day,
  start,
  end,
  style,
  onOpen,
  pxPerMin,
  ghost,
}: {
  event: CalendarEvent
  day: string
  start: number
  end: number
  style: React.CSSProperties
  onOpen: (e: CalendarEvent, r: DOMRect) => void
  pxPerMin: number
  ghost: boolean
}) {
  const updateEvent = useStore((s) => s.updateEvent)
  const key = `ev:${event.calendarId}:${event.id}`
  const { setNodeRef, attributes, listeners } = useDraggable({ id: key, data: { type: 'event', event }, disabled: !event.writable })
  const [tempEnd, setTempEnd] = useState<number | null>(null)
  const effEnd = tempEnd ?? end
  const short = effEnd - start < 40

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const y0 = e.clientY
    const base = end
    let last = base
    const move = (ev: PointerEvent) => {
      last = Math.max(start + 15, Math.min(24 * 60, Math.round((base + (ev.clientY - y0) / pxPerMin) / 15) * 15))
      setTempEnd(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      markDragEnd()
      if (last !== base) void updateEvent(event, { start: event.start, end: isoFromDayMinutes(day, last), allDay: false })
      setTimeout(() => setTempEnd(null), 50)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-block={key}
      className={`tl-item tl-event ${short ? 'short' : ''} ${ghost ? 'ghost' : ''} ${event.pending ? 'pending' : ''} ${event.writable ? 'movable' : ''}`}
      style={{ ...style, height: tempEnd !== null ? Math.max(18, (effEnd - start) * pxPerMin - 2) : style.height, ['--ev' as string]: event.color }}
      onClick={(e) => {
        e.stopPropagation()
        if (!justDragged()) onOpen(event, e.currentTarget.getBoundingClientRect())
      }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(event, e.currentTarget.getBoundingClientRect())}
      title={`${event.title} · ${event.calendarName}`}
    >
      <span className="t-title">{event.title}</span>
      <span className="t-time">
        {hhmm(start)}–{hhmm(effEnd)}
        {event.location && !short ? ` · ${event.location}` : ''}
      </span>
      {event.writable && <div className="resize" onPointerDown={onResizeDown} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />}
    </div>
  )
}

function TaskBlock({ task, day, start, end, style, pxPerMin, ghost }: { task: Task; day: string; start: number; end: number; style: React.CSSProperties; pxPerMin: number; ghost: boolean }) {
  const select = useStore((s) => s.select)
  const toggleDone = useStore((s) => s.toggleDone)
  const updateTask = useStore((s) => s.updateTask)
  const color = useStore((s) => (task.list_id ? s.lists[task.list_id]?.color : undefined))
  const { setNodeRef, attributes, listeners } = useDraggable({ id: `block:${task.id}`, data: { type: 'block', taskId: task.id } })
  const tasks = useStore((s) => s.tasks)
  const part = useMemo(() => (isPart(task) ? partInfo(tasks, task) : null), [tasks, task])
  const [tempEnd, setTempEnd] = useState<number | null>(null)
  const effEnd = tempEnd ?? end
  const short = effEnd - start < 40

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const y0 = e.clientY
    const base = end
    let last = base
    const move = (ev: PointerEvent) => {
      last = Math.max(start + 15, Math.min(24 * 60, Math.round((base + (ev.clientY - y0) / pxPerMin) / 15) * 15))
      setTempEnd(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      markDragEnd()
      if (last !== base) void updateTask(task.id, { end_at: isoFromDayMinutes(day, last) })
      setTimeout(() => setTempEnd(null), 50)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-block={task.id}
      className={`tl-item tl-task ${short ? 'short' : ''} ${task.status === 'done' ? 'done' : ''} ${ghost ? 'ghost' : ''} ${part ? 'part' : ''}`}
      style={{ ...style, height: tempEnd !== null ? Math.max(18, (effEnd - start) * pxPerMin - 2) : style.height, ['--lc' as string]: color ?? 'var(--accent)' }}
      onClick={(e) => {
        e.stopPropagation()
        if (!justDragged()) select(task.id)
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', minWidth: 0 }}>
        <Check done={task.status === 'done'} size="small" priority={task.priority} onToggle={() => void toggleDone(task.id)} />
        <span className="t-title">{task.title}</span>
        {part && (
          <span className="t-part" title={`Teil ${part.index} von ${part.count}`}>
            <Segments parts={part.parts} current={task.id} />
          </span>
        )}
      </div>
      {!short && (
        <span className="t-time">
          {hhmm(start)}–{hhmm(effEnd)}
        </span>
      )}
      <div className="resize" onPointerDown={onResizeDown} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
