import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Scissors } from 'lucide-react'
import { useStore } from '../store'
import type { CalendarEvent } from '../lib/types'
import { addDaysStr, deviceTimeZone, hhmm, isoFromDayMinutes, localDayOf, minutesBetween } from '../lib/dates'
import { useSplitKey } from './DayList'
import { differenceInCalendarDays, parseISO } from 'date-fns'

const daysBetweenStr = (a: string, b: string) => differenceInCalendarDays(parseISO(b), parseISO(a))
import { haptic } from '../lib/haptics'
import { eventY, markDragEnd } from '../lib/drag'
import { TaskCard } from './TaskCard'

/**
 * Gemeinsames Ziehen für Planer und Kalender:
 * Karten aus Listen ins Zeitraster ziehen, Blöcke im Raster verschieben, zurück in „Zu planen“ legen.
 */
export type PlanPreview = { kind: 'slot'; day: string; start: number; dur: number } | { kind: 'allday'; day: string } | { kind: 'mday'; day: string } | { kind: 'unplan' } | null

type DragData = { type: 'task' | 'block'; taskId: string } | { type: 'event'; event: CalendarEvent; taskId?: undefined }

interface Ctx {
  preview: PlanPreview
  activeId: string | null
  hourPx: number
  /** Strg gedrückt: Teil abspalten statt verschieben */
  splitting: boolean
}

const PlanContext = createContext<Ctx>({ preview: null, activeId: null, hourPx: 52, splitting: false })
export const usePlan = () => useContext(PlanContext)

const SNAP = 15
const snap = (m: number) => Math.round(m / SNAP) * SNAP

const collision: CollisionDetection = (args) => {
  const p = pointerWithin(args)
  return p.length ? p : rectIntersection(args)
}

export function PlanDnd({ children, hourPx }: { children: ReactNode; hourPx: number }) {
  const tasks = useStore((s) => s.tasks)
  const schedule = useStore((s) => s.schedule)
  const updateTask = useStore((s) => s.updateTask)
  const moveToDay = useStore((s) => s.moveToDay)
  const updateEvent = useStore((s) => s.updateEvent)
  const splitOff = useStore((s) => s.splitOff)
  const setDragging = useStore((s) => s.setDragging)
  const [preview, setPreview] = useState<PlanPreview>(null)
  const [active, setActive] = useState<{ id: string; type: 'task' | 'block' | 'event'; width: number; event?: CalendarEvent } | null>(null)
  const [splitting, setSplitting] = useSplitKey(!!active && active.type !== 'event')
  const splitRef = useRef(false)
  splitRef.current = splitting
  const startY = useRef(0)
  const grabOffset = useRef(0)
  const pointerY = useRef(0)
  const scrollRaf = useRef(0)
  const previewRef = useRef<PlanPreview>(null)

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }))

  const setPv = (p: PlanPreview) => {
    previewRef.current = p
    setPreview((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p))
  }

  // Zeigerposition selbst verfolgen (das Delta von dnd-kit enthält Scroll-Versätze)
  useEffect(() => {
    if (!active) return
    const onPointer = (e: PointerEvent) => {
      pointerY.current = e.clientY
    }
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) pointerY.current = e.touches[0].clientY
    }
    window.addEventListener('pointermove', onPointer, { passive: true, capture: true })
    window.addEventListener('touchmove', onTouch, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointermove', onPointer, { capture: true })
      window.removeEventListener('touchmove', onTouch, { capture: true })
    }
  }, [active])

  // Raster automatisch scrollen, wenn man mit einer Karte an den Rand kommt
  useEffect(() => {
    if (!active) return
    const tick = () => {
      const el = document.querySelector<HTMLElement>('.tl-scroll')
      if (el) {
        const r = el.getBoundingClientRect()
        const y = pointerY.current
        const edge = 56
        if (y < r.top + edge && y > r.top - 40) el.scrollTop -= Math.ceil((r.top + edge - y) / 6)
        else if (y > r.bottom - edge && y < r.bottom + 60) el.scrollTop += Math.ceil((y - (r.bottom - edge)) / 6)
      }
      scrollRaf.current = requestAnimationFrame(tick)
    }
    scrollRaf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(scrollRaf.current)
  }, [active])

  const durationOf = (data: DragData) => {
    if (data.type === 'event') return data.event.allDay ? 60 : Math.max(SNAP, minutesBetween(data.event.start, data.event.end))
    const t = tasks[data.taskId]
    const full = t?.start_at && t.end_at ? Math.max(SNAP, minutesBetween(t.start_at, t.end_at)) : Math.max(SNAP, t?.estimate ?? 60)
    return splitRef.current ? Math.max(SNAP, snap(full / 2)) : full
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined
    if (!data) return
    haptic(12)
    setDragging(true)
    startY.current = eventY(e.activatorEvent) ?? 0
    pointerY.current = startY.current
    const rect = e.active.rect.current.initial
    const blockKey = data.type === 'event' ? `ev:${data.event.calendarId}:${data.event.id}` : data.taskId
    const el = data.type !== 'task' ? document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockKey)}"]`) : null
    grabOffset.current = el ? startY.current - el.getBoundingClientRect().top : rect ? startY.current - rect.top : 0
    const ev = e.activatorEvent as MouseEvent | null
    setSplitting(data.type !== 'event' && !!ev && (ev.ctrlKey || ev.metaKey || ev.altKey))
    setActive({ id: data.type === 'event' ? blockKey : data.taskId, type: data.type, width: rect?.width ?? 200, event: data.type === 'event' ? data.event : undefined })
  }

  const onDragMove = (e: DragMoveEvent) => {
    const data = e.active.data.current as DragData | undefined
    if (!data) return
    const y = pointerY.current
    const over = e.over ? String(e.over.id) : ''
    if (over.startsWith('day:')) {
      const day = over.slice(4)
      const col = document.querySelector<HTMLElement>(`[data-tl-day="${day}"]`)
      if (!col) return
      const r = col.getBoundingClientRect()
      const pxPerMin = hourPx / 60
      const top = data.type !== 'task' ? y - grabOffset.current : y - 10
      const dur = durationOf(data)
      const start = Math.max(0, Math.min(24 * 60 - dur, snap((top - r.top) / pxPerMin)))
      setPv({ kind: 'slot', day, start, dur })
    } else if (over.startsWith('allday:')) setPv({ kind: 'allday', day: over.slice(7) })
    else if (over.startsWith('mday:')) setPv({ kind: 'mday', day: over.slice(5) })
    else if (over.startsWith('unplan') && data.type !== 'event') setPv({ kind: 'unplan' })
    else setPv(null)
  }

  const finish = () => {
    setActive(null)
    setPv(null)
    setDragging(false)
    markDragEnd()
  }

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as DragData | undefined
    const p = previewRef.current
    const over = e.over ? String(e.over.id) : ''
    if (data?.type === 'event') {
      moveEvent(data.event, p)
      return finish()
    }
    if (data && splitRef.current && tasks[data.taskId]) {
      // Strg: einen Teil abspalten und dort ablegen
      const id = data.taskId
      if (p?.kind === 'slot') splitOff(id, { due_date: p.day, start_at: isoFromDayMinutes(p.day, p.start), end_at: isoFromDayMinutes(p.day, p.start + p.dur), timezone: deviceTimeZone() })
      else if (p?.kind === 'allday' || p?.kind === 'mday') splitOff(id, { due_date: p.day })
      return finish()
    }
    if (data) {
      const t = tasks[data.taskId]
      if (t && p?.kind === 'mday') {
        moveToDay(t.id, p.day)
        haptic(8)
      } else if (t && p?.kind === 'slot') {
        void schedule(t.id, p.day, p.start, p.dur)
        haptic(8)
      } else if (t && p?.kind === 'allday') {
        void updateTask(t.id, { due_date: p.day, start_at: null, end_at: null, timezone: null })
      } else if (t && over.startsWith('unplan')) {
        const d = over.split(':')[1]
        const day = d === 'none' ? null : d || t.due_date
        void updateTask(t.id, { start_at: null, end_at: null, timezone: null, due_date: day })
      }
    }
    finish()
  }

  /** Termin verschieben: ins Raster (Uhrzeit), in die Ganztags-Zeile oder auf einen Tag im Monat */
  const moveEvent = (ev: CalendarEvent, p: PlanPreview) => {
    if (!p || p.kind === 'unplan') return
    if (p.kind === 'slot') {
      const start = isoFromDayMinutes(p.day, p.start)
      const end = isoFromDayMinutes(p.day, p.start + p.dur)
      if (!ev.allDay && start === new Date(ev.start).toISOString() && end === new Date(ev.end).toISOString()) return
      void updateEvent(ev, { start, end, allDay: false })
    } else {
      const from = ev.allDay ? ev.start : localDayOf(ev.start)
      const delta = daysBetweenStr(from, p.day)
      if (p.kind === 'allday' && !ev.allDay) {
        void updateEvent(ev, { start: p.day, end: addDaysStr(p.day, 1), allDay: true })
      } else {
        if (!delta) return
        const shift = (v: string) => (ev.allDay ? addDaysStr(v, delta) : new Date(Date.parse(v) + delta * 86_400_000).toISOString())
        void updateEvent(ev, { start: shift(ev.start), end: shift(ev.end), allDay: ev.allDay })
      }
    }
    haptic(8)
  }

  const activeTask = active && active.type !== 'event' ? tasks[active.id] : null

  return (
    <PlanContext.Provider value={{ preview, activeId: active?.id ?? null, hourPx, splitting }}>
      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={finish}>
        {children}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeTask && active?.type === 'task' && (
              <div className="card-overlay-wrap" style={{ width: Math.min(active.width, 300), transform: 'rotate(1.5deg)' }}>
                <TaskCard task={activeTask} overlay showList={false} />
                {splitting && (
                  <span className="split-flag">
                    <Scissors size={12} /> Teil abspalten
                  </span>
                )}
              </div>
            )}
            {active?.type === 'event' && active.event && (
              <div className="tl-overlay event" style={{ width: Math.min(active.width, 260), ['--ev' as string]: active.event.color }}>
                {active.event.title}
                {preview?.kind === 'slot' && (
                  <div className="t-time" style={{ fontWeight: 500, fontSize: 11, opacity: 0.75 }}>
                    {hhmm(preview.start)}–{hhmm(preview.start + preview.dur)}
                  </div>
                )}
              </div>
            )}
            {activeTask && active?.type === 'block' && (
              <div className={`tl-overlay ${splitting ? 'splitting' : ''}`} style={{ width: active.width }}>
                {splitting && (
                  <span className="split-flag">
                    <Scissors size={12} /> Teil abspalten
                  </span>
                )}
                {activeTask.title}
                {preview?.kind === 'slot' && (
                  <div className="t-time" style={{ fontWeight: 500, fontSize: 11, opacity: 0.75 }}>
                    {hhmm(preview.start)}–{hhmm(preview.start + preview.dur)}
                  </div>
                )}
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </PlanContext.Provider>
  )
}
