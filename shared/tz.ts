/** Zeitzonen-Helfer ohne Bibliothek (Intl reicht). Von App und Worker benutzt. */

function parts(ts: number, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ts)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute'), s: get('second') }
}

/** Abstand der Zeitzone zu UTC in ms zum Zeitpunkt ts */
export function tzOffsetMs(ts: number, tz: string): number {
  const x = parts(ts, tz)
  return Date.UTC(x.y, x.m - 1, x.d, x.h, x.min, x.s) - Math.floor(ts / 1000) * 1000
}

/** Ortszeit (Datum + "HH:mm") in einer Zeitzone → UTC-Zeitpunkt (ms) */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const guess = Date.parse(`${date}T${hhmm}:00Z`)
  const off1 = tzOffsetMs(guess, tz)
  let utc = guess - off1
  const off2 = tzOffsetMs(utc, tz)
  if (off2 !== off1) utc = guess - off2
  return utc
}

/** Datum (YYYY-MM-DD) und Uhrzeit ("HH:mm") eines Zeitpunkts in einer Zeitzone */
export function utcToZoned(ts: number, tz: string): { date: string; time: string } {
  const x = parts(ts, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${x.y}-${pad(x.m)}-${pad(x.d)}`, time: `${pad(x.h)}:${pad(x.min)}` }
}

/** Zeitblock auf einen anderen Tag legen, gleiche Ortszeit und Dauer */
export function moveBlockToDate(startIso: string, endIso: string, tz: string, newDate: string): { start_at: string; end_at: string } {
  const start = Date.parse(startIso)
  const dur = Date.parse(endIso) - start
  const { time } = utcToZoned(start, tz)
  const s = zonedToUtc(newDate, time, tz)
  return { start_at: new Date(s).toISOString(), end_at: new Date(s + dur).toISOString() }
}
