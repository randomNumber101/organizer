import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'

export const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayStr = () => toDateStr(new Date())
export const addDaysStr = (day: string, n: number) => toDateStr(addDays(parseISO(day), n))
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** "Heute", "Morgen", "Donnerstag", "Mo., 30. Nov." … */
export function dayLabel(day: string, today = todayStr()): string {
  const diff = differenceInCalendarDays(parseISO(day), parseISO(today))
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Morgen'
  if (diff === 2) return 'Übermorgen'
  if (diff === -1) return 'Gestern'
  if (diff > 2 && diff < 7) return format(parseISO(day), 'EEEE', { locale: de })
  return format(parseISO(day), 'EEE, d. MMM', { locale: de })
}

export const longDayLabel = (day: string) => format(parseISO(day), 'EEEE, d. MMMM', { locale: de })

export const timeLabel = (iso: string) => format(new Date(iso), 'HH:mm')

/** lokales Datum + "HH:mm" → ISO-Zeitstempel (in der Zeitzone des Geräts) */
export function localDateTimeToIso(day: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = parseISO(day)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/** Startzeit + Dauer in Minuten → ISO */
export const plusMinutesIso = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()

export const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)

/** Datum des Zeitblocks in der Zeitzone des Geräts */
export const localDayOf = (iso: string) => toDateStr(new Date(iso))

export function nextWeekdayStr(today: string, weekday: number): string {
  const cur = parseISO(today).getDay()
  let diff = (weekday - cur + 7) % 7
  if (diff === 0) diff = 7
  return addDaysStr(today, diff)
}
