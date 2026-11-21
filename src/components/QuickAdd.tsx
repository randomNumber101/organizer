import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, Plus } from 'lucide-react'
import { useStore } from '../store'
import { composeTask } from '../lib/compose'
import { dayLabel, hhmm, minutesOfDay, todayStr } from '../lib/dates'
import { HORIZON_LABEL, LIST_COLORS, PRIORITY_LABEL } from '../lib/types'
import { useIsMobile } from '../hooks/useMedia'

/** Schnelleingabe (Taste N oder +). Versteht „morgen 14 Uhr !1 #uni @Job“. */
export default function QuickAdd() {
  const qa = useStore((s) => s.quickAdd)
  const close = useStore((s) => s.closeQuickAdd)
  const isMobile = useIsMobile()
  return (
    <AnimatePresence>
      {qa.open && (
        <motion.div className="qa-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            className="qa"
            initial={isMobile ? { y: '100%' } : { y: -10, opacity: 0, scale: 0.98 }}
            animate={isMobile ? { y: 0 } : { y: 0, opacity: 1, scale: 1 }}
            exit={isMobile ? { y: '100%' } : { y: -10, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          >
            <QuickAddForm />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function QuickAddForm() {
  const { defaults, hint } = useStore((s) => s.quickAdd)
  const lists = useStore((s) => s.lists)
  const close = useStore((s) => s.closeQuickAdd)
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const [text, setText] = useState('')
  const [count, setCount] = useState(0)
  const c = useMemo(() => composeTask(text, defaults, lists), [text, defaults, lists])
  const today = todayStr()
  const p = c.patch

  const submit = async () => {
    if (!p.title) return
    let list_id = p.list_id
    if (c.newListName) list_id = (await createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]))?.id ?? null
    void createTask({ ...p, list_id })
    setText('')
    setCount((n) => n + 1)
  }

  return (
    <>
      <div className="qa-input">
        <Plus size={20} style={{ color: 'var(--accent)' }} />
        <input
          autoFocus
          value={text}
          placeholder={hint ? `Neue Aufgabe · ${hint}` : 'Neue Aufgabe …'}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') close()
          }}
        />
      </div>
      <div className="qa-chips">
        {p.due_date && <span className="chip today">{dayLabel(p.due_date, today)}</span>}
        {p.start_at && p.end_at && (
          <span className="chip time">
            <CalendarClock />
            {hhmm(minutesOfDay(p.start_at))}–{hhmm(minutesOfDay(p.end_at))}
          </span>
        )}
        {p.priority && p.priority < 4 && <span className="chip">{PRIORITY_LABEL[p.priority]}</span>}
        {p.list_id && lists[p.list_id] && (
          <span className="chip">
            <span className="dot" style={{ background: lists[p.list_id].color }} />
            {lists[p.list_id].name}
          </span>
        )}
        {c.newListName && <span className="chip">neue Liste „{c.newListName}“</span>}
        {!p.due_date && p.horizon && p.horizon !== 'backlog' && <span className="chip">{HORIZON_LABEL[p.horizon]}</span>}
        {!p.list_id && !c.newListName && <span className="chip">Unsortiert</span>}
        {(p.tags ?? []).map((t) => (
          <span key={t} className="chip tag">
            #{t}
          </span>
        ))}
      </div>
      <div className="qa-foot">
        <span className="muted small">
          {count > 0 ? `${count} angelegt – einfach weitertippen` : (
            <>
              <kbd>morgen</kbd> <kbd>14 Uhr</kbd> <kbd>!1</kbd> <kbd>#tag</kbd> <kbd>@liste</kbd>
            </>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm ghost" onClick={close}>
            Fertig
          </button>
          <button className="btn sm primary" disabled={!p.title} onClick={() => void submit()}>
            Hinzufügen
          </button>
        </div>
      </div>
    </>
  )
}
