/** Kurzes Vibrieren auf Android (iOS ignoriert es) */
export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* egal */
  }
}
