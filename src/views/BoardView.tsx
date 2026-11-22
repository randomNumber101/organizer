import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, Columns3, Inbox, LayoutList, LayoutTemplate, ListChecks, MoreHorizontal, Pencil, Plus, Shuffle, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import type { BoardMode, List, Task, TaskPatch } from '../lib/types'
import { LIST_COLORS } from '../lib/types'
import { addDaysStr, deviceTimeZone, todayStr, weekdayShort, shortDate } from '../lib/dates'
import { sortBetween, topSort } from '../lib/order'
import { composeTask, matchesSearch } from '../lib/compose'
import { haptic } from '../lib/haptics'
import { markDragEnd } from '../lib/drag'
import { moveBlockToDate } from '../../shared/tz'
import { TaskCard } from '../components/TaskCard'
import Segmented from '../components/Segmented'
import { FilterBar } from '../components/FilterBar'
import SmartField, { TokenChips } from '../components/SmartField'
import { matchesFilter } from '../lib/filter'

// ---------------------------------------------------------------------------
// Spalten
// ---------------------------------------------------------------------------
interface ColumnDef {
  id: string
  kind: 'inbox' | 'list' | 'nodate' | 'day'
  title: string
  sub?: string
  color?: string
  isToday?: boolean
  list?: List
  tasks: Task[]
  done: Task[]
  assign: (t: Task) => TaskPatch
  defaults: TaskPatch
  showDate: boolean
  showList: boolean
}

const bySort = (a: Task, b: Task) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)
const byTimeThenSort = (a: Task, b: Task) => {
  if (a.start_at && b.start_at) return a.start_at.localeCompare(b.start_at)
  if (a.start_at) return -1
  if (b.start_at) return 1
  return bySort(a, b)
}
const recentDone = (t: Task) => t.status === 'done' && !!t.completed_at && Date.now() - Date.parse(t.completed_at) < 14 * 86_400_000
const byCompleted = (a: Task, b: Task) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')

function useColumns(mode: BoardMode): ColumnDef[] {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const search = useStore((s) => s.search)
  const filter = useStore((s) => s.filter)

  return useMemo(() => {
    const today = todayStr()
    const all = Object.values(tasks).filter((t) => matchesSearch(t, search) && matchesFilter(t, filter, tasks, today))
    const top = all.filter((t) => !t.parent_id)
    if (mode === 'lists') {
      const sorted = Object.values(lists)
        .filter((l) => !l.archived)
        .sort((a, b) => a.sort - b.sort)
      const inbox: ColumnDef = {
        id: 'inbox',
        kind: 'inbox',
        title: 'Unsortiert',
        tasks: top.filter((t) => !t.list_id && t.status === 'open').sort(bySort),
        done: top.filter((t) => !t.list_id && recentDone(t)).sort(byCompleted),
        assign: () => ({ list_id: null }),
        defaults: {},
        showDate: true,
        showList: false,
      }
      return [
        inbox,
        ...sorted.map<ColumnDef>((l) => ({
          id: l.id,
          kind: 'list',
          title: l.name,
          color: l.color,
          list: l,
          tasks: top.filter((t) => t.list_id === l.id && t.status === 'open').sort(bySort),
          done: top.filter((t) => t.list_id === l.id && recentDone(t)).sort(byCompleted),
          assign: () => ({ list_id: l.id }),
          defaults: { list_id: l.id },
          showDate: true,
          showList: false,
        })),
      ]
    }

    // Wochenplanung: ohne Datum + die nächsten 7 Tage
    const dated = all.filter((t) => t.due_date)
    const cols: ColumnDef[] = [
      {
        id: 'nodate',
        kind: 'nodate',
        title: 'Ohne Datum',
        tasks: top.filter((t) => !t.due_date && t.status === 'open').sort(bySort),
        done: [],
        assign: () => ({ due_date: null, start_at: null, end_at: null, timezone: null }),
        defaults: {},
        showDate: false,
        showList: true,
      },
    ]
    for (let i = 0; i < 7; i++) {
      const day = addDaysStr(today, i)
      cols.push({
        id: day,
        kind: 'day',
        title: i === 0 ? 'Heute' : i === 1 ? 'Morgen' : weekdayShort(day),
        sub: shortDate(day),
        isToday: i === 0,
        tasks: dated.filter((t) => t.status === 'open' && (t.due_date === day || (i === 0 && t.due_date! < today))).sort(byTimeThenSort),
        done: dated.filter((t) => t.due_date === day && recentDone(t)).sort(byCompleted),
        assign: (t) => (t.start_at && t.end_at ? { ...moveBlockToDate(t.start_at, t.end_at, t.timezone ?? deviceTimeZone(), day), timezone: t.timezone ?? deviceTimeZone() } : { due_date: day }),
        defaults: { due_date: day },
        showDate: false,
        showList: true,
      })
    }
    return cols
  }, [tasks, lists, search, filter, mode])
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
export default function BoardView() {
  const mode = useStore((s) => s.boardMode)
  const setBoardMode = useStore((s) => s.setBoardMode)
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const loaded = useStore((s) => s.loaded)
  const updateTask = useStore((s) => s.updateTask)
  const updateList = useStore((s) => s.updateList)
  const setDragging = useStore((s) => s.setDragging)
  const showSubtasks = useStore((s) => s.showSubtasks)
  const setShowSubtasks = useStore((s) => s.setShowSubtasks)
  const columns = useColumns(mode)

  const [items, setItems] = useState<Record<string, string[]> | null>(null)
  const [active, setActive] = useState<{ id: string; type: 'card' | 'column' } | null>(null)
  const startCol = useRef<string | null>(null)
  const lastOver = useRef<UniqueIdentifier | null>(null)

  const baseItems = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.tasks.map((t) => t.id)])), [columns])
  const order = items ?? baseItems
  const colById = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c])), [columns])
  const listColumnIds = columns.filter((c) => c.kind === 'list').map((c) => `colsort:${c.id}`)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = useCallback(
    (id: UniqueIdentifier): string | null => {
      const s = String(id)
      if (s.startsWith('col:')) return s.slice(4)
      for (const [col, ids] of Object.entries(order)) if (ids.includes(s)) return col
      return null
    },
    [order],
  )

  const collision: CollisionDetection = useCallback(
    (args) => {
      if (active?.type === 'column') {
        return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('colsort:')) })
      }
      const containers = args.droppableContainers.filter((c) => !String(c.id).startsWith('colsort:'))
      const pointer = pointerWithin({ ...args, droppableContainers: containers })
      const hits = pointer.length ? pointer : rectIntersection({ ...args, droppableContainers: containers })
      let overId = getFirstCollision(hits, 'id')
      if (overId != null) {
        const s = String(overId)
        if (s.startsWith('col:')) {
          const colItems = order[s.slice(4)] ?? []
          if (colItems.length) {
            const inner = closestCenter({ ...args, droppableContainers: containers.filter((c) => colItems.includes(String(c.id))) })
            if (inner[0]) overId = inner[0].id
          }
        }
        lastOver.current = overId
        return [{ id: overId }]
      }
      return lastOver.current ? [{ id: lastOver.current }] : []
    },
    [active, order],
  )

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const id = String(a.id)
    haptic(12)
    setDragging(true)
    if (id.startsWith('colsort:')) {
      setActive({ id: id.slice(8), type: 'column' })
      return
    }
    setActive({ id, type: 'card' })
    setItems(baseItems)
    startCol.current = findContainer(id)
  }

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || active?.type !== 'card') return
    const activeId = String(a.id)
    const overId = String(over.id)
    const from = findContainer(activeId)
    const to = findContainer(overId)
    if (!from || !to || from === to) return
    setItems((prev) => {
      const p = prev ?? baseItems
      const toItems = p[to] ?? []
      let index = toItems.length
      if (!overId.startsWith('col:')) {
        const oi = toItems.indexOf(overId)
        const below = a.rect.current.translated && a.rect.current.translated.top > over.rect.top + over.rect.height / 2
        index = oi >= 0 ? oi + (below ? 1 : 0) : toItems.length
      }
      return { ...p, [from]: p[from].filter((i) => i !== activeId), [to]: [...toItems.slice(0, index), activeId, ...toItems.slice(index)] }
    })
  }

  const finish = () => {
    setActive(null)
    setItems(null)
    setDragging(false)
    markDragEnd()
    lastOver.current = null
  }

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const id = String(a.id)
    if (active?.type === 'column') {
      if (over && String(over.id) !== id) {
        const ids = listColumnIds
        const from = ids.indexOf(id)
        const to = ids.indexOf(String(over.id))
        if (from >= 0 && to >= 0) {
          const next = arrayMove(ids, from, to).map((x) => x.slice(8))
          const i = next.indexOf(id.slice(8))
          const sort = sortBetween(lists[next[i - 1]]?.sort, lists[next[i + 1]]?.sort)
          void updateList(id.slice(8), { sort })
          haptic(8)
        }
      }
      finish()
      return
    }
    if (!over) return finish()
    const to = findContainer(String(over.id))
    const from = startCol.current
    if (!to || !from) return finish()
    let ids = [...(order[to] ?? [])]
    const oldIndex = ids.indexOf(id)
    const overIndex = ids.indexOf(String(over.id))
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) ids = arrayMove(ids, oldIndex, overIndex)
    const idx = ids.indexOf(id)
    const task = tasks[id]
    const unchanged = from === to && baseItems[to]?.indexOf(id) === idx
    if (task && !unchanged) {
      const sort = sortBetween(tasks[ids[idx - 1]]?.sort, tasks[ids[idx + 1]]?.sort)
      const patch: TaskPatch = { sort, ...(from !== to ? colById[to].assign(task) : {}) }
      void updateTask(id, patch)
      haptic(8)
    }
    finish()
  }

  const activeTask = active?.type === 'card' ? tasks[active.id] : null
  const activeCol = active?.type === 'column' ? colById[active.id] : null
  const unsorted = columns.find((c) => c.kind === 'inbox')

  return (
    <div className="view">
      <div className="board-toolbar">
        <h1 className="board-title">{mode === 'lists' ? 'Board' : 'Diese Woche'}</h1>
        <FilterBar />
        <span className="grow" style={{ flex: 1 }} />
        <button
          className={`icon-btn sub-toggle ${showSubtasks ? 'on' : ''}`}
          aria-pressed={showSubtasks}
          aria-label={showSubtasks ? 'Unteraufgaben auf Karten ausblenden' : 'Unteraufgaben auf Karten zeigen'}
          title={showSubtasks ? 'Unteraufgaben ausblenden' : 'Unteraufgaben zeigen'}
          onClick={() => setShowSubtasks(!showSubtasks)}
        >
          <ListChecks size={18} />
        </button>
        <Segmented
          group="board-mode"
          value={mode}
          onChange={(v) => setBoardMode(v as BoardMode)}
          options={[
            { value: 'lists', label: 'Listen', icon: <Columns3 /> },
            { value: 'week', label: 'Woche', icon: <LayoutList /> },
          ]}
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={{ acceleration: 6, threshold: { x: 0.12, y: 0.15 } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
      >
        <div className={`board ${active ? 'dragging' : ''}`}>
          {!loaded && <BoardSkeleton />}
          {loaded && (
            <SortableContext items={listColumnIds} strategy={horizontalListSortingStrategy}>
              {columns.map((col) => (
                <Column key={col.id} col={col} ids={order[col.id] ?? []} dragging={!!active} unsortedCount={unsorted?.tasks.length ?? 0} />
              ))}
            </SortableContext>
          )}
          {loaded && mode === 'lists' && <NewColumn count={columns.length} />}
        </div>
        {createPortal(
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
            {activeTask ? (
              <motion.div initial={{ rotate: 0, scale: 1 }} animate={{ rotate: 1.6, scale: 1.03 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                <TaskCard task={activeTask} overlay showList={mode === 'week'} />
              </motion.div>
            ) : activeCol ? (
              <div className="col col-overlay" style={{ height: 120 }}>
                <div className="col-head">
                  <span className="dot" style={{ background: activeCol.color }} />
                  <span className="col-title">{activeCol.title}</span>
                  <span className="col-count">{activeCol.tasks.length}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  )
}

function BoardSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="col" style={{ height: 220 - i * 40, opacity: 0.6 }} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Spalte
// ---------------------------------------------------------------------------
function Column({ col, ids, dragging, unsortedCount }: { col: ColumnDef; ids: string[]; dragging: boolean; unsortedCount: number }) {
  const tasks = useStore((s) => s.tasks)
  const setTriage = useStore((s) => s.setTriage)
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `col:${col.id}`, data: { type: 'container' } })
  const sortable = useSortable({ id: `colsort:${col.id}`, data: { type: 'column' }, disabled: col.kind !== 'list' })
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }
  const cardTasks = ids.map((id) => tasks[id]).filter(Boolean)

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={`col ${col.kind === 'inbox' ? 'inbox' : ''} ${isOver ? 'over' : ''} ${sortable.isDragging ? 'col-dragging' : ''}`}
      aria-label={col.title}
      data-col={col.id}
    >
      <header className="col-head" {...(col.kind === 'list' ? { ...sortable.attributes, ...sortable.listeners } : {})}>
        {col.kind === 'inbox' && <Inbox size={16} style={{ color: 'var(--amber)' }} />}
        {col.kind === 'list' && <span className="dot" style={{ background: col.color }} />}
        {renaming && col.list ? (
          <RenameInput list={col.list} onDone={() => setRenaming(false)} />
        ) : (
          <span className={`col-title ${col.isToday ? 'today-col' : ''}`} onDoubleClick={() => col.kind === 'list' && setRenaming(true)}>
            {col.title}
            {col.sub && <span className="sub">{col.sub}</span>}
          </span>
        )}
        <span className="col-count">{col.tasks.length || ''}</span>
        <button className="icon-btn sm" aria-label="Aufgabe hinzufügen" onClick={() => setAdding(true)} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <Plus size={16} />
        </button>
        {col.kind === 'list' && col.list && <ColumnMenu list={col.list} onRename={() => setRenaming(true)} />}
      </header>

      {col.kind === 'inbox' && unsortedCount > 1 && !adding && (
        <button className="triage-call" onClick={() => setTriage(true)}>
          <Shuffle />
          {unsortedCount} Aufgaben einsortieren
          <ChevronRight style={{ marginLeft: 'auto' }} />
        </button>
      )}

      <div className="col-body" ref={setDropRef}>
        {adding && <InlineAdd col={col} topSortValue={topSort(col.tasks.map((t) => t.sort))} onClose={() => setAdding(false)} />}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {cardTasks.map((t) => (
              <SortableCard key={t.id} task={t} col={col} />
            ))}
          </AnimatePresence>
        </SortableContext>
        {cardTasks.length === 0 && !adding && (
          <div className="col-empty">{dragging ? 'Hier ablegen' : col.kind === 'inbox' ? 'Alles einsortiert.' : col.kind === 'day' ? 'Nichts geplant' : 'Noch leer'}</div>
        )}
        {showDone && (
          <AnimatePresence initial={false}>
            {col.done.map((t) => (
              <motion.div key={t.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginBottom: 6 }}>
                <TaskCard task={t} showDate={col.showDate} showList={col.showList} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="col-foot">
        {!adding && (
          <button className="col-add" onClick={() => setAdding(true)}>
            <Plus /> Aufgabe
          </button>
        )}
        {col.done.length > 0 && (
          <button className={`done-toggle ${showDone ? 'open' : ''}`} onClick={() => setShowDone((v) => !v)}>
            <ChevronRight /> Erledigt ({col.done.length})
          </button>
        )}
      </div>
    </section>
  )
}

function SortableCard({ task, col }: { task: Task; col: ColumnDef }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'card' } })
  return (
    <motion.div
      ref={setNodeRef}
      className="card-slot"
      style={{ transform: CSS.Translate.toString(transform), transition, marginBottom: 6, position: 'relative', zIndex: isDragging ? 1 : 0 }}
      initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
      animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden', transition: { duration: 0.22 } }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <TaskCard task={task} ghost={isDragging} showDate={col.showDate} showList={col.showList} {...attributes} {...listeners} />
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Eingabe direkt in der Spalte
// ---------------------------------------------------------------------------
function InlineAdd({ col, topSortValue, onClose }: { col: ColumnDef; topSortValue: number; onClose: () => void }) {
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const [text, setText] = useState('')
  const sortRef = useRef(topSortValue)
  const c = useMemo(() => composeTask(text, col.defaults, lists, tasks), [text, col.defaults, lists, tasks])

  const submit = () => {
    if (!c.patch.title) return
    let list_id = c.patch.list_id
    if (c.newListName) list_id = createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
    sortRef.current -= 1
    createTask({ ...c.patch, list_id, sort: sortRef.current })
    setText('')
  }

  return (
    <div className="inline-add" style={{ marginBottom: 6 }}>
      <SmartField
        autoFocus
        value={text}
        onChange={setText}
        tokens={c.parsed.tokens}
        placeholder="Was steht an?"
        onSubmit={submit}
        onCancel={onClose}
        onBlur={() => {
          if (!text.trim()) onClose()
        }}
        className="inline-field"
      />
      {c.parsed.tokens.length > 0 && (
        <div className="hint">
          <TokenChips tokens={c.parsed.tokens} />
        </div>
      )}
    </div>
  )
}

function RenameInput({ list, onDone }: { list: List; onDone: () => void }) {
  const updateList = useStore((s) => s.updateList)
  const [name, setName] = useState(list.name)
  const save = () => {
    const n = name.trim()
    if (n && n !== list.name) void updateList(list.id, { name: n })
    onDone()
  }
  return (
    <input
      className="col-rename"
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') onDone()
      }}
    />
  )
}

function ColumnMenu({ list, onRename }: { list: List; onRename: () => void }) {
  const updateList = useStore((s) => s.updateList)
  const openTemplatePicker = useStore((s) => s.openTemplatePicker)
  const deleteList = useStore((s) => s.deleteList)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirm(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button className="icon-btn sm" aria-label="Listen-Menü" onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false)
                onRename()
              }}
            >
              <Pencil size={15} /> Umbenennen
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false)
                openTemplatePicker({ list_id: list.id })
              }}
            >
              <LayoutTemplate size={15} /> Aus Vorlage …
            </button>
            <div className="menu-swatches">
              {LIST_COLORS.map((c) => (
                <button key={c} className={`swatch ${c === list.color ? 'on' : ''}`} style={{ background: c }} aria-label="Farbe wählen" onClick={() => void updateList(list.id, { color: c })} />
              ))}
            </div>
            <button
              className={`menu-item danger ${confirm ? 'confirm' : ''}`}
              onClick={() => {
                if (!confirm) return setConfirm(true)
                setOpen(false)
                void deleteList(list.id)
              }}
            >
              <Trash2 size={15} /> {confirm ? 'Wirklich löschen?' : 'Liste löschen'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NewColumn({ count }: { count: number }) {
  const createList = useStore((s) => s.createList)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = async () => {
    const n = name.trim()
    if (!n) return setOpen(false)
    await createList(n, LIST_COLORS[(count - 1) % LIST_COLORS.length])
    setName('')
  }
  return (
    <div className="new-col">
      {open ? (
        <input
          className="field-input"
          autoFocus
          placeholder="Name der Liste"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      ) : (
        <button className="trigger" onClick={() => setOpen(true)}>
          <Plus size={17} /> Neue Liste
        </button>
      )}
    </div>
  )
}

