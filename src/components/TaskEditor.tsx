import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'
import type { Horizon, Priority } from '../lib/types'
import { HORIZON_LABEL, PRIORITY_LABEL } from '../lib/types'
import { addDaysStr, localDateTimeToIso, minutesBetween, nextWeekdayStr, plusMinutesIso, timeLabel, todayStr } from '../lib/dates'
import { ancestors, childrenOf } from '../lib/tree'

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]

export default function TaskEditor({ id }: { id: string }) {
  const task = useStore((s) => s.tasks[id])
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const { updateTask, toggleDone, deleteTask, select, createTask } = useStore.getState()

  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Wenn die Aufgabe auf einem anderen Gerät geändert wird, Felder nachziehen (außer man tippt gerade)
  useEffect(() => {
    if (!task) return
    if (document.activeElement?.id !== 'editor-title') setTitle(task.title)
    if (document.activeElement?.id !== 'editor-notes') setNotes(task.notes ?? '')
  }, [task?.title, task?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => [...new Set(Object.values(tasks).flatMap((t) => t.tags))].sort(), [tasks])

  if (!task) return null
  const kids = childrenOf(tasks, id)
  const parents = ancestors(tasks, task)
  const today = todayStr()
  const duration = task.start_at && task.end_at ? minutesBetween(task.start_at, task.end_at) : 60

  const saveTitle = () => {
    const t = title.trim()
    if (t && t !== task.title) void updateTask(id, { title: t })
    else setTitle(task.title)
  }
  const saveNotes = () => {
    const n = notes.trim() ? notes : null
    if (n !== task.notes) void updateTask(id, { notes: n })
  }

  const setDay = (day: string | null) => {
    if (day === null) return void updateTask(id, { due_date: null, start_at: null, end_at: null, timezone: null })
    if (task.start_at) return void useStore.getState().moveToDay(id, day)
    void updateTask(id, { due_date: day })
  }

  const setTime = (hhmm: string) => {
    if (!hhmm) return void updateTask(id, { start_at: null, end_at: null, timezone: null })
    const start = localDateTimeToIso(task.due_date ?? today, hhmm)
    void updateTask(id, { start_at: start, end_at: plusMinutesIso(start, duration) })
  }

  const setDuration = (min: number) => {
    if (!task.start_at) return
    void updateTask(id, { end_at: plusMinutesIso(task.start_at, min) })
  }

  const addTag = (e: FormEvent) => {
    e.preventDefault()
    const t = tagInput.trim().replace(/^#/, '').toLowerCase()
    if (t && !task.tags.includes(t)) void updateTask(id, { tags: [...task.tags, t] })
    setTagInput('')
  }

  const addSub = (e: FormEvent) => {
    e.preventDefault()
    const t = subInput.trim()
    if (!t) return
    void createTask({ title: t, parent_id: id, list_id: task.list_id, horizon: task.horizon })
    setSubInput('')
  }

  return (
    <aside className="editor" aria-label="Aufgabe bearbeiten">
      <div className="editor-head">
        <button className="icon-btn" aria-label="Schließen" onClick={() => select(null)}>
          ✕
        </button>
        {parents.length > 0 && (
          <button className="crumb link" onClick={() => select(parents[parents.length - 1].id)}>
            ↰ {parents.map((p) => p.title).join(' › ')}
          </button>
        )}
      </div>

      <div className="editor-body">
        <div className="editor-title-row">
          <button className={`check big p${task.priority}`} role="checkbox" aria-checked={task.status === 'done'} onClick={() => void toggleDone(id)}>
            {task.status === 'done' ? '✓' : ''}
          </button>
          <textarea
            id="editor-title"
            className="title-input"
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
        </div>
        {task.rollover_count > 0 && task.status === 'open' && <p className="hint warn">↻ schon {task.rollover_count}× auf den nächsten Tag geschoben</p>}

        <div className="field">
          <span className="field-label">Datum</span>
          <div className="btn-row">
            <button className={`btn small ${task.due_date === today ? 'on' : ''}`} onClick={() => setDay(today)}>
              Heute
            </button>
            <button className={`btn small ${task.due_date === addDaysStr(today, 1) ? 'on' : ''}`} onClick={() => setDay(addDaysStr(today, 1))}>
              Morgen
            </button>
            <button className="btn small" onClick={() => setDay(nextWeekdayStr(today, 1))}>
              Nächster Mo
            </button>
            <input type="date" value={task.due_date ?? ''} onChange={(e) => setDay(e.target.value || null)} />
            {task.due_date && (
              <button className="btn small ghost" onClick={() => setDay(null)}>
                Kein Datum
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Uhrzeit</span>
          <div className="btn-row">
            <input type="time" value={task.start_at ? timeLabel(task.start_at) : ''} onChange={(e) => setTime(e.target.value)} />
            {task.start_at && (
              <>
                <select value={DURATIONS.includes(duration) ? duration : ''} onChange={(e) => setDuration(Number(e.target.value))}>
                  {!DURATIONS.includes(duration) && <option value="">{duration} Min.</option>}
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d < 60 ? `${d} Min.` : `${d / 60} Std.`}
                    </option>
                  ))}
                </select>
                <span className="muted small">bis {timeLabel(task.end_at!)}</span>
                <button className="btn small ghost" onClick={() => setTime('')}>
                  Ohne Uhrzeit
                </button>
              </>
            )}
          </div>
        </div>

        {!task.due_date && (
          <div className="field">
            <span className="field-label">Zeithorizont</span>
            <div className="segmented">
              {(['short', 'long', 'backlog'] as Horizon[]).map((h) => (
                <button key={h} className={task.horizon === h ? 'on' : ''} onClick={() => void updateTask(id, { horizon: h })}>
                  {HORIZON_LABEL[h]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">Priorität</span>
          <div className="segmented">
            {([1, 2, 3, 4] as Priority[]).map((p) => (
              <button key={p} className={`prio-btn p${p} ${task.priority === p ? 'on' : ''}`} onClick={() => void updateTask(id, { priority: p })}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Liste</span>
          <select value={task.list_id ?? ''} onChange={(e) => void updateTask(id, { list_id: e.target.value || null })}>
            <option value="">– keine –</option>
            {Object.values(lists)
              .sort((a, b) => a.sort - b.sort)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <span className="field-label">Tags</span>
          <div className="btn-row">
            {task.tags.map((t) => (
              <span key={t} className="chip tag removable">
                #{t}
                <button aria-label={`Tag ${t} entfernen`} onClick={() => void updateTask(id, { tags: task.tags.filter((x) => x !== t) })}>
                  ×
                </button>
              </span>
            ))}
            <form onSubmit={addTag}>
              <input list="all-tags" placeholder="Tag hinzufügen" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
              <datalist id="all-tags">
                {allTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </form>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Notizen</span>
          <textarea id="editor-notes" className="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Details, Links, Gedanken …" />
        </div>

        <div className="field">
          <span className="field-label">
            Unteraufgaben {kids.length > 0 && `(${kids.filter((k) => k.status === 'done').length}/${kids.length})`}
          </span>
          <ul className="sub-list">
            {kids.map((k) => (
              <li key={k.id} className={k.status === 'done' ? 'done' : ''}>
                <button className={`check p${k.priority}`} role="checkbox" aria-checked={k.status === 'done'} onClick={() => void toggleDone(k.id)}>
                  {k.status === 'done' ? '✓' : ''}
                </button>
                <button className="link sub-title" onClick={() => select(k.id)}>
                  {k.title}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addSub}>
            <input placeholder="+ Unteraufgabe" value={subInput} onChange={(e) => setSubInput(e.target.value)} />
          </form>
        </div>

        <div className="editor-foot">
          <span className="muted small">Erstellt {new Date(task.created_at).toLocaleDateString('de-DE')}</span>
          <button
            className={`btn small ${confirmDelete ? 'danger' : 'ghost'}`}
            onClick={() => {
              if (confirmDelete) void deleteTask(id)
              else {
                setConfirmDelete(true)
                setTimeout(() => setConfirmDelete(false), 3000)
              }
            }}
          >
            {confirmDelete ? `Wirklich löschen?${kids.length ? ' (inkl. Unteraufgaben)' : ''}` : 'Löschen'}
          </button>
        </div>
      </div>
    </aside>
  )
}
