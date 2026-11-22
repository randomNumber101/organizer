import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Hash } from 'lucide-react'
import { useStore } from '../store'
import type { Token, TokenKind } from '../lib/lang'
import { suggestContext, type SuggestContext } from '../lib/lang'
import { allTags } from '../lib/filter'
import { ancestors } from '../lib/tree'

interface Props {
  value: string
  onChange: (v: string) => void
  tokens: Token[]
  onSubmit?: () => void
  onCancel?: () => void
  onBlur?: () => void
  onFocus?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  id?: string
  ariaLabel?: string
  enterKeyHint?: 'done' | 'enter' | 'go' | 'next' | 'send'
  /** Vorschläge für Verweise, @Listen und #Tags */
  suggest?: boolean
  /** Aufgabe, die gerade bearbeitet wird (nicht vorschlagen) */
  self?: string
}

export interface SmartFieldHandle {
  focus: () => void
  blur: () => void
  el: HTMLTextAreaElement | null
}

interface Suggestion {
  key: string
  insert: string
  label: string
  sub?: string
  icon?: ReactNode
}

const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'tabSize'] as const

/**
 * Eingabefeld mit der Eingabesprache: erkannte Teile werden farbig hinterlegt,
 * nach „warte auf“, „unter“, @ und # kommen passende Vorschläge.
 */
const SmartField = forwardRef<SmartFieldHandle, Props>(function SmartField(
  { value, onChange, tokens, onSubmit, onCancel, onBlur, onFocus, placeholder, autoFocus, className, id, ariaLabel, enterKeyHint = 'done', suggest = true, self },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const hl = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const [idx, setIdx] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(blurTimer.current), [])

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), blur: () => ta.current?.blur(), el: ta.current }), [])

  // Markierungsebene exakt wie das Textfeld setzen
  useLayoutEffect(() => {
    const a = ta.current
    const b = hl.current
    if (!a || !b) return
    const cs = getComputedStyle(a)
    for (const k of COPY) b.style[k] = cs[k]
    b.style.borderStyle = 'solid'
    b.style.borderColor = 'transparent'
  }, [className])

  // Höhe an den Inhalt anpassen
  useLayoutEffect(() => {
    const a = ta.current
    if (!a) return
    a.style.height = 'auto'
    a.style.height = `${a.scrollHeight}px`
    if (hl.current) hl.current.scrollTop = a.scrollTop
  }, [value])

  useEffect(() => {
    if (autoFocus) {
      const a = ta.current
      a?.focus()
      a?.setSelectionRange(a.value.length, a.value.length)
    }
  }, [autoFocus])

  const segments = useMemo(() => {
    const out: ReactNode[] = []
    let pos = 0
    for (const t of [...tokens].sort((x, y) => x.start - y.start)) {
      if (t.start < pos || t.end > value.length) continue
      if (t.start > pos) out.push(value.slice(pos, t.start))
      out.push(
        <mark key={`${t.start}-${t.kind}`} className={`tk tk-${t.kind}`} title={t.label}>
          {value.slice(t.start, t.end)}
        </mark>,
      )
      pos = t.end
    }
    out.push(value.slice(pos))
    return out
  }, [tokens, value])

  // Vorschläge
  const ctx: SuggestContext | null = useMemo(() => (suggest && focused && caret !== null ? suggestContext(value.slice(0, caret)) : null), [suggest, focused, caret, value])
  const list = useSuggestions(ctx, self)
  const ctxKey = ctx ? `${ctx.kind}:${ctx.from}` : null
  const open = !!ctx && list.length > 0 && dismissed !== ctxKey

  useEffect(() => {
    setIdx(0)
    setNavigated(false)
  }, [ctxKey, ctx?.query])

  const pick = (s: Suggestion) => {
    if (!ctx || caret === null) return
    const before = value.slice(0, ctx.from)
    const after = value.slice(caret).replace(/^\S*/, '')
    const insert = `${s.insert} `
    const next = `${before}${insert}${after.replace(/^ /, '')}`
    onChange(next)
    const pos = before.length + insert.length
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIdx((i) => (i + 1) % list.length)
        setNavigated(true)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIdx((i) => (i - 1 + list.length) % list.length)
        setNavigated(true)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && navigated)) {
        e.preventDefault()
        pick(list[idx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissed(ctxKey)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit?.()
    } else if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const syncCaret = () => setCaret(ta.current?.selectionStart ?? null)

  return (
    <div className={`smart ${className ?? ''}`}>
      <div className="smart-box">
        <div ref={hl} className="smart-hl" aria-hidden>
          {segments}
          {'​'}
        </div>
        <textarea
          ref={ta}
          id={id}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          enterKeyHint={enterKeyHint}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value.replace(/\n/g, ' '))
            setCaret(e.target.selectionStart)
            setDismissed(null)
          }}
          onKeyDown={onKey}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onScroll={() => {
            if (hl.current && ta.current) hl.current.scrollTop = ta.current.scrollTop
          }}
          onFocus={() => {
            clearTimeout(blurTimer.current)
            setFocused(true)
            syncCaret()
            onFocus?.()
          }}
          onBlur={() => {
            // kurz warten, damit ein Tipp auf einen Vorschlag (Handy) noch ankommt
            blurTimer.current = setTimeout(() => setFocused(false), 250)
            onBlur?.()
          }}
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="smart-sugg" role="listbox" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.14 }}>
            {list.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={i === idx}
                className={`smart-opt ${i === idx ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(s)}
              >
                {s.icon && <span className="smart-opt-icon">{s.icon}</span>}
                <span className="smart-opt-label">{s.label}</span>
                {s.sub && <span className="smart-opt-sub">{s.sub}</span>}
                {i === idx && (
                  <kbd className="desktop-only">
                    {navigated ? <CornerDownLeft size={11} /> : 'Tab'}
                  </kbd>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default SmartField

function useSuggestions(ctx: SuggestContext | null, self?: string): Suggestion[] {
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  return useMemo(() => {
    if (!ctx) return []
    const q = ctx.query.toLowerCase()
    if (ctx.kind === 'list') {
      return Object.values(lists)
        .filter((l) => !l.archived && l.name.toLowerCase().replace(/\s+/g, '-').startsWith(q.replace(/\s+/g, '-')))
        .sort((a, b) => a.sort - b.sort)
        .slice(0, 6)
        .map((l) => ({ key: l.id, insert: l.name.replace(/\s+/g, '-'), label: l.name, icon: <span className="dot" style={{ background: l.color }} /> }))
    }
    if (ctx.kind === 'tag') {
      return allTags(tasks)
        .filter((t) => t.startsWith(q) && t !== q)
        .slice(0, 6)
        .map((t) => ({ key: t, insert: t, label: t, icon: <Hash size={13} /> }))
    }
    // Verweise auf offene Aufgaben
    const digits = /^\d+$/.test(q)
    const words = q.split(/\s+/).filter(Boolean)
    return Object.values(tasks)
      .filter((t) => t.status === 'open' && t.id !== self)
      .map((t) => {
        const title = t.title.toLowerCase()
        let score = 0
        if (!q) score = 1
        else if (digits) score = t.num !== null && String(t.num).startsWith(q) ? 3 : 0
        else if (title.startsWith(q)) score = 3
        else if (words.every((w) => ` ${title}`.includes(` ${w}`))) score = 2
        else if (words.every((w) => title.includes(w))) score = 1
        return { t, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.t.updated_at.localeCompare(a.t.updated_at))
      .slice(0, 6)
      .map(({ t }) => {
        const path = ancestors(tasks, t).map((p) => p.title)
        const list = t.list_id ? lists[t.list_id]?.name : 'Unsortiert'
        return {
          key: t.id,
          insert: t.num ? String(t.num) : `"${t.title.replace(/"/g, '')}"`,
          label: t.title,
          sub: [list, ...path].join(' › '),
          icon: t.num ? <span className="smart-num">{t.num}</span> : undefined,
        }
      })
  }, [ctx, tasks, lists, self])
}

/** Erkannte Teile als kleine Chips (gleiche Farben wie die Markierung) */
export function TokenChips({ tokens, empty }: { tokens: Token[]; empty?: ReactNode }) {
  if (!tokens.length) return <>{empty ?? null}</>
  return (
    <>
      {tokens.map((t) => (
        <span key={`${t.start}-${t.kind}`} className={`chip tkc tk-${t.kind}`}>
          {t.label}
        </span>
      ))}
    </>
  )
}

export const KIND_LABEL: Record<TokenKind, string> = {
  date: 'Datum',
  time: 'Uhrzeit',
  deadline: 'Frist',
  wait: 'Wartet auf',
  parent: 'Unteraufgabe',
  prio: 'Wichtigkeit',
  horizon: 'Horizont',
  repeat: 'Wiederholung',
  duration: 'Dauer',
  list: 'Liste',
  tag: 'Tag',
  note: 'Notiz',
}
