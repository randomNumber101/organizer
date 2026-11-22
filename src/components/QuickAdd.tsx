import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, CircleHelp, LayoutTemplate, Link2, Plus } from 'lucide-react'
import { useStore } from '../store'
import { composeTask } from '../lib/compose'
import { dayLabel, hhmm, minutesOfDay, todayStr } from '../lib/dates'
import SmartField, { TokenChips } from './SmartField'
import LangHelp from './LangHelp'
import { HORIZON_LABEL, LIST_COLORS } from '../lib/types'
import { useIsMobile } from '../hooks/useMedia'

/** Schnelleingabe (Taste N oder +). Versteht „morgen 14 Uhr !1 #uni @Job“. */
export default function QuickAdd() {
  const qa = useStore((s) => s.quickAdd)
  const close = useStore((s) => s.closeQuickAdd)
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!qa.open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [qa.open, close])
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
  const { defaults, hint, title } = useStore((s) => s.quickAdd)
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const hasTemplates = useStore((s) => Object.keys(s.templates).length > 0)
  const close = useStore((s) => s.closeQuickAdd)
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const openTemplatePicker = useStore((s) => s.openTemplatePicker)
  const [text, setText] = useState(title ?? '')
  const [count, setCount] = useState(0)
  const isOpen = useStore((s) => s.quickAdd.open)
  useEffect(() => {
    if (isOpen) setText(title ?? '')
  }, [isOpen, title])
  const [help, setHelp] = useState(false)
  const c = useMemo(() => composeTask(text, defaults, lists, tasks), [text, defaults, lists, tasks])
  const today = todayStr()
  const p = c.patch
  const kinds = new Set(c.parsed.tokens.map((t) => t.kind))

  const submit = () => {
    if (!p.title) return
    let list_id = p.list_id
    if (c.newListName) list_id = createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
    createTask({ ...p, list_id })
    setText('')
    setCount((n) => n + 1)
    // geteilte Inhalte: nach dem Speichern zu
    if (title) close()
  }

  return (
    <>
      <div className="qa-input">
        <Plus size={20} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <SmartField
          autoFocus
          value={text}
          onChange={setText}
          tokens={c.parsed.tokens}
          placeholder={hint ? `Neue Aufgabe · ${hint}` : 'Neue Aufgabe …'}
          onSubmit={submit}
          onCancel={close}
          className="qa-field"
        />
      </div>
      <div className="qa-chips">
        <TokenChips tokens={c.parsed.tokens} />
        {/* Vorgaben der Stelle, wenn nichts anderes getippt wurde */}
        {!kinds.has('date') && !kinds.has('time') && !kinds.has('repeat') && p.due_date && <span className="chip ctx">{dayLabel(p.due_date, today)}</span>}
        {!kinds.has('time') && p.start_at && p.end_at && (
          <span className="chip ctx">
            <CalendarClock />
            {hhmm(minutesOfDay(p.start_at))}–{hhmm(minutesOfDay(p.end_at))}
          </span>
        )}
        {!kinds.has('list') && !kinds.has('parent') && (
          <span className="chip ctx">
            {p.list_id && lists[p.list_id] ? (
              <>
                <span className="dot" style={{ background: lists[p.list_id].color }} />
                {lists[p.list_id].name}
              </>
            ) : (
              'Unsortiert'
            )}
          </span>
        )}
        {!kinds.has('horizon') && !p.due_date && p.horizon && p.horizon !== 'backlog' && <span className="chip ctx">{HORIZON_LABEL[p.horizon]}</span>}
      </div>
      {defaults.notes && (
        <div className="qa-notes">
          <Link2 size={14} />
          <span>{defaults.notes}</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {help && (
          <motion.div className="qa-help" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <LangHelp compact />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="qa-foot">
        <span className="muted small qa-foot-hint">
          {count > 0 ? (
            `${count} angelegt – einfach weitertippen`
          ) : (
            <>
              <kbd>morgen 14 Uhr</kbd> <kbd>bis fr</kbd> <kbd>warte auf 4</kbd> <kbd>@liste</kbd>
            </>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn sm ghost ${help ? 'on' : ''}`} onClick={() => setHelp((h) => !h)} aria-expanded={help} title="Was die Eingabe versteht">
            <CircleHelp size={15} />
          </button>
          {hasTemplates && !title && (
            <button
              className="btn sm ghost"
              title="Aus Vorlage anlegen"
              onClick={() => {
                close()
                openTemplatePicker(defaults)
              }}
            >
              <LayoutTemplate size={15} /> <span className="desktop-only">Vorlage</span>
            </button>
          )}
          <button className="btn sm ghost desktop-only" onClick={close}>
            Fertig
          </button>
          <button className="btn sm primary" disabled={!p.title} onClick={submit}>
            Hinzufügen
          </button>
        </div>
      </div>
    </>
  )
}
