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

/** Minuten seit Mitternacht (Ortszeit des Geräts) */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Tag + Minuten seit Mitternacht → ISO-Zeitpunkt (Ortszeit des Geräts) */
export function isoFromDayMinutes(day: string, minutes: number): string {
  const d = parseISO(day)
  d.setHours(0, minutes, 0, 0)
  return d.toISOString()
}

export function daysFrom(start: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDaysStr(start, i))
}

/** Montag der Woche, in der `day` liegt */
export function weekStart(day: string): string {
  const d = parseISO(day)
  const wd = (d.getDay() + 6) % 7
  return addDaysStr(day, -wd)
}

export const weekdayShort = (day: string) => format(parseISO(day), 'EEE', { locale: de }).replace('.', '')
export const dayNum = (day: string) => format(parseISO(day), 'd')
export const monthLabel = (day: string) => format(parseISO(day), 'MMMM yyyy', { locale: de })
export const shortDate = (day: string) => format(parseISO(day), 'd. MMM', { locale: de })

export function durationLabel(min: number): string {
  if (min < 60) return `${min} Min.`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`
}
