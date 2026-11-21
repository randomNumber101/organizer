import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'
import { parseQuickAdd } from '../lib/quickadd'
import { dayLabel, deviceTimeZone, localDateTimeToIso, plusMinutesIso, todayStr } from '../lib/dates'
import type { TaskPatch } from '../lib/types'
import { HORIZON_LABEL, PRIORITY_LABEL } from '../lib/types'

export default function QuickAdd() {
  const { quickAdd, closeQuickAdd, createTask, lists, createList } = useStore()
  const [text, setText] = useState('')
  const today = todayStr()
  const parsed = useMemo(() => parseQuickAdd(text, today), [text, today])
  const d = quickAdd.defaults

  const matchedList = parsed.listName
    ? Object.values(lists).find((l) => l.name.toLowerCase().startsWith(parsed.listName!.toLowerCase()))
    : undefined

  const dueDate = parsed.dueDate ?? d.due_date ?? null
  const listId = matchedList?.id ?? d.list_id ?? null
  const tags = [...new Set([...(d.tags ?? []), ...parsed.tags])]
  const priority = parsed.priority ?? d.priority ?? 4

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!parsed.title) return
    let list_id = listId
    if (parsed.listName && !matchedList) {
      const l = await createList(parsed.listName, '#5f6b7a')
      list_id = l?.id ?? null
    }
    const patch: TaskPatch & { title: string } = {
      ...d,
      title: parsed.title,
      priority,
      tags,
      list_id,
      due_date: dueDate,
    }
    if (parsed.time && dueDate) {
      const start = localDateTimeToIso(dueDate, parsed.time)
      patch.start_at = start
      patch.end_at = plusMinutesIso(start, parsed.durationMin ?? 60)
      patch.timezone = deviceTimeZone()
    }
    void createTask(patch)
    setText('')
  }

  return (
    <div className="quickadd-wrap" onClick={(e) => e.target === e.currentTarget && closeQuickAdd()}>
      <form className="quickadd" onSubmit={submit}>
        <input
          autoFocus
          enterKeyHint="done"
          placeholder="Neue Aufgabe …"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="qa-preview">
          {dueDate && <span className="chip">{dayLabel(dueDate, today)}</span>}
          {parsed.time && (
            <span className="chip time">
              {parsed.time} · {parsed.durationMin} Min.
            </span>
          )}
          {priority !== 4 && <span className={`chip prio p${priority}`}>{PRIORITY_LABEL[priority]}</span>}
          {listId && lists[listId] && (
            <span className="chip list">
              <span className="dot" style={{ background: lists[listId].color }} />
              {lists[listId].name}
            </span>
          )}
          {parsed.listName && !matchedList && <span className="chip list">neue Liste: {parsed.listName}</span>}
          {!dueDate && d.horizon && <span className="chip">{HORIZON_LABEL[d.horizon]}</span>}
          {d.parent_id && <span className="chip">Unteraufgabe</span>}
          {tags.map((t) => (
            <span key={t} className="chip tag">
              #{t}
            </span>
          ))}
        </div>
        <div className="qa-foot">
          <span className="muted small">Tipp: „Mails morgen 14 Uhr !1 #uni @Job“</span>
          <div className="btn-row">
            <button type="button" className="btn small ghost" onClick={closeQuickAdd}>
              Fertig
            </button>
            <button className="btn small primary" disabled={!parsed.title}>
              Hinzufügen
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
