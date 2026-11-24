/**
 * Wichtigkeit 0–5 als kleine Skala: 0 = keine … 5 = dringend.
 */
import type { Priority } from '../lib/types'
import { PRIORITY_LABEL } from '../lib/types'

const LEVELS: Priority[] = [0, 1, 2, 3, 4, 5]

export default function PrioPicker({ value, onChange, compact }: { value: Priority; onChange: (p: Priority) => void; compact?: boolean }) {
  return (
    <div className={`prio-picker ${compact ? 'compact' : ''}`}>
      <div className="prio-scale" role="radiogroup" aria-label="Wichtigkeit">
        {LEVELS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            aria-label={`${p} – ${PRIORITY_LABEL[p]}`}
            title={`${p} – ${PRIORITY_LABEL[p]}`}
            className={`prio-step p${p} ${value === p ? 'on' : ''} ${p > 0 && p <= value ? 'fill' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onChange(p)
            }}
          >
            {p > 0 && <i style={{ height: `${30 + p * 14}%` }} />}
            <span>{p}</span>
          </button>
        ))}
      </div>
      {!compact && <span className={`prio-label p${value}`}>{PRIORITY_LABEL[value]}</span>}
    </div>
  )
}
