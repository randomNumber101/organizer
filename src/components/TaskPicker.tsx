import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Search } from 'lucide-react'
import { useStore } from '../store'
import type { Task } from '../lib/types'
import { matchesSearch } from '../lib/compose'
import { ancestors } from '../lib/tree'

interface Props {
  /** ids, die nicht wählbar sind */
  exclude: (t: Task) => boolean
  onPick: (t: Task) => void
  onClose: () => void
  placeholder?: string
}

/** Kleine Suche, um eine andere offene Aufgabe auszuwählen */
export default function TaskPicker({ exclude, onPick, onClose, placeholder = 'Aufgabe suchen …' }: Props) {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)

  const results = useMemo(() => {
    const open = Object.values(tasks).filter((t) => t.status === 'open' && !exclude(t) && matchesSearch(t, q))
    // Treffer am Wortanfang zuerst, dann zuletzt geändert
    const ql = q.trim().toLowerCase()
    return open
      .sort((a, b) => {
        const sa = ql && a.title.toLowerCase().startsWith(ql) ? 0 : 1
        const sb = ql && b.title.toLowerCase().startsWith(ql) ? 0 : 1
        return sa - sb || b.updated_at.localeCompare(a.updated_at)
      })
      .slice(0, 8)
  }, [tasks, q, exclude])

  const pick = (t: Task | undefined) => {
    if (!t) return
    onPick(t)
    onClose()
  }

  return (
    <motion.div className="picker" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
      <div className="picker-input">
        <Search size={15} />
        <input
          autoFocus
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value)
            setIdx(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(results[idx])
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
          onBlur={() => setTimeout(onClose, 150)}
        />
      </div>
      <div className="picker-list" role="listbox">
        {results.length === 0 && <div className="picker-empty">Keine passende offene Aufgabe</div>}
        {results.map((t, i) => {
          const list = t.list_id ? lists[t.list_id] : null
          const path = ancestors(tasks, t)
          return (
            <button
              key={t.id}
              role="option"
              aria-selected={i === idx}
              className={`picker-item ${i === idx ? 'on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(t)}
            >
              <span className="picker-title">{t.title}</span>
              <span className="picker-sub">
                {list && <span className="dot" style={{ background: list.color }} />}
                {[list?.name ?? 'Unsortiert', ...path.map((p) => p.title)].join(' › ')}
              </span>
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}
