/** Kleine Einstellungen pro Gerät (Ansicht, Board-Modus …) */
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`organizer:${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`organizer:${key}`, JSON.stringify(value))
  } catch {
    /* privat-Modus o. Ä. */
  }
}
