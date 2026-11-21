import { memo } from 'react'
import { useStore } from '../store'
import type { Task } from '../lib/types'
import { addDaysStr, dayLabel, timeLabel, todayStr } from '../lib/dates'
import { ancestors, childrenOf, subtaskProgress } from '../lib/tree'

interface Props {
  task: Task
  depth?: number
  showDate?: boolean
  overdue?: boolean
  showParent?: boolean
}

function TaskRowInner({ task, depth = 0, showDate, overdue, showParent = true }: Props) {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const view = useStore((s) => s.view)
  const selectedId = useStore((s) => s.selectedId)
  const collapsed = useStore((s) => !!s.collapsed[task.id])
  const { toggleDone, select, toggleCollapsed, moveToDay, updateTask } = useStore.getState()

  const kids = childrenOf(tasks, task.id)
  const progress = subtaskProgress(tasks, task.id)
  const list = task.list_id ? lists[task.list_id] : undefined
  const parents = depth === 0 && showParent ? ancestors(tasks, task) : []
  const today = todayStr()
  const done = task.status === 'done'

  return (
    <li className={`task ${done ? 'done' : ''} ${selectedId === task.id ? 'selected' : ''}`}>
      <div className="task-row" style={{ paddingLeft: 8 + depth * 22 }}>
        {kids.length > 0 ? (
          <button className={`chevron ${collapsed ? '' : 'open'}`} aria-label={collapsed ? 'Unteraufgaben zeigen' : 'Unteraufgaben verbergen'} onClick={() => toggleCollapsed(task.id)}>
            ›
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}
        <button
          className={`check p${task.priority}`}
          role="checkbox"
          aria-checked={done}
          aria-label={done ? 'Wieder öffnen' : 'Erledigen'}
          onClick={() => void toggleDone(task.id)}
        >
          {done ? '✓' : ''}
        </button>
        <button className="task-main" onClick={() => select(task.id)}>
          {parents.length > 0 && <span className="crumb">{parents.map((p) => p.title).join(' › ')} ›</span>}
          <span className="task-title">{task.title}</span>
          <span className="meta">
            {task.start_at && task.end_at && (
              <span className="chip time">
                {timeLabel(task.start_at)}–{timeLabel(task.end_at)}
              </span>
            )}
            {showDate && task.due_date && <span className={`chip ${task.due_date < today ? 'late' : ''}`}>{dayLabel(task.due_date, today)}</span>}
            {list && !(view.kind === 'list' && view.listId === list.id) && (
              <span className="chip list">
                <span className="dot" style={{ background: list.color }} />
                {list.name}
              </span>
            )}
            {progress.total > 0 && (
              <span className="chip">
                ☑ {progress.done}/{progress.total}
              </span>
            )}
            {task.rollover_count > 0 && !done && (
              <span className="chip warn" title={`${task.rollover_count}× verschoben`}>
                ↻ {task.rollover_count}
              </span>
            )}
            {task.notes && <span className="chip" title="Notiz">≡</span>}
            {task.tags.map((t) => (
              <span key={t} className="chip tag">
                #{t}
              </span>
            ))}
          </span>
        </button>
      </div>
      {overdue && !done && (
        <div className="row-actions" style={{ paddingLeft: 60 + depth * 22 }}>
          <button className="btn small" onClick={() => void moveToDay(task.id, today)}>
            Heute
          </button>
          <button className="btn small" onClick={() => void moveToDay(task.id, addDaysStr(today, 1))}>
            Morgen
          </button>
          <button
            className="btn small ghost"
            onClick={() => void moveToDay(task.id, null).then(() => updateTask(task.id, { horizon: 'backlog' }))}
          >
            Backlog
          </button>
        </div>
      )}
      {kids.length > 0 && !collapsed && (
        <ul className="task-list nested">
          {kids.map((k) => (
            <TaskRow key={k.id} task={k} depth={depth + 1} showDate={showDate} showParent={false} />
          ))}
        </ul>
      )}
    </li>
  )
}

const TaskRow = memo(TaskRowInner)
export default TaskRow
