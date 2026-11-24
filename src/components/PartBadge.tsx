/**
 * Kennzeichen für Teilaufgaben: kleine Segmentleiste („Teil 2/3“) bzw. Fortschritt der Hauptaufgabe.
 */
import { useMemo } from 'react'
import { useStore } from '../store'
import type { Task } from '../lib/types'
import { partInfo, partProgress } from '../lib/parts'
import { minutesText } from '../lib/dayplan'

export function Segments({ parts, current }: { parts: Task[]; current?: string }) {
  return (
    <span className="part-segs" aria-hidden>
      {parts.map((p) => (
        <i key={p.id} className={`${p.status === 'done' ? 'done' : ''} ${p.id === current ? 'cur' : ''}`} />
      ))}
    </span>
  )
}

/** „Teil 2/3“ an einem Teil */
export function PartBadge({ task }: { task: Task }) {
  const tasks = useStore((s) => s.tasks)
  const info = useMemo(() => partInfo(tasks, task), [tasks, task])
  if (!info || info.count < 1) return null
  return (
    <span className="part-badge" title={info.parent ? `Teil ${info.index} von ${info.count} – „${info.parent.title}“` : undefined}>
      <Segments parts={info.parts} current={task.id} />
      Teil {info.index}/{info.count}
    </span>
  )
}

/** Fortschritt einer aufgeteilten Aufgabe: Segmente + „1 h von 2 h“ */
export function PartProgress({ task }: { task: Task }) {
  const tasks = useStore((s) => s.tasks)
  const prog = partProgress(tasks, task.id)
  if (!prog) return null
  const parts = Object.values(tasks)
    .filter((t) => t.parent_id === task.id && t.part_index != null)
    .sort((a, b) => a.part_index! - b.part_index!)
  return (
    <span className="part-badge whole" title={`${prog.done} von ${prog.total} Teilen erledigt`}>
      <Segments parts={parts} />
      {prog.done}/{prog.total} Teile{prog.totalMin > 0 && ` · ${minutesText(prog.doneMin)} von ${minutesText(prog.totalMin)}`}
    </span>
  )
}
