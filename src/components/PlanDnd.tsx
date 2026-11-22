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
import { useStore } from '../store'
import { hhmm, minutesBetween } from '../lib/dates'
import { haptic } from '../lib/haptics'
import { eventY, markDragEnd } from '../lib/drag'
import { TaskCard } from './TaskCard'

/**
 * Gemeinsames Ziehen für Planer und Kalender:
 * Karten aus Listen ins Zeitraster ziehen, Blöcke im Raster verschieben, zurück in „Zu planen“ legen.
 */
export type PlanPreview = { kind: 'slot'; day: string; start: number; dur: number } | { kind: 'allday'; day: string } | { kind: 'unplan' } | null

interface Ctx {
  preview: PlanPreview
  activeId: string | null
  hourPx: number
}

const PlanContext = createContext<Ctx>({ preview: null, activeId: null, hourPx: 52 })
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
  const setDragging = useStore((s) => s.setDragging)
  const [preview, setPreview] = useState<PlanPreview>(null)
  const [active, setActive] = useState<{ id: string; type: 'task' | 'block'; width: number } | null>(null)
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

  const durationOf = (taskId: string) => {
    const t = tasks[taskId]
    return t?.start_at && t.end_at ? Math.max(SNAP, minutesBetween(t.start_at, t.end_at)) : Math.max(SNAP, t?.estimate ?? 60)
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { type: 'task' | 'block'; taskId: string } | undefined
    if (!data) return
    haptic(12)
    setDragging(true)
    startY.current = eventY(e.activatorEvent) ?? 0
    pointerY.current = startY.current
    const rect = e.active.rect.current.initial
    const el = data.type === 'block' ? document.querySelector<HTMLElement>(`[data-block="${data.taskId}"]`) : null
    grabOffset.current = el ? startY.current - el.getBoundingClientRect().top : rect ? startY.current - rect.top : 0
    setActive({ id: data.taskId, type: data.type, width: rect?.width ?? 200 })
  }

  const onDragMove = (e: DragMoveEvent) => {
    const data = e.active.data.current as { type: 'task' | 'block'; taskId: string } | undefined
    if (!data) return
    const y = pointerY.current
    const over = e.over ? String(e.over.id) : ''
    if (over.startsWith('day:')) {
      const day = over.slice(4)
      const col = document.querySelector<HTMLElement>(`[data-tl-day="${day}"]`)
      if (!col) return
      const r = col.getBoundingClientRect()
      const pxPerMin = hourPx / 60
      const top = data.type === 'block' ? y - grabOffset.current : y - 10
      const dur = durationOf(data.taskId)
      const start = Math.max(0, Math.min(24 * 60 - dur, snap((top - r.top) / pxPerMin)))
      setPv({ kind: 'slot', day, start, dur })
    } else if (over.startsWith('allday:')) setPv({ kind: 'allday', day: over.slice(7) })
    else if (over.startsWith('unplan')) setPv({ kind: 'unplan' })
    else setPv(null)
  }

  const finish = () => {
    setActive(null)
    setPv(null)
    setDragging(false)
    markDragEnd()
  }

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { type: 'task' | 'block'; taskId: string } | undefined
    const p = previewRef.current
    const over = e.over ? String(e.over.id) : ''
    if (data) {
      const t = tasks[data.taskId]
      if (t && p?.kind === 'slot') {
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

  const activeTask = active ? tasks[active.id] : null

  return (
    <PlanContext.Provider value={{ preview, activeId: active?.id ?? null, hourPx }}>
      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={finish}>
        {children}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeTask && active?.type === 'task' && (
              <div style={{ width: Math.min(active.width, 300), transform: 'rotate(1.5deg)' }}>
                <TaskCard task={activeTask} overlay showList={false} />
              </div>
            )}
            {activeTask && active?.type === 'block' && (
              <div className="tl-overlay" style={{ width: active.width }}>
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
