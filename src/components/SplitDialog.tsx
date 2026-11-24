/**
 * Aufgabe aufteilen (in 2–4 Teile mit Dauer und Tag) oder „Teil erledigt“ (geschaffte Zeit abhaken, Rest später).
 */
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCheck, Scissors, X } from 'lucide-react'
import { useStore, type PartSpec, type RestTarget } from '../store'
import type { Task } from '../lib/types'
import { addDaysStr, dayLabel, todayStr } from '../lib/dates'
import { DURATIONS, minutesText } from '../lib/dayplan'
import { hasParts, isPart, partsOf, remaining } from '../lib/parts'
import Segmented from './Segmented'
import { PartBadge } from './PartBadge'

export default function SplitDialog() {
  const splitFor = useStore((s) => s.splitFor)
  const openSplit = useStore((s) => s.openSplit)
  const close = () => openSplit(null)
  useEffect(() => {
    if (!splitFor) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return (
    <AnimatePresence>
      {splitFor && (
        <motion.div className="qa-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            className="qa split-dlg"
            role="dialog"
            aria-label={splitFor.mode === 'log' ? 'Teil erledigt' : 'Aufgabe aufteilen'}
            initial={{ y: -10, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          >
            <Body key={splitFor.id + splitFor.mode} id={splitFor.id} initialMode={splitFor.mode} minutes={splitFor.minutes} onClose={close} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Body({ id, initialMode, minutes, onClose }: { id: string; initialMode: 'split' | 'log'; minutes?: number; onClose: () => void }) {
  const tasks = useStore((s) => s.tasks)
  const [mode, setMode] = useState(initialMode)
  // bei einer schon aufgeteilten Aufgabe arbeiten wir am ersten offenen Teil
  const task: Task | undefined = useMemo(() => {
    const t = tasks[id]
    if (t && !isPart(t) && hasParts(tasks, t.id)) return partsOf(tasks, t.id).find((p) => p.status === 'open') ?? t
    return t
  }, [tasks, id])
  if (!task) return null
  return (
    <div className="split-body">
      <div className="split-head">
        <Segmented
          group="split-mode"
          value={mode}
          onChange={(v) => setMode(v as 'split' | 'log')}
          options={[
            { value: 'log', label: 'Teil erledigt', icon: <CheckCheck /> },
            { value: 'split', label: 'Aufteilen', icon: <Scissors /> },
          ]}
        />
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="split-task">
        <b>{task.title}</b>
        {isPart(task) && <PartBadge task={task} />}
        {task.estimate ? <span className="muted small">geschätzt {minutesText(task.estimate)}</span> : <span className="muted small">ohne Schätzung</span>}
      </div>
      {mode === 'log' ? <LogForm task={task} preset={minutes} onDone={onClose} /> : <SplitForm task={task} onDone={onClose} />}
    </div>
  )
}

const WORKED = [15, 30, 45, 60, 90, 120]

function LogForm({ task, preset, onDone }: { task: Task; preset?: number; onDone: () => void }) {
  const logWork = useStore((s) => s.logWork)
  const today = todayStr()
  const [worked, setWorked] = useState<number>(preset && preset > 0 ? preset : task.estimate && task.estimate >= 30 ? Math.round(task.estimate / 2 / 5) * 5 : 30)
  const [rest, setRest] = useState<'keep' | 'later' | 'tomorrow' | 'none' | 'date'>('keep')
  const [date, setDate] = useState(addDaysStr(today, 2))
  const rem = remaining(task.estimate, worked)
  const choices = WORKED.filter((m) => !task.estimate || m < task.estimate)
  const target: RestTarget = rest === 'date' ? { date } : rest
  const submit = () => {
    if (!worked || worked < 1) return
    logWork(task.id, worked, target)
    onDone()
  }
  return (
    <div className="split-form">
      <label className="split-label">Wie lange hast du daran gearbeitet?</label>
      <div className="split-chips">
        {choices.map((m) => (
          <button key={m} className={`opt ${worked === m ? 'on' : ''}`} onClick={() => setWorked(m)}>
            {minutesText(m)}
          </button>
        ))}
        <span className="split-custom">
          <input className="field-input" type="number" min={1} max={1440} step={5} value={worked} onChange={(e) => setWorked(Math.max(0, Number(e.target.value)))} aria-label="Minuten" />
          min
        </span>
      </div>
      <p className="split-rest">
        {rem === null ? 'Der Rest bleibt als nächster Teil.' : rem === 0 ? 'Damit ist die Aufgabe fertig.' : <>Bleiben noch <b>~{minutesText(rem)}</b> – als nächster Teil.</>}
      </p>
      {rem !== 0 && (
        <>
          <label className="split-label">Den Rest machst du …</label>
          <div className="split-chips">
            {(
              [
                ['keep', 'an derselben Stelle'],
                ['later', 'später heute'],
                ['tomorrow', 'morgen'],
                ['date', 'an einem Tag …'],
                ['none', 'irgendwann'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={`opt ${rest === v ? 'on' : ''}`} onClick={() => setRest(v)}>
                {l}
              </button>
            ))}
            {rest === 'date' && <input className="field-input" type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tag für den Rest" />}
          </div>
        </>
      )}
      <div className="split-actions">
        <button className="btn primary" onClick={submit} disabled={!worked}>
          <CheckCheck size={15} /> {rem === 0 ? 'Erledigt' : `${minutesText(worked)} abhaken`}
        </button>
      </div>
    </div>
  )
}

type DayChoice = 'keep' | 'none' | 'date' | string // string = YYYY-MM-DD

function SplitForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const splitTask = useStore((s) => s.splitTask)
  const today = todayStr()
  const [count, setCount] = useState(2)
  const total = task.estimate
  const even = (n: number): (number | null)[] => {
    if (!total) return Array(n).fill(null)
    const each = Math.max(5, Math.round(total / n / 5) * 5)
    const arr = Array(n).fill(each) as number[]
    arr[n - 1] = Math.max(5, total - each * (n - 1))
    return arr
  }
  const defaultDays = (n: number): DayChoice[] => Array.from({ length: n }, (_, i) => (i === 0 ? 'keep' : task.due_date ? addDaysStr(task.due_date < today ? today : task.due_date, i) : 'none'))
  const [mins, setMins] = useState<(number | null)[]>(() => even(2))
  const [days, setDays] = useState<DayChoice[]>(() => defaultDays(2))
  const [custom, setCustom] = useState<string[]>(() => Array(4).fill(addDaysStr(today, 1)))
  const changeCount = (n: number) => {
    setCount(n)
    setMins(even(n))
    setDays(defaultDays(n))
  }
  const dayOptions = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(today, i)), [today])
  const sum = mins.reduce<number>((n, m) => n + (m ?? 0), 0)
  const submit = () => {
    const specs: PartSpec[] = mins.map((m, i) => {
      const d = days[i]
      if (d === 'keep') return { estimate: m, place: { due_date: task.due_date, start_at: task.start_at, end_at: task.end_at, timezone: task.timezone, day_order: task.day_order } }
      if (d === 'none') return { estimate: m, place: { due_date: null } }
      if (d === 'date') return { estimate: m, place: { due_date: custom[i] } }
      return { estimate: m, place: { due_date: d } }
    })
    splitTask(task.id, specs)
    onDone()
  }
  return (
    <div className="split-form">
      <label className="split-label">In wie viele Teile?</label>
      <div className="split-chips">
        {[2, 3, 4].map((n) => (
          <button key={n} className={`opt ${count === n ? 'on' : ''}`} onClick={() => changeCount(n)}>
            {n} Teile
          </button>
        ))}
      </div>
      <div className="split-parts">
        {mins.map((m, i) => (
          <div key={i} className="split-part">
            <span className="split-part-no">Teil {i + 1}</span>
            <select
              className="field-input"
              value={m ?? ''}
              aria-label={`Dauer Teil ${i + 1}`}
              onChange={(e) => setMins((arr) => arr.map((x, k) => (k === i ? (e.target.value ? Number(e.target.value) : null) : x)))}
            >
              <option value="">– Dauer –</option>
              {m && !DURATIONS.some(([d]) => d === m) && <option value={m}>{minutesText(m)}</option>}
              {[...DURATIONS, [45, '45 min'] as [number, string], [90, '1,5 h'] as [number, string], [180, '3 h'] as [number, string]]
                .sort((a, b) => a[0] - b[0])
                .map(([d, l]) => (
                  <option key={d} value={d}>
                    {l}
                  </option>
                ))}
            </select>
            <select className="field-input" value={days[i]} aria-label={`Tag Teil ${i + 1}`} onChange={(e) => setDays((arr) => arr.map((x, k) => (k === i ? e.target.value : x)))}>
              {i === 0 && <option value="keep">{task.due_date ? `wie bisher (${dayLabel(task.due_date)})` : 'wie bisher (ohne Tag)'}</option>}
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
              {days[i] !== 'keep' && days[i] !== 'none' && days[i] !== 'date' && !dayOptions.includes(days[i]) && <option value={days[i]}>{dayLabel(days[i])}</option>}
              <option value="date">anderer Tag …</option>
              <option value="none">irgendwann</option>
            </select>
            {days[i] === 'date' && (
              <input className="field-input" type="date" value={custom[i]} min={today} onChange={(e) => e.target.value && setCustom((arr) => arr.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Datum Teil ${i + 1}`} />
            )}
          </div>
        ))}
      </div>
      {sum > 0 && (
        <p className="split-rest">
          zusammen {minutesText(sum)}
          {total && sum !== total ? ` (vorher ${minutesText(total)})` : ''}
        </p>
      )}
      <div className="split-actions">
        <button className="btn primary" onClick={submit}>
          <Scissors size={15} /> In {count} Teile aufteilen
        </button>
      </div>
    </div>
  )
}
