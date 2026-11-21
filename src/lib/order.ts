/** Sortierwert zwischen zwei Nachbarn (Karten bleiben an der Stelle, an der man sie loslässt) */
export function sortBetween(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) return prev === next ? prev + 0.0001 : (prev + next) / 2
  if (prev !== undefined) return prev + 1024
  if (next !== undefined) return next - 1024
  return Date.now()
}

export const topSort = (sorts: number[]) => (sorts.length ? Math.min(...sorts) - 1024 : Date.now())
