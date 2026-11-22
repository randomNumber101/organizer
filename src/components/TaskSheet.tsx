import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { CalendarDays, Clock, Flag, Folder, Hash, Mountain, Repeat, Trash2, X, CornerLeftUp, CalendarCheck2, Lock, Plus, Hourglass, LayoutTemplate, Link2 } from 'lucide-react'
import { useStore } from '../store'
import type { Horizon, Priority, TaskPatch } from '../lib/types'
import { HORIZON_LABEL, LIST_COLORS, PRIORITY_LABEL } from '../lib/types'
import { addDaysStr, durationLabel, isoFromDayMinutes, minutesBetween, minutesOfDay, nextWeekdayStr, todayStr, hhmm } from '../lib/dates'
import { ancestors, childrenOf, descendantIds } from '../lib/tree'
import { dependents, wouldCycle } from '../lib/blocking'
import { deadlineDay, deadlineState, deadlineTime } from '../lib/filter'
import TaskPicker from './TaskPicker'
import SmartField, { TokenChips, type SmartFieldHandle } from './SmartField'
import { applyToTask, composeTask } from '../lib/compose'
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
  const { updateTask, toggleDone, deleteTask, select, createTask, createList, moveToDay, setBlockers, saveAsTemplate, showToast } = useStore.getState()
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picking, setPicking] = useState(false)
  const [tplName, setTplName] = useState<string | null>(null)
  const titleRef = useRef<SmartFieldHandle>(null)

  useEffect(() => {
    if (!task) return
    if (document.activeElement?.id !== 'sheet-title') setTitle(task.title)
    if (document.activeElement?.id !== 'sheet-notes') setNotes(task.notes ?? '')
  }, [task?.title, task?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => [...new Set(Object.values(tasks).flatMap((t) => t.tags))].sort(), [tasks])
  const titleParse = useMemo(() => (task && title.trim() && title.trim() !== task.title ? applyToTask(task, title, lists, tasks) : null), [task, title, lists, tasks])
  const subParse = useMemo(() => composeTask(subInput, {}, lists, tasks), [subInput, lists, tasks])

  if (!task) return null
  const kids = childrenOf(tasks, id)
  const parents = ancestors(tasks, task)
  const today = todayStr()
  const duration = task.start_at && task.end_at ? minutesBetween(task.start_at, task.end_at) : (task.estimate ?? 60)
  const preset = presetOf(task.rrule)
  const doneKids = kids.filter((k) => k.status === 'done').length
  const sortedLists = Object.values(lists).sort((a, b) => a.sort - b.sort)
  const blockers = (task.blocked_by ?? []).map((b) => tasks[b]).filter(Boolean)
  const holding = dependents(tasks, id).filter((d) => d.status === 'open')
  const family = new Set([...descendantIds(tasks, id), ...parents.map((p) => p.id)])
  const dl = task.deadline ? deadlineState(task.deadline, today) : null

  const saveTitle = () => {
    const t = title.trim()
    if (!t || t === task.title) return setTitle(task.title)
    const a = applyToTask(task, t, lists, tasks)
    if (!a.parsed.tokens.length) return updateTask(id, { title: t })
    const patch = { ...a.patch }
    if (a.newListName) patch.list_id = createList(a.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
    // vorherigen Stand merken, damit „Rückgängig“ alles zurückholt
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, task[k as keyof typeof task]])) as TaskPatch
    updateTask(id, patch)
    setTitle(patch.title ?? task.title)
    showToast(`Erkannt: ${a.labels.join(' · ')}`, 'info', () => updateTask(id, prev))
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
    const c = composeTask(subInput, { parent_id: id, list_id: task.list_id, horizon: task.horizon }, lists, tasks)
    if (!c.patch.title) return
    createTask({ ...c.patch, parent_id: c.patch.parent_id ?? id })
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
          <SmartField
            id="sheet-title"
            ref={titleRef}
            className="title-field"
            value={title}
            onChange={setTitle}
            tokens={titleParse?.parsed.tokens ?? []}
            self={id}
            ariaLabel="Titel"
            onBlur={saveTitle}
            onSubmit={() => titleRef.current?.blur()}
            onCancel={() => {
              setTitle(task.title)
              requestAnimationFrame(() => titleRef.current?.blur())
            }}
          />
          {task.num !== null && <span className="sheet-num" title={`Nummer – z. B. für „warte auf ${task.num}“`}>{task.num}</span>}
        </div>
        {titleParse && titleParse.parsed.tokens.length > 0 && (
          <div className="hint title-hint">
            <TokenChips tokens={titleParse.parsed.tokens} />
            <span className="muted small">Enter übernimmt</span>
          </div>
        )}
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
            <Hourglass /> Frist
          </span>
          <div className="prop-value">
            <input
              type="date"
              value={task.deadline ? deadlineDay(task.deadline) : ''}
              onChange={(e) => {
                const d = e.target.value
                const t = task.deadline ? deadlineTime(task.deadline) : null
                updateTask(id, { deadline: d ? (t ? `${d}T${t}` : d) : null })
              }}
              aria-label="Frist wählen"
            />
            {task.deadline && (
              <input
                type="time"
                step={900}
                value={deadlineTime(task.deadline) ?? ''}
                onChange={(e) => updateTask(id, { deadline: e.target.value ? `${deadlineDay(task.deadline!)}T${e.target.value}` : deadlineDay(task.deadline!) })}
                aria-label="Uhrzeit der Frist"
              />
            )}
            {task.deadline ? (
              <>
                <span className={`chip deadline ${dl}`}>
                  {dl === 'overdue' ? 'abgelaufen' : dl === 'today' ? 'heute' : `noch ${Math.round((Date.parse(deadlineDay(task.deadline)) - Date.parse(today)) / 86_400_000)} Tage`}
                </span>
                <button className="opt" onClick={() => void updateTask(id, { deadline: null })} aria-label="Frist entfernen">
                  <X />
                </button>
              </>
            ) : (
              <span className="muted small">Bis wann muss es spätestens fertig sein?</span>
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
            {!task.start_at && (
              <select value={task.estimate ?? ''} onChange={(e) => updateTask(id, { estimate: e.target.value ? Number(e.target.value) : null })} aria-label="Geschätzte Dauer">
                <option value="">Dauer?</option>
                {!DURATIONS.includes(task.estimate ?? 0) && task.estimate && <option value={task.estimate}>~{durationLabel(task.estimate)}</option>}
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    ~{durationLabel(d)}
                  </option>
                ))}
              </select>
            )}
            {!task.start_at && <span className="muted small">oder im Kalender an eine Stelle ziehen</span>}
            {task.gcal_event_id && (
              <span className="chip time" title="Steht in deinem Google Kalender „Organizer“">
                <CalendarCheck2 /> in Google
              </span>
            )}
            {task.gtask_id && !task.start_at && (
              <span className="chip time" title="Steht in Google unter Aufgaben › Organizer">
                <CalendarCheck2 /> in Google Aufgaben
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
              <SmartField value={subInput} onChange={setSubInput} tokens={subParse.parsed.tokens} placeholder="Unteraufgabe hinzufügen" onSubmit={addSub} onCancel={() => setSubInput('')} className="sub-field" self={id} />
            </div>
            {subParse.parsed.tokens.length > 0 && (
              <div className="hint" style={{ paddingLeft: 34 }}>
                <TokenChips tokens={subParse.parsed.tokens} />
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-label">
            <Lock size={13} /> Wartet auf
            {blockers.length > 0 && <span>{blockers.filter((b) => b.status === 'done').length}/{blockers.length} erledigt</span>}
          </div>
          <div className="subtasks">
            <AnimatePresence initial={false}>
              {blockers.map((b) => (
                <motion.div key={b.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={`subtask blocker ${b.status === 'done' ? 'done' : ''}`}>
                  <Check done={b.status === 'done'} priority={b.priority} onToggle={() => void toggleDone(b.id)} />
                  <button className="s-title" onClick={() => select(b.id)}>
                    {b.title}
                  </button>
                  <button className="icon-btn sm" aria-label={`„${b.title}“ nicht mehr abwarten`} onClick={() => setBlockers(id, task.blocked_by.filter((x) => x !== b.id))}>
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            <div style={{ position: 'relative' }}>
              {picking ? (
                <TaskPicker
                  placeholder="Auf welche Aufgabe wartet das hier?"
                  exclude={(t) => t.id === id || family.has(t.id) || task.blocked_by.includes(t.id) || wouldCycle(tasks, id, t.id)}
                  onPick={(t) => setBlockers(id, [...task.blocked_by, t.id])}
                  onClose={() => setPicking(false)}
                />
              ) : (
                <button className="add-link" onClick={() => setPicking(true)}>
                  <Plus size={15} /> Aufgabe auswählen
                </button>
              )}
            </div>
            {blockers.length === 0 && !picking && <p className="muted small" style={{ margin: '2px 0 0' }}>Solange eine gewählte Aufgabe offen ist, gilt diese als blockiert.</p>}
          </div>
          {holding.length > 0 && (
            <div className="holding">
              <Link2 size={13} /> Hält auf:
              {holding.map((h) => (
                <button key={h.id} className="chip" onClick={() => select(h.id)}>
                  {h.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-foot">
          {tplName !== null ? (
            <form
              className="tpl-form"
              onSubmit={(e) => {
                e.preventDefault()
                saveAsTemplate(id, tplName || task.title)
                setTplName(null)
              }}
            >
              <input autoFocus className="field-input sm" value={tplName} placeholder={task.title} onChange={(e) => setTplName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setTplName(null)} aria-label="Name der Vorlage" />
              <button className="btn sm" type="submit">
                Speichern
              </button>
            </form>
          ) : (
            <>
              <span>Erstellt {new Date(task.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <button className="btn sm ghost" onClick={() => setTplName('')} title="Diese Aufgabe samt Unteraufgaben als Vorlage speichern">
                <LayoutTemplate size={15} /> Als Vorlage
              </button>
            </>
          )}
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
