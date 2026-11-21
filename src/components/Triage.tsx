import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check as CheckIcon, SkipForward, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { addDaysStr, nextWeekdayStr, todayStr } from '../lib/dates'
import { TaskMeta } from './TaskCard'

type Fly = 'right' | 'left' | 'up' | 'down'

/**
 * Den Stapel „Unsortiert“ abarbeiten: eine Karte nach der anderen einer Liste zuordnen,
 * optional mit Datum. Tastatur: 1–9 Liste, H heute, M morgen, Leertaste überspringen, E erledigt, Entf löschen.
 */
export default function Triage() {
  const open = useStore((s) => s.triageOpen)
  const setTriage = useStore((s) => s.setTriage)
  return <AnimatePresence>{open && <TriageInner onClose={() => setTriage(false)} />}</AnimatePresence>
}

function TriageInner({ onClose }: { onClose: () => void }) {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const updateTask = useStore((s) => s.updateTask)
  const toggleDone = useStore((s) => s.toggleDone)
  const deleteTask = useStore((s) => s.deleteTask)
  const [skipped, setSkipped] = useState<string[]>([])
  const [date, setDate] = useState<string | null>(null)
  const [fly, setFly] = useState<Fly>('right')
  const [handled, setHandled] = useState(0)

  const stack = useMemo(
    () =>
      Object.values(tasks)
        .filter((t) => t.status === 'open' && !t.parent_id && !t.list_id && !skipped.includes(t.id))
        .sort((a, b) => a.sort - b.sort),
    [tasks, skipped],
  )
  const total = stack.length + handled
  const current = stack[0]
  const sortedLists = Object.values(lists)
    .filter((l) => !l.archived)
    .sort((a, b) => a.sort - b.sort)
  const today = todayStr()
  const dateOpts: [string, string, string][] = [
    ['Heute', today, 'h'],
    ['Morgen', addDaysStr(today, 1), 'm'],
    ['Wochenende', nextWeekdayStr(today, 6), 'w'],
    ['Nächste Woche', nextWeekdayStr(today, 1), 'n'],
  ]

  const next = (dir: Fly) => {
    setFly(dir)
    setDate(null)
    setHandled((h) => h + 1)
  }

  const assign = (listId: string) => {
    if (!current) return
    void updateTask(current.id, { list_id: listId, ...(date ? { due_date: date } : {}) })
    next('right')
  }
  const skip = () => {
    if (!current) return
    if (date) void updateTask(current.id, { due_date: date })
    setFly('down')
    setDate(null)
    setSkipped((s) => [...s, current.id])
  }
  const done = () => {
    if (!current) return
    void toggleDone(current.id)
    next('up')
  }
  const remove = () => {
    if (!current) return
    void deleteTask(current.id)
    next('left')
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Escape') return onClose()
      if (!current) return
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && sortedLists[n - 1]) return assign(sortedLists[n - 1].id)
      const d = dateOpts.find(([, , k]) => k === e.key.toLowerCase())
      if (d) return setDate((cur) => (cur === d[1] ? null : d[1]))
      if (e.key === ' ') {
        e.preventDefault()
        skip()
      }
      if (e.key.toLowerCase() === 'e') done()
      if (e.key === 'Delete' || e.key === 'Backspace') remove()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const variants = {
    enter: { scale: 0.94, y: 18, opacity: 0 },
    center: { scale: 1, y: 0, opacity: 1, rotate: 0, x: 0 },
    exit: (dir: Fly) => ({
      x: dir === 'right' ? 380 : dir === 'left' ? -380 : 0,
      y: dir === 'up' ? -260 : dir === 'down' ? 120 : 0,
      rotate: dir === 'right' ? 10 : dir === 'left' ? -10 : 0,
      opacity: 0,
      transition: { duration: 0.32, ease: [0.4, 0, 0.6, 1] as const },
    }),
  }

  return (
    <motion.div className="triage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="triage-inner">
        <div className="triage-top">
          <h2>Unsortiert einsortieren</h2>
          {current && (
            <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.min(handled + 1, total)} von {total}
            </span>
          )}
          <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {current ? (
          <>
            <div className="stack">
              {stack.slice(1, 3).map((t, i) => (
                <motion.div
                  key={t.id}
                  className="stack-card"
                  animate={{ y: (i + 1) * 9, scale: 1 - (i + 1) * 0.04, opacity: 1 - (i + 1) * 0.25 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  style={{ zIndex: 2 - i }}
                  aria-hidden
                />
              ))}
              <AnimatePresence custom={fly} initial={false} mode="popLayout">
                <motion.div key={current.id} className="stack-card" custom={fly} variants={variants} initial="enter" animate="center" exit="exit" style={{ zIndex: 5 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
                  <div className="s-title">{current.title}</div>
                  {current.notes && <div className="s-notes">{current.notes}</div>}
                  <div className="s-meta">
                    <TaskMeta task={current} />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="triage-row">
              <span className="label">Wann? (optional)</span>
              {dateOpts.map(([label, d, k]) => (
                <button key={label} className={`opt ${date === d ? 'on' : ''}`} onClick={() => setDate((cur) => (cur === d ? null : d))}>
                  {label} <kbd>{k.toUpperCase()}</kbd>
                </button>
              ))}
            </div>

            <div className="triage-row">
              <span className="label">In welche Liste?</span>
              {sortedLists.length === 0 && <span className="muted small">Leg im Board erst eine Liste an (rechts „Neue Liste“).</span>}
              {sortedLists.map((l, i) => (
                <button key={l.id} className="list-btn" style={{ ['--lc' as string]: l.color }} onClick={() => assign(l.id)}>
                  <span className="dot" style={{ background: l.color, width: 10, height: 10 }} />
                  {l.name}
                  {i < 9 && <kbd>{i + 1}</kbd>}
                </button>
              ))}
            </div>

            <div className="triage-row" style={{ justifyContent: 'space-between' }}>
              <button className="btn ghost" onClick={skip}>
                <SkipForward size={16} /> Später <kbd>␣</kbd>
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn ghost" onClick={done}>
                  <CheckIcon size={16} /> Erledigt <kbd>E</kbd>
                </button>
                <button className="btn ghost danger" onClick={remove}>
                  <Trash2 size={16} /> Löschen
                </button>
              </div>
            </div>
          </>
        ) : (
          <motion.div className="triage-done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <h3>Stapel leer.</h3>
            <p className="muted" style={{ margin: '8px 0 18px' }}>{handled > 0 ? `${handled} Aufgaben einsortiert.` : 'Hier liegt nichts Unsortiertes.'}</p>
            <button className="btn primary" onClick={onClose}>
              Zurück zum Board
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
