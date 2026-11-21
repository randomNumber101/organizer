import { useDraggable } from '@dnd-kit/core'
import type { Task } from '../lib/types'
import { TaskCard } from './TaskCard'

/** Karte, die man ins Zeitraster ziehen kann */
export default function DraggableCard({ task, showDate = false, showList = true }: { task: Task; showDate?: boolean; showList?: boolean }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `task:${task.id}`, data: { type: 'task', taskId: task.id } })
  return <TaskCard ref={setNodeRef} task={task} ghost={isDragging} showDate={showDate} showList={showList} {...attributes} {...listeners} />
}
