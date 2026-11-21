import { useState } from 'react'
import { useStore } from '../store'
import { LIST_COLORS } from '../lib/types'

export default function ListHeader({ listId }: { listId: string }) {
  const list = useStore((s) => s.lists[listId])
  const { updateList, deleteList } = useStore.getState()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list?.name ?? '')
  const [confirm, setConfirm] = useState(false)
  if (!list) return null

  return (
    <div className="list-header">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void updateList(listId, { name: name.trim() })
            setEditing(false)
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
        </form>
      ) : (
        <button className="link small" onClick={() => { setName(list.name); setEditing(true) }}>
          Umbenennen
        </button>
      )}
      <div className="swatches">
        {LIST_COLORS.map((c) => (
          <button key={c} className={`swatch ${c === list.color ? 'on' : ''}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={() => void updateList(listId, { color: c })} />
        ))}
      </div>
      <button
        className={`link small ${confirm ? 'danger' : ''}`}
        onClick={() => {
          if (confirm) void deleteList(listId)
          else {
            setConfirm(true)
            setTimeout(() => setConfirm(false), 3000)
          }
        }}
      >
        {confirm ? 'Wirklich löschen? (Aufgaben bleiben)' : 'Liste löschen'}
      </button>
    </div>
  )
}
