/** Nach dem Loslassen einer Karte kurz Klicks ignorieren (sonst öffnet sich die Karte ungewollt) */
let lastDragEnd = 0
export const markDragEnd = () => {
  lastDragEnd = Date.now()
}
export const justDragged = () => Date.now() - lastDragEnd < 250

/** clientY aus Maus-, Pointer- oder Touch-Ereignis */
export function eventY(e: Event | null | undefined): number | null {
  if (!e) return null
  if ('touches' in e && (e as TouchEvent).touches.length) return (e as TouchEvent).touches[0].clientY
  if ('changedTouches' in e && (e as TouchEvent).changedTouches.length) return (e as TouchEvent).changedTouches[0].clientY
  if ('clientY' in e) return (e as MouseEvent).clientY
  return null
}
export function eventX(e: Event | null | undefined): number | null {
  if (!e) return null
  if ('touches' in e && (e as TouchEvent).touches.length) return (e as TouchEvent).touches[0].clientX
  if ('changedTouches' in e && (e as TouchEvent).changedTouches.length) return (e as TouchEvent).changedTouches[0].clientX
  if ('clientX' in e) return (e as MouseEvent).clientX
  return null
}
