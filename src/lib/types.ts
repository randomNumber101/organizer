export type Horizon = 'backlog' | 'short' | 'long'
export type Status = 'open' | 'done'
export type Priority = 1 | 2 | 3 | 4

export interface List {
  id: string
  name: string
  color: string
  sort: number
  archived: boolean
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  list_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  status: Status
  priority: Priority
  horizon: Horizon
  tags: string[]
  due_date: string | null
  start_at: string | null
  end_at: string | null
  timezone: string | null
  rrule: string | null
  rollover_count: number
  completed_at: string | null
  sort: number
  gcal_event_id: string | null
  gcal_etag: string | null
  created_at: string
  updated_at: string
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'created_at' | 'updated_at' | 'rollover_count' | 'completed_at' | 'gcal_event_id' | 'gcal_etag'>>

export type View =
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'horizon'; horizon: Horizon }
  | { kind: 'list'; listId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'done' }

export const HORIZON_LABEL: Record<Horizon, string> = {
  short: 'Kurzfristig',
  long: 'Langfristig',
  backlog: 'Backlog',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Hoch',
  2: 'Mittel',
  3: 'Niedrig',
  4: 'Keine',
}

export const LIST_COLORS = ['#2f5d50', '#3d6fb6', '#b5523b', '#c28a1a', '#7a4fa3', '#2b8a8a', '#a3456e', '#5f6b7a']
