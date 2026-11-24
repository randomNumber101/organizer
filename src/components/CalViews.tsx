/**
 * Kalender-Ansichten ohne Zeitraster: Monat, Jahr, Liste – und die Seitenleiste (Mini-Monat, Kalender).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Search, X } from 'lucide-react'
import { useStore, eventsFor } from '../store'
import type { CalendarEvent, Task } from '../lib/types'
import { addDaysStr, dayNum, hhmm, localDayOf, minutesOfDay, todayStr } from '../lib/dates'
import { addMonths, evColor, eventsByDay, fmtDayLong, monthGrid, monthName, sameMonth, tasksByDay, weekNumber, yearOf } from '../lib/calendar'
import { justDragged } from '../lib/drag'
import { isPart } from '../lib/parts'
import { api } from '../lib/api'
import { LIST_COLORS } from '../lib/types'
import Check from './Check'

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function useRangeEvents(from: string, to: string) {
  const events = useStore((s) => s.events)
  const tasks = useStore((s) => s.tasks)
  const prefs = useStore((s) => s.prefs)
  const google = useStore((s) => s.google)
  const loadEvents = useStore((s) => s.loadEvents)
  useEffect(() => {
    if (google?.connected) void loadEvents(from, to)
  }, [from, to, google?.connected, google?.status, loadEvents])
  return useMemo(() => {
    const imported = new Set(Object.values(tasks).map((t) => t.origin_event_id).filter(Boolean))
    return eventsFor(events, from, to)
      .filter((e) => !imported.has(e.id))
      .map((e) => ({ ...e, color: evColor(e, prefs) }))
  }, [events, from, to, tasks, prefs])
}

const timeOf = (e: CalendarEvent) => (e.allDay ? '' : hhmm(minutesOfDay(e.start)))

// ---------------------------------------------------------------------------
// Monat
// ---------------------------------------------------------------------------
export function MonthView({ focus, onOpenDay }: { focus: string; onOpenDay: (day: string) => void }) {
  const days = useMemo(() => monthGrid(focus), [focus])
  const evs = useRangeEvents(days[0], days[41])
  const tasks = useStore((s) => s.tasks)
  const weekNumbers = useStore((s) => s.prefs.calendar?.weekNumbers !== false)
  const byDay = useMemo(() => eventsByDay(evs), [evs])
  const tByDay = useMemo(() => tasksByDay(tasks), [tasks])
  const today = todayStr()
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7))
  return (
    <div className={`month ${weekNumbers ? 'with-kw' : ''}`}>
      <div className="month-head">
        {weekNumbers && <span className="month-kw-head">KW</span>}
        {WD.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month-body">
        {weeks.map((week) => (
          <div key={week[0]} className="month-week">
            {weekNumbers && <span className="month-kw">{weekNumber(week[0])}</span>}
            {week.map((d) => (
              <MonthCell key={d} day={d} out={!sameMonth(d, focus)} today={d === today} events={byDay.get(d) ?? []} tasks={tByDay.get(d) ?? []} onOpenDay={onOpenDay} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthCell({ day, out, today, events, tasks, onOpenDay }: { day: string; out: boolean; today: boolean; events: CalendarEvent[]; tasks: Task[]; onOpenDay: (d: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `mday:${day}` })
  const openEventEditor = useStore((s) => s.openEventEditor)
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(4)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setFit(Math.max(1, Math.floor((el.clientHeight - 26) / 21))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const items: ({ kind: 'e'; e: CalendarEvent } | { kind: 't'; t: Task })[] = [...events.map((e) => ({ kind: 'e' as const, e })), ...tasks.map((t) => ({ kind: 't' as const, t }))]
  const shown = items.length > fit ? items.slice(0, fit - 1) : items
  const more = items.length - shown.length
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        ref.current = el
      }}
      className={`month-cell ${out ? 'out' : ''} ${today ? 'is-today' : ''} ${isOver ? 'over' : ''}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget || justDragged()) return
        openEventEditor({ mode: 'new', draft: { allDay: true, start: day, end: addDaysStr(day, 1) }, anchor: { x: e.clientX, y: e.clientY } })
      }}
    >
      <button className="month-num" onClick={() => onOpenDay(day)} title={fmtDayLong(day)}>
        {dayNum(day) === '1' ? `1. ${monthName(day).slice(0, 3)}` : dayNum(day)}
      </button>
      {shown.map((it) => (it.kind === 'e' ? <MonthEvent key={`e-${it.e.calendarId}-${it.e.id}`} e={it.e} day={day} /> : <MonthTask key={it.t.id} t={it.t} />))}
      {more > 0 && (
        <button className="month-more" onClick={() => onOpenDay(day)}>
          + {more} weitere
        </button>
      )}
    </div>
  )
}

function MonthEvent({ e, day }: { e: CalendarEvent; day: string }) {
  const openEventEditor = useStore((s) => s.openEventEditor)
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `mev:${e.calendarId}:${e.id}:${day}`, data: { type: 'event', event: e }, disabled: !e.writable })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`month-item ${e.allDay ? 'allday' : 'timed'} ${e.pending ? 'pending' : ''}`}
      style={{ ['--ev' as string]: e.color, opacity: isDragging ? 0.35 : 1 }}
      onClick={(ev) => {
        ev.stopPropagation()
        if (!justDragged()) openEventEditor({ mode: 'edit', event: e, anchor: { x: ev.currentTarget.getBoundingClientRect().right, y: ev.currentTarget.getBoundingClientRect().top } })
      }}
      title={`${timeOf(e)} ${e.title}`.trim()}
    >
      {!e.allDay && <i className="dot" />}
      {!e.allDay && <span className="mi-time">{timeOf(e)}</span>}
      <span className="mi-title">{e.title}</span>
    </button>
  )
}

function MonthTask({ t }: { t: Task }) {
  const select = useStore((s) => s.select)
  const toggleDone = useStore((s) => s.toggleDone)
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `mtask:${t.id}`, data: { type: 'task', taskId: t.id } })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      className={`month-item task p${t.priority} ${isPart(t) ? 'part' : ''}`}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      onClick={(e) => {
        e.stopPropagation()
        if (!justDragged()) select(t.id)
      }}
      title={t.title}
    >
      <Check done={false} size="small" priority={t.priority} onToggle={() => toggleDone(t.id)} />
      {t.start_at && <span className="mi-time">{hhmm(minutesOfDay(t.start_at))}</span>}
      <span className="mi-title">{t.title}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Jahr
// ---------------------------------------------------------------------------
export function YearView({ focus, onOpenDay, onOpenMonth }: { focus: string; onOpenDay: (d: string) => void; onOpenMonth: (d: string) => void }) {
  const y = yearOf(focus)
  const evs = useRangeEvents(`${y}-01-01`, `${y}-12-31`)
  const tasks = useStore((s) => s.tasks)
  const byDay = useMemo(() => eventsByDay(evs), [evs])
  const tByDay = useMemo(() => tasksByDay(tasks), [tasks])
  const today = todayStr()
  return (
    <div className="year">
      {Array.from({ length: 12 }, (_, m) => {
        const first = `${y}-${String(m + 1).padStart(2, '0')}-01`
        return (
          <section key={first} className="year-month">
            <button className="year-title" onClick={() => onOpenMonth(first)}>
              {monthName(first)}
            </button>
            <MiniMonth month={first} today={today} selected={focus} onPick={onOpenDay} density={(d) => (byDay.get(d)?.length ?? 0) + (tByDay.get(d)?.length ?? 0)} />
          </section>
        )
      })}
    </div>
  )
}

/** kleiner Monat: Tage antippbar, Punkte für volle Tage */
export function MiniMonth({ month, today, selected, onPick, density, range }: { month: string; today: string; selected?: string; onPick: (d: string) => void; density?: (d: string) => number; range?: [string, string] }) {
  const days = monthGrid(month)
  return (
    <div className="mini-month">
      {WD.map((d) => (
        <span key={d} className="mm-wd">
          {d[0]}
        </span>
      ))}
      {days.map((d) => {
        const n = density?.(d) ?? 0
        const inRange = range && d >= range[0] && d <= range[1]
        return (
          <button
            key={d}
            className={`mm-day ${sameMonth(d, month) ? '' : 'out'} ${d === today ? 'is-today' : ''} ${d === selected ? 'sel' : ''} ${inRange ? 'range' : ''} ${n ? `busy b${Math.min(3, n)}` : ''}`}
            onClick={() => onPick(d)}
            aria-label={fmtDayLong(d)}
          >
            {dayNum(d)}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Liste (Agenda)
// ---------------------------------------------------------------------------
export function AgendaView({ focus, onOpenDay }: { focus: string; onOpenDay: (d: string) => void }) {
  const [len, setLen] = useState(30)
  const to = addDaysStr(focus, len - 1)
  const evs = useRangeEvents(focus, to)
  const tasks = useStore((s) => s.tasks)
  const openEventEditor = useStore((s) => s.openEventEditor)
  const select = useStore((s) => s.select)
  const toggleDone = useStore((s) => s.toggleDone)
  const byDay = useMemo(() => eventsByDay(evs), [evs])
  const tByDay = useMemo(() => tasksByDay(tasks), [tasks])
  const today = todayStr()
  const days = Array.from({ length: len }, (_, i) => addDaysStr(focus, i)).filter((d) => (byDay.get(d)?.length ?? 0) + (tByDay.get(d)?.length ?? 0) > 0)
  return (
    <div className="cal-agenda">
      {days.length === 0 && <p className="muted" style={{ padding: 20 }}>Keine Termine oder Aufgaben in den nächsten {len} Tagen.</p>}
      {days.map((d) => (
        <section key={d} className={`ag-day ${d === today ? 'is-today' : ''}`}>
          <button className="ag-date" onClick={() => onOpenDay(d)}>
            <b>{dayNum(d)}</b>
            <span>{fmtDayLong(d).split(',')[0]}</span>
            <small>{fmtDayLong(d).split(', ')[1]}</small>
          </button>
          <div className="ag-items">
            {(byDay.get(d) ?? []).map((e) => (
              <button
                key={`e-${e.calendarId}-${e.id}`}
                className="ag-item"
                style={{ ['--ev' as string]: e.color }}
                onClick={(ev) => openEventEditor({ mode: 'edit', event: e, anchor: { x: ev.currentTarget.getBoundingClientRect().left + 220, y: ev.currentTarget.getBoundingClientRect().top } })}
              >
                <i className="dot" />
                <span className="ag-time">{e.allDay ? 'ganztags' : `${hhmm(minutesOfDay(e.start))}–${localDayOf(e.end) === d ? hhmm(minutesOfDay(e.end)) : '…'}`}</span>
                <span className="ag-title">{e.title}</span>
                {e.location && <span className="ag-loc">{e.location}</span>}
              </button>
            ))}
            {(tByDay.get(d) ?? []).map((t) => (
              <div key={t.id} className="ag-item task" role="button" tabIndex={0} onClick={() => select(t.id)}>
                <Check done={false} size="small" priority={t.priority} onToggle={() => toggleDone(t.id)} />
                <span className="ag-time">{t.start_at ? hhmm(minutesOfDay(t.start_at)) : 'Aufgabe'}</span>
                <span className="ag-title">{t.title}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <button className="btn ghost ag-more" onClick={() => setLen((n) => n + 30)}>
        Weitere 30 Tage
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seitenleiste: Mini-Monat, Kalender ein/aus + Farbe
// ---------------------------------------------------------------------------
export function CalSidebar({ focus, range, onPick }: { focus: string; range: [string, string]; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(focus)
  useEffect(() => setMonth(focus), [focus])
  const today = todayStr()
  return (
    <aside className="cal-side">
      <div className="cal-side-month">
        <div className="cal-side-head">
          <b>
            {monthName(month)} {yearOf(month)}
          </b>
          <span style={{ flex: 1 }} />
          <button className="icon-btn sm" aria-label="Vorheriger Monat" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={15} />
          </button>
          <button className="icon-btn sm" aria-label="Nächster Monat" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={15} />
          </button>
        </div>
        <MiniMonth month={month} today={today} selected={focus} onPick={onPick} range={range} />
      </div>
    </aside>
  )
}

export function CalendarList() {
  const google = useStore((s) => s.google)
  const prefs = useStore((s) => s.prefs)
  const setCalendarVisible = useStore((s) => s.setCalendarVisible)
  const setCalendarColor = useStore((s) => s.setCalendarColor)
  const setPref = useStore((s) => s.setPref)
  const [paletteFor, setPaletteFor] = useState<string | null>(null)
  const cals = google?.calendars ?? []
  if (!google?.connected) return null
  return (
    <div className="cal-side-list">
      <div className="cal-side-title">Kalender</div>
      {cals.map((c) => {
        const color = prefs.calendar?.colors?.[c.id] ?? c.color
        return (
          <div key={c.id} className={`cal-row ${c.selected ? '' : 'off'}`}>
            <button className="cal-swatch" style={{ background: c.selected ? color : 'transparent', borderColor: color }} aria-label={`Farbe von „${c.name}“`} title="Farbe ändern" onClick={() => setPaletteFor(paletteFor === c.id ? null : c.id)} />
            <button className="cal-name" onClick={() => setCalendarVisible(c.id, !c.selected)} title={c.selected ? 'Ausblenden' : 'Einblenden'}>
              {c.name}
            </button>
            <button className="icon-btn sm" aria-label={c.selected ? `„${c.name}“ ausblenden` : `„${c.name}“ einblenden`} onClick={() => setCalendarVisible(c.id, !c.selected)}>
              {c.selected ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <AnimatePresence>
              {paletteFor === c.id && (
                <motion.div className="cal-palette" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  {[c.color, '#d50000', '#e67c73', '#f4511e', '#f6bf26', '#33b679', '#0b8043', '#039be5', '#3f51b5', '#7986cb', '#8e24aa', '#616161', ...LIST_COLORS.slice(0, 4)].map((hex, i) => (
                    <button
                      key={`${hex}-${i}`}
                      className={`swatch ${color === hex ? 'on' : ''}`}
                      style={{ background: hex }}
                      aria-label={i === 0 ? 'Farbe aus Google' : hex}
                      title={i === 0 ? 'Farbe aus Google' : undefined}
                      onClick={() => {
                        setCalendarColor(c.id, i === 0 ? null : hex)
                        setPaletteFor(null)
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
      <label className="cal-opt">
        <input type="checkbox" checked={prefs.calendar?.weekNumbers !== false} onChange={(e) => setPref('calendar', { ...(prefs.calendar ?? {}), weekNumbers: e.target.checked })} /> Kalenderwochen zeigen
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suche in Terminen
// ---------------------------------------------------------------------------
export function EventSearch({ onClose, onGo }: { onClose: () => void; onGo: (day: string) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<CalendarEvent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const prefs = useStore((s) => s.prefs)
  const tasks = useStore((s) => s.tasks)
  const openEventEditor = useStore((s) => s.openEventEditor)
  const select = useStore((s) => s.select)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setRes(null)
      return
    }
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await api.searchEvents(term)
        setRes(r.events)
      } catch {
        setRes([])
      } finally {
        setBusy(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q])
  const lower = q.trim().toLowerCase()
  const taskHits = lower.length >= 2 ? Object.values(tasks).filter((t) => (t.start_at || t.due_date) && t.title.toLowerCase().includes(lower)).slice(0, 8) : []
  return (
    <motion.div className="cal-search" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
      <div className="cal-search-input">
        <Search size={16} />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Termine suchen …" aria-label="Termine suchen" onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        {busy && <span className="spinner" />}
        <button className="icon-btn sm" aria-label="Suche schließen" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {(res || taskHits.length > 0) && (
        <div className="cal-search-res">
          {res?.length === 0 && !taskHits.length && <p className="muted small" style={{ padding: '8px 12px' }}>Nichts gefunden.</p>}
          {res?.map((e) => {
            const d = e.allDay ? e.start : localDayOf(e.start)
            return (
              <button
                key={`${e.calendarId}-${e.id}`}
                className="cal-hit"
                style={{ ['--ev' as string]: evColor(e, prefs) }}
                onClick={(ev) => {
                  onGo(d)
                  openEventEditor({ mode: 'edit', event: e, anchor: { x: ev.currentTarget.getBoundingClientRect().right, y: ev.currentTarget.getBoundingClientRect().top } })
                  onClose()
                }}
              >
                <i className="dot" />
                <span className="cal-hit-date">{fmtDayLong(d).replace(/^\w+, /, '')}</span>
                <span className="cal-hit-title">{e.title}</span>
                {!e.allDay && <span className="muted small">{hhmm(minutesOfDay(e.start))}</span>}
              </button>
            )
          })}
          {taskHits.map((t) => (
            <button
              key={t.id}
              className="cal-hit task"
              onClick={() => {
                onGo(t.start_at ? localDayOf(t.start_at) : t.due_date!)
                select(t.id)
                onClose()
              }}
            >
              <i className="dot" />
              <span className="cal-hit-date">{fmtDayLong(t.start_at ? localDayOf(t.start_at) : t.due_date!).replace(/^\w+, /, '')}</span>
              <span className="cal-hit-title">{t.title}</span>
              <span className="muted small">Aufgabe</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  )
}
