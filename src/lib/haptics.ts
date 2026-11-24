/** Kurzes Vibrieren auf Android (iOS ignoriert es) */
export function haptic(ms: number | number[] = 10) {
  try {
    // ohne vorherige Berührung blockiert der Browser das ohnehin (und meckert in der Konsole)
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return
    navigator.vibrate?.(ms)
  } catch {
    /* egal */
  }
}
