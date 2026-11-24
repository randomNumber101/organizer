/**
 * Termin anlegen, ansehen und bearbeiten (Google). Am Laptop als Karte neben der Stelle, am Handy als Blatt.
 * Beim Anlegen lässt sich auch eine Aufgabe statt eines Termins erzeugen. Der Titel versteht die Eingabesprache
 * („Zahnarzt morgen 14–15 Uhr wöchentlich“).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlignLeft, Bell, CalendarDays, CalendarPlus, Clock, ExternalLink, MapPin, Palette, Repeat, SquareCheck, Trash2, Users, Video, X } from 'lucide-react'
import { useStore, type EventEditorState } from '../store'
import type { CalendarEvent, EventInput } from '../lib/types'
import { addDaysStr, deviceTimeZone, hhmm, localDateTimeToIso, localDayOf, minutesOfDay, todayStr } from '../lib/dates'
import { EVENT_COLOR_NAMES, REMINDER_OPTIONS, REPEAT_OPTIONS, evColor, fmtDayLong } from '../lib/calendar'
import { parseLang } from '../lib/lang'
import { composeTask } from '../lib/compose'
import { useIsMobile } from '../hooks/useMedia'
import Segmented from './Segmented'
import { TokenChips } from './SmartField'

export default function EventEditor() {
  const state = useStore((s) => s.eventEditor)
  const open = useStore((s) => s.openEventEditor)
  const isMobile = useIsMobile()
  const close = () => open(null)
  useEffect(() => {
    if (!state) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('select') && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return createPortal(
    <AnimatePresence>
      {state && (
        <>
          <motion.div key="bd" className={`backdrop ${isMobile ? '' : 'light'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <Card key={state.mode === 'edit' ? `e-${state.event.calendarId}-${state.event.id}` : 'new'} state={state} mobile={isMobile} onClose={close} />
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Card({ state, mobile, onClose }: { state: EventEditorState; mobile: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (mobile || !ref.current) return
    const w = ref.current.offsetWidth
    const h = ref.current.offsetHeight
    const a = state.anchor ?? { x: window.innerWidth / 2 - w / 2, y: 120 }
    let left = a.x + 12
    if (left + w > window.innerWidth - 12) left = Math.max(12, a.x - w - 12)
    const top = Math.max(12, Math.min(a.y - 40, window.innerHeight - h - 12))
    setPos({ left, top })
  }, [mobile, state.anchor])
  return (
    <motion.div
      ref={ref}
      className={`ev-card ${mobile ? 'sheet ev-sheet' : ''}`}
      role="dialog"
      aria-label={state.mode === 'new' ? 'Neuer Termin' : 'Termin'}
      style={mobile ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
      initial={mobile ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 4 }}
      animate={mobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
      exit={mobile ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 4 }}
      transition={mobile ? { type: 'spring', stiffness: 420, damping: 40 } : { duration: 0.15 }}
    >
      {mobile && <div className="sheet-grab" />}
      {state.mode === 'edit' && !state.event.writable ? <ReadOnly event={state.event} onClose={onClose} /> : <Form state={state} onClose={onClose} />}
    </motion.div>
  )
}

function whenText(e: CalendarEvent) {
  if (e.allDay) {
    const last = addDaysStr(e.end, -1)
    return last > e.start ? `${fmtDayLong(e.start)} – ${fmtDayLong(last)} · ganztags` : `${fmtDayLong(e.start)} · ganztags`
  }
  return `${fmtDayLong(localDayOf(e.start))} · ${hhmm(minutesOfDay(e.start))}–${hhmm(minutesOfDay(e.end))}`
}

/** Termin aus einem Kalender ohne Schreibrecht */
function ReadOnly({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const importEvent = useStore((s) => s.importEvent)
  const prefs = useStore((s) => s.prefs)
  const google = useStore((s) => s.google)
  const connectGoogle = useStore((s) => s.connectGoogle)
  const needsScope = !google?.events?.granted
  return (
    <div className="ev-body">
      <div className="ev-head">
        <span className="dot" style={{ background: evColor(event, prefs) }} />
        <h4>{event.title}</h4>
        <button className="icon-btn sm" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <EventFacts event={event} />
      {needsScope && (
        <p className="ev-note">
          Um Termine hier zu ändern, verbinde Google einmal neu (Berechtigung „Termine bearbeiten“).{' '}
          <button className="link" onClick={connectGoogle}>
            Jetzt neu verbinden
          </button>
        </p>
      )}
      <div className="ev-actions">
        <button className="btn sm" onClick={() => (importEvent(event), onClose())}>
          <SquareCheck size={15} /> Als Aufgabe übernehmen
        </button>
        {event.link && (
          <a className="btn sm ghost" href={event.link} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> In Google
          </a>
        )}
      </div>
    </div>
  )
}

function EventFacts({ event }: { event: CalendarEvent }) {
  return (
    <div className="ev-facts">
      <div className="row">
        <Clock /> {whenText(event)}
      </div>
      {event.recurringId && (
        <div className="row">
          <Repeat /> Teil einer Serie
        </div>
      )}
      {event.location && (
        <div className="row">
          <MapPin />
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`} target="_blank" rel="noreferrer">
            {event.location}
          </a>
        </div>
      )}
      {event.meet && (
        <div className="row">
          <Video />
          <a href={event.meet} target="_blank" rel="noreferrer">
            Videoanruf beitreten
          </a>
        </div>
      )}
      {!!event.guests && (
        <div className="row">
          <Users /> {event.guests} {event.guests === 1 ? 'Gast' : 'Gäste'}
        </div>
      )}
      <div className="row">
        <CalendarDays /> {event.calendarName}
      </div>
      {event.description && <div className="ev-desc">{event.description}</div>}
    </div>
  )
}

type Draft = {
  title: string
  allDay: boolean
  day: string
  endDay: string
  start: string // HH:mm
  end: string
  calendarId: string
  colorId: string | null
  location: string
  description: string
  recurrence: string
  reminder: string
}

function draftFrom(state: EventEditorState, defaultCal: string): Draft {
  const today = todayStr()
  if (state.mode === 'edit') {
    const e = state.event
    return {
      title: e.title,
      allDay: e.allDay,
      day: e.allDay ? e.start : localDayOf(e.start),
      endDay: e.allDay ? addDaysStr(e.end, -1) : localDayOf(e.end),
      start: e.allDay ? '09:00' : hhmm(minutesOfDay(e.start)),
      end: e.allDay ? '10:00' : hhmm(minutesOfDay(e.end)),
      calendarId: e.calendarId,
      colorId: e.colorId ?? null,
      location: e.location ?? '',
      description: e.description ?? '',
      recurrence: '',
      reminder: 'default',
    }
  }
  const d = state.draft
  const allDay = !!d.allDay
  const day = d.start ? (allDay ? d.start.slice(0, 10) : localDayOf(d.start)) : today
  return {
    title: d.title ?? '',
    allDay,
    day,
    endDay: d.end && allDay ? addDaysStr(d.end, -1) : day,
    start: d.start && !allDay ? hhmm(minutesOfDay(d.start)) : '09:00',
    end: d.end && !allDay ? hhmm(minutesOfDay(d.end)) : '10:00',
    calendarId: d.calendarId ?? defaultCal,
    colorId: null,
    location: '',
    description: '',
    recurrence: '',
    reminder: 'default',
  }
}

function Form({ state, onClose }: { state: EventEditorState; onClose: () => void }) {
  const google = useStore((s) => s.google)
  const prefs = useStore((s) => s.prefs)
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const { createEvent, updateEvent, deleteEvent, importEvent, createTask, connectGoogle, setPref } = useStore.getState()
  const writable = (google?.calendars ?? []).filter((c) => c.writable)
  const primary = writable.find((c) => c.primary) ?? writable[0]
  const defaultCal = (prefs.calendar?.defaultCalendar && writable.some((c) => c.id === prefs.calendar?.defaultCalendar) ? prefs.calendar.defaultCalendar : primary?.id) ?? ''
  const canEvents = !!google?.events?.granted && writable.length > 0
  const isNew = state.mode === 'new'
  const [kind, setKind] = useState<'event' | 'task'>(isNew && (state.draft.asTask || !canEvents) ? 'task' : 'event')
  const [d, setD] = useState<Draft>(() => draftFrom(state, defaultCal))
  const [more, setMore] = useState(state.mode === 'edit' && !!(state.event.location || state.event.description))
  const [askSeries, setAskSeries] = useState<null | 'save' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const upd = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (isNew) setTimeout(() => titleRef.current?.focus(), 60)
  }, [isNew])

  // Eingabesprache im Titel (nur beim Anlegen): Tag, Uhrzeit, Dauer, Wiederholung
  const parsed = useMemo(() => (isNew && d.title.trim() ? parseLang(d.title, { today: todayStr(), lists, tasks }) : null), [isNew, d.title, lists, tasks])
  const tokens = parsed?.tokens.filter((t) => ['date', 'time', 'duration', 'repeat'].includes(t.kind)) ?? []

  const resolved = (): Draft => {
    if (!parsed || !tokens.length) return d
    const r = { ...d, title: parsed.title || d.title }
    if (parsed.dueDate) r.day = r.endDay = parsed.dueDate
    if (parsed.time) {
      r.allDay = false
      r.start = parsed.time
      const [h, m] = parsed.time.split(':').map(Number)
      r.end = hhmm(Math.min(24 * 60 - 1, h * 60 + m + (parsed.durationMin ?? parsed.estimate ?? 60)))
    }
    if (parsed.rrule) r.recurrence = `RRULE:${parsed.rrule}`
    return r
  }

  const toInput = (x: Draft): EventInput => {
    const start = x.allDay ? x.day : localDateTimeToIso(x.day, x.start)
    let end = x.allDay ? addDaysStr(x.endDay < x.day ? x.day : x.endDay, 1) : localDateTimeToIso(x.endDay < x.day ? x.day : x.endDay, x.end)
    if (!x.allDay && Date.parse(end) <= Date.parse(start)) end = new Date(Date.parse(start) + 3_600_000).toISOString()
    return {
      calendarId: x.calendarId,
      title: x.title.trim(),
      allDay: x.allDay,
      start,
      end,
      timeZone: deviceTimeZone(),
      location: x.location.trim() || null,
      description: x.description.trim() || null,
      colorId: x.colorId,
      ...(x.recurrence ? { recurrence: x.recurrence } : {}),
      ...(x.reminder !== 'default' ? { reminders: x.reminder === 'none' ? [] : [Number(x.reminder)] } : {}),
    }
  }

  const save = async (all?: boolean) => {
    const x = resolved()
    if (!x.title.trim()) return titleRef.current?.focus()
    if (kind === 'task') {
      // Aufgabe mit Uhrzeit bzw. für den Tag
      const c = composeTask(d.title, x.allDay ? { due_date: x.day } : { due_date: x.day, start_at: localDateTimeToIso(x.day, x.start), end_at: localDateTimeToIso(x.day, x.end), timezone: deviceTimeZone() }, lists, tasks)
      if (!c.patch.title) return
      createTask(c.patch)
      onClose()
      return
    }
    setBusy(true)
    if (state.mode === 'new') {
      const ok = await createEvent(toInput(x))
      setBusy(false)
      if (ok) onClose()
      return
    }
    const ev = state.event
    if (ev.recurringId && all === undefined) {
      setBusy(false)
      setAskSeries('save')
      return
    }
    const inp = toInput(x)
    const patch: Partial<EventInput> = {}
    if (inp.title !== ev.title) patch.title = inp.title
    if (inp.start !== ev.start || inp.end !== ev.end || inp.allDay !== ev.allDay) Object.assign(patch, { start: inp.start, end: inp.end, allDay: inp.allDay })
    if ((inp.location ?? null) !== (ev.location ?? null)) patch.location = inp.location
    if ((inp.description ?? null) !== (ev.description ?? null)) patch.description = inp.description
    if ((inp.colorId ?? null) !== (ev.colorId ?? null)) patch.colorId = inp.colorId
    if (x.recurrence && !ev.recurringId) patch.recurrence = x.recurrence
    if (x.reminder !== 'default') patch.reminders = inp.reminders
    const toCalendar = x.calendarId !== ev.calendarId ? x.calendarId : undefined
    const ok = Object.keys(patch).length || toCalendar ? await updateEvent(ev, patch, { all, toCalendar }) : true
    setBusy(false)
    if (ok) onClose()
  }

  const remove = async (all?: boolean) => {
    if (state.mode !== 'edit') return
    if (state.event.recurringId && all === undefined) return setAskSeries('delete')
    onClose()
    await deleteEvent(state.event, !!all)
  }

  const cal = writable.find((c) => c.id === d.calendarId)
  const color = d.colorId ? EVENT_COLOR_NAMES.find((c) => c[0] === d.colorId)?.[1] : (prefs.calendar?.colors?.[d.calendarId] ?? cal?.color)

  return (
    <form
      className="ev-body"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="ev-head">
        {isNew ? (
          <Segmented
            group="ev-kind"
            value={kind}
            onChange={(v) => setKind(v as 'event' | 'task')}
            options={[
              { value: 'event', label: 'Termin', icon: <CalendarPlus /> },
              { value: 'task', label: 'Aufgabe', icon: <SquareCheck /> },
            ]}
          />
        ) : (
          <span className="dot" style={{ background: color }} />
        )}
        <span style={{ flex: 1 }} />
        {state.mode === 'edit' && state.event.link && (
          <a className="icon-btn sm" href={state.event.link} target="_blank" rel="noreferrer" aria-label="In Google öffnen" title="In Google öffnen">
            <ExternalLink size={15} />
          </a>
        )}
        <button type="button" className="icon-btn sm" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <input ref={titleRef} className="ev-title" value={d.title} onChange={(e) => upd({ title: e.target.value })} placeholder={kind === 'task' ? 'Aufgabe, z. B. „Mails morgen 9 Uhr“' : 'Titel, z. B. „Zahnarzt morgen 14 Uhr“'} aria-label="Titel" />
      {tokens.length > 0 && (
        <div className="hint">
          <TokenChips tokens={tokens} />
        </div>
      )}

      {kind === 'event' && isNew && !canEvents && (
        <p className="ev-note">
          Für Termine braucht die App die Berechtigung „Termine bearbeiten“.{' '}
          <button type="button" className="link" onClick={connectGoogle}>
            Google neu verbinden
          </button>
        </p>
      )}

      <div className="ev-grid">
        <Clock className="ev-ic" />
        <div className="ev-when">
          <input type="date" className="field-input" value={d.day} onChange={(e) => e.target.value && upd({ day: e.target.value, endDay: d.endDay < e.target.value || !d.allDay ? e.target.value : d.endDay })} aria-label="Tag" />
          {!d.allDay ? (
            <>
              <input type="time" className="field-input" value={d.start} step={300} onChange={(e) => e.target.value && upd({ start: e.target.value, end: shiftEnd(d.start, d.end, e.target.value) })} aria-label="Beginn" />
              <span className="muted">–</span>
              <input type="time" className="field-input" value={d.end} step={300} onChange={(e) => e.target.value && upd({ end: e.target.value })} aria-label="Ende" />
            </>
          ) : (
            kind === 'event' && (
              <>
                <span className="muted">bis</span>
                <input type="date" className="field-input" value={d.endDay} min={d.day} onChange={(e) => e.target.value && upd({ endDay: e.target.value })} aria-label="Letzter Tag" />
              </>
            )
          )}
          <label className="ev-check">
            <input type="checkbox" checked={d.allDay} onChange={(e) => upd({ allDay: e.target.checked })} /> ganztags
          </label>
        </div>

        {kind === 'event' && (
          <>
            <CalendarDays className="ev-ic" />
            <div className="ev-row">
              <span className="dot" style={{ background: color }} />
              <select
                className="field-input"
                value={d.calendarId}
                onChange={(e) => {
                  upd({ calendarId: e.target.value })
                  if (isNew) setPref('calendar', { ...(prefs.calendar ?? {}), defaultCalendar: e.target.value })
                }}
                aria-label="Kalender"
              >
                {writable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <Palette className="ev-ic" />
            <div className="ev-colors" role="radiogroup" aria-label="Farbe">
              <button type="button" role="radio" aria-checked={!d.colorId} className={`ev-color ${!d.colorId ? 'on' : ''}`} style={{ background: prefs.calendar?.colors?.[d.calendarId] ?? cal?.color }} title="Kalenderfarbe" onClick={() => upd({ colorId: null })} />
              {EVENT_COLOR_NAMES.map(([id, hex, name]) => (
                <button type="button" role="radio" aria-checked={d.colorId === id} key={id} className={`ev-color ${d.colorId === id ? 'on' : ''}`} style={{ background: hex }} title={name} onClick={() => upd({ colorId: id })} />
              ))}
            </div>

            {(isNew || !(state.mode === 'edit' && state.event.recurringId)) && (
              <>
                <Repeat className="ev-ic" />
                <select className="field-input" value={d.recurrence} onChange={(e) => upd({ recurrence: e.target.value })} aria-label="Wiederholen">
                  {REPEAT_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                  {d.recurrence && !REPEAT_OPTIONS.some(([v]) => v === d.recurrence) && <option value={d.recurrence}>Eigene Wiederholung</option>}
                </select>
              </>
            )}

            {!d.allDay && (
              <>
                <Bell className="ev-ic" />
                <select className="field-input" value={d.reminder} onChange={(e) => upd({ reminder: e.target.value })} aria-label="Erinnerung">
                  {REMINDER_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </>
            )}

            {more ? (
              <>
                <MapPin className="ev-ic" />
                <input className="field-input" value={d.location} onChange={(e) => upd({ location: e.target.value })} placeholder="Ort" aria-label="Ort" />
                <AlignLeft className="ev-ic" />
                <textarea className="field-input ev-notes" value={d.description} onChange={(e) => upd({ description: e.target.value })} placeholder="Beschreibung" aria-label="Beschreibung" />
              </>
            ) : (
              <>
                <span />
                <button type="button" className="link ev-more" onClick={() => setMore(true)}>
                  + Ort, Beschreibung
                </button>
              </>
            )}
          </>
        )}
      </div>

      {state.mode === 'edit' && (state.event.meet || state.event.guests) ? (
        <div className="ev-facts compact">
          {state.event.meet && (
            <div className="row">
              <Video />
              <a href={state.event.meet} target="_blank" rel="noreferrer">
                Videoanruf beitreten
              </a>
            </div>
          )}
          {!!state.event.guests && (
            <div className="row">
              <Users /> {state.event.guests} {state.event.guests === 1 ? 'Gast' : 'Gäste'} – Einladungen bitte in Google bearbeiten
            </div>
          )}
        </div>
      ) : null}

      {askSeries ? (
        <div className="ev-series">
          <span>{askSeries === 'save' ? 'Änderung übernehmen für …' : 'Löschen …'}</span>
          <button type="button" className="btn sm" onClick={() => (askSeries === 'save' ? void save(false) : void remove(false))}>
            nur diesen Termin
          </button>
          <button type="button" className={`btn sm ${askSeries === 'delete' ? 'danger' : ''}`} onClick={() => (askSeries === 'save' ? void save(true) : void remove(true))}>
            alle der Serie
          </button>
        </div>
      ) : (
        <div className="ev-actions">
          {state.mode === 'edit' && (
            <>
              <button type="button" className="btn sm ghost danger" onClick={() => void remove()}>
                <Trash2 size={15} /> Löschen
              </button>
              <button type="button" className="btn sm ghost" onClick={() => (importEvent(state.event), onClose())} title="Als Aufgabe übernehmen">
                <SquareCheck size={15} /> Aufgabe
              </button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button type="submit" className="btn primary" disabled={busy || (kind === 'event' && !canEvents)}>
            {state.mode === 'new' ? (kind === 'task' ? 'Aufgabe anlegen' : 'Termin anlegen') : 'Speichern'}
          </button>
        </div>
      )}
    </form>
  )
}

/** Beginn verschoben → Ende mit gleicher Dauer mitziehen */
function shiftEnd(oldStart: string, oldEnd: string, newStart: string): string {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const dur = Math.max(15, m(oldEnd) - m(oldStart))
  return hhmm(Math.min(24 * 60 - 1, m(newStart) + dur))
}
