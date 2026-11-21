import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from '../store'
import type { TaskPatch } from '../lib/types'
import { composeTask } from '../lib/compose'
import { LIST_COLORS } from '../lib/types'

/** Einzeilige Eingabe „+ Aufgabe“ mit Schnelleingabe-Syntax */
export default function QuickLine({ defaults, placeholder = 'Aufgabe hinzufügen' }: { defaults: TaskPatch; placeholder?: string }) {
  const lists = useStore((s) => s.lists)
  const createTask = useStore((s) => s.createTask)
  const createList = useStore((s) => s.createList)
  const [text, setText] = useState('')

  const submit = async () => {
    const c = composeTask(text, defaults, lists)
    if (!c.patch.title) return
    let list_id = c.patch.list_id
    if (c.newListName) list_id = (await createList(c.newListName, LIST_COLORS[Object.keys(lists).length % LIST_COLORS.length]))?.id ?? null
    void createTask({ ...c.patch, list_id })
    setText('')
  }

  return (
    <label className="quickline">
      <Plus size={16} />
      <input
        value={text}
        placeholder={placeholder}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') setText('')
        }}
      />
    </label>
  )
}
