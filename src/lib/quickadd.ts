import { addDaysStr, nextWeekdayStr } from './dates'
import type { Priority } from './types'

export interface ParsedQuickAdd {
  title: string
  priority?: Priority
  tags: string[]
  dueDate?: string
  time?: string // "HH:mm"
  durationMin?: number
  listName?: string
}

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
const WEEKDAY_SHORT: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 }

/**
 * Schnelleingabe:
 *   "Mails beantworten morgen 14 Uhr !1 #uni @Job"
 *   heute | morgen | übermorgen | (am) montag … sonntag | mo … so (nur mit "am")
 *   14 Uhr | 14:30 | um 9 | 9-10 Uhr / 9:00-10:30 (Zeitblock)
 *   !1 … !4 Priorität, #tag, @liste
 */
export function parseQuickAdd(input: string, today: string): ParsedQuickAdd {
  let rest = ` ${input} `
  const tags: string[] = []
  let priority: Priority | undefined
  let listName: string | undefined
  let dueDate: string | undefined
  let time: string | undefined
  let durationMin: number | undefined

  rest = rest.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_m, t: string) => {
    if (!tags.includes(t.toLowerCase())) tags.push(t.toLowerCase())
    return ' '
  })
  rest = rest.replace(/\s!([1-4])(?=\s)/g, (_m, p: string) => {
    priority = Number(p) as Priority
    return ' '
  })
  rest = rest.replace(/\s@([\p{L}\p{N}_-]+)/gu, (_m, l: string) => {
    listName = l
    return ' '
  })

  const rel: Record<string, number> = { heute: 0, morgen: 1, übermorgen: 2 }
  rest = rest.replace(/\s(heute|übermorgen|morgen)(?=\s)/iu, (_m, w: string) => {
    dueDate = addDaysStr(today, rel[w.toLowerCase()])
    return ' '
  })
  if (!dueDate) {
    rest = rest.replace(new RegExp(`\\s(?:am\\s)?(${WEEKDAYS.join('|')})(?=\\s)`, 'iu'), (_m, w: string) => {
      dueDate = nextWeekdayStr(today, WEEKDAYS.indexOf(w.toLowerCase()))
      return ' '
    })
  }
  if (!dueDate) {
    rest = rest.replace(/\sam\s(mo|di|mi|do|fr|sa|so)\.?(?=\s)/iu, (_m, w: string) => {
      dueDate = nextWeekdayStr(today, WEEKDAY_SHORT[w.toLowerCase()])
      return ' '
    })
  }

  const hm = (h: string, m?: string) => `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

  // Zeitspanne: "9-10 Uhr", "9:00-10:30", "von 9 bis 10 uhr"
  rest = rest.replace(
    /\s(?:von\s)?([01]?\d|2[0-3])(?::([0-5]\d))?\s?(?:-|–|bis)\s?([01]?\d|2[0-3])(?::([0-5]\d))?(?:\s?uhr)?(?=\s)/iu,
    (m, h1: string, m1: string | undefined, h2: string, m2: string | undefined) => {
      if (!m1 && !m2 && !/uhr|von|bis/i.test(m)) return m // "3-4" ohne Kontext nicht als Zeit deuten
      const a = hm(h1, m1)
      const b = hm(h2, m2)
      if (toMin(b) <= toMin(a)) return m
      time = a
      durationMin = toMin(b) - toMin(a)
      return ' '
    },
  )
  if (!time) {
    rest = rest.replace(
      /\s(?:um\s)?([01]?\d|2[0-3])(?::([0-5]\d))?\s?uhr(?=\s)|\s(?:um\s)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)|\sum\s([01]?\d|2[0-3])(?=\s)/iu,
      (_m, h1?: string, m1?: string, h2?: string, m2?: string, h3?: string) => {
        if (h1) time = hm(h1, m1)
        else if (h2) time = hm(h2, m2)
        else if (h3) time = hm(h3)
        return ' '
      },
    )
  }
  if (time && !dueDate) dueDate = today
  if (time && !durationMin) durationMin = 60

  return { title: rest.replace(/\s+/g, ' ').trim(), priority, tags, dueDate, time, durationMin, listName }
}
