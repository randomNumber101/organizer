/**
 * Die Aufgaben eines Tages: in eigener Reihenfolge, nach Dauer oder nach Wichtigkeit gruppiert.
 * Überall ziehbar (ganze Zeile; Handy: kurz halten oder am Griff), zwischen Gruppen übernimmt die Aufgabe
 * die Gruppe (Dauer bzw. Wichtigkeit). Mit Strg (⌘/Alt) gezogen wird ein Teil abgespalten.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownToLine, ArrowUpToLine, CalendarX2, CheckCheck, Flag, GripVertical, Lock, MoreHorizontal, Play, Scissors, Sunrise, Timer } from 'lucide-react'
import { useStore } from '../store'
import type { Task, TaskPatch, TodayMode } from '../lib/types'
import { PRIORITIES, PRIORITY_LABEL } from '../lib/types'
import { BUCKETS, DURATIONS, bucketOf, minutesText, type Bucket } from '../lib/dayplan'
import { addDaysStr, todayStr } from '../lib/dates'
import { ancestors } from '../lib/tree'
import { openBlockers } from '../lib/blocking'
import { isPart } from '../lib/parts'
import { justDragged, markDragEnd } from '../lib/drag'
import { haptic } from '../lib/haptics'
import Check from './Check'
import PrioPicker from './PrioPicker'
import { SubList, TaskMeta } from './TaskCard'

interface ListProps {
  rows: Task[]
  day: string
  mode: TodayMode
  /** kompakt (z. B. im „Tag planen“) – ohne Menü */
  compact?: boolean
}

interface Group {
  key: string
  title: string
  hint: string
  ids: string[]
}

// ---------------------------------------------------------------------------
// Sensoren: Maus überall außer auf Bedienelementen, Finger: kurz halten (Griff: sofort), Tastatur am Griff
// ---------------------------------------------------------------------------
const INTERACTIVE = 'button:not(.day-grip), select, input, textarea, a, label, [data-no-dnd]'
const isInteractive = (t: EventTarget | null) => t instanceof Element && !!t.closest(INTERACTIVE)
const onGrip = (t: EventTarget | null) => t instanceof Element && !!t.closest('.day-grip')

export class RowMouseSensor extends MouseSensor {
  static activators = [{ eventName: 'onMouseDown' as const, handler: ({ nativeEvent: e }: { nativeEvent: MouseEvent }) => e.button === 0 && !isInteractive(e.target) }]
}
export class RowTouchSensor extends TouchSensor {
  static activators = [{ eventName: 'onTouchStart' as const, handler: ({ nativeEvent: e }: { nativeEvent: TouchEvent }) => e.touches.length === 1 && !isInteractive(e.target) && !onGrip(e.target) }]
}
export class GripPointerSensor extends PointerSensor {
  static activators = [{ eventName: 'onPointerDown' as const, handler: ({ nativeEvent: e }: { nativeEvent: PointerEvent }) => e.pointerType !== 'mouse' && e.isPrimary && onGrip(e.target) }]
}
type KbHandler = (typeof KeyboardSensor.activators)[0]['handler']
export class GripKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (event: Parameters<KbHandler>[0], opts: Parameters<KbHandler>[1], ctx: Parameters<KbHandler>[2]) => (onGrip(event.target) ? KeyboardSensor.activators[0].handler(event, opts, ctx) : false),
    },
  ]
}

/** Strg/⌘/Alt gedrückt? (während des Ziehens) */
export function useSplitKey(active: boolean) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    if (!active) {
      setDown(false)
      return
    }
    const upd = (e: KeyboardEvent) => setDown(e.ctrlKey || e.metaKey || e.altKey)
    window.addEventListener('keydown', upd)
    window.addEventListener('keyup', upd)
    return () => {
      window.removeEventListener('keydown', upd)
      window.removeEventListener('keyup', upd)
    }
  }, [active])
  return [down, setDown] as const
}

/** Liste der offenen Aufgaben eines Tages */
export function DayList({ rows, day, mode, compact }: ListProps) {
  const groups: Group[] = useMemo(() => {
    if (mode === 'order') return [{ key: 'all', title: '', hint: '', ids: rows.map((t) => t.id) }]
    if (mode === 'duration') return BUCKETS.map((b) => ({ key: b.id, title: b.label, hint: b.hint, ids: rows.filter((t) => bucketOf(t) === b.id).map((t) => t.id) }))
    return PRIORITIES.map((p) => ({ key: `p${p}`, title: p === 0 ? 'Ohne Wichtigkeit' : PRIORITY_LABEL[p], hint: p === 0 ? '' : `Stufe ${p}`, ids: rows.filter((t) => t.priority === p).map((t) => t.id) }))
  }, [rows, mode])
  return <DayDnd rows={rows} groups={groups} day={day} mode={mode} compact={compact} />
}

/** Gruppe übernehmen: Dauer bzw. Wichtigkeit setzen */
function assignGroup(mode: TodayMode, key: string, t: Task): TaskPatch | null {
  if (mode === 'duration') {
    const b = key as Bucket
    if (bucketOf(t) === b) return null
    if (b === 'mini') return { estimate: 5 }
    if (b === 'quick') return { estimate: 15 }
    if (b === 'long') return { estimate: t.estimate && t.estimate >= 30 ? t.estimate : 30 }
    return { estimate: null }
  }
  if (mode === 'prio') {
    const p = Number(key.slice(1)) as Task['priority']
    return p === t.priority ? null : { priority: p }
  }
  return null
}

function DayDnd({ rows, groups, day, mode, compact }: { rows: Task[]; groups: Group[]; day: string; mode: TodayMode; compact?: boolean }) {
  const tasks = useStore((s) => s.tasks)
  const setDayOrder = useStore((s) => s.setDayOrder)
  const setDragging = useStore((s) => s.setDragging)
  const updateTask = useStore((s) => s.updateTask)
  const splitOff = useStore((s) => s.splitOff)
  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: 230, tolerance: 8 } }),
    useSensor(GripPointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(GripKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, string[]> | null>(null)
  const [splitKey, setSplitKey] = useSplitKey(!!activeId)
  const startGroup = useRef<string | null>(null)
  const lastOver = useRef<UniqueIdentifier | null>(null)
  // nach einem Gruppenwechsel erst neu messen lassen, sonst springt die Zeile zwischen zwei Gruppen hin und her
  const recentlyMoved = useRef(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      recentlyMoved.current = false
    })
    return () => cancelAnimationFrame(r)
  }, [items])
  const byId = useMemo(() => Object.fromEntries(rows.map((t) => [t.id, t])), [rows])
  const base = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g.ids])), [groups])
  const order = items ?? base
  const grouped = mode !== 'order'

  const findGroup = (id: UniqueIdentifier): string | null => {
    const s = String(id)
    if (s.startsWith('grp:')) return s.slice(4)
    for (const [k, ids] of Object.entries(order)) if (ids.includes(s)) return k
    return null
  }

  const collision: CollisionDetection = (args) => {
    if (!grouped) return closestCenter(args)
    if (recentlyMoved.current && lastOver.current != null) return [{ id: lastOver.current }]
    const hits = pointerWithin(args)
    let overId: UniqueIdentifier | null = hits.find((h) => !String(h.id).startsWith('grp:'))?.id ?? hits[0]?.id ?? null
    if (overId != null && String(overId).startsWith('grp:')) {
      const inner = order[String(overId).slice(4)] ?? []
      if (inner.length) {
        const c = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => inner.includes(String(d.id))) })
        if (c[0]) overId = c[0].id
      }
    }
    if (overId == null) {
      const c = closestCenter(args)
      overId = c[0]?.id ?? lastOver.current
    }
    lastOver.current = overId
    return overId != null ? [{ id: overId }] : []
  }

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const id = String(active.id)
    haptic(12)
    setDragging(true)
    setActiveId(id)
    setItems(base)
    startGroup.current = findGroup(id)
    const ev = activatorEvent as MouseEvent | KeyboardEvent | null
    setSplitKey(!!ev && (ev.ctrlKey || ev.metaKey || ev.altKey))
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !grouped || splitKey) return
    const id = String(active.id)
    const from = findGroup(id)
    const to = findGroup(over.id)
    if (!from || !to || from === to) return
    recentlyMoved.current = true
    setItems((prev) => {
      const p = prev ?? base
      const toIds = p[to] ?? []
      const overId = String(over.id)
      let index = toIds.length
      if (!overId.startsWith('grp:')) {
        const oi = toIds.indexOf(overId)
        const below = active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2
        index = oi >= 0 ? oi + (below ? 1 : 0) : toIds.length
      }
      return { ...p, [from]: p[from].filter((x) => x !== id), [to]: [...toIds.slice(0, index), id, ...toIds.slice(index)] }
    })
  }

  const finish = () => {
    setActiveId(null)
    setItems(null)
    setDragging(false)
    markDragEnd()
    lastOver.current = null
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const task = tasks[id]
    if (!over || !task) return finish()
    const all = rows.map((t) => t.id)

    // Strg: Teil abspalten und an die Stelle legen
    if (splitKey) {
      const overId = String(over.id)
      const target = overId.startsWith('grp:') ? all.length : Math.max(0, all.indexOf(overId))
      const after = all.indexOf(id) < target
      const newId = splitOff(id, { due_date: day, day_order: null })
      if (newId) {
        // die Aufgabe selbst wird beim ersten Aufteilen zum Rahmen – ihr erster Teil nimmt ihren Platz ein
        const now = useStore.getState().tasks
        const firstPart = Object.values(now).find((t) => t.parent_id === id && t.part_index === 1)
        const ids = all.map((x) => (x === id && firstPart ? firstPart.id : x)).filter((x) => x !== newId)
        const at = Math.min(ids.length, target + (after ? 1 : 0))
        setDayOrder([...ids.slice(0, at), newId, ...ids.slice(at)], newId)
        haptic([10, 40, 10])
      }
      return finish()
    }

    const to = findGroup(over.id)
    if (!to) return finish()
    let toIds = [...(order[to] ?? [])]
    const oldIndex = toIds.indexOf(id)
    const overIndex = toIds.indexOf(String(over.id))
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) toIds = arrayMove(toIds, oldIndex, overIndex)
    const idx = toIds.indexOf(id)
    const moved = startGroup.current !== to || base[to]?.indexOf(id) !== idx
    if (moved) {
      // neue Gesamt-Reihenfolge: neben den Nachbarn in der Gruppe einsortieren
      const rest = all.filter((x) => x !== id)
      const next = toIds[idx + 1]
      const prev = toIds[idx - 1]
      let at = next ? rest.indexOf(next) : prev ? rest.indexOf(prev) + 1 : all.indexOf(id)
      if (at < 0) at = rest.length
      const ids = [...rest.slice(0, at), id, ...rest.slice(at)]
      if (ids.join() !== all.join()) setDayOrder(ids, id)
      const patch = startGroup.current !== to ? assignGroup(mode, to, task) : null
      if (patch) updateTask(id, patch)
      haptic(8)
    }
    finish()
  }

  const active = activeId ? (tasks[activeId] ?? null) : null
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      {grouped ? (
        <div className={`day-groups ${activeId ? 'dragging' : ''}`}>
          {groups.map((g) => {
            const ids = (order[g.key] ?? []).filter((i) => byId[i] ?? tasks[i])
            if (!ids.length && !activeId) return null
            const mins = ids.reduce((n, i) => n + ((byId[i] ?? tasks[i])?.estimate ?? 0), 0)
            return (
              <section key={g.key} className={`day-group ${g.key} ${ids.length ? '' : 'empty'}`}>
                <h3 className="day-group-head">
                  <span className={`day-group-dot ${g.key}`} />
                  {g.title}
                  {g.hint && <small>{g.hint}</small>}
                  <span className="day-group-count">
                    {ids.length}
                    {mins > 0 && ` · ${minutesText(mins)}`}
                  </span>
                </h3>
                <GroupDrop id={g.key}>
                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    {ids.map((i) => (
                      <SortableRow key={i} task={byId[i] ?? tasks[i]} day={day} rows={rows} compact={compact} keepVisible={splitKey && i === activeId} />
                    ))}
                  </SortableContext>
                  {!ids.length && <div className="day-drop-hint">hierher ziehen</div>}
                </GroupDrop>
              </section>
            )
          })}
        </div>
      ) : (
        <SortableContext items={order.all ?? []} strategy={verticalListSortingStrategy}>
          <ol className="day-rows ordered">
            {(order.all ?? []).map((i, k) => byId[i] && <SortableRow key={i} task={byId[i]} index={k} day={day} rows={rows} compact={compact} keepVisible={splitKey && i === activeId} />)}
          </ol>
        </SortableContext>
      )}
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {active ? (
            <div className={`day-overlay ${splitKey ? 'splitting' : ''}`}>
              <DayRow task={active} day={day} rows={rows} compact />
              {splitKey && (
                <span className="split-flag">
                  <Scissors size={12} /> Teil abspalten{active.estimate && active.estimate >= 10 ? ` · ${minutesText(Math.max(5, Math.round(active.estimate / 2 / 5) * 5))}` : ''}
                </span>
              )}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

function GroupDrop({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `grp:${id}` })
  return (
    <div ref={setNodeRef} className={`day-rows ${isOver ? 'over' : ''}`}>
      {children}
    </div>
  )
}

function SortableRow({ task, index, day, rows, compact, keepVisible }: { task: Task; index?: number; day: string; rows: Task[]; compact?: boolean; keepVisible?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: CSSProperties = { transform: keepVisible ? undefined : CSS.Translate.toString(transform), transition, position: 'relative' }
  const { role: _r, tabIndex: _t, ...attrs } = attributes
  const props = { ref: setNodeRef, style, className: `day-item ${isDragging && !keepVisible ? 'is-dragging' : ''}`, ...attrs, ...listeners }
  const row = (
    <DayRow
      task={task}
      day={day}
      rows={rows}
      index={index}
      compact={compact}
      grip={
        <button ref={setActivatorNodeRef} className="day-grip" aria-label={`„${task.title}“ verschieben`} aria-roledescription="ziehbar">
          <GripVertical size={16} />
        </button>
      }
    />
  )
  return index !== undefined ? <li {...props}>{row}</li> : <div {...props}>{row}</div>
}

interface RowProps {
  task: Task
  day: string
  rows: Task[]
  index?: number
  grip?: ReactNode
  compact?: boolean
  muted?: boolean
}

/** Eine Aufgabe in „Heute“ */
export function DayRow({ task, day, rows, index, grip, compact, muted }: RowProps) {
  const tasks = useStore((s) => s.tasks)
  const toggleDone = useStore((s) => s.toggleDone)
  const select = useStore((s) => s.select)
  const focus = useStore((s) => s.focus)
  const expanded = useStore((s) => s.expanded[task.id] ?? s.showSubtasks)
  const part = isPart(task)
  const crumb = ancestors(tasks, task).filter((a) => a.due_date !== day && !(part && a.id === task.parent_id && a.title === task.title))
  const hasKids = Object.values(tasks).some((k) => k.parent_id === task.id)
  const done = task.status === 'done'
  const waiting = !done && openBlockers(tasks, task).length > 0
  return (
    <div className={`day-row p${task.priority} ${part ? 'part' : ''} ${done ? 'done' : ''} ${muted ? 'muted' : ''} ${waiting ? 'waiting' : ''} ${focus?.id === task.id ? 'focused' : ''}`} data-task={task.id}>
      {grip}
      {index !== undefined && <span className="day-idx">{index + 1}</span>}
      <Check done={done} priority={task.priority} onToggle={() => toggleDone(task.id)} />
      <div className="day-main" role="button" tabIndex={0} onClick={() => !justDragged() && select(task.id)} onKeyDown={(e) => e.key === 'Enter' && select(task.id)}>
        {crumb.length > 0 && <span className="card-crumb">{crumb.map((c) => c.title).join(' › ')} ›</span>}
        <span className="day-row-title">
          {waiting && <Lock size={13} className="wait-lock" aria-label="wartet" />}
          {task.title}
          {focus?.id === task.id && (
            <span className="day-focus-badge">
              <Timer size={11} /> Fokus
            </span>
          )}
        </span>
        <TaskMeta task={task} showDate={task.due_date !== day} showEstimate={false} />
        <AnimatePresence initial={false}>{expanded && hasKids && !done && <SubList task={task} />}</AnimatePresence>
      </div>
      {!done && <DurationSelect task={task} />}
      {!done && !compact && <RowMenu task={task} day={day} rows={rows} />}
    </div>
  )
}

/** Dauer als kleiner Chip; antippen öffnet die Auswahl */
export function DurationSelect({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask)
  const b = bucketOf(task)
  const custom = task.estimate && !DURATIONS.some(([m]) => m === task.estimate)
  return (
    <label className={`dur-chip ${b}`} title="Geschätzte Dauer" onClick={(e) => e.stopPropagation()}>
      <Timer size={12} />
      <span>{task.estimate ? minutesText(task.estimate) : 'Dauer'}</span>
      <select
        value={task.estimate ?? ''}
        aria-label={`Dauer von „${task.title}“`}
        onChange={(e) => {
          haptic(6)
          updateTask(task.id, { estimate: e.target.value ? Number(e.target.value) : null })
        }}
      >
        <option value="">– keine –</option>
        {custom && <option value={task.estimate!}>{minutesText(task.estimate!)}</option>}
        {DURATIONS.map(([m, label]) => (
          <option key={m} value={m}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Weitere Aktionen: Fokus, als Nächstes, ans Ende, Teil erledigt, aufteilen, morgen, Wichtigkeit, ohne Datum */
function RowMenu({ task, day, rows }: { task: Task; day: string; rows: Task[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { setDayOrder, moveToDay, startFocus, updateTask, setView, openSplit } = useStore.getState()
  const isToday = day === todayStr()

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const move = (toTop: boolean) => {
    const ids = rows.map((t) => t.id).filter((id) => id !== task.id)
    setDayOrder(toTop ? [task.id, ...ids] : [...ids, task.id], task.id)
  }
  const act = (fn: () => void) => () => {
    setOpen(false)
    haptic(6)
    fn()
  }

  return (
    <div ref={ref} className="day-menu" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn sm" aria-label="Weitere Aktionen" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="menu" initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }}>
            {isToday && (
              <button className="menu-item" onClick={act(() => (move(true), startFocus(task.id, task.estimate ?? 25), setView('today')))}>
                <Play size={15} /> Jetzt machen (Fokus)
              </button>
            )}
            <button className="menu-item" onClick={act(() => move(true))}>
              <ArrowUpToLine size={15} /> Als Nächstes
            </button>
            <button className="menu-item" onClick={act(() => move(false))}>
              <ArrowDownToLine size={15} /> Ans Ende
            </button>
            {!task.rrule && (
              <>
                <button className="menu-item" onClick={act(() => openSplit(task.id, 'log'))}>
                  <CheckCheck size={15} /> Teil erledigt …
                </button>
                <button className="menu-item" onClick={act(() => openSplit(task.id, 'split'))}>
                  <Scissors size={15} /> Aufteilen …
                </button>
              </>
            )}
            <button className="menu-item" onClick={act(() => moveToDay(task.id, addDaysStr(day, 1)))}>
              <Sunrise size={15} /> Auf morgen
            </button>
            <div className="menu-prio">
              <Flag size={15} />
              <PrioPicker compact value={task.priority} onChange={(p) => (haptic(6), updateTask(task.id, { priority: p }))} />
            </div>
            <button className="menu-item" onClick={act(() => moveToDay(task.id, null))}>
              <CalendarX2 size={15} /> Ohne Datum
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
