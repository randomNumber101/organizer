/**
 * Die Aufgaben eines Tages: in eigener Reihenfolge (ziehen), nach Dauer oder nach Priorität gruppiert.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownToLine, ArrowUpToLine, CalendarX2, Flag, GripVertical, MoreHorizontal, Play, Sunrise, Timer } from 'lucide-react'
import { useStore } from '../store'
import type { Task, TodayMode } from '../lib/types'
import { PRIORITY_LABEL } from '../lib/types'
import { BUCKETS, DURATIONS, bucketOf, minutesText } from '../lib/dayplan'
import { addDaysStr, todayStr } from '../lib/dates'
import { ancestors } from '../lib/tree'
import { justDragged } from '../lib/drag'
import { haptic } from '../lib/haptics'
import Check from './Check'
import { SubList, TaskMeta } from './TaskCard'

interface ListProps {
  rows: Task[]
  day: string
  mode: TodayMode
  /** kompakt (z. B. im „Tag planen“) – ohne Menü */
  compact?: boolean
}

/** Liste der offenen Aufgaben eines Tages */
export function DayList({ rows, day, mode, compact }: ListProps) {
  if (mode === 'order') return <SortableDayList rows={rows} day={day} compact={compact} />
  const groups =
    mode === 'duration'
      ? BUCKETS.map((b) => ({ key: b.id, title: b.label, hint: b.hint, rows: rows.filter((t) => bucketOf(t) === b.id) }))
      : ([1, 2, 3, 4] as const).map((p) => ({ key: `p${p}`, title: p === 4 ? 'Ohne Priorität' : PRIORITY_LABEL[p], hint: '', rows: rows.filter((t) => t.priority === p) }))
  return (
    <div className="day-groups">
      {groups
        .filter((g) => g.rows.length)
        .map((g) => {
          const mins = g.rows.reduce((n, t) => n + (t.estimate ?? 0), 0)
          return (
            <section key={g.key} className={`day-group ${g.key}`}>
              <h3 className="day-group-head">
                <span className={`day-group-dot ${g.key}`} />
                {g.title}
                {g.hint && <small>{g.hint}</small>}
                <span className="day-group-count">
                  {g.rows.length}
                  {mins > 0 && ` · ${minutesText(mins)}`}
                </span>
              </h3>
              <div className="day-rows">
                <AnimatePresence initial={false}>
                  {g.rows.map((t) => (
                    <motion.div key={t.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
                      <DayRow task={t} day={day} rows={rows} compact={compact} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )
        })}
    </div>
  )
}

function SortableDayList({ rows, day, compact }: { rows: Task[]; day: string; compact?: boolean }) {
  const setDayOrder = useStore((s) => s.setDayOrder)
  const setDragging = useStore((s) => s.setDragging)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const ids = rows.map((t) => t.id)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (!over || active.id === over.id) return
    const cur = rows.map((t) => t.id)
    const next = arrayMove(cur, cur.indexOf(String(active.id)), cur.indexOf(String(over.id)))
    haptic(8)
    setDayOrder(next, String(active.id))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(false)}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="day-rows ordered">
          <AnimatePresence initial={false}>
            {rows.map((t, i) => (
              <SortableRow key={t.id} task={t} index={i} day={day} rows={rows} compact={compact} />
            ))}
          </AnimatePresence>
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ task, index, day, rows, compact }: { task: Task; index: number; day: string; rows: Task[]; compact?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined, position: 'relative' }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'is-dragging' : ''}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
      <DayRow
        task={task}
        day={day}
        rows={rows}
        index={index}
        compact={compact}
        grip={
          <button ref={setActivatorNodeRef} className="day-grip" aria-label={`„${task.title}“ verschieben`} {...attributes} {...listeners}>
            <GripVertical size={16} />
          </button>
        }
      />
      </motion.div>
    </li>
  )
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
  const crumb = ancestors(tasks, task).filter((a) => a.due_date !== day)
  const hasKids = Object.values(tasks).some((k) => k.parent_id === task.id)
  const done = task.status === 'done'
  return (
    <div className={`day-row p${task.priority} ${done ? 'done' : ''} ${muted ? 'muted' : ''} ${focus?.id === task.id ? 'focused' : ''}`} data-task={task.id}>
      {grip}
      {index !== undefined && <span className="day-idx">{index + 1}</span>}
      <Check done={done} priority={task.priority} onToggle={() => toggleDone(task.id)} />
      <div className="day-main" role="button" tabIndex={0} onClick={() => !justDragged() && select(task.id)} onKeyDown={(e) => e.key === 'Enter' && select(task.id)}>
        {crumb.length > 0 && <span className="card-crumb">{crumb.map((c) => c.title).join(' › ')} ›</span>}
        <span className="day-row-title">
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

/** Weitere Aktionen: als Nächstes, ans Ende, Fokus, morgen, ohne Datum */
function RowMenu({ task, day, rows }: { task: Task; day: string; rows: Task[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { setDayOrder, moveToDay, startFocus, updateTask, setView } = useStore.getState()
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
            <button className="menu-item" onClick={act(() => moveToDay(task.id, addDaysStr(day, 1)))}>
              <Sunrise size={15} /> Auf morgen
            </button>
            <button className="menu-item" onClick={act(() => updateTask(task.id, { priority: task.priority === 1 ? 4 : 1 }))}>
              <Flag size={15} /> {task.priority === 1 ? 'Nicht mehr wichtig' : 'Wichtig'}
            </button>
            <button className="menu-item" onClick={act(() => moveToDay(task.id, null))}>
              <CalendarX2 size={15} /> Ohne Datum
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
