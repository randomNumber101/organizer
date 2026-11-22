import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from '../store'
import type { TaskPatch } from '../lib/types'
import { composeTask } from '../lib/compose'
import { LIST_COLORS } from '../lib/types'
import SmartField, { TokenChips } from './SmartField'

/** Einzeilige Eingabe „+ Aufgabe“ mit der Eingabesprache */
export default function QuickLine({ defaults, placeholder = 'Aufgabe hinzufügen' }: { defaults: TaskPatch; placeholder?: string }) {
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const [text, setText] = useState('')
  const c = useMemo(() => composeTask(text, defaults, lists, tasks), [text, defaults, lists, tasks])

  const submit = () => {
    if (!c.patch.title) return
    let list_id = c.patch.list_id
    if (c.newListName) list_id = createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]).id
    createTask({ ...c.patch, list_id })
    setText('')
  }

  return (
    <div className="quickline-wrap">
      <label className="quickline">
        <Plus size={16} />
        <SmartField value={text} onChange={setText} tokens={c.parsed.tokens} placeholder={placeholder} onSubmit={submit} onCancel={() => setText('')} className="quickline-field" />
      </label>
      {c.parsed.tokens.length > 0 && (
        <div className="hint" style={{ padding: '0 4px 6px 30px' }}>
          <TokenChips tokens={c.parsed.tokens} />
        </div>
      )}
    </div>
  )
}
