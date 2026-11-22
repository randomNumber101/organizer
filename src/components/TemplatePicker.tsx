import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LayoutTemplate, ListChecks, Pencil, Repeat, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import type { TemplateNode } from '../lib/types'

const countNodes = (n: TemplateNode): number => (n.subtasks ?? []).reduce((s, k) => s + 1 + countNodes(k), 0)

/** Vorlage auswählen und anlegen – oder Vorlagen umbenennen/löschen */
export default function TemplatePicker() {
  const picker = useStore((s) => s.templatePicker)
  const close = () => useStore.getState().openTemplatePicker(null)
  useEffect(() => {
    if (!picker) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('input') && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [picker])

  return (
    <AnimatePresence>
      {picker && (
        <motion.div className="qa-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div className="qa tpl-picker" initial={{ y: -10, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -10, opacity: 0, scale: 0.98 }} transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
            <PickerBody onClose={close} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PickerBody({ onClose }: { onClose: () => void }) {
  const templates = useStore((s) => s.templates)
  const picker = useStore((s) => s.templatePicker)
  const lists = useStore((s) => s.lists)
  const { useTemplate: instantiate, renameTemplate, deleteTemplate } = useStore.getState()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const rows = Object.values(templates).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const target = picker?.defaults.list_id ? lists[picker.defaults.list_id]?.name : picker?.defaults.due_date ? 'den gewählten Tag' : null

  return (
    <>
      <div className="tpl-head">
        <LayoutTemplate size={18} style={{ color: 'var(--accent)' }} />
        <b>Aus Vorlage anlegen</b>
        {target && <span className="muted small">→ {target}</span>}
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="tpl-list">
        {rows.length === 0 && (
          <p className="muted small" style={{ padding: '8px 4px' }}>
            Noch keine Vorlagen. Öffne eine Aufgabe (gern mit Unteraufgaben) und tippe unten auf „Als Vorlage“.
          </p>
        )}
        <AnimatePresence initial={false}>
          {rows.map((t) => {
            const n = countNodes(t.payload)
            return (
              <motion.div key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="tpl-row">
                {editing === t.id ? (
                  <input
                    autoFocus
                    className="field-input sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      renameTemplate(t.id, name)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <button className="tpl-main" onClick={() => instantiate(t.id, picker?.defaults ?? {})}>
                    <b>{t.name}</b>
                    <span className="muted small">
                      {t.payload.title !== t.name && <>{t.payload.title} · </>}
                      {n > 0 && (
                        <>
                          <ListChecks size={12} style={{ verticalAlign: -2 }} /> {n} Unteraufgaben
                        </>
                      )}
                      {t.payload.rrule && (
                        <>
                          {' '}
                          <Repeat size={12} style={{ verticalAlign: -2 }} />
                        </>
                      )}
                    </span>
                  </button>
                )}
                <button
                  className="icon-btn sm"
                  aria-label={`Vorlage „${t.name}“ umbenennen`}
                  onClick={() => {
                    setName(t.name)
                    setEditing(t.id)
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button className="icon-btn sm" aria-label={`Vorlage „${t.name}“ löschen`} onClick={() => deleteTemplate(t.id)}>
                  <Trash2 size={14} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </>
  )
}
