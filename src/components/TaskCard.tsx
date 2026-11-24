import { forwardRef, memo, useState } from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlignLeft, CalendarClock, ChevronRight, Flag, ListChecks, Lock, Repeat, RotateCcw, Timer } from 'lucide-react'
import { useStore } from '../store'
import type { Task } from '../lib/types'
import { PRIORITY_LABEL } from '../lib/types'
import { dayLabel, shortDate, timeLabel, todayStr } from '../lib/dates'
import { ancestors, childrenOf, compareTasks, subtaskProgress } from '../lib/tree'
import { openBlockers } from '../lib/blocking'
import { hasParts, isPart } from '../lib/parts'
import { minutesText } from '../lib/dayplan'
import { PartBadge, PartProgress } from './PartBadge'
import { deadlineDay, deadlineState, deadlineTime } from '../lib/filter'
import { durationText } from '../lib/lang'
import { justDragged } from '../lib/drag'
import Check from './Check'

interface MetaProps {
  task: Task
  showDate?: boolean
  showList?: boolean
  /** Fortschritt der Unteraufgaben zeigen (aus, wenn sie ohnehin darunter stehen) */
  showSubs?: boolean
  /** geschätzte Dauer zeigen (aus, wenn es daneben eine eigene Auswahl gibt) */
  showEstimate?: boolean
}

export function TaskMeta({ task, showDate = true, showList = true, showSubs = true, showEstimate = true }: MetaProps) {
  const tasks = useStore((s) => s.tasks)
  const list = useStore((s) => (task.list_id ? s.lists[task.list_id] : undefined))
  const expanded = useStore((s) => s.expanded[task.id] ?? s.showSubtasks)
  const toggleExpanded = useStore((s) => s.toggleExpanded)
  const progress = subtaskProgress(tasks, task.id)
  const today = todayStr()
  const late = !!task.due_date && task.due_date < today && task.status === 'open'
  const blockers = task.status === 'open' ? openBlockers(tasks, task) : []

  const whole = hasParts(tasks, task.id)
  return (
    <div className="card-meta">
      {isPart(task) && <PartBadge task={task} />}
      {whole && <PartProgress task={task} />}
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
      {blockers.length > 0 && (
        <span className="chip blocked" title={`Wartet auf: ${blockers.map((b) => b.title).join(', ')}`}>
          <Lock />
          <span className="chip-text">{blockers.length === 1 ? blockers[0].title : `${blockers.length} Aufgaben`}</span>
        </span>
      )}
      {task.priority > 0 && task.status === 'open' && (
        <span className={`chip prio p${task.priority}`} title={`Wichtigkeit ${task.priority} – ${PRIORITY_LABEL[task.priority]}`}>
          <span className="prio-num">{task.priority}</span>
          {task.priority >= 4 && PRIORITY_LABEL[task.priority]}
        </span>
      )}
      {task.deadline && task.status === 'open' && <DeadlineChip deadline={task.deadline} today={today} />}
      {showEstimate && !whole && task.estimate && !task.start_at && task.status === 'open' && (
        <span className="chip" title="Geschätzte Dauer">
          <Timer />
          {durationText(task.estimate)}
        </span>
      )}
      {task.rrule && (
        <span className="chip" title="Wiederholt sich">
          <Repeat />
        </span>
      )}
      {showSubs && progress.total > 0 && (
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

export function DeadlineChip({ deadline, today = todayStr() }: { deadline: string; today?: string }) {
  const st = deadlineState(deadline, today)
  const day = deadlineDay(deadline)
  const time = deadlineTime(deadline)
  const at = time ? ` ${time}` : ''
  const text = st === 'overdue' ? (day === today ? `Frist ${time} vorbei` : `Frist ${shortDate(day)}`) : st === 'today' ? `Frist heute${at}` : `bis ${dayLabel(day, today)}${at}`
  return (
    <span className={`chip deadline ${st}`} title={`Frist: ${shortDate(day)}${at}`}>
      <Flag />
      {text}
    </span>
  )
}

const SUB_LIMIT = 6

/** Unteraufgaben direkt auf der Karte – offene zuerst, abhakbar, antippen öffnet sie */
export function SubList({ task }: { task: Task }) {
  const tasks = useStore((s) => s.tasks)
  const toggleDone = useStore((s) => s.toggleDone)
  const select = useStore((s) => s.select)
  const [all, setAll] = useState(false)
  const kids = childrenOf(tasks, task.id).sort((a, b) => (a.status === b.status || (isPart(a) && isPart(b)) ? compareTasks(a, b) : a.status === 'open' ? -1 : 1))
  const shown = all ? kids : kids.slice(0, SUB_LIMIT)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <motion.div
      className="card-subs"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      style={{ overflow: 'hidden' }}
      onClick={stop}
    >
      <AnimatePresence initial={false}>
        {shown.map((k) => {
          const blocked = k.status === 'open' && openBlockers(tasks, k).length > 0
          const grand = subtaskProgress(tasks, k.id)
          return (
            <motion.div
              key={k.id}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`card-sub ${k.status === 'done' ? 'done' : ''} ${blocked ? 'blocked' : ''} ${isPart(k) ? 'part' : ''}`}
            >
              <Check done={k.status === 'done'} size="small" onToggle={() => toggleDone(k.id)} />
              <button type="button" className="card-sub-title" onClick={() => !justDragged() && select(k.id)}>
                {isPart(k) ? (
                  <>
                    <span className="sub-part-no">Teil {kids.filter(isPart).indexOf(k) + 1}</span>
                    {k.title !== task.title && ` ${k.title}`}
                    {k.estimate ? <span className="sub-part-meta">{minutesText(k.estimate)}</span> : null}
                    {k.due_date && k.status === 'open' ? <span className="sub-part-meta">{dayLabel(k.due_date)}</span> : null}
                  </>
                ) : (
                  k.title
                )}
              </button>
              {blocked && <Lock className="sub-icon" aria-label="wartet" />}
              {grand.total > 0 && (
                <span className="sub-count">
                  {grand.done}/{grand.total}
                </span>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      {kids.length > SUB_LIMIT && (
        <button type="button" className="card-sub-more" onClick={() => setAll((v) => !v)} onPointerDown={stop} onMouseDown={stop}>
          {all ? 'Weniger zeigen' : `+ ${kids.length - SUB_LIMIT} weitere`}
        </button>
      )}
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
    const expanded = useStore((s) => s.expanded[task.id] ?? s.showSubtasks)
    const tasks = useStore((s) => s.tasks)
    const select = useStore((s) => s.select)
    const toggleDone = useStore((s) => s.toggleDone)
    // Teile tragen den Titel der Hauptaufgabe – der Pfad wäre doppelt
    const crumbs = showCrumb && task.parent_id ? ancestors(tasks, task).filter((a) => !(isPart(task) && a.id === task.parent_id && a.title === task.title)) : []
    const done = task.status === 'done'
    const blocked = !done && openBlockers(tasks, task).length > 0
    const hasKids = childrenOf(tasks, task.id).length > 0
    const showNums = useStore((s) => s.showNums)

    return (
      <div
        ref={ref}
        className={`card p${task.priority} ${isPart(task) ? 'part' : ''} ${done ? 'done' : ''} ${blocked ? 'blocked' : ''} ${selected ? 'selected' : ''} ${ghost ? 'ghost' : ''} ${overlay ? 'overlay' : ''} ${className ?? ''}`}
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
          <span className="card-title">
            {blocked && <Lock className="wait-lock" aria-label="wartet" />}
            {task.title}
            {showNums && task.num !== null && <span className="card-num">{task.num}</span>}
          </span>
          <TaskMeta task={task} showDate={showDate} showList={showList} />
          <AnimatePresence initial={false}>{expanded && hasKids && !overlay && !done && <SubList task={task} />}</AnimatePresence>
        </div>
      </div>
    )
  }),
)
