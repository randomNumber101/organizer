/**
 * „Als Nächstes“: die nächste Aufgabe groß, mit Fokus-Timer.
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check as CheckIcon, Pause, Play, Plus, SkipForward, Square, Timer } from 'lucide-react'
import { useStore, type Focus } from '../store'
import type { Task } from '../lib/types'
import { minutesText, nextUp } from '../lib/dayplan'
import { ancestors } from '../lib/tree'
import { haptic } from '../lib/haptics'
import Check from './Check'
import { SubList, TaskMeta } from './TaskCard'

/** jede Sekunde neu zeichnen, solange aktiv */
function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

const leftMs = (f: Focus) => (f.endsAt !== null ? f.endsAt - Date.now() : (f.left ?? 0))
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function FocusCard({ rows, total }: { rows: Task[]; total: number }) {
  const tasks = useStore((s) => s.tasks)
  const focus = useStore((s) => s.focus)
  const { startFocus, pauseFocus, resumeFocus, extendFocus, stopFocus, toggleDone, setDayOrder, select } = useStore.getState()
  const focused = focus && tasks[focus.id]?.status === 'open' ? tasks[focus.id] : null
  const task = focused ?? nextUp(rows)
  useTick(!!focus && focus.endsAt !== null)

  if (!task) return null
  const onThis = !!focus && focus.id === task.id
  const running = onThis && focus!.endsAt !== null
  const left = onThis ? leftMs(focus!) : 0
  const over = onThis && left <= 0
  const pos = rows.findIndex((t) => t.id === task.id)
  const crumb = ancestors(tasks, task)
  const minutes = task.estimate ?? 25
  const hasKids = Object.values(tasks).some((k) => k.parent_id === task.id)

  const later = () => {
    haptic(8)
    if (onThis) stopFocus()
    const ids = rows.map((t) => t.id).filter((id) => id !== task.id)
    setDayOrder([...ids, task.id], task.id)
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.section
        key={task.id}
        className={`focus-card ${onThis ? 'on' : ''} ${over ? 'over' : ''}`}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -14, scale: 0.98, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        aria-label="Als Nächstes"
      >
        <div className="focus-top">
          <span className="focus-label">
            {onThis ? (
              <>
                <Timer size={13} /> {over ? 'Zeit um' : running ? 'Fokus läuft' : 'Pausiert'}
              </>
            ) : (
              'Als Nächstes'
            )}
          </span>
          {pos >= 0 && (
            <span className="focus-pos">
              {pos + 1} von {total}
            </span>
          )}
        </div>
        <div className="focus-body">
          <Check done={false} priority={task.priority} size="big" onToggle={() => toggleDone(task.id)} />
          <div className="focus-main">
            {crumb.length > 0 && <span className="card-crumb">{crumb.map((c) => c.title).join(' › ')} ›</span>}
            <h2 className="focus-title" onClick={() => select(task.id)}>
              {task.title}
            </h2>
            <TaskMeta task={task} showDate={false} showSubs={false} showEstimate={false} />
            {hasKids && <SubList task={task} />}
          </div>
          {onThis && <TimerRing focus={focus!} />}
        </div>
        <div className="focus-actions">
          {!onThis && (
            <button className="btn primary" onClick={() => (haptic(10), startFocus(task.id, minutes))}>
              <Play size={15} /> Fokus · {minutesText(minutes)}
            </button>
          )}
          {onThis && over && (
            <button className="btn primary" onClick={() => toggleDone(task.id)}>
              <CheckIcon size={15} /> Erledigt
            </button>
          )}
          {onThis && !over && running && (
            <button className="btn" onClick={pauseFocus}>
              <Pause size={15} /> Pause
            </button>
          )}
          {onThis && !over && !running && (
            <button className="btn primary" onClick={resumeFocus}>
              <Play size={15} /> Weiter
            </button>
          )}
          {onThis && (
            <button className="btn ghost" onClick={() => extendFocus(5)}>
              <Plus size={15} /> 5 min
            </button>
          )}
          <span style={{ flex: 1 }} />
          {onThis && (
            <button className="btn ghost" onClick={stopFocus} title="Timer beenden">
              <Square size={14} /> Stopp
            </button>
          )}
          {!onThis && rows.length > 1 && (
            <button className="btn ghost" onClick={later} title="Ans Ende der Reihenfolge">
              <SkipForward size={15} /> Später
            </button>
          )}
        </div>
        {onThis && <div className="focus-progress" style={{ width: `${Math.min(100, (1 - left / (focus!.minutes * 60_000)) * 100)}%` }} />}
        <span className="sr-only">{clock(left)}</span>
      </motion.section>
    </AnimatePresence>
  )
}

function TimerRing({ focus }: { focus: Focus }) {
  const left = leftMs(focus)
  const total = focus.minutes * 60_000
  const p = Math.min(1, Math.max(0, 1 - left / total))
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div className={`timer-ring ${left <= 0 ? 'over' : ''}`} aria-label={`Noch ${clock(left)}`}>
      <svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r={r} className="track" />
        <circle cx="36" cy="36" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <b>{left > 0 ? clock(left) : '0:00'}</b>
    </div>
  )
}

/** Läuft im Hintergrund: meldet, wenn die Fokuszeit vorbei ist (auch in anderen Ansichten) */
export function FocusWatcher() {
  const focus = useStore((s) => s.focus)
  const done = useRef<string | null>(null)
  useTick(!!focus && focus.endsAt !== null)
  useEffect(() => {
    if (!focus || focus.endsAt === null) return
    const key = `${focus.id}:${focus.endsAt}`
    if (focus.endsAt > Date.now() || done.current === key) return
    done.current = key
    const st = useStore.getState()
    const title = st.tasks[focus.id]?.title ?? 'Aufgabe'
    haptic([30, 60, 30])
    st.showToast(`Zeit für „${title}“ ist um – erledigt? Sonst „+5 min“.`)
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker?.ready.then((r) => r.showNotification('Fokuszeit vorbei', { body: title, tag: 'focus', icon: '/icons/icon-192.png', data: { url: '/?view=today' } }))
    }
  })
  return null
}

/** Kleiner Hinweis oben, wenn ein Fokus läuft */
export function FocusPill() {
  const focus = useStore((s) => s.focus)
  const task = useStore((s) => (s.focus ? s.tasks[s.focus.id] : undefined))
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  useTick(!!focus && focus.endsAt !== null)
  if (!focus || !task || view === 'today') return null
  const left = leftMs(focus)
  return (
    <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={`focus-pill ${left <= 0 ? 'over' : ''} ${focus.endsAt === null ? 'paused' : ''}`} onClick={() => setView('today')} title={task.title}>
      <Timer size={13} />
      <b>{left > 0 ? clock(left) : 'Zeit um'}</b>
      <span>{task.title}</span>
    </motion.button>
  )
}
