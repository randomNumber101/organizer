import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { CalendarDays, Clock, Flag, Folder, Hash, Mountain, Repeat, Trash2, X, CornerLeftUp, CalendarCheck2 } from 'lucide-react'
import { useStore } from '../store'
import type { Horizon, Priority } from '../lib/types'
import { HORIZON_LABEL, PRIORITY_LABEL } from '../lib/types'
import { addDaysStr, durationLabel, isoFromDayMinutes, minutesBetween, minutesOfDay, nextWeekdayStr, todayStr, hhmm } from '../lib/dates'
import { ancestors, childrenOf } from '../lib/tree'
import { PRESET_LABEL, PRESET_RRULE, presetOf, repeatLabel, type RepeatPreset } from '../../shared/recurrence'
import { useIsMobile } from '../hooks/useMedia'
import Check from './Check'

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]

/** Detailansicht einer Aufgabe – rechts als Seitenleiste, auf dem Handy als Blatt von unten */
export default function TaskSheet() {
  const id = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const isMobile = useIsMobile()
  const controls = useDragControls()

  useEffect(() => {
    if (!id) return
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      if (e.key === 'Escape' && !typing) select(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [id, select])

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div key="bd" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => select(null)} />
          <motion.aside
            key="sheet"
            className="sheet"
            role="dialog"
            aria-label="Aufgabe"
            initial={isMobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag={isMobile ? 'y' : false}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) select(null)
            }}
          >
            <div className="sheet-grab" onPointerDown={(e) => controls.start(e)} style={{ touchAction: 'none' }} />
            <SheetContent key={id} id={id} onGrab={(e) => isMobile && controls.start(e)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function SheetContent({ id, onGrab }: { id: string; onGrab: (e: React.PointerEvent) => void }) {
  const task = useStore((s) => s.tasks[id])
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const { updateTask, toggleDone, deleteTask, select, createTask, moveToDay } = useStore.getState()
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!task) return
    if (document.activeElement?.id !== 'sheet-title') setTitle(task.title)
    if (document.activeElement?.id !== 'sheet-notes') setNotes(task.notes ?? '')
  }, [task?.title, task?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => [...new Set(Object.values(tasks).flatMap((t) => t.tags))].sort(), [tasks])

  if (!task) return null
  const kids = childrenOf(tasks, id)
  const parents = ancestors(tasks, task)
  const today = todayStr()
  const duration = task.start_at && task.end_at ? minutesBetween(task.start_at, task.end_at) : 60
  const preset = presetOf(task.rrule)
  const doneKids = kids.filter((k) => k.status === 'done').length
  const sortedLists = Object.values(lists).sort((a, b) => a.sort - b.sort)

  const saveTitle = () => {
    const t = title.trim()
    if (t && t !== task.title) void updateTask(id, { title: t })
    else setTitle(task.title)
  }
  const saveNotes = () => {
    const n = notes.trim() ? notes : null
    if (n !== task.notes) void updateTask(id, { notes: n })
  }
  const setDay = (day: string | null) => void moveToDay(id, day)
  const setTime = (v: string) => {
    if (!v) return void updateTask(id, { start_at: null, end_at: null, timezone: null })
    const [h, m] = v.split(':').map(Number)
    const day = task.due_date ?? today
    const start = h * 60 + m
    void updateTask(id, { start_at: isoFromDayMinutes(day, start), end_at: isoFromDayMinutes(day, Math.min(24 * 60, start + duration)) })
  }
  const setDuration = (min: number) => {
    if (!task.start_at) return
    const day = task.due_date ?? today
    const start = minutesOfDay(task.start_at)
    void updateTask(id, { end_at: isoFromDayMinutes(day, Math.min(24 * 60, start + min)) })
  }
  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '').toLowerCase()
    if (t && !task.tags.includes(t)) void updateTask(id, { tags: [...task.tags, t] })
    setTagInput('')
  }
  const addSub = () => {
    const t = subInput.trim()
    if (!t) return
    void createTask({ title: t, parent_id: id, list_id: task.list_id, horizon: task.horizon })
    setSubInput('')
  }

  const weekend = nextWeekdayStr(today, 6)
  const dateOpts: [string, string][] = [
    ['Heute', today],
    ['Morgen', addDaysStr(today, 1)],
    ['Wochenende', new Date().getDay() === 6 ? today : weekend],
    ['Nächste Woche', nextWeekdayStr(today, 1)],
  ]

  return (
    <>
      <div className="sheet-head" onPointerDown={onGrab}>
        {parents.length > 0 ? (
          <button className="crumb" onClick={() => select(parents[parents.length - 1].id)} onPointerDown={(e) => e.stopPropagation()}>
            <CornerLeftUp size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {parents.map((p) => p.title).join(' › ')}
          </button>
        ) : (
          <span className="crumb">{task.list_id ? lists[task.list_id]?.name : 'Unsortiert'}</span>
        )}
        <button className="icon-btn" aria-label="Schließen" onClick={() => select(null)} onPointerDown={(e) => e.stopPropagation()}>
          <X size={18} />
        </button>
      </div>

      <div className="sheet-body">
        <div className="title-row">
          <Check done={task.status === 'done'} priority={task.priority} size="big" onToggle={() => void toggleDone(id)} />
          <textarea
            id="sheet-title"
            ref={titleRef}
            className="title-input"
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
        </div>
        {task.rollover_count > 0 && task.status === 'open' && <p className="chip warn" style={{ alignSelf: 'flex-start', height: 24 }}>Schon {task.rollover_count}× auf den nächsten Tag geschoben</p>}

        <div className="props">
          <span className="prop-label">
            <Folder /> Liste
          </span>
          <div className="prop-value">
            <button className={`opt ${!task.list_id ? 'on' : ''}`} onClick={() => void updateTask(id, { list_id: null })}>
              Unsortiert
            </button>
            {sortedLists.map((l) => (
              <button key={l.id} className={`opt ${task.list_id === l.id ? 'on' : ''}`} onClick={() => void updateTask(id, { list_id: l.id })}>
                <span className="dot" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
          </div>

          <span className="prop-label">
            <CalendarDays /> Datum
          </span>
          <div className="prop-value">
            {dateOpts.map(([label, d]) => (
              <button key={label} className={`opt ${task.due_date === d ? 'on' : ''}`} onClick={() => setDay(d)}>
                {label}
              </button>
            ))}
            <input type="date" value={task.due_date ?? ''} onChange={(e) => setDay(e.target.value || null)} aria-label="Datum wählen" />
            {task.due_date && (
              <button className="opt" onClick={() => setDay(null)} aria-label="Datum entfernen">
                <X />
              </button>
            )}
          </div>

          <span className="prop-label">
            <Clock /> Uhrzeit
          </span>
          <div className="prop-value">
            <input type="time" step={900} value={task.start_at ? hhmm(minutesOfDay(task.start_at)) : ''} onChange={(e) => setTime(e.target.value)} aria-label="Startzeit" />
            {task.start_at && (
              <>
                <select value={DURATIONS.includes(duration) ? duration : ''} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Dauer">
                  {!DURATIONS.includes(duration) && <option value="">{durationLabel(duration)}</option>}
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {durationLabel(d)}
                    </option>
                  ))}
                </select>
                <button className="opt" onClick={() => setTime('')} aria-label="Uhrzeit entfernen">
                  <X />
                </button>
              </>
            )}
            {!task.start_at && <span className="muted small">Oder im Kalender an eine Stelle ziehen</span>}
            {task.gcal_event_id && (
              <span className="chip time" title="Steht in deinem Google Kalender „Organizer“">
                <CalendarCheck2 /> in Google
              </span>
            )}
          </div>

          <span className="prop-label">
            <Repeat /> Wiederholen
          </span>
          <div className="prop-value">
            <select
              value={preset ?? ''}
              onChange={(e) => {
                const v = e.target.value as RepeatPreset | ''
                void updateTask(id, { rrule: v ? PRESET_RRULE[v] : null })
              }}
              aria-label="Wiederholung"
            >
              <option value="">Nie</option>
              {(Object.keys(PRESET_RRULE) as RepeatPreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
              {preset === 'custom' && <option value="custom">{repeatLabel(task.rrule)}</option>}
            </select>
            {task.rrule && <span className="muted small">Abhaken schiebt sie auf den nächsten Termin</span>}
          </div>

          <span className="prop-label">
            <Flag /> Priorität
          </span>
          <div className="prop-value">
            {([1, 2, 3, 4] as Priority[]).map((p) => (
              <button key={p} className={`opt prio-${p} ${task.priority === p ? 'on' : ''}`} onClick={() => void updateTask(id, { priority: p })}>
                {p < 4 && <Flag />}
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>

          {!task.due_date && (
            <>
              <span className="prop-label">
                <Mountain /> Horizont
              </span>
              <div className="prop-value">
                {(['short', 'long', 'backlog'] as Horizon[]).map((h) => (
                  <button key={h} className={`opt ${task.horizon === h ? 'on' : ''}`} onClick={() => void updateTask(id, { horizon: h })}>
                    {HORIZON_LABEL[h]}
                  </button>
                ))}
              </div>
            </>
          )}

          <span className="prop-label">
            <Hash /> Tags
          </span>
          <div className="prop-value">
            {task.tags.map((t) => (
              <span key={t} className="tag-chip">
                #{t}
                <button aria-label={`Tag ${t} entfernen`} onClick={() => void updateTask(id, { tags: task.tags.filter((x) => x !== t) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              className="tag-input"
              list="sheet-tags"
              placeholder="+ Tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag()
                }
              }}
              onBlur={() => tagInput && addTag()}
            />
            <datalist id="sheet-tags">
              {allTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <div className="section-label">Notizen</div>
          <textarea id="sheet-notes" className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Details, Links, Gedanken …" />
        </div>

        <div>
          <div className="section-label">
            Unteraufgaben
            {kids.length > 0 && (
              <>
                <span>
                  {doneKids}/{kids.length}
                </span>
                <span className="progress">
                  <div style={{ width: `${(doneKids / kids.length) * 100}%` }} />
                </span>
              </>
            )}
          </div>
          <div className="subtasks">
            <AnimatePresence initial={false}>
              {kids.map((k) => (
                <motion.div key={k.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={`subtask ${k.status === 'done' ? 'done' : ''}`}>
                  <Check done={k.status === 'done'} priority={k.priority} onToggle={() => void toggleDone(k.id)} />
                  <button className="s-title" onClick={() => select(k.id)}>
                    {k.title}
                  </button>
                  {childrenOf(tasks, k.id).length > 0 && <span className="chip">{childrenOf(tasks, k.id).length}</span>}
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="add-sub">
              <span className="check small" style={{ borderStyle: 'dashed' }} />
              <input
                placeholder="Unteraufgabe hinzufügen"
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSub()
                }}
              />
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <span>Erstellt {new Date(task.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <button
            className={`btn sm danger ${confirmDelete ? 'confirm' : 'ghost'}`}
            onClick={() => {
              if (confirmDelete) void deleteTask(id)
              else {
                setConfirmDelete(true)
                setTimeout(() => setConfirmDelete(false), 3000)
              }
            }}
          >
            <Trash2 size={15} />
            {confirmDelete ? `Wirklich löschen?${kids.length ? ' (mit Unteraufgaben)' : ''}` : 'Löschen'}
          </button>
        </div>
      </div>
    </>
  )
}
