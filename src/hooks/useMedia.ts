import { useEffect, useState } from 'react'

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    on()
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export const useIsMobile = () => useMedia('(max-width: 820px)')

/** Aktuelle Uhrzeit, minütlich aktualisiert */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
