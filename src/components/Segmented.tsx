import type { ReactNode } from 'react'
import { motion } from 'motion/react'

interface Props {
  group: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; icon?: ReactNode }[]
  className?: string
}

/** Umschalter mit gleitendem Hintergrund */
export default function Segmented({ group, value, onChange, options, className }: Props) {
  return (
    <div className={`segmented ${className ?? ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${group}`} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
