import { forwardRef, memo } from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlignLeft, CalendarClock, ChevronRight, ListChecks, Repeat, RotateCcw } from 'lucide-react'
import { useStore } from '../store'
import type { Task } from '../lib/types'
import { dayLabel, timeLabel, todayStr } from '../lib/dates'
import { ancestors, childrenOf, subtaskProgress } from '../lib/tree'
import { justDragged } from '../lib/drag'
import Check from './Check'

interface MetaProps {
  task: Task
  showDate?: boolean
  showList?: boolean
}

export function TaskMeta({ task, showDate = true, showList = true }: MetaProps) {
  const tasks = useStore((s) => s.tasks)
  const list = useStore((s) => (task.list_id ? s.lists[task.list_id] : undefined))
  const expanded = useStore((s) => !!s.expanded[task.id])
  const toggleExpanded = useStore((s) => s.toggleExpanded)
  const progress = subtaskProgress(tasks, task.id)
  const today = todayStr()
  const late = !!task.due_date && task.due_date < today && task.status === 'open'

  return (
    <div className="card-meta">
      {task.start_at && task.end_at && (
        <span className={`chip time ${late ? 'late' : ''}`}>
          <CalendarClock />
          {(showDate || late) && task.due_date !== today ? `${dayLabel(task.due_date!, today)} · ` : ''}
          {timeLabel(task.start_at)}–{timeLabel(task.end_at)}
        </span>
      )}
      {!task.start_at && (showDate || late) && task.due_date && (
        <span className={`chip ${late ? 'late' : task.due_date === today ? 'today' : ''}`}>{dayLabel(task.due_date, today)}</span>
      )}
      {task.rrule && (
        <span className="chip" title="Wiederholt sich">
          <Repeat />
        </span>
      )}
      {progress.total > 0 && (
        <button
          type="button"
          className={`chip sub-expander ${expanded ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(task.id)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          aria-label="Unteraufgaben zeigen"
        >
          <ListChecks />
          {progress.done}/{progress.total}
          <ChevronRight className="chev" />
        </button>
      )}
      {task.notes && (
        <span className="chip" title="Hat Notizen">
          <AlignLeft />
        </span>
      )}
      {task.rollover_count > 0 && task.status === 'open' && (
        <span className="chip warn" title={`${task.rollover_count}× verschoben`}>
          <RotateCcw />
          {task.rollover_count}
        </span>
      )}
      {showList && list && (
        <span className="chip">
          <span className="dot" style={{ background: list.color }} />
          {list.name}
        </span>
      )}
      {task.tags.map((t) => (
        <span key={t} className="chip tag">
          #{t}
        </span>
      ))}
    </div>
  )
}

function SubList({ task }: { task: Task }) {
  const tasks = useStore((s) => s.tasks)
  const toggleDone = useStore((s) => s.toggleDone)
  const kids = childrenOf(tasks, task.id)
  return (
    <motion.div className="card-subs" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
      {kids.map((k) => (
        <div key={k.id} className={`card-sub ${k.status === 'done' ? 'done' : ''}`}>
          <Check done={k.status === 'done'} size="small" onToggle={() => void toggleDone(k.id)} />
          <span>{k.title}</span>
        </div>
      ))}
    </motion.div>
  )
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  task: Task
  showDate?: boolean
  showList?: boolean
  showCrumb?: boolean
  ghost?: boolean
  overlay?: boolean
  style?: CSSProperties
}

/** Eine Aufgabe als Karte. Reine Darstellung – Ziehen hängen die Ansichten von außen an. */
export const TaskCard = memo(
  forwardRef<HTMLDivElement, CardProps>(function TaskCard({ task, showDate = true, showList = true, showCrumb = true, ghost, overlay, className, style, ...rest }, ref) {
    const selected = useStore((s) => s.selectedId === task.id)
    const expanded = useStore((s) => !!s.expanded[task.id])
    const tasks = useStore((s) => s.tasks)
    const select = useStore((s) => s.select)
    const toggleDone = useStore((s) => s.toggleDone)
    const crumbs = showCrumb && task.parent_id ? ancestors(tasks, task) : []
    const done = task.status === 'done'

    return (
      <div
        ref={ref}
        className={`card p${task.priority} ${done ? 'done' : ''} ${selected ? 'selected' : ''} ${ghost ? 'ghost' : ''} ${overlay ? 'overlay' : ''} ${className ?? ''}`}
        style={style}
        data-task={task.id}
        {...rest}
      >
        <Check done={done} priority={task.priority} onToggle={() => void toggleDone(task.id)} />
        <div
          className="card-main"
          role="button"
          tabIndex={0}
          onClick={() => !justDragged() && select(task.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') select(task.id)
          }}
        >
          {crumbs.length > 0 && <span className="card-crumb">{crumbs.map((c) => c.title).join(' › ')}</span>}
          <span className="card-title">{task.title}</span>
          <TaskMeta task={task} showDate={showDate} showList={showList} />
          <AnimatePresence initial={false}>{expanded && !overlay && <SubList task={task} />}</AnimatePresence>
        </div>
      </div>
    )
  }),
)
