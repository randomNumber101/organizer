import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { CalendarDays, Clock, ExternalLink, MapPin, SquareCheck } from 'lucide-react'
import { useStore } from '../store'
import type { CalendarEvent } from '../lib/types'
import { hhmm, longDayLabel, minutesOfDay, localDayOf } from '../lib/dates'

/** Details zu einem Google-Termin – mit „Als Aufgabe übernehmen“ */
export default function EventPopover({ event, anchor, onClose }: { event: CalendarEvent; anchor: DOMRect; onClose: () => void }) {
  const importEvent = useStore((s) => s.importEvent)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = anchor.right + 8
    if (left + w > window.innerWidth - 12) left = Math.max(12, anchor.left - w - 8)
    if (window.innerWidth < 600) left = (window.innerWidth - w) / 2
    let top = Math.min(anchor.top, window.innerHeight - h - 12)
    top = Math.max(12, top)
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => window.addEventListener('pointerdown', down), 0)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const when = event.allDay
    ? `${longDayLabel(event.start)} · ganztags`
    : `${longDayLabel(localDayOf(event.start))} · ${hhmm(minutesOfDay(event.start))}–${hhmm(minutesOfDay(event.end))}`

  return createPortal(
    <motion.div ref={ref} className="popover" style={pos} initial={{ opacity: 0, scale: 0.97, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.15 }} role="dialog">
      <h4>
        <span className="dot" style={{ background: event.color, marginTop: 6 }} />
        {event.title}
      </h4>
      <div className="row">
        <Clock /> {when}
      </div>
      {event.location && (
        <div className="row">
          <MapPin /> {event.location}
        </div>
      )}
      <div className="row">
        <CalendarDays /> {event.calendarName}
      </div>
      <div className="actions">
        <button
          className="btn sm primary"
          onClick={() => {
            void importEvent(event)
            onClose()
          }}
        >
          <SquareCheck size={15} /> Als Aufgabe übernehmen
        </button>
        {event.link && (
          <a className="btn sm ghost" href={event.link} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> In Google
          </a>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}
