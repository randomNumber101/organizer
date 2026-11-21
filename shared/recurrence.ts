/**
 * Wiederholungen – kleine, robuste Teilmenge von RFC-5545-RRULEs.
 * Wird von App und Worker gemeinsam benutzt, damit beide gleich rechnen.
 *
 * Unterstützt: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL=n, BYDAY=MO,TU,… (nur bei WEEKLY)
 * Rechnet ausschließlich mit Kalenderdaten (YYYY-MM-DD), damit Zeitzonen keine Rolle spielen.
 */

export type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export const PRESET_RRULE: Record<RepeatPreset, string> = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
}

export const PRESET_LABEL: Record<RepeatPreset, string> = {
  daily: 'Täglich',
  weekdays: 'Werktags',
  weekly: 'Wöchentlich',
  biweekly: 'Alle 2 Wochen',
  monthly: 'Monatlich',
  yearly: 'Jährlich',
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  byday: number[] | null
}

export function parseRRule(s: string | null | undefined): Rule | null {
  if (!s) return null
  const parts = Object.fromEntries(
    s
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((p) => p.split('=') as [string, string])
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  )
  const freq = parts.FREQ
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
  const interval = Math.max(1, Math.min(365, Number(parts.INTERVAL ?? 1) || 1))
  let byday: number[] | null = null
  if (parts.BYDAY && freq === 'WEEKLY') {
    byday = parts.BYDAY.split(',')
      .map((d: string) => DAYS.indexOf(d.slice(-2)))
      .filter((d: number) => d >= 0)
    if (!byday.length) byday = null
  }
  return { freq, interval, byday }
}

export function isValidRRule(s: string | null | undefined): boolean {
  return parseRRule(s) !== null
}

export function presetOf(rrule: string | null | undefined): RepeatPreset | 'custom' | null {
  if (!rrule) return null
  const norm = rrule.toUpperCase().replace(/^RRULE:/, '')
  for (const [k, v] of Object.entries(PRESET_RRULE)) if (v === norm) return k as RepeatPreset
  return parseRRule(rrule) ? 'custom' : null
}

export function repeatLabel(rrule: string | null | undefined): string | null {
  const p = presetOf(rrule)
  if (!p) return null
  if (p !== 'custom') return PRESET_LABEL[p]
  const r = parseRRule(rrule)!
  const unit = { DAILY: ['Tag', 'Tage'], WEEKLY: ['Woche', 'Wochen'], MONTHLY: ['Monat', 'Monate'], YEARLY: ['Jahr', 'Jahre'] }[r.freq]
  return r.interval === 1 ? `Jede${r.freq === 'WEEKLY' ? '' : 'n'} ${unit[0]}` : `Alle ${r.interval} ${unit[1]}`
}

// ---------------------------------------------------------------------------
// Datumsrechnung (UTC, nur Kalenderdaten)
// ---------------------------------------------------------------------------
const toUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
const fromUtc = (d: Date) => d.toISOString().slice(0, 10)

export function addDaysUtc(d: string, n: number): string {
  const x = toUtc(d)
  x.setUTCDate(x.getUTCDate() + n)
  return fromUtc(x)
}

function addMonthsUtc(d: string, n: number, anchorDay: number): string {
  const x = toUtc(d)
  const y = x.getUTCFullYear()
  const m = x.getUTCMonth() + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return fromUtc(new Date(Date.UTC(y, m, Math.min(anchorDay, last))))
}

function step(rule: Rule, d: string, anchorDay: number): string {
  switch (rule.freq) {
    case 'DAILY':
      return addDaysUtc(d, rule.interval)
    case 'WEEKLY': {
      if (!rule.byday) return addDaysUtc(d, 7 * rule.interval)
      // nächster passender Wochentag
      for (let i = 1; i <= 7 * rule.interval + 7; i++) {
        const c = addDaysUtc(d, i)
        if (rule.byday.includes(toUtc(c).getUTCDay())) return c
      }
      return addDaysUtc(d, 7)
    }
    case 'MONTHLY':
      return addMonthsUtc(d, rule.interval, anchorDay)
    case 'YEARLY':
      return addMonthsUtc(d, 12 * rule.interval, anchorDay)
  }
}

/**
 * Nächster Termin nach `from`, der nach `today` liegt.
 * (Wer eine tägliche Aufgabe erst drei Tage später abhakt, bekommt sie morgen wieder – nicht dreimal nachgeholt.)
 */
export function nextOccurrence(rrule: string, from: string, today: string): string | null {
  const rule = parseRRule(rrule)
  if (!rule) return null
  const anchorDay = toUtc(from).getUTCDate()
  let next = step(rule, from, anchorDay)
  let guard = 0
  while (next <= today && guard++ < 2000) next = step(rule, next, anchorDay)
  return next
}

/** Tage zwischen zwei Kalenderdaten */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000)
}
