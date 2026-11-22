/**
 * Eingabesprache: aus einer Zeile wie
 *   „Schuhe waschen bis morgen früh warte auf 4 #haushalt“
 * werden Titel + Felder (Datum, Uhrzeit, Frist, Dauer, Wiederholung, Wichtigkeit, Liste, Tags,
 * „wartet auf“, „Unteraufgabe von“, Notiz).
 *
 * Jede erkannte Stelle wird als Token mit Position zurückgegeben, damit die Eingabefelder sie
 * farbig markieren können. Text in "Anführungszeichen" wird nie ausgewertet.
 */
import type { Horizon, List, Priority, Task } from './types'
import { addDaysStr, nextWeekdayStr } from './dates'

export type TokenKind = 'date' | 'time' | 'deadline' | 'wait' | 'parent' | 'prio' | 'horizon' | 'repeat' | 'duration' | 'list' | 'tag' | 'note'

export interface Token {
  start: number
  end: number
  kind: TokenKind
  label: string
}

export interface RefTarget {
  id: string
  title: string
  num: number | null
}

export interface LangContext {
  today: string
  tasks?: Record<string, Task>
  lists?: Record<string, List>
  /** Aufgabe, die gerade bearbeitet wird (kann nicht auf sich selbst verweisen) */
  self?: string
}

export interface Parsed {
  title: string
  tokens: Token[]
  dueDate?: string
  time?: string
  /** Länge des Zeitblocks aus „9–11 Uhr“ oder einer Dauerangabe */
  durationMin?: number
  /** Dauerangabe („30 min“) – wird als Schätzung gespeichert */
  estimate?: number
  /** YYYY-MM-DD oder YYYY-MM-DDTHH:mm */
  deadline?: string
  priority?: Priority
  horizon?: Horizon
  rrule?: string
  tags: string[]
  listName?: string
  list?: List
  waitFor: RefTarget[]
  parent?: RefTarget
  notes?: string
}

// ---------------------------------------------------------------------------
// Wortschatz
// ---------------------------------------------------------------------------
const WD = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
const WDS: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 }
const RR_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONTHS: [RegExp, number][] = [
  [/^jan/, 1],
  [/^feb/, 2],
  [/^(mär|mar|maer)/, 3],
  [/^apr/, 4],
  [/^mai/, 5],
  [/^jun/, 6],
  [/^jul/, 7],
  [/^aug/, 8],
  [/^sep/, 9],
  [/^okt/, 10],
  [/^nov/, 11],
  [/^dez/, 12],
]
const NUMWORD: Record<string, number> = { ein: 1, eine: 1, einem: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 }
const DAYPART: Record<string, string> = {
  früh: '08:00',
  morgen: '08:00',
  morgens: '08:00',
  vormittag: '10:00',
  vormittags: '10:00',
  mittag: '12:00',
  mittags: '12:00',
  nachmittag: '15:00',
  nachmittags: '15:00',
  abend: '19:00',
  abends: '19:00',
  nacht: '22:00',
  nachts: '22:00',
}

const B = '(?<![\\p{L}\\p{N}_\\u0001])'
const E = '(?![\\p{L}\\p{N}_\\u0001])'
const S = '[ \\t\\u00a0]+'
const WD_RE = WD.slice(1).concat(WD[0]).join('|')
const WDS_RE = 'mo|di|mi|do|fr|sa|so'
const MONTH_RE = 'januar|jan|februar|feb|märz|maerz|mär|april|apr|mai|juni|jun|juli|jul|august|aug|september|sept|sep|oktober|okt|november|nov|dezember|dez'
const NUM_RE = `\\d+|${Object.keys(NUMWORD).join('|')}`
const HOUR = '(?:[01]?\\d|2[0-3])'
const MINS = '[0-5]\\d'
const PART_RE = Object.keys(DAYPART).join('|')

/** Datumsausdrücke (ohne führendes „am“) */
const DATE_RE = [
  'übermorgen|morgen|heute',
  `(?:(?:diesen|nächsten|kommenden|übernächsten)${S})?(?:${WD_RE})`,
  `(?:nächsten|kommenden|übernächsten)${S}(?:${WDS_RE})\\.?`,
  `in${S}(?:${NUM_RE})${S}(?:tagen|tag|wochen|woche|monaten|monat|jahren|jahr)`,
  `(?:nächste|kommende|übernächste)${S}woche`,
  `(?:ende|anfang)${S}(?:der|dieser|nächster|kommender)${S}woche`,
  'wochenende',
  `ende${S}(?:des|dieses|nächsten)${S}monats|monatsende|ende${S}monat`,
  `(?:nächsten|kommenden)${S}monat`,
  '\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})?',
  `\\d{1,2}\\.${'[ \\t]*'}(?:${MONTH_RE})\\.?(?:${S}\\d{4})?`,
  '\\d{4}-\\d{2}-\\d{2}',
].join('|')

const TIME_CORE = `${HOUR}(?:[:.]${MINS})?[ \\t]?uhr|${HOUR}:${MINS}`
const TIME_RE = `(?:um${S})?(?:${TIME_CORE})|um${S}${HOUR}`

// ---------------------------------------------------------------------------
// Datum & Zeit auflösen
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const validYmd = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= lastOfMonth(y, m)

/** nächstes Vorkommen eines Wochentags, heute eingeschlossen */
function onOrAfter(today: string, wd: number) {
  const diff = (wd - weekday(today) + 7) % 7
  return addDaysStr(today, diff)
}

function addMonths(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const ny = t.getUTCFullYear()
  const nm = t.getUTCMonth() + 1
  return ymd(ny, nm, Math.min(d, lastOfMonth(ny, nm)))
}

const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : (NUMWORD[w] ?? NaN))

/** „12.12.“ / „12.12.27“ / „3.1.2027“ → YYYY-MM-DD; ohne Jahr: nächstes Vorkommen */
export function parseDotDate(w: string, today: string): string | undefined {
  const m = w.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/)
  if (!m) return undefined
  return fromDayMonth(Number(m[1]), Number(m[2]), m[3], today)
}

function fromDayMonth(d: number, mo: number, yearText: string | undefined, today: string): string | undefined {
  let y = yearText ? Number(yearText) : Number(today.slice(0, 4))
  if (yearText && yearText.length === 2) y += 2000
  if (!yearText && validYmd(y, mo, d) && ymd(y, mo, d) < today) y += 1
  if (!validYmd(y, mo, d)) {
    // 29.2. ohne Jahr: nächstes Schaltjahr
    if (!yearText && mo === 2 && d === 29) for (let k = 1; k <= 4; k++) if (validYmd(y + k, mo, d)) return ymd(y + k, mo, d)
    return undefined
  }
  return ymd(y, mo, d)
}

export function resolveDate(raw: string, today: string): string | undefined {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t === 'heute') return today
  if (t === 'morgen') return addDaysStr(today, 1)
  if (t === 'übermorgen') return addDaysStr(today, 2)
  let m = t.match(/^(?:(diesen|nächsten|kommenden|übernächsten) )?([a-zäöü]+)\.?$/)
  if (m) {
    const name = m[2]
    const wd = WD.indexOf(name) >= 0 ? WD.indexOf(name) : name in WDS ? WDS[name] : -1
    if (wd >= 0) {
      if (m[1] === 'diesen') return onOrAfter(today, wd)
      const next = nextWeekdayStr(today, wd)
      return m[1] === 'übernächsten' ? addDaysStr(next, 7) : next
    }
  }
  m = t.match(/^in (\S+) (tagen|tag|wochen|woche|monaten|monat|jahren|jahr)$/)
  if (m) {
    const n = num(m[1])
    if (!Number.isFinite(n) || n > 400) return undefined
    if (m[2].startsWith('tag')) return addDaysStr(today, n)
    if (m[2].startsWith('woche')) return addDaysStr(today, n * 7)
    if (m[2].startsWith('monat')) return addMonths(today, n)
    return addMonths(today, n * 12)
  }
  const monday = addDaysStr(today, -((weekday(today) + 6) % 7))
  if (/^(nächste|kommende) woche$/.test(t)) return addDaysStr(monday, 7)
  if (t === 'übernächste woche') return addDaysStr(monday, 14)
  m = t.match(/^(ende|anfang) (der|dieser|nächster|kommender) woche$/)
  if (m) {
    const base = m[2] === 'nächster' || m[2] === 'kommender' ? addDaysStr(monday, 7) : monday
    const d = m[1] === 'ende' ? addDaysStr(base, 4) : base
    return d < today ? (m[1] === 'ende' ? addDaysStr(base, 6) : addDaysStr(base, 7)) : d
  }
  if (t === 'wochenende') return weekday(today) === 0 ? today : onOrAfter(today, 6)
  const [y, mo] = today.split('-').map(Number)
  if (/^(ende (des|dieses) monats|monatsende|ende monat)$/.test(t)) return ymd(y, mo, lastOfMonth(y, mo))
  if (t === 'ende des nächsten monats' || t === 'ende nächsten monats') {
    const n = addMonths(ymd(y, mo, 1), 1)
    const [ny, nm] = n.split('-').map(Number)
    return ymd(ny, nm, lastOfMonth(ny, nm))
  }
  if (/^(nächsten|kommenden) monat$/.test(t)) return addMonths(ymd(y, mo, 1), 1)
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/)
  if (m) return fromDayMonth(Number(m[1]), Number(m[2]), m[3], today)
  m = t.match(/^(\d{1,2})\. ?([a-zäöü]+)\.?(?: (\d{4}))?$/)
  if (m) {
    const month = MONTHS.find(([re]) => re.test(m![2]))?.[1]
    return month ? fromDayMonth(Number(m[1]), month, m[3], today) : undefined
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [yy, mm, dd] = t.split('-').map(Number)
    return validYmd(yy, mm, dd) ? t : undefined
  }
  return undefined
}

export function resolveTime(raw: string): string | undefined {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t in DAYPART) return DAYPART[t]
  const m = t.match(/^(?:um )?(\d{1,2})(?:[:.](\d{2}))? ?(?:uhr)?$/)
  if (!m) return undefined
  const h = Number(m[1])
  const mi = Number(m[2] ?? 0)
  if (h > 23 || mi > 59) return undefined
  return `${pad(h)}:${pad(mi)}`
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

// ---------------------------------------------------------------------------
// Beschriftungen für Chips
// ---------------------------------------------------------------------------
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MON_SHORT = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function dayText(day: string, today: string): string {
  if (day === today) return 'heute'
  if (day === addDaysStr(today, 1)) return 'morgen'
  if (day === addDaysStr(today, 2)) return 'übermorgen'
  const [y, m, d] = day.split('-').map(Number)
  const diff = (Date.parse(day) - Date.parse(today)) / 86_400_000
  const base = `${WD_SHORT[weekday(day)]}., ${d}. ${MON_SHORT[m - 1]}`
  return diff > 300 || y !== Number(today.slice(0, 4)) ? `${base} ${y}` : base
}

export function deadlineText(deadline: string, today: string): string {
  const day = deadline.slice(0, 10)
  const time = deadline.length > 10 ? ` ${deadline.slice(11)}` : ''
  return `${dayText(day, today)}${time}`
}

export const durationText = (min: number) => (min < 60 ? `${min} Min.` : min % 60 === 0 ? `${min / 60} Std.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`)

export function rruleText(rrule: string): string {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=')))
  const n = Number(parts.INTERVAL ?? 1)
  if (parts.FREQ === 'DAILY') return n === 1 ? 'täglich' : `alle ${n} Tage`
  if (parts.FREQ === 'WEEKLY') {
    if (parts.BYDAY === 'MO,TU,WE,TH,FR') return 'werktags'
    const days = parts.BYDAY ? (parts.BYDAY as string).split(',').map((d) => WD_SHORT[RR_DAY.indexOf(d)]).join(', ') : ''
    if (n === 1) return days ? `jeden ${days}` : 'wöchentlich'
    return `alle ${n} Wochen${days ? ` (${days})` : ''}`
  }
  if (parts.FREQ === 'MONTHLY') return n === 1 ? 'monatlich' : `alle ${n} Monate`
  return n === 1 ? 'jährlich' : `alle ${n} Jahre`
}

// ---------------------------------------------------------------------------
// Verweise auf andere Aufgaben
// ---------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-–]+/g, ' ').trim()

function refTargets(ctx: LangContext, allowDone: boolean): Task[] {
  if (!ctx.tasks) return []
  return Object.values(ctx.tasks).filter((t) => t.id !== ctx.self && (allowDone || t.status === 'open'))
}

/** beste Aufgabe zu einem Namen: exakt > Anfang > enthält; bei Gleichstand die zuletzt geänderte */
export function findByName(tasks: Task[], phrase: string, minScore = 1): Task | undefined {
  const p = norm(phrase)
  if (!p) return undefined
  let best: Task | undefined
  let bestScore = minScore - 1
  for (const t of tasks) {
    const title = norm(t.title)
    // „enthält“ nur an einem Wortanfang („druck“ passt nicht in „Ausdruck“)
    const sc = title === p ? 3 : title.startsWith(p) ? 2 : p.length >= 3 && ` ${title}`.includes(` ${p}`) ? 1 : 0
    if (sc > bestScore || (sc === bestScore && sc >= minScore && best && t.updated_at > best.updated_at)) {
      best = t
      bestScore = sc
    }
  }
  return best && bestScore >= minScore ? best : undefined
}

export const refLabel = (t: { title: string; num: number | null }) => (t.num ? `${t.title} (${t.num})` : t.title)

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------
class Scanner {
  readonly src: string
  /** gleiche Länge wie src; verbrauchte Stellen = \u0000, Zitate = \u0001 */
  work: string
  tokens: Token[] = []
  quotes: { start: number; end: number; text: string }[] = []

  constructor(src: string) {
    this.src = src
    let w = src
    const re = /"([^"]*)"|„([^“”"]*)[“”"]|“([^”]*)”/g
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const text = m[1] ?? m[2] ?? m[3] ?? ''
      this.quotes.push({ start: m.index, end: m.index + m[0].length, text })
      w = w.slice(0, m.index) + '\u0001'.repeat(m[0].length) + w.slice(m.index + m[0].length)
    }
    this.work = w
  }

  consume(start: number, end: number, kind: TokenKind, label: string) {
    // führende Leerzeichen gehören nicht zum Token
    while (start < end && /\s/.test(this.src[start])) start++
    while (end > start && /\s/.test(this.src[end - 1])) end--
    this.work = this.work.slice(0, start) + '\u0000'.repeat(end - start) + this.work.slice(end)
    this.tokens.push({ start, end, kind, label })
  }

  /** Regel einmal (oder für alle Treffer) anwenden; handler gibt false zurück, wenn der Treffer doch nichts ist */
  rule(re: RegExp, kind: TokenKind, handler: (m: RegExpExecArray) => string | false, all = false) {
    re.lastIndex = 0
    for (let m = re.exec(this.work); m; m = re.exec(this.work)) {
      if (m[0].includes('\u0000') || m[0].includes('\u0001')) {
        re.lastIndex = m.index + 1
        continue
      }
      const label = handler(m)
      if (label !== false) {
        this.consume(m.index, m.index + m[0].length, kind, label)
        if (!all) return true
      }
      re.lastIndex = m.index + Math.max(1, m[0].length)
    }
    return false
  }

  quoteAt(pos: number) {
    return this.quotes.find((q) => q.start === pos)
  }
}

const rx = (body: string) => new RegExp(`${B}(?:${body})${E}`, 'giu')

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------
export function parseLang(input: string, ctx: LangContext): Parsed {
  const sc = new Scanner(input)
  const { today } = ctx
  const out: Parsed = { title: '', tokens: sc.tokens, tags: [], waitFor: [] }

  // Notiz: alles nach „ // “
  {
    const m = /(^|\s)\/\/\s?/.exec(sc.work)
    if (m && !sc.work.slice(m.index).includes('\u0001')) {
      const start = m.index + m[1].length
      const notes = input.slice(m.index + m[0].length).trim()
      if (notes) {
        out.notes = notes
        sc.consume(start, input.length, 'note', 'Notiz')
      }
    }
  }

  // Verweise: „warte auf 4“, „warte auf Folien erstellen und 7“, „unter Präsentation“
  const refRule = (keyword: RegExp, kind: 'wait' | 'parent', multi: boolean) => {
    keyword.lastIndex = 0
    for (let m = keyword.exec(sc.work); m; m = keyword.exec(sc.work)) {
      let pos = m.index + m[0].length
      const found: Task[] = []
      const minScore = kind === 'parent' ? 2 : 1
      let r = readRef(sc, pos, ctx, found, minScore)
      while (r) {
        found.push(r.task)
        pos = r.end
        if (!multi) break
        const sep = /^[ \t]*(?:,|und|&|sowie)[ \t]+/i.exec(sc.work.slice(pos))
        if (!sep) break
        r = readRef(sc, pos + sep[0].length, ctx, found, minScore)
      }
      if (found.length) {
        const targets = found.map((t) => ({ id: t.id, title: t.title, num: t.num ?? null }))
        if (kind === 'wait') out.waitFor.push(...targets)
        else out.parent = targets[0]
        sc.consume(m.index, pos, kind, kind === 'wait' ? `wartet auf ${targets.map(refLabel).join(', ')}` : `Unteraufgabe von ${refLabel(targets[0])}`)
        if (kind === 'parent') return
      }
      keyword.lastIndex = m.index + 1
    }
  }
  if (ctx.tasks) {
    refRule(new RegExp(`${B}(?:warte(?:t|n)?${S}auf|erst${S}nach|nach${S}(?:task|aufgabe|nr\\.?)(?=[ \\t]*\\d)|blockiert${S}(?:von|durch)|abhängig${S}von)[ \\t]*`, 'giu'), 'wait', true)
    refRule(new RegExp(`${B}(?:unteraufgabe${S}von|teil${S}von|gehört${S}zu|unter)[ \\t]+|\\^[ \\t]*`, 'giu'), 'parent', false)
  }

  // Wiederholungen
  sc.rule(rx(`jeden${S}(\\d{1,2})\\.(?:${S}(?:des${S}monats|im${S}monat))?`), 'repeat', (m) => {
    const d = Number(m[1])
    if (d < 1 || d > 31) return false
    out.rrule = 'FREQ=MONTHLY'
    const [y, mo] = today.split('-').map(Number)
    let cand = validYmd(y, mo, d) ? ymd(y, mo, d) : undefined
    if (!cand || cand < today) {
      for (let k = 1; k <= 12; k++) {
        const n = addMonths(ymd(y, mo, 1), k)
        const [ny, nm] = n.split('-').map(Number)
        if (validYmd(ny, nm, d)) {
          cand = ymd(ny, nm, d)
          break
        }
      }
    }
    out.dueDate = cand
    return `jeden ${d}. im Monat`
  })
  const dayList = `(?:${WD_RE}|(?:${WDS_RE})\\.?)(?:[ \\t]*(?:,|und|&)[ \\t]*(?:${WD_RE}|(?:${WDS_RE})\\.?))*`
  sc.rule(rx(`jeden${S}(${dayList})|((?:${WD.map((d) => `${d}s`).join('|')})(?:[ \\t]*(?:,|und|&)[ \\t]*(?:${WD.map((d) => `${d}s`).join('|')}))*)`), 'repeat', (m) => {
    const raw = (m[1] ?? m[2]).toLowerCase()
    const days = [...new Set(raw.split(/[ \t]*(?:,|und|&)[ \t]*/).map((w) => w.replace(/\.$/, '').replace(/s$/, '')).map((w) => (WD.includes(w) ? WD.indexOf(w) : w in WDS ? WDS[w] : -1)))].filter((d) => d >= 0)
    if (!days.length) return false
    const order = [1, 2, 3, 4, 5, 6, 0]
    days.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    out.rrule = `FREQ=WEEKLY;BYDAY=${days.map((d) => RR_DAY[d]).join(',')}`
    out.dueDate = days.map((d) => onOrAfter(today, d)).sort()[0]
    return rruleText(out.rrule)
  })
  sc.rule(rx(`täglich|jeden${S}tag|werktags|jeden${S}werktag|an${S}werktagen|zweiwöchentlich|wöchentlich|jede${S}woche|monatlich|jeden${S}monat|jährlich|jedes${S}jahr|alle${S}(${NUM_RE})${S}(tage|wochen|monate|jahre)`), 'repeat', (m) => {
    const t = m[0].toLowerCase().replace(/\s+/g, ' ')
    if (m[1]) {
      const n = num(m[1].toLowerCase())
      if (!Number.isFinite(n) || n < 1 || n > 365) return false
      const freq = { tage: 'DAILY', wochen: 'WEEKLY', monate: 'MONTHLY', jahre: 'YEARLY' }[m[2].toLowerCase()]!
      out.rrule = n === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${n}`
    } else if (t === 'täglich' || t === 'jeden tag') out.rrule = 'FREQ=DAILY'
    else if (t.includes('werktag')) out.rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    else if (t === 'zweiwöchentlich') out.rrule = 'FREQ=WEEKLY;INTERVAL=2'
    else if (t === 'wöchentlich' || t === 'jede woche') out.rrule = 'FREQ=WEEKLY'
    else if (t === 'monatlich' || t === 'jeden monat') out.rrule = 'FREQ=MONTHLY'
    else out.rrule = 'FREQ=YEARLY'
    return rruleText(out.rrule)
  })

  // Zeitspanne: „9–11 Uhr“, „von 14 bis 16 Uhr“, „14:00-15:30“
  sc.rule(rx(`(?:von${S})?(${HOUR})(?::(${MINS}))?[ \\t]?(?:uhr[ \\t]?)?(?:-|–|bis)[ \\t]?(${HOUR})(?::(${MINS}))?(?!\\.\\d)(?:[ \\t]?uhr)?`), 'time', (m) => {
    if (!m[2] && !m[4] && !/uhr|von|bis/i.test(m[0])) return false
    const a = `${pad(Number(m[1]))}:${m[2] ?? '00'}`
    const b = `${pad(Number(m[3]))}:${m[4] ?? '00'}`
    if (toMin(b) <= toMin(a)) return false
    out.time = a
    out.durationMin = toMin(b) - toMin(a)
    return `${a}–${b}`
  })

  // Frist: „bis Freitag“, „bis morgen früh“, „bis 12.12. 18 Uhr“, „bis 18 Uhr“
  sc.rule(
    rx(
      `(?:bis|frist|deadline|spätestens|fällig)(?:${S}(?:zum|am))?${S}(?:(?<d>${DATE_RE}|(?:${WDS_RE})\\.?)(?:${S}(?:um${S}(?<t1>${HOUR}(?::${MINS})?(?:[ \\t]?uhr)?)|(?<t2>${TIME_CORE}|${PART_RE})))?|(?<t3>${TIME_RE}))`,
    ),
    'deadline',
    (m) => {
      const g = m.groups ?? {}
      const day = g.d ? resolveDate(g.d, today) : today
      if (!day) return false
      const timeRaw = g.t1 ?? g.t2 ?? g.t3
      const time = timeRaw ? resolveTime(timeRaw) : undefined
      if (timeRaw && !time) return false
      out.deadline = time ? `${day}T${time}` : day
      return `Frist ${deadlineText(out.deadline, today)}`
    },
  )

  // Datum (+ optional Tageszeit: „morgen früh“, „Freitag abend“)
  sc.rule(rx(`(?:am${S})?(${DATE_RE}|am${S}(?:${WDS_RE})\\.?)(?:${S}(${PART_RE}))?`), 'date', (m) => {
    const raw = m[1].replace(/^am\s+/i, '')
    // „Guten Morgen“ / „am Morgen“ meinen nicht „morgen“
    if (raw.toLowerCase() === 'morgen' && !m[2]) {
      const before = sc.src.slice(0, m.index)
      if (/guten\s*$/i.test(before)) return false
      if (/^am\s/i.test(m[0])) {
        out.time ??= '08:00'
        return 'morgens (08:00)'
      }
    }
    const day = resolveDate(raw, today)
    if (!day) return false
    if (out.dueDate && out.rrule) {
      // „jeden Montag ab 1.12.“ o. Ä.: explizites Datum gewinnt
    }
    out.dueDate = day
    if (m[2]) {
      out.time ??= DAYPART[m[2].toLowerCase()]
      return `${dayText(day, today)} ${m[2].toLowerCase()}`
    }
    return dayText(day, today)
  })

  // Uhrzeit
  sc.rule(rx(TIME_RE), 'time', (m) => {
    const t = resolveTime(m[0])
    if (!t || out.time) return false
    out.time = t
    return `${t} Uhr`
  })
  // Tageszeit allein: nur die eindeutigen Formen („abends“, „am Nachmittag“)
  sc.rule(rx(`morgens|vormittags|mittags|nachmittags|abends|nachts|am${S}(?:vormittag|mittag|nachmittag|abend)|heute${S}(?:früh|vormittag|mittag|nachmittag|abend|nacht)`), 'time', (m) => {
    if (out.time) return false
    const w = m[0].toLowerCase().split(/\s+/).pop()!
    out.time = DAYPART[w]
    if (m[0].toLowerCase().startsWith('heute')) out.dueDate ??= today
    return `${m[0].toLowerCase()} (${out.time})`
  })

  // Dauer: „30 min“, „2h“, „1h30“, „1,5 Std.“, „eine halbe Stunde“
  sc.rule(
    rx(
      `(?:für${S}|ca\\.?${S}|etwa${S}|dauer${S})?(?:(\\d+(?:[.,]\\d+)?)[ \\t]?(?:h|std\\.?|stunden?)(?:(\\d{1,2})(?:min|m)?|[ \\t]+(\\d{1,2})[ \\t]?(?:min\\.?|minuten))?|(\\d+)(?:[ \\t]?(?:min\\.?|minuten)|m)|(eine|einer|ein)?[ \\t]*(halbe[n]?${S}stunde|viertelstunde|dreiviertelstunde|stunde)|(anderthalb|eineinhalb|zwei|drei|vier|fünf)${S}stunden)`,
    ),
    'duration',
    (m) => {
      let min = 0
      if (m[1]) min = Math.round(Number(m[1].replace(',', '.')) * 60) + Number(m[2] ?? m[3] ?? 0)
      else if (m[4]) min = Number(m[4])
      else if (m[6]) {
        const w = m[6].toLowerCase()
        if (w === 'stunde' && !m[5]) return false // „Stunde“ allein ist eher Text
        min = w.startsWith('halbe') ? 30 : w === 'viertelstunde' ? 15 : w === 'dreiviertelstunde' ? 45 : 60
      } else if (m[7]) min = { anderthalb: 90, eineinhalb: 90, zwei: 120, drei: 180, vier: 240, fünf: 300 }[m[7].toLowerCase()] ?? 0
      if (!min || min > 1440) return false
      out.estimate = min
      return `Dauer ${durationText(min)}`
    },
  )

  // Wichtigkeit
  sc.rule(new RegExp(`(?<=^|[\\s\\u0000])(?:!([1-4])|!!!|!!)(?=$|[\\s\\u0000])`, 'gu'), 'prio', (m) => {
    const p = (m[1] ? Number(m[1]) : m[0] === '!!!' ? 1 : 2) as Priority
    out.priority = p
    return ['', 'Hoch', 'Mittel', 'Niedrig', 'Keine Priorität'][p]
  })
  if (!out.priority) {
    sc.rule(rx(`sehr${S}wichtig|dringend|asap|wichtig|prio(?:rität)?[ \\t]?([1-3])|p([1-3])|unwichtig|nebensächlich|niedrige${S}priorität`), 'prio', (m) => {
      const t = m[0].toLowerCase()
      const p = (m[1] || m[2] ? Number(m[1] ?? m[2]) : /unwichtig|nebensächlich|niedrige/.test(t) ? 3 : 1) as Priority
      out.priority = p
      return ['', 'Hoch', 'Mittel', 'Niedrig'][p]
    })
  }

  // Zeithorizont
  sc.rule(rx('kurzfristig|demnächst|langfristig|irgendwann|someday'), 'horizon', (m) => {
    const t = m[0].toLowerCase()
    out.horizon = t === 'langfristig' ? 'long' : t === 'kurzfristig' || t === 'demnächst' ? 'short' : 'backlog'
    return out.horizon === 'long' ? 'Langfristig' : out.horizon === 'short' ? 'Kurzfristig' : 'Irgendwann'
  })

  // Liste und Tags
  sc.rule(new RegExp(`(?<=^|[\\s\\u0000(])@([\\p{L}\\p{N}_-]+)`, 'gu'), 'list', (m) => {
    out.listName = m[1]
    const key = norm(m[1]).replace(/ /g, '')
    out.list = ctx.lists ? Object.values(ctx.lists).find((l) => !l.archived && norm(l.name).replace(/ /g, '').startsWith(key)) : undefined
    return out.list ? `Liste ${out.list.name}` : `neue Liste „${m[1]}“`
  })
  sc.rule(
    new RegExp(`(?<=^|[\\s\\u0000(])#([\\p{L}\\p{N}_-]+)`, 'gu'),
    'tag',
    (m) => {
      if (/^\d+$/.test(m[1])) return false
      const t = m[1].toLowerCase()
      if (!out.tags.includes(t)) out.tags.push(t)
      return `#${t}`
    },
    true,
  )

  // Rest = Titel (Anführungszeichen weg, Leerraum zusammengezogen)
  let title = ''
  for (let i = 0; i < input.length; i++) {
    if (sc.work[i] === '\u0000') {
      title += ' '
      continue
    }
    const q = sc.quoteAt(i)
    if (q) {
      title += q.text
      i = q.end - 1
      continue
    }
    title += input[i]
  }
  out.title = title
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
  out.tokens.sort((a, b) => a.start - b.start)
  if (out.rrule && !out.dueDate) out.dueDate = today
  return out
}

/** Einen Verweis ab Position pos lesen: Nummer, "Zitat" oder bekannter Aufgabenname */
function readRef(sc: Scanner, pos: number, ctx: LangContext, taken: Task[], minScore: number): { task: Task; end: number } | null {
  const rest = sc.work.slice(pos)
  const allowDone = false
  const pool = refTargets(ctx, allowDone).filter((t) => !taken.includes(t))
  // Nummer
  const nm = /^(?:nr\.?[ \t]*|task[ \t]*|aufgabe[ \t]*|#)?(\d{1,6})(?![\p{L}\p{N}_.])/iu.exec(rest)
  if (nm) {
    const n = Number(nm[1])
    const t = ctx.tasks ? Object.values(ctx.tasks).find((x) => x.num === n && x.id !== ctx.self) : undefined
    return t && !taken.includes(t) ? { task: t, end: pos + nm[0].length } : null
  }
  // Zitat
  const q = sc.quoteAt(pos)
  if (q) {
    const t = findByName(pool, q.text)
    if (!t) return null
    sc.quotes = sc.quotes.filter((x) => x !== q)
    sc.work = sc.work.slice(0, q.start) + q.text.padEnd(q.end - q.start, ' ') + sc.work.slice(q.end)
    return { task: t, end: q.end }
  }
  // Wörter, längster Treffer gewinnt
  const words: { end: number }[] = []
  const wre = /[ \t]*([\p{L}\p{N}][\p{L}\p{N}_'’.-]*)/uy
  let p = 0
  for (let k = 0; k < 8; k++) {
    wre.lastIndex = p
    const m = wre.exec(rest)
    if (!m) break
    p = wre.lastIndex
    words.push({ end: p })
  }
  for (let k = words.length; k >= 1; k--) {
    const phrase = rest.slice(0, words[k - 1].end).replace(/[.]+$/, '')
    const t = findByName(pool, phrase, minScore)
    if (!t) continue
    const title = norm(t.title)
    const ph = norm(phrase)
    // Einzelnes kurzes Wort nur, wenn es ein Wortanfang des Titels ist
    if (k === 1 && ph.length < 3 && !title.startsWith(ph)) continue
    return { task: t, end: pos + words[k - 1].end }
  }
  return null
}

// ---------------------------------------------------------------------------
// Vorschläge beim Tippen (Aufgaben, Listen, Tags)
// ---------------------------------------------------------------------------
export type SuggestKind = 'ref' | 'list' | 'tag'
export interface SuggestContext {
  kind: SuggestKind
  /** Teil vor dem Cursor, der ersetzt wird */
  from: number
  query: string
}

const REF_WORDS = String.raw`(?:warte(?:t|n)?\s+auf|erst\s+nach|blockiert\s+(?:von|durch)|abhängig\s+von|unteraufgabe\s+von|teil\s+von|gehört\s+zu|unter)`
const REF_FIRST = new RegExp(String.raw`(?:^|[\s(])${REF_WORDS}\s+((?:[^\s,;"„“]+(?:\s+(?=\S))?){0,4})$`, 'iu')
const REF_MORE = new RegExp(String.raw`(?:^|[\s(])${REF_WORDS}\s+(?:\d+|"[^"]*")(?:\s*(?:,|und|&)\s*(?:\d+|"[^"]*"))*\s*(?:,|und|&)\s*([^\s,;"]*)$`, 'iu')

export function suggestContext(textBeforeCaret: string): SuggestContext | null {
  const t = textBeforeCaret
  // in einem offenen Zitat nichts vorschlagen
  if ((t.match(/"/g)?.length ?? 0) % 2 === 1) return null
  let m = /(?:^|[\s(])@([\p{L}\p{N}_-]*)$/u.exec(t)
  if (m) return { kind: 'list', from: t.length - m[1].length, query: m[1] }
  m = /(?:^|[\s(])#([\p{L}\p{N}_-]*)$/u.exec(t)
  if (m && !/^\d+$/.test(m[1])) return { kind: 'tag', from: t.length - m[1].length, query: m[1] }
  m = REF_MORE.exec(t)
  if (m) return { kind: 'ref', from: t.length - m[1].length, query: m[1] }
  m = REF_FIRST.exec(t)
  if (m) {
    const q = m[1]
    // nach einem vollständigen Verweis mit Leerzeichen nichts mehr anbieten
    if (/\s$/.test(t) && q.trim()) return null
    return { kind: 'ref', from: t.length - q.length, query: q.trim() }
  }
  return null
}
