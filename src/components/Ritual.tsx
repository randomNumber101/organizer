import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, CalendarClock, Check as CheckIcon, Moon, Plus, Sparkles, Sun, X } from 'lucide-react'
import { useStore, eventsFor, type RitualKind } from '../store'
import type { Task } from '../lib/types'
import { addDaysStr, localDayOf, longDayLabel, minutesOfDay, timeLabel, todayStr } from '../lib/dates'
import { haptic } from '../lib/haptics'
import { TaskMeta } from './TaskCard'
import CheckBox from './Check'
import SmartField from './SmartField'
import { PickStep, TimeStep, treeOrder } from './RitualPlan'
import { composeTask } from '../lib/compose'
import { LIST_COLORS } from '../lib/types'

type Step = 'leftover' | 'pick' | 'time' | 'summary' | 'achieved' | 'open' | 'tomorrow'

const PLAN_STEPS: Step[] = ['leftover', 'pick', 'time', 'summary']
const REVIEW_STEPS: Step[] = ['achieved', 'open', 'tomorrow']

const byPrio = (a: Task, b: Task) => a.priority - b.priority || (a.deadline ?? '9').localeCompare(b.deadline ?? '9') || a.sort - b.sort

/** Morgens den Tag planen, abends abschließen – Schritt für Schritt */
export default function Ritual() {
  const kind = useStore((s) => s.ritual)
  const openRitual = useStore((s) => s.openRitual)

  useEffect(() => {
    if (!kind) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) openRitual(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [kind, openRitual])

  return (
    <AnimatePresence>
      {kind && (
        <>
          <motion.div key="r-bd" className="backdrop ritual-bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openRitual(null)} />
          <motion.div
            key="r"
            className="ritual"
            role="dialog"
            aria-label={kind === 'plan' ? 'Tag planen' : 'Tag abschließen'}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <Flow kind={kind} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function useLeftovers(today: string) {
  const tasks = useStore((s) => s.tasks)
  return useMemo(
    () => Object.values(tasks).filter((t) => t.status === 'open' && t.due_date && (t.due_date < today || (t.due_date === today && t.rollover_count > 0))).sort(byPrio),
    [tasks, today],
  )
}

function Flow({ kind }: { kind: RitualKind }) {
  const today = todayStr()
  const leftovers = useLeftovers(today)
  const [steps] = useState<Step[]>(() => (kind === 'plan' ? PLAN_STEPS.filter((s) => s !== 'leftover' || leftovers.length > 0) : REVIEW_STEPS))
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const openRitual = useStore((s) => s.openRitual)
  const finishRitual = useStore((s) => s.finishRitual)
  const loadEvents = useStore((s) => s.loadEvents)
  const step = steps[i]
  const last = i === steps.length - 1

  useEffect(() => {
    void loadEvents(today, addDaysStr(today, 1))
  }, [loadEvents, today])

  const go = (d: number) => {
    setDir(d)
    if (i + d >= steps.length) {
      haptic(15)
      finishRitual(kind)
      return
    }
    setI((x) => Math.max(0, Math.min(steps.length - 1, x + d)))
  }

  const titles: Record<Step, [string, string]> = {
    leftover: ['Was ist liegen geblieben?', 'Entscheide kurz für jede Aufgabe: heute, morgen, später – oder schon erledigt.'],
    pick: ['Was steht heute an?', 'Nimm dir lieber weniger vor. Antippen holt eine Aufgabe auf heute – zuerst das Wichtige, dann Kleinkram.'],
    time: ['Wann machst du was?', 'Bring die Aufgaben in deine Reihenfolge und schätze die Dauer – sie werden nacheinander in die freien Lücken gelegt.'],
    summary: ['Dein Tag steht', ''],
    achieved: ['Das hast du heute geschafft', ''],
    open: ['Was ist noch offen?', 'Schieb es bewusst weiter, statt es einfach liegen zu lassen.'],
    tomorrow: ['Ein Blick auf morgen', ''],
  }

  return (
    <>
      <header className="ritual-head">
        <span className="ritual-icon">{kind === 'plan' ? <Sun size={18} /> : <Moon size={18} />}</span>
        <div className="ritual-kicker">
          {kind === 'plan' ? 'Tag planen' : 'Tag abschließen'} · {longDayLabel(today)}
        </div>
        <span style={{ flex: 1 }} />
        <div className="ritual-dots" aria-hidden>
          {steps.map((s, k) => (
            <motion.i key={s} animate={{ width: k === i ? 18 : 6, opacity: k <= i ? 1 : 0.35 }} transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
          ))}
        </div>
        <button className="icon-btn" aria-label="Schließen" onClick={() => openRitual(null)}>
          <X size={18} />
        </button>
      </header>

      <div className="ritual-body">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -28 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <h2 className="ritual-title">{titles[step][0]}</h2>
            {titles[step][1] && <p className="ritual-lead">{titles[step][1]}</p>}
            {step === 'leftover' && <LeftoverStep today={today} />}
            {step === 'pick' && (
              <PickStep today={today}>
                <RitualQuickAdd day={today} />
              </PickStep>
            )}
            {step === 'time' && <TimeStep today={today} />}
            {step === 'summary' && <SummaryStep today={today} />}
            {step === 'achieved' && <AchievedStep today={today} />}
            {step === 'open' && <OpenStep today={today} />}
            {step === 'tomorrow' && <TomorrowStep today={today} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="ritual-foot">
        {i > 0 ? (
          <button className="btn ghost" onClick={() => go(-1)}>
            <ArrowLeft size={16} /> Zurück
          </button>
        ) : (
          <button className="btn ghost" onClick={() => openRitual(null)}>
            Später
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => go(1)} autoFocus>
          {last ? (kind === 'plan' ? 'Los geht’s' : 'Feierabend') : 'Weiter'}
          {last ? <Sparkles size={16} /> : <ArrowRight size={16} />}
        </button>
      </footer>
    </>
  )
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------
type Decision = 'today' | 'tomorrow' | 'later' | 'done' | null

function DecideRow({ task, options, today, depth = 0, crumb = [] }: { task: Task; options: Exclude<Decision, null>[]; today: string; depth?: number; crumb?: string[] }) {
  const moveToDay = useStore((s) => s.moveToDay)
  const toggleDone = useStore((s) => s.toggleDone)
  const select = useStore((s) => s.select)
  const [picked, setPicked] = useState<Decision>(null)
  const label: Record<Exclude<Decision, null>, string> = { today: 'Heute', tomorrow: 'Morgen', later: 'Später', done: 'Erledigt' }
  const decide = (d: Exclude<Decision, null>) => {
    if (picked === d) return
    haptic(8)
    if (d === 'done') {
      if (task.status === 'open') toggleDone(task.id)
    } else {
      if (picked === 'done' && task.status === 'done') toggleDone(task.id)
      moveToDay(task.id, d === 'today' ? today : d === 'tomorrow' ? addDaysStr(today, 1) : null)
    }
    setPicked(d)
  }
  return (
    <motion.div layout="position" className={`r-row ${picked ? 'decided' : ''} ${picked === 'done' ? 'is-done' : ''} ${depth ? 'nested' : ''}`} style={depth ? { marginLeft: Math.min(depth, 3) * 22 } : undefined}>
      <button className="r-row-main" onClick={() => select(task.id)}>
        {crumb.length > 0 && <span className="r-crumb">{crumb.join(' › ')} ›</span>}
        <span className="r-row-title">{task.title}</span>
        <TaskMeta task={task} showSubs={false} />
      </button>
      <div className="r-choices" role="group" aria-label={`Was passiert mit „${task.title}“?`}>
        {options.map((o) => (
          <button key={o} className={`r-choice ${o} ${picked === o ? 'on' : ''}`} onClick={() => decide(o)}>
            {o === 'done' && <CheckIcon size={14} />}
            {label[o]}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

function LeftoverStep({ today }: { today: string }) {
  const leftovers = useLeftovers(today)
  const [ids] = useState(() => leftovers.map((t) => t.id))
  const tasks = useStore((s) => s.tasks)
  const moveToDay = useStore((s) => s.moveToDay)
  const rows = ids.map((id) => tasks[id]).filter(Boolean)
  return (
    <div className="r-list">
      {treeOrder(tasks, rows).map((r) => (
        <DecideRow key={r.task.id} task={r.task} depth={r.depth} crumb={r.crumb} today={today} options={['done', 'today', 'tomorrow', 'later']} />
      ))}
      {rows.length > 1 && (
        <button className="add-link" onClick={() => rows.forEach((t) => t.status === 'open' && t.due_date !== today && moveToDay(t.id, today))}>
          Alles auf heute
        </button>
      )}
    </div>
  )
}

function RitualQuickAdd({ day }: { day: string }) {
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const [text, setText] = useState('')
  const defaults = useMemo(() => ({ due_date: day }), [day])
  const c = useMemo(() => composeTask(text, defaults, lists, tasks), [text, defaults, lists, tasks])
  const submit = () => {
    if (!c.patch.title) return
    let list_id = c.patch.list_id
    if (c.newListName) list_id = createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
    createTask({ ...c.patch, list_id })
    setText('')
  }
  return (
    <div className="r-quick">
      <Plus size={15} />
      <SmartField value={text} onChange={setText} tokens={c.parsed.tokens} placeholder={day === todayStr() ? 'Noch etwas für heute …' : 'Noch etwas für morgen …'} onSubmit={submit} onCancel={() => setText('')} className="r-quick-field" />
    </div>
  )
}

function SummaryStep({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const todays = Object.values(tasks).filter((t) => t.status === 'open' && t.due_date === today)
  const planned = todays.filter((t) => t.start_at).sort((a, b) => a.start_at!.localeCompare(b.start_at!))
  const mins = planned.reduce((n, t) => n + (t.end_at ? (Date.parse(t.end_at) - Date.parse(t.start_at!)) / 60000 : 0), 0)
  const evs = eventsFor(events, today, today).filter((e) => !e.allDay && localDayOf(e.start) === today)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const next = planned.find((t) => minutesOfDay(t.start_at!) >= nowMin)
  return (
    <div className="r-summary">
      <div className="r-stats">
        <Stat n={todays.length} label={todays.length === 1 ? 'Aufgabe' : 'Aufgaben'} />
        <Stat n={planned.length} label="mit Uhrzeit" />
        <Stat n={evs.length} label={evs.length === 1 ? 'Termin' : 'Termine'} />
        {mins > 0 && <Stat n={Math.round((mins / 60) * 10) / 10} label="Std. verplant" />}
      </div>
      {next && (
        <p className="r-next">
          <CalendarClock size={16} /> Als Nächstes um {timeLabel(next.start_at!)}: <b>{next.title}</b>
        </p>
      )}
      {todays.length > 7 && <p className="muted">Das ist eine Menge. Wenn du magst, geh einen Schritt zurück und schieb etwas auf morgen.</p>}
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <motion.div className="r-stat" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <b>{n}</b>
      <span>{label}</span>
    </motion.div>
  )
}

function AchievedStep({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks)
  const done = Object.values(tasks)
    .filter((t) => t.status === 'done' && t.completed_at && localDayOf(t.completed_at) === today)
    .sort((a, b) => a.completed_at!.localeCompare(b.completed_at!))
  return (
    <div>
      <div className="r-stats">
        <Stat n={done.length} label={done.length === 1 ? 'erledigt' : 'erledigt'} />
      </div>
      {done.length === 0 ? (
        <p className="muted">Heute nichts abgehakt – auch okay. Morgen ist ein neuer Tag.</p>
      ) : (
        <div className="r-list">
          {done.map((t, k) => (
            <motion.div key={t.id} className="r-row compact is-done" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(k, 12) * 0.04 }}>
              <CheckBox done size="small" onToggle={() => undefined} />
              <span className="r-row-title">{t.title}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function OpenStep({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks)
  const moveToDay = useStore((s) => s.moveToDay)
  const [ids] = useState(() =>
    Object.values(tasks)
      .filter((t) => t.status === 'open' && t.due_date && t.due_date <= today)
      .sort(byPrio)
      .map((t) => t.id),
  )
  const rows = ids.map((id) => tasks[id]).filter(Boolean)
  const tomorrow = addDaysStr(today, 1)
  if (rows.length === 0) return <p className="muted">Nichts mehr offen. Stark.</p>
  return (
    <div className="r-list">
      {treeOrder(tasks, rows).map((r) => (
        <DecideRow key={r.task.id} task={r.task} depth={r.depth} crumb={r.crumb} today={today} options={['done', 'tomorrow', 'later']} />
      ))}
      {rows.length > 1 && (
        <button className="add-link" onClick={() => rows.forEach((t) => t.status === 'open' && t.due_date !== tomorrow && moveToDay(t.id, tomorrow))}>
          Alles auf morgen
        </button>
      )}
    </div>
  )
}

function TomorrowStep({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const tomorrow = addDaysStr(today, 1)
  const list = Object.values(tasks)
    .filter((t) => t.status === 'open' && t.due_date === tomorrow)
    .sort((a, b) => (a.start_at ?? '~').localeCompare(b.start_at ?? '~') || byPrio(a, b))
  const deadlines = Object.values(tasks)
    .filter((t) => t.status === 'open' && t.deadline && t.deadline.slice(0, 10) <= addDaysStr(today, 3))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
  const evs = eventsFor(events, tomorrow, tomorrow)
    .filter((e) => (e.allDay ? e.start <= tomorrow && tomorrow < e.end : localDayOf(e.start) === tomorrow))
    .sort((a, b) => a.start.localeCompare(b.start))
  return (
    <div className="r-cols">
      <section>
        <h3 className="r-sub">
          Morgen <span>{list.length}</span>
        </h3>
        <div className="r-list">
          {list.map((t) => (
            <div key={t.id} className="r-row compact">
              <div className="r-row-main">
                <span className="r-row-title">{t.title}</span>
                <TaskMeta task={t} showDate={false} />
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="muted small">Noch nichts für morgen geplant.</p>}
          <RitualQuickAdd day={tomorrow} />
        </div>
      </section>
      <section>
        {evs.length > 0 && (
          <>
            <h3 className="r-sub">
              Termine <span>{evs.length}</span>
            </h3>
            <div className="r-events">
              {evs.map((e) => (
                <div key={`${e.calendarId}|${e.id}`} className="r-event">
                  <i style={{ background: e.color }} />
                  <span className="r-event-time">{e.allDay ? 'ganztägig' : `${timeLabel(e.start)}–${timeLabel(e.end)}`}</span>
                  <span className="r-event-title">{e.title}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {deadlines.length > 0 && (
          <>
            <h3 className="r-sub" style={{ marginTop: evs.length ? 16 : 0 }}>
              Fristen bald
            </h3>
            <div className="r-list">
              {deadlines.map((t) => (
                <div key={t.id} className="r-row compact">
                  <div className="r-row-main">
                    <span className="r-row-title">{t.title}</span>
                    <TaskMeta task={t} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

/** Hinweis-Karte in „Heute“: morgens planen, abends abschließen */
export function RitualBanner() {
  const prefs = useStore((s) => s.prefs)
  const focusDay = useStore((s) => s.focusDay)
  const openRitual = useStore((s) => s.openRitual)
  const [hidden, setHidden] = useState<string | null>(null)
  const today = todayStr()
  const hour = new Date().getHours()
  if (focusDay !== today) return null
  const kind: RitualKind | null = hour >= 17 && prefs.ritual?.reviewed !== today ? 'review' : hour >= 4 && hour < 15 && prefs.ritual?.planned !== today ? 'plan' : null
  if (!kind || hidden === `${kind}:${today}`) return null
  return (
    <motion.div className={`ritual-banner ${kind}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      {kind === 'plan' ? <Sun size={18} /> : <Moon size={18} />}
      <button className="ritual-banner-main" onClick={() => openRitual(kind)}>
        <b>{kind === 'plan' ? 'Tag planen' : 'Tag abschließen'}</b>
        <span>{kind === 'plan' ? '2 Minuten: Reste klären, Fokus wählen, Zeiten setzen' : 'Kurz zurückblicken und Offenes bewusst verschieben'}</span>
      </button>
      <button className="icon-btn sm" aria-label="Ausblenden" onClick={() => setHidden(`${kind}:${today}`)}>
        <X size={15} />
      </button>
    </motion.div>
  )
}
