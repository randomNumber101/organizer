import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Columns3,
  CornerDownLeft,
  Eye,
  Filter,
  Inbox,
  LayoutList,
  LayoutTemplate,
  ListChecks,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  SunMedium,
} from 'lucide-react'
import { useStore } from '../store'
import { composeTask } from '../lib/compose'
import { LIST_COLORS } from '../lib/types'
import { ancestors } from '../lib/tree'
import { todayStr } from '../lib/dates'

interface Item {
  id: string
  group: 'Neu' | 'Aktionen' | 'Ansichten' | 'Listen' | 'Vorlagen' | 'Aufgaben'
  label: string
  sub?: string
  icon: React.ReactNode
  keywords?: string
  run: () => void
}

/** Grobe, aber robuste Ähnlichkeit: alle Wörter müssen vorkommen; Wortanfänge zählen mehr */
function score(text: string, q: string): number {
  const t = text.toLowerCase()
  let total = 0
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(w)
    if (i < 0) return -1
    total += i === 0 ? 30 : /\s|[-_/›(]/.test(t[i - 1]) ? 20 : 8
  }
  return total
}

/** Strg/Cmd + K: alles schnell erreichen – Aktionen, Aufgaben, Listen, Vorlagen, Ansichten */
export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const seq = useStore((s) => s.paletteSeq)
  const setPalette = useStore((s) => s.setPalette)
  return (
    <AnimatePresence>
      {open && (
        <motion.div key={seq} className="qa-wrap palette-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
          <motion.div
            className="palette"
            role="dialog"
            aria-label="Befehle"
            initial={{ y: -12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          >
            <PaletteBody />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PaletteBody() {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const templates = useStore((s) => s.templates)
  const prefs = useStore((s) => s.prefs)
  const showSubtasks = useStore((s) => s.showSubtasks)
  const google = useStore((s) => s.google)
  const st = useStore.getState
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => st().setPalette(false)
  const jumpToList = (id: string) => {
    st().setView('board')
    st().setBoardMode('lists')
    setTimeout(() => {
      const el = document.querySelector(`[data-col="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1200)
    }, 120)
  }

  const items = useMemo<Item[]>(() => {
    const s = st()
    const actions: Item[] = [
      { id: 'a:new', group: 'Aktionen', label: 'Neue Aufgabe', icon: <Plus />, keywords: 'anlegen erstellen hinzufügen', run: () => s.openQuickAdd(s.view === 'today' ? { due_date: s.focusDay } : {}) },
      { id: 'a:plan', group: 'Aktionen', label: 'Tag planen', sub: 'Reste klären, Aufgaben wählen, Reihenfolge festlegen', icon: <Sun />, keywords: 'morgen ritual', run: () => s.openRitual('plan') },
      { id: 'a:review', group: 'Aktionen', label: 'Tag abschließen', sub: 'Rückblick und Offenes verschieben', icon: <Moon />, keywords: 'abend ritual review', run: () => s.openRitual('review') },
      { id: 'a:triage', group: 'Aktionen', label: 'Unsortiert einsortieren', icon: <Inbox />, keywords: 'triage inbox', run: () => s.setTriage(true) },
      { id: 'a:tpl', group: 'Aktionen', label: 'Aus Vorlage anlegen …', icon: <LayoutTemplate />, keywords: 'template', run: () => s.openTemplatePicker({}) },
      { id: 'a:board', group: 'Aktionen', label: 'Zum Board', icon: <Columns3 />, keywords: 'listen kanban 1', run: () => s.setView('board') },
      { id: 'a:week', group: 'Aktionen', label: 'Wochenplanung', icon: <LayoutList />, keywords: 'woche board', run: () => (s.setView('board'), s.setBoardMode('week')) },
      { id: 'a:today', group: 'Aktionen', label: 'Zu Heute', icon: <SunMedium />, keywords: 'planer tag 2', run: () => (s.setView('today'), s.setFocusDay(todayStr())) },
      { id: 'a:cal', group: 'Aktionen', label: 'Zum Kalender', icon: <CalendarDays />, keywords: 'woche termine 3', run: () => s.setView('calendar') },
      { id: 'a:filter', group: 'Aktionen', label: 'Filter …', icon: <Filter />, keywords: 'tags priorität liste', run: () => (s.view === 'calendar' && s.setView('board'), s.setFilterOpen(true)) },
      { id: 'a:subs', group: 'Aktionen', label: showSubtasks ? 'Unteraufgaben auf Karten ausblenden' : 'Unteraufgaben auf Karten zeigen', icon: <ListChecks />, run: () => s.setShowSubtasks(!showSubtasks) },
      { id: 'a:settings', group: 'Aktionen', label: 'Einstellungen', icon: <Settings />, keywords: 'google push erinnerungen', run: () => s.setSettings(true) },
    ]
    if (google?.connected) actions.push({ id: 'a:gsync', group: 'Aktionen', label: 'Google Kalender jetzt abgleichen', icon: <RefreshCw />, run: () => void s.refreshGoogle() })
    const views: Item[] = [
      ...(prefs.views ?? []).map<Item>((v) => ({ id: `v:${v.id}`, group: 'Ansichten', label: v.name, icon: <Eye />, keywords: 'ansicht filter', run: () => (s.view === 'calendar' && s.setView('board'), s.applyView(v.id)) })),
    ]
    const listItems: Item[] = Object.values(lists)
      .filter((l) => !l.archived)
      .sort((a, b) => a.sort - b.sort)
      .map((l) => ({ id: `l:${l.id}`, group: 'Listen', label: l.name, icon: <span className="dot" style={{ background: l.color }} />, keywords: 'liste spalte', run: () => jumpToList(l.id) }))
    listItems.unshift({ id: 'l:inbox', group: 'Listen', label: 'Unsortiert', icon: <Inbox />, keywords: 'liste inbox', run: () => jumpToList('inbox') })
    const tpl: Item[] = Object.values(templates).map((t) => ({ id: `t:${t.id}`, group: 'Vorlagen', label: t.name, sub: 'Vorlage anlegen', icon: <LayoutTemplate />, keywords: 'vorlage template', run: () => s.useTemplate(t.id, {}) }))
    const taskItems: Item[] = Object.values(tasks)
      .filter((t) => t.status === 'open' || (t.completed_at && Date.now() - Date.parse(t.completed_at) < 7 * 86_400_000))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((t) => {
        const path = ancestors(tasks, t).map((p) => p.title)
        const list = t.list_id ? lists[t.list_id]?.name : 'Unsortiert'
        return {
          id: `k:${t.id}`,
          group: 'Aufgaben' as const,
          label: t.title,
          sub: [t.num ? `Nr. ${t.num}` : null, list, ...path].filter(Boolean).join(' › '),
          icon: t.status === 'done' ? <CheckCircle2 /> : <Circle />,
          keywords: `${t.tags.map((x) => `#${x}`).join(' ')} ${t.notes ?? ''}`,
          run: () => s.select(t.id),
        }
      })
    return [...actions, ...views, ...listItems, ...tpl, ...taskItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, lists, templates, prefs.views, showSubtasks, google?.connected])

  const results = useMemo(() => {
    const query = q.trim()
    if (!query) {
      // ohne Eingabe: Aktionen, gespeicherte Ansichten, zuletzt geänderte Aufgaben
      return [...items.filter((i) => i.group === 'Aktionen' || i.group === 'Ansichten'), ...items.filter((i) => i.group === 'Aufgaben').slice(0, 6)]
    }
    const words = query.split(/\s+/).filter(Boolean).length
    const scored = items
      .map((i) => {
        const main = score(i.label, query)
        const extra = main < 0 ? score(`${i.label} ${i.sub ?? ''} ${i.keywords ?? ''}`, query) : -1
        const sc = main >= 0 ? main + 10 : extra
        // Befehle/Listen/Vorlagen, bei denen jedes Wort am Wortanfang passt, kommen vor „anlegen“
        const strong = i.group !== 'Aufgaben' && main >= 20 * words
        return { i, sc, strong }
      })
      .filter((x) => x.sc >= 0)
    const groupBonus: Record<Item['group'], number> = { Neu: 0, Aktionen: 6, Ansichten: 5, Listen: 4, Vorlagen: 3, Aufgaben: 0 }
    scored.sort((a, b) => b.sc + groupBonus[b.i.group] - (a.sc + groupBonus[a.i.group]))
    const s = st()
    const c = composeTask(query, s.view === 'today' ? { due_date: s.focusDay } : {}, lists, tasks)
    const create: Item = {
      id: 'new',
      group: 'Neu',
      label: `„${c.patch.title || query}“ anlegen`,
      sub: c.parsed.tokens.length ? c.parsed.tokens.map((t) => t.label).join(' · ') : 'Neue Aufgabe · versteht z. B. morgen 14 Uhr, bis fr, warte auf 4, @liste',
      icon: <Plus />,
      run: () => {
        let list_id = c.patch.list_id
        if (c.newListName) list_id = s.createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
        const t = s.createTask({ ...c.patch, list_id })
        s.showToast(`„${t.title}“ angelegt`)
      },
    }
    const top = scored.slice(0, 40)
    // „4“, „nr 4“, „#4“: Aufgabe mit dieser Nummer zuerst
    const numQ = /^(?:nr\.?\s*|#|task\s*)?(\d+)$/i.exec(query)?.[1]
    const byNum = numQ ? Object.values(tasks).find((t) => String(t.num) === numQ) : undefined
    if (byNum) {
      const it = items.find((i) => i.id === `k:${byNum.id}`)
      if (it) return [it, create, ...top.map((x) => x.i).filter((i) => i !== it)]
    }
    const exactTask = top.find((x) => x.i.group === 'Aufgaben' && x.i.label.toLowerCase() === query.toLowerCase())
    return [...top.filter((x) => x.strong).map((x) => x.i), ...(exactTask ? [exactTask.i] : []), create, ...top.filter((x) => !x.strong && x !== exactTask).map((x) => x.i)]
  }, [items, q, lists, tasks, st])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const run = (it: Item | undefined) => {
    if (!it) return
    close()
    it.run()
  }

  let lastGroup = ''
  return (
    <>
      <div className="palette-input">
        <Search size={18} />
        <input
          autoFocus
          value={q}
          placeholder="Aufgabe, Nummer, Liste, Befehl … oder neue Aufgabe tippen"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(results[idx])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        />
        <kbd className="desktop-only">Esc</kbd>
      </div>
      <div className="palette-list" ref={listRef} role="listbox">
        {results.length === 0 && <div className="picker-empty">Nichts gefunden</div>}
        {results.map((it, k) => {
          const head = it.group !== lastGroup ? it.group : null
          lastGroup = it.group
          return (
            <div key={it.id}>
              {head && head !== 'Neu' && <div className="palette-group">{head}</div>}
              <button role="option" aria-selected={k === idx} className={`palette-item ${k === idx ? 'on' : ''}`} onMouseMove={() => k !== idx && setIdx(k)} onClick={() => run(it)}>
                <span className="palette-icon">{it.icon}</span>
                <span className="palette-text">
                  <span className="palette-label">{it.label}</span>
                  {it.sub && <span className="palette-sub">{it.sub}</span>}
                </span>
                {k === idx && <CornerDownLeft size={14} className="palette-enter" />}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
