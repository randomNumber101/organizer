import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { haptic } from '../lib/haptics'

interface Props {
  done: boolean
  priority?: number
  size?: 'small' | 'big'
  onToggle: () => void
  label?: string
}

/**
 * Rundes Häkchen. Beim Abhaken füllt es sich zuerst sichtbar, erst danach wird die Aufgabe erledigt –
 * so sieht man, was passiert ist, bevor die Karte verschwindet.
 */
export default function Check({ done, priority = 0, size, onToggle, label }: Props) {
  const [pending, setPending] = useState(false)
  const shown = done || pending

  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pending) return
    if (!done) {
      setPending(true)
      haptic(8)
      setTimeout(() => {
        onToggle()
        setPending(false)
      }, 420)
    } else onToggle()
  }

  return (
    <button
      type="button"
      className={`check p${priority} ${size ?? ''}`}
      role="checkbox"
      aria-checked={shown}
      aria-label={label ?? (done ? 'Wieder öffnen' : 'Erledigen')}
      onClick={click}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <AnimatePresence initial={false}>
        {shown && (
          <motion.span
            className="fill"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          />
        )}
      </AnimatePresence>
      {shown && (
        <svg viewBox="0 0 16 16" fill="none">
          <motion.path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: done && !pending ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          />
        </svg>
      )}
    </button>
  )
}
